-- Add per-participant workdir_id to room_participants.
-- Enables choosing a workspace directory per AI agent when adding it to a room.
-- Previously workdir was room-level only (rooms.workdir_id); a non-owner agent always
-- fell back to its own default workdir with no way to pick a different one.
ALTER TABLE room_participants ADD COLUMN workdir_id INTEGER DEFAULT NULL REFERENCES agent_workdirs(id);

CREATE INDEX IF NOT EXISTS idx_room_participants_workdir_id ON room_participants(workdir_id);

-- Backfill so stored state matches current runtime resolution (explicit, not implicit).
-- Step 1: participants who OWN the room's workdir keep using the room workdir.
UPDATE room_participants
SET workdir_id = (SELECT r.workdir_id FROM rooms r WHERE r.id = room_participants.room_id)
WHERE workdir_id IS NULL
  AND EXISTS (
    SELECT 1 FROM rooms r JOIN agent_workdirs w ON w.id = r.workdir_id
    WHERE r.id = room_participants.room_id AND w.actor_id = room_participants.actor_id
  );

-- Step 2: other AI participants resolve to their own default workdir (is_default=1).
-- Human participants intentionally stay NULL (they have no workdir).
-- An AI without a default workdir also stays NULL by design: at dispatch, NULL resolves to the
-- agent's own cwd (server.js: `workdir || undefined`). Intentional, not a missing-backfill bug.
UPDATE room_participants
SET workdir_id = (
  SELECT w.id FROM agent_workdirs w
  WHERE w.actor_id = room_participants.actor_id AND w.is_default = 1
  LIMIT 1
)
WHERE workdir_id IS NULL
  AND actor_id IN (SELECT id FROM actors WHERE type = 'ai');
