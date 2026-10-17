-- Sub-agent description: the purpose the sub-agent was created for. Existing rows stay NULL.
-- Not in schema.sqlite.sql for the same reason as 20261017-sub-agent-memory-avatar.sql.
ALTER TABLE sub_agents ADD COLUMN description TEXT DEFAULT NULL;
