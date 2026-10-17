-- Sub-agent role: short one-line job title shown under the sub-agent name in chat. Existing rows stay NULL.
-- Not in schema.sqlite.sql for the same reason as 20261017-sub-agent-memory-avatar.sql.
ALTER TABLE sub_agents ADD COLUMN role TEXT DEFAULT NULL;
