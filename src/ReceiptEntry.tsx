import { useState, type FormEvent } from "react";
const formatMoney = (n: number, c: string) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: c }).format(
    n / 100,
  );
export default function ReceiptEntry({
  api,
  bookings,
  onSaved,
  adjustment = false,
}: {
  api: (path: string, body?: any) => Promise<any>;
  bookings: any[];
  onSaved: () => Promise<void>;
  adjustment?: boolean;
}) {
  const [reference, setReference] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Africa/Johannesburg",
  });
  async function choose(ref: string) {
    setReference(ref);
    setDetail(null);
    setNotice("");
    if (!ref) return;
    try {
      setDetail(await api("bookings/" + encodeURIComponent(ref)));
    } catch (e) {
      setNotice(String(e));
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v: any = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    try {
      const body = {
        ...v,
        reference,
        currency: detail.profit.currency,
        amountCents: Math.round(Number(v.amount) * 100),
      };
      await api(adjustment ? "adjustments" : "receipts", body);
      await choose(reference);
      await onSaved();
      setNotice(
        "Recorded. The booking and revenue dashboard have been updated.",
      );
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>
        {adjustment
          ? "Adjust agreed earnings"
          : "Record income received or a direct expense"}
      </h2>
      <p>
        {adjustment
          ? "Record accepted earnings changes against the original booking. Record any bank refund separately under Receipts."
          : "Choose the booking and income item. Record cleared money only. This does not charge a customer or send a payout."}
      </p>
      <label>
        Booking
        <select value={reference} onChange={(e) => choose(e.target.value)}>
          <option value="">Choose a booking</option>
          {bookings.map((b) => (
            <option key={b.reference} value={b.reference}>
              {b.client_name} · {b.destination || "Custom trip"} · {b.reference}
            </option>
          ))}
        </select>
      </label>
      {detail && (
        <>
          <p>
            Currency: {detail.profit.currency} · Agreed income:{" "}
            {formatMoney(detail.profit.netRevenueCents, detail.profit.currency)}{" "}
            · Received:{" "}
            {formatMoney(
              detail.profit.actualIncomeCents,
              detail.profit.currency,
            )}
          </p>
          <form
            key={
              reference +
              ":" +
              detail.receipts.length +
              ":" +
              (detail.adjustments?.length || 0)
            }
            className="deskForm"
            onSubmit={submit}
          >
            <label>
              {adjustment
                ? "Unique adjustment reference"
                : "Unique bank transaction reference"}
              <input name="id" required />
            </label>
            <label>
              {adjustment ? "Adjustment" : "Transaction type"}
              <select name="kind">
                {(adjustment
                  ? [
                      ["reversal", "Reduce agreed earnings"],
                      ["restoration", "Restore previously reduced earnings"],
                    ]
                  : [
                      ["commission", "Commission received"],
                      ["service_fee", "Coordination fee received"],
                      ["markup", "Agreed markup received"],
                      ["commission_reversal", "Commission returned"],
                      ["service_fee_reversal", "Coordination fee returned"],
                      ["markup_reversal", "Markup returned"],
                      ["direct_cost", "Direct expense paid"],
                    ]
                ).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Income item
              <select name="lineId" required={adjustment}>
                <option value="">General expense / service fee</option>
                {detail.profit.lines.map((l: any) => (
                  <option key={l.id} value={l.id}>
                    {l.description} ·{" "}
                    {formatMoney(
                      l.adjustedEntitlementCents,
                      detail.profit.currency,
                    )}{" "}
                    agreed earnings
                  </option>
                ))}
                <option value="service_fee">Coordination service fee</option>
              </select>
            </label>
            <label>
              Amount ({detail.profit.currency}, excluding VAT)
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
              />
            </label>
            {!adjustment && (
              <label>
                Transaction date
                <input
                  name="receivedOn"
                  type="date"
                  max={today}
                  defaultValue={today}
                  required
                />
              </label>
            )}
            {adjustment && (
              <label>
                Reason
                <textarea name="reason" required />
              </label>
            )}
            <label>
              {adjustment
                ? "Accepted change / cancellation evidence"
                : "Bank / provider evidence reference"}
              <input name="evidenceReference" required />
            </label>
            <button disabled={busy}>
              {busy ? "Recording…" : "Record transaction"}
            </button>
          </form>
          <h3>
            Recorded {adjustment ? "earnings changes" : "receipts and expenses"}
          </h3>
          {(adjustment ? detail.adjustments : detail.receipts).map((r: any) => (
            <p key={r.id}>
              {r.id} · {r.kind.replaceAll("_", " ")} ·{" "}
              {formatMoney(r.amount_cents, r.currency)} ·{" "}
              {r.received_on || r.created_at}
            </p>
          ))}
        </>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}
