import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { calculate, emptyQuote } from "../src/commercial.ts";
import { revenueApi } from "../cloudflare/revenue.ts";
const line = {
  id: "l1",
  category: "accommodation",
  supplierId: "s1",
  agreementId: "a1",
  agreementConfirmed: true,
  rateBasis: "gross",
  incomeModel: "commission",
  sellingCents: 100000,
  supplierCostCents: 100000,
  commissionableCents: 80000,
  commissionType: "percent",
  commissionBps: 1000,
  fixedCommissionCents: 0,
  commissionDueOn: "2026-10-01",
  description: "Hotel",
  supplierReference: "H-1",
} as const;
const quote = () => ({ ...structuredClone(emptyQuote), lines: [{ ...line }] });
test("Booking value, entitlement, supplier liability and profit are distinct", () => {
  const q = quote();
  q.processingCents = 100;
  q.otherDirectCents = 500;
  const p = calculate(q);
  assert.equal(p.bookingValueCents, 100000);
  assert.equal(p.grossRevenueCents, 8000);
  assert.equal(p.supplierCostCents, 92000);
  assert.equal(p.contributionCents, 7400);
});
test("Unconfirmed 10% proposals generate no income", () => {
  const q = quote();
  q.lines[0].agreementConfirmed = false;
  assert.equal(calculate(q).grossRevenueCents, 0);
  assert.ok(calculate(q).warnings.length);
});
test("Net markup is not also counted as commission", () => {
  const q: any = quote();
  Object.assign(q.lines[0], {
    rateBasis: "net",
    incomeModel: "markup",
    supplierCostCents: 85000,
  });
  const p = calculate(q);
  assert.equal(p.grossRevenueCents, 15000);
  assert.equal(p.commissionDueCents, 0);
});
test("Fixed commission and non-commissionable exclusions", () => {
  const q: any = quote();
  q.lines[0].commissionType = "fixed";
  q.lines[0].fixedCommissionCents = 5000;
  assert.equal(calculate(q).grossRevenueCents, 5000);
});
test("Customer refunds are tracking entries; only earnings reversal reduces revenue", () => {
  const q = quote();
  q.customerRefundCents = 10000;
  q.supplierRefundCents = 9000;
  q.revenueReversalCents = 1000;
  assert.equal(calculate(q).netRevenueCents, 7000);
});
test("Partial receipts and reversal reconcile outstanding commission", () => {
  const p = calculate(quote(), [
    { line_id: "l1", kind: "commission", amount_cents: 5000, currency: "ZAR" },
    {
      line_id: "l1",
      kind: "commission_reversal",
      amount_cents: 1000,
      currency: "ZAR",
    },
  ]);
  assert.equal(p.commissionCollectedCents, 4000);
  assert.equal(p.commissionOutstandingCents, 4000);
});
test("Currencies never mix", () =>
  assert.equal(
    calculate(quote(), [
      {
        line_id: "l1",
        kind: "commission",
        amount_cents: 5000,
        currency: "USD",
      },
    ]).actualIncomeCents,
    0,
  ));
