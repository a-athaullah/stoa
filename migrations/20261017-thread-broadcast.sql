ALTER TABLE messages ADD COLUMN broadcast_reason TEXT DEFAULT NULL CHECK(broadcast_reason IN ('automation_match','error','limit'));
CREATE INDEX IF NOT EXISTS idx_messages_broadcast ON messages(room_id, created_at) WHERE broadcast_reason IS NOT NULL;
