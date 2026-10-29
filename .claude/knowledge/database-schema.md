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
  -- feed_pos REAL added by migration 20261026-message-feed-pos.sql (not in baseline)
);
```

**Key points:**
- `state='streaming'` → AI sedang typing
- `state='system_event'` → bukan message user (e.g., "X joined room")
- `reply_to` → legacy quote-reply (preserved, not removed)
- `thread_id` → thread root message id; NULL = root message, non-NULL = reply in thread
- `feed_pos REAL` (migration `20261026-message-feed-pos.sql`) — display sort key. Backfilled `= id`; new rows get `feed_pos = id` via AFTER INSERT trigger. At completion of an agent/sub-agent reply, if the same participant sent progress messages later in the same scope, `feed_pos` is set to `<last progress feed_pos> + 0.5` so the final reply appears after its own progress messages. Reads `ORDER BY feed_pos, id`. Cursors (`before`/`since` query params) are still message ids, and resolved to `feed_pos` by the server.
- `GET /api/rooms/:id/messages` default scope = roots-only (thread_id IS NULL)
- Full-text search via `messages_fts` (FTS5)
- Indexes: `idx_messages_thread_id(thread_id, id)`, `idx_messages_room_root(room_id, id) WHERE thread_id IS NULL`, `idx_messages_room_feed_pos(room_id, feed_pos, id)`, `idx_messages_thread_feed_pos(thread_id, feed_pos, id) WHERE thread_id IS NOT NULL`

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

### skills / skill_revisions / skill_files
Skills library (migrations/20261027-skills-library.sql; replaced `agent_skills`, which was dropped).

- `skills` — one row per skill: `name` (slug `^[a-z][a-z0-9-]{1,47}$`, UNIQUE), `description`, `argument_hint`, `enabled`, `current_revision_id`, `created_by_actor_id` / `created_by_sub_agent_id` (NULL = owner; ON DELETE SET NULL).
- `skill_revisions` — every edit is a new `version` (UNIQUE per skill); `body` = full SKILL.md, `manifest_hash` = sha256 of the sorted file list (agent cache key), `source_url` for GitHub imports. Newest 20 kept.
- `skill_files` — `(revision_id, path)` → `sha256`, `size`, `mode` (420/493). SKILL.md is a row too. Content lives in content-addressed blobs `data/skill-blobs/<aa>/<sha256>` (`STOA_SKILL_BLOBS_DIR`), never served statically; GC in `gcTick`.
- `skill_sources` (migration `20261029-skill-sources.sql`) — one row per skill that has a git source. `skill_id` PK FK → `skills(id)` ON DELETE CASCADE. Columns: `kind TEXT CHECK(kind IN ('git'))`, `url`, `ref`, `subdir`, `commit_sha` (SHA of the content in the current revision), `synced_revision_id` (integer, no FK — identifies the revision a git import/update wrote; if `skills.current_revision_id` differs, `local_changes` is true), `checked_commit` (SHA seen at last `ls-remote`), `checked_at`, `created_at`, `updated_at`. URL never carries credentials.
- `messages.skill_refs` (migration only) — JSON `[{id, name, version}]` on the agent run message that used the skills.

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

### room_schedules
Scheduled triggers (migration `20261024-scheduled-triggers.sql`, which copied and dropped the old `sub_agent_schedules`). Defined ONLY in that migration, not in `schema.sqlite.sql` (boot runs the schema first, a copy would break the CREATE on a fresh clone).

```sql
CREATE TABLE room_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  target_actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,      -- AI agent that runs the task
  created_by_actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,  -- human or agent
  task TEXT NOT NULL,
  schedule_spec TEXT NOT NULL,   -- JSON normalized by lib/schedule.js: interval|daily|weekly|monthly|yearly
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,              -- UTC; NULL iff disabled
  last_run_at TEXT, last_error TEXT,   -- last_error also holds "skipped: <status>"
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
-- idx_room_schedules_due(enabled, next_run_at), idx_room_schedules_room, idx_room_schedules_target
```

Old sub-agent schedules were migrated as `target_actor_id = sub_agents.parent_actor_id`, `task = '@<label> ' || task`. A fired run is a `messages` row from the human participant with `automation_provider='schedule'`, `automation_name=<cadence>`, `automation_id=NULL` (that column FKs `automations`).

---

## MCP Gateway Tables

Added in `migrations/20261022-mcp-gateway.sql`.

```sql
-- Installed MCP servers
CREATE TABLE mcp_servers (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,              -- namespace prefix (e.g. "context7")
  name TEXT NOT NULL,
  transport TEXT NOT NULL CHECK(transport IN ('stdio','http')),
  command TEXT, args_json TEXT,           -- stdio only
  url TEXT,                               -- http only
  env_enc TEXT,                           -- AES-GCM encrypted env/headers JSON
  auth TEXT CHECK(auth IN ('none','headers','oauth')),
  preset TEXT,                            -- catalog id, NULL = custom
  enabled INTEGER NOT NULL DEFAULT 1,
  default_access TEXT NOT NULL DEFAULT 'none' CHECK(default_access IN ('all','none')),
  created_at TEXT, updated_at TEXT
);

-- Per-tool overrides (enable, approval, rate limit)
CREATE TABLE mcp_tool_overrides (
  server_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  rate_limit_per_min INTEGER,
  PRIMARY KEY (server_id, tool)
);

-- Access policy (agent / sub_agent / room × server)
CREATE TABLE mcp_access (
  server_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('agent','sub_agent','room')),
  subject_id INTEGER NOT NULL,
  allow INTEGER NOT NULL,
  PRIMARY KEY (server_id, subject_type, subject_id)
);

