CREATE TABLE booking_mail (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL REFERENCES bookings(reference),
 supplier_id TEXT NOT NULL REFERENCES suppliers(id), recipients_json TEXT NOT NULL,
 subject TEXT NOT NULL, body TEXT NOT NULL, confidentiality TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved','sending','sent','unknown')),
 approved_by TEXT, provider_message_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
