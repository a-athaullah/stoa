-- Add multi-provider automation connections
-- automation_connections: one row per Slack bot/user token pair
-- automations.connection_id: FK linking each automation to its connection

CREATE TABLE IF NOT EXISTS automation_connections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'slack' CHECK(provider IN ('slack','discord')),
  token_type   TEXT NOT NULL DEFAULT 'bot' CHECK(token_type IN ('bot','user')),
  credentials  TEXT NOT NULL DEFAULT '{}',
  metadata     TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'disconnected' CHECK(status IN ('connected','disconnected','error','connecting')),
  error_msg    TEXT DEFAULT NULL,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

ALTER TABLE automations ADD COLUMN connection_id INTEGER DEFAULT NULL
  REFERENCES automation_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_automation_connections_provider ON automation_connections(provider, status);
CREATE INDEX IF NOT EXISTS idx_automations_connection_id ON automations(connection_id);
