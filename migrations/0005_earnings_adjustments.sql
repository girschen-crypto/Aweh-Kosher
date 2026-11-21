CREATE TABLE earnings_adjustments (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL REFERENCES bookings(reference),
 line_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('reversal','restoration')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 currency TEXT NOT NULL, evidence_reference TEXT NOT NULL, reason TEXT NOT NULL,
 actor TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER earnings_adjustments_no_update BEFORE UPDATE ON earnings_adjustments BEGIN SELECT RAISE(ABORT,'Earnings adjustments are immutable'); END;
CREATE TRIGGER earnings_adjustments_no_delete BEFORE DELETE ON earnings_adjustments BEGIN SELECT RAISE(ABORT,'Earnings adjustments are retained'); END;
CREATE INDEX adjustment_booking ON earnings_adjustments(reference);
