import { calculate, cents, type Quote } from "../src/commercial.ts";
import { documentHtml, type ReservationDocument } from "../src/documents.ts";
import type { DB } from "./revenue.ts";
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const clean = (x: unknown, max = 3000) =>
  typeof x === "string" ? x.trim().slice(0, max) : "";
const validDate = (s: unknown) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s));
export async function tradeDocuments(
  req: Request,
  DB: DB,
  action: string,
  ref: string,
  b: any,
  actor: string,
  agentId?: string,
): Promise<Response | null> {
  if (!["documents", "allocations"].includes(action)) return null;
  const booking = await DB.prepare(
    "SELECT b.reference,b.num_guests,c.* FROM bookings b JOIN booking_commercial c ON c.reference=b.reference WHERE b.reference=?",
  )
    .bind(ref || b.reference)
    .first();
  if (!booking || (agentId && booking.agent_id !== agentId))
    return json({ error: "Booking not found" }, 404);
  const event = (kind: string, payload: unknown) =>
    DB.prepare(
      "INSERT INTO commercial_events(id,reference,kind,actor,payload_json) VALUES(?,?,?,?,?)",
    ).bind(
      crypto.randomUUID(),
      booking.reference,
      kind,
      actor,
      JSON.stringify(payload),
    );
  if (action === "documents") {
    if (req.method === "GET") {
      const rows = (
        await DB.prepare(
          `SELECT * FROM booking_documents WHERE reference=? ${agentId ? "AND audience='trade'" : ""} ORDER BY created_at DESC,revision DESC`,
        )
          .bind(booking.reference)
          .all()
      ).results;
      return json({
        documents: rows.map((r: any) => ({
          ...r,
          payload: JSON.parse(r.payload_json),
          html: documentHtml(JSON.parse(r.payload_json)),
        })),
      });
    }
    if (agentId)
      return json({ error: "Documents are issued by Easy Kosher SA" }, 403);
    if (
      !["quotation", "trade_quotation", "service_invoice"].includes(b.kind) ||
      !clean(b.terms) ||
      !validDate(b.validUntil)
    )
      throw Error("Document kind, validity date and full terms are required");
    if (b.kind === "trade_quotation" && !booking.agent_id)
      throw Error("Trade quotation requires an assigned registered operator");
    const q: Quote = JSON.parse(booking.quote_json);
    const profit = calculate(q);
    if (!q.lines.length && !q.serviceFeeCents)
      throw Error("Save a priced quotation first");
    if (
      b.kind === "service_invoice" &&
      (!q.serviceFeeApproval || q.serviceFeeCents <= 0)
    )
      throw Error("A coordination invoice requires an accepted service fee");
    const last = await DB.prepare(
      "SELECT MAX(revision) AS revision FROM booking_documents WHERE reference=? AND kind=?",
    )
      .bind(booking.reference, b.kind)
      .first();
    const invoice = b.kind === "service_invoice";
    const lines: ReservationDocument["lines"] = [];
    if (!invoice)
      for (const l of q.lines) {
        const s = await DB.prepare("SELECT name FROM suppliers WHERE id=?")
          .bind(l.supplierId)
          .first();
        lines.push({
          description: l.description,
          category: l.category,
          amountCents: l.sellingCents,
          payTo: s?.name || "Supplier",
        });
      }
    if (q.serviceFeeCents)
      lines.push({
        description: "Agreed travel coordination fee",
        category: "service_fee",
        amountCents: q.serviceFeeCents,
        payTo: "Easy Kosher SA",
      });
    // A service invoice must have its own explicitly entered tax total, never all booking VAT.
    const vat = invoice ? cents(b.serviceVatCents) : q.outputVatCents;
    const subtotal = lines.reduce((n, l) => n + l.amountCents, 0);
    const discount = invoice ? 0 : q.discountCents;
    if (subtotal + vat < discount)
      throw Error("Discount exceeds document total");
    const d: ReservationDocument = {
      id: crypto.randomUUID(),
      reference: booking.reference,
      kind: b.kind,
      revision: Number(last?.revision || 0) + 1,
      issuedOn: new Date().toISOString().slice(0, 10),
      customer: booking.paying_customer,
      traveller: booking.traveller_name,
      currency: q.currency,
      lines,
      subtotalCents: subtotal,
      vatCents: vat,
      discountCents: discount,
      totalCents: subtotal + vat - discount,
      terms: clean(b.terms, 12000),
      validUntil: b.validUntil,
      ...(b.kind === "trade_quotation" && b.retailGuideCents !== undefined
        ? { retailGuideCents: cents(b.retailGuideCents) }
        : {}),
      ...(invoice ? { approvalReference: q.serviceFeeApproval } : {}),
    };
    if (!invoice && d.totalCents !== profit.bookingValueCents)
      throw Error("Quotation total does not reconcile");
    await DB.batch([
      DB.prepare(
        "INSERT INTO booking_documents(id,reference,kind,audience,revision,payload_json,created_by) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        d.id,
        booking.reference,
        b.kind,
        b.kind === "trade_quotation" || (invoice && booking.agent_id)
          ? "trade"
          : "customer",
        d.revision,
        JSON.stringify(d),
        actor,
      ),
      event("document_issued", {
        documentId: d.id,
        kind: d.kind,
        revision: d.revision,
      }),
    ]);
    return json({ document: d, html: documentHtml(d) }, 201);
  }
  if (req.method === "GET")
    return json({
      allocations: (
        await DB.prepare(
          "SELECT * FROM room_allocations WHERE reference=? ORDER BY arrival",
        )
          .bind(booking.reference)
          .all()
      ).results,
    });
  if (
    !clean(b.supplierId) ||
    !clean(b.roomType) ||
    !Number.isInteger(b.rooms) ||
    b.rooms <= 0 ||
    !Number.isInteger(b.guests) ||
    b.guests <= 0 ||
    !validDate(b.arrival) ||
    !validDate(b.departure) ||
    b.departure <= b.arrival ||
    !clean(b.allocationReference) ||
    !["requested", "held", "confirmed", "released"].includes(b.state)
  )
    throw Error(
      "Room type, rooms, guests, valid dates, supplier reference and allocation state are required",
    );
  if (agentId && b.state !== "requested")
    throw Error("Only Easy Kosher SA may confirm supplier room allocations");
  if (b.guests > booking.num_guests)
    throw Error("Allocation exceeds booking group size");
  const allocationId = clean(b.id) || crypto.randomUUID();
  if (agentId && b.id)
    throw Error(
      "Partners can create requests; ask the reservations team to amend an existing allocation",
    );
  const existing = await DB.prepare(
    "SELECT reference FROM room_allocations WHERE id=?",
  )
    .bind(allocationId)
    .first();
  if (existing && existing.reference !== booking.reference)
    throw Error("Allocation belongs to another booking");
  await DB.batch([
    DB.prepare(
      "INSERT INTO room_allocations(id,reference,supplier_id,room_type,rooms,guests,arrival,departure,allocation_reference,notes,state) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET room_type=excluded.room_type,rooms=excluded.rooms,guests=excluded.guests,arrival=excluded.arrival,departure=excluded.departure,allocation_reference=excluded.allocation_reference,notes=excluded.notes,state=excluded.state,updated_at=CURRENT_TIMESTAMP",
    ).bind(
      allocationId,
      booking.reference,
      b.supplierId,
      clean(b.roomType),
      b.rooms,
      b.guests,
      b.arrival,
      b.departure,
      clean(b.allocationReference),
      clean(b.notes),
      b.state,
    ),
    event("room_allocation", { ...b, id: allocationId }),
  ]);
  return json({ ok: true, id: allocationId }, 201);
}
