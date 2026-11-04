import test from "node:test";
import assert from "node:assert/strict";
import {
  issueSession, validSession, clearSession, verifyOwnerToken, allowedOrigin,
} from "../../netlify/functions/_shared/tradedesk-passkey-session.mjs";
import { handlePasskeyRequest } from "../../netlify/functions/tradedesk-passkeys.mjs";

const SITE="https://mrg-trade-desk.netlify.app";
const PASS="Z".repeat(48);
const ENV={TRADEDESK_OWNER_TOKEN:PASS};
const req=(action,token="",url=SITE+"/.netlify/functions/tradedesk-passkeys")=>
  new Request(url,{
    method:"POST",
    headers:{"Origin":SITE,"Content-Type":"application/json",
      ...(token?{"Authorization":"Bearer "+token}:{})},
    body:JSON.stringify({action}),
  });
function fakeStore(){
  const map=new Map();
  return {
    map,
    async getWithMetadata(key) {
      const v=map.get(key);
      return v?{data:v.data,etag:v.etag}:null;
    },
    async setJSON(key,data,opts={}) {
      const previous=map.get(key);
      if(opts.onlyIfNew && previous) return {modified:false};
      if(opts.onlyIfMatch && previous?.etag !== opts.onlyIfMatch)return {modified:false};
      const etag=String(Number(previous?.etag||0)+1);
      map.set(key,{data:JSON.parse(JSON.stringify(data)),etag});
      return {modified:true,etag};
    },
  };
}
const decode=async r=>({status:r.status,body:await r.json(),headers:r.headers});

test("Owner password is not confused with a passkey session",()=>{
  const request=req("register-begin",PASS);
  assert.equal(verifyOwnerToken(request,ENV),true);
  assert.equal(verifyOwnerToken(req("register-begin","wrong"),ENV),false);
});
test("Passkey sessions expire and are invalidated by rotating owner token",()=>{
  const initial=Date.UTC(2026,10,4,14,0,0);
  const cookie=issueSession(ENV,initial);
  assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  assert.match(cookie,/Max-Age=28800/);
  const signed=cookie.split(";")[0];
  const r=new Request(SITE+"/.netlify/functions/tradedesk-valr-balances",
    {headers:{"Cookie":signed}});
  assert.equal(validSession(r,ENV,initial+1000),true);
  assert.equal(validSession(r,ENV,initial+9*3600000),false);
  assert.equal(validSession(r,{TRADEDESK_OWNER_TOKEN:"X".repeat(48)},initial+1000),false);
  assert.match(clearSession(),/Max-Age=0/);
});
test("Requests from previews are blocked even with valid owner token",async()=>{
  const preview=req("register-begin",PASS,
    "https://preview--mrg-trade-desk.netlify.app/.netlify/functions/tradedesk-passkeys");
  assert.equal(allowedOrigin(preview),false);
  const result=await decode(await handlePasskeyRequest(preview,ENV,fakeStore()));
  assert.equal(result.status,403);
});
test("No registration without owner password",async()=>{
  const r=await decode(await handlePasskeyRequest(req("register-begin"),ENV,fakeStore()));
  assert.equal(r.status,401);
  assert.equal(r.body.error,"OWNER_PASSWORD_REQUIRED");
});
test("Status needs no owner password but cannot issue a passkey cookie",async()=>{
  const r=await decode(await handlePasskeyRequest(req("status"),ENV,fakeStore()));
  assert.equal(r.status,200);
  assert.equal(r.body.enrolled,false);
  assert.equal(r.body.signedIn,false);
  assert.equal(r.headers.get("set-cookie"),null);
});
test("Registration challenge is random and server-persisted, with no secret disclosed",async()=>{
  const store=fakeStore();
  const one=await decode(await handlePasskeyRequest(req("register-begin",PASS),ENV,store));
  const two=await decode(await handlePasskeyRequest(req("register-begin",PASS),ENV,store));
  assert.equal(one.status,200);
  assert.equal(two.status,200);
  assert.equal(typeof one.body.options.challenge,"string");
  assert.notEqual(one.body.options.challenge,two.body.options.challenge);
  assert.equal(one.body.options.rp.id,"mrg-trade-desk.netlify.app");
  assert.equal(one.body.options.authenticatorSelection.userVerification,"required");
  assert.ok(store.map.has("challenge/"+one.body.challengeId));
  assert.ok(!JSON.stringify(one.body).includes(PASS));
});
test("Login is unavailable until passkey is registered",async()=>{
  const r=await decode(await handlePasskeyRequest(req("login-begin"),ENV,fakeStore()));
  assert.equal(r.status,409);
  assert.equal(r.body.error,"NO_PASSKEY_ENROLLED");
});
test("An unrecognised or replayed challenge cannot register a passkey",async()=>{
  const r=await decode(await handlePasskeyRequest(new Request(
    SITE+"/.netlify/functions/tradedesk-passkeys",{
      method:"POST",headers:{"Origin":SITE,"Authorization":"Bearer "+PASS},
      body:JSON.stringify({action:"register-finish",challengeId:"00000000-0000-0000-0000-000000000000",credential:{}}),
    }),ENV,fakeStore()));
  assert.equal(r.status,400);
  assert.equal(r.body.error,"CHALLENGE_INVALID");
});
test("Logout clears the browser's secure cookie",async()=>{
  const r=await decode(await handlePasskeyRequest(req("logout"),ENV,fakeStore()));
  assert.equal(r.status,200);
  assert.match(r.headers.get("set-cookie"),/Max-Age=0/);
});

test("Only owner password can revoke passkeys; removal clears session",async()=>{
  const store=fakeStore();
  store.map.set("owner-passkeys",{
    data:[{id:"credential",publicKey:"abc",counter:0}],etag:"1",
  });
  const denied=await decode(await handlePasskeyRequest(req("reset-passkeys"),ENV,store));
  assert.equal(denied.status,401);
  assert.equal(store.map.get("owner-passkeys").data.length,1);
  const accepted=await decode(await handlePasskeyRequest(req("reset-passkeys",PASS),ENV,store));
  assert.equal(accepted.status,200);
  assert.equal(accepted.body.removed,true);
  assert.equal(store.map.get("owner-passkeys").data.length,0);
  assert.match(accepted.headers.get("set-cookie"),/Max-Age=0/);
});
