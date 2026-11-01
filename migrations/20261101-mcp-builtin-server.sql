-- Stoa's own tools (stoa__*) become a row in mcp_servers, so access, per-tool overrides, rate limits,
-- approval and "Always allow" apply to them as to any upstream server (owner decision 2026-11-01).
-- A builtin column instead of a transport value: widening CHECK(transport IN ('stdio','http')) means
-- rebuilding mcp_servers, and dropping the old table would cascade-delete the overrides, grants,
-- exemptions and event tokens that reference it. The row keeps transport 'http' with no url; the
-- upstream manager refuses builtin rows and the API refuses to edit their connection fields.
ALTER TABLE mcp_servers ADD COLUMN builtin INTEGER NOT NULL DEFAULT 0 CHECK(builtin IN (0,1));

-- "stoa" was reserved, but a row created before the reservation may still hold it; such a row was
-- never exposed or called. It keeps its data under a free slug, disabled so it does not go live.
UPDATE mcp_servers SET slug = 'stoa_old_' || id, enabled = 0, updated_at = datetime('now') WHERE slug = 'stoa' AND builtin = 0;

-- default_access 'all': every agent keeps the stoa__* tools it had before this change.
INSERT INTO mcp_servers (slug, name, transport, default_access, builtin)
  SELECT 'stoa', 'Stoa', 'http', 'all', 1 WHERE NOT EXISTS (SELECT 1 FROM mcp_servers WHERE builtin = 1);

-- Installing or changing an MCP server runs a command or reaches a URL on the Stoa host: those two
-- start out approval-gated (they were hard-coded so before). Every other built-in starts free.
INSERT INTO mcp_tool_overrides (server_id, tool, enabled, requires_approval)
  SELECT id, 'mcp_server_add', 1, 1 FROM mcp_servers WHERE builtin = 1
  ON CONFLICT(server_id, tool) DO NOTHING;
INSERT INTO mcp_tool_overrides (server_id, tool, enabled, requires_approval)
  SELECT id, 'mcp_server_update', 1, 1 FROM mcp_servers WHERE builtin = 1
  ON CONFLICT(server_id, tool) DO NOTHING;

-- Built-in calls and approvals were logged with server_id NULL; point them at the row so the MCP
-- page can filter them like any other server.
UPDATE mcp_calls SET server_id = (SELECT id FROM mcp_servers WHERE builtin = 1) WHERE server_id IS NULL AND server_slug = 'stoa';
UPDATE mcp_approvals SET server_id = (SELECT id FROM mcp_servers WHERE builtin = 1) WHERE server_id IS NULL AND server_slug = 'stoa';
