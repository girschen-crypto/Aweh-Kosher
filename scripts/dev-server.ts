// Development only: disposable data and credentials are never bundled into the Worker.
import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../cloudflare/worker.ts";
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=ON");
for (const name of readdirSync(new URL("../migrations/", import.meta.url))
  .filter((x) => x.endsWith(".sql"))
  .sort())
  db.exec(
    readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
  );
const prepare = (sql: string) => {
  let args: any[] = [];
  const stmt = {
    bind(...values: any[]) {
      args = values;
      return stmt;
    },
    async first() {
      return db.prepare(sql).get(...args) || null;
    },
    async all() {
      return { results: db.prepare(sql).all(...args) };
    },
    async run() {
      return {
        meta: { changes: Number(db.prepare(sql).run(...args).changes) },
      };
    },
  };
  return stmt;
};
const DB = {
  prepare,
  async batch(statements: any[]) {
    db.exec("BEGIN");
    try {
      const results = [];
      for (const s of statements) results.push(await s.run());
      db.exec("COMMIT");
      return results;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },
};
const demoToken = "demo-only-access-8679";
const tradeDemoToken = "demo-only-trade-access-8679";
const demoTradeHash = Array.from(
  new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(tradeDemoToken),
    ),
  ),
)
  .map((x) => x.toString(16).padStart(2, "0"))
  .join("");
db.prepare(
  "INSERT INTO commercial_agents(id,name,email,token_hash) VALUES(?,?,?,?)",
).run(
  "demo-operator",
  "Demo Tour Operator",
  "operator@example.test",
  demoTradeHash,
);
const portFlag = process.argv.indexOf("--port");
const port = Number(
  portFlag >= 0 ? process.argv[portFlag + 1] : process.env.PORT || 5173,
);
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "spa",
});
const server = createHttpServer(async (req, res) => {
  if (req.url?.startsWith("/api/")) {
    if (req.url === "/api/development-runtime") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          demo: true,
          accessCode: demoToken,
          tradeAccessCode: tradeDemoToken,
        }),
      );
      return;
    }
    const origin = `http://${req.headers.host}`;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
        if (chunks.reduce((n, c) => n + c.length, 0) > 120000) {
          res.writeHead(413);
          res.end("Request too large");
          return;
        }
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers))
        if (value)
          headers.set(name, Array.isArray(value) ? value.join(",") : value);
      const request = new Request(origin + req.url, {
        method: req.method,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await worker.fetch(request, {
        DB,
        ADMIN_TOKEN: demoToken,
        APP_ORIGIN: origin,
        ASSETS: {
          async fetch() {
            return new Response("Not found", { status: 404 });
          },
        },
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Local server error",
        }),
      );
    }
    return;
  }
  vite.middlewares(req, res);
});
server.listen(port, "0.0.0.0", () =>
  console.log(`Easy Kosher SA disposable local preview on port ${port}`),
);
