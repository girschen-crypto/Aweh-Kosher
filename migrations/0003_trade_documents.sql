CREATE TABLE booking_documents (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL REFERENCES bookings(reference),
 kind TEXT NOT NULL CHECK(kind IN ('quotation','trade_quotation','service_invoice')),
 audience TEXT NOT NULL CHECK(audience IN ('customer','trade')),
 revision INTEGER NOT NULL, payload_json TEXT NOT NULL,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(reference,kind,revision)
);
CREATE TRIGGER booking_documents_no_update BEFORE UPDATE ON booking_documents BEGIN SELECT RAISE(ABORT,'Documents are immutable; issue a new version'); END;
CREATE TRIGGER booking_documents_no_delete BEFORE DELETE ON booking_documents BEGIN SELECT RAISE(ABORT,'Documents are retained'); END;
CREATE TABLE room_allocations (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL REFERENCES bookings(reference),
 supplier_id TEXT NOT NULL REFERENCES suppliers(id), room_type TEXT NOT NULL,
 rooms INTEGER NOT NULL CHECK(rooms>0), guests INTEGER NOT NULL CHECK(guests>0),
 arrival TEXT NOT NULL, departure TEXT NOT NULL, allocation_reference TEXT NOT NULL,
 notes TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('requested','held','confirmed','released')),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX allocations_booking ON room_allocations(reference);
