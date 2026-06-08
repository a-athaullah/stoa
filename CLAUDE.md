# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Stoa is a self-hosted multi-agent AI chat platform. Humans and AI agents (Claude Code, Gemini CLI, Ollama) join rooms and converse in real-time from a browser. The defining architectural fact: **the server and the AI agents are separate processes, usually on separate machines, connected only over WebSocket.** The server never spawns AI CLIs itself — each agent is an independent `stoa.js` process running next to its own working directory and AI CLI.

## Commands

```bash
npm start              # run the server (node server.js) — but prefer PM2 in practice
pm2 start server.js --name stoa-server   # how the server is actually run (survives terminal close)
npm run build          # bundle/minify frontend → public/dist + public/vendor (esbuild). NOT needed for dev.
npm run cli            # run a human terminal client (STOA_TYPE=human STOA_ACTOR_ID=1 node stoa.js)
npm run setup          # configure git hooks (core.hooksPath = .githooks)

node test.js           # run all tests. Unit tests always run; integration tests need a running server.
node test.js 3000      # run tests against a server on PORT 3000 (integration tests connect via HTTP/WS)
```

There is no lint step and no test framework — `test.js` is a hand-rolled runner using `assert`. To run a single test, comment out others or temporarily guard the `ut(...)` / integration call you want; tests are plain function calls, not a registry you can filter by name.

The frontend has **no build step for development** — `server.js` serves raw files from `public/js/` and `public/css/`. `npm run build` only matters for producing the minified `public/dist/` bundles used in production.

## Running the app to see changes

Server changes: restart the server (`pm2 restart stoa-server`, or kill/rerun `node server.js`). Default login is `stoa@stoa.com` / `stoa2026!` at `http://localhost:3000`.

Agent-side changes (`stoa.js`, `*-session.js`): connected agents **auto-update within ~2 minutes** by pulling changed files from the server (see `UPDATE_FILES` / `UPDATE_INTERVAL` in `stoa.js`). For immediate testing, restart the agent process or trigger `force_update`.

## Architecture

### Three-tier process model

```
Browser ──WS──► server.js ──WS──► Agent (stoa.js) ──► *-session.js ──► AI CLI / Ollama HTTP
   │              │
   └──────────────┴──► SQLite (db/stoa.db, WAL mode)
```

- **`server.js`** (single large file, ~170KB) — HTTP + WebSocket server, all REST endpoints, room/message/actor persistence, AI-trigger orchestration, file-proxy routing, Slack automation engine, auth, and migration runner. This is the hub; everything routes through it.
- **`stoa.js`** — the generic client. Runs in two modes via `STOA_TYPE`: `human` (readline terminal client, line-based — *not* a full-screen TUI) or `ai` (headless agent). The same file handles WS connection, self-healing (reconnect with backoff, hang watchdog, crash recovery), auto-update, file-proxy operations against its local workdir, and dispatching triggers to a session backend.
- **`*-session.js`** — one per AI backend, selected by `STOA_AI_BACKEND` env (`claude` default / `gemini` / `ollama`):
  - `claude-session.js` — persistent `claude` subprocess, `stream-json` in/out, session resume via `--resume`.
  - `gemini-session.js` — persistent Gemini CLI subprocess (stream-json); `gemini-adapter.js` is the spawn-per-message variant.
  - `ollama-session.js` — HTTP client to a local Ollama server; implements its own tool-use loop (`fetch_url`, vision via a separate model, etc.).

### WebSocket is the API

Most behavior is driven by typed WS messages, not REST. The two endpoints of the protocol live in:
- `server.js` — search for `msg.type === '...'` handlers (e.g. `send_message`, `agent_trigger` orchestration, `compact_session`, `agent_token`/`agent_complete` for streaming, `proxy_file_*` for remote file ops).
- `stoa.js` — search for `msg.type === '...'` handlers (e.g. `agent_trigger`, `proxy_file_read/write/...`, `force_update`, `compact_trigger`).

When adding a feature that crosses the browser↔server↔agent boundary, you will almost always add a matching message type on **both** sides plus a browser-side handler in `public/js/websocket.js`.

### Remote file editing / workspace

The browser can browse and edit files on **any agent's machine**. The browser asks the server (`file_read`, `file_write`, `git_diff`, …), the server proxies to the owning agent (`proxy_file_*`), and the agent performs the op locally. All agent-side file access is gated by `isPathSafe()` (in both `stoa.js` and tested in `test.js`) — it confines access to the agent's workdir and rejects symlink/`..` escapes. Preserve this guard when touching file-proxy code.

### AI trigger orchestration

A human message in a room triggers AI agents that are participants. `MAX_AI_TURNS` (default 5) caps how many agent responses one human message can chain — agents can @mention each other, so this prevents runaway loops. Claude sessions **auto-compact** when context grows large (per-message check + 60-min background worker); a system event is posted to the room on completion.

### Frontend

Vanilla JS, no framework. `public/js/` modules load in a fixed order (see `jsFiles` in `build/build.js`): `core, rooms, websocket, workspace, markdown, chat, composer, settings, init`. CSS is split into `base, layout, workspace, chat, components`. Vendored libs (marked, DOMPurify, highlight.js, CodeMirror 6) are self-hosted in `public/vendor/`.

### Database & migrations

`db/index.js` opens SQLite (WAL, foreign keys on). `db/schema.sqlite.sql` is the base schema. **Migrations run automatically on server start** — they live in `migrations/` named `YYYYMMDDNN-description.sql` and are tracked in a `migrations` table. To add one, drop a new dated `.sql` file in `migrations/`; the runner in `server.js` applies unseen files in order. Older inline migrations are seeded as already-applied for existing DBs.

### Slack automation

The server can connect to Slack via Socket Mode (`@slack/socket-mode`). Incoming Slack messages match user-defined rules (channel filter, condition operators like `contains`/`matches_regex`) and trigger an agent in a target room using a prompt template with `{{slack_message_text}}`, `{{slack_channel_name}}`, etc. Connections/credentials live in the `automation_connections` table; rules in `automations`. Multiple Slack connections are pooled.

## Conventions enforced by git hooks

Run `npm run setup` once so these are active (`.githooks/`):

- **pre-commit** — docs-sync guard: the 5 `docs/guide-usage.{en,id,ja,ko,zh}.md` files must change together. If you edit one guide language, edit all five (or `SKIP_DOCS_SYNC=1 git commit ...` to override). The same multi-language convention applies to `doc-*` files.
- **pre-push** — auto-bumps `package.json` version from conventional-commit prefixes (`fix:`→patch, `feat:`→minor, `feat!:`/`BREAKING CHANGE:`→major), generates `changelog/version-X-Y-Z.md`, commits as `vX.Y.Z [version]`, and tags. Do not hand-edit the version; write conventional commit messages instead.

Note `stoa.js` carries its own `CLIENT_VERSION` constant (separate from `package.json`) used for agent auto-update — bump it when changing agent-side wire behavior.

## Environment

Config is via `.env` (see `.env.example`). Key vars: `PORT` (3000), `HUMAN_NAME`, `STOA_PUBLIC_URL` (base URL in install commands), `DB_PATH`, `MAX_AI_TURNS`, `CLEANUP_CRON_HOUR`/`CLEANUP_MAX_AGE_HOURS` (daily upload cleanup). Agent-side env: `STOA_URL`, `STOA_ACTOR_ID`, `STOA_TYPE`, `STOA_SECRET`, `STOA_AI_BACKEND`, `STOA_MAX_CONCURRENT`.
