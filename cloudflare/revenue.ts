import { sessionIdentity } from "./auth.ts";
import { mailApi, type MailEnv } from "./mail.ts";
import { tradeDocuments } from "./trade-documents.ts";
import {
  calculate,
  emptyQuote,
  type Quote,
  type Line,
} from "../src/commercial.ts";
export interface Statement {
  bind(...values: any[]): Statement;
  first<T = any>(): Promise<T | null>;
  all<T = any>(): Promise<{ results: T[] }>;
  run(): Promise<any>;
}
export interface DB {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<any[]>;
}
export interface RevenueEnv extends MailEnv {
  DB: DB;
  ADMIN_TOKEN?: string;
  PLATFORM_COLLECTION_APPROVED?: string;
}
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const hash = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const text = (v: unknown, max = 2000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const date = (s: unknown) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const id = () => crypto.randomUUID();
export async function revenueApi(
  req: Request,
  env: RevenueEnv,
  path: string,
): Promise<Response> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  const session = await sessionIdentity(req, env);
  const admin =
    session?.role === "admin" ||
    (!!env.ADMIN_TOKEN &&
      token.length > 0 &&
      (await hash(token)) === (await hash(env.ADMIN_TOKEN)));
  const portal = path.startsWith("/api/trade/");
  const agent =
    session?.role === "trade" && portal
      ? { id: session.agent_id, name: session.name, email: session.email }
      : portal && token
        ? await env.DB.prepare(
            "SELECT id,name,email FROM commercial_agents WHERE token_hash=? AND active=1",
          )
            .bind(await hash(token))
            .first()
        : null;
  if (!admin && !agent)
    return response({ error: "Authorised access required" }, 401);
  const actor = admin ? "administrator" : `agent:${agent.id}`;
  const parts = path.split("/").filter(Boolean);
  const action = parts[2];
  const ref = decodeURIComponent(parts[3] || "");
  try {
    const requestOrigin = req.headers.get("origin");
    if (requestOrigin && requestOrigin !== new URL(req.url).origin)
      return response(
        { error: "Use the application to change booking records" },
        403,
      );
    let b: any = {};
    if (req.method === "POST") {
      const raw = await req.text();
      if (raw.length > 100000)
        return response({ error: "Request too large" }, 413);
      b = JSON.parse(raw);
    }
    if (action === "mail") {
      if (!admin)
        return response({ error: "Administrative access required" }, 403);
      return await mailApi(req, env, ref, b, actor);
    }
    const documentResult = await tradeDocuments(
      req,
      env.DB,
      action,
      ref,
      b,
      actor,
      agent?.id,
    );
    if (documentResult) return documentResult;
    const event = (reference: string, kind: string, payload: unknown) =>
      env.DB.prepare(
        "INSERT INTO commercial_events(id,reference,kind,actor,payload_json) VALUES(?,?,?,?,?)",
      ).bind(id(), reference, kind, actor, JSON.stringify(payload));
    if (portal) {
      if (action === "bookings" && req.method === "GET") {
        const rows = await env.DB.prepare(
          "SELECT b.reference,b.destination,b.start_date,b.num_guests,c.status,c.quote_json FROM bookings b JOIN booking_commercial c ON b.reference=c.reference WHERE c.agent_id=?",
        )
          .bind(agent.id)
          .all();
        return response({
          bookings: rows.results.map((r: any) => {
            const q = JSON.parse(r.quote_json);
            return {
              reference: r.reference,
              destination: r.destination,
              start_date: r.start_date,
              num_guests: r.num_guests,
              status: r.status,
              currency: q.currency,
              retailTotalCents: calculate(q).bookingValueCents,
              pricingStatus:
                q.lines.length || q.serviceFeeCents
                  ? "quoted"
                  : "awaiting_quote",
            };
          }),
        });
      }
      if (action === "enquiries" && req.method === "POST") {
        if (
          !text(b.travellerName) ||
          !text(b.destination) ||
          !Number.isInteger(b.guests) ||
          b.guests < 2 ||
          b.guests > 1000
        )
          throw Error(
            "Traveller, destination and group size (2–1,000) required",
          );
        if (b.startDate && !date(b.startDate))
          throw Error("Valid travel date required");
        const reference = `EKSA-${crypto.randomUUID().toUpperCase()}`;
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO bookings(reference,client_name,client_email,destination,num_guests,notes,start_date) VALUES(?,?,?,?,?,?,?)",
          ).bind(
            reference,
            text(b.travellerName),
            agent.email,
            text(b.destination),
            b.guests,
            text(b.notes),
            text(b.startDate) || null,
          ),
          env.DB.prepare(
            "INSERT INTO booking_commercial(reference,agent_id,paying_customer,booking_agent,traveller_name,communication_json,quote_json) VALUES(?,?,?,?,?,?,?)",
          ).bind(
            reference,
            agent.id,
            text(b.payingCustomer) || agent.name,
            agent.name,
            text(b.travellerName),
            JSON.stringify({
              mode: "operator",
              guestEmail: text(b.guestEmail),
              copyGuest: false,
              permissions: text(b.permissions),
            }),
            JSON.stringify(emptyQuote),
          ),
          event(reference, "originated", {
            agentId: agent.id,
            notes: text(b.notes),
          }),
        ]);
        return response({ reference, status: "enquiry" }, 201);
      }
      return response({ error: "Not found" }, 404);
    }
    if (action === "agents") {
      if (req.method === "GET")
        return response({
          agents: (
            await env.DB.prepare(
              "SELECT id,name,email,active FROM commercial_agents",
            ).all()
          ).results,
        });
      if (req.method === "POST" && b.command === "revoke") {
        if (!text(b.id)) throw Error("Operator reference required");
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE commercial_agents SET active=0 WHERE id=?",
          ).bind(b.id),
          env.DB.prepare("DELETE FROM access_sessions WHERE agent_id=?").bind(
            b.id,
          ),
        ]);
        return response({ ok: true });
      }
      if (req.method === "POST") {
        if (
          !text(b.name) ||
          !text(b.email) ||
          !text(b.token) ||
          b.token.length < 32
        )
          throw Error(
            "Name, email and a unique access key of at least 32 characters required",
          );
        const agentId = id();
        await env.DB.prepare(
          "INSERT INTO commercial_agents(id,name,email,token_hash) VALUES(?,?,?,?)",
        )
          .bind(agentId, text(b.name), text(b.email), await hash(b.token))
          .run();
        return response({ id: agentId }, 201);
      }
    }
    if (action === "suppliers") {
      if (req.method === "GET")
        return response({
          suppliers: (
            await env.DB.prepare("SELECT * FROM suppliers ORDER BY name").all()
          ).results,
          agreements: (
            await env.DB.prepare(
              "SELECT * FROM supplier_agreements ORDER BY created_at DESC",
            ).all()
          ).results,
        });
      if (req.method === "POST") {
        if (!text(b.name) || !["accommodation", "transport"].includes(b.type))
          throw Error("Name and supplier type required");
        const supplierId = id();
        await env.DB.prepare(
          "INSERT INTO suppliers(id,name,type,contact_email,location) VALUES(?,?,?,?,?)",
        )
          .bind(
            supplierId,
            text(b.name),
            b.type,
            text(b.email),
            text(b.location),
          )
          .run();
        return response({ id: supplierId }, 201);
      }
    }
    if (action === "agreements" && req.method === "POST") {
      const supplier = await env.DB.prepare(
        "SELECT id FROM suppliers WHERE id=?",
      )
        .bind(b.supplierId)
        .first();
      if (!supplier) throw Error("Supplier not found");
      const t = b.terms;
      if (
        !t ||
        !["gross", "net"].includes(t.rateBasis) ||
        !["percent", "fixed"].includes(t.commissionType)
      )
        throw Error("Rate basis and commission type required");
      if (
        !Number.isInteger(t.commissionBps) ||
        t.commissionBps < 0 ||
        t.commissionBps > 10000 ||
        !Number.isSafeInteger(t.fixedCommissionCents) ||
        t.fixedCommissionCents < 0
      )
        throw Error("Invalid commission");
      for (const k of [
        "commissionableItems",
        "nonCommissionableItems",
        "groupDiscounts",
        "vatTreatment",
        "cancellationRefund",
        "paymentResponsibilities",
        "commissionDeadline",
        "attributionProtection",
        "validFrom",
        "validTo",
      ])
        if (!text(t[k])) throw Error(`Agreement requires ${k}`);
      if (!date(t.validFrom) || !date(t.validTo) || t.validTo < t.validFrom)
        throw Error("Invalid agreement validity dates");
      if (
        b.state === "confirmed" &&
        (!text(b.evidenceReference) || !text(b.confirmedBy))
      )
        throw Error("Confirmation evidence and signatory required");
      const agreementId = id();
      await env.DB.prepare(
        `INSERT INTO supplier_agreements(id,supplier_id,version,state,terms_json,evidence_reference,confirmed_by) SELECT ?,?,COALESCE(MAX(version),0)+1,?,?,?,? FROM supplier_agreements WHERE supplier_id=?`,
      )
        .bind(
          agreementId,
          b.supplierId,
          b.state === "confirmed" ? "confirmed" : "proposed",
          JSON.stringify(t),
          text(b.evidenceReference),
          text(b.confirmedBy),
          b.supplierId,
        )
        .run();
      return response({ id: agreementId }, 201);
    }
    if (action === "bookings" && req.method === "GET") {
      if (!ref)
        return response({
          bookings: (
            await env.DB.prepare(
              "SELECT b.*, c.revision,c.agent_id,c.status AS commercial_status FROM bookings b LEFT JOIN booking_commercial c ON b.reference=c.reference ORDER BY b.created_at DESC LIMIT 500",
            ).all()
          ).results,
        });
      const booking = await env.DB.prepare(
        "SELECT * FROM bookings WHERE reference=?",
      )
        .bind(ref)
        .first();
      if (!booking) return response({ error: "Booking not found" }, 404);
      const commercial = await env.DB.prepare(
        "SELECT * FROM booking_commercial WHERE reference=?",
      )
        .bind(ref)
        .first();
      const receipts = (
        await env.DB.prepare(
          "SELECT * FROM commercial_receipts WHERE reference=? ORDER BY received_on",
        )
          .bind(ref)
          .all()
      ).results;
      const adjustments = (
        await env.DB.prepare(
          "SELECT * FROM earnings_adjustments WHERE reference=?",
        )
          .bind(ref)
          .all()
      ).results;
      return response({
        booking,
        commercial,
        receipts,
        adjustments,
        profit: calculate(
          commercial ? JSON.parse(commercial.quote_json) : emptyQuote,
          receipts,
          adjustments,
        ),
        events: (
          await env.DB.prepare(
            "SELECT * FROM commercial_events WHERE reference=? ORDER BY created_at,id",
          )
            .bind(ref)
            .all()
        ).results,
      });
    }
    if (action === "bookings" && ref && req.method === "POST") {
      const booking = await env.DB.prepare(
        "SELECT * FROM bookings WHERE reference=?",
      )
        .bind(ref)
        .first();
      if (!booking) return response({ error: "Booking not found" }, 404);
      const current = await env.DB.prepare(
        "SELECT * FROM booking_commercial WHERE reference=?",
      )
        .bind(ref)
        .first();
      if (current?.status === "completed")
        throw Error(
          "Completed booking is locked; record financial reversals and evidence separately",
        );
      if ((current?.revision || 0) !== b.revision)
        return response(
          { error: "Booking changed; reload before saving" },
          409,
        );
      const travelDate = text(b.startDate) || booking.start_date;
      if (["confirmed", "completed"].includes(b.status) && !date(travelDate))
        throw Error(
          "Confirm the travel start date before confirming a booking",
        );
      const q: Quote = b.quote;
      for (const l of q.lines as Line[]) {
        const agreement = await env.DB.prepare(
          "SELECT * FROM supplier_agreements WHERE id=? AND supplier_id=?",
        )
          .bind(l.agreementId, l.supplierId)
          .first();
        l.agreementConfirmed = agreement?.state === "confirmed";
        if (agreement) {
          const t = JSON.parse(agreement.terms_json);
          l.rateBasis = t.rateBasis;
          l.commissionType = t.commissionType;
          l.commissionBps = t.commissionBps;
          l.fixedCommissionCents = t.fixedCommissionCents;
          if (
            travelDate &&
            (travelDate < t.validFrom || travelDate > t.validTo)
          )
            throw Error("Agreement does not cover travel date");
        }
        if (l.agreementConfirmed && !date(l.commissionDueOn))
          throw Error("Commission due date required");
      }
      const existingReceipts = (
        await env.DB.prepare(
          "SELECT * FROM commercial_receipts WHERE reference=?",
        )
          .bind(ref)
          .all()
      ).results;
      if (existingReceipts.some((r: any) => r.currency !== q.currency))
        throw Error("Currency is locked after a financial transaction");
      if (
        existingReceipts.some(
          (r: any) => r.line_id && !q.lines.some((l) => l.id === r.line_id),
        )
      )
        throw Error("A line with financial transactions cannot be removed");
      const currentAdjustments = (
        await env.DB.prepare(
          "SELECT * FROM earnings_adjustments WHERE reference=?",
        )
          .bind(ref)
          .all()
      ).results;
      if (
        currentAdjustments.some(
          (a: any) =>
            a.currency !== q.currency ||
            (a.line_id !== "service_fee" &&
              !q.lines.some((l) => l.id === a.line_id)),
        )
      )
        throw Error(
          "Income with adjustments cannot be removed or moved to another currency",
        );
      const profit = calculate(q, existingReceipts, currentAdjustments);
      if (
        !["enquiry", "quoted", "confirmed", "completed", "cancelled"].includes(
          b.status,
        )
      )
        throw Error("Invalid status");
      if (
        ["confirmed", "completed"].includes(b.status) &&
        (!text(b.customerApproval) ||
          !text(b.supplierConfirmation) ||
          profit.warnings.length)
      )
        throw Error(
          "Confirmation requires approval, supplier confirmation and agreed profitable income",
        );
      if (
        ["confirmed", "completed"].includes(b.status) &&
        q.lines.some((l) => !l.supplierReference)
      )
        throw Error("Supplier booking references required");
      if (b.paymentModel !== "supplier_collects")
        throw Error(
          "Platform collection is disabled pending provider approval and financial controls",
        );
      const comm = b.communication;
      if (!comm || !["direct", "operator"].includes(comm.mode))
        throw Error("Communication permissions required");
      if (
        comm.mode === "direct" &&
        (!comm.copyGuest || !text(comm.guestEmail) || !text(comm.permissions))
      )
        throw Error(
          "Direct bookings require guest email, copying permission and guest copying enabled",
        );
      if (comm.mode === "operator" && !text(comm.permissions))
        throw Error("Operator communication permissions required");
      const agentId =
        b.agentId === undefined
          ? current?.agent_id || null
          : text(b.agentId) || null;
      if (
        agentId &&
        !(await env.DB.prepare(
          "SELECT id FROM commercial_agents WHERE id=? AND active=1",
        )
          .bind(agentId)
          .first())
      )
        throw Error("Registered active operator required");
      const args = [
        text(b.payingCustomer),
        text(b.bookingAgent),
        agentId,
        text(b.travellerName),
        JSON.stringify(comm),
        JSON.stringify(q),
        b.status,
        text(b.customerApproval),
        text(b.supplierConfirmation),
      ];
      if (!args[0] || !args[3])
        throw Error("Paying customer and traveller required");
      const payload = { ...b, quote: q };
      const statement = current
        ? env.DB.prepare(
            `UPDATE booking_commercial SET paying_customer=?,booking_agent=?,agent_id=?,traveller_name=?,communication_json=?,quote_json=?,status=?,customer_approval=?,supplier_confirmation=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE reference=? AND revision=?`,
          ).bind(...args, ref, b.revision)
        : env.DB.prepare(
            `INSERT INTO booking_commercial(paying_customer,booking_agent,agent_id,traveller_name,communication_json,quote_json,status,customer_approval,supplier_confirmation,reference) VALUES(?,?,?,?,?,?,?,?,?,?)`,
          ).bind(...args, ref);
      const audit = env.DB.prepare(
        "INSERT INTO commercial_events(id,reference,kind,actor,payload_json) SELECT ?,?,?,?,? WHERE changes()=1",
      ).bind(id(), ref, "commercial_revision", actor, JSON.stringify(payload));
      const results = await env.DB.batch([
        statement,
        audit,
        env.DB.prepare(
          "UPDATE bookings SET status=?,start_date=?,updated_at=CURRENT_TIMESTAMP WHERE reference=? AND changes()=1",
        ).bind(b.status, travelDate || null, ref),
      ]);
      if (!results[0].meta.changes)
        return response({ error: "Booking changed; reload" }, 409);
      return response({ ok: true, profit, revision: b.revision + 1 });
    }
    if (action === "adjustments" && req.method === "POST") {
      if (
        !text(b.id) ||
        !text(b.reference) ||
        !text(b.lineId) ||
        !text(b.evidenceReference) ||
        !text(b.reason) ||
        !["reversal", "restoration"].includes(b.kind) ||
        !Number.isSafeInteger(b.amountCents) ||
        b.amountCents <= 0
      )
        throw Error(
          "A unique transaction reference, income line, amount, reason and evidence are required",
        );
      const record = await env.DB.prepare(
        "SELECT quote_json FROM booking_commercial WHERE reference=?",
      )
        .bind(b.reference)
        .first();
      if (!record) throw Error("Saved commercial booking required");
      const quote = JSON.parse(record.quote_json);
      if (b.currency !== quote.currency)
        throw Error("Adjustment currency must match booking");
      if (
        b.lineId !== "service_fee" &&
        !quote.lines.some((l: Line) => l.id === b.lineId)
      )
        throw Error("Income line not found");
      const existing = (
        await env.DB.prepare(
          "SELECT * FROM earnings_adjustments WHERE reference=?",
        )
          .bind(b.reference)
          .all()
      ).results;
      calculate(
        quote,
        [],
        [
          ...existing,
          {
            line_id: b.lineId,
            kind: b.kind,
            amount_cents: b.amountCents,
            currency: b.currency,
          },
        ],
      );
      const baseProfit = calculate(quote);
      const entitlement =
        b.lineId === "service_fee"
          ? baseProfit.serviceFeeCents
          : baseProfit.lines.find((l) => l.id === b.lineId)!.entitlementCents;
      const guarded = env.DB.prepare(
        "INSERT INTO earnings_adjustments(id,reference,line_id,kind,amount_cents,currency,evidence_reference,reason,actor) SELECT ?,?,?,?,?,?,?,?,? WHERE (COALESCE((SELECT SUM(CASE WHEN kind='reversal' THEN amount_cents ELSE -amount_cents END) FROM earnings_adjustments WHERE reference=? AND line_id=? AND currency=?),0)+?) BETWEEN 0 AND ?",
      ).bind(
        b.id,
        b.reference,
        b.lineId,
        b.kind,
        b.amountCents,
        b.currency,
        b.evidenceReference,
        b.reason,
        actor,
        b.reference,
        b.lineId,
        b.currency,
        b.kind === "reversal" ? b.amountCents : -b.amountCents,
        entitlement,
      );
      const adjustmentResults = await env.DB.batch([
        guarded,
        env.DB.prepare(
          "INSERT INTO commercial_events(id,reference,kind,actor,payload_json) SELECT ?,?,?,?,? WHERE changes()=1",
        ).bind(
          id(),
          b.reference,
          "earnings_adjusted",
          actor,
          JSON.stringify(b),
        ),
      ]);
      if (!adjustmentResults[0].meta.changes)
        return response(
          { error: "Earnings changed; reload before recording the adjustment" },
          409,
        );
      return response({ ok: true }, 201);
    }
    if (action === "evidence" && req.method === "POST") {
      if (!text(b.reference) || !text(b.kind) || !text(b.evidenceReference))
        throw Error(
          "Booking, evidence type and document/message reference required",
        );
      await event(b.reference, text(b.kind, 80), {
        evidenceReference: text(b.evidenceReference),
        notes: text(b.notes),
      }).run();
      return response({ ok: true });
    }
    if (action === "receipts" && req.method === "POST") {
      if (
        !text(b.id) ||
        !text(b.evidenceReference) ||
        !date(b.receivedOn) ||
        !Number.isSafeInteger(b.amountCents) ||
        b.amountCents <= 0
      )
        throw Error("Receipt ID, amount, date and evidence required");
      if (
        b.receivedOn >
        new Date().toLocaleDateString("en-CA", {
          timeZone: "Africa/Johannesburg",
        })
      )
        throw Error("Record only cleared transactions dated today or earlier");
      const c = await env.DB.prepare(
        "SELECT quote_json FROM booking_commercial WHERE reference=?",
      )
        .bind(b.reference)
        .first();
      if (!c) throw Error("Commercial record required");
      const q = JSON.parse(c.quote_json);
      if (b.currency !== q.currency)
        throw Error("Receipt currency must match booking");
      if (
        [
          "commission",
          "commission_reversal",
          "markup",
          "markup_reversal",
        ].includes(b.kind) &&
        !q.lines.some(
          (l: Line) =>
            l.id === b.lineId &&
            l.agreementConfirmed &&
            l.incomeModel ===
              (b.kind.startsWith("commission") ? "commission" : "markup"),
        )
      )
        throw Error("Receipt must match an agreed income line");
      if (b.kind.startsWith("service_fee")) b.lineId = null;
      if (b.kind.startsWith("service_fee") && !q.serviceFeeApproval)
        throw Error("Approved service fee required");
      if (
        ![
          "commission",
          "service_fee",
          "markup",
          "commission_reversal",
          "service_fee_reversal",
          "markup_reversal",
          "direct_cost",
        ].includes(b.kind)
      )
        throw Error("Invalid receipt type");
      const ledger = (
        await env.DB.prepare(
          "SELECT * FROM commercial_receipts WHERE reference=?",
        )
          .bind(b.reference)
          .all()
      ).results;
      if (b.kind.endsWith("_reversal")) {
        const base = b.kind.replace("_reversal", "");
        const available = ledger
          .filter((r: any) => (r.line_id || null) === (b.lineId || null))
          .reduce(
            (n: number, r: any) =>
              n +
              (r.kind === base
                ? r.amount_cents
                : r.kind === b.kind
                  ? -r.amount_cents
                  : 0),
            0,
          );
        if (b.amountCents > available)
          throw Error("Reversal exceeds recorded income");
      }
      const prior = await env.DB.prepare(
        "SELECT * FROM commercial_receipts WHERE id=?",
      )
        .bind(b.id)
        .first();
      if (prior)
        return response(
          {
            error:
              "Receipt reference already recorded; use a new reference only for a different transaction",
          },
          409,
        );
      const isReversal = b.kind.endsWith("_reversal");
      const guard = isReversal
        ? " WHERE COALESCE((SELECT SUM(CASE WHEN kind=? THEN amount_cents WHEN kind=? THEN -amount_cents ELSE 0 END) FROM commercial_receipts WHERE reference=? AND COALESCE(line_id,'')=? AND currency=?),0)>=?"
        : "";
      const receiptStatement = env.DB.prepare(
        "INSERT INTO commercial_receipts(id,reference,line_id,kind,amount_cents,currency,evidence_reference,received_on,actor) SELECT ?,?,?,?,?,?,?,?,?" +
          guard,
      ).bind(
        b.id,
        b.reference,
        b.lineId || null,
        b.kind,
        b.amountCents,
        b.currency,
        b.evidenceReference,
        b.receivedOn,
        actor,
        ...(isReversal
          ? [
              b.kind.replace("_reversal", ""),
              b.kind,
              b.reference,
              b.lineId || "",
              b.currency,
              b.amountCents,
            ]
          : []),
      );
      const receiptResults = await env.DB.batch([
        receiptStatement,
        env.DB.prepare(
          "INSERT INTO commercial_events(id,reference,kind,actor,payload_json) SELECT ?,?,?,?,? WHERE changes()=1",
        ).bind(id(), b.reference, "receipt_recorded", actor, JSON.stringify(b)),
      ]);
      if (!receiptResults[0].meta.changes)
        return response(
          { error: "Receipts changed; reload before recording a reversal" },
          409,
        );
      return response({ ok: true }, 201);
    }
    if (action === "invoices") {
      if (req.method === "GET")
        return response({
          invoices: (
            await env.DB.prepare(
              "SELECT * FROM supplier_invoices ORDER BY due_on",
            ).all()
          ).results,
        });
      if (req.method === "POST") {
        if (
          !date(b.dueOn) ||
          !Number.isSafeInteger(b.amountCents) ||
          b.amountCents < 0 ||
          !Number.isSafeInteger(b.paidCents) ||
          b.paidCents < 0 ||
          b.paidCents > b.amountCents ||
          !text(b.evidenceReference)
        )
          throw Error("Invalid invoice or payment evidence");
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO supplier_invoices(id,reference,supplier_id,invoice_reference,amount_cents,currency,due_on,paid_cents,evidence_reference) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET paid_cents=excluded.paid_cents,evidence_reference=excluded.evidence_reference,updated_at=CURRENT_TIMESTAMP",
          ).bind(
            b.id || id(),
            b.reference,
            b.supplierId,
            text(b.invoiceReference),
            b.amountCents,
            b.currency,
            b.dueOn,
            b.paidCents,
            b.evidenceReference,
          ),
          event(b.reference, "supplier_invoice_recorded", b),
        ]);
        return response({ ok: true });
      }
    }
    if (action === "dashboard" && req.method === "GET") {
      const rows = (
        await env.DB.prepare(
          "SELECT b.reference,b.client_name,b.created_at,c.* FROM bookings b LEFT JOIN booking_commercial c ON b.reference=c.reference ORDER BY b.created_at",
        ).all()
      ).results;
      const receipts = (
        await env.DB.prepare("SELECT * FROM commercial_receipts").all()
      ).results;
      const allAdjustments = (
        await env.DB.prepare("SELECT * FROM earnings_adjustments").all()
      ).results;
      const bookings = rows.map((r: any) => ({
        reference: r.reference,
        status: r.status || "enquiry",
        customer: r.paying_customer || r.client_name,
        agent: r.booking_agent || "Direct",
        createdAt: r.created_at,
        confirmedCommercial: !!r.customer_approval && !!r.supplier_confirmation,
        profit: calculate(
          r.quote_json ? JSON.parse(r.quote_json) : emptyQuote,
          receipts.filter((x: any) => x.reference === r.reference),
          allAdjustments.filter((x: any) => x.reference === r.reference),
        ),
      }));
      const reminders = bookings
        .filter(
          (b: any) =>
            ["confirmed", "completed", "cancelled"].includes(b.status) &&
            b.confirmedCommercial,
        )
        .flatMap((b: any) =>
          b.profit.lines
            .filter(
              (l: any) =>
                l.outstandingCents > 0 &&
                l.commissionDueOn < new Date().toISOString().slice(0, 10),
            )
            .map((l: any) => ({
              reference: b.reference,
              supplierId: l.supplierId,
              dueOn: l.commissionDueOn,
              amountCents: l.outstandingCents,
              currency: b.profit.currency,
              subject: `Commission overdue: ${b.reference}`,
              body: `Please reconcile the outstanding commission of ${(l.outstandingCents / 100).toFixed(2)} ${b.profit.currency} for Easy Kosher SA reference ${b.reference}, supplier reference ${l.supplierReference}. Due date: ${l.commissionDueOn}.`,
            })),
        );
      return response({
        enquiries: rows.length,
        confirmed: bookings.filter((b: any) =>
          ["confirmed", "completed"].includes(b.status),
        ).length,
        bookings,
        reminders,
        receipts,
        invoices: (
          await env.DB.prepare("SELECT * FROM supplier_invoices").all()
        ).results,
      });
    }
    return response({ error: "Not found" }, 404);
  } catch (e) {
    return response(
      { error: e instanceof Error ? e.message : "Invalid request" },
      400,
    );
  }
}
