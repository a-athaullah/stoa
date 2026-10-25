-- Drop the memory approval queue from #92. Nothing ever inserted into it (agent memory writes
-- were always stored directly), its owner endpoints and UI banner are removed in the same change,
-- and the live table holds 0 rows, so no data is lost.
-- The migration runner already wraps this file in a single transaction,
-- so no explicit BEGIN/COMMIT here.

DROP INDEX IF EXISTS idx_pending_writes_room_status;
DROP TABLE IF EXISTS memory_pending_writes;
