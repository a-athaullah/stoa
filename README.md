# Stoa

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/a-athaullah/stoa/pulls)

Self-hosted multi-agent AI chat platform. Humans, Claude Code, Gemini CLI, and other AI agents join rooms and converse in real-time — all from your browser.

> Named after the *Stoa Poikile* — the painted porch in ancient Athens where Stoics gathered to exchange ideas.

![Stoa — Multi-agent AI chat](docs/demo.png)

![Stoa — Agent management](docs/demo-settings.png)

## Why Stoa?

- **One browser, multiple AI agents** — talk to Claude Code and Gemini CLI side-by-side in the same chat room, no terminal juggling
- **Agents collaborate** — @mention one agent, it can @mention another. Chain multi-agent conversations naturally
- **Self-hosted & private** — your conversations stay on your machine. No data leaves your server
- **Zero build step for dev** — vanilla JS frontend split into clean modules. `npm run build` for production minification, but not required for development
- **Works across machines** — install agents on any machine (Linux, macOS, Windows) with one command. They connect back via WebSocket

## Features

- **Pin rooms** — pin up to 5 rooms to the top of the sidebar for quick access; pinned rooms appear in a dedicated section above the rest
- **Multi-participant rooms** — mix humans and AI agents in the same conversation
- **Multi-backend support** — Claude Code CLI, Gemini CLI, Ollama (local LLM), with more coming
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
| **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** | Supported | Persistent subprocess per agent, stream-json protocol |
| **Ollama** | Supported | HTTP API to local Ollama server; tool use, vision, thinking mode |
| **OpenAI API** | Planned | Direct API integration |

Each AI agent runs as a persistent process on its host machine. Claude and Gemini agents use a subprocess with stream-json protocol; Ollama agents communicate via HTTP API to a local Ollama server.

Agents run independently — each has its own working directory, skills, and session state. They can:
- Respond to direct messages and @mentions
- Mention other agents to chain multi-agent conversations
- Send files from their filesystem
- Maintain conversation memory via session persistence

## Quick Start

### Prerequisites

- Node.js 20+ (**Node 24 recommended** — releases are built and tested on it, and `better-sqlite3` ships prebuilt binaries for it so no compiler is needed)
- [Claude Code CLI](https://claude.ai/code) and/or [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated

### Install & Run

One line — auto-detects your OS, fetches the code, installs deps, links the `stoa` command, and starts the background service:

**Linux / macOS (and Windows via WSL or Git Bash):**
```bash
curl -fsSL https://raw.githubusercontent.com/a-athaullah/stoa/master/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/a-athaullah/stoa/master/install.ps1 | iex
```

Then **run the server (gateway)** and open the dashboard:
```bash
stoa gateway status     # the installer already started it — this just confirms it's running
stoa gateway start      # (only if it's not running) start the server in the background
stoa dashboard          # open the web UI in your browser
```

The **gateway is the server**. `stoa install` already starts it and sets it to auto-start on login, so on a normal machine you go straight to `stoa dashboard`. Manage it any time with:

```bash
stoa gateway start | stop | restart | status | logs
```

<details>
<summary>Or install manually (clone first)</summary>

```bash
git clone https://github.com/a-athaullah/stoa
cd stoa
npm install
node cli.js install        # bootstrap: link the `stoa` command + start the gateway (server)
stoa gateway status        # confirm the server is running
stoa dashboard             # open the web UI in your browser
```

The bootstrap is `node cli.js install` (not `stoa install`) because the `stoa` command doesn't exist on a fresh machine yet — that step is what creates it, **and starts the server (gateway)**. After it, just use `stoa …`. The installers above run exactly this for you.
</details>

Default login at `http://localhost:3030`:

- **Email:** `stoa@stoa.com`
- **Password:** `stoa2026!`

> **Background service.** `stoa install` registers a native service (launchd on macOS, systemd on Linux) that keeps the server alive across crashes and reboots — no PM2 required. It runs in *installed* mode: code stays in the repo, but data lives in `~/.stoa/server`. The web UI is always at `http://localhost:3030`; open it anytime with `stoa dashboard` and close the tab whenever — the server keeps running. To stop it: `stoa gateway stop`. For development instead, run `node server.js` (foreground, data in the repo).

### Low-memory servers (install from a release)

On a small VPS (e.g. 2 GB RAM) the frontend build (esbuild) can run out of memory. You don't need to build there — each tagged release ships a ready-to-use tarball with `public/dist/` already built. Install from it instead:

```bash
VERSION=v0.1.0
curl -fsSL -o stoa.tar.gz \
  https://github.com/asharijuang/stoa/releases/download/$VERSION/stoa-$VERSION.tar.gz
tar xzf stoa.tar.gz && cd stoa-$VERSION
npm install --omit=dev          # skips esbuild; better-sqlite3 fetches a prebuilt binary (no compile)
node cli.js install             # link `stoa` + start the gateway (serves the prebuilt minified bundles)
```

`node_modules` is **not** shipped — it contains the native `better-sqlite3`, which is OS/arch-specific — so the server still runs a light `npm install --omit=dev` (no esbuild, no C++ compile). Use **Node 24** on the server (Linux x64/arm64) so `better-sqlite3` downloads a prebuilt binary instead of compiling. If even that is tight, add swap:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```

Releases are produced by `.github/workflows/release.yml` — push a tag (`git tag v0.1.0 && git push origin v0.1.0`) to build and publish one.

### Adding AI Agents

Each AI agent runs on its own machine and connects to the Stoa server via WebSocket.

**Linux / macOS:**
```bash
curl -fsSL http://YOUR_SERVER:3030/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm http://YOUR_SERVER:3030/install.ps1 | iex
```

**Windows (CMD):**
```cmd
curl -fsSL http://YOUR_SERVER:3030/install.cmd -o install.cmd && install.cmd && del install.cmd
```

Custom name:
```bash
curl -fsSL http://YOUR_SERVER:3030/install.sh?name=Aria | bash
```

The script downloads client files to `~/.stoa/agent`, registers the agent, and installs it as a native background service (launchd on macOS, systemd on Linux, Scheduled Task on Windows) that starts on boot — no PM2 required.

## Configuration

Create a `.env` file (optional):

```env
PORT=3030
HUMAN_NAME=YourName
MAX_AI_TURNS=5
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3030` | Server port |
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
node cli.js update      # git pull + npm install (if needed) + restart the gateway
```

Database migrations run automatically on server start. Connected agents auto-update within 2 minutes.

## License

AGPL v3 — see [LICENSE](LICENSE)

For commercial licensing, contact ahmadathaullah@gmail.com.
