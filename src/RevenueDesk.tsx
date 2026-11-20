import ReservationWorkflow from "./ReservationWorkflow";
import { useState, type FormEvent } from "react";
import { emptyQuote, type Quote } from "./commercial";
type Option = string | { value: string; label: string };
const optionValue = (v: Option | undefined) =>
  typeof v === "string" ? v : v?.value || "";
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: Option[];
  value?: string;
  required?: boolean;
};
const money = (n: number, c = "ZAR") =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: c }).format(
    n / 100,
  );
function Form({
  fields,
  onSave,
  label = "Save record",
}: {
  fields: Field[];
  onSave: (v: any) => Promise<void>;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setMessage("");
    try {
      await onSave(data);
      setMessage("Saved successfully.");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="deskForm" onSubmit={submit}>
      {fields.map((f) => (
        <label key={f.key}>
          {f.label}
          {f.options ? (
            <select
              name={f.key}
              defaultValue={f.value ?? optionValue(f.options[0])}
            >
              {f.options.map((v) => (
                <option key={optionValue(v)} value={optionValue(v)}>
                  {typeof v === "string" ? v : v.label}
                </option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea
              name={f.key}
              defaultValue={f.value}
              required={f.required !== false}
            />
          ) : (
            <input
              name={f.key}
              type={f.type || "text"}
              defaultValue={f.value}
              required={f.required !== false}
              min={f.type === "number" ? 0 : undefined}
              step={f.type === "number" ? "0.01" : undefined}
            />
          )}
        </label>
      ))}
      <button disabled={busy}>{busy ? "Saving…" : label}</button>
      <p role="status">{message}</p>
    </form>
  );
}
const f = (
  key: string,
  label: string,
  type = "text",
  value?: string,
): Field => ({ key, label, type, value });
const opt = (key: string, label: string, options: Option[]): Field => ({
  key,
  label,
  options,
});
const amount = (v: any) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0)
    throw Error("Enter a valid positive amount");
  return Math.round(n * 100);
};
export default function RevenueDesk({ trade }: { trade: boolean }) {
  const [token, setToken] = useState("");
  const [active, setActive] = useState(false);
  const [page, setPage] = useState("Dashboard");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [agents, setAgents] = useState<any[]>([]);
  const [tradeRef, setTradeRef] = useState("");
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [q, setQ] = useState<Quote>(structuredClone(emptyQuote));
  const [filter, setFilter] = useState("ZAR");
  async function api(path: string, body?: any, key = token) {
    const r = await fetch(`/api/${trade ? "trade" : "admin"}/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Request failed");
    return d;
  }
  async function load(key = token) {
    setError("");
    try {
      if (trade) {
        setData(await api("bookings", undefined, key));
      } else {
        const [d, s, b, a] = await Promise.all([
          api("dashboard", undefined, key),
          api("suppliers", undefined, key),
          api("bookings", undefined, key),
          api("agents", undefined, key),
        ]);
        setAgents(a.agents);
        setData(d);
        setSuppliers(s.suppliers);
        setAgreements(s.agreements);
        setBookings(b.bookings);
      }
      setActive(true);
    } catch (e) {
      setError(String(e));
    }
  }
  async function select(reference: string) {
    try {
      const d = await api(`bookings/${encodeURIComponent(reference)}`);
      setSelected(d);
      setQ(
        d.commercial
          ? JSON.parse(d.commercial.quote_json)
          : structuredClone(emptyQuote),
      );
    } catch (e) {
      setError(String(e));
    }
  }
  const supplierOptions = suppliers.map((s) => ({
    value: s.id,
    label: s.name,
  }));
  const eligible = (data?.bookings || []).filter(
    (b: any) =>
      b.profit?.currency === filter &&
      ["confirmed", "completed"].includes(b.status),
  );
  const total = (key: string) =>
    eligible.reduce((s: number, b: any) => s + b.profit[key], 0);
  const monthRows: Record<
    string,
    { earned: number; cost: number; cash: number }
  > = {};
  for (const r of data?.receipts || []) {
    if (r.currency !== filter) continue;
    const key = r.received_on.slice(0, 7);
    monthRows[key] ||= { earned: 0, cost: 0, cash: 0 };
    if (r.kind === "direct_cost") monthRows[key].cost += r.amount_cents;
    else
      monthRows[key].cash +=
        (r.kind.endsWith("_reversal") ? -1 : 1) * r.amount_cents;
  }
  const groups = (key: string) => {
    const result: Record<string, number> = {};
    for (const b of eligible) {
      const name = b[key] || "Direct";
      result[name] = (result[name] || 0) + b.profit.netRevenueCents;
    }
    return result;
  };
  return (
    <main className="desk">
      <header>
        <a href="/">Easy Kosher SA</a>
        <h1>{trade ? "Travel trade portal" : "Revenue & reservations"}</h1>
        <p>
          Supplier-direct payment is the launch model. Amounts are shown in the
          selected currency. Access keys stay in this page’s memory.
        </p>
      </header>
      {!active ? (
        <Form
          fields={[f("token", "Access key", "password")]}
          label="Open workspace"
          onSave={async (v) => {
            setToken(v.token);
            await load(v.token);
          }}
        />
      ) : null}
      {!active ? null : (
        <>
          <nav className="deskNav">
            {(trade
              ? ["Bookings", "New group enquiry"]
              : [
                  "Dashboard",
                  "Suppliers",
                  "Agreements",
                  "Bookings",
                  "Receipts",
                  "Evidence",
                  "Invoices",
                  "Agents",
                  "Reminders",
                ]
            ).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPage(p);
                  setError("");
                }}
                aria-pressed={page === p}
              >
                {p}
              </button>
            ))}
            <button onClick={() => load()}>Refresh</button>
            <button
              onClick={() => {
                setToken("");
                setActive(false);
                setData(null);
                setSelected(null);
                setQ(structuredClone(emptyQuote));
              }}
            >
              Sign out
            </button>
          </nav>
          {trade ? (
            <>
              {page !== "New group enquiry" ? (
                <table>
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Destination</th>
                      <th>Guests</th>
                      <th>Status</th>
                      <th>Retail total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.bookings?.map((b: any) => (
                      <tr key={b.reference}>
                        <td>
                          <button onClick={() => setTradeRef(b.reference)}>
                            {b.reference}
                          </button>
                        </td>
                        <td>{b.destination}</td>
                        <td>{b.num_guests}</td>
                        <td>{b.status}</td>
                        <td>{money(b.retailTotalCents, b.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Form
                  fields={[
                    f("travellerName", "Lead traveller"),
                    f("payingCustomer", "Paying customer"),
                    f("destination", "Destination"),
                    f("guests", "Group size", "number", "20"),
                    f("guestEmail", "Guest email", "email"),
                    f("permissions", "Communication permissions", "textarea"),
                    f(
                      "notes",
                      "Rooms, allocations, transport and requirements",
                      "textarea",
                    ),
                  ]}
                  label="Request group reservation"
                  onSave={async (v) => {
                    const d = await api("enquiries", {
                      ...v,
                      guests: Number(v.guests),
                    });
                    setError(`Enquiry received: ${d.reference}`);
                    await load();
                  }}
                />
              )}
              {tradeRef && (
                <ReservationWorkflow
                  key={tradeRef}
                  api={api}
                  reference={tradeRef}
                  trade
                />
              )}
            </>
          ) : (
            <>
              {page === "Dashboard" && (
                <>
                  <div className="deskControls">
                    <label>
                      Currency
                      <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        {["ZAR", "USD", "EUR", "GBP"].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p>
                    {data.enquiries} enquiries · {data.confirmed}{" "}
                    confirmed/completed ·{" "}
                    {data.enquiries
                      ? ((100 * data.confirmed) / data.enquiries).toFixed(1)
                      : 0}
                    % conversion
                  </p>
                  <p>
                    Contracted figures below cover confirmed and completed
                    bookings. Receipts include all recorded transactions. No
                    currencies are combined.
                  </p>
                  <div className="metrics">
                    {[
                      ["Gross booking value", "bookingValueCents"],
                      ["Agreed revenue", "grossRevenueCents"],
                      ["Accommodation income", "accommodationRevenueCents"],
                      ["Transport income", "transportRevenueCents"],
                      ["Direct costs (estimated)", "directCostsCents"],
                      ["Contribution (estimated)", "contributionCents"],
                      ["Commission outstanding", "commissionOutstandingCents"],
                    ].map(([label, key]) => (
                      <article key={key}>
                        <span>{label}</span>
                        <strong>{money(total(key), filter)}</strong>
                      </article>
                    ))}
                    <article>
                      <span>Income actually received</span>
                      <strong>
                        {money(
                          Object.values(monthRows).reduce(
                            (s, r) => s + r.cash,
                            0,
                          ),
                          filter,
                        )}
                      </strong>
                    </article>
                    <article>
                      <span>Contribution margin</span>
                      <strong>
                        {total("netRevenueCents") > 0
                          ? (
                              (100 * total("contributionCents")) /
                              total("netRevenueCents")
                            ).toFixed(1) + "%"
                          : "—"}
                      </strong>
                    </article>
                  </div>
                  <h2>Monthly receipts and expenses</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Month received</th>
                        <th>Income received</th>
                        <th>Direct expenses paid</th>
                        <th>Cash contribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(monthRows).map(([m, r]) => (
                        <tr key={m}>
                          <td>{m}</td>
                          <td>{money(r.cash, filter)}</td>
                          <td>{money(r.cost, filter)}</td>
                          <td>{money(r.cash - r.cost, filter)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p>
                    Contribution excludes general overheads and income tax. It
                    is not net business profit.
                  </p>
                  {["customer", "agent"].map((key) => (
                    <section key={key}>
                      <h2>
                        Revenue by{" "}
                        {key === "agent" ? "tour operator" : "customer"}
                      </h2>
                      {Object.entries(groups(key)).map(([name, n]) => (
                        <p key={name}>
                          {name}: {money(n, filter)}
                        </p>
                      ))}
                    </section>
                  ))}
                  <h2>Supplier performance</h2>
                  {suppliers.map((s) => {
                    const ls = eligible.flatMap((b: any) =>
                      b.profit.lines.filter((l: any) => l.supplierId === s.id),
                    );
                    return (
                      <p key={s.id}>
                        {s.name}: {ls.length} confirmed booking lines ·{" "}
                        {money(
                          ls.reduce(
                            (n: number, l: any) => n + l.entitlementCents,
                            0,
                          ),
                          filter,
                        )}{" "}
                        agreed income ·{" "}
                        {money(
                          ls.reduce(
                            (n: number, l: any) => n + l.collectedCents,
                            0,
                          ),
                          filter,
                        )}{" "}
                        commission received
                      </p>
                    );
                  })}
                </>
              )}
              {page === "Suppliers" && (
                <>
                  <h2>Supplier register</h2>
                  {suppliers.map((s) => (
                    <p key={s.id}>
                      {s.name} · {s.type} · <code>{s.id}</code>
                    </p>
                  ))}
                  <Form
                    fields={[
                      f("name", "Supplier name"),
                      opt("type", "Supplier type", [
                        "accommodation",
                        "transport",
                      ]),
                      f("email", "Email", "email"),
                      f("location", "Location"),
                    ]}
                    onSave={async (v) => {
                      await api("suppliers", v);
                      await load();
                    }}
                  />
                </>
              )}
              {page === "Agreements" && (
                <>
                  <h2>Supplier agreement</h2>
                  <p>
                    10% is a proposal only. Confirmed agreements require
                    evidence of acceptance. Existing versions are retained.
                    Commissionable amounts must be checked against the recorded
                    exclusions.
                  </p>
                  <Form
                    fields={[
                      opt("supplierId", "Supplier", supplierOptions),
                      opt("state", "Agreement status", [
                        "proposed",
                        "confirmed",
                      ]),
                      opt("rateBasis", "Contracted rate", ["gross", "net"]),
                      opt("commissionType", "Commission type", [
                        "percent",
                        "fixed",
                      ]),
                      f(
                        "commissionPercent",
                        "Proposed commission %",
                        "number",
                        "10",
                      ),
                      f(
                        "fixedCommission",
                        "Fixed commission amount",
                        "number",
                        "0",
                      ),
                      ...[
                        "commissionableItems",
                        "nonCommissionableItems",
                        "groupDiscounts",
                        "vatTreatment",
                        "cancellationRefund",
                        "paymentResponsibilities",
                        "commissionDeadline",
                        "attributionProtection",
                      ].map((k, i) =>
                        f(
                          k,
                          [
                            "Commissionable items",
                            "Non-commissionable items",
                            "Group discounts and negotiated rates",
                            "VAT treatment and tax basis",
                            "Cancellation and refund provisions",
                            "Who collects, pays and invoices",
                            "Commission payment deadline rule",
                            "Booking attribution and commission protection provisions",
                          ][i],
                          "textarea",
                        ),
                      ),
                      f("validFrom", "Valid from", "date"),
                      f("validTo", "Valid until", "date"),
                      {
                        ...f(
                          "evidenceReference",
                          "Signed agreement / acceptance reference",
                        ),
                        required: false,
                      },
                      {
                        ...f("confirmedBy", "Supplier signatory"),
                        required: false,
                      },
                    ]}
                    onSave={async (v) => {
                      const {
                        supplierId,
                        state,
                        evidenceReference,
                        confirmedBy,
                        ...terms
                      } = v;
                      await api("agreements", {
                        supplierId,
                        state,
                        evidenceReference,
                        confirmedBy,
                        terms: {
                          ...terms,
                          commissionBps: Math.round(
                            Number(v.commissionPercent) * 100,
                          ),
                          fixedCommissionCents: amount(v.fixedCommission),
                        },
                      });
                      await load();
                    }}
                  />
                  {agreements.map((a) => (
                    <details key={a.id}>
                      <summary>
                        {suppliers.find((s) => s.id === a.supplier_id)?.name} ·
                        version {a.version} · {a.state}
                      </summary>
                      <p>Agreement reference: {a.id}</p>
                      {Object.entries(JSON.parse(a.terms_json)).map(
                        ([k, v]) => (
                          <p key={k}>
                            {k}: {String(v)}
                          </p>
                        ),
                      )}
                    </details>
                  ))}
                </>
              )}
              {page === "Bookings" && (
                <>
                  <h2>Managed reservations</h2>
                  <select
                    aria-label="Select booking"
                    value={selected?.booking.reference || ""}
                    onChange={(e) => e.target.value && select(e.target.value)}
                  >
                    <option value="">Select enquiry</option>
                    {bookings.map((b) => (
                      <option key={b.reference} value={b.reference}>
                        {b.client_name} · {b.reference}
                      </option>
                    ))}
                  </select>
                  {selected && (
                    <section
                      key={
                        selected.booking.reference +
                        ":" +
                        (selected.commercial?.revision || 0)
                      }
                    >
                      <h3>
                        {selected.booking.client_name} ·{" "}
                        {selected.booking.reference}
                      </h3>
                      <p>
                        All quote amounts below exclude VAT. Enter customer tax
                        separately. Payment, refund and expense fields record
                        agreed values; they do not initiate transactions.
                      </p>
                      <div className="deskForm">
                        <label>
                          Currency
                          <select
                            value={q.currency}
                            onChange={(e) =>
                              setQ({
                                ...q,
                                currency: e.target.value as Quote["currency"],
                              })
                            }
                          >
                            {["ZAR", "USD", "EUR", "GBP"].map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {q.lines.map((l) => (
                        <p key={l.id}>
                          {l.description}: {money(l.sellingCents, q.currency)} ·
                          line {l.id}{" "}
                          <button
                            onClick={() =>
                              setQ({
                                ...q,
                                lines: q.lines.filter((x) => x.id !== l.id),
                              })
                            }
                          >
                            Remove
                          </button>
                        </p>
                      ))}
                      <details>
                        <summary>Add accommodation or transport</summary>
                        <Form
                          fields={[
                            f("description", "Description"),
                            opt("category", "Category", [
                              "accommodation",
                              "transport",
                            ]),
                            opt(
                              "agreementId",
                              "Agreement",
                              agreements.map((a) => ({
                                value: a.id,
                                label: `${suppliers.find((s) => s.id === a.supplier_id)?.name || "Supplier"} · v${a.version} · ${a.state}`,
                              })),
                            ),
                            opt("incomeModel", "Income model", [
                              "commission",
                              "markup",
                            ]),
                            f("selling", "Customer selling price", "number"),
                            f(
                              "supplierCost",
                              "Supplier cost / payable before commission",
                              "number",
                            ),
                            f(
                              "commissionable",
                              "Eligible commission base",
                              "number",
                            ),
                            f("commissionDueOn", "Commission due date", "date"),
                            f(
                              "supplierReference",
                              "Supplier reservation reference",
                            ),
                          ]}
                          label="Add quote line"
                          onSave={async (v) => {
                            const a = agreements.find(
                              (a) => a.id === v.agreementId,
                            );
                            if (!a) throw Error("Select an agreement");
                            const t = JSON.parse(a.terms_json);
                            setQ({
                              ...q,
                              lines: [
                                ...q.lines,
                                {
                                  id: crypto.randomUUID(),
                                  description: v.description,
                                  category: v.category,
                                  supplierId: a.supplier_id,
                                  agreementId: a.id,
                                  agreementConfirmed: a.state === "confirmed",
                                  rateBasis: t.rateBasis,
                                  incomeModel: v.incomeModel,
                                  sellingCents: amount(v.selling),
                                  supplierCostCents: amount(v.supplierCost),
                                  commissionableCents: amount(v.commissionable),
                                  commissionType: t.commissionType,
                                  commissionBps: t.commissionBps,
                                  fixedCommissionCents: t.fixedCommissionCents,
                                  commissionDueOn: v.commissionDueOn,
                                  supplierReference: v.supplierReference,
                                },
                              ],
                            });
                          }}
                        />
                      </details>
                      <Form
                        fields={[
                          f(
                            "payingCustomer",
                            "Paying customer",
                            "text",
                            selected.commercial?.paying_customer ||
                              selected.booking.client_name,
                          ),
                          {
                            ...f(
                              "bookingAgent",
                              "Booking agent / operator",
                              "text",
                              selected.commercial?.booking_agent || "",
                            ),
                            required: false,
                          },
                          {
                            ...opt(
                              "agentId",
                              "Registered operator (blank for direct)",
                              [
                                { value: "", label: "Direct booking" },
                                ...agents.map((a) => ({
                                  value: a.id,
                                  label: a.name,
                                })),
                              ],
                            ),
                            value: selected.commercial?.agent_id || "",
                          },
                          f(
                            "travellerName",
                            "Lead traveller",
                            "text",
                            selected.commercial?.traveller_name ||
                              selected.booking.client_name,
                          ),
                          {
                            ...opt("status", "Reservation status", [
                              "enquiry",
                              "quoted",
                              "confirmed",
                              "completed",
                              "cancelled",
                            ]),
                            value: selected.commercial?.status || "enquiry",
                          },
                          {
                            ...opt("mode", "Communication model", [
                              "direct",
                              "operator",
                            ]),
                            value: selected.commercial
                              ? JSON.parse(
                                  selected.commercial.communication_json,
                                ).mode
                              : "direct",
                          },
                          f(
                            "guestEmail",
                            "Guest email",
                            "email",
                            selected.booking.client_email,
                          ),
                          opt(
                            "copyGuest",
                            "Copy guest in supplier correspondence",
                            ["yes", "no"],
                          ),
                          f(
                            "permissions",
                            "Recorded guest / operator communication permission",
                            "textarea",
                            selected.commercial
                              ? JSON.parse(
                                  selected.commercial.communication_json,
                                ).permissions
                              : "",
                          ),
                          {
                            ...f(
                              "customerApproval",
                              "Customer accepted quotation reference",
                              "text",
                              selected.commercial?.customer_approval || "",
                            ),
                            required: false,
                          },
                          {
                            ...f(
                              "supplierConfirmation",
                              "Supplier confirmation evidence",
                              "text",
                              selected.commercial?.supplier_confirmation || "",
                            ),
                            required: false,
                          },
                          ...[
                            "serviceFeeCents",
                            "processingCents",
                            "discountCents",
                            "revenueReversalCents",
                            "otherDirectCents",
                            "customerRefundCents",
                            "supplierRefundCents",
                            "outputVatCents",
                            "minimumContributionCents",
                          ].map((k, i) =>
                            f(
                              k,
                              [
                                "Agreed service fee",
                                "Processing costs",
                                "Discount funded by Easy Kosher SA",
                                "Reversed earnings",
                                "Other direct costs",
                                "Customer refunds (tracking only)",
                                "Supplier refunds (tracking only)",
                                "Customer VAT total",
                                "Minimum required contribution",
                              ][i],
                              "number",
                              String((q as any)[k] / 100),
                            ),
                          ),
                          {
                            ...f(
                              "serviceFeeApproval",
                              "Service fee acceptance reference",
                              "text",
                              q.serviceFeeApproval,
                            ),
                            required: false,
                          },
                        ]}
                        label="Save commercial terms"
                        onSave={async (v) => {
                          const quote = {
                            ...q,
                            serviceFeeApproval: v.serviceFeeApproval,
                          };
                          for (const k of [
                            "serviceFeeCents",
                            "processingCents",
                            "discountCents",
                            "revenueReversalCents",
                            "otherDirectCents",
                            "customerRefundCents",
                            "supplierRefundCents",
                            "outputVatCents",
                            "minimumContributionCents",
                          ])
                            (quote as any)[k] = amount(v[k]);
                          await api(`bookings/${selected.booking.reference}`, {
                            ...v,
                            revision: selected.commercial?.revision || 0,
                            paymentModel: "supplier_collects",
                            quote,
                            communication: {
                              mode: v.mode,
                              guestEmail: v.guestEmail,
                              copyGuest: v.copyGuest === "yes",
                              permissions: v.permissions,
                            },
                          });
                          await select(selected.booking.reference);
                          await load();
                        }}
                      />
                      <h3>Saved profitability</h3>
                      {selected.profit.warnings.map((w: string) => (
                        <p className="warning" key={w}>
                          {w}
                        </p>
                      ))}
                      {[
                        ["Booking value", "bookingValueCents"],
                        ["Easy Kosher SA revenue", "grossRevenueCents"],
                        ["Supplier payable", "supplierCostCents"],
                        ["Estimated contribution", "contributionCents"],
                        ["Commission due", "commissionDueCents"],
                        ["Commission collected", "commissionCollectedCents"],
                      ].map(([label, k]) => (
                        <p key={k}>
                          {label}: {money(selected.profit[k], q.currency)}
                        </p>
                      ))}
                      <ReservationWorkflow
                        api={api}
                        reference={selected.booking.reference}
                        suppliers={suppliers}
                      />
                      <details>
                        <summary>Permanent audit trail</summary>
                        {selected.events.map((e: any) => (
                          <p key={e.id}>
                            {e.created_at} · {e.kind} · {e.actor} ·{" "}
                            {e.payload_json}
                          </p>
                        ))}
                      </details>
                    </section>
                  )}
                </>
              )}
              {page === "Receipts" && (
                <>
                  <h2>Record income received or a direct expense</h2>
                  <p>
                    Record a cleared bank/payment transaction with its unique
                    reference. This form does not collect money or send payouts.
                    Reversals are separate entries.
                  </p>
                  <Form
                    fields={[
                      f("id", "Unique bank transaction reference"),
                      f("reference", "Easy Kosher SA booking reference"),
                      {
                        ...f(
                          "lineId",
                          "Quote line reference (commission or markup)",
                        ),
                        required: false,
                      },
                      opt("kind", "Transaction type", [
                        "commission",
                        "service_fee",
                        "markup",
                        "commission_reversal",
                        "service_fee_reversal",
                        "markup_reversal",
                        "direct_cost",
                      ]),
                      f("amount", "Amount", "number"),
                      opt("currency", "Currency", ["ZAR", "USD", "EUR", "GBP"]),
                      f("receivedOn", "Transaction date", "date"),
                      f(
                        "evidenceReference",
                        "Bank / provider evidence reference",
                      ),
                    ]}
                    onSave={async (v) => {
                      await api("receipts", {
                        ...v,
                        amountCents: amount(v.amount),
                      });
                      await load();
                    }}
                  />
                </>
              )}
              {page === "Evidence" && (
                <>
                  <h2>Reservation evidence</h2>
                  <p>
                    Retain the original document or email in your existing
                    secure records and record its reference here. Use this for
                    correspondence, room allocations, customer approval and
                    direct supplier payments.
                  </p>
                  <Form
                    fields={[
                      f("reference", "Booking reference"),
                      opt("kind", "Evidence type", [
                        "supplier_correspondence",
                        "customer_approval",
                        "supplier_confirmation",
                        "supplier_direct_payment",
                        "room_allocation",
                        "trade_rate_approval",
                        "cancellation",
                        "refund_evidence",
                      ]),
                      f("evidenceReference", "Document / message reference"),
                      f("notes", "Notes", "textarea"),
                    ]}
                    onSave={async (v) => {
                      await api("evidence", v);
                    }}
                  />
                </>
              )}
              {page === "Invoices" && (
                <>
                  <h2>Supplier invoice register</h2>
                  <p>
                    Recording an invoice or payment does not authorise or
                    execute a payout.
                  </p>
                  <Form
                    fields={[
                      {
                        ...f(
                          "id",
                          "Existing invoice record ID (leave empty for new)",
                        ),
                        required: false,
                      },
                      f("reference", "Booking reference"),
                      opt("supplierId", "Supplier", supplierOptions),
                      f("invoiceReference", "Supplier invoice number"),
                      f("amount", "Invoice total", "number"),
                      f("paid", "Paid to date", "number", "0"),
                      opt("currency", "Currency", ["ZAR", "USD", "EUR", "GBP"]),
                      f("dueOn", "Due date", "date"),
                      f(
                        "evidenceReference",
                        "Invoice and payment evidence reference",
                      ),
                    ]}
                    onSave={async (v) => {
                      await api("invoices", {
                        ...v,
                        amountCents: amount(v.amount),
                        paidCents: amount(v.paid),
                      });
                      await load();
                    }}
                  />
                  {data.invoices.map((i: any) => (
                    <p key={i.id}>
                      {i.invoice_reference} · {i.id} ·{" "}
                      {money(i.amount_cents - i.paid_cents, i.currency)}{" "}
                      outstanding · due {i.due_on}
                    </p>
                  ))}
                </>
              )}
              {page === "Agents" && (
                <>
                  <h2>Register trade partner</h2>
                  <p>
                    Issue a unique access key securely. Partners use /trade and
                    can see only their own booking references, retail totals and
                    status. Supplier net rates remain private.
                  </p>
                  <Form
                    fields={[
                      f("name", "Operator / agent name"),
                      f("email", "Email", "email"),
                      f(
                        "token",
                        "Unique access key (at least 32 characters)",
                        "password",
                      ),
                    ]}
                    onSave={async (v) => {
                      await api("agents", v);
                    }}
                  />
                </>
              )}
              {page === "Reminders" && (
                <>
                  <h2>Overdue items</h2>
                  <p>
                    Reminder drafts are ready for authorised sending through
                    your existing email service. No email is sent automatically.
                  </p>
                  {data.reminders.map((r: any) => (
                    <article key={r.reference + r.supplierId}>
                      <h3>{r.subject}</h3>
                      <p>{r.body}</p>
                      <button
                        onClick={() => navigator.clipboard.writeText(r.body)}
                      >
                        Copy reminder
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await api("mail", {
                              reference: r.reference,
                              supplierId: r.supplierId,
                              subject: r.subject,
                              body: r.body,
                              confidentiality: "booking",
                            });
                            await select(r.reference);
                            setPage("Bookings");
                          } catch (e) {
                            setError(String(e));
                          }
                        }}
                      >
                        Prepare email for approval
                      </button>
                    </article>
                  ))}
                  {data.invoices
                    .filter(
                      (i: any) =>
                        i.paid_cents < i.amount_cents &&
                        i.due_on < new Date().toISOString().slice(0, 10),
                    )
                    .map((i: any) => (
                      <p key={i.id}>
                        Supplier invoice {i.invoice_reference} · {i.reference} ·{" "}
                        {money(i.amount_cents - i.paid_cents, i.currency)}{" "}
                        overdue since {i.due_on}
                      </p>
                    ))}
                </>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
    </main>
  );
}
