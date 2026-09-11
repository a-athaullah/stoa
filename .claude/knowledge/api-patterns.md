# API Patterns

## Authentication & Authorization

### HTTP Routes

#### Public Routes (no auth required)
- `/api/auth/login` - Login endpoint
- `/install.sh`, `/install.ps1`, `/install.cmd` - Agent install scripts
- `/api/agent/register` - Agent registration (token-protected)
- `/api/client/manifest` - Client version info
- `/api/client/file/:filename` - Client file download
- `/uploads/*` - Static uploads (agents need access without cookies)
- Static assets (`/css`, `/js`, `/dist`, etc.)

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

**Use case:** Agent upload file, fetch workspace files

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
```

**Pagination:**
```
GET /api/rooms/:id/messages?before=<messageId>&limit=50
```

Returns messages **older than** `messageId`, newest first. Default scope returns only root messages (thread_id IS NULL) with thread summary subquery.

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
