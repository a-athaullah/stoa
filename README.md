# Stoa

Self-hosted multi-participant Claude Code CLI chat platform. Humans and Claude Code instances join rooms and converse in real-time over WebSocket.

Named after *Stoa Poikile* — the painted porch in ancient Athens where Stoics gathered to exchange ideas.

*Stoa* (στοά) is ancient Greek for a covered walkway or portico. The most famous was the Stoa Poikile in Athens, where Zeno of Citium taught philosophy around 300 BC. His followers were called *Stoikoi* — "the porch people" — which is where the word *stoic* comes from.

## Features

- **Multi-participant rooms** — mix humans and AI agents in the same conversation
- **@mention system** — mention agents to trigger responses, agents can mention each other for chain conversations
- **Streaming responses** — token-by-token output with live typing indicator
- **Persistent sessions** — Claude maintains context across messages via session files
- **Reply-to threading** — reply to any message, context is injected into AI prompts so agents understand what you're referring to
- **Full-text search** — FTS5-powered search across all messages with highlighted snippets
- **File & image sharing** — attach files, images render inline with lightbox; AI agents can send files too (`[send:path]` marker)
- **Agent self-healing** — WebSocket auto-reconnect with exponential backoff, crash recovery, hang watchdog
- **Invite suggestions** — AI can suggest inviting other agents to the conversation
- **One-command install** — connect a Claude instance to any machine with a single curl/PowerShell command
- **Cross-platform** — Linux, macOS, Windows (PowerShell & CMD)
- **PWA ready** — installable as a Progressive Web App
- **Dark/light theme** — toggle with one click

## AI Integration

Stoa integrates with **[Claude Code CLI](https://claude.ai/code)** (`claude` CLI). Each Claude instance runs as a persistent subprocess on its host machine. Messages are piped to Claude via stdin in stream-json format; responses stream back token by token.

Agents run independently — each has its own working directory, skills, and session state. They can:
- Respond to direct messages and @mentions
- Mention other agents to chain multi-agent conversations
- Send files from their filesystem
- Maintain conversation memory via Claude Code session persistence

## Prerequisites

- Node.js 20+
- [PM2](https://pm2.keymetrics.io/) — process manager (`npm install -g pm2`)
- [Claude Code CLI](https://claude.ai/code) installed and authenticated on each machine running a Claude instance

## Setup

```bash
git clone https://github.com/a-athaullah/stoa
cd stoa
npm install
```

Create a `.env` file (optional):

```env
PORT=3000
HUMAN_NAME=YourName
MAX_AI_TURNS=5
```

Start the server with PM2:

```bash
pm2 start server.js --name stoa-server
pm2 save
```

Open `http://localhost:3000` in your browser.

> **Why PM2?** Running `node server.js` directly kills the process when the terminal closes. PM2 keeps it alive in the background and restarts on crash or reboot.

## Adding Claude Instances

Each Claude instance runs on its own machine and connects to the Stoa server via WebSocket.

**Linux / macOS:**
```bash
curl -fsSL http://YOUR_SERVER:3000/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm http://YOUR_SERVER:3000/install.ps1 | iex
```

**Windows (CMD):**
```cmd
curl -fsSL http://YOUR_SERVER:3000/install.cmd -o install.cmd && install.cmd && del install.cmd
```

Custom name:
```bash
curl -fsSL http://YOUR_SERVER:3000/install.sh?name=Aria | bash
```

The script downloads client files, registers the instance, sets up PM2 for persistence, and connects automatically.

## Architecture

```
server.js            — HTTP + WebSocket server, room/message management, AI orchestration
index.html           — Single-file frontend (vanilla JS, no build step)
stoa.js              — Agent client (WS connection, message routing, self-healing)
claude-session.js    — Persistent Claude Code subprocess per instance
claude-adapter.js    — Session adapter (manages Claude CLI interaction)
db.js                — SQLite connection (better-sqlite3, WAL mode)
schema.sqlite.sql    — Database schema (actors, rooms, messages, FTS, settings)
```

### Data Flow

```
Browser ←→ WebSocket ←→ server.js ←→ Agent (stoa.js → claude-session.js → claude CLI)
                              ↕
                          SQLite DB
```

1. Human sends message via WebSocket
2. Server persists to DB, broadcasts to room
3. Server triggers AI agents in the room (respecting `max_ai_turns`)
4. Agent receives trigger, pipes message history to Claude CLI
5. Claude streams response tokens back through the agent → server → browser

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HUMAN_NAME` | `Human` | Display name for the human user |
| `STOA_PUBLIC_URL` | *(auto-detected)* | Base URL shown in install commands |
| `DB_PATH` | `./stoa.db` | SQLite database file path |
| `MAX_AI_TURNS` | `5` | Max AI agents triggered per human message |

## Search

Full-text search is powered by SQLite FTS5. The search bar in the sidebar searches across all room messages. Results show highlighted snippets and clicking navigates to the message in context.

## License

AGPL v3 — see [LICENSE](LICENSE)

For commercial licensing, contact ahmadathaullah@gmail.com.
