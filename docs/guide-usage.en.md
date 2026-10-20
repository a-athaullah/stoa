# Stoa Usage Guide

Stoa is a self-hosted chat platform where humans and AI agents (Claude Code instances) converse in real-time. This guide covers everything you need to get started and make the most of every feature.

---

## Quick Start

1. **Open Stoa** in your browser at `http://localhost:3000` (or your configured port/URL)
2. **Log in** — initial credentials are written to `db/initial-credentials.txt` on first launch (readable only by the server process). You can also pre-set the password via the `STOA_INITIAL_PASSWORD` environment variable before first launch.
3. On first visit, you'll be asked to **set your display name** — this becomes your human identity in all rooms
4. **Create a room** — click the `+ room` button in the sidebar, give it a title, select a working directory, and choose which AI agents to invite
5. **Start chatting** — type a message in the composer and press Enter. All AI agents in the room will respond

---

## Authentication

Stoa uses email/password authentication:

- **Initial credentials**: On first launch, a random password is generated and written to `db/initial-credentials.txt` (mode 0600, default directory `db/`). Use those credentials to log in. You can also pre-set the password via the `STOA_INITIAL_PASSWORD` environment variable before first launch.
- **Default password warning**: If you are still using the initial password, a persistent banner appears in the UI reminding you to change it.
- **Login**: Enter your email and password to access Stoa.
- **Rate limit**: 5 failed login attempts per 15 minutes per IP address (also per email address from any IP). After the limit is reached, the server responds with `429 Too Many Requests` and a `Retry-After` header. Devices that have logged in successfully before are exempt from the per-email limit.
- **Password requirements**: New passwords must be at least 12 characters.
- **Email change**: Update your email in **Settings > General > Account**.
- **Password change**: Update your password in **Settings > General > Account**.
- **Logout**: Click the logout button in **Settings > General > Session**.

API endpoints and WebSocket connections require authentication. Files under `/uploads/` and `/connector-media/` require a valid session, agent credentials, or a signed URL — they are not publicly accessible.

---

## Rooms

A room is a conversation space with one human and one or more AI agents.

### Creating a Room

Click the **+ room** button in the sidebar. A dialog appears where you:

- Enter a **room title** — this can be edited later by clicking the title in the chat header
- Select **participants** — select the AI agent for this room (you can add more agents after creation) Only agents that are currently **online** can be selected — offline agents are shown greyed-out with an *offline* badge, since a room needs an agent that can actually respond.
- Select a **working directory** — required; determines which project context and skills are available in this room

### Adding Participants

Click the **+** button in the room header to open the add-agent dialog. Choose an AI agent (only agents not already in the room are listed) and select its **working directory** — the same picker as when creating a room — then click **Add Agent**. This lets each agent in a room run in its own directory (for example, one agent in a project folder and another in its own workspace). Only **online** agents can be added; offline agents appear in the list but are disabled (with an *offline* badge) — bring the agent online first, then add it.

### Renaming a Room

Click the room title in the chat header. It becomes editable — type the new name and press Enter, or press Escape to cancel.

### Switching Model

A **model selector** appears at the right side of the formatting toolbar in the composer. Use it to override the model the agent will use for its next response.

**Built-in Claude models** (via Claude Code subscription):
- **Haiku 4.5** — fastest and most economical
- **Sonnet 4.5 / 4.6** — balanced performance and quality (default: Sonnet 4.6)
- **Opus 4.6 / 4.7 / 4.8** — highest capability, best for complex or long-context tasks

**External platform models**: If you've configured additional platforms in **Settings > Platforms** (e.g., Ollama Cloud, OpenRouter), their enabled models also appear in the selector, grouped by platform name. Models with vision capability are marked with a 👁 icon; models with tool-calling support are marked with a ⚙ icon. Models without tool-calling run in text-only mode (no file reading, no code execution via tools).

The selection is saved per room and takes effect immediately on the next message — no restart required.

When a room has more than one AI agent, or when any agent is not using the room model, the model selector includes a **"model per agent"** preview section below the model list. Each row shows `Name · harness → model`, with a label (`↪ agent default`, `↪ harness default`, or `↪ CLI default`) when an agent will not use the room model. The preview updates automatically when you switch rooms, when agent settings change, or when the room model changes.

### Busy Mode

**Busy mode** controls what happens when you send a message while the AI is still running. Open the room settings (the **gear icon** in the room header) and look for the **Busy mode** card. Three options:

- **interrupt** (default) — the current run stops immediately and the agent restarts with your new message.
- **queue** — your message is queued. A queue pill appears in the room header showing how many messages are waiting. Each one is processed in order once the current run finishes.
- **steer** — your message is injected directly into the agent's current run without interrupting it. A brief **"↩ injected into current run"** notice appears in the header. The agent sees your message mid-stream and can adjust accordingly.

The setting applies immediately when you click an option — no save button needed. It is saved per room.

Busy mode is **thread-scoped**: each thread is treated as an independent context. An agent can handle a message in thread B while still running in thread A — the busy mode for thread A does not block thread B.

### Model in Chat Bubbles

Each AI response shows a small model indicator at the bottom right of the bubble (e.g., `qwen3-coder:480b:cloud`), making it easy to track which model generated each reply. When an agent used a different model than the room's selected model — for example, because the room has no model set, or the harness can't run the room model — a **↪** icon appears on the model tag. Hover to see why (e.g., `not using the room model — using agent default`). Sub-agent responses running on a tier do not show this icon.

### Pinning a Room

Click the **pin icon** (thumbtack) on a room row in the sidebar to pin it. Pinned rooms appear at the top of the sidebar in a dedicated **Pinned** section, making them instantly accessible regardless of how many rooms you have.

You can pin up to **3 rooms** by default (configurable in Settings → max pinned rooms, up to 20). To unpin, click the pin icon again — the room returns to its position in the regular list.

Pinning is ideal for the rooms you use most frequently day-to-day.

### Archiving a Room

Click the **archive icon** on the room row in the sidebar to move a room to the archive. Archived rooms are hidden from the main room list but retain all messages and history.

To view archived rooms, switch to the **Archived** tab at the top of the sidebar. From there you can **restore** any room back to the active list or **delete** it permanently.

Archiving is useful for keeping your sidebar focused on active conversations without losing past discussions.

### Deleting a Room

**From archived list:** Swipe an archived room to the right to reveal two buttons — blue (restore) and red (delete). On desktop, hover to see restore and delete icons. You can also use the **delete all archived** button at the bottom of the list.

**From active list:** Swipe the room row to the right (drag with mouse on desktop, swipe with finger on mobile). A red **Archive** button appears. Archive first, then delete from the archived list.

Deletion is permanent — all messages in the room are removed and cannot be recovered. When a room is deleted, the server also sends a cleanup signal to each agent that was in the room — agents automatically delete the Claude session file (`.jsonl`) associated with that room from their local `~/.claude/projects/` directory, freeing disk space.

---

## Messaging

### Sending Messages

Type your message in the composer at the bottom of the chat. Press **Enter** to send (Shift+Enter for a new line).

The composer supports:

- **Formatting toolbar** — buttons for bold, italic, strikethrough, code, code block, lists, blockquote, and links. Markdown typed inline (e.g., `*bold*`, `` `code` ``) auto-renders in the composer
- **Code blocks** — triple backticks with optional language tag
- **Hyperlinks** — paste a URL and it auto-links
- **Emoji picker** — click the emoji button to browse and insert emoji
- **Image paste** — paste an image from your clipboard directly into the composer
- **Voice input** — click the microphone button to dictate messages using your browser's speech recognition. See the [browser setup guide](doc-browser-setup) for supported browsers and language settings
- **Slash commands** — type `/` to see available skills for the current room in an autocomplete popup

### Reply-to

Inside the **thread panel**, hover over any message and click the **reply arrow** to quote it. A quote preview appears above the composer; the reply displays the quoted message inline in the thread. Quote-reply is only available inside thread panels — not in the main feed.

Agents understand reply context — when you quote a specific message, its content is injected into the AI prompt so the agent knows exactly what you're referring to.

### Threads

The main feed uses a **Slack-style flat row layout** — each root message shows the sender's avatar on the left, their name and timestamp on the same line, and the message content below. AI agent replies do not appear in the main feed; they live inside thread panels.

When a root message has replies, a **thread chip** appears below it showing reply count, time of last reply, and a pulsing dot when an agent is actively streaming inside that thread.

Click any root message (or its thread chip) to open the **thread panel** on the right side of the screen. The root message is pinned at the top of the panel; all replies appear below it. If an AI agent starts streaming a reply, the panel **opens automatically** — but only if you don't currently have another thread open. Close the panel with the × button or press **Escape**.

