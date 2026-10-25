# Stoa Architecture

## Core Concept
Single-user AI workspace untuk remote control panel banyak AI agent across multiple machines.

**NOT** multi-user collaboration tool — designed for solo developer managing multiple agents.

## System Components

### 1. Server (`server.js`)
- **HTTP server** - Static files + REST API
- **WebSocket server** - Real-time bidirectional communication
- **SQLite database** - All persistent data
- **Session management** - Claude API sessions per participant

### 2. Web UI (`index.html`)
- Single-page application
- Responsive (desktop/tablet/mobile)
- WebSocket client untuk real-time updates
- Voice input support (Web Speech API)

### 3. Agent Client (`stoa.js`)
- Runs on remote machines
- Connects via WebSocket
- Executes local commands (file operations, git, build tools)
- Authentication via `actor.secret`

## Key Flows

### Message Flow (Human → AI)
```
User types message in UI
  ↓
POST /api/rooms/:id/messages
  ↓
Insert to DB (state='requesting')
  ↓
WebSocket broadcast to room participants
  ↓
AI agent sees message, responds
  ↓
Response streamed back via WebSocket
  ↓
UI updates in real-time
```

### Agent Connection Flow
```
stoa.js starts on remote machine
  ↓
WebSocket connect to server
  ↓
Send 'agent_connect' with actor_id + secret
  ↓
Server validates secret (timingSafeEqual)
  ↓
Connection added to agentClients Map
  ↓
Agent ready to receive commands
```

### Multi-Agent Coordination
- Each room can have multiple AI participants
- Each AI participant = one Claude API session
- Session persists in `ai_sessions` table
- Workdir-specific sessions supported (same AI, different projects)

