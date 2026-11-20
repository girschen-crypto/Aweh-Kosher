export type ReservationDocument = {
  id: string;
  reference: string;
  kind: string;
  revision: number;
  issuedOn: string;
  customer: string;
  traveller: string;
  currency: string;
  lines: {
    description: string;
    category: string;
    amountCents: number;
    payTo: string;
  }[];
  subtotalCents: number;
  vatCents: number;
  discountCents: number;
  totalCents: number;
  terms: string;
  validUntil: string;
  retailGuideCents?: number;
  approvalReference?: string;
};
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const money = (n: number, c: string) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: c }).format(
    n / 100,
  );
export function documentHtml(d: ReservationDocument) {
  const title =
    d.kind === "service_invoice"
      ? "Coordination service invoice"
      : d.kind === "trade_quotation"
        ? "Confidential trade quotation"
        : "Reservation quotation";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)} ${escape(d.reference)}</title><style>body{font:16px/1.5 Arial,sans-serif;max-width:900px;margin:40px auto;padding:24px;color:#183a47}h1{font-size:28px}table{width:100%;border-collapse:collapse}td,th{padding:12px;border-bottom:1px solid #bbb;text-align:left}p{white-space:pre-wrap;overflow-wrap:anywhere}.total{font-size:22px}footer{margin-top:40px;border-top:1px solid #bbb;padding-top:15px}@media print{body{margin:0;max-width:none}}</style></head><body><h1>Easy Kosher SA</h1><h2>${escape(title)}</h2><p>Booking: ${escape(d.reference)}\nDocument: ${escape(d.id)} · Version ${d.revision}\nIssued: ${escape(d.issuedOn)} · Valid until: ${escape(d.validUntil)}\nPaying customer: ${escape(d.customer)}\nLead traveller: ${escape(d.traveller)}</p><table><thead><tr><th>Service</th><th>Payable to</th><th>Amount excluding VAT</th></tr></thead><tbody>${d.lines.map((l) => `<tr><td>${escape(l.description)}</td><td>${escape(l.payTo)}</td><td>${escape(money(l.amountCents, d.currency))}</td></tr>`).join("")}</tbody></table><p>Subtotal: ${escape(money(d.subtotalCents, d.currency))}\nDisclosed discount: ${escape(money(d.discountCents, d.currency))}\nVAT as recorded: ${escape(money(d.vatCents, d.currency))}</p><p class="total">Total: ${escape(money(d.totalCents, d.currency))}</p>${d.retailGuideCents !== undefined ? `<p>Operator's suggested retail total: ${escape(money(d.retailGuideCents, d.currency))}. This is separate from the contracted amount payable above.</p>` : ""}<h3>Terms and payment responsibilities</h3><p>${escape(d.terms)}</p>${d.approvalReference ? `<p>Acceptance reference: ${escape(d.approvalReference)}</p>` : ""}<footer><p>Accommodation and transport are payable directly to the named suppliers under their accepted terms. Only an agreed Easy Kosher SA coordination fee is payable to Easy Kosher SA. No payment has been initiated by this document. This document does not replace a supplier's tax invoice.</p></footer></body></html>`;
}
