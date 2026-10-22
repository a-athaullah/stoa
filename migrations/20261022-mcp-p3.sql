-- MCP gateway P3 (plan: stoa-feature/mcp-gateway.md §7): per-tool rate limit and remote OAuth servers.
-- 20261022-mcp-gateway.sql was already applied, so the additions live here.
ALTER TABLE mcp_tool_overrides ADD COLUMN rate_limit_per_min INTEGER CHECK(rate_limit_per_min IS NULL OR rate_limit_per_min BETWEEN 1 AND 10000);

-- mcp_calls.status gains 'rate_limited'. SQLite cannot alter a CHECK, so the table is rebuilt; every
-- row is copied (same columns, same ids).
CREATE TABLE mcp_calls_p3 (
  id INTEGER PRIMARY KEY,
  server_id INTEGER REFERENCES mcp_servers(id) ON DELETE SET NULL,
  server_slug TEXT,
  tool TEXT NOT NULL,
  actor_id INTEGER,
  sub_agent_id INTEGER,
  room_id INTEGER,
  thread_id INTEGER,
  args_preview TEXT,
  status TEXT NOT NULL CHECK(status IN ('ok','error','denied','timeout','rate_limited')),
  error TEXT,
  duration_ms INTEGER,
  result_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO mcp_calls_p3 (id, server_id, server_slug, tool, actor_id, sub_agent_id, room_id, thread_id, args_preview, status, error, duration_ms, result_bytes, created_at)
  SELECT id, server_id, server_slug, tool, actor_id, sub_agent_id, room_id, thread_id, args_preview, status, error, duration_ms, result_bytes, created_at FROM mcp_calls;
DROP TABLE mcp_calls;
ALTER TABLE mcp_calls_p3 RENAME TO mcp_calls;
CREATE INDEX IF NOT EXISTS idx_mcp_calls_created ON mcp_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_server ON mcp_calls(server_id, id);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_actor ON mcp_calls(actor_id, id);
