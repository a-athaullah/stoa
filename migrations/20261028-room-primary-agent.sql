-- Primary agent per room: a human message without an @mention triggers only this agent;
-- the other AI participants are assistants that run only when @mentioned. The primary
-- cannot be removed from the room (deleting that actor is refused).
-- Backfill: the owner of the room's workdir when that agent is an AI participant of the
-- room, otherwise the AI participant that joined first (lowest room_participants.id).
-- Rooms without an AI participant stay NULL.
ALTER TABLE rooms ADD COLUMN primary_actor_id INTEGER DEFAULT NULL REFERENCES actors(id);

UPDATE rooms SET primary_actor_id = COALESCE(
  (SELECT w.actor_id FROM agent_workdirs w
     JOIN room_participants rp ON rp.actor_id = w.actor_id AND rp.room_id = rooms.id
     JOIN actors a ON a.id = rp.actor_id AND a.type = 'ai'
   WHERE w.id = rooms.workdir_id),
  (SELECT rp.actor_id FROM room_participants rp
     JOIN actors a ON a.id = rp.actor_id AND a.type = 'ai'
   WHERE rp.room_id = rooms.id ORDER BY rp.id LIMIT 1)
)
WHERE primary_actor_id IS NULL;
