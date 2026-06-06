-- Add room_id column to ai_sessions with backfill from room_participants
ALTER TABLE ai_sessions ADD COLUMN room_id INTEGER DEFAULT NULL REFERENCES rooms(id);

UPDATE ai_sessions
SET room_id = (
  SELECT rp.room_id
  FROM room_participants rp
  WHERE rp.id = ai_sessions.participant_id
);

CREATE INDEX IF NOT EXISTS idx_ai_sessions_room_id ON ai_sessions(room_id);
