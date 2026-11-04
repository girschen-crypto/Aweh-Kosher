/**
 * TradeDesk VALR read-only gateway. Keys live in Netlify Functions environment vars only.
 * No order/transfer/withdraw endpoints and no credential interpolation from the client.
 * Owner access is a separate, long, server-side secret and is never persisted by the UI.
 */
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { validSession } from "./_shared/tradedesk-passkey-session.mjs";

const PATH = "/v1/account/balances";
const VALR_ENDPOINT = "https://api.valr.com" + PATH;
const HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'",
  "Vary": "Authorization",
});

export function signValr(secret, timestamp, method, path, body = "", subaccountId = "") {
  return createHmac("sha512", secret)
    .update(String(timestamp) + method.toUpperCase() + path + body + subaccountId)
    .digest("hex");
}

function reply(code, data) {
  return new Response(JSON.stringify(data), { status: code, headers: HEADERS });
}

function matchesSecret(incoming, expected) {
  if (typeof incoming !== "string" || typeof expected !== "string" || !incoming || !expected) return false;
  const incomingHash = createHash("sha256").update(incoming).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(incomingHash, expectedHash);
}

function safeDecimal(value) {
  const s = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : "";
  return /^-?\d+(?:\.\d+)?$/.test(s) && s.length <= 80 ? s : null;
}

export async function handleRequest(request, env = process.env, fetchFn = fetch, now = Date.now) {
  if (request.method !== "POST") return reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  // Do not allow other web origins to read this owner's data.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return reply(403, { ok: false, error: "ORIGIN_REJECTED" });

  const apiKey = env.TRADEDESK_VALR_API_KEY;
  const apiSecret = env.TRADEDESK_VALR_API_SECRET;
  const ownerToken = env.TRADEDESK_OWNER_TOKEN;

  if (!ownerToken || ownerToken.length < 32 || !apiKey || !apiSecret)
    return reply(503, { ok: false, error: "NOT_CONFIGURED", message: "Secure VALR connection has not been configured." });
  if (!/^[A-Za-z0-9]{64}$/.test(apiKey) || !/^[A-Za-z0-9]{64}$/.test(apiSecret))
    return reply(503, { ok: false, error: "INVALID_SERVER_CONFIGURATION" });

  const auth = request.headers.get("authorization") || "";
  const suppliedToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!matchesSecret(suppliedToken, ownerToken) && !validSession(request, env))
    return reply(401, { ok: false, error: "ACCESS_DENIED", message: "Owner access password is incorrect." });

  const timestamp = String(now());
  const signature = signValr(apiSecret, timestamp, "GET", PATH);
  try {
    const response = await fetchFn(VALR_ENDPOINT, {
      method: "GET",
      headers: {
        "X-VALR-API-KEY": apiKey,
        "X-VALR-SIGNATURE": signature,
        "X-VALR-TIMESTAMP": timestamp,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        // Diagnose using a SECOND read-only endpoint. Never return upstream error bodies,
        // secrets, headers, account IDs or any permissions details to the browser/logs.
        let keyCheck = "UNAVAILABLE";
        try {
          const checkPath = "/v1/account/api-keys/current";
          const checkTimestamp = String(now());
          const checkResponse = await fetchFn("https://api.valr.com" + checkPath, {
            method: "GET",
            headers: {
              "X-VALR-API-KEY": apiKey,
              "X-VALR-SIGNATURE": signValr(apiSecret, checkTimestamp, "GET", checkPath),
              "X-VALR-TIMESTAMP": checkTimestamp,
              "Accept": "application/json",
              "Content-Type": "application/json",
            },
            redirect: "error", cache: "no-store",
            signal: AbortSignal.timeout(10000),
          });
          keyCheck = checkResponse.ok ? "ACCEPTED" : 
            checkResponse.status === 401 ? "REJECTED" :
            checkResponse.status === 403 ? "RESTRICTED" : "UNAVAILABLE";
        } catch (_) { /* Fail closed. VALR and Netlify secrets stay server-side. */ }
        // Verify whether the two Netlify values were entered in reverse.
        // The alternative request remains a READ-ONLY API-key information GET.
        if (response.status === 401 && keyCheck === "REJECTED") {
          try {
            const swappedPath = "/v1/account/api-keys/current";
            const swappedTime = String(now());
            const swapped = await fetchFn("https://api.valr.com" + swappedPath, {
              method: "GET",
              headers: {
                "X-VALR-API-KEY": apiSecret,
                "X-VALR-SIGNATURE": signValr(apiKey, swappedTime, "GET", swappedPath),
                "X-VALR-TIMESTAMP": swappedTime,
                "Accept": "application/json",
                "Content-Type": "application/json",
              },
              redirect: "error", cache: "no-store",
              signal: AbortSignal.timeout(10000),
            });
            if (swapped.ok) keyCheck = "SWAPPED";
          } catch (_) { /* Fail closed, no upstream bodies or secrets. */ }
        }
        const code = keyCheck === "SWAPPED" ? "VALR_CREDENTIALS_SWAPPED" :
          keyCheck === "ACCEPTED" ? "VALR_BALANCE_ACCESS_DENIED" :
          response.status === 403 ? "VALR_ACCESS_RESTRICTED" : "VALR_AUTH_FAILED";
        // Safe operational codes only. Never log response bodies or sensitive values.
        console.info("TradeDesk VALR diagnostics", { balanceHttpStatus: response.status, keyCheck });
        return reply(502, { ok: false, error: code, valrHttpStatus: response.status, keyCheck });
      }
      if (response.status === 429)
        return reply(503, { ok: false, error: "VALR_RATE_LIMITED" });
      return reply(502, { ok: false, error: "VALR_UNAVAILABLE", valrHttpStatus: response.status });
    }

    const body = await response.json();
    if (!Array.isArray(body)) return reply(502, { ok: false, error: "INVALID_VALR_RESPONSE" });
    const balances = body.filter(b => b && typeof b === "object" && /^[A-Z0-9]{2,15}$/.test(b.currency || ""))
      .slice(0, 200)
      .map(b => ({
        currency: b.currency,
        total: safeDecimal(b.total),
        available: safeDecimal(b.available),
        reserved: safeDecimal(b.reserved),
      }));
    return reply(200, {
      ok: true,
      provider: "VALR",
      account: "API key scope (use TradeDesk sub-account key)",
      mode: "READ_ONLY",
      timestamp: new Date(Number(timestamp)).toISOString(),
      balances,
    });
  } catch (_) {
    return reply(502, { ok: false, error: "VALR_REQUEST_FAILED", message: "Could not read VALR balances." });
  }
}

export default async function (request) {
  return handleRequest(request);
}
