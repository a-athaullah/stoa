# Database Schema

## Core Tables

### actors
Users (human/AI) yang bisa participate di rooms.

```sql
CREATE TABLE actors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT CHECK(type IN ('human','ai')),
  adapter TEXT,                    -- 'claude'|'gemini'|null
  adapter_config TEXT,             -- JSON config
  secret TEXT,                     -- Authentication untuk agents
  avatar_color TEXT,
  avatar_symbol TEXT,
  available_models TEXT,           -- JSON array
  created_at TEXT
);
```

**Key points:**
- `type='human'` → user di UI
- `type='ai'` → agent (remote atau local)
- `secret` → SHA-256 hash untuk agent auth

---

### rooms
Conversation spaces.

```sql
CREATE TABLE rooms (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  created_by INTEGER REFERENCES actors(id),
  max_ai_turns INTEGER DEFAULT 5,
  workdir_id INTEGER REFERENCES agent_workdirs(id),
  archived_at TEXT,                -- Archive = hide dari sidebar
  is_pinned INTEGER DEFAULT 0,
  model TEXT,                      -- Default model override
  system_prompt TEXT,              -- Room-level system prompt (appended to agent)
  max_active_threads INTEGER DEFAULT 3, -- Max parallel streaming threads
  created_at TEXT
);
```

**Key points:**
- `workdir_id` → bind room to specific project directory
- `archived_at` → soft delete (fokus sidebar ke room aktif)
- `is_pinned` → keep at top of sidebar
- `system_prompt` → sent to agent as `--append-system-prompt`; imported from CLAUDE.md on agent connect
- `max_active_threads` → caps concurrent streaming threads per room (default 3)

---

### room_participants
Many-to-many: rooms ↔ actors.

```sql
CREATE TABLE room_participants (
  id INTEGER PRIMARY KEY,
  room_id INTEGER REFERENCES rooms(id),
  actor_id INTEGER REFERENCES actors(id),
  joined_at TEXT,
  invited_by INTEGER REFERENCES actors(id),
  notify_on_message INTEGER DEFAULT 1,
  auto_respond INTEGER DEFAULT 0,      -- AI auto-reply
  UNIQUE (room_id, actor_id)
);
```

**Key points:**
- `participant.id` is what messages reference (not actor_id directly)
- `auto_respond=1` → AI automatically responds to new messages
- One actor can be in multiple rooms

---

