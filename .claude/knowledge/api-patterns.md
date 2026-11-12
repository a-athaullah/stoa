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
- `GET /api/health` - Minimal liveness check (no auth, GET only, path must be exact). Returns `{ ok: boolean, db: "ok"|"error", migrations: { pending: number, failed: number } }`. `200` when healthy, `503` when DB error or any migration failed or pending. Result cached 5 s. Intentionally omits version, paths, error messages, and connection status. **Auth bypass is per method+path** (`req.method==='GET' && url.pathname==='/api/health'` in `requireAuth`), not via `AUTH_EXEMPT` list — so POST to same path still returns 401. `/api/health/db` (detailed diagnostics) requires session auth.

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

Sub-agent credential (2026-11-01, `lib/sub-agent-credential.js`): a sub-agent session's `STOA_SECRET` is `sa1.<subId>.<hmac>` (HMAC of `SIGNING_KEY`, parent id, sub id, digest of the parent's secret; stateless, stable). The server sends it as `sub_agent_secret` in `agent_trigger`; stoa.js puts it in the child env instead of the parent's secret. `verifyAgentRequest` accepts it (→ `{id: parent, subAgentId}`; sub-agent must still belong to the parent) and `requireAuth` sets `req._scopedSubAgentId`. `subAgentScopeAllowed` in server.js: routes with `subAgent: false` refused (room memory/system-prompt PUT, sub-agent-trigger, all `self`, automations POST/PATCH/DELETE); `room` → `lib/room-access.js canReach` (linked + parent participant; not archived only on `read: true` routes, else `includeArchived`); `sub-agent` → own id only; `connection` → automation targeting a linked room. Proactive message with it posts with `sub_agent_id` forced to the sub-agent. Never accepted on `/mcp`.

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
| GET | `/api/skills/:name/manifest` | any (enabled skills only) |
| GET | `/api/skill-blobs/:sha256` | any (only blobs of the current revision of an enabled skill) |
| POST | `/api/skills/import` | any (skill owned by the calling agent; `git_url` field works for agents too — or use `stoa__skill_import_git` MCP tool) |
| POST | `/api/skills/:id\|:name/source/check` | any agent (read-only; works on any visible skill) |
| POST | `/api/skills/:id\|:name/source/update` | creator only (same ownership as skill update; 403 for non-creator who can see it, 404 if not visible) |
| DELETE | `/api/skills/:id\|:name/source` | creator only (same ownership as skill delete; 403 for non-creator who can see it, 404 if not visible) |

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
- Issued to every tool-capable session (`toolsSupported !== false`), even with no upstream server installed, because the gateway always serves the built-in `stoa__*` tools

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
| POST | `/api/mcp/approvals/:id` | Decide approval (`{ "decision": "approve"|"deny"|"always" }`) → 200/404/409. `always` → `{ approval, exemption }`, also approves same-key pending calls; 409 creates no exemption. Approval views carry `allow_always` (false only when the server was deleted, `server_id` NULL) |
| GET | `/api/mcp/approval-exemptions` | `?server_id=` → `{ exemptions: [{ id, server_id, server_slug, tool, actor_id, actor_name, sub_agent_id, sub_agent_label, created_at }] }` |
| DELETE | `/api/mcp/approval-exemptions/:id` | `{ ok: true }` / 404 |

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
DELETE /api/actors/:id          → Delete (exact path only; unknown id → 404; one transaction — 409 and nothing changed while messages/usage_log still reference the actor)
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
GET    /api/rooms/:id/threads            → List threads (?state=active | open | completed; default all with replies)
GET    /api/rooms/:id/threads/:rootId    → Get thread messages (root + replies asc)
PUT    /api/rooms/:id/threads/:rootId/complete → Owner session only: { completed: bool } → { thread_id, completed, completed_at }
GET    /api/rooms/:id/system-prompt      → Get room system prompt + max_active_threads
PUT    /api/rooms/:id/system-prompt      → Set system prompt + max_active_threads
```

**Thread complete (2026-11-05):** root columns `thread_completed_at` / `thread_completed_through` (newest reply id at mark time; `migrations/20261105-thread-complete.sql`). Status is derived on every read (`lib/room-messages.js THREAD_COMPLETED`): complete = marked AND no reply with `id > thread_completed_through`, so any new reply reopens it without a hook in the insert paths (raw columns stay; reopen via PUT `false` clears them). Exposed as `completed` / `completed_at` on thread list rows, thread detail `root`, feed `m.thread`, WS `thread_summary`, MCP `threads_list` / `thread_read`. PUT is not in `lib/agent-scope.js`: agent secret and sub-agent credential get `403 agent_scope_denied`. 404 = not a root of that room or no replies; archived room → 400. WS to room: `{ type: 'thread_status', room_id, thread_id, completed, completed_at }`.

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

**File serving (`GET /uploads/*`):** supports HTTP Range requests (206 Partial Content / 416 Range Not Satisfiable). Video/audio types (`mp4 m4v webm mov mp3 m4a aac wav ogg oga opus flac`) are served inline (`Content-Disposition: inline`) without a size cap — the 2 MB preview limit applies only to text/document types fetched by the FE. All other files use `?download=1` to force `Content-Disposition: attachment` with the original filename.

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

### Task Board Routes

All routes under `/api/rooms/:id/tasks*` require room participation (`X-Agent-*` headers or session cookie). Authorization rules are enforced in `lib/room-tasks.js`.

```
GET    /api/rooms/:id/tasks                  → {tasks, settings, counts}
POST   /api/rooms/:id/tasks                  → 201 Task
GET    /api/rooms/:id/tasks/:tid             → Task + {events, has_more_events}
PATCH  /api/rooms/:id/tasks/:tid             → Task
DELETE /api/rooms/:id/tasks/:tid             → 204
POST   /api/rooms/:id/tasks/:tid/move        → Task  (agent: backlog→ongoing claims the card; out of awaiting confirms)
POST   /api/rooms/:id/tasks/:tid/complete    → Task  (running card; agent: its runner thread or its own claim)
POST   /api/rooms/:id/tasks/:tid/block       → Task  (running card → Awaiting)
POST   /api/rooms/:id/tasks/:tid/fail        → Task  (running card → Backlog failed)
POST   /api/rooms/:id/tasks/:tid/retry       → Task  (failed card → idle; any room participant, MCP stoa__task_retry)
POST   /api/rooms/:id/tasks/:tid/comments    → 201 Event
GET,PATCH  /api/rooms/:id/tasks/settings     → {settings}  (PATCH: owner only)
POST   /api/rooms/:id/tasks/runner/play      → {settings, counts}  (owner only)
POST   /api/rooms/:id/tasks/runner/pause     → {settings, counts}  (owner only)
POST   /api/rooms/:id/tasks/runner/stop      → {settings, counts}  (owner only)
```

**Error codes:**
- `400` — invalid fields or dependency cycle/overflow
- `403` — agent_scope_denied (not in room, or sub-agent not linked), or human-only action
- `404` — room or task not found (or task is in a different room)
- `409` — state conflict (task running, or already in target state)
- `423` — room is archived (all writes except runner pause/stop)

**WS event:** `task_upsert` (broadcast on every write) and `task_delete`. Settings broadcast: `task_settings`.

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

#### Live Run Events (server → room clients)

Key WS events broadcast to room browsers during a run. All carry `message_id` and `room_id`.

**`message_state`** — run state transitions:
- `state: 'streaming'` at trigger (and at revive after disconnect): full identity fields (`thread_id, actor_name, avatar_color, avatar_symbol, avatar_url, sub_agent_id, sub_agent_label, sub_agent_avatar_*`, `sub_agent_role`) + `reply_to` / `reply_msg`. FE must draw the bubble if it doesn't exist yet (late-join or post-disconnect).
- `state: 'error'` for disconnect/reconnect cleanup: same identity + `reply_msg` + `content` (interruption placeholder, e.g. `'(interrupted — agent disconnected)'`) + `result_meta: {"exit_reason":"interrupted"}` + `feed_pos`. FE shows the bubble with `content` as text; does **not** call `el.remove()`. Exactly one event per interrupted run.
- Other `state: 'error'` (timeout, stop, mid-trigger) remain bare `{message_id, state:'error'}` — FE removes the thinking bubble.

**`message_complete`** — run finished successfully: carries `reply_to` / `reply_msg` (when the run had a `reply_to`) + `feed_pos`.

**`message_broadcast_cleared`** — `{ type: 'message_broadcast_cleared', message_id: <number>, thread_id: <number> }`. Sent after `message_complete` when a thread run that had been broadcast to the feed as `error`/`limit` completes successfully. FE removes `#broadcast-<message_id>` from the feed; the thread bubble is untouched. No-op if the row doesn't exist. Broadcast reason `automation_match` is never cleared.

**`reply_msg` shape** (all live events + read path): `{ id, content (≤300 chars), image_url, file_url, file_name, attachments, actor_name, avatar_color }`.

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
- One implementation: `lib/room-schedules.js` (`createRoomSchedules` → `access/list/create/update/remove/doctor`, each → `{status, body}`) serves both the HTTP routes and the built-in MCP tools `stoa__schedule_list|create|update|delete|doctor` (`scheduleMcpTools`, passed to `createMcpGateway({ builtinTools })`). MCP tools take room + caller from the token only (`ident.roomId` null → tool error), `target_actor_id` defaults to the caller; results are the HTTP bodies as JSON text, failures `isError`. Built-ins go through the same policy as upstream tools on the `builtin=1` row (slug `stoa`) and are logged with its `server_id`. Slug `stoa` is reserved (`BUILTIN_SLUG`; mcp-api create → 400); the migration renamed a legacy row holding it to `stoa_old_<id>` (disabled). Built-in row in `/api/mcp/*`: first in lists, `builtin: true`; PATCH takes name/enabled/default_access only (else 400), DELETE / oauth-start → 400, tools = `gateway.builtinCatalog()`, PUT tool of an unknown built-in → 404; `stoa__mcp_server_update` on it → 400 (owner only). Upstream manager throws on builtin rows.
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

### Claude Models from the CLI (custom models retired)

There is no "custom model" path any more (`/api/settings/custom-models*` → 404, setting `custom_claude_models` migrated away by `migrations/20261110-claude-models-from-cli.sql`: every valid entry became a regular claude row in `harness_models`, label kept; a non-array value is left untouched).

- **Source:** the Claude CLI has no model-listing command, so the agent scans its own binary (`detectClaudeModelCandidates()` in `harness-session.js`, called from `detectHarnessesAsync()` in `stoa.js`). It resolves `claude` on `PATH` (realpath), streams it in 1 MB chunks with a 64-char overlap, and matches `CLAUDE_MODEL_SCAN_RE`: family + major (+ minor) (+ 8-digit date). Major-only IDs (`claude-opus-5`) count; a minor never swallows a date (`claude-opus-4-20250514` = major 4 + date); codenames (`-mythos`) and run-ons are dropped, a Bedrock `-v1` suffix is cut. One ID per base (alias beats dated), newest first, max 50. Cache key `path:size:mtime`; `resetClaudeScanCache()` after a CLI update.
- **Transport:** `claude_model_candidates` + `claude_cli_version` on `harnesses_update`. Server validates (`claudeModelKey`, ≤64 chars, deduped, max 50) and keeps them per agent in memory (`agentClaudeCandidates`). The `models` an agent puts in its claude `harness_status` entry is ignored.
- **Sync:** `syncHarnessModels('claude', agent)` upserts scanned IDs into `harness_models` with a derived label (`claudeModelLabel`: `claude-opus-5-5` → "Opus 5.5", dated → alias label), skipping IDs whose base is already in `ANTHROPIC_MODELS` and versions older than the oldest built-in of the same family (a binary embeds every legacy ID). An existing row keeps its label (may be a migrated custom label).
- **List (`getClaudeModelRows()`):** rows newer than this build first (newest first), then `ANTHROPIC_MODELS` (the always-present baseline). Deduped by base ID. Default `CLAUDE_DEFAULT_MODEL`.

### Model lists: `listed` and failed models

Every harness model list carries `listed: boolean` — the agent's CLI names the model (claude: binary scan, compared by base ID; codex: `codex debug models`).

- Where: `GET /api/ai/models` (anthropic group items), `GET /api/harnesses` (`models[]`), and `harness_status[].models` in `GET /api/actors`, `actor_status`, `POST /api/actors/:id/harnesses/check`. In `harness_status` the server now **fills `models` itself** for every installed harness: `[{ id, label, is_default, listed }]` from `getHarnessModels(actorId, harness)` (`publicHarnessStatus()`).
- Per agent: listed in that agent's latest report. Global endpoints: listed by any online agent. No report at all (old client, failed scan, offline) → `true` (unknown is not "unlisted").
- **Never dropped for being unlisted** (owner decision 2026-11-10: a CLI list can omit a model that still works). `syncHarnessModels` is additive for every harness — no `is_active=0` on absence.
- The only reason a model disappears for an agent: a run proved its CLI does not know it. Agent → WS `{ type: "model_unavailable", harness, model }` (stoa.js `reportModelUnavailable`, pattern `isModelUnavailableError` on error text only; not on a third-party `base_url`). Server stores `agent_model_failures (actor_id, harness, model_id, cli_version)`; `getHarnessModels(actorId, …)` hides those for that agent only, so `resolveAgentModel` falls back to the agent/harness default. Cleared when the agent reports another CLI version for that harness, or on update `done`. The failed run's text gets a hint to update the CLI.

### Harness CLI Update

```
POST /api/agents/:id/harnesses/:name/update
→ 202 { "request_id": "<16 hex>" }
```
Human session only (no session → 401, agent headers → 403 `agent_scope_denied`; not in `lib/agent-scope.js`). `name` ∉ `KNOWN_HARNESSES` → 400; unknown / non-AI actor → 404; 409 with `code`: `agent_offline`, `client_outdated` (agent did not announce feature `harness_update` in `agent_connect`), `not_installed`, `update_in_progress`.

- Server → agent: `{ type: "harness_update", request_id, harness }` — the name only, never a command.
- Agent (`handleHarnessUpdateRequest` in stoa.js): fixed `HARNESS_UPDATE_ARGS` (`claude update` / `codex update`; both CLIs handle native, npm and Homebrew installs) via `execFile` without a shell, stdin closed, 5 min timeout. A run of that harness still active → `waiting_idle`; new triggers of that harness stay queued (`canStartTrigger`) until the update ends, other harnesses keep running. Version before (`--version`), then after: `resetClaudeScanCache()` + `detectHarnessesAsync()` → `harnesses_update` (before `done`). A restart requested meanwhile (`doRestart`) waits for the update to finish.
- Agent → server: `{ type: "harness_update_status", request_id, harness, state, old_version, new_version, error }`. Accepted only for the current request of that agent+harness. Error sanitized (`sanitizeUpdateError`: no ANSI/control chars, home and `/Users/*` `/home/*` `C:\Users\*` → `~`, token-like strings redacted, ≤300 chars) on both sides.
- Broadcast (global): `{ type: "harness_update_status", actor_id, harness, request_id, state: waiting_idle|running|done|failed, old_version, new_version, error }`. `harness_status[].update` carries the last one (or `null`) so the UI recovers after reload. State lives in memory (`harnessUpdates`); internal `requested` is not exposed.
- Server-side failures: no ack within `HARNESS_UPDATE_ACK_TIMEOUT_MS` (15 s) → `failed` "agent did not respond"; `running` longer than 6 min → "update did not finish in time"; agent disconnect while pending → "agent disconnected". A late status for the same request_id is still accepted.

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

Stoa mirrors agent-reported models into `harness_models`, so models stay offered while the agent is offline and new ones appear without a code change.

**Trigger:** agent sends `harnesses_update` (on connect, on Check, after a CLI update). `actor_status` is the broadcast the server sends afterwards.

**Behaviour:**
- Codex: the reporter's `codex debug models` list is upserted (label refreshed). Claude: the binary scan (see "Claude Models from the CLI").
- **Additive only** — a model missing from a report stays `is_active=1` (owner decision 2026-11-10). Absence shows as `listed: false`.
- Default preserved if an active one exists; otherwise the reporter's default (codex).
- Cap: 50 upserts per report (`MAX_SYNCED_HARNESS_MODELS`).
- Per agent (`getHarnessModels(actorId, 'codex')`): the agent's own list first (its order + default), then the other active rows.

**Key function:** `syncHarnessModels(harnessName, reporterId)` in `server.js`

---

### Harness Accounts & Limits (`lib/harness-accounts.js`, agent side `lib/harness-probe.js`)

Which Claude / Codex account each agent machine is logged into + plan-limit usage (5-hour, weekly). Account: `claude auth status`, `codex app-server` (`account/read`, `account/rateLimits/read`), fallback `wham/usage`. Claude limits: Claude Code's `rate_limit_event` (stream-json), never the undocumented `oauth/usage` (429 for ~1 h after almost every call; removed).

- **Server-coordinated probes.** Agents have no timer: the server sends `harness_accounts_request { request_id, skip_limits?, ping_limits? }` to ONE online agent (feature `harness_accounts`) per `machine_id` — on connect when the snapshot is ≥ 15 min old, from a 60 s tick on the same rule, and on manual refresh (≥ 30 s since the last probe/request). One request in flight per machine. A stored Codex `retry_at` (from a 429) is passed back as `skip_limits.codex`.
- **Claude limits from sessions.** `claude-session.js` emits `rate_limit_event` (every turn); stoa.js forwards `harness_rate_limits { machine_id, harness: 'claude', rate_limits: { status, limits[], overage } }` at most once a minute (at once on a status change, trailing report at the end of the gap) — only for sessions on the agent's own login (`sameClaudeAccount`: same `CLAUDE_CONFIG_DIR`, no own API key / OAuth token / base URL / Bedrock / Vertex / Foundry). The server accepts it only for the machine the socket announced, ≥ 10 s apart unless the status changed, merges it per window key into the machine's Claude entry with `source: 'session'`, `observed_at` (server time), and keeps it through account-only probes until a newer event, a ping, or a different / logged-out / non-claude.ai login. `unifiedWindows` is undocumented, so without it the top-level `rateLimitType` window is used.
- **Ping (manual refresh only).** When the machine's Claude entry has no `observed_at` within 10 min (and is not a known non-claude.ai login), the refresh request carries `ping_limits: true`: the agent runs one `claude --output-format stream-json --input-format stream-json --verbose --model haiku` turn ("reply ok") in a fresh temp dir (never `-p`, no permission bypass), takes the first `rate_limit_event`, kills it (45 s cap) → `source: 'ping'`. That probe's in-flight timeout is 50 s longer. Connect / tick probes never ping.
- **Agent → server** `harness_accounts { request_id, machine: { id, hostname, platform }, harnesses: { claude, codex } }`. Untrusted: unknown keys dropped (tokens never stored), strings stripped of control/bidi chars and capped, `used_pct` clamped 0–100, timestamps re-parsed, `retry_at` capped at +24 h, `probed_at` = server time. Unsolicited snapshots: max one per agent per 5 s. `machine.id` must equal the one the socket announced in `agent_connect` (else rejected, logged without payload); only the asked agent with the matching `request_id` ends a probe.
- **Carry-over:** a failed limits check (`error` / `unavailable`) for the same account keeps the last good limits for up to 6 h, with `limits_status: 'ok'`, the original `limits_checked_at` and the failure in `error` (Codex, and Claude rows from before `observed_at`).
- **REST (owner session only, not in agent-scope):** `GET /api/usage/accounts` → `{ machines[], accounts, mismatch }`; `POST /api/usage/accounts/refresh { machine_id? }` waits up to 20 s (`HARNESS_ACCOUNTS_WAIT_MS`) and returns the same payload. Browser broadcast `harness_accounts_updated { machine_id }` when a probe starts, when a snapshot is stored, and when a probe ends without one (timeout/disconnect) — so `refreshing` is always current in an open tab.
- Claude entry fields beyond the probe: `limits[].status` (`allowed` / `allowed_warning` / `rejected` / null), `source` (`session` / `ping` / null), `observed_at`, `rate_limit_status`, `overage { status, is_using, disabled_reason }`; Claude `credits` is always null.

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

### Compression
- `json(res, data, status)` goes through `lib/http-compress.js` `sendJson`: body ≥ 1 KB + `Accept-Encoding` allowing gzip (q > 0) → `Content-Encoding: gzip`; always `Vary: Accept-Encoding` + `Content-Length`. zlib error → plain body. Responses written by hand (`res.writeHead` + `res.end`) are not compressed; send big JSON through `json()`.
- WebSocket: `permessage-deflate` (threshold 1 KB, no context takeover on either side). A client that does not offer it (`perMessageDeflate: false`) still connects uncompressed.
- Room feed rows (`feed()` roots mode, join_room `history`) carry the thread summary only in `thread`; the raw `thread_*` summary columns and the completion marker (`thread_completed_at/_through`) are dropped. `GET /api/rooms/:id/messages` since-mode honours `limit` (1-100, default 50).

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

---

## Core Lib Pattern (REST + MCP shared)

Business logic extracted from REST handlers lives in `lib/*.js` as pure functions returning `{status, body}`. The REST handler calls the core function and maps the result to HTTP; the MCP tool calls the same core function and maps to a text result. This ensures validation never drifts between the two surfaces.

**Modules added in PR #195:**
- `lib/room-messages.js` — message send/read, thread list/read
- `stoa__message_send` files — `[send:/path]` markers in `content` (outside inline code / code blocks — same `lib/code-spans.js` scanner as mention detection, so an unclosed fence/backtick is not code — parsed by `lib/send-markers.js`, shared with stoa.js final answers) and/or `files: [path]` (max 10 total). The server cannot read agent files: WS `send_files {request_id, paths, room_id, thread_id, sub_agent_id}` (token's session, not the target thread) to the caller's own client (feature `send_files`); stoa.js serves it only when its `sessionPool` holds that room/thread/sub-agent session (paths resolve against that workdir) and answers `send_files_result {request_id, attachments, failures} | {error}`, accepted from that actor only; each attachment must be an existing `/uploads/` file. Offline / old client / `SEND_FILES_TIMEOUT_MS` (120 s) / error → posted anyway with `⚠️ file X gagal dikirim: …` lines. A retry with an `event_id` already posted returns `idempotent` before any upload (409 when its text differs).
- `lib/stoa-memory.js` — room memory, agent memory, sub-agent memory, system prompts
- `lib/system-prompts.js` — room and agent system prompt get/set (also handles notices + broadcast)
- `lib/sub-agents.js` — sub-agent CRUD + trigger (create links to room atomically; delete broadcasts `sub_agent_unlinked`)
- `lib/automation-crud.js` — automation CRUD + connection list
- `lib/stoa-mcp-tools.js` — assembles all 44 `stoa__*` tool definitions; also exports `availableTo(ident)` for per-tool visibility filtering
- `stoa__mcp_catalog` / `stoa__mcp_server_list` / `stoa__mcp_server_add` (main sessions only) — `lib/mcp-api.js` `listServersForAgent(ident)` / `checkServerForAgent(body, actorId)` (precheck) / `addServerForAgent(body, actorId)`, same `newServerFields` + `createServer` core as `POST /api/mcp/servers`. The agent list is its own shape, not `serialize()`: `env_keys` is key names only (no masked tail, no plain `secret:false` value), plus `has_access` from `gateway.allowedServers(ident)`; every server is listed so the agent can pick a free slug. The add result uses the same `agentView`. Add is approval-gated by a seeded override (owner can change it); `createServer(body, { grantAgentId })` forces `default_access 'none'` (ignores `allow_all`) and inserts the `mcp_access` agent grant in the same transaction. Then connection test (`test: {ok, tool_count, error?}`, a failure keeps the server), `keepAlive`, `gateway.toolsChanged()`, ` · config` notice `added MCP server <slug>`. Core 400/409 → tool error. No remove via MCP (Settings only).
- `stoa__mcp_server_update` (main sessions only, approval-gated by a seeded override) — `lib/mcp-api.js` `planAgentUpdate(body, ident)` feeds `checkUpdateForAgent` (precheck), `previewUpdateForAgent` (card) and `updateServerForAgent`. Same `planPatch` + `applyPatch` core as `PATCH /api/mcp/servers/:id` (planPatch validates without writing; applyPatch writes, clears OAuth on auth/url change, `reconfigure` unless keep_alive-only, `keepAlive`). Agent-only rules: keys outside `AGENT_UPDATE_FIELDS` (slug, name, command, args, url, env, env_remove, keep_alive, auth, enabled) → 400 `<key> cannot be changed by an agent` (never dropped — access/default_access/preset/transport stay with the owner); the slug resolves only among `gateway.allowedServers(ident)` (enabled + access), anything else → 404 `MCP server not found`, so disabling a server takes it out of the agent's reach; fields that already hold the sent value are removed from the plan, empty plan → 400 `nothing to change`. Card preview `{ slug, changes: { <field>: {from, to}, env: { set: {KEY: '***'}, removed: [KEY] } } }` (secret:false preset fields keep their value, like add); when the plan fails the card falls back to the sent args with env values masked (no stored config of a server without access). Then connection test, `gateway.toolsChanged()`, notice `updated MCP server <slug>`; returns `{ server: agentView, test }`.
- `lib/skills.js` (skills library) — also serves `stoa__skill_list|get|use|create|update|delete|import_git|source_check|source_update|source_detach` (open to sub-agent sessions too). Mutations by name through `canMutate`: another agent's / the owner's / (from a sub-agent) the parent's skill → 404 `not_found`, same as missing; the parent manages its sub-agents' skills. Max 5 MB of body + decoded files per call (`/mcp` body cap `MCP_BODY_MAX` 8 MB); bigger → `POST /api/skills/import`. `skill_get` returns one text file ≤ 256 KB (built-in `resultCapBytes` override of the gateway's 256 KB cap). `skill_use` → WS `skill_sync {request_id, skill}` to the caller's own client (feature `skill_sync` in `agent_connect`), answered by `skill_sync_result {request_id, dir, version, stale?} | {error}` from that actor only, `SKILL_SYNC_TIMEOUT_MS` 60 s; failure / old client → body with `dir: null` + `files_unavailable`. Create/update/delete post a ` · config` notice. `skills.catalog()` → `<stoa-skills>` block (≤ 40 enabled skills / 4 KB, descriptions one line ≤ 160 chars without `< > \``) appended to the base system prompt of sessions that have the `stoa__*` tools — wake runs too, so `system_prompt_hash` stays stable.
- Skill history/export (session-only, not in `lib/agent-scope.js`): `GET /api/skills/:id/revisions/:v` → `{revision}` = the `/revisions` row + `current`, `body` (full SKILL.md, frontmatter included) and `files [{path, sha256, size, mode}]`; 404 `not_found` | `revision_not_found`. `GET /api/skills/:id/export[?version=N]` → `application/zip` (`attachment; filename="<name>.zip"`, `nosniff`, `no-store`) with one `<name>/` folder, mode bits in the Unix external attributes; written by `zipStream()` in `lib/skill-bundle.js` (one blob in memory at a time, async deflateRaw, stored when it does not shrink, no zip64 — bundles are ≤ 50 MB / 300 files). Bad `version` → 400 `invalid_version`. Export → `POST /api/skills/import` round-trips to the same `manifest_hash`. Entries carry a 0x5455 Extended Timestamp (revision `created_at`); the DOS time is UTC so the bytes don't depend on the server TZ.
- Skill edits: optional `base_version` (PATCH body; `?base_version=` on `PUT`/`DELETE /api/skills/:id/files/*`) ≠ current version → 409 `version_conflict {current_version}`, nothing written. The editor always sends it; MCP `skill_update` and older clients omit it (last write wins).
- **Git source routes** (`lib/skill-git.js` via `lib/skills-http.js`; also exposed as MCP tools `skill_import_git|source_check|source_update|source_detach`):
  - `POST /api/skills/import` with `git_url` — clones the remote, runs dry-run or real import. Body: `{git_url, ref?, path?, name?, description?, dry_run?}`. Returns `{preview}` for dry-run, `{skill}` for real. Errors: `invalid_url`, `invalid_ref`, `invalid_path`, `missing_skill_md`, `git_auth_failed`, `git_repo_not_found`, `git_ref_not_found`, `git_unreachable`, `git_timeout`, `git_unavailable`, `git_failed`.
  - `POST /api/skills/:id|:name/source/check` — runs `ls-remote` to compare current commit vs remote HEAD. Returns `{update_available, commit, remote_commit}`. Same git errors apply.
  - `POST /api/skills/:id|:name/source/update` — clones fresh, commits new revision (note `git update <sha7>`). Returns `{updated, local_changes, skill, commit}`. Errors: `no_source`, `busy` (409), `source_changed` (409), same git errors, `missing_skill_md`.
  - `DELETE /api/skills/:id|:name/source` — detaches; rows in `skill_sources` deleted, `source_url` on revision unchanged.
  - The `source` object on skill list/detail: `{kind, url, ref, path, commit, checked_commit, checked_at, update_available, local_changes}`.

**`availableTo(ident)` option on MCP gateway:**

**Cross-room read (2026-11-01):** `stoa__rooms_list` + optional `room_id` on `messages_read` / `threads_list` / `thread_read`. Without `room_id` → unchanged (`roomDenied` on the session room). With it → `lib/room-access.js canReach(roomId, ident)`: main session = participant; sub-agent session = `room_sub_agents` link AND parent participant; never archived (session room without `room_id` too: archived → 403; `message_send` unchanged, room-messages already refuses an archived room). REST read routes (`read: true` in agent-scope) apply the same archived rule to every agent secret; the parent's `room` scope uses `canReach(..., {includeArchived: !route.read})`. Fail (incl. missing room) → 403 `agent_scope_denied`. `thread_read` with another room needs `thread_id` (session thread is not looked up there); `messages.thread` filters the root by room.

Each tool definition in `stoa-mcp-tools.js` can export `availableTo(ident): boolean`. The gateway calls this before exposing or calling a tool. Sub-agent sessions (`ident.subAgentId != null`) see only: `message_send`, read tools, and `sub_agent_memory_get/set`. All configuration-mutating tools are hidden and refused for sub-agent sessions.

```javascript
// Example: hide sub_agent_create from sub-agent sessions
availableTo: (ident) => !ident.subAgentId,
```

**Behavior changes from REST refactor (PR #195):**
- Non-string inputs that previously caused 500 now return 400.
- `trigger_conditions` sent as an array in PATCH is serialized as JSON (REST was ignoring it).
- Deleting a sub-agent now broadcasts `sub_agent_unlinked` to the room.
- History `GET /api/rooms/:id/messages` now includes `system_event` notices ending in `· config`.
