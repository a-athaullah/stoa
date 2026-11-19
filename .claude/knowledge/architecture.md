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
- Each room has exactly one **primary agent** (`rooms.primary_actor_id`). Messages with no @mention trigger only the primary. All other agents (companions) only run when @mentioned — by the human or by the primary.
- Primary is set at room creation (defaults to workdir owner agent); fallback is the AI participant with the lowest `room_participants.id`.
- `DELETE /api/actors/:id` returns 409 if the actor is primary in any room (including archived). Primary cannot be reassigned via API yet.

### Sub-Agent Auto-Wake Rules
- Parent is woken after sub-agent completes **only if** the sub-agent was triggered by the parent (mention in parent response, wake cascade, or API spawn)
- Parent is **not** woken when a human or automation directly @mentions a sub-agent — unless the same message also mentions the parent explicitly, or the sub-agent finishes with an error
- Wake is queued durably (survives server restart) via `pending_wakes` table
- A run can end while its background task (test suite, render) still runs; the CLI then reports the real result in a turn of its own, posted by `postUnsolicitedResult` (stoa.js) as a proactive message with `unsolicited: true` + `background_running`. `send()` (lib/room-messages.js) wakes the parent with that message only when `background_running === false` and the sub-agent's latest run in that room/thread is finished with `wake_parent=1` — so a progress turn ("tests running, waiting"), a direct human mention, `stoa__message_send`, an idempotent `event_id` retry and an old client (no `background_running`) never wake it. A sub-agent credential cannot send the marker (stripped in the HTTP route). The wake prompt says the sub-agent continued in the background (not a new run): drainWake recognizes the row as a complete message without `completed_at`
- `background_running` comes from the session's background task list (claude-session.js): `background_tasks_changed` replaces it, `task_started` (unless `is_backgrounded: false`) adds a task and `task_notification` removes it, because the CLI can hold the level event back past a turn's result. Ordering is not guaranteed beyond that: a stale entry → flag `true` → no wake (the pre-fix behavior, the next turn or a human picks it up). Harnesses without `hasBackgroundTasks()` send no flag → no wake
- When parent wakes, the sub-agent's result (failure notes, cost summary) is delivered as a task in the parent's input (outside chat history)
- Tasks from API spawn (`/sub-agent-trigger`) are delivered to the sub-agent as a task input (outside chat history). Scheduled triggers (`room_schedules`) post a room message routed to their target agent; an `@label` in the task reaches the sub-agent through normal mention routing
- Mentions inside inline code (backticks) or code fences (``` or ~~~) are never treated as triggers; unclosed fences/backticks have no suppressing effect

### Sub-Agent Model on an AI Platform
- `sub_agents.model_platform_id` (migration `20261115-sub-agent-model-platform.sql`) pins a non-Claude `model` of a claude-harness sub-agent to one AI platform (Settings → AI platforms; same id as `rooms.model_config.platform_id`).
- Saved via REST (`POST /api/actors/:id/sub-agents`, `PATCH /api/sub-agents/:id`) and MCP (`stoa__sub_agent_create/update`), both through `lib/sub-agents.js` `modelCheck`: the platform must exist, be enabled and serve the model (`cached_models`, narrowed by `enabled_models` — `platformServesModel` in server.js, shared with `isModelCompatible`). 400 for: id without a model, id on a non-claude harness, non-Claude model on the claude harness without an id. A Claude model or no model stores NULL. A PATCH that changes the model without sending the id keeps the stored platform only if it serves the new model (else 400); a harness change away from claude or a cleared model drops it. Rules are checked only when `model`, `model_platform_id` or `harness` is sent, so a sub-agent whose platform was disabled later can still be renamed or parked.
- Run (`triggerAiResponse`): base URL / keys / proxy token (`isProxyPlatform` → `mintProxyToken`) / tools support / `runPlatform` (Venice image + video tools via `setRunContext`) come from the sub-agent's platform, not the room's. `model_source='sub_agent_platform'`, chain = that one model (no tier fallback). The platform is re-checked per run (`subAgentPlatformCheck`); missing / disabled / model gone → the run ends at once with an error naming the sub-agent.
- Changing the parent's adapter away from claude resets an inheriting sub-agent's platform model to the harness default and clears the id.

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
- Auto-update: manifest + file endpoints serve `stoa.js` only from a `dist/stoa.js` bundle that passes `agentBundleStatus()` (checked per request); the agent verifies each download (`node --check`, no unshipped relative requires) before an atomic replace with a `.bak` (known-issues: Known Bugs #6)
- On connect: unmigrated CLAUDE.md files imported to room system_prompt

### Work Journal (`lib/work-journal.js`)

Tracks which sessions are actively working so a connector restart (self-update, crash, SIGKILL) leaves a recoverable record. Motivation: a self-update restart in November 2026 killed every Claude Code session and nothing knew which work had been interrupted (task card 3/3 reads these entries to recover).

**Location on disk:** `~/.stoa/journal/actor-<actorId>/` (override with `STOA_JOURNAL_DIR`). The parent directory and the per-actor subdirectory are both `0700` and must be real directories (symlinks refused). Each entry file is `0600`, named `<sha256(session_key)[0..32]>.json` — the hash prevents any path value in a session key from escaping the directory.

**Lifecycle:**
- Entry is created/updated when a turn starts (`state: "turn_running"`).
- When the turn ends but background tasks are still running, state becomes `"background_only"`.
- Entry is removed once both the turn and all background tasks are done, or when the session closes/resets.
- On connector exit (restart, SIGINT, SIGKILL, too-many-errors), entries are **left in place** — that is their purpose. A new process never removes entries written by a previous process.

**Entry schema v1** (no prompt, token, secret, or env stored):

| Field | Type | Description |
|---|---|---|
| `v` | 1 | Schema version |
| `actor_id` | integer | STOA_ACTOR_ID |
| `session_key` | string | `buildSessionKey()` output (workdir::room::t:thread[::sub:id]) |
| `room_id` | integer\|null | |
| `thread_id` | integer\|null | null = main feed |
| `sub_agent_id` | integer\|null | |
| `message_id` | integer\|null | Stoa trigger message of the latest turn |
| `task_id` | integer\|null | Task board card that owns the thread (sent by server in `agent_trigger`) |
| `resume_session_id` | string\|null | Claude Code `--resume` session id |
| `harness` | "claude"\|"codex" | |
| `state` | "turn_running"\|"background_only" | |
| `cause` | "turn"\|"auto_turn"\|"background" | What started this stretch |
| `since` | ISO string | When session went from idle to working |
| `pid` | integer | Connector process id |
| `updated_at` | ISO string | Last write |
| `recovered_at` | ISO string\|null | Set by `markRecovered()` (card 3/3) |
| `recovery_count` | integer ≥ 0 | Incremented by `markRecovered()` |

**Writes are atomic:** temp file (`O_EXCL`, 0600) → `fsync` → `rename` → `fsync` dir. Stale temp files (> 10 min old) are cleaned up by `list()`.

**Corrupt files** are quarantined as `<name>.corrupt-<ms>` without crashing. `list()` returns only valid entries sorted by `since`.

**Best-effort:** every journal I/O is wrapped in try/catch. A journal failure logs one line (deduplicated) and returns; it never fails an agent turn.

**`task_id` delivery:** `triggerAiResponse` in `server.js` looks up the task card for the room+thread and sends its id in the `agent_trigger` WS event. For the first run of a runner card (before the thread is attached to the card), the server also accepts a card that is `running`, has no `thread_id` yet, and whose id is stamped on the thread's root message via `messages.task_id`. The connector stores it in the journal entry.

**API:** `createWorkJournal({baseDir, actorId})` → `{ dir, upsert, remove, get, list, markRecovered, markExit, readExit, fileFor }`.

**Exit record:** `exit.json` in the actor dir (`{ v, pid, reason: "update" | "restart", at }`), written by a planned exit (`doRestart`: self-update / server-requested restart = `update`, owner restart from the UI and SIGINT = `restart`). An entry whose pid has no exit record died unplanned (`crash`: crash, SIGKILL, OOM, reboot).

**Heartbeat:** an unchanged working entry is rewritten every `JOURNAL_HEARTBEAT_MS` (10 min), so `updated_at` ≈ last seen alive.

### Session Recovery (`lib/session-recovery.js`, self-healing 3/3)

After a connector process dies mid-work, its journal entries are recovered once the agent is back:

1. `agent_connect` → `agent_ready { recover_journal: true }` (only when the agent is current; an outdated agent updates first and its next process reports).
2. The connector sends `recovery_report { restarted_at, entries[] }`: entries **another** process wrote (own pid = live work, never reported), max 50, once per process. Each entry is `markRecovered()` (count + 1) **before** it is sent; an entry that cannot be marked is not reported.
3. The server (`sessionRecovery.report`) decides per entry, one report per connection: **discard** (not a participant, room archived, thread not a root of that room, sub-agent not owned/linked, malformed, `updated_at` older than `RECOVERY_MAX_AGE_HOURS`), **skip** (thread marked complete, a run in flight, a queued retrigger, an interrupted sub-agent run whose parent is woken via `pending_wakes`), **limit** (`recovery_count > RECOVERY_MAX_PER_THREAD`: system_event in the thread + running card → `returnToBacklog` with the reason), **recover** (row in `pending_recoveries`). It answers `recovery_result`; the connector removes every entry except `recover`.
4. `drainOne` (on report and on every `agent_connect`, only to a ready agent): claims (deletes) the row, posts the recovery notice as a system_event, then `triggerAiResponse` in the same thread (same queue, `max_concurrent`, outdated/offline handling). The card is looked up by thread on the server, never from the entry. The session resumes from `ai_sessions`, else the journal's `resume_session_id`; an id the CLI cannot resume falls back to a fresh session in the same thread (`claude-session.js`, "No conversation found"). `agent_trigger.recovery { session_key, recovery_count }` carries the count into the run's entry.
5. Failure: the recovery run ends with `agent_error` → card to Backlog (`recovery failed: <error>`); interrupted again (disconnect/timeout) → nothing, the journal reports it again (counted); a row not drained within 30 min (sweep) → card to Backlog (`recovery failed: the agent was not ready within 30 minutes`).

**Consecutive count** lives in the journal entry (agent disk): survives connector and server restarts, resets when the session's work settles (entry removed). A crash-looping connector reaches the limit.

**A server restart alone recovers nothing:** the connector keeps running, its runs are revived on reconnect (`active_message_ids`), its entries carry its own pid.

**Card grace:** besides the server-start `reap()`, `roomTasksRunner.holdThreads()` gives the running cards of the agent's interrupted threads the restart grace on disconnect / reconnect cleanup, so a connector-only restart no longer lets the quiet check finish a card from the `(interrupted …)` reply before the recovery arrives.

**Logs** (`[recovery]`): `restart: N sesi akan dipulihkan (Actor #X, M entri dilaporkan)`, then one line per entry: `dipulihkan` / `dilewati` / `dibuang` / `dihentikan` with the reason; `trigger:`, `terputus:`, `gagal:` while draining. The connector logs `restart: N journal entries reported` and one line per verdict.

## Knowledge Documents

`lib/knowledge-documents.js` (server), `lib/knowledge-file.js` (server + bundled into agent), `lib/knowledge-graph.js` (shared helpers), `migrations/20261119-knowledge-documents.sql` (Knowledge 3/6).

Agents add `.md`/`.markdown`/`.txt` files from their own machine to the room's knowledge base. The file is split per ATX heading (without an LLM) into nodes an agent can later retrieve. No raw text is stored — only scrubbed section text and the SHA-256 of the whole file.

### knowledge_add flow

```
Agent calls stoa__knowledge_add { path, name?, category? }
  ↓
Server sends WS knowledge_file_read { request_id, path, room_id, thread_id, sub_agent_id }
  to the connector that owns the calling MCP session
  ↓
Connector (stoa.js) validates: regular file, .md/.markdown/.txt, ≤512 KB (from stat, before read),
  strict UTF-8 (TextDecoder fatal), no NUL byte — refuses without reading if size/ext wrong
  ↓
Connector sends knowledge_file_read_result { request_id, name, content } | { request_id, error }
  ↓
Server re-validates: string type, byte length ≤ 512 KB, no \u0000, extension on name
  (connector may be old, broken, or forged — never trust it alone)
  ↓
splitSections: ATX headings outside code fences → sections with key + summary
  redactSecrets applied before split; each part ≤ SECTION_MAX = MAX_TEXT - TITLE_MAX - 1 (1879)
  ↓
Compare against existing sections (room_id + name identity):
  same section_hash → keep node unchanged
  changed section → update node title/summary/embedding, set active
  new section → insert node + source
  gone section → DELETE knowledge_sources row (trigger deletes node)
  ↓
Embed new/changed sections in batches of 16 (before transaction)
  embed not ready → 503, nothing written
  ↓
Single db.transaction: re-check hash, write knowledge_documents + knowledge_sources + knowledge_nodes
  hash unchanged inside transaction → unchanged: true, no write
  ↓
Recompute edges for new/changed nodes (cosine ≥ KNOWLEDGE_EDGE_SIM, up to 8 per node)
  ↓
Return { document_id, name, sections, added, updated, removed, unchanged_sections }
```

**Feature flag:** connector must announce `knowledge_add` in `agent_connect.features`. Without it the tool answers an error ("update agent"/"agent offline"), nothing is written.

**Concurrency:** an in-memory lock per `(room_id, name)` prevents two parallel `add` calls from racing. The second gets 409. Inside the transaction the hash is re-checked.

**Eligibility gate:** `eligibleRoom()` from `lib/knowledge-extraction.js` (same as extraction) is checked before `knowledge_file_read` is sent and again before writing. 403 if not eligible. List and delete still work so a document never gets stuck in a non-eligible room.

### Re-ingest

Adding the same `name` again updates the document rather than creating a duplicate. Identity is `(room_id, name)`. Detection: SHA-256 of the raw file — if hash is the same AND all existing `section_hash` values match → `unchanged: true`, nothing written.

### Deletion

`stoa__knowledge_document_delete { id }` deletes `knowledge_documents`. Cascade + trigger `knowledge_sources_ad` removes nodes automatically. Deleting a room cascades through messages/documents.

Document nodes are **never** merge targets of conversation extraction (Knowledge 2/6). `candidatesFor` and `store()` in `lib/knowledge-extraction.js` skip nodes that have a document source, so a re-ingest never overwrites conversation summaries and conversation sources never attach to document nodes. Edges between document and conversation nodes are still allowed.

### Section splitting

- ATX headings (`#`–`######`) at the start of a line, outside fenced code blocks (`` ` `` `` ` `` `` ` `` or `~~~`).
- Setext headings (underline style) are ignored.
- Section key = heading path `H1 > H2 > H3` (normalized: trim, single spaces). Duplicate path gets ` #2`, ` #3` suffix. Text before the first heading → key `(intro)`.
- Empty sections (heading only, or whitespace) are skipped.
- Sections longer than `SECTION_MAX` (1879) are split at paragraph breaks; a single paragraph exceeding the limit is cut hard → key ` [part N]`.
- Max 300 sections per document → 400 if exceeded.

### Validation limits

| Limit | Value |
|-------|-------|
| `KNOWLEDGE_DOC_MAX_BYTES` | 512 KB (exported from `lib/knowledge-file.js`) |
| Max sections per document | 300 |
| `SECTION_MAX` | `MAX_TEXT - TITLE_MAX - 1` = 1879 chars |
| `TITLE_MAX` | 120 chars |
| `LIST_MAX` (documents list) | 500, with `truncated: true` when exceeded |
| Document name max | 200 chars |

---

## Knowledge Search

`lib/knowledge-search.js` (server), `migrations/20261119-knowledge-usage-time.sql` (Knowledge 4/6). Tool `stoa__knowledge_search` (lib/stoa-mcp-tools.js), endpoint `GET /api/knowledge/usage`, WS event `knowledge_used`.

### Ranking (hybrid, same rule as message search)

```
validate query / limit (400 before any work)
  ↓
semantic.ready? → embed([query], { passage: false, timeoutMs: SEARCH_TIMEOUT_MS = 4 s })   ← the only await
  null / timeout / not ready → text only (semantic: false), never an error
  ↓ (from here synchronous: a node deleted while embedding is simply not read)
load active nodes (embedding only when embedding_model = semantic.model)
  text list:     per query unit (loose word, prefix match from 3 chars; "quoted phrase" exact)
                 title hit 2, else summary hit 1 → score / (2 × units); JS scan, Unicode-folded
  semantic list: dot(query, node) for same-dimension vectors, top 20, keep sim > 0 and ≥ best − 0.05
  ↓
fuseRrf(text, semantic) (lib/search-query.js, k = 60) → top `limit`, score = RRF score
  ↓
sources (canReach per room, cached per call) → usage rows (1 transaction) → knowledge_used to browsers
```

Both lists scan the active nodes in memory: the cosine needs every vector anyway, and the graph is one owner's (hundreds to a few thousand nodes). Revisit if it grows by orders of magnitude.

### Why sources are filtered but summaries are not

Card #37: an agent anywhere may use what is known; links into a room stay behind that room's access rule. Exclusion of private rooms happens at write time (`eligibleRoom`), so every stored node is shareable; only its message links are not. Hidden message sources are a count only, so neither a room id nor its existence leaks.

---

## Knowledge Brain (3D graph)

`lib/knowledge-layout.js` (positions + `GET /api/knowledge/graph`), brain views in `lib/knowledge-admin.js` (node detail, recent searches, upload), `migrations/20261120-knowledge-layout.sql` (Knowledge 6/6). Frontend: the Knowledge page (Canvas 2D).

```
graph read → ensureBasis (1 transaction): no basis / other model or dims / early basis (< 50 nodes) and now ≥ 2× → PCA again
               (covariance of ≤ 2,000 evenly spaced vectors, power iteration from a fixed start, sign fixed) and every
               projected position rewritten
           → listed nodes without a fitting position (none, vector changed → trigger dropped it, model changed, stored
               position outside the current brain volume) filled
               (1 transaction): vector → standardize, tanh(|p|/2) into the unit ball, pour into the brain volume
               (hemisphere by sign of x, ray march from the hemisphere centre, id jitter); no vector → spot from the id
           → nodes + edges between them
```

Brain volume: `public/js/knowledge/brain-volume.js` (`kbInside`, smooth-union lobes, one file required by the server and loaded by the page). Stable by design: a new node is projected with the stored basis, so nothing else moves; a shape change re-places only the nodes left outside. Positions are never written on the extraction path. 3,000 × 384-dim nodes: first read ≈ 0.4 s (test limit 1.5 s), cached ≈ 10 ms (limit 300 ms).

## Knowledge Extraction

`lib/knowledge-extraction.js` (server), `lib/knowledge-agent.js` (connector), `migrations/20261118-knowledge-extraction.sql` (Knowledge 2/6).

Turns finished conversations in opted-in rooms into knowledge nodes via a background queue. Never runs per-message — only on discrete events.

### Trigger events

| Event | Code path |
|-------|-----------|
| Thread marked complete | `lib/room-messages.js` → `enqueueConversation(roomId, threadId, 'thread_complete')` |
| Task card moved to Finished | `lib/room-tasks.js` → `enqueueConversation(roomId, threadId, 'task_done')` |
| Conversation quiet for `KNOWLEDGE_IDLE_HOURS` (default 6 h) | `sweep()` → `enqueueConversation(..., 'idle')` every 15 min |
| Node goes stale (a source deleted: trigger `knowledge_sources_ad`; a source message's content edited: trigger `knowledge_messages_au`) | triggers only set `status='stale'`; `sweep()` (every 15 min) picks stale nodes by `stale_at` → `enqueueStale(nodeId)` (reason `stale`) |

### Queue and lease

1. `enqueueConversation` / `enqueueStale` inserts a row into `knowledge_jobs` (`INSERT OR IGNORE` — duplicate trigger = no-op). Non-idle triggers replace a `failed` tombstone first so a repaired conversation can be retried.
2. `tick()` (every 30 s) picks `pending` jobs ordered by id, up to 5 per tick. For each job, the server:
   - Checks `eligibleRoom()` (see Privacy).
   - Reads messages after the cursor (`knowledge_cursors.through_message_id`), capped at 200 messages / 60 KB.
   - Embeds the segment, finds up to 5 candidate nodes (cosine similarity, active only, sources in an eligible room).
   - Sets `status='running'`, records `leased_actor_id`, sends `knowledge_extract` WS event to the agent.
3. The agent runs a one-shot claude process (`knowledge-agent.js`) and answers `knowledge_extract_result`. Only the leased actor's result is accepted.
4. The server validates the output strictly (`parseExtraction`; a title / summary is not refused for length: the prompt asks for 120 / 2000 chars (`LIMITS`), the server keeps up to `HARD` 160 / 2500 and cuts longer text on a grapheme boundary with "…", logging lengths only: `job N output over the prompt limits: node 0: summary 2340 > 2000`), embeds the summaries, and stores everything in one transaction:
   - `update_node_id` set by the agent → update that candidate node.
   - No `update_node_id` but cosine ≥ 0.93 to an existing active node → merge (attach sources, update `updated_at`).
   - Otherwise → insert new node.
   - Edges recomputed for changed nodes (cosine ≥ 0.85, up to 8 per node).
   - Cursor advances to the last message in the segment.
   - Messages edited during the run → their nodes marked stale for the next sweep.
5. Job deleted on success. If `more=true` (segment hit the byte/count cap), a new job is enqueued immediately.

### One-shot summarizer (connector side)

`lib/knowledge-agent.js` spawns `claude` with:
- `--tools ""` — no tools
- `--strict-mcp-config` without `--mcp-config` — no MCP server at all
- `--disable-slash-commands`, `--no-session-persistence`
- `cwd = ~/.stoa/knowledge-work` (empty, isolated, no CLAUDE.md)
- env stripped of all `STOA_*` vars — no credentials

The process is killed via `SIGKILL` once the answer arrives or the timeout fires (default 5 min, max 10 min). It is not in `sessionPool` or the work journal. If the connector is at its `max_concurrent` run limit, it replies `{ busy: true }` and the server retries the job after 60 s.

### Lease expiry and retries

- Lease timeout = `timeout_ms + 2 min`. Expired leases are detected on each `tick()`.
- Failed attempt: `attempts + 1`. Backoff: `2^attempts × 60s`.
- After 3 failed attempts: `status='failed'` (tombstone). Idle sweep skips failed jobs. A new trigger event (thread_complete / task_done) clears the tombstone and re-enqueues.
- Jobs that failed with `invalid output: ... longer than ...` (before `HARD` existed) are requeued by `.claude/tools/requeue-knowledge-jobs.js` (`requeueLengthFailures`: pending, attempts 0; a job with a pending twin is deleted; other failures untouched; DB backup first, `--dry-run`).

### Privacy

`eligibleRoom(roomId)` is the single privacy gate, checked at enqueue, at send, and before storing results:

```
rooms.knowledge_enabled = 1
AND rooms.archived_at IS NULL
AND roomId NOT IN KNOWLEDGE_EXCLUDED_ROOM_IDS (env, comma-separated ids)
```

- Rooms not opted in are never read.
- Archived rooms are excluded even if previously opted in.
- `KNOWLEDGE_EXCLUDED_ROOM_IDS` for operator-level exclusions.
- Stale-node jobs: each source message is verified against `eligibleRoom`; if sources span rooms the agent is not in, the job is dropped.
- Logs carry ids and counts only — never message text or summaries.

### Environment variables

| Variable | Default | Meaning |
|----------|---------|---------|
| `KNOWLEDGE_IDLE_HOURS` | 6 | Hours of quiet before an idle sweep job is created |
| `KNOWLEDGE_EXCLUDED_ROOM_IDS` | (empty) | Comma-separated room ids to never extract from |
| `KNOWLEDGE_MODEL` | (empty, uses agent default) | Model passed to the one-shot claude process |
| `KNOWLEDGE_MERGE_SIM` | 0.93 | Cosine threshold to merge into an existing node |
| `KNOWLEDGE_EDGE_SIM` | 0.85 | Cosine threshold to draw an edge |

The per-job timeout is not configurable: the server sends `timeout_ms` = 5 min (`createKnowledge({ timeoutMs })` default) and the connector clamps it to at most 10 min. The lease expires after timeout + 2 min.

---

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
- **skills / skill_revisions / skill_files** - global skills library (lib/skills.js); `/name` in a prompt → trigger `skills` refs, agent caches files in `~/.stoa/skills`; agents manage their own skills via `stoa__skill_*` MCP tools and see an enabled-skill catalog in the system prompt
- **automations** - webhook → room message triggers
- **automation_connections** - Slack/Discord credentials
- **room_tasks / room_task_deps / room_task_events / room_task_settings** - per-room kanban board (lib/room-tasks.js + lib/room-tasks-runner.js)

## Room Task Board

Each room has a kanban board with four columns: `awaiting`, `backlog`, `ongoing`, `finished`. The board is owned by the server, not the agent — the runner loop lives in `lib/room-tasks-runner.js` and runs entirely on the server side, independent of which room the owner is viewing.

### Core files
- `lib/room-tasks.js` — CRUD for tasks, MCP tools, HTTP routes, WS broadcast
- `lib/room-tasks-runner.js` — runner loop (play/pause/stop), `composeTaskMessage`

### Runner flow
1. `play(roomId, who)` — humanOnly; sets `running=1` in `room_task_settings`, kicks `safeTick`.
2. `safeTick` — picks Backlog candidates up to concurrency; skips cards with unfinished deps (`waiting_on` list); starts each card as a thread message (provider `task`, badge `Task #<seq>`), sets status `running`.
3. How a card ends = the room's `completion_mode` (`room_task_settings`, read live on every `checkRuns`):
   - `quiet` (default): the agent's last reply in that thread completes (`threadBusy` → false for `settleMs`). The start of that reply becomes `result_summary`; card moves to `finished`.
   - `agent`: a quiet thread ends nothing; only `task_complete` (Finished + thread marked complete via `completeThread` → `lib/thread-complete-defer.js`, written once the agent's turn is over → `roomMessages.setThreadCompleted` + `thread_status`; see known-issues Design Constraint 10), `task_block` (Awaiting) or `task_fail` (failed). Only the card's agent decides (`checkWorking`: target = assignee or primary, sub-agent only the assigned one). Safety net: `maxMs` (`TASK_DECIDE_MAX_MS`, default 3 h) of quiet without a decision → `run.block` to Awaiting, reason `AGENT_UNDECIDED`, actor system, pinned to the thread. Any activity (thread busy, or a new agent reply between polls) resets the clock.
   - Switching mode drops the other mode's clock; already-posted task messages keep the old wording. `noReplyMs` applies in both modes.
4. `pause(roomId, who)` — humanOnly; sets `running=0`; in-flight cards finish naturally.
5. `stop(roomId, who)` — humanOnly; sets `running=0`; calls `abortThread` for each running card; calls `returnToBacklog` (status cleared).
6. Reap on server startup: runner cards (`status='running'`, no `claimed_by_actor_id`) stay in Ongoing — no column change, no event written. Each is added to `recovering` with `until = now + restartGraceMs` (`TASK_RESTART_GRACE_MS`, default 10 min). The quiet-thread, no-reply, and `maxMs` checks are skipped for recovering cards. Activity in a card's thread (new agent reply, or thread busy) ends the grace and normal checks resume. If grace expires with no activity, the outcome is mode-dependent (read live at expiry): `quiet` mode → `returnToBacklog(RESTART_UNRECOVERED)` (card to Backlog, `stopped` event, thread stays linked); `agent` mode → card removed from `recovering`, stays in Ongoing, and the `AGENT_UNDECIDED` / `maxMs` clock starts from that point (agent on another machine may still be working). All runners are turned off (`running=0`); the owner presses Play to restart. A card an agent claimed stays running (no server turn carries it); `recovering` and the no-reply / quiet-thread check skip it too. It still takes a concurrency slot.

### Scope rules (enforced in lib/room-tasks.js)
- Agents must be room participants; sub-agents must be linked.
- `ongoing` column: the runner (Play) or an agent starting an idle Backlog card itself (`claim()`, event `claimed`, `claimed_by_actor_id` / `claimed_by_sub_agent_id`, no thread). A human move to `ongoing` → 409; no reorder inside Ongoing.
- Moving out of `awaiting`: owner or agent (event `confirmed`, actor recorded). Owner decision 2026-11-12.
- A running card: the agent working on it (runner thread, or its own claim) may move it to `finished` (= complete), `awaiting` (= block) or, for its own claim, `backlog` (= release). The owner uses Stop.
- Runner controls (play/pause/stop) and concurrency change: human-only.
- Complete/block/fail: only the agent working on that card (a message in its runner thread, or its claimer; a parent agent for its sub-agent's claim). The owner always. `completion_mode='agent'` runner card: only the runner target (assignee / primary) or the assigned sub-agent; other agents in the thread → 403.
- `completion_mode` change (`PATCH /tasks/settings`): human-only, `'quiet' | 'agent'`.
- Archived room: 423 for all writes except runner pause/stop (halt flag).

### Design decisions
- Fractional rank (8-byte REAL) + periodic rebalance; no collisions at normal use.
- Task message uses provider `task` so the feed can render it with a Task badge.
- Task message (`composeTaskMessage`) = `[@label ]**Execute task #N: <title>**` + `(task_id X · read the card with stoa__task_get …)`, translated per agent language; `agent` mode appends `· ends only with stoa__task_complete / _block / _fail`. No description / checklist (owner decision 2026-11-12: the board is the source; the agent reads it with `task_get`). The title goes through `literal()` (code span) so markdown/HTML in it shows as typed. The completion rules for both modes live in the `task_get` / `task_complete` / `task_block` / `task_fail` tool descriptions (`RUN_END` in lib/room-tasks.js), keyed off that marker.
- Quick-add from the Awaiting column auto-sets `await_reason = 'Added to Awaiting by hand'`.
- Dependencies: runner skips a blocked card without moving it; card shows `blocked` status badge.

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

**Built-in tools:** Messaging (`stoa__message_send`, `stoa__messages_read`, `stoa__threads_list`, `stoa__thread_read`), Memory (`stoa__room/agent/sub_agent_memory_get/set`), System prompts (`stoa__room/agent_system_prompt_get/set`), Sub-agents (`stoa__sub_agent_list/create/update/delete/trigger`), Automation (`stoa__automation_list/create/update/delete`, `stoa__connection_list`), Task Board (`stoa__task_list/get/create/update/move/comment/complete/block/fail/retry/delete` — available in sub-agent sessions; human-only ops (runner play/pause/stop, concurrency) are enforced server-side), MCP servers (`stoa__mcp_catalog`, `stoa__mcp_server_list`, `stoa__mcp_server_add`, `stoa__mcp_server_update` — main sessions only; add and update are approval-gated). Each tool calls the same `lib/*.js` core function as its REST counterpart (`{status, body}`), so validation is never duplicated. Configuration-mutating tools post a `· config` or `· automation` room notice via the same notice path as REST.

**Prompt injection follows the token:** `triggerAiResponse` issues the MCP token before building the prompt. When the session gets a token and its harness mounts the gateway (`MCP_HARNESSES`: claude, codex), the progress-reporting, sub-agent output, delegation and memory sections name the `stoa__*` tools; otherwise (tool-less model, token issue failure) they keep the original curl blocks.

**Upstream lifecycle:** stdio upstreams lazy-start on first call, idle-stop after N min, auto-restart with backoff. HTTP upstreams: stateless per request.

**Token:** issued per session trigger (`issueToken`), stored as SHA-256 hash in `mcp_tokens`. Sengaja tanpa TTL — token stabil selama session, tidak menyebabkan respawn. Revoked when actor / sub_agent / room deleted.

**Tool approval:** `requires_approval` tools hold the gateway call (up to `APPROVAL_TIMEOUT_MAX_MS` = 10 min), emit `mcp_approval` WS event to room/thread. Owner approves or denies via API. Default timeout 5 min (configurable `MCP_APPROVAL_TIMEOUT_MS`). Max 20 pending per actor. `decision: 'always'` stores an exemption (`mcp_approval_exemptions`, exact agent/sub-agent match); exempted calls skip the card and are logged with `mcp_calls.approval='exemption'`. Built-ins belong to the `mcp_servers` row with `builtin=1` (slug `stoa`, 2026-11-01): enabled, access, overrides, rate limit, approval and `always` apply exactly as upstream (`policyCheck` + `approvalFor` shared by both paths), calls/approvals carry its `server_id`. Approval is an override seeded by the migration for `mcp_server_add` / `mcp_server_update` only; the owner can change it. `previewArgs(args, ident)` replaces what the card and `mcp_calls.args_preview` show (add: env/header values → `***`, except preset fields marked `secret: false`; update: each change as `{from, to}`, env names only); a preview that would be cut (string > 500, array > 50, total > 2 KB) is refused before any card, so the owner always sees the whole call. An optional `precheck(ident, args)` (→ error or null) runs before the card too: a call bound to fail is a tool error with no `mcp_approvals` row (`mcp_calls.status='error'`); add prechecks with the same `newServerFields` validation as `createServer` plus the slug-taken check, and the insert still re-checks (slug race → 409); update prechecks the full plan (access, forbidden fields, values, no-op) and re-plans when it runs.

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

**Tables:** `mcp_servers`, `mcp_tool_overrides`, `mcp_access`, `mcp_tokens`, `mcp_calls`, `mcp_approvals`, `mcp_approval_exemptions`.

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
