import type { DB } from "./revenue.ts";
export type MailEnv = {
  DB: DB;
  EMAIL_BRIDGE_URL?: string;
  EMAIL_BRIDGE_TOKEN?: string;
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const clean = (v: unknown, n = 10000) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";
const email = (s: unknown) =>
  typeof s === "string" &&
  /^[^\s@,;\r\n]+@[^\s@,;\r\n]+\.[^\s@,;\r\n]+$/.test(s);
export async function mailApi(
  req: Request,
  env: MailEnv,
  id: string,
  b: any,
  actor: string,
) {
  const event = (ref: string, kind: string, data: unknown) =>
    env.DB.prepare(
      "INSERT INTO commercial_events(id,reference,kind,actor,payload_json) VALUES(?,?,?,?,?)",
    ).bind(crypto.randomUUID(), ref, kind, actor, JSON.stringify(data));
  const ready =
    !!env.EMAIL_BRIDGE_TOKEN &&
    !!env.EMAIL_BRIDGE_URL &&
    env.EMAIL_BRIDGE_URL.startsWith("https://");
  if (req.method === "GET") {
    const ref = new URL(req.url).searchParams.get("reference");
    return json({
      sendingConfigured: ready,
      messages: (
        await env.DB.prepare(
          "SELECT * FROM booking_mail WHERE reference=? ORDER BY created_at DESC",
        )
          .bind(ref || "")
          .all()
      ).results,
    });
  }
  if (!id) {
    const record = await env.DB.prepare(
      "SELECT * FROM booking_commercial WHERE reference=?",
    )
      .bind(b.reference)
      .first();
    const supplier = await env.DB.prepare(
      "SELECT name,contact_email FROM suppliers WHERE id=?",
    )
      .bind(b.supplierId)
      .first();
    if (!record || !supplier || !email(supplier.contact_email))
      throw Error(
        "Saved booking permissions and a valid supplier email are required",
      );
    const permissions = JSON.parse(record.communication_json);
    const cc: string[] = [];
    if (!clean(permissions.permissions))
      throw Error("Communication permission evidence required");
    if (permissions.mode === "direct") {
      if (!permissions.copyGuest || !email(permissions.guestEmail))
        throw Error("Guest copying and authorisation are required");
      if (b.confidentiality === "trade")
        throw Error(
          "Confidential trade correspondence cannot be sent on a direct guest thread",
        );
      cc.push(permissions.guestEmail);
    } else {
      const agent = await env.DB.prepare(
        "SELECT email FROM commercial_agents WHERE id=? AND active=1",
      )
        .bind(record.agent_id)
        .first();
      if (!agent || !email(agent.email))
        throw Error("An active registered operator email is required");
      cc.push(agent.email);
      if (permissions.copyGuest) {
        if (b.confidentiality === "trade")
          throw Error("Trade rates must not be copied to guests");
        if (!email(permissions.guestEmail)) throw Error("Invalid guest email");
        cc.push(permissions.guestEmail);
      }
    }
    if (!clean(b.subject, 160) || !clean(b.body) || /[\r\n]/.test(b.subject))
      throw Error("Valid subject and message body required");
    const messageId = crypto.randomUUID();
    const recipients = { to: [supplier.contact_email], cc: [...new Set(cc)] };
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO booking_mail(id,reference,supplier_id,recipients_json,subject,body,confidentiality) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        messageId,
        b.reference,
        b.supplierId,
        JSON.stringify(recipients),
        `${b.reference} | ${clean(b.subject, 160)}`,
        clean(b.body),
        b.confidentiality === "trade" ? "trade" : "booking",
      ),
      event(b.reference, "mail_drafted", {
        id: messageId,
        recipients,
        subject: b.subject,
      }),
    ]);
    return json({ id: messageId, state: "draft" }, 201);
  }
  const message = await env.DB.prepare("SELECT * FROM booking_mail WHERE id=?")
    .bind(id)
    .first();
  if (!message) return json({ error: "Message not found" }, 404);
  if (b.command === "approve") {
    if (message.state !== "draft") throw Error("Only a draft may be approved");
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE booking_mail SET state='approved',approved_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state='draft'",
      ).bind(actor, id),
      event(message.reference, "mail_approved", {
        id,
        recipients: JSON.parse(message.recipients_json),
        subject: message.subject,
      }),
    ]);
    return json({ ok: true, state: "approved" });
  }
  if (b.command !== "send") throw Error("Unknown message action");
  if (!ready)
    return json(
      { error: "Email service is not connected. No message was sent." },
      503,
    );
  if (message.state !== "approved")
    throw Error("Only an approved message may be sent");
  // Permissions may have changed since drafting: fail closed until a fresh draft is made.
  const booking = await env.DB.prepare(
    "SELECT communication_json,agent_id FROM booking_commercial WHERE reference=?",
  )
    .bind(message.reference)
    .first();
  const p = JSON.parse(booking.communication_json);
  const recipients = JSON.parse(message.recipients_json);
  const supplier = await env.DB.prepare(
    "SELECT contact_email FROM suppliers WHERE id=?",
  )
    .bind(message.supplier_id)
    .first();
  if (!supplier || recipients.to[0] !== supplier.contact_email)
    throw Error("Supplier email changed; create a new draft");
  if (
    p.mode === "direct" &&
    (!p.copyGuest ||
      !recipients.cc.includes(p.guestEmail) ||
      message.confidentiality === "trade")
  )
    throw Error("Guest copying permissions changed; create a new draft");
  if (p.mode === "operator") {
    const a = await env.DB.prepare(
      "SELECT email FROM commercial_agents WHERE id=? AND active=1",
    )
      .bind(booking.agent_id)
      .first();
    if (
      !a ||
      !recipients.cc.includes(a.email) ||
      (p.copyGuest && !recipients.cc.includes(p.guestEmail)) ||
      (!p.copyGuest && recipients.cc.some((c: string) => c !== a.email))
    )
      throw Error("Operator permissions changed; create a new draft");
  }
  const claim = await env.DB.prepare(
    "UPDATE booking_mail SET state='sending',updated_at=CURRENT_TIMESTAMP WHERE id=? AND state='approved'",
  )
    .bind(id)
    .run();
  if (!claim.meta.changes)
    return json({ error: "Message already claimed for sending" }, 409);
  try {
    const result = await fetch(env.EMAIL_BRIDGE_URL!, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.EMAIL_BRIDGE_TOKEN}`,
        "content-type": "application/json",
        "idempotency-key": id,
      },
      body: JSON.stringify({
        idempotencyKey: id,
        reference: message.reference,
        ...recipients,
        subject: message.subject,
        text: message.body,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    const outcome: any = await result.json();
    if (
      !result.ok ||
      outcome.status !== "sent" ||
      !clean(outcome.providerMessageId, 500)
    )
      throw Error("Email bridge did not confirm delivery submission");
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE booking_mail SET state='sent',provider_message_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(outcome.providerMessageId, id),
      event(message.reference, "mail_sent", {
        id,
        providerMessageId: outcome.providerMessageId,
        recipients,
      }),
    ]);
    return json({
      ok: true,
      state: "sent",
      providerMessageId: outcome.providerMessageId,
    });
  } catch {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE booking_mail SET state='unknown',updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(id),
      event(message.reference, "mail_delivery_unknown", { id }),
    ]);
    return json(
      {
        error:
          "Sending result is uncertain. Check the provider using the message ID before creating another draft; automatic retry is blocked.",
        id,
      },
      502,
    );
  }
}
