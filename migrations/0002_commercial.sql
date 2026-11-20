-- Existing enquiries remain intact. All money in the commercial engine is integer cents.
CREATE TABLE commercial_agents (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE supplier_agreements (
 id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 version INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('proposed','confirmed')),
 terms_json TEXT NOT NULL, evidence_reference TEXT, confirmed_by TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(supplier_id,version),
 CHECK(state <> 'confirmed' OR (length(evidence_reference)>0 AND length(confirmed_by)>0))
);
CREATE TABLE booking_commercial (
 reference TEXT PRIMARY KEY REFERENCES bookings(reference),
 revision INTEGER NOT NULL DEFAULT 1, payment_model TEXT NOT NULL DEFAULT 'supplier_collects'
 CHECK(payment_model IN ('supplier_collects','platform_collects')),
 agent_id TEXT REFERENCES commercial_agents(id), paying_customer TEXT NOT NULL,
 booking_agent TEXT, traveller_name TEXT NOT NULL,
 communication_json TEXT NOT NULL, quote_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'enquiry',
 customer_approval TEXT, supplier_confirmation TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE commercial_events (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL REFERENCES bookings(reference),
 kind TEXT NOT NULL, actor TEXT NOT NULL, payload_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER commercial_events_no_update BEFORE UPDATE ON commercial_events BEGIN SELECT RAISE(ABORT,'Audit events are immutable'); END;
CREATE TRIGGER commercial_events_no_delete BEFORE DELETE ON commercial_events BEGIN SELECT RAISE(ABORT,'Audit events are immutable'); END;
CREATE TRIGGER supplier_agreements_no_update BEFORE UPDATE ON supplier_agreements BEGIN SELECT RAISE(ABORT,'Create a new agreement version'); END;
CREATE TRIGGER supplier_agreements_no_delete BEFORE DELETE ON supplier_agreements BEGIN SELECT RAISE(ABORT,'Agreements are retained'); END;
CREATE TABLE commercial_receipts (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL REFERENCES bookings(reference),
 line_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('commission','service_fee','markup','commission_reversal','service_fee_reversal','markup_reversal','direct_cost')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), currency TEXT NOT NULL,
 evidence_reference TEXT NOT NULL, received_on TEXT NOT NULL, actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER commercial_receipts_no_update BEFORE UPDATE ON commercial_receipts BEGIN SELECT RAISE(ABORT,'Use a reversal entry'); END;
CREATE TRIGGER commercial_receipts_no_delete BEFORE DELETE ON commercial_receipts BEGIN SELECT RAISE(ABORT,'Receipts are retained'); END;
CREATE TABLE supplier_invoices (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL REFERENCES bookings(reference),
 supplier_id TEXT NOT NULL REFERENCES suppliers(id), invoice_reference TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), currency TEXT NOT NULL,
 due_on TEXT NOT NULL, paid_cents INTEGER NOT NULL DEFAULT 0 CHECK(paid_cents>=0),
 evidence_reference TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX events_reference ON commercial_events(reference,created_at);
CREATE INDEX receipts_reference ON commercial_receipts(reference);
