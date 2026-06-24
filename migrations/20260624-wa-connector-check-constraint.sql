-- Recreate automation_connections with provider CHECK including 'whatsapp'
-- and token_type CHECK including 'qr' (used for WA connections)

CREATE TABLE IF NOT EXISTS automation_connections_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'slack' CHECK(provider IN ('slack','whatsapp')),
  token_type   TEXT NOT NULL DEFAULT 'bot' CHECK(token_type IN ('bot','user','qr')),
  credentials  TEXT NOT NULL DEFAULT '{}',
  metadata     TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'disconnected' CHECK(status IN ('connected','disconnected','error','connecting')),
  error_msg    TEXT DEFAULT NULL,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

INSERT INTO automation_connections_new
  SELECT id, name, provider, token_type, credentials, metadata, status, error_msg, created_at, updated_at
  FROM automation_connections;

DROP TABLE automation_connections;

ALTER TABLE automation_connections_new RENAME TO automation_connections;

CREATE INDEX IF NOT EXISTS idx_automation_connections_provider ON automation_connections(provider, status);
