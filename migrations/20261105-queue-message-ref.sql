-- Busy mode "queue": a queued row points at the message handleHumanMessage already stored and
-- broadcast, so draining runs that message's agents instead of posting it again (the repost hit
-- the event_id idempotency check and never ran, or was stored twice without its automation label).
-- The automation label, MCP fence and skill gate all come from that message row.
ALTER TABLE room_message_queue ADD COLUMN message_id INTEGER DEFAULT NULL REFERENCES messages(id) ON DELETE CASCADE;
-- A scheduled run's named agent is not stored on the message.
ALTER TABLE room_message_queue ADD COLUMN target_actor_id INTEGER DEFAULT NULL REFERENCES actors(id) ON DELETE CASCADE;

-- Rows queued before this migration: the message was stored when it was queued.
UPDATE room_message_queue SET message_id = (
  SELECT m.id FROM messages m
  WHERE m.room_id = room_message_queue.room_id
    AND m.content = room_message_queue.content
    AND m.thread_id IS room_message_queue.thread_id
    AND (room_message_queue.event_id IS NULL OR m.client_event_id = room_message_queue.event_id)
    AND m.created_at <= room_message_queue.queued_at
  ORDER BY m.id DESC LIMIT 1
) WHERE message_id IS NULL;
