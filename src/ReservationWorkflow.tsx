import BookingMail from "./BookingMail";
import { useState, type FormEvent } from "react";
const cash = (v: number, c: string) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: c }).format(
    v / 100,
  );
type Api = (path: string, body?: any) => Promise<any>;
export default function ReservationWorkflow({
  api,
  reference,
  trade = false,
  suppliers = [],
}: {
  api: Api;
  reference: string;
  trade?: boolean;
  suppliers?: any[];
}) {
  const [documents, setDocuments] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const [d, a] = await Promise.all([
        api("documents/" + encodeURIComponent(reference)),
        api("allocations/" + encodeURIComponent(reference)),
      ]);
      setDocuments(d.documents);
      setAllocations(a.allocations);
      setMessage("Reservation documents loaded.");
    } catch (e) {
      setMessage(String(e));
    }
  }
  async function save(e: FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    setBusy(true);
    const v: any = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (action === "documents") {
        v.serviceVatCents = Math.round(Number(v.serviceVat || 0) * 100);
        if (v.retailGuide)
          v.retailGuideCents = Math.round(Number(v.retailGuide) * 100);
      } else {
        v.rooms = Number(v.rooms);
        v.guests = Number(v.guests);
      }
      await api(action, { ...v, reference });
      await load();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  function print(html: string) {
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.append(frame);
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    };
    frame.srcdoc = html;
    setTimeout(() => frame.remove(), 60000);
  }
  return (
    <section>
      <h2>Documents and room allocations</h2>
      <p>Booking {reference}</p>
      <button type="button" onClick={load}>
        Load documents and allocations
      </button>
      {!trade && (
        <details>
          <summary>Issue quotation or coordination invoice</summary>
          <form className="deskForm" onSubmit={(e) => save(e, "documents")}>
            <label>
              Document type
              <select name="kind">
                <option value="quotation">Customer quotation</option>
                <option value="trade_quotation">
                  Confidential contracted trade quotation
                </option>
                <option value="service_invoice">
                  Coordination service invoice
                </option>
              </select>
            </label>
            <label>
              Valid until
              <input name="validUntil" type="date" required />
            </label>
            <label>
              Suggested retail total (trade only, optional)
              <input name="retailGuide" type="number" min="0" step=".01" />
            </label>
            <label>
              VAT on coordination fee (invoice only)
              <input
                name="serviceVat"
                type="number"
                min="0"
                step=".01"
                defaultValue="0"
              />
            </label>
            <label>
              Cancellation, payment, inclusions and full agreed terms
              <textarea name="terms" required />
            </label>
            <button disabled={busy}>Issue document version</button>
          </form>
        </details>
      )}
      {documents.map((d) => (
        <article key={d.id}>
          <h3>
            {d.kind.replaceAll("_", " ")} · version {d.revision}
          </h3>
          <p>
            {d.payload.customer} ·{" "}
            {cash(d.payload.totalCents, d.payload.currency)} · valid until{" "}
            {d.payload.validUntil}
          </p>
          <button type="button" onClick={() => print(d.html)}>
            Print or save PDF
          </button>
          <details>
            <summary>View agreed terms</summary>
            <p>{d.payload.terms}</p>
            {d.payload.lines.map((l: any, i: number) => (
              <p key={i}>
                {l.description} · {cash(l.amountCents, d.payload.currency)} ·
                payable to {l.payTo}
              </p>
            ))}
          </details>
        </article>
      ))}
      <h3>Room allocations</h3>
      {allocations.map((a) => (
        <p key={a.id}>
          {a.room_type} · {a.rooms} rooms · {a.guests} guests · {a.arrival} to{" "}
          {a.departure} · {a.state} · {a.allocation_reference}
        </p>
      ))}
      {!trade && (
        <form className="deskForm" onSubmit={(e) => save(e, "allocations")}>
          <label>
            Supplier
            <select name="supplierId" required>
              <option value="">Choose supplier</option>
              {suppliers
                .filter((s) => s.type === "accommodation")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Room type
            <input name="roomType" required />
          </label>
          <label>
            Rooms
            <input name="rooms" type="number" min="1" step="1" required />
          </label>
          <label>
            Guests
            <input name="guests" type="number" min="1" step="1" required />
          </label>
          <label>
            Arrival
            <input name="arrival" type="date" required />
          </label>
          <label>
            Departure
            <input name="departure" type="date" required />
          </label>
          <label>
            Supplier allocation reference
            <input name="allocationReference" required />
          </label>
          <label>
            State
            <select name="state">
              {["requested", "held", "confirmed", "released"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <textarea name="notes" />
          </label>
          <button disabled={busy}>Record allocation</button>
        </form>
      )}
      {!trade && (
        <BookingMail api={api} reference={reference} suppliers={suppliers} />
      )}
      <p role="status">{message}</p>
    </section>
  );
}
