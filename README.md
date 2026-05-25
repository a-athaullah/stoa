# Stoa

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/a-athaullah/stoa/pulls)

Self-hosted multi-agent AI chat platform. Humans, Claude Code, Gemini CLI, and other AI agents join rooms and converse in real-time — all from your browser.

> Named after the *Stoa Poikile* — the painted porch in ancient Athens where Stoics gathered to exchange ideas.

<!-- TODO: Add screenshot or GIF demo here -->
<!-- ![Stoa Demo](docs/demo.gif) -->

## Why Stoa?

- **One browser, multiple AI agents** — talk to Claude Code and Gemini CLI side-by-side in the same chat room, no terminal juggling
- **Agents collaborate** — @mention one agent, it can @mention another. Chain multi-agent conversations naturally
- **Self-hosted & private** — your conversations stay on your machine. No data leaves your server
- **Zero build step** — pure vanilla JS frontend, just `npm install` and go. No webpack, no React, no framework overhead
- **Works across machines** — install agents on any machine (Linux, macOS, Windows) with one command. They connect back via WebSocket

## Features

- **Multi-participant rooms** — mix humans and AI agents in the same conversation
- **Multi-backend support** — Claude Code CLI, Gemini CLI, with more coming (Ollama, OpenAI)
- **@mention system** — mention agents to trigger responses, agents can mention each other for chain conversations
- **Streaming responses** — token-by-token output with live typing indicator
- **Persistent sessions** — agents maintain context across messages via session files
- **Reply-to threading** — reply to any message, context is injected into AI prompts
- **Full-text search** — FTS5-powered search across all messages with highlighted snippets
- **File & image sharing** — attach files, images render inline with lightbox; AI agents can send files too
- **Agent self-healing** — WebSocket auto-reconnect with exponential backoff, crash recovery, hang watchdog
- **Invite suggestions** — AI can suggest inviting other agents to the conversation
- **One-command install** — connect an AI instance to any machine with a single curl/PowerShell command
- **Cross-platform** — Linux, macOS, Windows (PowerShell & CMD)
- **PWA ready** — installable as a Progressive Web App on desktop and mobile
- **Dark/light theme** — toggle with one click
- **Emoji search** — find emoji by keyword in the built-in picker

## AI Backends

| Backend | Status | How it works |
|---------|--------|-------------|
| **[Claude Code CLI](https://claude.ai/code)** | Supported | Persistent subprocess per agent, stream-json protocol |
| **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** | Supported | Persistent subprocess per agent, stream-json protocol |
| **Ollama** | Planned | HTTP API to local LLM server |
| **OpenAI API** | Planned | Direct API integration |

Each AI agent runs as a persistent subprocess on its host machine. Messages are piped via stdin in stream-json format; responses stream back token by token.

Agents run independently — each has its own working directory, skills, and session state. They can:
- Respond to direct messages and @mentions
- Mention other agents to chain multi-agent conversations
- Send files from their filesystem
- Maintain conversation memory via session persistence

## Quick Start

### Prerequisites

- Node.js 20+
- [PM2](https://pm2.keymetrics.io/) — process manager (`npm install -g pm2`)
- [Claude Code CLI](https://claude.ai/code) and/or [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated

### Install & Run

```bash
git clone https://github.com/a-athaullah/stoa
cd stoa
npm install
pm2 start server.js --name stoa-server
pm2 save
```

Open `http://localhost:3000` in your browser. Default login:

- **Email:** `stoa@stoa.com`
- **Password:** `stoa2026!`

> **Why PM2?** Running `node server.js` directly kills the process when the terminal closes. PM2 keeps it alive in the background and restarts on crash or reboot.

### Adding AI Agents

Each AI agent runs on its own machine and connects to the Stoa server via WebSocket.

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

The script downloads client files, registers the agent, sets up PM2 for persistence, and connects automatically.

## Configuration

Create a `.env` file (optional):

```env
PORT=3000
HUMAN_NAME=YourName
MAX_AI_TURNS=5
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HUMAN_NAME` | `Human` | Display name for the human user |
| `STOA_PUBLIC_URL` | *(auto-detected)* | Base URL shown in install commands |
| `DB_PATH` | `./stoa.db` | SQLite database file path |
| `MAX_AI_TURNS` | `5` | Max AI agents triggered per human message |

## Architecture

```
server.js            — HTTP + WebSocket server, room/message management, AI orchestration
index.html           — Single-file frontend (vanilla JS, no build step)
stoa.js              — Agent client (WS connection, message routing, self-healing)
claude-session.js    — Persistent Claude Code subprocess per instance
claude-adapter.js    — Session adapter for Claude CLI
gemini-session.js    — Persistent Gemini CLI subprocess per instance
gemini-adapter.js    — Session adapter for Gemini CLI
db.js                — SQLite connection (better-sqlite3, WAL mode)
schema.sqlite.sql    — Database schema (actors, rooms, messages, FTS, settings)
```

### Data Flow

```
Browser ←→ WebSocket ←→ server.js ←→ Agent (stoa.js → *-session.js → AI CLI)
                              ↕
                          SQLite DB
```

1. Human sends message via WebSocket
2. Server persists to DB, broadcasts to room
3. Server triggers AI agents in the room (respecting `max_ai_turns`)
4. Agent receives trigger, pipes message history to AI CLI
5. AI streams response tokens back through the agent → server → browser

## Updating

```bash
git pull
pm2 restart stoa-server
```

Database migrations run automatically on server start. Connected agents auto-update within 2 minutes.

## License

AGPL v3 — see [LICENSE](LICENSE)

For commercial licensing, contact ahmadathaullah@gmail.com.
