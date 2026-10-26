-- "Always allow" for approval-gated MCP tools: the owner exempts one agent (sub_agent_id NULL) or one
-- sub-agent from approval for one tool. Matching is exact: a sub-agent's exemption does not cover its
-- parent agent, and the parent's does not cover its sub-agents. UNIQUE treats NULLs as distinct, so the
-- unique index folds sub_agent_id NULL to 0 (sub_agents ids start at 1).
CREATE TABLE IF NOT EXISTS mcp_approval_exemptions (
  id INTEGER PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  sub_agent_id INTEGER REFERENCES sub_agents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_approval_exemptions_key
  ON mcp_approval_exemptions(server_id, tool, actor_id, COALESCE(sub_agent_id, 0));
CREATE INDEX IF NOT EXISTS idx_mcp_approval_exemptions_actor ON mcp_approval_exemptions(actor_id);
CREATE INDEX IF NOT EXISTS idx_mcp_approval_exemptions_sub_agent ON mcp_approval_exemptions(sub_agent_id) WHERE sub_agent_id IS NOT NULL;

-- How an approval-gated call got through: 'owner' = approved on its card, 'exemption' = ran without a
-- card because of a row above. NULL = the tool did not need approval (and every row before this).
ALTER TABLE mcp_calls ADD COLUMN approval TEXT CHECK(approval IS NULL OR approval IN ('owner','exemption'));
