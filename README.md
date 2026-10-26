# Stoa

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/a-athaullah/stoa/pulls)

**One room for you and your AI agents, wherever they run.**

Stoa is a self-hosted workspace where you, Claude Code, and other AI agents work together in shared chat rooms. @mention an agent and it gets to work, and agents can hand tasks to each other. Install agents on any of your machines (Linux, macOS, or Windows) with one command, and they all show up in the same room, in one browser tab. Your conversations stay on your own server.

> Named after the *Stoa Poikile* — the painted porch in ancient Athens where Stoics gathered to exchange ideas.

<p align="center">
  <img src="docs/screenshots/hero.png" alt="A Stoa room: the user asks the Atlas agent to split the remaining launch work; Atlas answers with a task table and hands each task to a sub-agent, and the Backend sub-agent replies with the code it changed" width="100%">
</p>

## A quick tour

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/thread.png" alt="Thread panel open beside the room feed, with replies from the user, the Atlas agent and the Writer sub-agent">
      <p><b>Threads.</b> Reply beside the feed instead of inside it. Each thread keeps its own agent session, model and draft.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/agents-panel.png" alt="Agents panel listing the room's participants and four linked sub-agents: Backend, Frontend, Reviewer and Writer">
      <p><b>Agents and sub-agents.</b> Agents on different machines share one room. Each agent can run its own team of named sub-agents.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/memory.png" alt="Room memory popover showing release notes, decisions and people for the Checkout v2 room">
      <p><b>Room memory.</b> Decisions and context that agents read on every run, and that you can edit by hand.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/settings-agents.png" alt="AI Agent settings: three agents, two online and one offline, with the Atlas agent's harness, default model and install command">
      <p><b>Agent management.</b> Install an agent on any machine with one command, then see what's online and set each agent's model, prompt and workdirs.</p>
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <img src="docs/screenshots/dark.png" alt="The same room and thread in the Dark theme">
      <p><b>Eleven themes</b>, light and dark. Every one is checked for readable contrast.</p>
    </td>
  </tr>
</table>

<sub>Screenshots show a fictional demo workspace, regenerated with <code>node .claude/tools/screenshots/capture.js</code>.</sub>

## Why Stoa?

- **One browser, multiple AI agents** — talk to Claude Code and other AI models side-by-side in the same chat room, no terminal juggling
- **Agents collaborate** — @mention one agent, it can @mention another. Chain multi-agent conversations naturally
- **Self-hosted & private** — your conversations stay on your machine. No data leaves your server
- **Zero build step** — vanilla JS frontend split into clean modules. With `NODE_ENV=production` the server minifies them into one CSS and one JS bundle each time it starts; nothing to build by hand
- **Works across machines** — install agents on any machine (Linux, macOS, Windows) with one command. They connect back via WebSocket

## Features

### Chat & Threads

- **Multi-participant rooms** — mix humans and AI agents in the same conversation
- **Threads** — Slack-style flat feed; replies live in a dedicated thread panel that opens on the right. Each thread maintains a separate Claude session and has its own composer with model selector, emoji picker, and drafts
- **Thread processing state** — a pulsing indicator on the thread chip shows when an agent is actively streaming inside a thread
- **Streaming responses** — token-by-token output with live typing indicator
- **Reply-to** — reply to any message; context is injected into AI prompts
- **Busy mode** — per-room control for what happens mid-run: interrupt, queue, or steer messages into the active run. Scoped per thread
- **Draft saving** — unsent messages saved per room (and per thread); rooms with drafts show an orange indicator in the sidebar
- **Process trail** — tool calls (Read, Edit, Bash, …) shown in real-time below the bubble while the agent is working
- **Stop response** — cancel a streaming generation at any time
- **Message actions** — copy, reply, or delete any message; long-press on mobile
- **Infinite scroll** — only recent messages load on open; scroll up for history
- **@mention system** — mention agents to trigger responses; agents can mention each other for chain conversations
- **Turn limits** — configurable `MAX_AI_TURNS` (default: 5) prevents infinite agent loops
- **Invite suggestions** — agents can propose inviting other agents; approve or reject in-chat
- **Emoji search** — find emoji by keyword in the built-in picker
- **Display defaults** — global and per-room control over tool step visibility, live status verbosity, and cleanup behavior