### messages
Conversation history.

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  room_id INTEGER REFERENCES rooms(id),
  participant_id INTEGER REFERENCES room_participants(id),
  content TEXT NOT NULL,
  state TEXT CHECK(state IN ('requesting','streaming','complete','error','system_event')),
  reply_to INTEGER REFERENCES messages(id),
  thread_id INTEGER REFERENCES messages(id), -- Thread root (NULL = this IS a root)
  image_url TEXT,
  file_url TEXT,
  file_name TEXT,
  attachments TEXT,                          -- JSON array
  created_at TEXT,
  completed_at TEXT
);
```

**Key points:**
- `state='streaming'` → AI sedang typing
- `state='system_event'` → bukan message user (e.g., "X joined room")
- `reply_to` → legacy quote-reply (preserved, not removed)
- `thread_id` → thread root message id; NULL = root message, non-NULL = reply in thread
- `GET /api/rooms/:id/messages` default scope = roots-only (thread_id IS NULL)
- Full-text search via `messages_fts` (FTS5)
- Indexes: `idx_messages_thread_id(thread_id, id)`, `idx_messages_room_root(room_id, id) WHERE thread_id IS NULL`

---

### ai_sessions
Claude API session persistence.

```sql
CREATE TABLE ai_sessions (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER REFERENCES room_participants(id),
  room_id INTEGER REFERENCES rooms(id),
  claude_session_id TEXT NOT NULL,
  workdir TEXT,
  status TEXT CHECK(status IN ('active','idle','indeterminate')),
  last_active_at TEXT,
  sub_agent_id INTEGER,
  thread_id INTEGER NOT NULL DEFAULT 0,  -- 0 = room-level legacy
  pinned INTEGER NOT NULL DEFAULT 0,
  context_tokens_used INTEGER DEFAULT 0,
  compact_failure_cooldown_until TEXT,
  compact_failure_error TEXT,
  process_generation TEXT
);
```

**Key points:**
- Sessions persist across server restarts
- One session per (participant_id, thread_id) tuple (+ sub_agent_id if sub-agent)
- `thread_id=0` → legacy room-level session; non-zero → thread-specific
- Unique indexes: `(participant_id, thread_id) WHERE sub_agent_id IS NULL`, `(participant_id, sub_agent_id, thread_id) WHERE sub_agent_id IS NOT NULL`
- Idle sessions auto-closed by agent after `SESSION_IDLE_TTL` minutes (default 5)

---

## Agent-Specific Tables

### agent_workdirs
Project directories per agent.

```sql
CREATE TABLE agent_workdirs (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES actors(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  label TEXT,
  is_default INTEGER DEFAULT 0,
  claude_md_migrated_at TEXT,      -- CLAUDE.md import tracking
  UNIQUE (actor_id, path)
);
```

**Key points:**
- Agent can work in multiple projects
- `is_default=1` → used when creating new rooms
- `claude_md_migrated_at` → tracks CLAUDE.md→system_prompt migration per workdir; NULL = not yet imported

---

### agent_skills
Custom commands per agent/workdir.

```sql
CREATE TABLE agent_skills (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES actors(id) ON DELETE CASCADE,
  workdir_id INTEGER REFERENCES agent_workdirs(id),
  name TEXT NOT NULL,
  description TEXT,
  scope TEXT CHECK(scope IN ('global','project','local'))
);
```

**Key points:**
- Skills = user-defined commands (like slash commands)
- Scope: global (all workdirs), project (one workdir), local (?)

---

## Automation Tables

### automation_connections
External service credentials (Slack, Discord).

```sql
CREATE TABLE automation_connections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT CHECK(provider IN ('slack')),  -- Only Slack for now
  token_type TEXT CHECK(token_type IN ('bot','user')),
  credentials TEXT NOT NULL,                    -- JSON (encrypted?)
  metadata TEXT DEFAULT '{}',
  status TEXT CHECK(status IN ('connected','disconnected','error','connecting')),
  error_msg TEXT
);
```

---

### automations
Webhook → room message triggers.

```sql
CREATE TABLE automations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,           -- 'webhook'
  trigger_event TEXT NOT NULL,          -- 'slack_mention'
  trigger_conditions TEXT DEFAULT '[]', -- JSON filters
  target_room_id INTEGER REFERENCES rooms(id),
  prompt_template TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  connection_id INTEGER REFERENCES automation_connections(id)
);
```

**Example flow:**
```
Slack mention → webhook POST /api/webhooks/slack
  ↓
Match automation (trigger_event='slack_mention')
  ↓
Render prompt_template with webhook data
  ↓
POST message to target_room_id
  ↓
AI responds, result posted back to Slack
```

---

## Migration Pattern

### Rule
**Never edit schema.sqlite.sql directly for existing DBs.**

### Flow
1. Create `migrations/YYYYMMDD-description.sql`
2. Server auto-runs on startup (tracked in `migrations` table)
3. Update `schema.sqlite.sql` for fresh clones

### Example
```sql
-- migrations/20260610-add-foo.sql
ALTER TABLE rooms ADD COLUMN foo TEXT DEFAULT NULL;
```

**Constraints:**
- Must be transactional
- Must be zero data loss
- Must be idempotent (safe to re-run)

---

## Indexes

### High-Impact Indexes
```sql
CREATE INDEX idx_messages_room_id ON messages(room_id);
CREATE INDEX idx_messages_room_state ON messages(room_id, state);
CREATE INDEX idx_messages_thread_id ON messages(thread_id, id);
CREATE INDEX idx_messages_room_root ON messages(room_id, id) WHERE thread_id IS NULL;
CREATE INDEX idx_messages_reply_to ON messages(reply_to);
CREATE INDEX idx_room_participants_room_id ON room_participants(room_id);
CREATE INDEX idx_room_participants_actor_id ON room_participants(actor_id);
CREATE UNIQUE INDEX idx_ai_sessions_main_unique ON ai_sessions(participant_id, thread_id) WHERE sub_agent_id IS NULL;
CREATE UNIQUE INDEX idx_ai_sessions_sub_unique ON ai_sessions(participant_id, sub_agent_id, thread_id) WHERE sub_agent_id IS NOT NULL;
CREATE INDEX idx_ai_sessions_thread ON ai_sessions(thread_id);
```

**Why:** Most queries are "get messages for room X", "get roots for feed", or "get thread replies".

### Foreign Key Indexes
All foreign keys indexed for join performance.

---

## Full-Text Search

### messages_fts
FTS5 virtual table, auto-synced with `messages` via triggers.

**Usage:**
```sql
SELECT m.* FROM messages m
JOIN messages_fts fts ON fts.rowid = m.id
WHERE messages_fts MATCH 'aider OR ollama'
ORDER BY rank;
```

**Performance:** Fast even with 100k+ messages.
