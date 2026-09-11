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

### Sub-Agent Team (Room 2638)

Stoa dioperasikan oleh tim sub-agent terspesialisasi yang di-trigger via @mention:

| Agent | Model | Tier | Tugas |
|-------|-------|------|-------|
| **Ara** | Sonnet 4.6 | — | Koordinator utama, analisis, lapor ke Aan |
| **TechLead-Stoa** | Opus 4.6 | — | Code review, audit, security check |
| **BE-Stoa** | Sonnet 4.6 | standard | Backend implementation |
| **FE-Stoa** | Sonnet 4.6 | standard | Frontend implementation |
| **TechWriter-Stoa** | Sonnet 4.6 | standard | Docs update (5 bahasa + knowledge base) |

**Coordination Flow:**

```
Aan kasih task
  ↓
Ara analisis & breakdown
  ↓
@BE-Stoa / @FE-Stoa → implementasi → selesai → @Ara
  ↓
@TechLead-Stoa → code review → selesai → @Ara
  ↓
@TechWriter-Stoa → update docs + knowledge base → selesai → @Ara
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
- `max_concurrent` per agent (default 3) — caps parallel claude processes on agent machine
- `busy_input_mode` (interrupt/queue/steer) checked per thread, not per room

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

## Performance Optimizations

### Indexes
- All foreign keys indexed
- Frequently queried columns indexed
- FTS5 for message search

### Caching
- In-memory WebSocket connection map
- Session reuse (avoid recreating Claude sessions)

## Deployment Notes

- Single server instance (SQLite = single writer)
- WAL mode enabled (better concurrency)
- No horizontal scaling needed (single-user design)
- Can run on low-powered devices (Raspberry Pi, etc.)
