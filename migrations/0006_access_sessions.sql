CREATE TABLE access_sessions (
 token_hash TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin','trade')),
 agent_id TEXT REFERENCES commercial_agents(id), expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX access_session_expiry ON access_sessions(expires_at);