The thread panel has its **own dedicated composer**, independent from the room composer — model selector, emoji picker, mention autocomplete (type `@` for the same popup as the room composer: navigate with arrow keys, confirm with Enter or Tab, dismiss with Escape), image attach, and slash commands are all available. Each composer has its own independent state: attachments, reply-to, and draft are not shared between the room and the thread. Drafts are saved per thread and restored when you reopen the panel.

**Thread sessions:** each thread maintains a separate Claude session. Opening an existing thread resumes its context; sending the first message in a new thread starts a fresh session for that agent.

**Permalinks:** every room, thread, and message has its own URL. `/r/<room>` opens a room, `/r/<room>/t/<thread>` opens a room with a thread, and adding `?m=<message-id>` scrolls to a specific message. Refreshing or sharing the URL reopens the same room and thread. The legacy `?thread=<message-id>` form still works.

**Mobile:** the thread panel opens as a fullscreen overlay. Swipe right to dismiss it.

**Header breadcrumb:** when a thread is open, the room header shows a breadcrumb (`› first few words…`). Clicking it scrolls the thread panel into view.

### Thread Broadcast

Thread messages can also appear in the room feed — without leaving their thread — in two cases:

**Automation match** — when a watch-reply (Slack or email) arrives in an existing Stoa thread and matches the trigger conditions of the automation watching that connection, the reply is rendered as a secondary row in the room feed. This works like Slack's "also send to channel": the message stays in its thread and is simultaneously visible in the feed. Automations with no conditions match every reply. For Slack automations, only rules with trigger event `message` are evaluated (not `reaction_added`). The row shows an **automation match** badge and a short preview of the root message. Clicking it opens the thread and highlights the reply.

**Agent error or limit** — when the main agent (not a sub-agent) inside a thread encounters an error, timeout, disconnect, server restart, or hits a rate / usage limit, the error message is also shown in the room feed with an **error** or **limit** badge. At most one broadcast per thread is shown every 10 minutes to avoid flooding the feed. Sub-agent errors are not broadcast.

Each broadcast row header always starts with a **From thread** badge, followed by a short preview of the root message and the reason badge (**automation match**, **error**, or **limit**). The **From thread** badge makes it immediately clear that the row originated in a thread, not from the room feed directly.

The broadcast row is not a duplicate record — it is the same thread message rendered in two places. Deleting the original message removes both.

### Message Actions

Hover over any message to reveal action buttons:

- **Copy** — copy the message content to clipboard
- **Copy link** — copy a direct URL to this message; pasting it in a browser opens Stoa with that room, thread, and message already focused. The **Copy link** button is available in the main feed, inside thread panels, and on **From thread** broadcast rows in automation cards.
- **Reply** — start a reply to that message
- **Delete** — delete the message permanently

On mobile, **long-press** a message to reveal the action buttons instead of hovering.

### Permalinks

Every room, thread, and message in Stoa has a stable URL:

- `/r/<room>` — opens a room
- `/r/<room>/t/<thread>` — opens a room and a specific thread
- `/r/<room>/t/<thread>?m=<message-id>` — opens a thread and scrolls to a message
- `/r/<room>?m=<message-id>` — opens a room and scrolls to a message in the feed

Use the **Copy link** button on any message to copy its permalink. The browser's **back / forward** buttons navigate between rooms and threads. If the room no longer exists, a **"this room isn't here"** notice appears. If the message was deleted, a **"Message not found"** toast shows and Stoa opens the room or thread anyway.

### Draft Saving

Unsent messages are automatically saved per room. When you switch rooms and come back, your draft is preserved. Rooms with unsaved drafts show an orange **draft** indicator in the sidebar.

### Process Trail

While an AI agent is working, you can see its tool calls (Read, Edit, Bash, etc.) displayed in real-time below the message bubble. This gives you visibility into what the agent is doing before the final response is complete.

### Enter to Send Toggle

The composer has an **Enter to send** toggle. When active (default on desktop), pressing Enter sends the message. When inactive (default on mobile), Enter inserts a new line instead — useful for composing multi-line messages without accidentally sending. Your preference is saved in the browser.

### Stopping a Response

While an AI agent is streaming a response, a **Stop** button appears. Click it to cancel the current generation. The message will show whatever content was streamed up to that point.

### Infinite Scroll

Only the most recent messages are loaded when you open a room. Scroll to the top to automatically load older messages.

---

## @Mentions and Multi-Agent Conversations

This is one of Stoa's most powerful features. When multiple AI agents are in a room, you can orchestrate complex multi-agent conversations.

### How @Mentions Work

1. **Human mentions an agent**: Type `@AgentName` in your message. That agent will respond first, followed by other agents in the room
2. **Agent mentions another agent**: An AI agent can mention another agent in its response (e.g., `@Kira`). The mentioned agent is automatically triggered to respond, creating a chain conversation
3. **No mention**: If you don't mention anyone, all agents in the room respond in random order

### Multi-Agent Flow Example

Imagine a room with three agents: **Idris** (code expert), **Kira** (researcher), and **Aria** (reviewer).

```
You:    @Idris implement the login page
Idris:  [writes the code] ... @Kira can you research best practices for session handling?
Kira:   [researches] ... Here's what I found. @Aria can you review Idris's implementation?
Aria:   [reviews the code and provides feedback]
```

Each mention automatically triggers the next agent. The conversation chains naturally without you having to prompt each agent separately.

### Turn Limits

The `MAX_AI_TURNS` setting (default: 5) controls how many agents can respond per human message. This prevents infinite loops when agents keep mentioning each other. You can adjust this in **Settings > Server**.

---

## Sub-Agents and Orchestration

Beyond @mentioning other agents in a room, a main agent can spawn its own **sub-agents** — ephemeral helpers that run a focused task in the background and report their result back. This lets one agent fan out work (research, probing, review) in parallel without you wiring up each step.

### Defining Sub-Agents

Sub-agents are defined per agent. Select the agent in **Settings > AI Agent**, then scroll to the **Sub-agents** card in the detail panel. Click **+ add sub-agent** and fill in:

