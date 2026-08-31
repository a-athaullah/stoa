-- Phase 1 (agentic orchestration): sub-agent identity on messages.
-- A message posted by a sub-agent is rendered flat as "Ara (probe)" — the
-- parent actor is still messages.participant_id; the label below is the only
-- new identity carried on the row. parent_message_id is an optional
-- micro-reference back to the orchestrator message that requested the run
-- (no threading — timeline stays flat).
--
-- sub_agent_label is a SNAPSHOT (not a FK): history stays correct even if the
-- sub-agent definition is later renamed or deleted. The FK column
-- messages.sub_agent_id lands in Phase 2a, atomically with CREATE TABLE
-- sub_agents, to avoid a dangling reference now.
--
-- Additive, nullable columns → transactional and zero data loss (the runner
-- wraps each migration in BEGIN/COMMIT). foreign_keys is ON at DB open;
-- ADD COLUMN with a REFERENCES clause is allowed because the default is NULL.
--
-- SOLE OWNER: this migration is the ONLY place these columns + index are
-- defined. Do NOT also add them to db/schema.sqlite.sql. The baseline is
-- exec'd before migrations run, so a standalone CREATE INDEX there would
-- reference a column that does not yet exist on an existing DB (throws at
-- boot), and duplicating the columns in the baseline CREATE TABLE makes a
-- fresh clone hit "duplicate column name" here (migration never marked
-- applied → retries every startup). Keeping ownership here is the only shape
-- that stays clean on BOTH an existing DB and a fresh clone.
ALTER TABLE messages ADD COLUMN sub_agent_label TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN parent_message_id INTEGER DEFAULT NULL REFERENCES messages(id);

-- Lookups of a parent's requested sub-agent messages (future collapse/reference UI).
CREATE INDEX IF NOT EXISTS idx_messages_parent_message_id ON messages(parent_message_id);
