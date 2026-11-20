# Existing email service adapter

No email account, subscription or external service is created by this branch. The optional adapter lets an existing authorised service send approved outbox messages. Without both settings below, sending returns HTTP 503 and the message stays approved but unsent.

Cloudflare Worker configuration:

- `EMAIL_BRIDGE_URL`: the existing service's exact HTTPS send endpoint, configured by the operator. No endpoint is inferred or provisioned.
- `EMAIL_BRIDGE_TOKEN`: a Worker secret accepted by that endpoint. Never commit it, expose it in the frontend, or copy it into a URL.

The Worker calls the configured endpoint with:

```http
POST <configured endpoint>
Authorization: Bearer <secret>
Content-Type: application/json
Idempotency-Key: <outbox UUID>
```

```json
{
  "idempotencyKey": "outbox UUID",
  "reference": "EKSA booking reference",
  "to": ["recorded supplier email"],
  "cc": ["authorised guest or operator email"],
  "subject": "EKSA reference | approved subject",
  "text": "approved plain text body"
}
```

The bridge must use the user's authorised existing sender account, preserve the recipients and CC list, deduplicate the idempotency key before submitting to the provider, and return a stable provider result. It must not silently substitute recipients, auto-forward confidential rates, send marketing, or execute booking/payment instructions.

A successful response must be HTTP 2xx with:

```json
{"status":"sent","providerMessageId":"stable message identifier"}
```

Here `sent` means the email provider accepted submission, not that the recipient read or received it. Provider bounces, replies and delivery receipts must be reconciled through the existing email system. The adapter does not invent delivery proof.

The Worker refuses redirects and times out after 20 seconds. Ambiguous outcomes are marked `unknown`; automatic retry is blocked to avoid duplicate correspondence. Reconcile the outbox UUID with the service before preparing another draft. A message already submitted cannot be sent again through the endpoint.

Test with a controlled mailbox before enabling live use. Verify sender ownership, supplier recipient, guest/operator CC, confidential trade handling, idempotency, provider message IDs, bounces and reply threading. No live send was performed during implementation.
