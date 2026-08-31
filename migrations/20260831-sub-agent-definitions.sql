-- Phase 2a (agentic orchestration): sub-agent definitions, room linking,
-- messages.sub_agent_id FK, and ai_sessions.sub_agent_id.
--
-- Sub-agents are defined at AGENT level (sub_agents), linked to rooms via
-- room_sub_agents. messages.sub_agent_id is an optional FK to the definition
-- (ephemeral spawns won't have one); sub_agent_label snapshot from Phase 1
-- keeps history intact if the definition is later deleted (ON DELETE SET NULL).
--
-- ai_sessions gets sub_agent_id + constraint change: UNIQUE(participant_id)
-- → partial unique index for main agent (NULL) + composite for sub-agent
-- (non-NULL). SQLite can't ALTER constraints, so rebuild the table (same
-- pattern as 20260620-rekey-ai-sessions-participant.sql). No other table
-- references ai_sessions, so rebuild is safe.
--
-- SOLE OWNER: this migration is the ONLY place these tables, columns, and
-- indexes are defined. Do NOT also add them to db/schema.sqlite.sql — see
-- the note in 20260831-messages-sub-agent-identity.sql for why (fresh clone
-- + existing DB double-definition breaks both paths).

-- ── 1. CREATE TABLE sub_agents (must come before any FK referencing it)
CREATE TABLE sub_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  tier TEXT DEFAULT 'quick' CHECK(tier IN ('quick','standard','deep')),
  model TEXT DEFAULT NULL,
  workdir TEXT DEFAULT NULL,
  system_prompt TEXT DEFAULT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(parent_actor_id, label)
);

CREATE INDEX idx_sub_agents_parent ON sub_agents(parent_actor_id);

-- ── 2. CREATE TABLE room_sub_agents (link table)
CREATE TABLE room_sub_agents (
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sub_agent_id INTEGER NOT NULL REFERENCES sub_agents(id) ON DELETE CASCADE,
  added_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, sub_agent_id)
);

-- ── 3. ALTER messages: add sub_agent_id FK (ON DELETE SET NULL — label snapshot survives)
ALTER TABLE messages ADD COLUMN sub_agent_id INTEGER DEFAULT NULL
  REFERENCES sub_agents(id) ON DELETE SET NULL;

CREATE INDEX idx_messages_sub_agent_id ON messages(sub_agent_id);

-- ── 4. Rebuild ai_sessions: add sub_agent_id + change uniqueness
--    Old: UNIQUE(participant_id) — one session per participant
--    New: no table-level UNIQUE on participant alone; enforced by partial indexes:
--      - main agent (sub_agent_id IS NULL): one per participant (partial unique index)
--      - sub-agent (sub_agent_id NOT NULL): one per (participant, sub_agent_id) (partial unique index)
--    This handles SQLite's "NULL values are distinct in UNIQUE" behavior correctly.

CREATE TABLE ai_sessions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  room_id INTEGER DEFAULT NULL,
  claude_session_id TEXT NOT NULL,
  workdir TEXT DEFAULT NULL,
  status TEXT DEFAULT 'idle' CHECK(status IN ('active','idle')),
  last_active_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  sub_agent_id INTEGER DEFAULT NULL REFERENCES sub_agents(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES room_participants(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

INSERT INTO ai_sessions_new (id, participant_id, room_id, claude_session_id, workdir, status, last_active_at, created_at)
SELECT id, participant_id, room_id, claude_session_id, workdir, status, last_active_at, created_at
FROM ai_sessions;

DROP TABLE ai_sessions;
ALTER TABLE ai_sessions_new RENAME TO ai_sessions;

-- Partial unique indexes: main agent = one per participant, sub-agent = one per (participant, sub_agent_id)
CREATE UNIQUE INDEX idx_ai_sessions_main_unique ON ai_sessions(participant_id) WHERE sub_agent_id IS NULL;
CREATE UNIQUE INDEX idx_ai_sessions_sub_unique ON ai_sessions(participant_id, sub_agent_id) WHERE sub_agent_id IS NOT NULL;

-- Recreate lookup indexes lost during rebuild
CREATE INDEX idx_ai_sessions_participant_id ON ai_sessions(participant_id);
CREATE INDEX idx_ai_sessions_room_id ON ai_sessions(room_id);
CREATE INDEX idx_ai_sessions_sub_agent_id ON ai_sessions(sub_agent_id);
