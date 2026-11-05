/**
 * Private owner passkey enrolment and read-only VALR balance sign-in.
 * Passkeys use WebAuthn (device fingerprint/face/PIN); biometric material
 * never reaches the application or Netlify.
 * Public site is locked to its production RP ID/origin.
 */
import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import {
  allowedOrigin, SITE_RPID, SITE_ORIGIN, verifyOwnerToken,
  issueSession, validSession, clearSession,
} from "./_shared/tradedesk-passkey-session.mjs";

const STORE_NAME = "tradedesk-owner-passkeys-v1";
const OWNER_KEY = "owner-passkeys";
const EXPIRY_MS = 3 * 60 * 1000;
const HEADERS = {
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
};

function result(status, body, cookie) {
  const headers = { ...HEADERS };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(JSON.stringify(body), { status, headers });
}

async function readList(store) {
  const existing = await store.getWithMetadata(OWNER_KEY, { type:"json", consistency:"strong" });
  return { credentials:Array.isArray(existing?.data) ? existing.data : [], etag:existing?.etag };
}

async function saveList(store, previous, credentials) {
  if (credentials.length > 8) return false;
  const condition = previous.etag ? { onlyIfMatch:previous.etag } : { onlyIfNew:true };
  const modified = await store.setJSON(OWNER_KEY, credentials, condition);
  return modified?.modified === true;
}

async function beginChallenge(store, kind, options) {
  const challengeId = randomUUID();
  await store.setJSON("challenge/" + challengeId, {
    kind, challenge:options.challenge,
    expires:Date.now() + EXPIRY_MS, used:false,
  }, { onlyIfNew:true });
  return challengeId;
}

async function consumeChallenge(store, challengeId, kind) {
  if (typeof challengeId !== "string" || !/^[0-9a-f-]{36}$/i.test(challengeId)) return null;
  const key = "challenge/" + challengeId;
  const record = await store.getWithMetadata(key, { type:"json", consistency:"strong" });
  const c = record?.data;
  if (!record?.etag || !c || c.used || c.kind !== kind || c.expires < Date.now()) return null;
  // CAS, not a plain delete: exactly one concurrent request can consume a challenge.
  const updated = await store.setJSON(key, { ...c, used:true }, { onlyIfMatch:record.etag });
  return updated?.modified ? c.challenge : null;
}

