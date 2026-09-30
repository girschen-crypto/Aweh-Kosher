# Travel Aweh sales-engine release gate (30 September 2026)

This change builds on `cloudflare-rebuild` and supersedes stale PR #4, while retaining the existing Aweh Kosher books section and URLs. The customer brand remains **Travel Aweh** pending any verified alternative. Do **not** rename to Travel Lekker: an independent SA agency already trades under that name.

## Built in this branch

- Mobile-friendly, no-login 1–5 day starter planner for Tsitsikamma, Plettenberg Bay and Garden Route, including group sizes, style, start date and an optional kosher requirement.
- Snapshot-based planner result and direct **Request a tailored quote** action. Prefilled enquiries retain the planned route, date, group and kosher specialist note.
- Optional accommodation, activity and GuideGo outgoing partner links; missing links safely fall back to enquiries and do not pretend to be booked.
- Travel Aweh remains customer-facing; OR Africa receives only relevant specialist kosher handoffs where needed. Existing English/Hebrew book cards are retained.
- Enquiries record sanitized `utm_source`, `utm_medium`, `utm_campaign` (or direct/untagged) in notes, so the operator can compare enquiry sources without a paid analytics service.
- Cloudflare manual deploy workflow now compiles frontend; optional, approved partner URLs come from repo variables `VITE_VIATOR_AFFILIATE_URL`, `VITE_BOOKING_AFFILIATE_URL`, `VITE_GUIDEGO_PUBLIC_URL`.

## Release checks — not yet confirmed

1. GitHub Actions validation must actually run `npm install`, `npm run build`, bundle Worker and check D1 migrations. A green PR mergeability check alone is **not** a build test.
2. Test planner on mobile/desktop. Change preferences after generating: actions must use the generated snapshot. Test a non-kosher lead and a kosher lead.
3. Test successful enquiry end-to-end in the intended Cloudflare D1 environment, with customer receipt and operator notification verified. Never send an actual supplier booking or charge a test guest.
4. Set partner URL repository variables **only after** programme approval and actual tracked URLs have been obtained; leave blank before approval. Verify commission attribution via the relevant partner dashboard, not by click behaviour alone.
5. Confirm live target, D1 binding, legitimate business/contact details, Privacy/Terms/affiliate disclosure and the domain before public promotion. Site content must describe enquiries accurately: **submitting is not an instant booking**.
6. Existing `main` is diverged from `cloudflare-rebuild`. Do **not** force-merge the branches or enable automatic production deploy without a reconciliation and backup.
7. After proven end-to-end results, consolidate the old AwehGO travel marketplace with Travel Aweh or route users between them deliberately. Avoid fragmented lead capture.

## Revenue measurement

Weekly: unique enquiries by UTM source; qualified enquiries; written quotes issued; paid, **confirmed** bookings; supplier payout; net contribution per completed booking. Affiliate clicks are not sales and no linked affiliate IDs are currently confirmed.

No new paid subscriptions are required for this implementation.