-- Sub-agent model from an AI platform (Settings → AI platforms): the platform id (same value as
-- rooms.model_config.platform_id) the sub-agent's pinned non-Claude model runs on. NULL = the model is
-- a harness model (or none). One nullable column, no existing row changes.
-- Not in schema.sqlite.sql for the same reason as 20261017-sub-agent-memory-avatar.sql: sub_agents is
-- migration-only (20260831), so a baseline column would make this ALTER fail on a fresh clone.
ALTER TABLE sub_agents ADD COLUMN model_platform_id TEXT DEFAULT NULL;
