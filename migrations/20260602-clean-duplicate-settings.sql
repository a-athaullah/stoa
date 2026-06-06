-- Remove duplicate global settings rows caused by NULL scope_id UNIQUE bug
DELETE FROM settings
WHERE scope = 'global'
  AND scope_id IS NULL
  AND id NOT IN (
    SELECT MAX(id) FROM settings
    WHERE scope = 'global' AND scope_id IS NULL
    GROUP BY key_name
  );
