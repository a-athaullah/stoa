-- MCP gateway (plan: stoa-feature/mcp-gateway.md §4). Upstream MCP servers run on the Stoa server and
-- are exposed to agents through one MCP endpoint (/mcp) with per-agent / sub-agent / room access.
-- IF NOT EXISTS everywhere: db/schema.sqlite.sql carries the same objects and runs first on every boot.
CREATE TABLE IF NOT EXISTS mcp_servers (
  id INTEGER PRIMARY KEY,
  -- Tool namespace prefix (slug__tool). No '__' inside so the split on the first '__' is unambiguous.
  slug TEXT NOT NULL UNIQUE CHECK(length(slug) <= 32 AND slug GLOB '[a-z]*' AND slug NOT GLOB '*[^a-z0-9_]*' AND instr(slug, '__') = 0),
  name TEXT NOT NULL,
  transport TEXT NOT NULL CHECK(transport IN ('stdio','http')),
  command TEXT,
  args_json TEXT,
  url TEXT,
  -- lib/credentials.js ciphertext of a JSON object: env vars (stdio) or headers (http).
  env_enc TEXT,
  preset TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  default_access TEXT NOT NULL DEFAULT 'none' CHECK(default_access IN ('all','none')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mcp_tool_overrides (
  server_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, tool)
);

-- subject_id is polymorphic (actors.id / sub_agents.id / rooms.id), so server.js deletes these rows
-- itself when the subject is deleted.
CREATE TABLE IF NOT EXISTS mcp_access (
  server_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('agent','sub_agent','room')),
  subject_id INTEGER NOT NULL,
  allow INTEGER NOT NULL CHECK(allow IN (0,1)),
  PRIMARY KEY (server_id, subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_mcp_access_subject ON mcp_access(subject_type, subject_id);

-- One token per (actor, room, thread, sub-agent) session. token_enc lets the server hand the same
-- token out again, so the agent's session env stays stable (an env change respawns the session).
-- Lookups go through token_hash only.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  token_hash TEXT PRIMARY KEY,
  token_enc TEXT NOT NULL,
  actor_id INTEGER NOT NULL,
  room_id INTEGER,
  thread_id INTEGER,
  sub_agent_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_actor ON mcp_tokens(actor_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_sub_agent ON mcp_tokens(sub_agent_id) WHERE sub_agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mcp_calls (
  id INTEGER PRIMARY KEY,
  server_id INTEGER REFERENCES mcp_servers(id) ON DELETE SET NULL,
  server_slug TEXT,
  tool TEXT NOT NULL,
  actor_id INTEGER,
  sub_agent_id INTEGER,
  room_id INTEGER,
  thread_id INTEGER,
  args_preview TEXT,
  status TEXT NOT NULL CHECK(status IN ('ok','error','denied','timeout')),
  error TEXT,
  duration_ms INTEGER,
  result_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_created ON mcp_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_server ON mcp_calls(server_id, id);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_actor ON mcp_calls(actor_id, id);