test("Unapproved service fees excluded", () => {
  const q = quote();
  q.serviceFeeCents = 500;
  assert.equal(calculate(q).serviceFeeCents, 0);
  q.serviceFeeApproval = "accepted message";
  assert.equal(calculate(q).serviceFeeCents, 500);
});
test("Reject negative, fractional, invalid base and duplicated lines", () => {
  for (const val of [-1, 0.5, NaN]) {
    const q = quote();
    q.processingCents = val;
    assert.throws(() => calculate(q));
  }
  const q = quote();
  q.lines[0].commissionableCents = 100001;
  assert.throws(() => calculate(q));
  const q2 = quote();
  q2.lines.push({ ...line });
  assert.throws(() => calculate(q2));
});
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const f of [
    "0001_init.sql",
    "0002_commercial.sql",
    "0003_trade_documents.sql",
    "0004_mail_outbox.sql",
  ])
    sqlite.exec(
      readFileSync(new URL("../migrations/" + f, import.meta.url), "utf8"),
    );
  const prepare = (sql: string) => {
    let args: any[] = [];
    const stmt = {
      bind(...a: any[]) {
        args = a;
        return stmt;
      },
      async first() {
        return sqlite.prepare(sql).get(...args) || null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...args) };
      },
      async run() {
        const result = sqlite.prepare(sql).run(...args);
        return { meta: { changes: Number(result.changes) } };
      },
    };
    return stmt;
  };
  return {
    sqlite,
    DB: {
      prepare,
      async batch(stmts: any[]) {
        sqlite.exec("BEGIN");
        try {
          const r = [];
          for (const s of stmts) r.push(await s.run());
          sqlite.exec("COMMIT");
          return r;
        } catch (e) {
          sqlite.exec("ROLLBACK");
          throw e;
        }
      },
    },
  };
}
const adminToken = "test-only-administrator-secret-123456789";
function request(path: string, body?: any, token = adminToken) {
  return new Request("https://example.test/api/admin/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
test("API gates, agreement verification, receipt idempotency, audit immutability and completion", async () => {
  const { DB, sqlite } = database();
  const env = { DB, ADMIN_TOKEN: adminToken };
  const call = async (path: string, body?: any) => {
    const r = await revenueApi(request(path, body), env, "/api/admin/" + path);
    return { status: r.status, body: await r.json() };
  };
  assert.equal(
    (
      await revenueApi(
        request("dashboard", undefined, "bad"),
        env,
        "/api/admin/dashboard",
      )
    ).status,
    401,
  );
  assert.equal(
    (await revenueApi(request("dashboard"), { DB }, "/api/admin/dashboard"))
      .status,
    401,
  );
  sqlite.exec(
    "INSERT INTO suppliers(id,name,type) VALUES('s1','Hotel','accommodation'); INSERT INTO bookings(reference,client_name,client_email,destination) VALUES('EKSA-1','Guest','guest@example.test','Cape Town');",
  );
  const terms = {
    rateBasis: "gross",
    commissionType: "percent",
    commissionBps: 1000,
    fixedCommissionCents: 0,
    validFrom: "2026-01-01",
    validTo: "2027-12-31",
    commissionableItems: "Rooms",
    nonCommissionableItems: "Meals",
    groupDiscounts: "Per quote",
    vatTreatment: "Ex VAT",
    cancellationRefund: "Per accepted quote",
    paymentResponsibilities: "Customer pays hotel",
    commissionDeadline: "Within 7 days",
    attributionProtection:
      "All originated bookings retain reference and agreed commission",
  };
  assert.equal(
    (await call("agreements", { supplierId: "s1", state: "confirmed", terms }))
      .status,
    400,
  );
  const agreement = await call("agreements", {
    supplierId: "s1",
    state: "confirmed",
    terms,
    evidenceReference: "signed.pdf",
    confirmedBy: "Hotel GM",
  });
  assert.equal(agreement.status, 201);
  const q = quote();
  q.lines[0].agreementId = agreement.body.id;
  q.lines[0].commissionBps = 10000;
  const record: any = {
    revision: 0,
    payingCustomer: "Guest",
    travellerName: "Guest",
    bookingAgent: "",
    status: "confirmed",
    paymentModel: "supplier_collects",
    customerApproval: "approval-email",
    supplierConfirmation: "hotel-email",
    communication: {
      mode: "direct",
      guestEmail: "guest@example.test",
      copyGuest: true,
      permissions: "Guest authorised email copying",
    },
    quote: q,
  };
  const saved = await call("bookings/EKSA-1", record);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.profit.grossRevenueCents, 8000);
  assert.equal((await call("bookings/EKSA-1", record)).status, 409);
  const receipt = {
    id: "bank-1",
    reference: "EKSA-1",
    lineId: "l1",
    kind: "commission",
    amountCents: 4000,
    currency: "ZAR",
    receivedOn: "2026-11-20",
    evidenceReference: "bank.pdf",
  };
  assert.equal((await call("receipts", receipt)).status, 201);
  assert.equal((await call("receipts", receipt)).status, 409);
  assert.equal(
    (
      await call("receipts", {
        ...receipt,
        id: "r2",
        kind: "commission_reversal",
        amountCents: 5000,
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("receipts", { ...receipt, id: "r3", currency: "USD" })).status,
    400,
  );
  const dashboard = await call("dashboard");
  assert.equal(dashboard.body.confirmed, 1);
  assert.equal(dashboard.body.reminders[0].amountCents, 4000);
  assert.throws(
    () => sqlite.exec("UPDATE commercial_events SET actor='fake'"),
    /immutable/,
  );
  assert.throws(
    () => sqlite.exec("DELETE FROM supplier_agreements"),
    /retained/,
  );
  assert.throws(
    () => sqlite.exec("DELETE FROM commercial_receipts"),
    /retained/,
  );
  assert.equal(
    (
      await call("bookings/EKSA-1", {
        ...record,
        revision: 1,
        paymentModel: "platform_collects",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("bookings/EKSA-1", {
        ...record,
        revision: 1,
        status: "completed",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("bookings/EKSA-1", {
        ...record,
        revision: 2,
        status: "enquiry",
      })
    ).status,
    400,
  );
  sqlite.close();
});
test("Trade partners see only their own reservations and never supplier cost", async () => {
  const { DB, sqlite } = database();
  const env = { DB, ADMIN_TOKEN: adminToken };
  const token = "operator-secret-at-least-32-characters";
  let r = await revenueApi(
    request("agents", { name: "Operator", email: "op@example.test", token }),
    env,
    "/api/admin/agents",
  );
  assert.equal(r.status, 201);
  const trade = (path: string, body?: any, key = token) =>
    revenueApi(
      new Request("https://example.test/api/trade/" + path, {
        method: body ? "POST" : "GET",
        headers: { authorization: "Bearer " + key },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
      "/api/trade/" + path,
    );
  r = await trade("enquiries", {
    travellerName: "Traveller",
    destination: "Kruger",
    guests: 50,
    payingCustomer: "Operator",
    permissions: "Operator receives all correspondence",
  });
  assert.equal(r.status, 201);
  sqlite.exec(
    "INSERT INTO bookings(reference,client_name) VALUES('OTHER','Other guest');",
  );
  const data = await (await trade("bookings")).json();
  assert.equal(data.bookings.length, 1);
  assert.equal(JSON.stringify(data).includes("supplierCost"), false);
  assert.equal((await trade("bookings", undefined, "other")).status, 401);
  sqlite.close();
});
test("Formal quotations reconcile totals, service invoices exclude supplier funds and documents are immutable", async () => {
  const { DB, sqlite } = database();
  const env = { DB, ADMIN_TOKEN: adminToken };
  sqlite.exec(
    "INSERT INTO suppliers(id,name,type) VALUES('s1','Hotel','accommodation'); INSERT INTO bookings(reference,client_name,num_guests) VALUES('EKSA-D','Guest',20);",
  );
  const q = quote();
  q.serviceFeeCents = 2000;
  q.serviceFeeApproval = "accepted-fee";
  q.outputVatCents = 15000;
  await DB.prepare(
    "INSERT INTO booking_commercial(reference,paying_customer,traveller_name,communication_json,quote_json) VALUES(?,?,?,?,?)",
  )
    .bind("EKSA-D", "Paying guest", "Lead guest", "{}", JSON.stringify(q))
    .run();
  const call = async (path: string, body?: any) => {
    const r = await revenueApi(request(path, body), env, "/api/admin/" + path);
    return { status: r.status, body: await r.json() };
  };
  let r = await call("documents", {
    reference: "EKSA-D",
    kind: "quotation",
    terms:
      "Supplier cancellation terms apply as agreed. Customer pays hotel directly.",
    validUntil: "2027-01-01",
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.document.totalCents, 117000);
  assert.ok(!r.body.html.includes("supplierCostCents"));
  assert.ok(r.body.html.includes("Hotel"));
  r = await call("documents", {
    reference: "EKSA-D",
    kind: "service_invoice",
    terms: "Accepted coordination fee only",
    validUntil: "2027-01-01",
    serviceVatCents: 300,
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.document.totalCents, 2300);
  assert.equal(r.body.document.lines.length, 1);
  assert.equal(r.body.document.lines[0].payTo, "Easy Kosher SA");
  assert.throws(() => sqlite.exec("DELETE FROM booking_documents"), /retained/);
  r = await call("allocations", {
    reference: "EKSA-D",
    supplierId: "s1",
    roomType: "Twin",
    rooms: 10,
    guests: 20,
    arrival: "2027-07-01",
    departure: "2027-07-04",
    allocationReference: "HOLD-20",
    state: "held",
  });
  assert.equal(r.status, 201);
  r = await call("allocations", {
    reference: "EKSA-D",
    supplierId: "s1",
    roomType: "Twin",
    rooms: 11,
    guests: 21,
    arrival: "2027-07-01",
    departure: "2027-07-04",
    allocationReference: "HOLD-21",
    state: "held",
  });
  assert.equal(r.status, 400);
  sqlite.close();
});
test("Trade documents are scoped to operator and do not expose customer documents or supplier cost", async () => {
  const { DB, sqlite } = database();
  const env = { DB, ADMIN_TOKEN: adminToken };
  const token = "trade-document-test-secret-32-chars";
  const agentResult = await revenueApi(
    request("agents", {
      name: "Trade buyer",
      email: "trade@example.test",
      token,
    }),
    env,
    "/api/admin/agents",
  );
  const agent = await agentResult.json();
  sqlite.exec(
    "INSERT INTO bookings(reference,client_name) VALUES('EKSA-T','Guest'); INSERT INTO bookings(reference,client_name) VALUES('EKSA-PRIVATE','Other');",
  );
  for (const ref of ["EKSA-T", "EKSA-PRIVATE"])
    await DB.prepare(
      "INSERT INTO booking_commercial(reference,agent_id,paying_customer,traveller_name,communication_json,quote_json) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        ref,
        ref === "EKSA-T" ? agent.id : null,
        "Operator",
        "Traveller",
        "{}",
        JSON.stringify(quote()),
      )
      .run();
  for (const kind of ["quotation", "trade_quotation"]) {
    const r = await revenueApi(
      request("documents", {
        reference: "EKSA-T",
        kind,
        terms: "Accepted supplier conditions and payment responsibilities",
        validUntil: "2027-01-01",
        retailGuideCents: 120000,
      }),
      env,
      "/api/admin/documents",
    );
    assert.equal(r.status, 201);
  }
  const r = await revenueApi(
    new Request("https://example.test/api/trade/documents/EKSA-T", {
      headers: { authorization: "Bearer " + token },
    }),
    env,
    "/api/trade/documents/EKSA-T",
  );
  const d = await r.json();
  assert.equal(d.documents.length, 1);
  assert.equal(d.documents[0].kind, "trade_quotation");
  assert.equal(d.documents[0].payload.retailGuideCents, 120000);
  assert.equal(JSON.stringify(d).includes("supplierCostCents"), false);
  const privateResult = await revenueApi(
    new Request("https://example.test/api/trade/documents/EKSA-PRIVATE", {
      headers: { authorization: "Bearer " + token },
    }),
    env,
    "/api/trade/documents/EKSA-PRIVATE",
  );
  assert.equal(privateResult.status, 404);
  sqlite.close();
});
test("Supplier email enforces guest copying, explicit approval, confirmed send and no duplicate dispatch", async () => {
  const { DB, sqlite } = database();
  const env = {
    DB,
    ADMIN_TOKEN: adminToken,
    EMAIL_BRIDGE_URL: "https://mail-bridge.example.test/send",
    EMAIL_BRIDGE_TOKEN: "test-bridge-token",
  };
  sqlite.exec(
    "INSERT INTO suppliers(id,name,type,contact_email) VALUES('s1','Hotel','accommodation','hotel@example.test'); INSERT INTO bookings(reference,client_name) VALUES('EKSA-M','Guest');",
  );
  await DB.prepare(
    "INSERT INTO booking_commercial(reference,paying_customer,traveller_name,communication_json,quote_json) VALUES(?,?,?,?,?)",
  )
    .bind(
      "EKSA-M",
      "Guest",
      "Guest",
      JSON.stringify({
        mode: "direct",
        copyGuest: true,
        guestEmail: "guest@example.test",
        permissions: "Customer authorised supplier copying",
      }),
      JSON.stringify(quote()),
    )
    .run();
  const call = async (path: string, body?: any, config = env) => {
    const r = await revenueApi(
      request(path, body),
      config,
      "/api/admin/" + path,
    );
    return { status: r.status, body: await r.json() };
  };
  assert.equal(
    (
      await call("mail", {
        reference: "EKSA-M",
        supplierId: "s1",
        subject: "Trade rates",
        body: "Confidential",
        confidentiality: "trade",
      })
    ).status,
    400,
  );
  let r = await call("mail", {
    reference: "EKSA-M",
    supplierId: "s1",
    subject: "Reservation request",
    body: "Please confirm the reservation.",
    confidentiality: "booking",
  });
  assert.equal(r.status, 201);
  const mid = r.body.id;
  assert.equal((await call("mail/" + mid, { command: "send" })).status, 400);
  assert.equal((await call("mail/" + mid, { command: "approve" })).status, 200);
  assert.equal(
    (
      await call(
        "mail/" + mid,
        { command: "send" },
        { ...env, EMAIL_BRIDGE_TOKEN: "" },
      )
    ).status,
    503,
  );
  const originalFetch = globalThis.fetch;
  let dispatched = 0;
  globalThis.fetch = async (_url: any, options: any) => {
    dispatched++;
    const body = JSON.parse(options.body);
    assert.deepEqual(body.cc, ["guest@example.test"]);
    assert.deepEqual(body.to, ["hotel@example.test"]);
    assert.equal(options.headers["idempotency-key"], mid);
    return new Response(
      JSON.stringify({ status: "sent", providerMessageId: "provider-1" }),
      { status: 200 },
    );
  };
  try {
    assert.equal((await call("mail/" + mid, { command: "send" })).status, 200);
    assert.equal((await call("mail/" + mid, { command: "send" })).status, 400);
    assert.equal(dispatched, 1);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
