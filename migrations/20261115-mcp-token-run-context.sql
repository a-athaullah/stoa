-- Venice image tools (stoa__image_generate / _edit, lib/venice-images.js): the platform and chat model
-- of the latest run that used this token's scope, recorded only when that run's model came from a
-- Venice platform and cleared (NULL) by any other run, so a later run never inherits it. The gateway
-- re-checks the platform on every tools/list and call. Two nullable columns, no existing row changes.
-- Same columns are in db/schema.sqlite.sql for a fresh clone; the ALTERs are skipped there as "already present".
ALTER TABLE mcp_tokens ADD COLUMN run_platform_id TEXT;
ALTER TABLE mcp_tokens ADD COLUMN run_model TEXT;
