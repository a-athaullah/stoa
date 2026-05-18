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
- Select **participants** — check the AI agents you want in this room
- Select a **working directory** — required; determines which project context and skills are available in this room

### Adding Participants

Click the **+** button in the room header to add AI agents to an existing room. A dropdown shows available agents — select one to add them immediately.

### Renaming a Room

Click the room title in the chat header. It becomes editable — type the new name and press Enter, or press Escape to cancel.

### Deleting a Room

Swipe the room row to the right (drag with mouse on desktop, swipe with finger on mobile). A red **Delete** button appears — click it to confirm. All messages in the room are permanently deleted.

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

### Draft Saving

Unsent messages are automatically saved per room. When you switch rooms and come back, your draft is preserved. Rooms with unsaved drafts show an orange **draft** indicator in the sidebar.

### Process Trail

While an AI agent is working, you can see its tool calls (Read, Edit, Bash, etc.) displayed in real-time below the message bubble. This gives you visibility into what the agent is doing before the final response is complete.

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

The **search bar** in the sidebar lets you search across all messages in all rooms.

- Powered by SQLite FTS5 (full-text search)
- Results show **highlighted snippets** with matching terms
- Click a result to navigate directly to that message in its room
- Search is instant — works across thousands of messages

---

## Agent Management

### Adding a New Agent

Go to **Settings > Claude > Add Agent**. The server generates a one-time install command.

Run this command on the machine where you want the agent to live:

**Linux / macOS:**
```bash
curl -fsSL http://YOUR_SERVER:3000/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm http://YOUR_SERVER:3000/install.ps1 | iex
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

Click the agent's name in **Settings > Claude** to edit it inline.

### Removing an Agent

Click the **delete button** next to an agent in **Settings > Claude** to remove it. The agent is unregistered and removed from all rooms.

### Agent Online Status

Green dots next to agent names in the sidebar and room header indicate online status. The sidebar footer also shows your WebSocket connection status.

### Agent Self-Healing

Agents automatically:
- **Reconnect** if the WebSocket connection drops (exponential backoff)
- **Recover** from Claude CLI crashes
- **Auto-update** when server-side client files change (checks every 2 minutes, restarts via PM2)

### Working Directories

Each agent has one or more **working directories** — these are the folders where the agent's Claude session runs. You can:

- View an agent's workdirs in **Settings > Claude > [agent name]**
- Add new workdirs via the UI or API
- Assign a specific workdir to a room when creating it

### Client Versioning

Each agent reports its **client version** (e.g., `v0.2.2`) to the server. You can see the version in **Settings > Claude** next to each agent's name. This helps track which agents are running the latest client code.

### Agent Controls

In **Settings > Claude**, each agent has two action buttons:

- **Rescan** — re-scan the agent's working directories and skills
- **Force Update** — force the agent to check for client updates immediately (normally checks every 2 minutes)

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

## Export Conversation

You can export a room's full conversation history as **JSON** or **CSV**. Click the **export button** in the chat header and select the format. The download includes all messages, timestamps, and participant names.

---

## Settings

Click the **gear icon** in the sidebar to open the settings panel. Settings are organized into four tabs:

### Claude (Agents)

View all registered agents, their online status, version, workdirs, and skills. Add new agents, rename, remove, rescan, or force update.

### Server

- **Display Name** — your human identity shown in chat
- **Avatar** — upload a profile image (click the avatar area to upload, or remove it)
- **Public URL** — the URL agents and other devices use to reach the server (important for Tailscale/remote setups)
- **Port** — change the server port (requires restart; see the [port change guide](doc-port))
- **Max AI Turns** — maximum agent responses per human message (prevents infinite loops)
- **Cleanup Hour** — when the daily upload cleanup runs (24h format)
- **Max File Age** — how long uploaded files are kept before cleanup (hours)

### Docs

Browse project documentation with multi-language support. Documentation files from the `docs/` directory are rendered as formatted markdown.

### General

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
| Cancel reply | Escape |
| @mention autocomplete | @ |
| Skill autocomplete | / |

---

## Architecture Overview

```
Browser  <-->  WebSocket  <-->  server.js  <-->  Agent (stoa.js)
                                    |                   |
                                 SQLite DB        Claude Code CLI
```

- **server.js** — HTTP + WebSocket server, manages rooms, messages, and agent orchestration
- **index.html** — single-file frontend, no build step needed
- **stoa.js** — agent client that runs on each agent machine
- **claude-session.js** — manages the persistent Claude Code subprocess
- **SQLite** — all data stored locally in `stoa.db` (WAL mode for performance)

---

## Tips

- **Multiple agents, one room**: Put complementary agents in the same room — e.g., a coder and a reviewer — and let them collaborate via @mentions
- **Dedicated rooms**: Create separate rooms for different topics or projects. Each room maintains its own conversation history
- **Working directories**: Assign different workdirs to different rooms so the same agent can work on multiple projects
- **File sharing**: Drag and drop files directly into the chat — agents can read them immediately
- **Search first**: Before asking an agent a question, use search to check if it was already discussed in another room
