/**
 * One-owner, balance-read-only passkey sessions.
 * Cookie never conveys VALR API permissions. Owner token is the signing secret,
 * so rotating it automatically invalidates previously issued sessions.
 */
import { createHmac, createHash, timingSafeEqual, randomBytes } from "node:crypto";

export const COOKIE_NAME = "__Host-td-balance";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const ORIGIN = "https://mrg-trade-desk.netlify.app";

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function verifyOwnerToken(request, env = process.env) {
  const expected = env.TRADEDESK_OWNER_TOKEN;
  if (!expected || expected.length < 32) return false;
  const auth = request.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") && safeEqual(auth.slice(7), expected);
}

function hmac(payload, secret) {
  return createHmac("sha256", secret).update("tradedesk-balance-passkey-session-v1:" + payload).digest("base64url");
}

export function issueSession(env = process.env, issuedAt = Date.now()) {
  const secret = env.TRADEDESK_OWNER_TOKEN;
  if (!secret || secret.length < 32) throw new Error("Owner secret missing");
  const payload = Buffer.from(JSON.stringify({
    aud: "tradedesk-valr-balance-read",
    exp: Math.floor(issuedAt / 1000) + SESSION_TTL_SECONDS,
    n: randomBytes(16).toString("base64url"),
  })).toString("base64url");
  const signed = payload + "." + hmac(payload, secret);
  return COOKIE_NAME + "=" + signed +
    "; Path=/; Max-Age=" + SESSION_TTL_SECONDS +
    "; HttpOnly; Secure; SameSite=Strict";
}

export function clearSession() {
  return COOKIE_NAME + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict";
}

export function validSession(request, env = process.env, at = Date.now()) {
  const secret = env.TRADEDESK_OWNER_TOKEN;
  if (!secret || secret.length < 32) return false;
  const raw = request.headers.get("cookie") || "";
  const value = raw.split(";").map(s => s.trim())
    .filter(s => s.startsWith(COOKIE_NAME + "="))[0]?.slice(COOKIE_NAME.length + 1);
  if (!value || value.length > 1200) return false;
  const [payload, sig, other] = value.split(".");
  if (!payload || !sig || other || !safeEqual(sig, hmac(payload, secret))) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims.aud === "tradedesk-valr-balance-read" &&
      Number.isSafeInteger(claims.exp) &&
      claims.exp > Math.floor(at / 1000) &&
      claims.exp <= Math.floor(at / 1000) + SESSION_TTL_SECONDS;
  } catch { return false; }
}

export function allowedOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  return url.origin === ORIGIN &&
    (!origin || origin === ORIGIN) &&
    (!request.headers.get("sec-fetch-site") ||
      ["same-origin","none"].includes(request.headers.get("sec-fetch-site")));
}

export const SITE_ORIGIN = ORIGIN;
export const SITE_RPID = "mrg-trade-desk.netlify.app";
