-- Remove duplicate indexes (identical to existing ones)
DROP INDEX IF EXISTS idx_messages_participant;
DROP INDEX IF EXISTS idx_messages_room;
DROP INDEX IF EXISTS idx_usage_log_actor_id;
DROP INDEX IF EXISTS idx_usage_log_model;

-- Composite index for streaming sub-agent checks:
-- WHERE room_id=? AND thread_id=? AND sub_agent_id IS NOT NULL AND state='streaming'
-- WHERE room_id=? AND sub_agent_id IS NOT NULL AND state='streaming'
CREATE INDEX IF NOT EXISTS idx_messages_room_thread_state
  ON messages(room_id, thread_id, state) WHERE sub_agent_id IS NOT NULL;

-- Composite index for recent parent_message activity:
-- WHERE room_id=? AND parent_message_id IS NOT NULL AND created_at >= ...
CREATE INDEX IF NOT EXISTS idx_messages_room_parent
  ON messages(room_id, created_at) WHERE parent_message_id IS NOT NULL;

-- Composite index for last message by participant in room:
-- WHERE participant_id=? AND room_id=? ORDER BY id DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_messages_participant_room
  ON messages(participant_id, room_id, id);

-- Missing index on memory_pending_writes for status queries:
-- WHERE room_id=? AND status='pending'
-- WHERE id=? AND room_id=? AND status='pending'
CREATE INDEX IF NOT EXISTS idx_pending_writes_room_status
  ON memory_pending_writes(room_id, status);
