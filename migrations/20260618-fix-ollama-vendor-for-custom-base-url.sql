-- Migration: Rename vendor='ollama' to 'custom' for platforms with non-empty,
-- non-ollama.com base_url. Before the PR #12 (ollama cloud proxy adapter),
-- vendor='ollama' meant any Ollama instance (local or cloud). After PR #12,
-- vendor='ollama' is strictly Ollama Cloud routed through the stoa proxy and
-- base_url is bypassed. Existing local-Ollama platforms must be renamed to
-- 'custom' (the new vendor for direct base_url use) to avoid misrouting.
--
-- Idempotent: the EXISTS guard skips the UPDATE entirely if no platforms
-- match the rename criteria.

UPDATE settings
SET value = (
  SELECT json_group_array(json(
    CASE
      WHEN json_extract(je.value, '$.vendor') = 'ollama'
        AND COALESCE(json_extract(je.value, '$.base_url'), '') != ''
        AND json_extract(je.value, '$.base_url') NOT LIKE '%ollama.com%'
      THEN json_set(je.value, '$.vendor', 'custom')
      ELSE je.value
    END
  ))
  FROM json_each(settings.value) je
)
WHERE key_name = 'ai_platforms' AND scope = 'global'
  AND EXISTS (
    SELECT 1 FROM json_each(settings.value) je2
    WHERE json_extract(je2.value, '$.vendor') = 'ollama'
      AND COALESCE(json_extract(je2.value, '$.base_url'), '') != ''
      AND json_extract(je2.value, '$.base_url') NOT LIKE '%ollama.com%'
  );
