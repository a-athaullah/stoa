-- Sub-agent self-learning memory storage + avatar columns on sub_agents
-- Not in schema.sqlite.sql: sub_agents itself is migration-only (20260831). Adding these
-- columns to schema.sqlite.sql would cause ALTER failures on fresh clones where schema
-- runs before migrations. Not a finding.

CREATE TABLE IF NOT EXISTS sub_agent_memory (
  sub_agent_id INTEGER PRIMARY KEY REFERENCES sub_agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE sub_agents ADD COLUMN avatar_color TEXT DEFAULT NULL;
ALTER TABLE sub_agents ADD COLUMN avatar_symbol TEXT DEFAULT NULL;
ALTER TABLE sub_agents ADD COLUMN avatar_url TEXT DEFAULT NULL;
