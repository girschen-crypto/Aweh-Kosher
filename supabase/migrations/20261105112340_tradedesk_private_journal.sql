-- Reuse the existing TradeDesk project. This schema is not exposed through Data API.
CREATE SCHEMA IF NOT EXISTS tradedesk;
REVOKE ALL ON SCHEMA tradedesk FROM PUBLIC, anon, authenticated;
CREATE TABLE tradedesk.td_control (
  id integer PRIMARY KEY CHECK (id=1),
  data jsonb NOT NULL DEFAULT '{"mode":"PAPER","stopped":false,"approval":null}'::jsonb
);
INSERT INTO tradedesk.td_control(id) VALUES (1);
CREATE TABLE tradedesk.td_trades (
  id text PRIMARY KEY, mode text NOT NULL CHECK(mode='PAPER'), signal_key text NOT NULL,
  state text NOT NULL CHECK(state IN ('RESERVED','OPEN','CLOSED','CANCELLED','REJECTED')),
  data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
  UNIQUE(mode,signal_key)
);
CREATE UNIQUE INDEX td_one_active_position ON tradedesk.td_trades(mode)
  WHERE state NOT IN ('CLOSED','CANCELLED','REJECTED');
CREATE TABLE tradedesk.td_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, trade_id text, kind text NOT NULL,
  data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX td_events_time ON tradedesk.td_events(created_at DESC);
CREATE TABLE tradedesk.cycle_lease (
  id integer PRIMARY KEY CHECK(id=1), owner text, epoch integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT '-infinity'
);
INSERT INTO tradedesk.cycle_lease(id) VALUES(1);
CREATE TABLE tradedesk.runtime_secrets (name text PRIMARY KEY, sha256 text NOT NULL CHECK(length(sha256)=64));
CREATE TABLE tradedesk.forward_observations (
  scanned_at timestamptz PRIMARY KEY, recorded_at timestamptz NOT NULL DEFAULT now(),
  policy_hash text NOT NULL, deploy_id text NOT NULL, data jsonb NOT NULL
);
ALTER TABLE tradedesk.td_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE tradedesk.td_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE tradedesk.td_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tradedesk.cycle_lease ENABLE ROW LEVEL SECURITY;
ALTER TABLE tradedesk.runtime_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tradedesk.forward_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA tradedesk FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tradedesk FROM PUBLIC, anon, authenticated;
