-- Global settings use scope_id NULL everywhere (getSetting, setSetting, the default seed in
-- schema.sqlite.sql, 20261021-settings-dedup.sql), but PUT /api/settings/display inserted its rows
-- with scope_id 0. Those rows were invisible to getSetting, and the display reads (which did not
-- filter on scope_id) returned whichever row came last when a key had both a 0 and a NULL row.
-- PUT display now goes through setSetting, so fold the 0 rows into NULL.
-- When a key has both, keep the 0 row: PUT display updated the first global row it found, and the
-- 0 row is only created when no global row existed yet, so it is the older one and holds the value
-- the user set from the display settings UI. The NULL duplicate is dropped first so no key ends up
-- with two NULL rows (UNIQUE does not catch NULL duplicates).
DELETE FROM settings
WHERE scope = 'global' AND scope_id IS NULL
  AND key_name IN (SELECT key_name FROM settings WHERE scope = 'global' AND scope_id = 0);
UPDATE settings SET scope_id = NULL WHERE scope = 'global' AND scope_id = 0;
