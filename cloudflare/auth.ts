import type { DB } from "./revenue.ts";
export type AuthEnv = { DB: DB; ADMIN_TOKEN?: string };
export const digest = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const cookieName = (req: Request) =>
  new URL(req.url).protocol === "https:"
    ? "__Host-eksa-session"
    : "eksa_session";
const sessionToken = (req: Request) =>
  req.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName(req) + "="))
    ?.slice(cookieName(req).length + 1) || "";
export async function sessionIdentity(req: Request, env: AuthEnv) {
  const value = sessionToken(req);
  if (!value) return null;
  return env.DB.prepare(
    "SELECT s.role,s.agent_id,a.name,a.email FROM access_sessions s LEFT JOIN commercial_agents a ON a.id=s.agent_id WHERE s.token_hash=? AND s.expires_at>? AND (s.role='admin' OR a.active=1)",
  )
    .bind(await digest(value), new Date().toISOString())
    .first();
}
const json = (data: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(cookie ? { "set-cookie": cookie } : {}),
    },
  });
export async function authApi(req: Request, env: AuthEnv) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    return json({ error: "Sign in from the application" }, 403);
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  if (req.method === "GET") {
    const identity = await sessionIdentity(req, env);
    return identity
      ? json({ role: identity.role, name: identity.name || "Administrator" })
      : json({ error: "Please sign in" }, 401);
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!req.headers.get("content-type")?.includes("application/json"))
    return json({ error: "JSON request required" }, 415);
  const raw = await req.text();
  if (raw.length > 4096) return json({ error: "Request too large" }, 413);
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid sign-in request" }, 400);
  }
  if (body?.command === "logout") {
    const token = sessionToken(req);
    if (token)
      await env.DB.prepare("DELETE FROM access_sessions WHERE token_hash=?")
        .bind(await digest(token))
        .run();
    return json(
      { ok: true },
      200,
      `${cookieName(req)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
    );
  }
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const bucket = `login:${ip}:${Math.floor(Date.now() / 600000)}`;
  await env.DB.prepare(
    "INSERT INTO usage_limits(limit_key,count) VALUES(?,1) ON CONFLICT(limit_key) DO UPDATE SET count=count+1",
  )
    .bind(bucket)
    .run();
  const count = await env.DB.prepare(
    "SELECT count FROM usage_limits WHERE limit_key=?",
  )
    .bind(bucket)
    .first();
  if (count.count > 20)
    return json(
      { error: "Too many sign-in attempts. Try again in ten minutes." },
      429,
    );
  const key = typeof body?.accessKey === "string" ? body.accessKey : "";
  if (!key) return json({ error: "Enter your access code" }, 400);
  let role = "trade",
    agentId: string | null = null;
  if (
    body.portal !== "trade" &&
    env.ADMIN_TOKEN &&
    (await digest(key)) === (await digest(env.ADMIN_TOKEN))
  )
    role = "admin";
  else {
    const a = await env.DB.prepare(
      "SELECT id FROM commercial_agents WHERE token_hash=? AND active=1",
    )
      .bind(await digest(key))
      .first();
    if (!a || body.portal !== "trade")
      return json({ error: "Access code not recognised" }, 401);
    agentId = a.id;
  }
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expires = new Date(Date.now() + 8 * 3600000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM access_sessions WHERE expires_at<=?").bind(
      new Date().toISOString(),
    ),
    env.DB.prepare(
      "INSERT INTO access_sessions(token_hash,role,agent_id,expires_at) VALUES(?,?,?,?)",
    ).bind(await digest(token), role, agentId, expires),
  ]);
  return json(
    { ok: true, role, expiresAt: expires },
    200,
    `${cookieName(req)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`,
  );
}