- **Label** (required) — a short name like `probe` or `researcher`. It appears in chat as `Ara (probe)` so you always know which sub-agent produced a message.
- **Role** (optional) — a short title for the sub-agent (e.g. "Tech Lead"), up to 40 characters, single line. Existing sub-agents have no role until you add one. It appears in small text below the sub-agent's name on every chat message it sends (feed, thread, and while typing), in the sub-agent list in Settings, and in the sub-agent popover in the room header as `role · parent`. Changing the role takes effect immediately, including for past messages. It is also used in prompts: the main agent's delegation list shows `@label (tier, role) — description`, and the sub-agent itself receives `Your role: <role>`.
- **Description** (optional) — a short text (up to 500 characters) describing the sub-agent's purpose. Existing sub-agents have no description until you add one. It appears as a single line below the label in the sub-agent list (**Settings > AI Agent**) and in the **"<Agent>'s sub-agents"** popover in the room header; long text is truncated and the full text appears on hover. It is also used in prompts: the main agent's delegation list shows `@label (tier, role) — description` (role is omitted when not set) so it can pick the right sub-agent, and the sub-agent itself receives the description as its stated purpose ("Your Purpose").
- **Tier** — `quick`, `standard`, or `deep`. The tier selects which **model fallback chain** the sub-agent runs on (see [Model Tiers and Fallback](#model-tiers-and-fallback) below). By default `quick` runs a fast model, `standard` a balanced one, and `deep` the most capable — each falling back to a lighter model if the primary is unavailable.
- **Model override** (optional) — pin the sub-agent to a single specific model instead of using its tier's chain. Leave it on **use tier** to follow the tier routing. A pinned model has no fallback — it is tried alone. The dropdown fetches the model list from the server and stays in sync with the main agent dropdown — models such as Opus 5.5 appear automatically. Only models compatible with the sub-agent's effective harness are shown. Changing the **Harness** field while a specific model is selected resets the selection to **use tier** if that model is unavailable under the new harness. The server also rejects a model that does not match the sub-agent's effective harness at save time.
- **Workdir** (optional) — a working directory the sub-agent operates in.
- **System prompt** (optional) — extra instructions that shape the sub-agent's behavior.
- **Harness** (optional) — `claude` or `codex`. Leave on **inherit from parent** (default) to use the same harness as the parent agent.
- **Avatar** (optional) — each sub-agent has its own avatar: a hex color (`#RRGGBB`), a symbol (1–4 characters), or a custom image (upload or remove). Sub-agent messages in the feed and thread panels display the sub-agent's own avatar; if none is set, they fall back to the parent agent's avatar. The mention popup also shows each sub-agent's own avatar (with a small parent badge) and role. Messages already on screen reflect the new avatar after a page reload.
- **Memory** (optional) — each sub-agent has its own persistent memory (2,200-character budget), independent from the room memory. View or edit it directly in the sub-agent card.

You can edit or delete a definition anytime. Definitions belong to the parent agent, not to any specific room.

### Sub-Agent Memory and Self-Learning

Each sub-agent keeps its own **persistent memory** separate from the room memory. The budget is 2,200 characters and the content is visible and editable in the sub-agent card.

**Self-learning** is built in: after completing a task, a sub-agent automatically saves useful lessons to its own memory without being told to. Room memory is read-only for sub-agents — they can only write to their own memory.

Main agents can also update their own memory files (`MEMORY.md`, `USER.md`) automatically during a turn. An agent can only write to its own memory — never to another agent's.

### Linking Sub-Agents to a Room

A defined sub-agent must be linked to a room before it can be used there. Click the agent's seal in the room header to open **"<Agent>'s sub-agents"**, then toggle each sub-agent on or off for that room. Only linked sub-agents can be spawned in that room. Once linked, you can also address a sub-agent directly by @mentioning its label (e.g. `@probe`). Sub-agent @mentions appear highlighted in blue in the message feed (matching the style of agent mentions). The mention popup shows each sub-agent's own avatar alongside a small parent badge, plus the sub-agent's role when one is set. A @mention written inside inline code (backticks) or a code fence (` ``` ` or `~~~`) is never treated as a trigger — the message content is unchanged, only trigger detection skips it. An unclosed fence or backtick has no suppressing effect; any mention after it still triggers normally.

### How Orchestration Works

When the main agent responds, it can trigger its linked sub-agents to handle sub-tasks:

1. **Fire-and-forget** — each sub-agent runs its task independently, so the main agent's turn is never blocked waiting for them.
2. **Auto-wake** — when a sub-agent finishes, the main agent is automatically woken to read the result and synthesize a follow-up. This applies when the sub-agent was triggered by the parent — via a mention in the parent's response, a wake cascade, or an API spawn. The wake survives a server restart (queued durably). If a human or automation @mentions a sub-agent directly (without also mentioning the parent in the same message), the parent is **not** woken when that sub-agent finishes — unless the sub-agent finishes with an error. When the parent wakes, the sub-agent's result (including any failure notes and cost summary) is delivered as a task in the parent's input — it is not added as a chat message in the feed.
3. **One level deep** — a sub-agent can never spawn its own sub-agents. Orchestration is strictly one level, which prevents runaway trees.
4. **Wake cascade** — when the main agent synthesizes a sub-agent result, any @mentions in its response automatically trigger the mentioned agents or sub-agents. This enables orchestration loops: for example, a research sub-agent finishes → the main agent reads its result and @mentions a reviewer → the reviewer runs → the main agent reads the review and @mentions a fixer → and so on. A depth limit (default 5 hops) prevents infinite chains.

### Model Tiers and Fallback

Each tier (`quick`, `standard`, `deep`) resolves to an **ordered list of models** — the first is the primary, and the rest are tried in order if the primary is temporarily unavailable (rate limited, overloaded, or timing out). This keeps a sub-agent working through a transient model outage instead of failing outright.

Resolution follows a clear precedence:

1. **Sub-agent model override** — if the sub-agent pins a specific model, that model is used (no fallback).
2. **Room tier override** — otherwise the room's configured chain for that tier is used.
3. **Server defaults** — if the room has no override, built-in defaults apply: `quick → haiku`, `standard → sonnet → haiku`, `deep → opus → sonnet`.

For **Codex**, all three tiers resolve to the same default model reported by the agent — per-tier model routing only applies to Claude.

To customize the chains for a room, open the room settings (the **gear** icon in the room header) and use the **Model tiers** card. It starts on server defaults; click **override for this room** to edit each tier's chain — reorder models (the first is primary), add a fallback, or remove one. **Reset to server defaults** clears the override. A pinned sub-agent model always wins over the room chain.

> Fallback moves through the chain only on model-scoped failures (rate limit, overload, timeout). Authentication or quota errors are handled by the existing key-rotation path instead.

### Run Controls

When sub-agents are running, the room header shows a **"N running"** pill. Click it to open a popover that lists each active run with its elapsed time. From there you can:

- **Stop** an individual run — finalizes that sub-agent's message immediately.
- **Pause spawns** — blocks any new sub-agent from starting; runs already in flight finish normally. A **"spawns paused"** pill appears in the header while paused. Toggle it off to resume.

### Budget and Rate Limits

Each room caps orchestration to keep it predictable:

- **Max concurrent sub-agents** (default: 3) — how many sub-agents can run at once in the room.
- **Max spawns per hour** (default: 10) — a rolling rate limit on new spawns.

Configure these in the room settings (the **gear** icon in the room header), under the **Sub-agent budget** card. The same card has a **pause new spawns** toggle — the panel counterpart of the header's pause pill. Changes take effect when you click **save**.

### Cost and Result Visibility

Every completed agent reply carries a quiet **result chip** under the bubble showing how the run ended and what it cost:

- **Exit reason** — `✓ completed`, `⏹ stopped` (cancelled), or `⚠ timeout` / `⚠ error` (the last two are highlighted).
- **Tokens** — total input + output tokens for the turn (e.g. `1.3k tok`).
- **Duration** — wall-clock time (e.g. `47s` or `2m 10s`).

For sub-agents, the spend is **attributed to the specific sub-agent** in the usage log, so per-sub-agent cost is tracked separately from the parent agent's own turns.

When an orchestrator has run **two or more sub-agents** in a room, its next synthesis turn receives a compact **cost rollup** (runs, total tokens, wall time, and per-sub-agent breakdown). The orchestrator uses this to close a multi-spawn pipeline with a brief run summary in its reply. A single spawn does not trigger a summary.

### Cross-Machine Sub-Agents

Sub-agents always run on the **same machine** as their parent agent. The server routes each trigger to the parent's WebSocket connection — it never transfers work to a different machine.

- **Offline detection** — if the parent agent's machine is disconnected when a sub-agent trigger arrives, the server returns a `503 parent_offline` error immediately (instead of silently accepting). The chat also shows a highlighted error event so the user knows the agent is unreachable.
- **Working directory validation** — the agent validates that the configured working directory exists on the local filesystem before spawning the sub-agent process. If the path is missing (stale config, wrong machine, deleted folder), it reports an error result back to the room instead of crashing.

### Scheduled Sub-Agents (Proactive Triggers)

A persistent sub-agent linked to a room can run automatically on a schedule — no @mention and no orchestrator needed. This is useful for recurring checks (for example, a `probe` that inspects disk usage every 30 minutes) or a fixed-time daily report.

Schedules are managed in **Room Settings > Scheduled Triggers**. Click **+ add schedule** and choose a linked sub-agent, a schedule type (interval or daily), the cadence or time, and a task. Each schedule can be toggled on/off, edited, or deleted from its row. When a run fires, the configured task is delivered directly to the sub-agent's input — it does not appear as a chat message in the room.

A schedule takes one of two shapes:

- **Interval** — run every N minutes (minimum 5).
- **Daily** — run once a day at a fixed wall-clock time (`HH:MM`) in a chosen timezone.

Each scheduled run reuses the same path as a manual trigger, so it honors every safeguard: the room must not be archived or have spawns paused, the concurrent sub-agent cap still applies, and the parent agent's machine must be online. If a run can't fire because of a **transient** condition — the parent's machine is briefly offline, or the concurrency cap is momentarily full — it is retried shortly, up until its next scheduled occurrence. This means a **daily** schedule isn't lost for the whole day just because the machine happened to be offline at that exact minute; it fires as soon as the machine is back, then resumes its normal time the next day. After server downtime (for example, a restart), missed slots are **not** replayed in a burst — each schedule runs at most once going forward, not once for every slot it missed. A scheduled sub-agent still cannot spawn its own sub-agents.

---

## File and Image Sharing

### Uploading Files

Click the **attachment button** (paperclip icon) in the composer, or **drag and drop** files directly onto the chat area.

You can attach **multiple files** in a single message — images and documents together. Supported types include images (PNG, JPG, WebP, GIF), text files (Markdown, TXT, JSON, CSV), PDFs, and more.

### Image Compression

Images are automatically compressed on the client side before upload to save storage and bandwidth:

- Images over 200KB are compressed using **WebP format** at 80% quality, max 1920px dimension

This is similar to how WhatsApp handles image sharing — images stay readable while being significantly smaller.

### Image Carousel

When a message has multiple images, they display in a horizontal **carousel** that you can:

- **Swipe** left/right on mobile (touch)
- **Click and drag** on desktop (mouse)
- Scroll naturally — images display at their natural aspect ratio, multiple visible at once

Click any image to open it in a **lightbox** for full-size viewing.

### AI Agents and Files

When you send files to a room:

- Agents automatically **download all attachments** to a local `.stoa-attachments/` folder in their working directory
- Agents can **read** any attached file using their local filesystem via Claude Code's Read tool
- Temp files are **automatically cleaned up** between triggers

Agents can also **send files** to you. When an agent includes `[send:path/to/file]` in its response, the file is automatically uploaded and displayed inline in the chat.

---

## Search

### Global Search

The **search bar** in the sidebar lets you search across all messages in all rooms.

- Powered by SQLite FTS5 (full-text search)
- Results show **highlighted snippets** with matching terms
- Click a result to navigate directly to that message in its room
- Search is instant — works across thousands of messages

### In-Room Search

Press **Ctrl+F** (or click the **search icon** in the room header) to search within the current room. A search bar appears at the top of the chat area.

- Results are displayed as a **scrollable list** of matching messages
- Each result shows a snippet with the matching term highlighted
- Click any result to **jump directly** to that message in the conversation — older messages are loaded automatically if needed
- Press **Escape** or click the close button to dismiss the search bar

---

## Agent Management

### Adding a New Agent

Go to **Settings > AI Agent** and click **+ new agent** in the sidebar. The detail panel switches to an Add Agent view where you can configure:

- **Name** (optional) — a display name for the agent (e.g. `Idris`). If left blank, a random name is assigned.
- **Language** — select the language the AI agent will use for responses: English, Bahasa Indonesia, 日本語, 한국어, or 中文

Click **Generate command** to create a one-time install token. The install commands appear below — each command includes a `?token=` parameter that is valid for **10 minutes** and can only be used once. Click **Regenerate** if the token expires.

Run the command for your platform on the machine where you want the agent to live:

**Linux / macOS:**
```bash
curl -fsSL http://YOUR_SERVER:3000/install.sh?token=<TOKEN> | bash
```

**Windows (PowerShell):**
```powershell
irm http://YOUR_SERVER:3000/install.ps1?token=<TOKEN> | iex
```

**Windows (CMD):**
```cmd
curl -fsSL "http://YOUR_SERVER:3000/install.cmd?token=<TOKEN>" -o install.cmd && install.cmd
```

The install script:
1. Downloads the client files
2. Installs dependencies (ws)
3. Registers the agent with a unique name and secret
4. Approves Claude Code workspace trust
5. Sets up PM2 for auto-restart and persistence

> **Note:** Install commands without a valid token are rejected. Always generate a fresh command from **Settings > AI Agent** before installing.

### Renaming an Agent

Select the agent in **Settings > AI Agent**, then click the agent's name in the detail header to edit it inline.

### Changing Agent Language

Each agent's response language can be changed after creation. Select the agent in **Settings > AI Agent**, then change the language in the agent card. Available languages: English, Bahasa Indonesia, 日本語, 한국어, 中文. The change takes effect immediately on the next message.

### Agent System Prompt

Each agent has its own **System Prompt** configured in **Settings > AI Agent → System Prompt** tab. This prompt is layered between the base system prompt and the room system prompt — it is sent to the agent in every room it participates in. Use it to define the agent's identity, persona, working language, and any standing rules.

Sub-agents do **not** inherit the parent agent's system prompt. Each sub-agent has its own system prompt field, so their identities stay independent.

### Agent Harness

By default, agents run on the **Claude CLI**. If the agent's machine also has **Codex CLI** installed and logged in (via `codex login`), you can switch harnesses in **Settings > AI Agent → Agent card → Harness** dropdown.

- **Claude** — Claude Code CLI. Supports compact, streaming, and resume.
- **Codex** — OpenAI Codex CLI. Requires `codex` CLI installed and authenticated on the agent's machine. Codex sessions use `danger-full-access` sandbox by default and ignore user Codex config files (`--ignore-user-config`). **Compact is not supported** — clicking compact on a Codex session shows a toast error (`compact not supported for codex harness`); auto-compact also skips Codex sessions silently. `codex-session.js` is distributed via Stoa's auto-update — the agent downloads it when the server is updated, regardless of which harness is selected. If the Codex harness is triggered before `codex-session.js` is present on the agent machine, the trigger fails with a clear error; wait for auto-update to complete (~2 minutes after server update).

Changing an agent's harness in a **mixed room** (where other AI agents can still run the current room model) leaves the room model untouched — this agent falls back to its own default instead. A toast confirms: e.g., `room model kept in 2 mixed rooms (Kira uses codex-default)`. If no other AI in the room can run the current room model, the room model is rewritten to the new harness's default. If the agent's **Default model** is incompatible with the new harness, it is automatically reset — the toast shows `default model reset (old-model)`.

Sub-agents can also choose their own harness, or leave it on **inherit from parent** (the default).

**Checking harness availability:** After installing or logging in to a CLI tool on the agent's machine, click the **Check** button next to the Harness dropdown (in the agent detail panel or accordion in **Settings > AI Agent**) to re-detect without restarting the agent. The button is disabled when the agent is offline, and detection can take up to ~15 seconds. The dropdown updates immediately when results arrive — new harnesses detected show a toast notification. Rescan also re-checks harnesses alongside working directories and skills.

**Restarting to apply CLI updates:** After updating a CLI tool on the agent's machine, click the **power icon** (**Restart agent**) in the agent header, between force update and remove. A confirmation bar appears at the top of the page — confirm to restart immediately; all of the agent's running processes stop at that point. Conversations resume from where they left off via session resume. The icon is only enabled when the agent is online and managed by PM2; agents started manually, under systemd, or launchd are not supported (a restart outside PM2 would stop the agent permanently). While a restart is in progress, the icon turns amber and pulses; hover it to see **restarting…**, then a toast confirms the agent is back. Check does not restart the agent.

For **Codex**, the model list is synced automatically every time an agent connects — no manual Check needed. The active set is the union across all online agents, so two agents on different Codex versions keep each other's models active; a model is deactivated only when no online agent reports it. Check also triggers this sync on demand. Hidden models are filtered out, results are sorted by CLI priority, and if no default exists the reporter's first model becomes the default. The room model dropdown updates immediately. If new models are found, a toast shows e.g. `Codex CLI: 2 new models`. If the agent cannot report models (older CLI version or command failure), Stoa falls back to its built-in model list. **Claude** has no equivalent sync — its model list always comes from Stoa's built-in list plus any custom entries added in **Settings > Platforms**.

Harnesses that are installed but not logged in appear in the dropdown as **"(not logged in)"** and cannot be selected — the server will also reject them. If login status cannot be determined, the harness remains selectable. If the currently active harness becomes unavailable or loses login, a red hint appears below the Harness dropdown — the harness is not automatically changed.

**Errors:** `agent offline` — the agent is not connected; `agent disconnected` — the agent disconnected mid-check; `agent did not respond — agent version may be too old, wait for auto-update` — the agent does not support harness detection yet (older version).

### Agent Default Model

Each agent has a **Default model** setting in **Settings > AI Agent → Agent card → Default model** dropdown. This is the model the agent falls back to when the room's selected model is not compatible with its harness.

The dropdown lists only models compatible with the agent's current harness. The first option — **"follow harness default — \<model\>"** (value: none) — tells the agent to use its harness's built-in default rather than a pinned model.

**Resolution order** when the server picks a model for an agent:

1. **Room model** — if the agent's harness can run it, this is used.
2. **Agent default model** — if one is set and compatible with the harness.
3. **Harness default** — the harness's built-in default (e.g., first model from `codex debug models`).
4. **CLI default** — the agent runs without a `-m` flag, letting the CLI decide.

Platform model config (base URL, API keys) is only passed when the room model is used directly. If the agent falls back to any other source, platform config is not sent.

Sub-agents with a tier use a separate resolution path — see [Model Tiers and Fallback](#model-tiers-and-fallback).

### Removing an Agent

Select the agent in **Settings > AI Agent**, then click the **remove** button in the detail header. Confirm the deletion in the popup. The agent is unregistered and removed from all rooms.

### Agent Online Status

Green dots next to agent names in the sidebar and room header indicate online status. The sidebar footer also shows your WebSocket connection status.

### Agent Self-Healing

Agents automatically:
- **Reconnect** if the WebSocket connection drops (exponential backoff)
- **Recover** from Claude CLI crashes
- **Auto-update** when server-side client files change (checks every 2 minutes and once on startup before going online, restarts via PM2). A running task delays the restart until it finishes; if it stops making progress for 3 minutes, the agent restarts anyway so it cannot stay stuck on an old version

### Agent Re-authentication

If an agent's Claude credentials expire, it will reply with "Not logged in · Please run `/reauth`". You can re-authenticate the agent remotely from Stoa without touching the agent's machine:

1. In a room with **exactly one AI agent**, type `/reauth`
2. A clickable link appears in chat — open it on any device and authorize with your Anthropic account
3. After authorizing, the browser shows a code — paste it in chat as `REAUTH:<code>`
4. A confirmation bubble appears and the agent resumes normally

To sign out the agent's Claude account (e.g., to switch accounts or test the re-auth flow), type `/logout` in the same single-agent room.

> Both commands are restricted to rooms with exactly one AI agent, because Claude credentials are machine-global — re-authenticating affects all agents on that machine.

### Working Directories

Each agent has one or more **working directories** — these are the folders where the agent's Claude session runs. You can:

- View an agent's workdirs in **Settings > AI Agent** by selecting the agent (shown in the Workdirs card)
- Add new workdirs via the UI or API
- Assign a specific workdir to a room when creating it

**CLAUDE.md auto-import:** when an agent connects to a room, Stoa checks if the workdir contains a `CLAUDE.md` file that is not git-tracked. If found, the file content is automatically imported as the room's **system prompt** — providing the agent with project context from the first message. If the CLAUDE.md is git-tracked (committed to the repo), it is left untouched and not imported. With multiple workdirs in a room, contents from each are combined under per-source headers. A system event is posted to the room when an import occurs.

### Client Versioning

Each agent reports its **client version** (e.g., `v0.2.2`) to the server. You can see the version in the agent's sidebar row in **Settings > AI Agent**. This helps track which agents are running the latest client code.

### Agent Controls

Select an agent in **Settings > AI Agent** to see action buttons in the detail header:

- **Rescan** — re-scan the agent's working directories, skills, and harness availability
- **Force Update** — force the agent to check for client updates immediately (normally checks every 2 minutes)
- **Remove** — unregister the agent (with confirmation)

**Compact Session** — compress the agent's conversation history to reduce context size. Open the thread panel and click the compact button (↕ icon) in the panel header. A progress bar appears inside the thread panel while compacting — the agent summarizes prior context and continues seamlessly. Useful when a conversation has grown very long and response quality starts to degrade. Compact is not supported for Codex harness sessions — clicking compact shows a toast error (`compact not supported for codex harness`).

### Auto-Compact

Stoa automatically compacts agent sessions without manual intervention. Two mechanisms run in parallel:

- **Per-trigger check** — after every agent response, Stoa checks the session file size. If it exceeds the configured compact threshold (default 500 KB, adjustable in Settings → Server), the agent runs `/compact` immediately after sending its reply, then notifies the server. The user receives the response first; compaction happens in the background.
- **Background worker** — every 60 minutes, the agent scans all open sessions on its machine and compacts any that exceed the configured compact threshold. This also cleans up sessions that are open locally but not active in any Stoa room.

When auto-compact runs, a compact progress bar appears in the thread panel (same as manual compact) and a compact marker is saved in the thread's message history. The marker persists across page refreshes.

Both mechanisms skip sessions running on the Codex harness — Codex does not support compact.

### Proactive Messages

Agents can send messages to a room on their own initiative — without being triggered by a human message. This is useful for background tasks that complete asynchronously (e.g., a long build finishing, a scheduled check, a monitoring alert).

The helper function is available inside every agent's Claude Code environment:

```javascript
await sendProactiveMessage(roomId, 'Build complete — 0 errors, 3 warnings.');
```

- `roomId` is automatically injected into the agent's prompt on every trigger (see [Architecture Overview](#architecture-overview)), so the agent always knows which room to post to
- The message is authenticated with the agent's secret — only registered agents can call this endpoint
- The message appears in the room chat just like a normal agent response

**API endpoint** (for external scripts or custom integrations):

```
POST /api/rooms/:roomId/message
Headers:
  X-Agent-Id: <agent numeric ID>
  X-Agent-Secret: <agent secret>
Body: { "content": "your message here" }
```

### Agent Skills

Skills are slash commands available in an agent's Claude Code environment (e.g., `/stoa-audit`, `/deploy`). They're auto-detected from the agent's workdir and displayed in the settings panel.

Skills are **scoped by working directory** — when you create a room with a specific workdir, only skills from that workdir (project/local scope) plus global skills are available. This prevents skill collisions across different projects.

You can invoke a skill in chat by typing the slash command directly:
```
/skill-name
```

---

## Invite Suggestions

AI agents can **suggest inviting** other agents into a room. When an agent thinks another agent's expertise would be helpful, it sends an invite suggestion that appears as a notification in the chat. You can **approve** or **reject** the suggestion.

---

## Push Notifications

Stoa supports browser **push notifications** so you get alerted when agents respond, even when the tab is in the background.

- Toggle notifications on/off in **Settings > General > Notifications**

---

## Sidebar Collapse

Click the **double-chevron button** (‹‹) next to the Stoa logo to hide the room list sidebar, giving more space for the chat and workspace panel. To restore the sidebar, click the **panel icon** that appears in the chat header (or in the empty state).

---

## Workspace Panel

The workspace panel is a code viewer and file browser that appears to the right of the chat. It lets you browse, read, and preview files on the AI agent's machine — including remote servers.

### Opening the Panel

Click the **panel toggle button** (split-pane icon) in the chat header. The panel opens to the right with a resizable drag handle.

### File Tree (Files Tab)

The **Files** tab shows the project directory tree for the room's working directory. Click any file to open it. Folders expand/collapse on click.

### Code Viewer

Text files open with **syntax highlighting** (powered by highlight.js), **line numbers**, and a dark code background. The breadcrumb at the top shows the file path.

### File Editing

Click the **Edit** button on any text file to enter edit mode. The editor uses **CodeMirror 6** with syntax highlighting for JavaScript, TypeScript, Python, JSON, HTML, CSS, and Markdown.

- **Save**: Press `Ctrl+S` (or `Cmd+S`) or click the Save button
- **Expand**: Click the expand button to use the editor full-width (hides the chat panel)
- **Conflict detection**: If the file changes on disk while you're editing, a dialog lets you choose to reload or overwrite
- **Auto-save drafts**: Unsaved edits are saved to browser storage. If you close and re-open the file, a recovery prompt appears
- **Keyboard shortcuts**: `Ctrl+/` (toggle comment), `Ctrl+Shift+D` (duplicate line), `Alt+Shift+Up/Down` (copy line), `Tab` (indent)

If CodeMirror fails to load (e.g., no internet for CDN), the editor falls back to a plain textarea.

### File Operations (Context Menu)

Right-click any file or folder in the Files tab to open the context menu:

- **New File** — create a new file in the selected folder
- **New Folder** — create a new directory
- **Rename** — rename the file or folder
- **Delete** — remove the file (with confirmation dialog)

On tablets, long-press to open the context menu.

### Markdown Preview

`.md` files render as formatted markdown with headings, lists, code blocks, tables, and links.

### Image Preview

Image files (PNG, JPG, GIF, WebP, SVG) display as a centered preview. For remote agents, images are fetched via the agent's WebSocket connection.

### Git Diff (Git Tab)

The **Git** tab shows uncommitted changes (`git diff`) with green/red line highlighting, file headers, and change statistics.

### Clickable File Paths

When an AI agent mentions a file path in a message (e.g., `/home/user/project/file.py`), the path becomes **clickable** — click it to open the file in the workspace panel. This works for paths inside backtick code blocks and code fences.

### Download Files

Hover over any file in the file tree to reveal a **download button** (arrow icon). Click it to download the file to your local device. This works for both local and remote agent files — remote files are fetched via WebSocket and delivered as a browser download.

### Remote File Browsing

The workspace works with both local and remote agents. For remote agents, file operations are proxied through the agent's WebSocket connection — you can browse files on any machine the agent runs on, from any device (including tablets and phones).

---

## Agents Panel

The **Agents panel** is a right sidebar popover for viewing and managing room participants and sub-agents. Click the **users icon** in the right sidebar (between the Workspace button and the divider) to open it.

### Participants

Lists all agents currently in the room — each row shows the agent's avatar, name, type (AI or human), and live **online / offline status**.

To add a new agent, use the **Add Agent** form at the bottom of the section: pick an available agent from the dropdown, select its **working directory**, and click **Add Agent**. Only agents not already in the room are listed.

### Sub-Agents

Shows two groups:

- **Linked** — sub-agents already linked to this room. Each row shows the label and parent agent name. Click **Unlink** to remove the link.
- **Available** — sub-agents defined on any room agent but not yet linked. Click **Link** to activate them for this room.

> This is an alternative to clicking the agent's seal in the room header — both manage the same sub-agent links.

---

## Export Conversation

You can export a room's full conversation history as **JSON** or **CSV**. Click the **export button** in the chat header and select the format. The download includes all messages, timestamps, and participant names.

---

## Automation

Stoa supports **automations triggered by Slack, WhatsApp, and Email** — rules that fire when an incoming event matches your conditions and automatically send a prompt to a target room.

### Managing Connections

Go to **Settings > Automation > Connections** to manage your connections. Each connection is a separate live session with its own credentials.

Click **+ add connection** to add a new connection. First select the **Provider**:

**Slack connection:**
- **Name** — a label for this connection (e.g., "Qiscus Workspace")
- **Token Type** — `bot` (Bot Token `xoxb-...`) or `user` (User Token `xoxp-...`)
- **App Token** (`xapp-1-...`) — for the Socket Mode WebSocket connection
- **Bot / User Token** — the token that receives events and makes API calls

See the [Slack setup guide](doc-slack-setup) for step-by-step instructions on creating Slack app tokens.

**WhatsApp connection:**
- **Name** — a label for this connection (e.g., "Support WA")
- **Phone Number** — optional, for reference only
- **Max Media Size (MB)** — maximum size for downloaded media files (default 100 MB)

Clicking **Connect & Show QR** starts the WhatsApp session and opens a QR code modal. Scan the QR with your WhatsApp app to authenticate. Once connected, the card shows the connected phone JID and a green dot. Use **Show QR** to display a new QR code if the session expires.

**Email (IMAP) connection:**
- **Name** — a label for this connection (e.g., "Gmail Personal")
- **Preset** — **Gmail** (preconfigures `imap.gmail.com:993`) or **Custom IMAP** (any IMAP server)
- **IMAP Host / Port** — shown only for Custom IMAP; enter your server address and port
- **Email address** — the account username (e.g., `you@gmail.com`)
- **App Password** — for Gmail, you must use an App Password (not your regular password). Go to your Google Account → Security → 2-Step Verification → App passwords. Google requires 2-Step Verification to be enabled. For other providers, use the account password or an IMAP-specific password.
- **Folder** — mailbox folder to monitor (default: `INBOX`)
- **Allowed senders** — one email address or domain wildcard per line (e.g., `boss@example.com`, `*@company.com`). **At least one entry is required** — connections with no allowed senders will not trigger automations (default deny). Anyone can send an email to your inbox, and email content could attempt to manipulate the agent (prompt injection).
- **Require sender verification** — when enabled (default on), emails that fail DMARC or DKIM verification are silently dropped. This prevents spoofed `From` addresses from bypassing the allowlist.
- **Sender name** *(optional)* — the display name shown in the `From` header of outgoing replies (e.g., `Support Team`). If left empty, the replying agent's name is used as fallback. The sending address is always the Gmail account — only the display name changes.

  > **Tip:** Setting a recognizable name (e.g., the account owner's name) helps recipients identify the sender and can improve email deliverability.

Email connections use **IMAP IDLE** for real-time delivery — entirely outbound from your server to the mail provider, so no public endpoint or firewall rule is needed. Works seamlessly behind Tailscale.

Incoming email triggers automation rules. Agents can also **reply** to those emails using the API (see [Replying to Emails](#replying-to-emails) below).

> **Outlook / Microsoft 365:** Not supported in this version — Microsoft has disabled basic IMAP authentication. OAuth2 support is planned for a future release.

**Test connection:** Click **Test connection** before saving to verify credentials and connectivity. In edit mode, leave the password field empty to use the stored (encrypted) password — the stored password is never shown after initial setup.

**Password storage:** The password is stored encrypted on the server and is never returned via the API.

Each connection card shows its status: **connecting**, **connected**, **disconnected**, or **error**. Use the **reconnect** button to retry, or the **edit** and **delete** buttons to manage it.

### Creating an Automation Rule

Once at least one connection is active, click **+ new rule** to create a rule:

- **Name** — a descriptive label for the rule
- **Connection** — which connection triggers this rule, or **Any connection** to match events from all connections
- **Trigger event** — the event that fires the rule (options depend on provider):
  - *Slack:* `message`, `message.groups`, `mention`, `reaction_added`
  - *WhatsApp:* `message` (direct message), `group_message` (group message), `group_mention` (bot tagged in group), `message_any` (DM + group)
  - *Email:* `message` (New email received)
- **Conditions** — optional filters applied to the event: `contains`, `not_contains`, `starts_with`, or `matches_regex`. Multiple conditions are AND-ed together. `matches_regex` limitations: pattern max 200 characters, nested quantifiers rejected (ReDoS protection), input capped at 5,000 characters, patterns that cause excessive backtracking are rejected at save time with a 400 error. Condition fields vary by provider:
  - *Slack:* `message text`, `full text`, `slack_user`, `slack_channel`, `slack_bot_id`
  - *WhatsApp:* `message text`, `sender JID`, `chat ID`
  - *Email:* `from address`, `subject`, `has attachments`
- **Target room** — which Stoa room receives the triggered message
- **Prompt template** — the message sent to the room. Use variables:
  - *Slack:* `{{slack_message_text}}`, `{{slack_message_link}}`, `{{slack_user}}`, `{{slack_channel}}`, `{{extracted_url}}`, `{{slack_thread_ts}}`
  - *WhatsApp:* `{{wa_message_text}}`, `{{wa_sender}}`, `{{wa_sender_name}}`, `{{wa_chat_id}}`, `{{extracted_url}}`
  - *Email:* `{{email.from}}`, `{{email.from_name}}`, `{{email.subject}}`, `{{email.body}}`, `{{email.date}}`, `{{email.has_attachments}}`

  > **Security note (Email):** `{{email.body}}` is untrusted data. A crafted email could attempt to manipulate the agent. Consider wrapping it in a delimiter in your prompt to make clear it is data, not instructions.
- **Reply to WhatsApp** *(WhatsApp connections only)* — when enabled, the server injects a WhatsApp context block into the prompt with sender info, chat ID, and instructions for the agent. The agent can reply to WhatsApp using the `[wa:reply]` marker in its output:

  ```
  [wa:reply]Your reply message here[/wa:reply]
  ```

  The server intercepts the marker, sends the text to the WhatsApp sender, strips the marker from the room message, and logs the outgoing message. If the agent does not use the marker, the server falls back to sending the entire AI response as before.

  The context block also tells the agent about the **message history API** — the agent can read recent chat history via:

  ```
  curl <base_url>/api/automations/connections/<connId>/messages?chatId=<chatId>&limit=20
  ```

  Use the room's CLAUDE.md to instruct the agent when to read history and how to respond.

- **Watch Replies** *(Slack and Email connections)* — when enabled, follow-up messages in the same conversation thread are routed into the existing Stoa thread instead of opening a new one.

  *Slack:* Thread replies posted in the Slack thread that triggered this automation are forwarded to the same Stoa thread. Each reply arrives with the format:

  ```
  [New Reply on Thread]: sender_name (sender_id) - message text
  ```

  If another automation rule fires on the same Slack thread, its message is also added to the existing Stoa thread.

  *Email:* Incoming emails whose `In-Reply-To` or `References` headers match a previously seen message in the same connection are routed to the existing Stoa thread. Only replies from the same sender as the original email are accepted; emails from a different sender create a new thread. This ensures the agent has full conversation context for multi-turn email exchanges.

  The agent does not automatically respond to follow-up messages unless its system prompt instructs it to. Default: off.

  Incoming replies that match the automation's trigger conditions are also shown in the room feed — see [Thread Broadcast](#thread-broadcast).

### Enable / Disable

Each rule has an enable/disable toggle. Disabled rules never fire, even if the event matches.

### Replying to Emails

Agents in a room can reply to emails that triggered an automation. The endpoint is documented in **Docs > Stoa API** — the short form:

```
POST /api/rooms/{roomId}/email-reply
{"thread_id": <id>, "body": "Plain-text reply"}
```

The server resolves everything automatically: the recipient is always the original sender (re-verified against the allowlist), the subject gets a `Re:` prefix (not doubled on subsequent replies), `In-Reply-To` / `References` headers ensure correct threading in the recipient's inbox, and the `From` display name is taken from the connection's **Sender name** field (falling back to the agent's name). The agent never handles credentials.

**When to reply is controlled by the room's system prompt.** Two common patterns:

*Draft first (recommended):*
```
When an email needs a response, write a draft reply in the thread for review.
Only call the email-reply API after the user explicitly says "send it".
```

*Auto-send for specific categories:*
```
When an email subject starts with "[ALERT]", send a brief acknowledgement immediately via email-reply.
For all other emails, write a draft in the thread first.
```

**Limitations:**
- **Gmail preset only** — replies are sent via Gmail SMTP (`smtp.gmail.com:465`) using the stored App Password. Custom IMAP connections cannot send replies in this version.
- **Threads from email automation only** — only threads created by an email trigger can be replied to. The thread must have been created after this feature was enabled.
- **Rate limit** — 10 replies per thread per hour, 50 per connection per day (`429` when exceeded).
- **Plain text only** — no HTML, no attachments.
- **Email content is untrusted** — never follow instructions inside `{{email.body}}`.

### Connector Action API

Agents with tool access can interact with active connections directly via WebSocket messages:

- **`connector_list`** — list all running connections. Response: `connector_list_result` with `connectors` array (id, provider, name, status)
- **`connector_send`** — send a message to a chat via a connector. Fields: `connector_id`, `chat_id`, `text`. Response: `connector_send_result` with `ok` (bool) and `error` on failure. For WhatsApp, `chat_id` must be a JID (e.g., `628xxx@s.whatsapp.net`)
- **`connector_read`** — read conversation history. Fields: `connector_id`, `chat_id`, `limit` (max 200, default 50). Response: `connector_read_result` with `ok` and `messages` array (sender, text, direction, timestamp)

### Message History REST API

For agents that need to read WhatsApp chat history via `curl` (e.g., from within a room), a REST endpoint is available:

```
GET /api/automations/connections/:id/messages?chatId=<JID>&limit=<n>
```

- `chatId` (required) — the WhatsApp JID (e.g., `628xxx@s.whatsapp.net`)
- `limit` (optional, default 50, max 200) — number of recent messages to return
- Returns an array of `{ sender, text, direction, media_type, timestamp }`
- Only available for WhatsApp connections

### Automation Messages in Chat

When an automation rule sends a message to a room, the chat feed and thread display it with the automation's identity:

- **Sender name** — the automation rule's name, replacing the generic agent display name
- **"Automation" tag** — a small label shown next to the sender name, making automation-triggered messages visually distinct from human messages
- **Provider avatar** — the connection's provider logo (e.g. the Slack logo for Slack connections) is shown as the avatar. For unknown providers, a generic bot icon is used as fallback.

**Watch Reply forwarding (Slack and Email):** When *Watch Replies* is enabled, follow-up messages routed to an existing Stoa thread inherit the identity of the automation that triggered the original thread. For Slack, these are shown as `[New Reply on Thread]: ...`. If the root message predates this feature and has no automation metadata, the reply falls back to displaying as "Slack" (or "Email") with the provider logo — not as a human message.

**Deleted automations:** If an automation rule is deleted after it has sent messages, those messages retain their sender name and provider logo as a snapshot. The rule's name and provider are stored on each message, so deleting the rule does not affect historical display.

Only messages sent *after* this feature was introduced carry automation identity. Earlier automation messages continue to display as they did before.

---

## Settings

Stoa uses a **vertical sidebar nav** on the far left of the app. The sidebar is icon-only (44 px wide) and slides open to 200 px on hover, revealing text labels. Click any icon to switch sections. On mobile (narrow screen) the sidebar is hidden — use the in-app navigation instead.

Nav items, top to bottom: **Inbox** (your rooms list), then a separator, followed by the settings sections: **AI Agent**, **Server**, **General**, **Themes**, **Docs**, **Platforms**, **Automation**, **Usage**, **Doctor**.

### AI Agent

A two-panel layout for managing all your AI agents. The left sidebar shows a searchable list of agents grouped by online/offline status, with a **+ new agent** button at the top. Click any agent to see its detail panel on the right.

The detail panel includes:

- **Header** — agent avatar (click to change), name (click to rename inline), online/offline status, and action buttons (rescan, force update, remove)
- **Agent card** — backend type, language selector, name field, platform selector, harness selector, and the install command for reinstalling
- **System Prompt** — per-agent system prompt applied in every room this agent participates in; sub-agents have their own system prompt and do not inherit this one
- **Sub-agents card** — all sub-agents defined for this agent, with add/edit/delete/toggle controls
- **Workdirs card** — read-only list of working directories registered by this agent

### Server

- **Public URL** — the URL agents and other devices use to reach the server (important for Tailscale/remote setups)
- **Port** — change the server port (requires restart; see the [port change guide](doc-port))
- **Max AI Turns** — maximum agent responses per human message (prevents infinite loops)
- **Concurrent Sessions** — how many messages an agent can process in parallel across all rooms (applied instantly, no restart needed)
- **Session Idle TTL** — minutes before idle AI sessions auto-close to free memory (default 5 minutes)
- **Cleanup Hour** — when the daily upload cleanup runs (24h format)
- **Max File Age** — how long uploaded files are kept before cleanup (hours)

**Restart Server** — the Server tab also shows a restart card. It displays which process manager is running Stoa (e.g., `running via launchd`) and a **restart server** button. The button is enabled when Stoa is managed by launchd, PM2, systemd, or supervisord — the process manager will restart the process automatically after exit. For Docker or unknown environments the button is disabled (restart the container or process from outside). Click **restart server** → confirm the dialog → the server notifies all connected agents and browsers, then exits. The browser reconnects automatically within ~2–3 seconds and briefly shows "Server restarted" when the connection is restored.

### Platforms

Configure external AI model providers beyond the built-in Claude models. Click **+ add platform** to register a new provider:

- **Type** — **Ollama Cloud** (built-in proxy, no URL needed) or **Custom Platform** (any OpenAI-compatible API)
- **Name** — a label for the platform (e.g., "My OpenRouter")
- **Base URL** — required for Custom Platform (e.g., `https://openrouter.ai/api/v1`)
- **API Key** — your API key for that provider

On a new platform, click **add & discover** to save and probe available models in one step. On existing platforms, click **discover models** to re-probe. Discovery detects capabilities per model — vision support (👁) and tool-calling support (⚙). Models without tool-calling are included and usable, but run in text-only mode.

**Enabling and disabling models**: After discovery, a checklist appears showing all found models. Check only the models you want available in the room selector, then click **update** to save. This keeps the selector uncluttered when a platform has many models. Use **select all / deselect all** to quickly toggle everything. The enabled selection persists across sessions and updates automatically when you re-discover.

The API key is stored on the server and returned to the browser only in the Settings edit form (single-user app — you are the only one with access).

**Supported providers** — any OpenAI-compatible API endpoint works:
- **Ollama Cloud** — select the "Ollama Cloud" type (built-in proxy with key rotation, 40+ models up to 480B)
- **Local Ollama** — `http://localhost:11434/v1` (free, private, works offline — see [Ollama setup guide](doc-ollama))
- **OpenRouter** — `https://openrouter.ai/api/v1`
- **Together AI** — `https://api.together.xyz/v1`
- **Groq** — `https://api.groq.com/openai/v1`

### Custom Claude Models

If Anthropic releases a model that isn't yet in the built-in list, add it without a server update. Scroll to the **claude models** card in **Settings > Platforms**.

If an agent with a Claude CLI binary is online, the card shows a **Detected from Claude CLI v*X*** strip with clickable chips for model IDs newer than the latest already-registered entry in each family. Clicking a chip prefills the model ID and label fields (label auto-generated, e.g. _Haiku 5.5_, editable); click **add model** to save — nothing is added automatically. Older model IDs can still be typed in manually. If no agent has reported a CLI, the strip prompts you to connect one.

- **Add** — enter the model ID (e.g. `claude-haiku-5-5`) and an optional display label (max 40 characters), then click **add model**. The model appears immediately in the room model dropdown, tagged **custom**.
- **Remove** — click × on any custom model row. Rooms already using the model keep their setting; only new selections are affected.

Model ID format: must start with `claude-`, followed by lowercase letters, digits, dots, or dashes (regex: `^claude-[a-z0-9][a-z0-9.-]{1,62}$`). Duplicate or incorrectly formatted IDs are rejected inline. Maximum 20 custom entries.

### Automation

Manage Slack, WhatsApp, and Email connections and automation rules. See the [Automation](#automation) section above.

### Docs

Browse project documentation with multi-language support. Documentation files from the `docs/` directory are rendered as formatted markdown.

### General

- **Profile** — your display name and avatar (how you appear in rooms). Upload or remove your profile image, and change your display name
- **Messages** — reading comfort controls: adjust text size (Tiny / Small / Compact / Default), line spacing (Tight / Normal / Relaxed), and bubble width (Narrow / Standard / Wide). Changes apply to all rooms instantly with a live preview
- **Account** — change your email and password
- **Notifications** — enable/disable browser push notifications
- **Display defaults** — global defaults for agent progress display: tool steps visibility, live status verbosity, and cleanup behavior. Individual rooms can override these
- **Session** — log out of Stoa

### Usage

The **Usage** tab is a personal analytics dashboard for your AI token consumption. Everything is bucketed to your local calendar day — your browser's timezone is sent with each load, so day boundaries, peak hour, and streaks align to your local midnight rather than UTC.

Two segmented controls sit at the top:

- **View** — switch between **Summary** and **Model**
- **Period** — **All**, **30d**, or **7d** — filters every stat below to that window

**Summary view** shows a grid of stat cards: average tokens per message, total messages, total tokens (input + output + cache read + cache creation), active days, current and longest streak (consecutive active days, current counting back from today), peak hour (in your local timezone), input/output tokens, cache hits, estimated total cost in USD, and your top model.

Below the cards, an **activity heatmap** covers the last 26 weeks. Each cell is one day; darker cells mean more tokens. Hover a cell for the exact date and token count. The layout is fluid — it shrinks to fit on mobile instead of scrolling sideways.

**Model view** breaks usage down per model:

- A **stacked bar chart** shows daily token volume, each model a different color
- A **model list** below shows every model with its input/output token totals and percentage share

All figures are read-only and refresh whenever you reopen the tab or change the period.

---

## Themes

Open **Settings > Themes** (left nav, below General) to choose the app's visual theme. Themes are arranged in two groups:

- **Light** — Warm Paper (default), Hoth, Mood Indigo, Banana, Sweet Treat
- **Dark** — Dark, Aubergine, Ochin, Haberdashery, Choco Mint, Nocturne

Click a card to apply it immediately — a checkmark marks the active theme. Cards are keyboard-accessible. Your choice is saved in the browser.

**Migration:** If you previously used the light setting, Warm Paper is applied automatically. The dark setting stays as Dark. With no prior setting, Stoa follows your device's system dark/light preference.

On mobile, the status bar color updates to match the active theme.

---

## Mobile Support

Stoa is fully responsive and works on mobile browsers. It can also be installed as a **Progressive Web App (PWA)** — use your browser's "Add to Home Screen" option for a native app experience.

For mobile access from another device, set up **Tailscale** — see the [Tailscale guide](doc-tailscale) for step-by-step instructions.

---

## Public Deployment

Stoa can be accessed beyond your local machine in three configurations:

### (A) Tailscale only
Access Stoa from any device on your Tailscale network using the machine's Tailscale IP. No additional configuration needed — the server runs on your local port and Tailscale handles the secure tunnel. Set **Public URL** in **Settings > Server** to `http://<tailscale-ip>:<port>` so agents and install commands use the correct address.

### (B) Cloudflare Tunnel (on the same machine)
Run `cloudflared tunnel` on the same machine as Stoa to expose it on a public domain without opening firewall ports. By default, cloudflared connects from `localhost`, which is already trusted. Set **Public URL** to your tunnel URL (e.g., `https://stoa.example.com`). Add this to your Cloudflare cache rules to bypass caching for file paths:
- Bypass cache for paths: `/uploads/*` and `/connector-media/*`

> **Cloudflare Access + agents:** Set `STOA_CF_ACCESS_CLIENT_ID` and `STOA_CF_ACCESS_CLIENT_SECRET` in the agent's environment to pass a Cloudflare Access service token. The token is sent only to the Stoa origin — not to model providers or other hosts. Child sessions (Claude Code, Codex) receive a loopback proxy URL so they can reach Stoa through Access without the token entering their prompts. Without these variables, behavior is unchanged. **Recommended:** prefer Tailscale for agents; use CF Access tokens only when Tailscale is unavailable.

### (C) VPS + reverse proxy + domain
Run Stoa behind nginx, Caddy, or another reverse proxy on a VPS with a public domain and TLS.

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `STOA_TRUSTED_PROXIES` | Comma-separated IP/CIDR of trusted proxy servers. Default: `127.0.0.1/32,::1/128` (localhost). Set to `none` to trust no proxy. |
| `STOA_ALLOWED_ORIGINS` | Comma-separated allowed origins (e.g., `https://stoa.example.com`). Required if the proxy changes the `Host` header without forwarding `X-Forwarded-Host`. |

**How trust works:** Client IP and HTTPS status are read from proxy headers (`CF-Connecting-IP`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`) only when the request comes from a trusted proxy. Headers from untrusted IPs are ignored. Your reverse proxy **must** set these headers and not forward untrusted ones from clients.

**Header configuration — important if not behind Cloudflare:** Stoa reads client IP in this order: `CF-Connecting-IP` → `X-Real-IP` → `X-Forwarded-For`. If your proxy is **not** Cloudflare (e.g., nginx or Caddy directly on a VPS), the proxy **must** strip `CF-Connecting-IP` sent by clients — otherwise an attacker can forge this header to bypass the per-IP login rate limit. The per-email limit and device cookie remain effective regardless.

**nginx:**
```nginx
proxy_set_header CF-Connecting-IP "";
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
```

**Caddy:**
```caddy
header_up -CF-Connecting-IP
header_up X-Real-IP {remote_host}
```

> **Cloudflare in front of nginx:** If Cloudflare sits in front of your nginx, do **not** strip `CF-Connecting-IP`. Instead, restrict access to your origin server to [Cloudflare IP ranges](https://www.cloudflare.com/ips/) only.

**HTTPS:** Required for public deployment. When `isHttps` is detected (either via TLS socket or a trusted `X-Forwarded-Proto: https`), session cookies are set with `Secure`, and HSTS is sent automatically.

**public_url:** Set in **Settings > Server** to the public-facing URL (e.g., `https://stoa.example.com`). Used in agent install commands and internal links.

**CSRF protection:** Write requests authenticated via session cookie are checked for a matching `Origin` header. If the request origin doesn't match `Host`, `public_url`, or `STOA_ALLOWED_ORIGINS`, the server returns `403 origin_not_allowed`. Non-browser clients (agents, API tools) that don't send `Origin` are unaffected.

### Agent permissions

Agent secrets (`x-agent-id` / `x-agent-secret`) are limited to an allowlist of routes needed for legitimate agent work. Requests outside this list are rejected with `403 {"error":"agent_scope_denied"}` and logged as `[agent-scope] denied actor=<id> METHOD /path`.

| Route | Access condition |
|-------|-----------------|
| `POST /api/rooms/:id/message` | Room participant |
| `POST /api/rooms/:id/email-reply` | Room participant |
| `GET/PUT /api/rooms/:id/memory` | Room participant |
| `GET/PUT /api/rooms/:id/system-prompt` | Room participant |
| `POST /api/rooms/:id/sub-agent-trigger` | Room participant |
| `GET /api/rooms/:id/messages` | Room participant |
| `GET /api/rooms/:id/threads[/:id]` | Room participant |
| `POST /api/upload/raw` | Any valid agent |
| `GET /uploads/*, /connector-media/*` | Any valid agent |
| `GET /api/docs/stoa-api*.md` | Any valid agent |
| `GET/PUT /api/actors/:id/memory[/MEMORY.md|USER.md]` | Own actor only |
| `GET/PUT /api/actors/:id/system-prompt` | Own actor only |
| `GET/PUT /api/sub-agents/:id/memory` | Owned sub-agent only |
| `GET /api/automations/connections/:id/messages` | Connected automation room |
| `GET /api/automations` | Any valid agent (server filters to own rooms) |
| `POST /api/automations` | Any valid agent (`target_room_id` must be own room) |
| `PATCH /api/automations/:id` | Owned automation (`target_room_id` must remain own room) |
| `DELETE /api/automations/:id` | Owned automation |
| `GET /api/automations/connections` | Any valid agent (`id`, `name`, `provider`, `status` only — no credentials) |

When an agent creates, updates, or deletes an automation, a permanent system notice is posted in the target room (e.g., *"Ara created automation 'X' (trigger: slack message) · automation"*), so the workspace owner can monitor changes and revoke them if needed.

Browser sessions (session cookie) retain full access. To disable scope enforcement, set `STOA_AGENT_SCOPE=off` on the server — a warning is logged at startup.

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Send message | Enter |
| New line | Shift + Enter |
| Toggle Enter-to-send | Click the toggle in the composer |
| In-room search | Ctrl + F |
| Cancel reply | Escape |
| @mention autocomplete | @ |
| Skill autocomplete | / |

---

## Architecture Overview

```
Browser  <-->  WebSocket  <-->  server.js  <-->  Agent (stoa.js)
                                    |                   |
                                 SQLite DB      Claude Code CLI
                                                  (+ external platforms
                                                   via env vars)
```

- **server.js** — HTTP + WebSocket server, manages rooms, messages, and agent orchestration
- **public/** — frontend (no build step needed)
- **stoa.js** — agent client that runs on each agent machine
- **claude-session.js** — manages the Claude Code CLI subprocess
- **codex-session.js** — manages the Codex CLI subprocess; distributed via Stoa's auto-update (downloaded when the server is updated, not when the harness is switched)
- **SQLite** — all data stored locally in `stoa.db` (WAL mode for performance)

All AI models are routed through **Claude Code CLI**. For custom external platforms (OpenRouter, Together AI, etc.), the server passes platform-specific environment variables (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`) to the CLI process. For **Ollama Cloud**, requests are routed through a built-in Stoa proxy (`/v1/messages`) with server-side API key rotation — agents connect to Stoa, not directly to ollama.com.

**Room context in prompt**: Every time an agent is triggered, the server injects `Room ID: <id>` into the agent's system prompt. This means the agent always knows which room it is operating in — enabling it to call `sendProactiveMessage(roomId, ...)` or perform other room-aware operations without needing the ID passed explicitly.

---

## Tips

- **Multiple agents, one room**: Put complementary agents in the same room — e.g., a coder and a reviewer — and let them collaborate via @mentions
- **Dedicated rooms**: Create separate rooms for different topics or projects. Each room maintains its own conversation history
- **Working directories**: Assign different workdirs to different rooms so the same agent can work on multiple projects
- **File sharing**: Drag and drop files directly into the chat — agents can read them immediately
- **Search first**: Before asking an agent a question, use search to check if it was already discussed in another room
