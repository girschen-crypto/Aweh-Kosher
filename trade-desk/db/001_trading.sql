-- Apply to an approved existing PostgreSQL database. Not auto-provisioned on deploy.
CREATE TABLE IF NOT EXISTS td_control (
  id integer PRIMARY KEY CHECK(id=1),
  data jsonb NOT NULL DEFAULT '{"mode":"PAPER","stopped":false,"approval":null}'::jsonb
);
INSERT INTO td_control(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS td_trades (
  id text PRIMARY KEY,
  mode text NOT NULL CHECK(mode IN ('PAPER','LIVE')),
  signal_key text NOT NULL,
  state text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE(mode,signal_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS td_one_active_position ON td_trades(mode)
  WHERE state NOT IN ('CLOSED','CANCELLED','REJECTED');
CREATE TABLE IF NOT EXISTS td_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trade_id text,
  kind text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS td_events_time ON td_events(created_at DESC);