export async function handlePasskeyRequest(request, env = process.env, injectedStore) {
  if (request.method !== "POST") return result(405, {ok:false,error:"METHOD_NOT_ALLOWED"});
  if (!allowedOrigin(request)) return result(403, {ok:false,error:"ORIGIN_NOT_ALLOWED"});
  if (!env.TRADEDESK_OWNER_TOKEN || env.TRADEDESK_OWNER_TOKEN.length < 32)
    return result(503, {ok:false,error:"OWNER_NOT_CONFIGURED"});
  let data;
  try {
    if (Number(request.headers.get("content-length") || 0) > 30000) return result(413,{ok:false,error:"REQUEST_TOO_LARGE"});
    data = await request.json();
  } catch { return result(400, {ok:false,error:"INVALID_JSON"}); }
  if (!data || typeof data.action !== "string") return result(400, {ok:false,error:"INVALID_ACTION"});

  if (data.action === "logout") return result(200, {ok:true}, clearSession());

  try {
    const store = injectedStore || getStore({ name:STORE_NAME, consistency:"strong" });
    if (data.action === "status") {
      const { credentials } = await readList(store);
      return result(200, {ok:true,enrolled:credentials.length>0,signedIn:validSession(request,env)});
    }

    if (data.action === "reset-passkeys") {
      if (!verifyOwnerToken(request,env)) return result(401,{ok:false,error:"OWNER_PASSWORD_REQUIRED"});
      const previous=await readList(store);
      if (previous.credentials.length) {
        const saved=await saveList(store,previous,[]);
        if (!saved) return result(409,{ok:false,error:"STORE_CONFLICT"});
      }
      // Also rotate TRADEDESK_OWNER_TOKEN in Netlify after a lost/stolen phone:
      // previously issued cookies stay valid until expiry unless signing key rotates.
      return result(200,{ok:true,removed:true},clearSession());
    }

    if (data.action === "register-begin") {
      if (!verifyOwnerToken(request,env)) return result(401,{ok:false,error:"OWNER_PASSWORD_REQUIRED"});
      const previous = await readList(store);
      const options = await generateRegistrationOptions({
        rpName:"Mr G TradeDesk", rpID:SITE_RPID,
        userName:"TradeDesk Owner",
        userID:new Uint8Array(Buffer.from("tradedesk-single-owner","utf8")),
        attestationType:"none", supportedAlgorithmIDs:[-7,-257],
        authenticatorSelection:{residentKey:"required",userVerification:"required"},
        excludeCredentials:previous.credentials.map(p=>({id:p.id,transports:p.transports||[]})),
      });
      const challengeId = await beginChallenge(store,"register",options);
      return result(200,{ok:true,options,challengeId});
    }

    if (data.action === "register-finish") {
      if (!verifyOwnerToken(request,env)) return result(401,{ok:false,error:"OWNER_PASSWORD_REQUIRED"});
      const challenge = await consumeChallenge(store,data.challengeId,"register");
      if (!challenge) return result(400,{ok:false,error:"CHALLENGE_INVALID"});
      let verified;
      try {
        verified = await verifyRegistrationResponse({
          response:data.credential, expectedChallenge:challenge,
          expectedOrigin:SITE_ORIGIN, expectedRPID:SITE_RPID,
          requireUserVerification:true,
          supportedAlgorithmIDs:[-7,-257],
        });
      } catch { return result(400,{ok:false,error:"PASSKEY_REGISTRATION_FAILED"}); }
      if (!verified.verified || !verified.registrationInfo?.credential)
        return result(400,{ok:false,error:"PASSKEY_REGISTRATION_FAILED"});
      const cred = verified.registrationInfo.credential;
      if (!cred?.id || !cred?.publicKey?.length) return result(400,{ok:false,error:"INVALID_CREDENTIAL"});
      const previous = await readList(store);
      if (previous.credentials.some(p=>p.id===cred.id))
        return result(409,{ok:false,error:"ALREADY_REGISTERED"});
      const saved = await saveList(store,previous,[...previous.credentials,{
        id:cred.id,
        publicKey:Buffer.from(cred.publicKey).toString("base64url"),
        counter:cred.counter,
        transports:cred.transports || [],
        added:new Date().toISOString(),
      }]);
      if (!saved) return result(409,{ok:false,error:"STORE_CONFLICT"});
      return result(200,{ok:true,registered:true},issueSession(env));
    }

    if (data.action === "login-begin") {
      const { credentials } = await readList(store);
      if (!credentials.length) return result(409,{ok:false,error:"NO_PASSKEY_ENROLLED"});
      const options = await generateAuthenticationOptions({
        rpID:SITE_RPID,userVerification:"required",
        allowCredentials:credentials.map(p=>({id:p.id,transports:p.transports||[]})),
      });
      const challengeId = await beginChallenge(store,"login",options);
      return result(200,{ok:true,options,challengeId});
    }

    if (data.action === "login-finish") {
      const challenge = await consumeChallenge(store,data.challengeId,"login");
      if (!challenge) return result(400,{ok:false,error:"CHALLENGE_INVALID"});
      const previous = await readList(store);
      const id = data.credential?.id;
      const stored = previous.credentials.find(p=>p.id===id);
      if (!stored) return result(401,{ok:false,error:"PASSKEY_UNRECOGNISED"});
      let verified;
      try {
        verified = await verifyAuthenticationResponse({
          response:data.credential,expectedChallenge:challenge,
          expectedOrigin:SITE_ORIGIN,expectedRPID:SITE_RPID,
          requireUserVerification:true,
          credential:{
            id:stored.id,publicKey:new Uint8Array(Buffer.from(stored.publicKey,"base64url")),
            counter:stored.counter,transports:stored.transports,
          },
        });
      } catch { return result(401,{ok:false,error:"PASSKEY_AUTH_FAILED"}); }
      if (!verified.verified) return result(401,{ok:false,error:"PASSKEY_AUTH_FAILED"});
      const updated = previous.credentials.map(p=>p.id===id ?
        {...p,counter:verified.authenticationInfo.newCounter}:p);
      const saved = await saveList(store,previous,updated);
      if (!saved) return result(409,{ok:false,error:"AUTH_CONFLICT_TRY_AGAIN"});
      return result(200,{ok:true,signedIn:true},issueSession(env));
    }

    return result(400,{ok:false,error:"INVALID_ACTION"});
  } catch {
    // Do not return private credential blobs, library errors or key material.
    return result(503,{ok:false,error:"PASSKEY_SERVICE_UNAVAILABLE"});
  }
}

export default async function(request) { return handlePasskeyRequest(request); }
