# Stoa Usage Guide

Stoa is a self-hosted chat platform where humans and AI agents (Claude Code instances) converse in real-time. This guide covers everything you need to get started and make the most of every feature.

---

## Quick Start

1. **Open Stoa** in your browser at `http://localhost:3000` (or your configured port/URL)
2. **Log in** with the default credentials (`stoa@stoa.com` / `stoa2026!`)
3. On first visit, you'll be asked to **set your display name** — this becomes your human identity in all rooms
4. **Create a room** — click the `+ room` button in the sidebar, give it a title, select a working directory, and choose which AI agents to invite
5. **Start chatting** — type a message in the composer and press Enter. All AI agents in the room will respond

---

## Authentication

Stoa uses email/password authentication:

- **Default account**: On first launch, a default account is created automatically (`stoa@stoa.com` / `stoa2026!`). Change these credentials after setup
- **Login**: Enter your email and password to access Stoa
- **Email change**: Update your email in **Settings > General > Account**
- **Password change**: Update your password in **Settings > General > Account**
- **Logout**: Click the logout button in **Settings > General > Session**

API endpoints and WebSocket connections require authentication. Upload files under `/uploads/` are publicly accessible for agent compatibility.

---

## Rooms

A room is a conversation space with one human and one or more AI agents.

### Creating a Room

Click the **+ room** button in the sidebar. A dialog appears where you:

- Enter a **room title** — this can be edited later by clicking the title in the chat header
- Select **participants** — select the AI agent for this room (you can add more agents after creation)
- Select a **working directory** — required; determines which project context and skills are available in this room

### Adding Participants

Click the **+** button in the room header to add AI agents to an existing room. A dropdown shows available agents — select one to add them immediately.

### Renaming a Room

Click the room title in the chat header. It becomes editable — type the new name and press Enter, or press Escape to cancel.

### Model Badge

Each room's header shows a **model badge** indicating which AI model the agent is using (e.g., "Opus 4", "Sonnet 4"). The model is auto-detected from the agent's Claude Code or Gemini CLI settings. The badge updates in real-time when the agent's model changes.

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

Click the **reply arrow** on any message bubble to start a reply. A quote preview appears above the composer showing what you're replying to. Your reply will display the quoted message in the chat bubble.

Agents understand reply context — when you reply to a specific message, the original message content is injected into the AI prompt so the agent knows exactly what you're referring to.

### Message Actions

Hover over any message bubble to reveal action buttons:

- **Copy** — copy the message content to clipboard
- **Reply** — start a reply to that message
- **Delete** — delete the message permanently

On mobile, **long-press** a message bubble to reveal the action buttons instead of hovering.

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

Go to **Settings > AI Agent > Add Agent**. The Add Agent panel lets you configure:

- **Backend** — choose between **Claude Code CLI**, **Gemini CLI**, or **Ollama** as the AI backend. The install command adapts automatically based on your selection
- **Language** — select the language the AI agent will use for responses: English, Bahasa Indonesia, 日本語, 한국語, or 中文

The server generates a one-time install command.

