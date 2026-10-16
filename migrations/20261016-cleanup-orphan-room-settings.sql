-- Clean up orphan room-scoped settings, room_memory, and memory_pending_writes
-- left behind by room deletions that didn't cascade to these tables.
BEGIN;

DELETE FROM settings
WHERE scope = 'room'
  AND scope_id NOT IN (SELECT id FROM rooms);

DELETE FROM room_memory
WHERE room_id NOT IN (SELECT id FROM rooms);

DELETE FROM memory_pending_writes
WHERE room_id IS NOT NULL
  AND room_id NOT IN (SELECT id FROM rooms);

COMMIT;
