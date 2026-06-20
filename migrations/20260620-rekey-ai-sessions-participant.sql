-- Re-key ai_sessions by participant_id alone (drop workdir from the unique key).
--
-- WHY: migration 20260620-add-participant-workdir made the workdir a per-participant property
-- (room_participants.workdir_id), so one participant now maps to exactly ONE workdir. Keeping the
-- key as (participant_id, workdir) was redundant AND caused a real bug: dispatch resolved the
-- *participant* workdir, but the remote-agent save path (server.js agent_complete) stored the
-- *room* workdir. When participant workdir != room workdir, the save key never matched the lookup
-- key — so getSession missed, a fresh Claude session spawned on every trigger (context loss), and
-- compact sent a workdir that did not exist on the remote agent's host (compact no-op for that
-- agent). server.js now derives the workdir from a single helper (resolveParticipantWorkdir) for
-- dispatch, save, and compact; this migration makes the storage key match that model.
--
-- SQLite cannot drop a table-level UNIQUE in place, so rebuild the table. No other table has a
-- foreign key REFERENCING ai_sessions (it only references out, to room_participants and rooms),
-- so a straight rebuild is safe. The migration runner already wraps this file in a single
-- transaction, so no explicit BEGIN/COMMIT here.

-- 1. New table: identical columns, UNIQUE on participant_id only.
CREATE TABLE ai_sessions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  room_id INTEGER DEFAULT NULL,
  claude_session_id TEXT NOT NULL,
  workdir TEXT DEFAULT NULL,
  status TEXT DEFAULT 'idle' CHECK(status IN ('active','idle')),
  last_active_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (participant_id) REFERENCES room_participants(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  UNIQUE (participant_id)
);

-- 2. Copy, keeping only the most-recently-active row per participant (zero data loss for the
--    live session; stale duplicate rows for the same participant, if any, are dropped — the
--    newest claude_session_id is the one the agent is actually resuming).
INSERT INTO ai_sessions_new (id, participant_id, room_id, claude_session_id, workdir, status, last_active_at, created_at)
SELECT s.id, s.participant_id, s.room_id, s.claude_session_id, s.workdir, s.status, s.last_active_at, s.created_at
FROM ai_sessions s
WHERE s.id = (
  SELECT s2.id FROM ai_sessions s2
  WHERE s2.participant_id = s.participant_id
  ORDER BY s2.last_active_at DESC, s2.id DESC
  LIMIT 1
);

-- 3. Swap old → new.
DROP TABLE ai_sessions;
ALTER TABLE ai_sessions_new RENAME TO ai_sessions;

-- 4. Recreate the non-unique lookup indexes (the UNIQUE is now in the table definition).
CREATE INDEX IF NOT EXISTS idx_ai_sessions_participant_id ON ai_sessions(participant_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_room_id ON ai_sessions(room_id);
