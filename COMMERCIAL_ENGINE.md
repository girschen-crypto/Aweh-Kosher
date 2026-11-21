# Easy Kosher SA commercial engine

This branch adds a managed reservations and revenue workspace to the existing Cloudflare Worker, React application and D1 database. It adds no paid APIs, hosting services or subscriptions. It is a reviewable implementation, not evidence that any supplier has accepted a commission or that revenue has been earned.

## Ready for integration review

- `/revenue`: session-protected supplier register, immutable agreement versions, reservation quotes, profit calculator, receipt and expense ledger, evidence references, supplier invoice register, overdue reminder drafts and dashboard.
- `/trade`: registered operator enquiry creation for groups of 2–1,000, paying-customer and traveller identities, own booking statuses, contracted trade quotations, suggested retail totals and room allocations. Operator keys are hashed at rest; supplier net costs and other operators' bookings are excluded from responses.
- New public and trade enquiries get UUID-based EKSA references. Existing enquiry references are preserved.
- Supplier terms record gross/net basis, percent/fixed commission, proposed 10% defaults, eligible items and exclusions, group discounts, VAT treatment, cancellation/refunds, collection responsibilities, deadlines, attribution provisions, validity dates, acceptance evidence and signatory. Agreements cannot be edited or deleted; create a new version.
- Quotes snapshot the exact agreement version. Confirmed terms are read from the database, never trusted from browser commission settings. Unconfirmed agreements earn zero commission. A booking cannot be confirmed or completed without a positive sufficient contribution, recorded customer approval, supplier confirmation, supplier references and communication permissions.
- Receipts record cleared income, direct expenses and reversals. Bank transaction references are unique. No payment, refund or payout is initiated.
- Financial events and receipts cannot be overwritten or deleted through the schema. Quotation updates use optimistic revision checks and retain snapshots. Completed commercial records are locked.
- Reminder drafts show overdue commissions and supplier invoices. They can be added to the approval outbox; copying or drafting a reminder sends nothing.
- Versioned printable customer and trade quotations reconcile with saved booking prices. Coordination invoices cover accepted service fees only and never invoice supplier accommodation/transport funds. Structured room allocations retain supplier references, room counts, guest counts, dates and state.
- Supplier email outbox enforces guest CC for authorised direct bookings, operator permissions and confidential trade restrictions. Drafting, approval and sending are separate actions. An optional existing-service bridge records confirmed provider message IDs. Uncertain results block automatic retry.

## Financial basis

All engine monetary inputs and bank receipt entries are **VAT exclusive**, stored as integer cents, with one currency per booking. Record receipt amounts net of VAT and retain the gross bank evidence for reconciliation. Record customer-facing VAT separately in `outputVatCents`. Supplier VAT treatment is recorded in the agreement; this implementation does not infer registration, calculate tax eligibility, or automatically account for input VAT. An accountant must configure the agreed bases before live use.

Gross commission model: commission = eligible commission base × agreed percentage (or agreed fixed amount). Supplier economic cost = selling amount less commission. The customer may still owe the supplier the full gross price when the supplier collects; the commission is a separate receivable, not a reduction to the customer's payment.

Net markup model: earned markup = selling amount − net supplier cost. Do not also add a commission on that line. A net contracted rate is required.

Easy Kosher SA gross revenue = accommodation earnings + transport earnings + accepted coordination fees. Net earned revenue deducts recorded reversals. Estimated contribution deducts processing costs, discounts funded by Easy Kosher SA and other direct costs. Supplier costs are already accounted for in the markup or commission calculation and are not deducted twice.

Customer and supplier refund amounts are tracking fields. Use a revenue reversal only for Easy Kosher SA's lost earnings; do not subtract the whole customer refund from commission income. Receipt reversals separately reflect money actually returned. Customer booking value includes the disclosed fee, discounts and entered VAT.

Actual income means entered cleared receipts less receipt reversals. It is distinct from contracted earnings, gross booking value and cash held for suppliers. Dashboard currencies never mix. Monthly cash contribution excludes general overheads and income tax and must not be described as net business profit. The current dashboard is based on manually reconciled records, not a bank feed.

## Integration still required before a commercial launch

