# API Patterns

## Authentication & Authorization

### HTTP Routes

#### Public Routes (no auth required)
- `/api/auth/login` - Login endpoint (rate limited: 5 failures / 15 min per IP and per email)
- `/install.sh`, `/install.ps1`, `/install.cmd` - Agent install scripts (require valid `?token=` from `POST /api/agent/install-token`)
- `/api/agent/register` - Agent registration (install-token protected, one-time use)
- `/api/client/manifest` - Client version info
- `/api/client/file/:filename` - Client file download
- Static assets (`/css`, `/js`, `/dist`, etc.)

#### SPA Permalink Routes
`/r/<roomId>` and `/r/<roomId>/t/<threadId>` serve `index.html` — the client router resolves the path. Pattern: `APP_ROUTE_RE = /^\/r\/\d{1,15}(?:\/t\/\d{1,15})?\/?$/` (strict digit-only IDs, nothing else under `/r/`). These routes also serve `index.html` when unauthenticated (login overlay appears, permalink URL preserved after sign-in).

#### Protected Routes (require auth — previously public)
- `/uploads/*` - Session cookie, agent header, or signed URL required
- `/connector-media/*` - Session cookie, agent header, or signed URL required

#### Agent HTTP Auth (via headers)
```http
X-Agent-Id: <actor_id>
X-Agent-Secret: <secret>
```

Validation:
```javascript
const h = s => crypto.createHmac('sha256', 'stoa').update(s).digest();
if (crypto.timingSafeEqual(h(agentSecret), h(actor.secret))) { /* authorized */ }
```

**Use case:** Agent upload file, fetch workspace files, access `/uploads/*` and `/connector-media/*`

#### Install Token (human session only)
```
POST /api/agent/install-token
Body: { name?: string, lang?: string }
Response: { token: string, expires_in: 600 }
```
- Requires human session (`req._authUser`); agent header → 403
- Token = 64-char hex, valid 10 minutes, one-time use
- Used in install script URL: `/install.sh?token=<t>`

#### Signed File URL
```
/uploads/<file>?exp=<unix_seconds>&sig=<hex>
/connector-media/<file>?exp=<unix_seconds>&sig=<hex>
```
- `sig = HMAC-SHA256(signingKey, 'file|' + decodedPathname + '|' + exp)`
- Valid: `exp > now` AND `exp <= now + 8 days`; TTL default 7 days
- Path, sig, or exp mismatch → 401
- Helper: `signFileUrl(pathOrUrl, ttlSec = 7*24*3600)`

#### Device Cookie (`stoa_device`)
- Set on successful login: `<userId>.<issuedAt>.<hmac(signingKey,'device|'+userId+'|'+issuedAt)>`
- HttpOnly, SameSite=Lax, Secure when HTTPS, Max-Age 180 days
- Exempts the device from per-email login rate limit

#### Ollama Proxy Token (`/v1/messages`)
```
Authorization: Bearer stoa-proxy:<platId>:<actorId>:<sig>
```
- `sig = HMAC-SHA256(signingKey, 'proxy|' + platId + '|' + actorId + '|' + sha256(actor.secret))`
- Old format `stoa-proxy:<id>` → 401; empty bearer → 401
- Also accepts: `X-Agent-Id` / `X-Agent-Secret` valid headers

#### CSRF Protection
- Non-GET/HEAD/OPTIONS requests authenticated via **session cookie** (not agent header) check `Origin` header
- Allowed origins: `Host`, `public_url`, `X-Forwarded-Host` (from trusted proxy), `STOA_ALLOWED_ORIGINS`
- Mismatch → `403 { error: 'origin_not_allowed' }`
- No `Origin` header → allowed (non-browser clients)

#### Trust Proxy Model
- `STOA_TRUSTED_PROXIES`: comma-separated IP/CIDR. Default: `127.0.0.1/32,::1/128`. `none` = trust nobody.
- `clientIp(req)`: reads `CF-Connecting-IP` → `X-Real-IP` → `X-Forwarded-For` (rightmost non-trusted) only when socket IP is trusted; else = socket IP
- `isHttps(req)`: `req.socket.encrypted` OR (trusted socket AND `X-Forwarded-Proto === 'https'`)
- Spoof from untrusted IP → ignored