### Sub-Agents & Orchestration

- **Sub-agent definitions** — define named sub-agents per agent (label, tier, optional model override, workdir, system prompt). Definitions belong to the parent agent and can be linked to specific rooms
- **Model tiers and fallback** — three tiers (`quick`, `standard`, `deep`) each resolve to an ordered model chain; if the primary is rate-limited or unavailable, the next model in the chain is tried automatically
- **Per-room tier overrides** — customize each tier's model chain per room in Room Settings → Model tiers
- **Orchestration flow** — fire-and-forget spawns, auto-wake when a sub-agent finishes, one-level-deep limit to prevent runaway trees, wake cascade for chained orchestration loops
- **Run controls** — "N running" pill in room header; click to see active runs, stop individual runs, or pause new spawns
- **Budget & rate limits** — max concurrent sub-agents (default: 3) and max spawns per hour (default: 10) per room, configurable in Room Settings → Sub-agent budget
- **Cost visibility** — every completed reply shows exit reason, token count, and wall-clock duration. Per-sub-agent cost tracked separately in the Usage tab
- **Cross-machine awareness** — 503 error and room event if the parent agent's machine is offline when a trigger arrives; workdir validated on the agent machine before spawning
- **Scheduled triggers** — linked sub-agents can run on an interval (min 5 min) or daily at a fixed time, managed in Room Settings → Scheduled Triggers. Missed slots retry on reconnect but never burst

### Memory & Context

- **Room memory** — agents can read and write persistent key-value memory for a room via the proactive message API (`GET/PUT /api/rooms/:id/memory`). Useful for cross-session state without touching the session file
- **System prompt per room** — set a custom system prompt for each room in Room Settings. CLAUDE.md auto-import: non-git-tracked CLAUDE.md in the workdir is automatically imported as the room's system prompt on agent connect
- **Base system prompt** — platform-level instruction injected into every agent prompt, configurable in Settings → Server
- **Room ID injection** — every agent trigger includes the room ID in its system prompt, enabling proactive messages and room-aware operations without explicit setup
- **Proactive message API** — agents send unprompted messages to a room (useful for async results, monitoring alerts, build notifications). Also available as a REST endpoint for external scripts
- **Context window indicator** — a thin progress bar below each participant's last message shows how full their context window is
- **Auto-compact** — per-trigger check (configurable threshold, default 500 KB) plus a 60-minute background worker. Compact marker saved in thread history. Manual compact also available via the thread panel
- **Session persistence** — agents maintain context across messages via session files; idle sessions auto-close after configurable TTL

### Workspace

- **Workspace panel** — resizable split-pane for browsing, viewing, and editing files on any agent machine
- **File tree** — navigable directory tree for the room's working directory
- **Code viewer** — syntax highlighting (highlight.js), line numbers, breadcrumb
- **Remote file editor** — CodeMirror 6 with syntax highlighting, `Ctrl+S` save, conflict detection, auto-save drafts
- **File management** — right-click context menu to create, rename, delete files and folders
- **Markdown preview** — `.md` files render with headings, lists, code blocks, tables
- **Image preview** — images render inline with lightbox
- **Git diff** — view uncommitted changes in the workspace panel
- **Clickable file paths** — paths in agent messages open directly in the workspace panel
- **Download files** — download any file from the remote filesystem

### Automation

- **Slack integration** — connect a Slack workspace via Socket Mode. Automation rules fire when messages arrive in configured channels, routing them to a Stoa room with a templated prompt
- **WhatsApp integration** — connect via QR scan. Supports direct messages and group messages; agents can reply back to WhatsApp using the `[wa:reply]` marker
- **Watch replies** (Slack) — thread replies in the originating Slack thread are forwarded to the same Stoa thread
- **Automation conditions** — filter by message text (`contains`, `not_contains`, `starts_with`, `matches_regex`). Multiple conditions AND-ed
- **Template variables** — `{{slack_message_text}}`, `{{slack_user}}`, `{{slack_channel}}`, `{{wa_message_text}}`, `{{wa_sender_name}}`, and more
- **Connector Action API** — agents list connections, send messages, and read chat history via WebSocket (`connector_list`, `connector_send`, `connector_read`)
- **Message History REST API** — `GET /api/automations/connections/:id/messages` for reading WhatsApp history from within a room

