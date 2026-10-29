-- Event channel for MCP servers (POST /api/mcp/events, lib/mcp-events.js): one bearer token per
-- installed server, handed to a stdio upstream as STOA_EVENTS_TOKEN when it is spawned.
-- Lookups go by token_hash only; token_enc (lib/credentials.js) lets the server hand the same token
-- out again on every respawn. New table only: no existing data is touched.
CREATE TABLE IF NOT EXISTS mcp_event_tokens (
  server_id INTEGER PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_enc TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
