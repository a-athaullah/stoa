-- R12: track last scheduler error per schedule row.
-- Lets the doctor endpoint surface schedules that repeatedly fail
-- without silently resetting. Cleared on successful fire.
ALTER TABLE sub_agent_schedules ADD COLUMN last_error TEXT DEFAULT NULL;