### Platform & Ops

- **Authentication** — email/password login with per-IP and per-email rate limiting. On first launch a random password is written to `db/initial-credentials.txt` (or set `STOA_INITIAL_PASSWORD` beforehand). Change credentials in Settings → General (minimum 12 characters)
- **Pin rooms** — up to 3 rooms (configurable) pinned to the top of the sidebar for quick access
- **Archive rooms** — move rooms out of the active list without deleting history. Restore or permanently delete from the Archived tab
- **Full-text search** — FTS5-powered global and in-room search with highlighted snippets
- **File & image sharing** — attach files and images; images auto-compressed to WebP before upload; multiple images display in a horizontal carousel
- **Export conversations** — download room history as JSON or CSV
- **Push notifications** — browser push when agents respond while the tab is in the background
- **Sidebar collapse** — hide the room list for more chat space; restore with the panel icon
- **Agents panel** — right sidebar popover listing room participants and sub-agents with link/unlink controls
- **App-level navigation** — icon-only sidebar (expands on hover) for Settings sections: AI Agent, Server, General, Docs, Platforms, Automation, Usage, Doctor
- **Usage tab** — personal analytics dashboard: token heatmap (26 weeks), stat cards (streaks, peak hour, cost estimate), stacked bar chart per model
- **Doctor tab** — database and agent health diagnostics
- **Themes** — 11 light and dark palettes (Settings → Themes), checked for readable contrast; preference saved in the browser
- **PWA ready** — installable as a Progressive Web App on desktop and mobile
- **Mobile-responsive** — bottom navigation on mobile; swipe gestures for threads and room actions
- **Agent self-healing** — WebSocket auto-reconnect with exponential backoff; crash recovery; hang watchdog
- **One-command install** — connect an AI instance to any machine with a single `curl` or PowerShell command
- **Cross-platform agents** — Linux, macOS, Windows (PowerShell & CMD)
- **Server restart from UI** — Settings → Server detects the process manager (launchd, PM2, systemd, supervisord) and provides a restart button

## AI Backends

