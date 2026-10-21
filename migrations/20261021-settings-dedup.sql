-- Remove duplicate global settings rows. UNIQUE (scope, scope_id, key_name) never fires when
-- scope_id is NULL (NULLs are distinct), so the INSERT OR IGNORE default seed in schema.sqlite.sql
-- added one more copy of idle_timeout_seconds / max_active_rooms_per_ai / max_ai_turns_per_round on
-- every server start. The seed is now guarded with NOT EXISTS.
-- Keep the lowest id per key: that is the row getSetting reads and setSetting updates (both walk the
-- (scope, scope_id, key_name) autoindex, ties in rowid order), so the effective value is unchanged.
DELETE FROM settings
WHERE scope_id IS NULL
  AND id NOT IN (SELECT MIN(id) FROM settings WHERE scope_id IS NULL GROUP BY scope, key_name);