### Sub-Agent Auto-Wake Rules
- Parent is woken after sub-agent completes **only if** the sub-agent was triggered by the parent (mention in parent response, wake cascade, or API spawn)
- Parent is **not** woken when a human or automation directly @mentions a sub-agent — unless the same message also mentions the parent explicitly, or the sub-agent finishes with an error
- Wake is queued durably (survives server restart) via `pending_wakes` table
- When parent wakes, the sub-agent's result (failure notes, cost summary) is delivered as a task in the parent's input (outside chat history)
- Tasks from API spawn (`/sub-agent-trigger`) are delivered to the sub-agent as a task input (outside chat history). Scheduled triggers (`room_schedules`) post a room message routed to their target agent; an `@label` in the task reaches the sub-agent through normal mention routing
- Mentions inside inline code (backticks) or code fences (``` or ~~~) are never treated as triggers; unclosed fences/backticks have no suppressing effect

### Sub-Agent Team (Room 2638)

Stoa dioperasikan oleh tim sub-agent terspesialisasi yang di-trigger via @mention:

| Agent | Model | Tier | Tugas |
|-------|-------|------|-------|
| **Ara** | Sonnet 4.6 | — | Koordinator utama, analisis, lapor ke Aan |
| **Marcus** | Opus 4.6 | — | Code review, audit, security check |
| **Kenji** | Sonnet 4.6 | standard | Backend implementation |
| **Sofia** | Sonnet 4.6 | standard | Frontend implementation |
| **Clara** | Sonnet 4.6 | standard | Docs update (5 bahasa + knowledge base) |

**Coordination Flow:**

```
Aan kasih task
  ↓
Ara analisis & breakdown
  ↓
@Kenji / @Sofia → implementasi → selesai → @Ara
  ↓
@Marcus → code review → selesai → @Ara
  ↓
@Clara → update docs + knowledge base → selesai → @Ara
  ↓
Ara lapor ke Aan → Aan decide merge/hold/reject
```

**Aturan koordinasi:**
- Semua cascade via @mention — tidak ada curl manual
- Developer (@BE/@FE) selalu lapor ke @Ara, bukan langsung ke @TechLead
- Merge decision FINAL ada di Aan — reviewer hanya technical approval
- TechWriter wajib update docs jika ada perubahan API/UI/behavior

## Threading Model

### Concepts
- **Thread** = a conversation branch within a room, rooted at a message
- **Root message** = `thread_id IS NULL` — top-level message in feed
- **Reply** = `thread_id = <root_message_id>` — belongs to a thread
- **Legacy** = messages from before threading; all have `thread_id NULL`, appear as roots

### Concurrency
- Each thread has its own AI session: `ai_sessions.thread_id` (0 = legacy/room-level)
- `activeSequences` keyed by `${roomId}:${threadId||0}` — threads run in parallel
- `max_active_threads` per room (default 3) — caps parallel streaming threads
- `max_concurrent` per agent (default **1** in `.env`; recommended: 3) — caps parallel claude processes on agent machine. **Parallel between threads; always serial within a thread** (gating by session key in stoa.js run-queue, `lib/run-queue.js`).
- `busy_input_mode` (interrupt/queue/steer) checked per thread, not per room
- **Risk (max_concurrent > 1):** threads sharing the same workdir can race on files or git — no lock. Keep 1 for shared-code rooms.

### Agent Run Queue (stoa.js, v0.4.392+)
- Triggers wait on `sessionKey = ${workdir}::${roomId}::t:${threadId||0}[::sub:${subId}]` busy → FIFO within a thread, later threads can skip blocked ones
- `agent_queue_status` event: agent → server on every queue change and after `agent_connect` — `{ type, queued: [...msgIds], running: [...msgIds], max_concurrent }`
- Server ownership-checks the report, then: broadcasts `message_queue` positions to room clients; adds `agent_queues` to `/api/health/db`; writes `result_meta.timing`; logs one `[turn]` line per run
- `message_queue` event: server → room clients — `{ type, room_id, message_id, thread_id, position }` — `position: null` = run left queue
- 15-min run timeout is paused while a run waits in the agent queue; resets fully when it starts
- `result_meta.timing`: `{ queue_depth, parallel, queue_wait_ms, first_token_ms?, run_ms }` — server-authored; older agents that don't send queue status get no timing

### System Prompt
- `rooms.system_prompt` — room-level prompt, sent to agent as `--append-system-prompt`
- Agent restarts session if `system_prompt_hash` changes between triggers
- CLAUDE.md import: on agent connect, unmigrated workdirs' CLAUDE.md content imported to room system_prompt

### Agent Session Key Format
`${workdir}::${roomId}::t:${threadId||0}[::sub:${subId}]`

### WS Events
All WS events carry `thread_id` (null for root). Thread-specific events routed to thread panel if open.
`thread_summary` event updates feed chip without loading full thread.

## Session Management

### Claude Sessions
- One session per (participant_id, thread_id, workdir) tuple
- Sessions persist across server restarts (stored in DB)
- Idle timeout: 5 minutes (configurable via `SESSION_IDLE_TTL`)
- Session key includes thread_id for thread-level isolation

### Agent Sessions
- WebSocket connections are ephemeral
- Reconnect automatically on disconnect
- Version check on connect (force update if mismatch)
- On connect: unmigrated CLAUDE.md files imported to room system_prompt

## Security Model

### Authentication
- Agent: secret-based (SHA-256 comparison)
- User: session token (optional, for multi-device access)

### Authorization
- All WebSocket messages checked for valid connection
- Agent must be authenticated before processing commands
- Room participants validated before message delivery

## Data Model Highlights

### Core Entities
- **actors** - humans + AI agents
- **rooms** - conversation spaces
- **room_participants** - many-to-many (rooms ↔ actors)
- **messages** - conversation history
- **ai_sessions** - Claude API session persistence

### Special Tables
- **agent_workdirs** - per-agent project directories
- **agent_skills** - custom commands per agent/workdir
- **automations** - webhook → room message triggers
- **automation_connections** - Slack/Discord credentials

## MCP Gateway

Agent machines connect to Stoa's `/mcp` endpoint (streamable HTTP, MCP protocol) using a session token injected into env as `STOA_MCP_TOKEN`. The gateway proxies tool calls to upstream MCP servers (stdio processes or remote HTTP).

```
Agent (Claude/Codex)
  → POST /mcp  Bearer STOA_MCP_TOKEN
    → auth: token_hash lookup (mcp_tokens), scope = (actor, room, thread, sub_agent)
    → policy: sub_agent → agent → room → server default_access; deny wins
    → router: stoa tool (e.g. context7__resolve-library-id) → upstream client
              stoa__<tool> → built-in handler (lib/stoa-mcp-tools.js + lib/room-schedules.js), no upstream
              availableTo(ident) checked per tool before exposure and before call (sub-agent sessions
              see only message/read/own-memory tools; config-mutating tools hidden and refused)
    → audit: INSERT mcp_calls (args_preview redacted, capped at 2 KB)
```

**Built-in tools (24):** Messaging (`stoa__message_send`, `stoa__messages_read`, `stoa__threads_list`, `stoa__thread_read`), Memory (`stoa__room/agent/sub_agent_memory_get/set`), System prompts (`stoa__room/agent_system_prompt_get/set`), Sub-agents (`stoa__sub_agent_list/create/update/delete/trigger`), Automation (`stoa__automation_list/create/update/delete`, `stoa__connection_list`). Each tool calls the same `lib/*.js` core function as its REST counterpart (`{status, body}`), so validation is never duplicated. Configuration-mutating tools post a `· config` or `· automation` room notice via the same notice path as REST.

**Prompt injection follows the token:** `triggerAiResponse` issues the MCP token before building the prompt. When the session gets a token and its harness mounts the gateway (`MCP_HARNESSES`: claude, codex), the progress-reporting, sub-agent output, delegation and memory sections name the `stoa__*` tools; otherwise (tool-less model, token issue failure) they keep the original curl blocks.

**Upstream lifecycle:** stdio upstreams lazy-start on first call, idle-stop after N min, auto-restart with backoff. HTTP upstreams: stateless per request.

**Token:** issued per session trigger (`issueToken`), stored as SHA-256 hash in `mcp_tokens`. Sengaja tanpa TTL — token stabil selama session, tidak menyebabkan respawn. Revoked when actor / sub_agent / room deleted.

**Tool approval:** `requires_approval` tools hold the gateway call (up to `APPROVAL_TIMEOUT_MAX_MS` = 10 min), emit `mcp_approval` WS event to room/thread. Owner approves or denies via API. Default timeout 5 min (configurable `MCP_APPROVAL_TIMEOUT_MS`). Max 20 pending per actor.

**Agent update path:** Gateway is stateful (`mcp-session-id`, bound to the token that opened it). Claude Code keeps a GET SSE stream open; on any `/api/mcp/*` write or upstream status change the gateway recomputes each session's tool fingerprint (allowed servers + cached upstream tool names − disabled overrides, debounced 250 ms) and sends `notifications/tools/list_changed` only to sessions whose set changed → Claude re-lists mid-session (verified with Claude Code 2.1.306). No eventStore: with no GET stream open the SDK drops the notification silently (send() still resolves), so a session's fingerprint only advances when the notification went out on an open stream; when a session's GET stream (re)opens the gateway rechecks and sends whatever it missed. Codex spawns per turn → new session each turn. Unknown session id → 404 → client re-initializes (survives server restart). Sessions close on token revoke (forget*), after 10 min idle without an open stream, and per-token cap 8. No-session non-initialize requests are served statelessly.

**Env isolation:** stdio upstreams spawn with `baseEnv()` (PATH, HOME, TMPDIR + server-specific keys only), not `process.env`.

**Presets** (`lib/mcp-catalog.js`, 16): pinned npx package or https URL. Stdio presets run with `npx` because uvx and Docker aren't installed on the server. Rules:
- `env_fields` hold the owner's values, stored encrypted. A field with `kind: 'paths'` (the Filesystem folders) isn't passed as an env var; `connectionArgs` turns it into argv. The folders are checked on save and checked again at every start: each must be an absolute existing directory, not `/`, and must not contain or sit inside the Stoa install (which holds `.credentials-key`).
- `tool_defaults` adds `mcp_tool_overrides` rows in the same transaction as the install. Playwright's `browser_run_code_unsafe` (equivalent to RCE) starts disabled. Filesystem write tools and the browser upload tools start with approval required.
- `secret: false` fields come back in clear text (`env_keys[].value`); every other field is masked.
- Icons (`lib/mcp-icons.js`) ship with the catalog as `presets[].icon`: `{kind:'svg', path, hex, title, source}` for Simple Icons 16.35.0 glyphs (CC0, copied path data only), or `{kind:'initials', text, hex, title}`.

**Upstream work dir:** each stdio upstream gets its own `cwd` and `TMPDIR` at `<STOA_MCP_WORK_DIR or os.tmpdir()/stoa-mcp>/<id>` (0700; `run-tests.js` uses a temp root), and that directory is deleted when the server is deleted. Without this, the process would inherit the Stoa repo as cwd. Chrome DevTools limits file tools to TMPDIR and Playwright limits them to cwd, so both stay inside this directory (verified: a screenshot path outside it is refused). Browser presets run `--headless --isolated`: no window on the owner's screen and none of the owner's Chrome profile.

**Admin API** (`/api/mcp/*`): owner session only. Gateway endpoint (`/mcp`): MCP token only (not agent secret, not session cookie).

**WS events:** `mcp_status` (upstream up/down/error), `mcp_approval` (new pending), `mcp_approval_resolved` (decided).

**Retention:** `mcp_calls` and decided `mcp_approvals` pruned after `MCP_CALLS_RETENTION_DAYS` (default 30).

**Tables:** `mcp_servers`, `mcp_tool_overrides`, `mcp_access`, `mcp_tokens`, `mcp_calls`, `mcp_approvals`.

## Performance Optimizations

### Indexes
- All foreign keys indexed
- Frequently queried columns indexed
- FTS5 (`messages_fts`) for keyword search; `message_embeddings` for hybrid semantic search (multilingual-e5-small, 384-dim Float32, backfilled in worker thread)

### Caching
- In-memory WebSocket connection map
- Session reuse (avoid recreating Claude sessions)

## Deployment Notes

- Single server instance (SQLite = single writer)
- WAL mode enabled (better concurrency)
- No horizontal scaling needed (single-user design)
- Can run on low-powered devices (Raspberry Pi, etc.)
