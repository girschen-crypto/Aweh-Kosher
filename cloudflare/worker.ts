import { authApi } from "./auth.ts";
import { emptyQuote } from "../src/commercial.ts";
import { revenueApi, type DB } from "./revenue.ts";
interface Env {
  DB: DB;
  ASSETS: { fetch(req: Request): Promise<Response> };
  APP_ORIGIN?: string;
  ADMIN_TOKEN?: string;
  EMAIL_BRIDGE_URL?: string;
  EMAIL_BRIDGE_TOKEN?: string;
}

const BASE_JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function allowedOriginValue(req: Request, env: Env) {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  const configured = env.APP_ORIGIN?.trim();
  if (!configured) return null;
  return origin === configured ? origin : null;
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = allowedOriginValue(req, env);
  return origin
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
        vary: "Origin",
      }
    : {};
}

function json(req: Request, env: Env, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_JSON_HEADERS, ...corsHeaders(req, env) },
  });
}

function clientIp(req: Request) {
  return req.headers.get("CF-Connecting-IP") || "unknown";
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function consumeDailyQuota(
  env: Env,
  req: Request,
  action: string,
  max: number,
) {
  const key = `${action}:${clientIp(req)}:${todayUtc()}`;
  await env.DB.prepare(
    `INSERT INTO usage_limits (limit_key, count, updated_at)
     VALUES (?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(limit_key) DO UPDATE SET count = count + 1, updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(key)
    .run();

  const row = await env.DB.prepare(
    "SELECT count FROM usage_limits WHERE limit_key = ?",
  )
    .bind(key)
    .first<{ count: number }>();

  return (row?.count ?? max + 1) <= max;
}

function requestOriginAllowed(req: Request, env: Env) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return !!allowedOriginValue(req, env);
}

function cleanText(value: unknown, max = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function makeReference() {
  return `EKSA-${crypto.randomUUID().toUpperCase()}`;
}

async function getTours(req: Request, env: Env) {
  const result = await env.DB.prepare(
    `SELECT id, title, destination, description, duration_days, pricing_mode,
            price_per_person, currency, image_url, highlights, kosher_available
     FROM tours
     WHERE status = 'active'
     ORDER BY created_at DESC`,
  ).all();

  return json(req, env, { tours: result.results ?? [] });
}

async function createEnquiry(req: Request, env: Env) {
  if (!requestOriginAllowed(req, env))
    return new Response("Forbidden", { status: 403 });
  if (!(await consumeDailyQuota(env, req, "enquiry", 10))) {
    return json(req, env, { error: "Daily enquiry limit reached" }, 429);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 16_384)
    return json(req, env, { error: "Request too large" }, 413);

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 16384)
      return json(req, env, { error: "Request too large" }, 413);
    body = JSON.parse(raw);
    if (!body || Array.isArray(body) || typeof body !== "object")
      return json(req, env, { error: "Invalid enquiry" }, 400);
  } catch {
    return json(req, env, { error: "Invalid JSON" }, 400);
  }

  const clientName = cleanText(body.client_name, 120);
  const clientEmail = cleanText(body.client_email, 160).toLowerCase();
  const clientPhone = cleanText(body.client_phone, 50);
  const destination = cleanText(body.destination, 160);
  const startDate = cleanText(body.start_date, 20);
  const notes = cleanText(body.notes, 3000);
  const tourId = cleanText(body.tour_id, 80) || null;
  const numGuests = Number(body.num_guests ?? 2);
  if (!Number.isInteger(numGuests) || numGuests < 1 || numGuests > 1000)
    return json(
      req,
      env,
      { error: "Enter a group size between 1 and 1,000" },
      400,
    );
  if (
    startDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      Number.isNaN(Date.parse(startDate)) ||
      new Date(startDate).toISOString().slice(0, 10) !== startDate)
  )
    return json(req, env, { error: "Enter a valid travel date" }, 400);
  const consent = body.copy_guest_consent === true;

  if (!clientName || !clientEmail || !validEmail(clientEmail)) {
    return json(
      req,
      env,
      { error: "Name and a valid email address are required" },
      400,
    );
  }

  if (!destination && !tourId) {
    return json(
      req,
      env,
      { error: "Please select a tour or enter a destination" },
      400,
    );
  }

  let tourTitle: string | null = null;
  if (tourId) {
    const tour = await env.DB.prepare(
      "SELECT title FROM tours WHERE id = ? AND status = 'active'",
    )
      .bind(tourId)
      .first<{ title: string }>();
    if (!tour)
      return json(req, env, { error: "Selected tour was not found" }, 400);
    tourTitle = tour.title;
  }

  let reference = makeReference();
  for (let attempt = 0; attempt < 5; attempt++) {
    const exists = await env.DB.prepare(
      "SELECT 1 AS found FROM bookings WHERE reference = ?",
    )
      .bind(reference)
      .first();
    if (!exists) break;
    reference = makeReference();
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO bookings
      (reference, client_name, client_email, client_phone, tour_id, tour_title,
       destination, start_date, num_guests, currency, payment_status,
       commission_status, supplier_paid, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZAR', 'unpaid', 'owed', 0, 'enquiry', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).bind(
      reference,
      clientName,
      clientEmail,
      clientPhone || null,
      tourId,
      tourTitle,
      destination || null,
      startDate || null,
      numGuests,
      notes || null,
    ),
    env.DB.prepare(
      "INSERT INTO booking_commercial(reference,paying_customer,traveller_name,communication_json,quote_json) VALUES(?,?,?,?,?)",
    ).bind(
      reference,
      clientName,
      clientName,
      JSON.stringify({
        mode: "direct",
        guestEmail: clientEmail,
        copyGuest: consent,
        permissions: consent
          ? "Guest authorised copying in the public enquiry on " +
            new Date().toISOString()
          : "",
      }),
      JSON.stringify(emptyQuote),
    ),
    env.DB.prepare(
      "INSERT INTO commercial_events(id,reference,kind,actor,payload_json) VALUES(?,?,?,?,?)",
    ).bind(
      crypto.randomUUID(),
      reference,
      "originated",
      "public_enquiry",
      JSON.stringify({
        source: "public_enquiry",
        destination,
        tourId,
        createdAt: new Date().toISOString(),
        copyGuestConsent: consent,
      }),
    ),
  ]);

  return json(
    req,
    env,
    {
      ok: true,
      reference,
      status: "enquiry",
      message: "Your Easy Kosher SA enquiry has been received.",
    },
    201,
  );
}

async function handleApi(req: Request, env: Env, path: string) {
  try {
    if (req.method === "OPTIONS") {
      if (!requestOriginAllowed(req, env))
        return new Response("Forbidden", { status: 403 });
      return new Response(null, {
        status: 204,
        headers: corsHeaders(req, env),
      });
    }
    if (path === "/api/auth/session") return authApi(req, env);
    if (path.startsWith("/api/admin/") || path.startsWith("/api/trade/"))
      return revenueApi(req, env, path);
    if (path === "/api/health" && req.method === "GET") {
      return json(req, env, {
        ok: true,
        service: "travel-aweh",
        platform: "cloudflare",
      });
    }
    if (path === "/api/tours" && req.method === "GET")
      return getTours(req, env);
    if (path === "/api/enquiries" && req.method === "POST")
      return createEnquiry(req, env);
    return json(req, env, { error: "Not found" }, 404);
  } catch (error) {
    console.error("Easy Kosher SA Worker error", error);
    return json(req, env, { error: "Service temporarily unavailable" }, 503);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/"))
      return handleApi(req, env, url.pathname);
    return env.ASSETS.fetch(req);
  },
};