#### Signing Key
- Persistent HMAC key stored in settings table as `security_signing_key` (random 32-byte hex)
- Generated on startup if absent. Never logged or sent to client.

#### Agent Scope (`lib/agent-scope.js`)
Agent secrets are restricted to an allowlist; requests outside → `403 {"error":"agent_scope_denied"}` + log `[agent-scope] denied actor=<id> METHOD /path`.

Escape hatch: `STOA_AGENT_SCOPE=off` on the server (warning logged at boot; env only, not a header — not spoofable).

Scopes:
- `room` — agent must be a participant of the room `:id`
- `self` — `:actorId` in path must equal `x-agent-id`
- `sub-agent` — sub-agent `:id` must belong to the agent
- `connection` — connector must feed an automation targeting a room the agent is in
- `any` — valid agent secret is sufficient

Allowed routes (source: `AGENT_ALLOWED_ROUTES` in `lib/agent-scope.js`):

| Method | Path | Scope |
|--------|------|-------|
| POST | `/api/rooms/:id/message` | room |
| POST | `/api/rooms/:id/email-reply` | room |
| GET, PUT | `/api/rooms/:id/memory` | room |
| GET, PUT | `/api/rooms/:id/system-prompt` | room |
| POST | `/api/rooms/:id/sub-agent-trigger` | room |
| GET | `/api/rooms/:id/messages` | room |
| GET | `/api/rooms/:id/threads`, `/api/rooms/:id/threads/:id` | room |
| POST | `/api/upload/raw` | any |
| GET | `/uploads/*`, `/connector-media/*` | any |
| GET | `/api/docs/stoa-api(.xx)?.md` | any |
| GET, PUT | `/api/actors/:id/memory`, `/api/actors/:id/memory/(MEMORY\|USER).md` | self |
| GET, PUT | `/api/actors/:id/system-prompt` | self |
| GET, PUT | `/api/sub-agents/:id/memory` | sub-agent |
| GET | `/api/automations/connections/:id/messages` | connection |
| GET | `/api/automations` | any (server filters to agent's rooms via participant check) |
| POST | `/api/automations` | any (`target_room_id` must be an agent's room, `connection_id` must exist) |
| PATCH | `/api/automations/:id` | automation (target automation must target agent's room; new `target_room_id` must also be agent's room) |
| DELETE | `/api/automations/:id` | automation |
| GET | `/api/automations/connections` | any (agent gets id/name/provider/status only — no credentials) |
| GET, POST | `/api/rooms/:id/schedules` | room (POST: `target_actor_id` must be an AI participant of the room) |
| PATCH, DELETE | `/api/rooms/:id/schedules/:sid` | room (schedule must belong to that room, else 404) |
| GET | `/api/rooms/:id/schedules/doctor` | room |

**Automation scope notes:** Agents can build and manage automations on behalf of the workspace owner (PR #171, owner decision). Handlers do additional narrowing beyond scope: list filters by participant rooms; create/PATCH reject non-participant `target_room_id` with 403. GET `/api/automations/connections` strips credential/token fields for agent requests. Create/edit/delete connection, test-email, and Slack connect remain session-only. Every agent create/update/delete posts a permanent system message in the target room (suffix `· automation`) so the owner can monitor changes.

Cookie sessions (browser) have full access regardless. `/v1/messages` is unchanged (uses HMAC proxy token or agent header directly).

**MCP scope:** `/mcp` accepts only MCP session tokens (`Bearer` header, hash-looked-up in `mcp_tokens`). Agent secrets and session cookies are not accepted. `/api/mcp/*` admin endpoints require a session cookie (owner-only, no agent access).

#### MCP Gateway Token

```
POST /mcp
Authorization: Bearer <mcp_session_token>
Content-Type: application/json  (MCP JSON-RPC)
```

- Token issued per session trigger, stored as SHA-256 hash in `mcp_tokens`
- Scoped to `(actor_id, room_id, thread_id, sub_agent_id)` — gateway reads identity from token, not from request body
- Token injected into agent env as `STOA_MCP_TOKEN`; gateway URL as `STOA_MCP_URL`
- Sengaja tanpa TTL; revoked when actor/sub_agent/room deleted

**Admin API** (session cookie, owner only):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/mcp/catalog` | Available presets (static) |
| GET, POST | `/api/mcp/servers` | List / install MCP server |
| PATCH, DELETE | `/api/mcp/servers/:id` | Edit / delete server |
| POST | `/api/mcp/servers/:id/test` | Test connection, returns tool count |
| GET | `/api/mcp/servers/:id/tools` | Tools + overrides |
| PUT | `/api/mcp/servers/:id/tools/:tool` | Set tool enabled / requires_approval / rate_limit_per_min |
| GET, PUT | `/api/mcp/access` | Access matrix (agent/sub_agent/room × server) |
| GET | `/api/mcp/calls` | Activity log paginated (`?server_id=&actor_id=&before_id=`) |
| GET | `/api/mcp/approvals` | Pending/settled approvals (`?room_id=&status=`) |
| POST | `/api/mcp/approvals/:id` | Decide approval (`{ "decision": "approve"|"deny" }`) → 200/404/409 |

#### Cloudflare Access Service Token (`lib/cf-access.js`)
Optional agent-side feature for deployments behind Cloudflare Access (when Tailscale is unavailable).

Env vars (both must be set, or both ignored with a warning):
- `STOA_CF_ACCESS_CLIENT_ID`
- `STOA_CF_ACCESS_CLIENT_SECRET`

Behavior:
- Headers `CF-Access-Client-Id` and `CF-Access-Client-Secret` attached to WebSocket handshake and all HTTP fetches **to the Stoa origin only** (checked via `httpOrigin(url) === httpOrigin(stoaUrl)`)
- Child sessions (Claude Code, Codex) cannot curl the real Stoa URL — they get `ws://127.0.0.1:<port>/<randomHex>` as `STOA_URL`, which is a loopback forward proxy that injects the CF headers. Token never enters child env or prompts.
- Proxy: bind `127.0.0.1` only, random path prefix, absolute-form/CONNECT refused, body capped at 25MB, hop-by-hop and CF headers stripped from incoming client requests
- CF env vars deleted from `process.env` after read (children don't inherit); ecosystem.config.js chmod 600
- Without env vars: behavior identical to before (zero regression)

#### User Auth (via cookie)
```http
Cookie: stoa_session=<token>
```

**Use case:** Web UI requests

---

## Common Route Patterns

### Standard REST
```
GET    /api/actors              → List all
GET    /api/actors/:id          → Get one
POST   /api/actors              → Create
PATCH  /api/actors/:id          → Update
DELETE /api/actors/:id          → Delete
```

### Message Routes
```
GET    /api/rooms/:id/messages           → List roots (default scope=roots-only)
GET    /api/rooms/:id/messages?scope=all → List all (legacy, export)
POST   /api/rooms/:id/messages           → Create (body.thread_id for thread reply)
GET    /api/rooms/:id/messages/:msgId    → Get one
PATCH  /api/rooms/:id/messages/:msgId    → Update (edit)
DELETE /api/rooms/:id/messages/:msgId    → Delete (root with replies → 409; ?cascade=1 → delete all)

GET    /api/messages/:id                 → Look up a message by ID without knowing its room
```

**`GET /api/messages/:id`** — used by the client permalink router to resolve a `?m=<id>` link. Returns the full message row including `room_archived_at` (from the joined `rooms` table). Returns `{ error: 'message not found' }` with status 404 (JSON, not empty body) when the message does not exist.

**Pagination:**
```
GET /api/rooms/:id/messages?before=<messageId>&limit=50
```

Returns messages **older than** `messageId`, newest first. Default scope returns only root messages (thread_id IS NULL) with thread summary subquery.

### Search Routes

```
GET /api/search?q=<query>&room_id=<id>&mode=keyword|hybrid&limit=<n>
```

- `q` (required): search query string; sanitized by `lib/search-query.js` before passing to FTS5
- `room_id` (optional): scope to one room; omit to search all accessible rooms
- `mode` (optional, default `hybrid`): `keyword` = FTS5 only, `hybrid` = FTS5 + embeddings fused with RRF; falls back to keyword automatically while the model is not ready. Any other value → 400. (`match` is a per-row response field, not a query param.)
- `limit` (optional, default 30, max 100)

**Response:** JSON array (backward-compatible), each item:
```json
{
  "id": 123,
  "room_id": 5,
  "content": "...",
  "snippet": "...highlighted...",
  "match": "keyword|semantic|both",
  "thread_root_id": 120,
  "thread_root_preview": "first line of thread root"
}
```

Response header `X-Stoa-Search-Semantic: 1` when semantic results are included.

**Agent access:** human session only (agent HTTP auth → 403 `agent_scope_denied`). Agents use `agent_search` WS action.

```
GET /api/search/status
```

Returns `{ state: 'off'|'loading'|'ready'|'failed', model, dim, indexed, error }` (`error` is null unless `failed`). Human session only — agents do not need backfill status.

### Thread Routes
```
GET    /api/rooms/:id/threads            → List threads (?state=active for active only)
GET    /api/rooms/:id/threads/:rootId    → Get thread messages (root + replies asc)
GET    /api/rooms/:id/system-prompt      → Get room system prompt + max_active_threads
PUT    /api/rooms/:id/system-prompt      → Set system prompt + max_active_threads
```

---

### File Upload
```
POST /api/upload
Content-Type: multipart/form-data
```

**Response:**
```json
{
  "url": "/uploads/<hash>.<ext>",
  "filename": "original.png"
}
```

**Storage:** `uploads/<hash>.<ext>` (content-addressed)

**Cleanup:** Files older than 24h auto-deleted (except `uploads/avatar/`)

---

### Agent-Specific Routes

#### Register Agent
```
POST /api/agent/register
Content-Type: application/json

{
  "token": "<install_token>",
  "machine_id": "<uuid>",
  "hostname": "macbook-pro"
}
```

**Response:**
```json
{
  "actor_id": 5,
  "secret": "abc123...",
  "server_version": "1.2.3"
}
```

**Note:** `install_token` expires in 10 minutes.

---

#### Workspace File Access
```
GET /api/workspace/file?room=<room_id>&path=<relative_path>

Headers:
  X-Agent-Id: <actor_id>
  X-Agent-Secret: <secret>
```

**Flow:**
1. Server finds room's workdir
2. Sends WebSocket request to agent: `workspace_file_request`
3. Agent reads file, sends `workspace_file_response`
4. Server returns file content to HTTP client

**Use case:** Web UI preview file dari agent workdir

---

## WebSocket Protocol

### Agent → Server

#### Connection
```json
{
  "type": "agent_connect",
  "actor_id": 5,
  "secret": "abc123..."
}
```

Also sent: `client_version`, `harnesses_available`, `supervisor` (`'pm2'|null`), `boot_id` (random hex per agent process) — see Agent Restart.

Server validates secret, adds to `agentClients` Map.
After connect: sends `claude_md_import` for each unmigrated workdir.

#### CLAUDE.md Import (on connect)
```json
// Server → Agent
{ "type": "claude_md_import", "workdir": "/path/to/project" }

// Agent → Server
{ "type": "claude_md_import_result", "workdir": "/path/to/project",
  "content": "...", "tracked": true/false, "size": 1234 }

// Server → Agent (if untracked, after import)
{ "type": "claude_md_clear", "workdir": "/path/to/project" }
```

Decision logic: tracked + content → import to room system_prompt (if empty); untracked template → clear; untracked real content → import + clear.

#### Version Check
Server auto-sends after connect:
```json
{
  "type": "version_check",
  "expected": "1.2.3"
}
```

If mismatch → agent auto-updates via `/api/client/file/stoa.js`

---

### Server → Agent

#### Execute Command
```json
{
  "type": "execute",
  "request_id": "uuid",
  "participant_id": 10,
  "room_id": 3,
  "message_id": 42,
  "content": "User message text",
  "context": {
    "workdir": "/path/to/project",
    "model": "claude-sonnet-4-5"
  }
}
```

Agent spawns Claude session, streams response.

#### File Request
```json
{
  "type": "workspace_file_request",
  "request_id": "uuid",
  "path": "src/server.js"
}
```

Agent responds with file content.

---

### Agent → Server (responses)

#### Stream Chunk
```json
{
  "type": "response_chunk",
  "request_id": "uuid",
  "chunk": "partial text..."
}
```

#### Stream Complete
```json
{
  "type": "response_complete",
  "request_id": "uuid"
}
```

#### Error
```json
{
  "type": "response_error",
  "request_id": "uuid",
  "error": "Error message"
}
```

#### Agent Queue Status (agent → server, v0.4.392+)
```json
{
  "type": "agent_queue_status",
  "queued": [43001, 43002],
  "running": [42990],
  "max_concurrent": 3
}
```
Sent on every queue change and right after `agent_connect`. Server ownership-checks IDs and drops any not owned by this agent. Lists capped at 500.

#### Message Queue Position (server → room clients)
```json
{ "type": "message_queue", "room_id": 68, "message_id": 43001, "thread_id": 42830, "position": 2 }
{ "type": "message_queue", "room_id": 68, "message_id": 43001, "thread_id": 42830, "position": null }
```
- `position`: 1-based place in the agent's queue. `null` = run left the queue (started, cancelled, finished, or agent offline).
- `thread_id`: null for root message, otherwise thread root id.
- Sent on every position change. Also sent on `join_room` for all currently-queued runs (after `history`).
- Clear the badge on `null`, `message_complete`, or `message_state: error`.

---

## Error Handling

### HTTP Errors
```javascript
res.writeHead(400, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ error: 'Invalid request' }));
```

### WebSocket Errors
Agent errors → stored in message with `state='error'`:
```sql
UPDATE messages SET state='error', content='Error: ...' WHERE id=?
```

UI shows error state with red indicator.

---

## Special Routes

### Scheduled Triggers
`/api/rooms/:id/schedules[/:sid]` + `/schedules/doctor` — human session or agent secret (scope `room`).
- Body: `{target_actor_id, task (10..4000), schedule_spec, enabled?}`; spec shapes in `lib/schedule.js` (interval 5..1440 min, daily, weekly `days` 0=Sun, monthly `day` clamps to month end, yearly `month`+`day`, Feb 29 → Feb 28 in non-leap years). Max 20 per room (`400 schedule_limit`, checked in the insert transaction).
- Every change broadcasts `room_schedule_changed {room_id}`; agent changes also post a system_event ending ` · schedule` (kept by the history filters).
- Scheduler loop (`schedulerTick`, `SCHED_TICK_MS`, 1 s under run-tests) claims `next_run_at` before firing, then `fireSchedule` → `handleHumanMessage(..., {provider:'schedule', target_actor_id})`. `target_actor_id` makes routing consider ONLY that agent (ignores `notify_on_message`); `@label` of the target's sub-agent still resolves. Skips: `agent_offline`/`agent_busy`/`thread_limit` transient (retry ~2 min), `room_gone`/`archived`/`target_not_participant`/`no_human_participant` keep the next slot; reason saved to `last_error`.

### Automations

#### Slack Webhook
```
POST /api/webhooks/slack
Content-Type: application/json

{
  "type": "url_verification",
  "challenge": "..."
}
```

Or:
```json
{
  "type": "event_callback",
  "event": {
    "type": "app_mention",
    "text": "@stoa review PR #123",
    "user": "U123",
    "channel": "C456"
  }
}
```

**Flow:**
1. Match event to automation (trigger_event='slack_mention')
2. Render prompt_template with event data
3. POST message to target room
4. AI responds
5. Post result back to Slack via `/api/automations/slack/reply`

---

### Custom Claude Models

Owner-only endpoints for adding model IDs that Anthropic released after the built-in `ANTHROPIC_MODELS` list was compiled. Requires human session (`req._authUser`); agent headers → 403 `agent_scope_denied`.

#### Add
```
POST /api/settings/custom-models
Content-Type: application/json

{ "value": "claude-haiku-5-5", "label": "Haiku 5.5" }
```
- `value` (required): must match `^claude-[a-z0-9][a-z0-9.-]{1,62}$`
- `label` (optional, max 40 chars): display name; defaults to `value` if omitted
- 409 if model already exists in built-in or custom list
- 400 if format invalid or max 20 custom entries reached
- 201 + `{ value, label, custom: true }` on success

#### Remove
```
DELETE /api/settings/custom-models/:value
```
- `:value` must be URL-encoded
- 404 if not found; 204 on success
- Rooms using the removed model keep their setting (no cascade)

#### Model list (includes custom)
```
GET /api/ai/models
```
Returns grouped models; Anthropic group includes built-in + custom entries. Custom models have `custom: true`.

#### Suggestions from the agent's Claude CLI binary
```
GET /api/settings/custom-models/candidates
→ 200 { "cli_version": "2.1.300 (Claude Code)" | null, "candidates": [{ "id": "claude-haiku-5-5" }] }
```
Human session only (no session → 401, agent headers → 403 `agent_scope_denied`; not in `lib/agent-scope.js`).

- **Source:** the Claude CLI has no model-listing command, so the agent scans its own binary (`detectClaudeModelCandidates()` in `harness-session.js`, called from `detectHarnessesAsync()` in `stoa.js`). It resolves `claude` on `PATH` (realpath), streams the file in 1 MB chunks with a 64-char overlap (never loads the ~250 MB binary), matches `\bclaude-(haiku|sonnet|opus|fable)-\d{1,2}-\d{1,2}(-\d{8})?\b`, and keeps one ID per family+version (the undated alias wins over dated snapshots), newest first, max 50. Result cached per `path:size:mtime`, so it rescans only after a CLI update.
- **Transport:** top-level fields `claude_model_candidates` (string[]) + `claude_cli_version` on the existing `harnesses_update` WS message. Server validates (array, strings matching the custom-model regex, deduped, max 50, version ≤100 chars) and keeps them **in memory per agent** (`agentClaudeCandidates`, cleared on disconnect or when a report has no array). Not stored in the DB.
- **Filtering (`getClaudeModelCandidates()`):** union over online agents; drops IDs already in `ANTHROPIC_MODELS` or custom (compared by base, so `claude-haiku-4-5` counts as listed via `claude-haiku-4-5-20251001`); per family keeps only versions **newer** than the newest listed model, because the binary also embeds every legacy ID (`claude-sonnet-3-7`, `claude-opus-4-1`, …). Older gaps remain reachable through manual input. `cli_version` = highest version among reporting agents (numeric compare).

---

### Agent Restart

```
POST /api/actors/:id/restart
→ 200 { "ok": true, "state": "requested" }        // or the outstanding state if already requested (not re-sent)
```
Human session only (no session → 401, agent headers → 403 `agent_scope_denied`; not in `lib/agent-scope.js`). 404 unknown/non-AI actor; 409 `{ error: "agent_offline" }`; 409 `{ error: "not_supervised" }`.

Purpose: running sessions hold the old harness CLI process; restarting the agent process rebuilds them on the updated CLI (sessions resume — `ai_sessions` untouched). Separate from **Check** (`harnesses/check`), which stays cheap. The restart is **immediate** (owner decision, PR #175): running and queued triggers are stopped, the UI warns about that before confirming.

- **Supervisor gate:** the agent exits with `process.exit(0)` and relies on PM2 `autorestart`. An agent not under PM2 would die and stay down, so the agent reports `supervisor` in `agent_connect` via `lib/supervisor.js detectSupervisor()`: `'pm2'` only if `pm_id` is set, `autorestart !== 'false'`, **and** `process.ppid` equals the daemon pid in `$PM2_HOME/pm2.pid` (pm_id alone is inherited by any `node stoa.js` started from a shell inside a PM2 process). Old agents send nothing → `null` → 409.
- **Agent side:** WS `{ type: "restart", reason: "manual" }` does not wait for idle and does not arm `pendingRestart`: it acks `{ type: "restart_status", state: "restarting", active, queued }` (how many triggers it is about to stop) and calls `doRestart()` from the ws.send callback (1 s cap) so the ack is flushed before `process.exit`. `doRestart()` shuts every session down; the server's disconnect handler marks this agent's `streaming`/`requesting` messages as interrupted. Without `reason` (server's version-outdated restart) the old wait-for-idle `pendingRestart` path is unchanged and silent.
- **Pending (non-manual) restart:** the version-outdated `restart` and a downloaded update arm `pendingRestart` and wait for idle, but the server refuses triggers to an outdated agent, so a hung trigger used to pin the old version (newfin: 10 days). `sweepStaleTriggers` (every 60 s) now forces the restart once no active trigger has `lastActivity` newer than `RESTART_STALL_MS` (3 min, counted from when the restart was armed at the earliest), acking `{ type: "restart_status", state: "restarting", reason: "update_stalled", active, queued }` first (server ignores it unless a manual restart is outstanding).
- **Update check order:** the agent runs `checkForUpdates()` before its first `connect()` (capped at 10 s), so the extra restart an old client needs when `UPDATE_FILES` grows (e.g. `codex-session.js`) happens while it still looks offline. Downloaded files are written only if their sha256 matches the manifest hash; a mismatch is skipped (otherwise the pre-connect check becomes a restart loop). The file list stays the hard-coded `UPDATE_FILES` allowlist on purpose: deriving it from the manifest would let the server write any `*.js` into the agent dir.
- **State (`agentRestarts`, in memory):** `requested` → `restarting` → `done` (a `pending` ack from pre-0.4.379 agents is ignored). Broadcast to UI as `agent_restart_status { actor_id, state, active?, queued? }`; `/api/actors` and `actor_status` carry `supervisor` + `restart_state`. Agent acks only apply while a request is outstanding, and an agent cannot report `done`. The entry survives the disconnect; `done` is decided on reconnect by `boot_id` (random per agent process, sent in `agent_connect`): a different boot_id means the process really restarted, the same one is just a network blip and keeps the state. If the ack is lost the UI may see `requested` → offline → online + `done`.

---

### Harness Models Sync (`harness_models`)

For non-Claude harnesses (e.g. Codex), Stoa mirrors agent-reported models into `harness_models` to persist the model list across agent restarts.

**Trigger:** agent sends `harnesses_update` WS message to the server on connect. (`actor_status` is the broadcast the server sends to clients *after* sync completes — not the trigger.)

**Behaviour:**
- Active set = union across all currently online agents for that harness (prevents two agents on different Codex versions from deactivating each other's models)
- Models no longer reported by any online agent → `is_active=0`
- Default preserved if one already exists; otherwise reporter's first model becomes default
- Cap: 50 models per harness (`MAX_SYNCED_HARNESS_MODELS`)
- Claude harness is **exempt** — its model list always comes from `ANTHROPIC_MODELS` + `custom_claude_models` setting

**Key function:** `syncHarnessModels(harnessName, reporterId)` in `server.js`

---

### Export

#### Export Room
```
GET /api/rooms/:id/export?format=markdown
```

**Formats:** `markdown`, `json`

**Authentication:** Session-based (generates temp download URL)

---

## Request Body Parsing

### Pattern
```javascript
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}
```

**Always wrap in try/catch** to return 400 on invalid JSON.

---

## Response Patterns

### Success (JSON)
```javascript
res.writeHead(200, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ id: 123, name: 'Test' }));
```

### Success (Plain Text)
```javascript
res.writeHead(200, { 'Content-Type': 'text/plain' });
res.end('OK');
```

### Created
```javascript
res.writeHead(201, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ id: newId }));
```

### No Content
```javascript
res.writeHead(204);
res.end();
```

### Not Found
```javascript
res.writeHead(404, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ error: 'Not found' }));
```

### Server Error
```javascript
res.writeHead(500, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ error: 'Internal error' }));
```
