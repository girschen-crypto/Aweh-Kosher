# Easy Kosher SA reservations desk

## Access

Open the application's **Reservations desk** link. Enter the administrator access code configured for the existing Cloudflare Worker. The browser session expires after eight hours. Use **Sign out** on a shared device.

Registered operators use **Tour operators** and their individual code. They can see only their own requests, contracted quotations, invoices issued to them and room allocations. Supplier cost rates remain internal. To disable an operator immediately, open **Agents** and select **Revoke access**.

The local preview has a conspicuous **Demonstration workspace** banner and an **Open demonstration workspace** button. Its records and codes are fictitious and disposable. These controls are excluded from the production build.

## Before quoting a supplier

1. Open **Suppliers**, enter the supplier name, accommodation/transport type, email and location, then **Save record**.
2. Open **Agreements** and choose that supplier. Start with **proposed**. Enter the actual negotiated rate basis, commission, exclusions, group rates, VAT treatment, cancellation/refund terms, payment responsibilities, commission deadline, booking attribution, and validity dates.
3. Use **confirmed** only after the supplier accepts the terms. Record the original signed agreement or acceptance email reference and the supplier signatory. Save a new version if the terms change. A proposed 10% commission is not income.

## Process an enquiry

1. A guest uses **Plan a trip**. Their enquiry reference and guest-copy permission are saved automatically. An operator uses **New group enquiry**.
2. Open **Bookings** and select the guest/group. Confirm the paying customer, agent/operator, traveller and travel date. Assign the registered operator for trade bookings.
3. Expand **Add accommodation or transport**. Choose the actual agreement, describe the service, enter selling price and eligible commission base, due date and supplier reservation reference. Use a net rate only with the agreed markup model. Select **Add quote line**.
4. Enter any disclosed coordination fee and its acceptance evidence. Enter expected direct costs, discounts, VAT and the required minimum contribution. Amounts in the commercial calculator exclude VAT; enter the customer-facing tax separately.
5. Record the guest/operator communication permission. Direct supplier emails require authorisation to copy the guest. Trade messages follow operator permissions and protect confidential rates.
6. Save as **quoted** while awaiting acceptance. Choose **confirmed** only when the quotation is accepted, the supplier has confirmed, the references are recorded and the booking has an agreed sufficient contribution.

## Quotation, rooms and email

Under the selected booking:

- **Issue quotation or coordination invoice** creates an immutable document version. Customer quotations show the full selling price and payment responsibilities. Trade quotations are private to the assigned operator. A coordination invoice covers only the accepted Easy Kosher SA service fee; it never invoices supplier funds under the supplier-collects model. Select **Print or save PDF**.
- **Room allocations** records supplier reference, room type/count, guest count, dates and requested/held/confirmed/released state. A requested allocation is not a confirmed room booking.
- **Prepare supplier email** creates a draft with the saved recipients and guest/operator copying rules. Load correspondence, inspect the recipients and text, **Approve message**, then **Send approved email**. Sending is disabled until the authorised email service is connected. A sent status with a provider ID proves provider submission, not guest receipt. Reconcile uncertain outcomes before preparing another message.
- **Evidence** records references to original customer approvals, supplier confirmations, correspondence, direct supplier payments and refund/cancellation evidence. Keep the original documents in the existing secure records system.

## Receive and reconcile income

1. Open **Receipts** and select the booking.
2. Select the transaction type and named income item. Enter the unique bank/provider transaction reference, cleared amount excluding VAT, date and evidence reference.
3. Select **Record transaction**. This records money already moved; it does not charge, refund or pay anyone.
4. Record a return of received income as a separate reversal. Never delete the original bank record.
5. If an agreed commission or fee changes after cancellation, use **Earnings adjustments**. Select the booking and income item, record the reduction or restoration with reason and accepted evidence. This changes the receivable but does not pretend a bank refund occurred.

## Daily controls

Review **Dashboard** for booking value, agreed earnings, actual receipts, direct costs, estimated contribution and outstanding commissions. Use one currency at a time. Contribution excludes general overheads and income tax.

Review **Reminders** for overdue commissions and supplier invoices. Prepare a reminder in the email outbox, then inspect and authorise it. Record supplier invoices and actual payment evidence under **Invoices**. The platform does not execute supplier payouts.

Do not mark a booking complete without identifiable agreed income, supplier confirmation and a reconciled record of receipts and amounts still outstanding. Real supplier terms, verified kosher arrangements and actual availability must be established by the reservations team; the software does not invent them.
