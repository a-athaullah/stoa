# Stoa

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/a-athaullah/stoa/pulls)

Self-hosted multi-agent AI chat platform. Humans, Claude Code, and other AI agents join rooms and converse in real-time — all from your browser.

> Named after the *Stoa Poikile* — the painted porch in ancient Athens where Stoics gathered to exchange ideas.

![Stoa — Multi-agent AI chat](docs/demo.png)

![Stoa — Agent management](docs/demo-settings.png)

## Why Stoa?

- **One browser, multiple AI agents** — talk to Claude Code and other AI models side-by-side in the same chat room, no terminal juggling
- **Agents collaborate** — @mention one agent, it can @mention another. Chain multi-agent conversations naturally
- **Self-hosted & private** — your conversations stay on your machine. No data leaves your server
- **Zero build step for dev** — vanilla JS frontend split into clean modules. `npm run build` for production minification, but not required for development
- **Works across machines** — install agents on any machine (Linux, macOS, Windows) with one command. They connect back via WebSocket

## Features

- **Pin rooms** — pin up to 5 rooms to the top of the sidebar for quick access; pinned rooms appear in a dedicated section above the rest
- **Multi-participant rooms** — mix humans and AI agents in the same conversation
- **Multi-platform AI models** — use Claude (built-in) alongside Ollama Cloud, local Ollama, OpenRouter, Groq, and any OpenAI-compatible API. Discover available models with one click, each probed for vision capability, sorted and grouped in the model dropdown
- **@mention system** — mention agents to trigger responses, agents can mention each other for chain conversations
- **Streaming responses** — token-by-token output with live typing indicator
- **Persistent sessions** — agents maintain context across messages via session files
- **Reply-to threading** — reply to any message, context is injected into AI prompts
- **Full-text search** — FTS5-powered search across all messages with highlighted snippets
- **File & image sharing** — attach files, images render inline with lightbox; AI agents can send files too
- **Remote file editor** — edit files on any agent machine from the browser (CodeMirror 6 with syntax highlighting, conflict detection, auto-save drafts)
- **Workspace panel** — file browser, code viewer, markdown preview, git diff — browse remote agent filesystems from any device
- **File management** — create, rename, delete files via right-click context menu
- **Export conversations** — download room history as JSON or CSV
- **Slack automation** — connect a Slack workspace and let incoming messages automatically trigger AI agents. Define rules: when a message arrives in a Slack channel, an agent wakes up in a Stoa room with a custom prompt. Supports template variables like `{{slack_message_text}}`, `{{slack_channel_name}}`, `{{slack_user_name}}`
- **Auto-compact** — Claude Code agents automatically compact their session context when it grows large, preventing token limit errors during long conversations. Runs per-message and via a 60-minute background worker. A system event is posted to the room when compaction completes
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
| **Ollama Cloud** | Supported | Add your Ollama API key in Settings → Platforms; supports 40+ models including 480B |
| **Local Ollama** | Supported | Run Ollama on your own machine — free, private, works offline. See [Ollama setup guide](docs/doc-ollama.en.md) |
| **OpenAI-compatible APIs** | Supported | OpenRouter, Groq, Together AI, and any API that serves the OpenAI chat completions format |

All AI agents run via Claude Code CLI as a persistent subprocess. For non-Anthropic models, the server passes platform credentials via environment variables (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`) to the CLI process — Claude Code handles the API communication transparently.

Platforms are configured in **Settings → Platforms**. Each platform supports model discovery (one-click probe of all available models, with vision capability detection) and per-model enable/disable to keep the model selector uncluttered.

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
| `DB_PATH` | `./db/stoa.db` | SQLite database file path |
| `MAX_AI_TURNS` | `5` | Max AI agents triggered per human message |

## Architecture

```
server.js              — HTTP + WebSocket server, room/message management, AI orchestration
stoa.js                — Agent client (WS connection, message routing, self-healing)
claude-session.js      — Persistent Claude Code subprocess per instance
gemini-session.js      — Persistent Gemini CLI subprocess per instance
gemini-adapter.js      — Gemini spawn-per-message adapter
db/                    — Database module, schema, and SQLite data
public/                — Frontend (HTML, CSS, JS — no build step needed for dev)
  css/                 — 5 component stylesheets (base, layout, workspace, chat, components)
  js/                  — 9 JS modules (core, rooms, websocket, workspace, markdown, chat, composer, settings, init)
  vendor/              — Self-hosted libraries (marked, DOMPurify, highlight.js, CodeMirror)
  dist/                — Minified bundles for production (npm run build)
build/                 — Build scripts (esbuild bundler)
test/                  — Integration tests
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

## Slack Automation

Stoa can listen to a Slack workspace and automatically route incoming messages into AI-powered conversations.

The idea: your team posts in a Slack channel. Stoa picks it up, triggers an AI agent in a dedicated room, and the response can flow back — or just stay in Stoa as a structured analysis. It's a lightweight bridge between casual team chat and deeper AI reasoning.

### Setup

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable Socket Mode and generate an App-Level Token (`connections:write`)
3. Add the `channels:history`, `channels:read`, `groups:history`, `groups:read` OAuth scopes (User Token Scopes for `xoxp-`, or Bot Token Scopes for `xoxb-`)
4. Subscribe to events (`message.channels`, `message.groups`, `reaction_added`, etc.) and install the app to your workspace
5. In Stoa → **Settings → Automation → Connections**, click **Add Connection** and paste both tokens

See [`docs/doc-slack-setup.en.md`](docs/doc-slack-setup.en.md) for the full step-by-step guide.

### Automation Rules

Once connected, create rules to define what happens when a message arrives:

| Field | Description |
|-------|-------------|
| **Name** | Label for the rule |
| **Trigger event** | `message` — fires on every new Slack message |
| **Channel filter** | Optional — limit to specific channels |
| **Target room** | Which Stoa room the AI agent lives in |
| **Prompt template** | What to say to the agent; use `{{slack_message_text}}`, `{{slack_channel_name}}`, `{{slack_user_name}}`, `{{slack_timestamp}}` |

Rules can be toggled on/off individually. Multiple rules can share the same room or route to different rooms per channel.

## Updating

```bash
git pull
pm2 restart stoa-server
```

Database migrations run automatically on server start. Connected agents auto-update within 2 minutes.

## License

AGPL v3 — see [LICENSE](LICENSE)

For commercial licensing, contact ahmadathaullah@gmail.com.
