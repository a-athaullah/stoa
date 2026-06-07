-- Backfill connection_id for automations that have NULL connection_id
-- Assigns them to the first (lowest id) connection in automation_connections
BEGIN;
UPDATE automations
SET connection_id = (SELECT MIN(id) FROM automation_connections)
WHERE connection_id IS NULL
  AND EXISTS (SELECT 1 FROM automation_connections);
COMMIT;