1. Configure a strong `ADMIN_TOKEN` Cloudflare Worker secret. Without it administrator sign-in fails closed. Browser sign-in creates a random HttpOnly, Secure (on HTTPS), SameSite=Strict cookie lasting up to eight hours; the raw access code is not retained in browser storage. Sign-out deletes the server session. Operator sessions and keys are immediately disabled through Agents → Revoke access. Login attempts are limited. The launch configuration uses one administrator and individually registered operators; named staff roles and self-service recovery are not included. Existing authenticated integrations may continue to use a bearer key.
2. Apply `migrations/0002_commercial.sql`, `0003_trade_documents.sql` `0004_mail_outbox.sql`, `0005_earnings_adjustments.sql` and `0006_access_sessions.sql` to the existing database after backing it up. The enquiry creation path now writes its attribution event in the same transaction, so deploy the schema before the Worker. Never reset production data.
3. Test migrated production-like data and complete browser acceptance testing. Local verification includes TypeScript for frontend and Worker, the production build, financial tests and SQLite-backed API tests. The disposable local browser workflow exercised public enquiry, explicit guest-copying consent, supplier registration, recorded agreement acceptance, reservation confirmation, correct R10,000/R1,000 booking/commission separation, room allocation, quotation creation, commission receipt, the dashboard and operator data separation. Later session, adjustment and validation changes are covered by SQLite-backed tests. Production Cloudflare D1 deployment and real provider email submission remain unverified.
4. Connect the existing authorised email system using the documented `EMAIL_BRIDGE_URL` and `EMAIL_BRIDGE_TOKEN` contract in `EMAIL_BRIDGE_CONTRACT.md`. The bridge is implemented as a fail-closed adapter; no existing bridge address or credential was available. Guest CC rules are checked both when drafting and immediately before sending. Incoming mail synchronisation, provider threading and attachments still require the existing service's integration. Reminders require staff approval and sending; unattended scheduled dispatch is not enabled. Recorded permissions and outbox rows do not mean an email was sent.
5. Issue accepted supplier terms and operator pricing through the reservation workflow. Formal quotations, service invoices, operator-scoped contracted rate views and structured room allocations are implemented. Payment and cancellation terms are entered by staff from the actual accepted contracts. The portal is a managed trade workflow, not live supplier inventory. Customer approval is recorded by reference to original evidence.
6. Establish supplier signed agreements and verify real kosher listing evidence. The existing public journey list is retained; a verified hotel/shul/bakery distance directory is outside this revenue increment. Do not represent existing entries as newly verified.
7. Model B is deliberately rejected by the API. Enable only after payment-provider approval for the exact business model, signed supplier terms, liability accounting, reconciliation, payment/refund authorisation and end-to-end tests. No Yoco collection or payout integration is included in this increment.

## Release procedure

The existing manually triggered Cloudflare deployment workflow is retained, now with dependency install, tests and frontend build before migration and deployment. No deployment is triggered by opening this branch or pull request. Production deployment requires the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets and the separately configured `ADMIN_TOKEN` runtime secret. Review and authorise the concrete release only after the integration gaps above are resolved.

Validation: 17 passing tests, Node 24, `npm ci --ignore-scripts`, `npm test`, `npm run build`. The tests use an in-memory SQLite database with both real migrations and exercise calculations, unconfirmed commissions, markup, refunds/reversals, currency isolation, API access controls, evidence gates, optimistic saves, idempotent receipts, immutable audit records and trade isolation.

## Release hardening

- Public enquiries retain the requested group size (up to 1,000), validate dates and record explicit permission to copy the guest. An enquiry is not represented as a booking or payment.
- Receipt entry uses booking and named income-item selectors. It rejects future transaction dates. Cleared receipts stay separate from agreed earnings.
- Post-completion earnings reductions/restorations use an immutable adjustment ledger and update commission receivables without pretending a bank refund occurred. Reversals/restorations use SQL guards inside atomic batches. Original documents and quotes remain intact.
- Cancelled bookings retain supported commission receivables until a recorded earnings adjustment changes that entitlement. Cancellation does not silently erase a supplier debt.
- The deployment workflow checks that protected admin access is configured, records a D1 recovery bookmark before applying migrations, and verifies public endpoints and unauthorised access after deployment. No production-data backup is uploaded to the public repository.
- The local development server uses disposable memory data. Its demo access and UI are excluded from the production Worker and the production browser bundle. See OPERATING_GUIDE.md for staff steps.