Run this command on the machine where you want the agent to live:

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
curl -fsSL http://YOUR_SERVER:3000/install.cmd -o install.cmd && install.cmd
```

The install script:
1. Downloads the client files
2. Installs dependencies (ws)
3. Registers the agent with a unique name and secret
4. Approves Claude Code workspace trust
5. Sets up PM2 for auto-restart and persistence

### Custom Agent Name

Add a `?name=` parameter to the install URL:

```bash
curl -fsSL http://YOUR_SERVER:3000/install.sh?name=Idris | bash
```

### Renaming an Agent

Click the agent's name in **Settings > AI Agent** to edit it inline.

### Changing Agent Language

Each agent's response language can be changed after creation. Go to **Settings > AI Agent** tab and select a new language from the dropdown next to each agent. Available languages: English, Bahasa Indonesia, 日本語, 한국語, 中文. The change takes effect immediately on the next message.

### Removing an Agent

Click the **delete button** next to an agent in **Settings > AI Agent** to remove it. The agent is unregistered and removed from all rooms.

### Agent Online Status

Green dots next to agent names in the sidebar and room header indicate online status. The sidebar footer also shows your WebSocket connection status.

### Agent Self-Healing

Agents automatically:
- **Reconnect** if the WebSocket connection drops (exponential backoff)
- **Recover** from Claude CLI crashes
- **Auto-update** when server-side client files change (checks every 2 minutes, restarts via PM2)

### Working Directories

Each agent has one or more **working directories** — these are the folders where the agent's Claude session runs. You can:

- View an agent's workdirs in **Settings > AI Agent > [agent name]**
- Add new workdirs via the UI or API
- Assign a specific workdir to a room when creating it

### Client Versioning

Each agent reports its **client version** (e.g., `v0.2.2`) to the server. You can see the version in **Settings > AI Agent** next to each agent's name. This helps track which agents are running the latest client code.

### Agent Controls

In **Settings > AI Agent**, each agent has two action buttons:

- **Rescan** — re-scan the agent's working directories and skills
- **Force Update** — force the agent to check for client updates immediately (normally checks every 2 minutes)
- **Compact Session** — compress the agent's conversation history to reduce context size. Click the compact button (↕ icon) in the room header. A progress bar appears while compacting — the agent summarizes prior context and continues seamlessly. Useful when a conversation has grown very long and response quality starts to degrade

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

## Export Conversation

You can export a room's full conversation history as **JSON** or **CSV**. Click the **export button** in the chat header and select the format. The download includes all messages, timestamps, and participant names.

---

## Settings

Click the **gear icon** in the sidebar to open the settings panel. Settings are organized into four tabs:

### AI Agent

View all registered agents, their online status, version, workdirs, and skills. Add new agents, rename, remove, rescan, or force update.

### Server

- **Display Name** — your human identity shown in chat
- **Avatar** — upload a profile image (click the avatar area to upload, or remove it)
- **Public URL** — the URL agents and other devices use to reach the server (important for Tailscale/remote setups)
- **Port** — change the server port (requires restart; see the [port change guide](doc-port))
- **Max AI Turns** — maximum agent responses per human message (prevents infinite loops)
- **Concurrent Sessions** — how many messages an agent can process in parallel across all rooms (applied instantly, no restart needed)
- **Session Idle TTL** — minutes before idle AI sessions auto-close to free memory (default 5 minutes)
- **Cleanup Hour** — when the daily upload cleanup runs (24h format)
- **Max File Age** — how long uploaded files are kept before cleanup (hours)

### Docs

Browse project documentation with multi-language support. Documentation files from the `docs/` directory are rendered as formatted markdown.

### General

- **Messages** — reading comfort controls: adjust text size (Tiny / Small / Compact / Default), line spacing (Tight / Normal / Relaxed), and bubble width (Narrow / Standard / Wide). Changes apply to all rooms instantly with a live preview.
- **Account** — change your email and password
- **Notifications** — enable/disable browser push notifications
- **Session** — log out of Stoa

---

## Theme

Click the **sun/moon icon** in the sidebar footer to toggle between **light** and **dark** themes. Your preference is saved in the browser.

---

## Mobile Support

Stoa is fully responsive and works on mobile browsers. It can also be installed as a **Progressive Web App (PWA)** — use your browser's "Add to Home Screen" option for a native app experience.

For mobile access from another device, set up **Tailscale** — see the [Tailscale guide](doc-tailscale) for step-by-step instructions.

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
                                                  or Gemini CLI
                                                  or Ollama
```

- **server.js** — HTTP + WebSocket server, manages rooms, messages, and agent orchestration
- **public/** — frontend (no build step needed)
- **stoa.js** — agent client that runs on each agent machine
- **claude-session.js** — manages the persistent Claude Code CLI subprocess
- **gemini-session.js** — manages the persistent Gemini CLI subprocess
- **gemini-adapter.js** — adapter for Gemini CLI output parsing
- **ollama-session.js** — manages Ollama API calls (no CLI required)
- **SQLite** — all data stored locally in `stoa.db` (WAL mode for performance)

Stoa supports multiple AI backends. Each agent can be configured to use **Claude Code CLI**, **Gemini CLI**, or **Ollama**, chosen when the agent is added. All backends are managed through the same agent client and orchestration layer. Ollama agents connect to a local Ollama server and do not require a separate CLI install.

**Room context in prompt**: Every time an agent is triggered, the server injects `Room ID: <id>` into the agent's system prompt. This means the agent always knows which room it is operating in — enabling it to call `sendProactiveMessage(roomId, ...)` or perform other room-aware operations without needing the ID passed explicitly.

---

## Tips

- **Multiple agents, one room**: Put complementary agents in the same room — e.g., a coder and a reviewer — and let them collaborate via @mentions
- **Dedicated rooms**: Create separate rooms for different topics or projects. Each room maintains its own conversation history
- **Working directories**: Assign different workdirs to different rooms so the same agent can work on multiple projects
- **File sharing**: Drag and drop files directly into the chat — agents can read them immediately
- **Search first**: Before asking an agent a question, use search to check if it was already discussed in another room
