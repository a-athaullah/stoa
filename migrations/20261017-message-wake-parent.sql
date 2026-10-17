-- Per-run flag: wake the parent agent when this sub-agent message completes.
-- 0 for sub-agents fired straight from a human/automation message without an explicit
-- parent @mention; existing rows keep the old always-wake behavior (1).
-- Not in schema.sqlite.sql: boot runs schema then migrations, so the ALTER would hit a duplicate column.
ALTER TABLE messages ADD COLUMN wake_parent INTEGER NOT NULL DEFAULT 1;