-- Per-session tokens (hash only)
CREATE TABLE mcp_tokens (
  token_hash TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL, room_id INTEGER, thread_id INTEGER, sub_agent_id INTEGER,
  created_at TEXT, revoked_at TEXT
);

-- Call audit log
CREATE TABLE mcp_calls (
  id INTEGER PRIMARY KEY,
  server_id INTEGER, server_slug TEXT, tool TEXT NOT NULL,
  actor_id INTEGER, sub_agent_id INTEGER, room_id INTEGER, thread_id INTEGER,
  args_preview TEXT,   -- redacted, max 2KB
  status TEXT NOT NULL CHECK(status IN ('ok','error','denied','timeout','rate_limited')),
  error TEXT, duration_ms INTEGER, result_bytes INTEGER,
  created_at TEXT,
  approval TEXT        -- 'owner' | 'exemption' for approval-gated calls, NULL otherwise
);

-- Approval requests (requires_approval tools)
CREATE TABLE mcp_approvals (
  id INTEGER PRIMARY KEY,
  server_id INTEGER, server_slug TEXT, tool TEXT NOT NULL,
  actor_id INTEGER, sub_agent_id INTEGER, room_id INTEGER, thread_id INTEGER,
  args_preview TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','expired')),
  decided_at TEXT, expires_at TEXT,
  created_at TEXT
);

-- "Always allow": agent (sub_agent_id NULL) or one sub-agent skips approval for one tool. Exact match
-- only (parent ≠ sub-agent). UNIQUE index on (server_id, tool, actor_id, COALESCE(sub_agent_id,0)).
-- FKs CASCADE (server, actor, sub-agent) + cleared in dropActor/forgetSubAgent.
CREATE TABLE mcp_approval_exemptions (
  id INTEGER PRIMARY KEY,
  server_id INTEGER NOT NULL, tool TEXT NOT NULL,
  actor_id INTEGER NOT NULL, sub_agent_id INTEGER,
  created_at TEXT
);
```

**Access policy resolution** (deny wins):
1. `mcp_access` sub_agent explicit row
2. `mcp_access` agent explicit row (parent of sub_agent)
3. `mcp_servers.default_access`

**Cleanup:** `mcp_access` rows for deleted agents/sub-agents/rooms are cleaned up by DELETE triggers on those tables.

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

### Runner (`lib/migrations.js`, called from server.js at boot)
- Boot order: `db/schema.sqlite.sql` (whole-file `db.exec`, non-fatal) → `migrations` table → legacy seeds (`LEGACY_MIGRATIONS`) → pending files in name order, each in one transaction, recorded only on success.
- **Baseline vs migrations:** a fresh DB already has the columns/indexes that older migrations add, so they fail with `duplicate column name` / `index ... already exists`. On exactly those two errors the runner re-runs the file statement by statement (`splitSqlStatements`, trigger/quote/comment aware), skips only the `ALTER TABLE ... ADD` / `CREATE INDEX` whose object exists, runs everything else (backfills, other indexes, table rebuilds) and records the file (`[migration] applied: X (already present, skipped: ...)`). Any other error — including `table ... already exists` — rolls the whole file back and it is retried next boot.
- **schema.sqlite.sql must load whole on an empty DB.** `db.exec` stops at the first failing statement and everything after it is silently missing (since #136 an index on `messages.sub_agent_id` / `parent_message_id`, columns that only migrations add, cut off `auth_users`, `auth_sessions`, `usage_log`, …). Never put an index in the baseline that references a column the baseline table does not define; leave it to its migration. Test: `[Migration Runner]` in test.js builds a fresh DB from the schema and runs the runner twice.

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
CREATE INDEX idx_room_participants_workdir_id ON room_participants(workdir_id);
CREATE UNIQUE INDEX idx_ai_sessions_main_unique ON ai_sessions(participant_id, thread_id) WHERE sub_agent_id IS NULL;
CREATE UNIQUE INDEX idx_ai_sessions_sub_unique ON ai_sessions(participant_id, sub_agent_id, thread_id) WHERE sub_agent_id IS NOT NULL;
CREATE INDEX idx_ai_sessions_thread ON ai_sessions(thread_id);
CREATE INDEX idx_messages_room_thread_state ON messages(room_id, thread_id, state) WHERE sub_agent_id IS NOT NULL;  -- migration 20260915 only (not in baseline)
CREATE INDEX idx_messages_room_parent ON messages(room_id, created_at) WHERE parent_message_id IS NOT NULL;  -- migration 20260915 only (not in baseline)
CREATE INDEX idx_messages_participant_room ON messages(participant_id, room_id, id);
```

**Why:** Most queries are "get messages for room X", "get roots for feed", or "get thread replies". Composite indexes cover sub-agent streaming checks, parent message activity, and participant lookups.

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

**Never `INSERT INTO messages_fts(messages_fts, ...) VALUES('delete', ...)` by hand before deleting a message.** `messages_fts_ad` already does it; a second 'delete' corrupts the external-content index (`integrity-check` → "database disk image is malformed"). Fixed in DELETE /api/messages/:id (was doing both).

User input never goes to MATCH raw: `lib/search-query.js` `buildFtsQueries()` (quoted terms, prefix, OR fallback).

### message_embeddings (semantic search)
`message_id` PK → messages ON DELETE CASCADE, `model`, `vec` BLOB (Float32 LE, 384 dims; NULL = too short (<12 chars) or model failed → never retried), `created_at`. Trigger `message_embeddings_au` deletes the row on content UPDATE so the backfill re-embeds it. Rows whose `model` differs from the current one count as missing (model switch = full re-embed). Written only by `lib/semantic-index.js`.