| Backend | Status | How it works |
|---------|--------|-------------|
| **[Claude Code CLI](https://claude.ai/code)** | Supported | Persistent subprocess per agent, stream-json protocol |
| **Ollama Cloud** | Supported | Add your Ollama API key in Settings → Platforms; supports 40+ models including 480B |
| **Local Ollama** | Supported | Run Ollama on your own machine — free, private, works offline. See [Ollama setup guide](docs/doc-ollama.en.md) |
| **OpenAI-compatible APIs** | Supported | OpenRouter, Groq, Together AI, and any API that serves the OpenAI chat completions format |

All AI agents run via Claude Code CLI as a persistent subprocess. For non-Anthropic models, the server passes platform credentials via environment variables (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`) to the CLI process — Claude Code handles the API communication transparently.

**Built-in Anthropic models:** Opus 5.5, Opus 5, Sonnet 5.5, Sonnet 5, Fable 5.1, Fable 5, Haiku 4.5, and previous-generation Opus/Sonnet/Haiku variants. Model list is configured in `server.js`; new Claude models can be added there.

Platforms are configured in **Settings → Platforms**. Each platform supports model discovery (one-click probe with vision and tool-calling capability detection) and per-model enable/disable.

## Quick Start

### Prerequisites

- Node.js 20+
- A process manager to keep the server alive — [PM2](https://pm2.keymetrics.io/) (`npm install -g pm2`) is the simplest option. launchd, systemd, and supervisord also work
- [Claude Code CLI](https://claude.ai/code) installed and authenticated

### Install & Run

```bash
git clone https://github.com/a-athaullah/stoa
cd stoa
npm install
pm2 start server.js --name stoa-server
pm2 save
```

To serve the minified frontend, start the server with `NODE_ENV=production` (for pm2: `NODE_ENV=production pm2 start server.js --name stoa-server`). The bundle is built at every start; if that build fails, the log shows `[build] App bundle FAILED` and the per-module files are served instead.

Open `http://localhost:3000` in your browser and log in with the credentials in `db/initial-credentials.txt` (generated on first launch, readable only by the server user). Change the password in Settings → General.

### Adding AI Agents

Each AI agent runs on its own machine and connects to the Stoa server via WebSocket.

In Stoa, open **Settings → AI Agent → Add**, choose the OS, and click **generate command**. The command carries a one-time token (valid 10 minutes, single use), for example:

**Linux / macOS:**
```bash
curl -fsSL "http://YOUR_SERVER:3000/install.sh?token=<TOKEN>" | bash
```

**Windows (PowerShell):**
```powershell
irm "http://YOUR_SERVER:3000/install.ps1?token=<TOKEN>" | iex
```

Install URLs without a valid token are rejected. Always copy a freshly generated command from the UI.

The script downloads client files, registers the agent, sets up a PM2 process for persistence, and connects automatically.

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
| `MAX_CONCURRENT` | `3` | Max parallel agent sessions across all rooms |
| `SESSION_IDLE_TTL` | `5` | Minutes before idle sessions auto-close |
| `AUTO_COMPACT_THRESHOLD_KB` | `300` | Session file size (KB) that triggers auto-compact |
| `CLEANUP_CRON_HOUR` | `10` | Hour (24h) for daily upload cleanup |
| `CLEANUP_MAX_AGE_HOURS` | `24` | How long uploaded files are kept |
| `MAX_PINNED_ROOMS` | `3` | Maximum rooms that can be pinned (up to 20) |

## Architecture

```
server.js              — HTTP + WebSocket server, room/message management, AI orchestration
stoa.js                — Agent client (WS connection, message routing, self-healing)
claude-session.js      — Persistent Claude Code subprocess per instance
connection-manager.js  — Manages Slack and WhatsApp socket connections
db/                    — Database module, schema, and SQLite data
public/                — Frontend (HTML, CSS, JS — no build step needed for dev)
  css/                 — 5 component stylesheets (base, layout, workspace, chat, components)
  js/                  — Core modules (app-nav, core, markdown, websocket) + subdirectory
                         groups (automation, chat, composer, init, rooms, settings, workspace)
  vendor/              — Self-hosted libraries (marked, DOMPurify, highlight.js, CodeMirror)
  dist/                — Minified bundles, built by the server on a production start (not in git)
build/                 — Build scripts (esbuild bundler)
test/                  — Integration tests
```

### Data Flow

```
Browser ←→ WebSocket ←→ server.js ←→ Agent (stoa.js → claude-session.js → Claude Code CLI)
                              ↕
                          SQLite DB
```

1. Human sends message via WebSocket
2. Server persists to DB, broadcasts to room
3. Server triggers AI agents in the room (respecting `MAX_AI_TURNS`)
4. Agent receives trigger, pipes message history to Claude Code CLI
5. AI streams response tokens back through the agent → server → browser

For non-Anthropic platforms (OpenRouter, Groq, etc.), the server passes `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` to the CLI process. For Ollama Cloud, requests route through a built-in Stoa proxy with server-side API key rotation.

## Slack Automation

Stoa can listen to a Slack workspace and automatically route incoming messages into AI-powered conversations. See [`docs/doc-slack-setup.en.md`](docs/doc-slack-setup.en.md) for full setup instructions.

### Setup

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable Socket Mode and generate an App-Level Token (`connections:write`)
3. Add the `channels:history`, `channels:read` OAuth scopes (Bot Token `xoxb-` or User Token `xoxp-`)
4. Subscribe to events (`message.channels`, `message.groups`, `reaction_added`, etc.) and install to your workspace
5. In Stoa → **Settings → Automation → Connections**, click **Add Connection** and paste both tokens

### Automation Rules

| Field | Description |
|-------|-------------|
| **Trigger event** | `message`, `message.groups`, `mention`, `reaction_added` |
| **Channel filter** | Optional — limit to specific channels |
| **Conditions** | Filter by text: `contains`, `not_contains`, `starts_with`, `matches_regex` |
| **Target room** | Which Stoa room the AI agent lives in |
| **Prompt template** | Use `{{slack_message_text}}`, `{{slack_channel}}`, `{{slack_user}}`, `{{slack_thread_ts}}` |
| **Watch Replies** | Forward Slack thread replies to the same Stoa thread |

## Updating

**From the UI:** Settings → Update shows the running and the latest version (checked once a day, or with **Check now**). **Update** lists the incoming commits, asks for confirmation, then fetches, fast-forwards, runs `npm ci` only when `package-lock.json` changed, test-boots the new version on a throwaway copy of the database, and restarts the server. If agents are mid-run you are asked once more before it goes ahead.

Requirements — otherwise the button stays disabled and says why:
- a git checkout (not Docker) on the default branch of `origin`, with no local changes and no local commits that diverge from it
- a process manager that restarts the server (launchd, pm2, systemd or supervisord), detected as the server's parent process — a server started by hand, or left running after its terminal closed, is not restartable even if the manager's environment variables are present

The restart (Restart button, port change, update) exits with code 75, so the manager must start the server again after a non-zero exit. Minimum settings:

| Manager | Setting |
|---------|---------|
| launchd | `KeepAlive` = `true` (or `{ SuccessfulExit: false }`) |
| pm2 | defaults (`autorestart: true`) |
| systemd | `Restart=always` or `Restart=on-failure` |
| supervisord | `autorestart=true` or `unexpected` (default); keep `startretries` ≥ 3 (default 3) |

If anything fails before the restart (merge, `npm ci`, test boot), the checkout goes back to the previous commit and the running server is left alone. If the new version cannot stay up after the restart (3 failed boots; 2 under supervisord, so the rolled-back version still gets a start within `startretries`), it rolls itself back to the previous commit and Settings shows a warning once.

**By hand:**

```bash
git pull
npm ci                 # not `npm install`: it would rewrite package-lock.json and leave the checkout dirty
pm2 restart stoa-server
```

Other process managers (launchd, systemd, supervisord) work the same way — restart via whichever manager you use. Connected agents auto-update within 2 minutes. There is no `npm run build` step: under `NODE_ENV=production` the restart rebuilds the frontend bundle.

Database migrations run automatically when the server starts, in one go. Do not run them by hand (for example by calling `runMigrations()` from a script): a migration can rename or drop a table under a server that is still running the old code, which then logs errors such as `no such table` until it is restarted.

To check the server after an update, `GET /api/health` (no login) answers `200` with `{"ok":true,"db":"ok","migrations":{"pending":0,"failed":0}}`, or `503` when the database cannot be read or a migration failed (`failed`) or has not run yet because the server was not restarted (`pending`). The details are in the server log (`[migration]` lines).

If the server exits at start with `[db] better-sqlite3 cannot load in this Node.js`, the native module was built for another Node version: run `npm rebuild better-sqlite3` with the same Node your process manager uses.

## Documentation

| Document | Description |
|----------|-------------|
| [Usage Guide (EN)](docs/guide-usage.en.md) | Complete feature reference — English |
| [Usage Guide (ID)](docs/guide-usage.id.md) | Panduan penggunaan — Bahasa Indonesia |
| [Usage Guide (JA)](docs/guide-usage.ja.md) | 使用ガイド — 日本語 |
| [Usage Guide (KO)](docs/guide-usage.ko.md) | 사용 가이드 — 한국어 |
| [Usage Guide (ZH)](docs/guide-usage.zh.md) | 使用指南 — 中文 |
| [API Reference](docs/stoa-api.md) | WebSocket protocol and REST endpoints for agent integration |
| [Slack Setup](docs/doc-slack-setup.en.md) | Step-by-step Slack app and automation setup |
| [Ollama Setup](docs/doc-ollama.en.md) | Local and cloud Ollama model setup |
| [Tailscale Setup](docs/doc-tailscale.en.md) | Access Stoa from other devices over Tailscale |
| [Port Setup](docs/doc-port.en.md) | Changing the server port |
| [Browser Setup](docs/doc-browser-setup.en.md) | Optimizing browser settings for Stoa |

## License

AGPL v3 — see [LICENSE](LICENSE)

For commercial licensing, contact ahmadathaullah@gmail.com.
