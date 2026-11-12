# Frontend Structure

## Architecture

Single-page application in `index.html` (~7000 lines).

**Tech stack:**
- Vanilla JS (no framework)
- Tailwind CSS (via CDN)
- Web Components (custom elements)
- WebSocket for real-time
- Web Speech API for voice input
- Service Worker for offline support

---

## Theming

### How it works

Themes are CSS token blocks defined in `public/css/base.css` under `[data-theme="<id>"]` selectors. The `data-theme` attribute is set on `<html>` by `setTheme()` in `public/js/core.js`.

**Never use `.dark` class or hardcoded colors.** Every color must come from a CSS token (e.g., `var(--h-ink)`). New tokens must be defined in **all 11 themes** — missing a token in one theme causes invisible or broken UI in that theme.

### Key files

- `public/js/core.js` — `THEMES` array (source of truth for IDs), `DEFAULT_THEME = 'warm-paper'`, `resolveStoredTheme()`, `setTheme(id, { persist })`, `currentTheme()`
- `public/js/settings/themes.js` — renders the Themes tab: preview cards, group labels, keyboard-accessible buttons, `sSyncThemeCards()`
- `public/css/base.css` — `[data-theme="<id>"] { ... }` token blocks for each theme
- `public/index.html` — inline boot script applies stored theme before first paint (anti-flash)

### Theme list (as of v0.59)

| ID | Label | Scheme |
|----|-------|--------|
| `warm-paper` | Warm Paper | light (default) |
| `hoth` | Hoth | light |
| `mood-indigo` | Mood Indigo | light |
| `jade` | Jade | light |
| `banana` | Banana | light |
| `sweet-treat` | Sweet Treat | light |
| `dark` | Dark | dark |
| `aubergine` | Aubergine | dark |
| `ochin` | Ochin | dark |
| `haberdashery` | Haberdashery | dark |
| `choco-mint` | Choco Mint | dark |
| `nocturne` | Nocturne | dark |

### Migration from old dark/light toggle

`resolveStoredTheme()` in `core.js` handles the one-time migration:
- `localStorage['stoa-theme'] === 'light'` → `warm-paper`
- `localStorage['stoa-theme'] === 'dark'` → `dark` (unchanged)
- no value → follows `prefers-color-scheme`

### Adding a new theme

1. Add `{ id, label, scheme }` entry to `THEMES` in `core.js`
2. Add `[data-theme="<id>"] { ... }` block in `base.css` — define **every** token used by any other theme
3. Run `.claude/tools/theme-contrast.js` to verify all color pairs pass contrast minimums
4. Bump `CLIENT_VERSION` in `stoa.js`

---

## State Management

### Global State
```javascript
const state = {
  rooms: [],
  actors: [],
  currentRoomId: null,
  currentUser: null,
  agentStatuses: new Map(),
  // ...
};
```

### Reactivity Pattern
```javascript
function setState(key, value) {
  state[key] = value;
  render();  // Re-render affected UI
}
```

**Not reactive by default** — manual `render()` calls after state changes.

---

## WebSocket Client

### Connection
```javascript
const ws = new WebSocket(`ws://${location.host}`);

ws.onopen = () => {
  console.log('Connected');
  loadRooms();
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  handleServerMessage(msg);
};

ws.onclose = () => {
  // Auto-reconnect after 2s
  setTimeout(initWebSocket, 2000);
};
```

### Message Handling
```javascript
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'message':
      appendMessage(msg.room_id, msg.message);
      break;
    case 'message_update':
      updateMessage(msg.message_id, msg.content, msg.state);
      break;
    case 'room_update':
      updateRoom(msg.room);
      break;
    // ...
  }
}
```

---

## UI Components

### Room List (Sidebar)
```javascript
function renderRoomList() {
  const pinned = state.rooms.filter(r => !r.archived_at && r.is_pinned);
  const active = state.rooms.filter(r => !r.archived_at && !r.is_pinned);
  
  return `
    <div class="room-list">
      ${pinned.map(renderRoomItem).join('')}
      <hr>
      ${active.map(renderRoomItem).join('')}
    </div>
  `;
}
```

**Pinned rooms** always at top, active rooms sorted by last message.

---

### Message List
```javascript
function renderMessages(roomId) {
  const messages = state.messages[roomId] || [];
  
  return messages.map(msg => {
    const actor = getActor(msg.actor_id);
    return `
      <div class="message" data-state="${msg.state}">
        <div class="avatar">${actor.avatar_symbol}</div>
        <div class="content">
          ${marked.parse(msg.content)}
        </div>
      </div>
    `;
  }).join('');
}
```

**Markdown rendering:** Uses `marked.js` for rich text.

**State indicators:**
- `state='streaming'` → typing animation
- `state='error'` → red background
- `state='complete'` → normal

---

### Threads: complete / open
- `threadSummaries[rootId].completed` (`chat/feed.js`) is the client copy of the server-derived status. It is fed by the feed payload (`m.thread.completed`), `thread_summary` (a summary without the flag keeps the last value), the thread detail `root.completed`, the PUT response and WS `thread_status` (ignored for another `room_id`).
- `setThreadCompleted(rootId, completed)` is the single setter: it redraws the feed chip (`.h-thread-chip.is-complete` + `.h-thread-chip-done`), syncs the thread panel toggle (`#thread-complete-btn`, `aria-pressed`, constant "Complete" label, tooltip carries the action, hidden while the thread has no reply) (the room header carries no open-thread count or list: not every room's threads need marking complete).
- Auto-reopen: `message_new` for a thread reply calls `noteThreadReply(tId)` → `setThreadCompleted(tId, false)`. The server derives the same (a reply newer than `thread_completed_through`).

---

### Room task board (`public/js/tasks/`)
- `api.js` (`TasksApi`): the only place that calls `/api/rooms/:id/tasks*` (contract: `stoa-feature/kanban/CONTRACT.md`). Errors are `TasksApiError` with `status` and the server's message.
- `board.js`: state in `tasksUi`, the board (4 columns), toolbar, banner, pointer + keyboard moves, nav buttons. `drawer.js`: the card detail panel. Every class is `tb-*` (`public/css/tasks.css`) so nothing collides with layout classes.
- Entry: rail button `#rsb-tasks` (`tasksRailButton` in `room-sidebar.js`) and, under 1024px where the rail is hidden, `#tb-hbtn` in the room header (`tasksHeaderControls`). Board mode = `#chat-feed-col.tb-mode` (everything except `#chat-header` and `#task-board` is hidden). Pips: running (teal) / awaiting (indigo), counted from the loaded tasks.
- Room isolation: `openRoom` calls `tasksOnRoomOpen(room)` (clears state and the old board's DOM via `tbClearBoardDom`, closes the drawer, restores the per-room view from `localStorage['stoa-task-view']`); the room socket's `onopen` calls `tasksOnSocketOpen(roomId)` for the snapshot (no replay, so reconnects refetch); `tasksHandleWs` drops `task_*` events whose `room_id` is not the current room. A snapshot that lands after a switch is dropped by `tasksUi.seq`.
- Timestamps: task and event times are SQLite UTC without a zone; `tbDate` parses them as UTC, `tbDay` (Finished card, year only when not this year), `tbWhen` (drawer times, log, comments) and `tbFull` (tooltip) show local time; `tbDuration` gives the Started→Finished run time. Empty or unparsable values render nothing.
- Description: the drawer renders `task.description` with `tbDescriptionHtml`, not `renderMarkdown`: markdown stays (bold, lists, links, code), but raw HTML tokens are turned into text so `<img>`/`<script>` show literally and never trigger requests. Then it still goes through `sanitizeMarkdownHtml`.
- Room header title: `.h-room-name` has `max-width: 100%` (chat.css) at every width because `.h-header-info` aligns items to flex-start; without it a long nowrap title grows past its box and runs under the Tasks button/crumb and the activity pill instead of ending in an ellipsis.
- Thread auto-open: `websocket.js` auto-opens a thread when an agent starts replying in it. While the board is shown, `tasksKeepThreadClosed(threadId)` keeps task threads closed (roots noted by `tasksNoteMessage` from `message_new`/`history` with `automation.task_id`, or a task's `thread_id`); ordinary threads and the chat view keep the old behaviour.

### Room switch (`rooms/open.js`, `websocket.js`)
- `openRoom` detaches the previous room's socket first (`disconnectWS()`: no `onmessage`/`onclose`), fetches participants and sub-agents in parallel, and drops its own continuation when a newer `openRoom` started (`openRoomSeq`).
- Feed cache: `feedCache` keeps the raw `history` frame of the last 5 rooms (`FEED_CACHE_MAX`). `paintCachedFeed` renders it at once on open (feed only; run state such as thinking rows waits for the live frame). When the live `history` frame is byte-identical to what was painted (`feedPainted`) the feed is kept; any other WS event clears `feedPainted`, so a reconnect after live activity rebuilds in full. A cached frame is never patched: events of a room arrive only while it is open, so the fresh frame always wins (new, edited and deleted messages show after revalidation, with no duplicates).
- `renderHistoryFeed` builds rows in a `DocumentFragment` and bumps `feedGeneration`; `loadOlderMessages` discards a page that resolves after the feed was rebuilt. Without a cached feed `noMoreOlder` stays true until history, so a scroll event during the switch cannot load another room's older page.
- Workspace: `file_list`/`git_diff` are requested only while `#workspace-panel` is open (`wsPanelIsOpen`, `wsRequestWorkspace`), on open, on reconnect and after replies. A large workdir is megabytes of JSON. `wsResetForRoom` clears the tree, root and git badge on a room switch. Folder children are built on first expand. `openFileFromPath` waits for the root (`wsWhenRootKnown`, 3 s fallback) so absolute paths are still made relative.
- Order comes from the server `rank`; the client never sends one. Moves send `before_id` (card below the drop) or `after_id` (card above, only at the end); confirming an Awaiting card sends neither. Finished is shown newest first (`finished_at`).
- Stop always opens a `<dialog>` that names the running tasks it will stop; its text says runner turns are cancelled and agents that took a card themselves are not interrupted (only the card goes back). Esc inside the board (popover, drag, drawer) is caught before the global Esc that stops generation.
- Agent-claimed cards (`claimed_by_actor_id`/`claimed_by_sub_agent_id`, no `thread_id`): `tbClaimerFor` resolves the claiming agent or sub-agent, `tbWorkerFor` uses it for the card avatar and the drawer's "… is working on it" only while `status==='running'` (otherwise the assignee). The Assignee field always stays the assignee. Log kind `claimed` reads "took it to Ongoing to work on it"; outside Backlog a claimed card without a thread shows "<agent> took this task without a thread." instead of the runner note.
- Chat: `automation.provider === 'task'` renders the avatar `/img/task-avatar.svg` (PNG wrapped in SVG, because the static server serves no `.png`) and a "Task #seq" tag button (`makeTaskTagEl` in `core.js`) that opens the board and the drawer; it reads `automation.task_id` and `automation.task_seq` (contract v1.1, also on agent replies in the card thread). Assignee changes send exactly one of `assignee_actor_id` (null = primary) or `assignee_sub_agent_id`.

---

### Message Input
```javascript
function renderMessageInput() {
  return `
    <div class="input-area">
      <textarea id="message-input" placeholder="Type a message..."></textarea>
      <button id="send-btn">Send</button>
      <button id="voice-btn">🎤</button>
      <button id="attach-btn">📎</button>
    </div>
  `;
}
```

**Features:**
- Auto-resize textarea
- Shift+Enter for newline
- Enter to send
- Voice input via Web Speech API
- File attachment (image/file upload)

---

### Voice Input

```javascript
function startVoiceInput() {
  if (!('webkitSpeechRecognition' in window)) {
    alert('Voice input not supported');
    return;
  }
  
  const recognition = new webkitSpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map(r => r[0].transcript)
      .join('');
    document.getElementById('message-input').value = transcript;
  };
  
  recognition.start();
}
```

**Browser support:** Chrome, Edge (WebKit only)

---

### Search

```javascript
function search(query) {
  fetch(`/api/search?q=${encodeURIComponent(query)}`)
    .then(r => r.json())
    .then(results => {
      renderSearchResults(results);
    });
}
```

**Search scope:** All rooms, all messages (FTS5 backend)

**Results show:**
- Message preview (highlighted match)
- Room name
- Timestamp
- Click → jump to message

---

## Modals & Dialogs

### Pattern
```javascript
function showModal(title, content) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <h2>${title}</h2>
      <div class="modal-content">${content}</div>
      <button onclick="closeModal()">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
}
```

**Examples:**
- Create room
- Edit room settings
- Invite participants
- View actor profile
- Automation settings

---

## Notifications

### Browser Notifications
```javascript
function notifyMessage(roomId, message) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') {
    Notification.requestPermission();
    return;
  }
  
  const room = getRoom(roomId);
  new Notification(`${room.title}`, {
    body: message.content.slice(0, 100),
    icon: '/stoa-icon.svg'
  });
}
```

**Trigger:** New message in background room (not currently visible)

---

## Keyboard Shortcuts

```javascript
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl + K → Search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openSearch();
  }
  
  // Cmd/Ctrl + N → New Room
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
    e.preventDefault();
    openNewRoomDialog();
  }
  
  // Escape → Close modal
  if (e.key === 'Escape') {
    closeModal();
  }
});
```

---

## Responsive Design

### Breakpoints
- Mobile: `< 768px` → single-column, collapsible sidebar
- Tablet: `768px - 1024px` → two-column, persistent sidebar
- Desktop: `> 1024px` → three-column (sidebar + main + details)

### Mobile Optimizations
- Swipe gestures (open/close sidebar)
- Touch-friendly tap targets (44px min)
- Virtual keyboard handling
- Voice input prominent on mobile

---

## Performance

### Lazy Loading
Messages loaded in batches:
```javascript
function loadMoreMessages(roomId) {
  const oldest = getOldestMessage(roomId);
  fetch(`/api/rooms/${roomId}/messages?before=${oldest.id}&limit=50`)
    .then(r => r.json())
    .then(messages => {
      prependMessages(roomId, messages);
    });
}
```

**Trigger:** Scroll to top of message list

---

### Virtual Scrolling
**Not implemented yet** — would help for rooms with 10k+ messages.

Current approach: Render all loaded messages (works fine up to ~1000 messages).

---

### Debouncing

```javascript
let searchTimeout;
function onSearchInput(query) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    search(query);
  }, 300);
}
```

**Applied to:** Search input, auto-save settings

---

## Service Worker

```javascript
// sw.js
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('stoa-v1').then(cache => {
      return cache.addAll([
        '/',
        '/css/stoa.css',
        '/js/stoa.js',
        '/stoa-icon.svg'
      ]);
    })
  );
});
```

**Features:**
- Offline support (cached assets)
- Background sync (pending messages)
- Push notifications (future)

---

## Error Handling

### Network Errors
```javascript
fetch('/api/rooms')
  .then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })
  .catch(err => {
    showError('Failed to load rooms: ' + err.message);
  });
```

### WebSocket Errors
```javascript
ws.onerror = (err) => {
  console.error('WebSocket error:', err);
  showError('Connection error. Reconnecting...');
};
```

**User feedback:** Toast notification (auto-dismiss after 5s)

---

## Client Router (`public/js/rooms/router.js`)

Handles SPA permalinks — every room, thread, and message has a stable URL that the server renders as `index.html`, then this module resolves on the client.

### URL scheme
| URL | Effect |
|-----|--------|
| `/r/<roomId>` | Open room |
| `/r/<roomId>/t/<threadId>` | Open room + thread |
| `/r/<roomId>/t/<threadId>?m=<msgId>` | Open room + thread + scroll to message |
| `/r/<roomId>?m=<msgId>` | Open room + scroll to message in feed |

Legacy `?thread=<msgId>` is read by `parseRoute()` and still works.

### Key functions
- `parseRoute(loc)` — parses current URL into `{ roomId, threadId, msgId }`. IDs are validated as 1–15 digit positive integers; anything else returns `null`.
- `routeWrite(roomId, threadId, mode, msgId)` — pushes or replaces the URL in history (`'push'` / `'replace'` / `'none'`).
- `navigateToRoute(route, mode, knownRooms)` — async; resolves message lookup, finds the room (including archived), opens it, focuses thread/message.
- `applyInitialRoute(knownRooms)` — called by `init()` after room list loads; reads the initial URL.
- `routerOnHistory()` — called by the WS `history` handler after feed renders; applies any `pendingRoute`.
- `addMessageLinkAction(actions, msgId, threadId, roomId)` — injects a **Copy link** button into a message's action row.
- `showRouteNotFound(title, sub)` — shows a "room not found" state in the empty-state box.
- `messagePermalink(msgId, threadId, roomId)` — builds the full absolute URL for a message.

### `popstate` handler
Browser back/forward fires `popstate`. The handler re-applies the URL to open the right room/thread without adding another history entry (`mode = 'none'`).

### Not-found states
- **Room not found:** room was deleted or not accessible → `showRouteNotFound()`, URL reset to `/`
- **Message not found:** `GET /api/messages/:id` returns 404 → toast `"Message not found — it may have been deleted"`, routing continues without the `?m=` focus

### Server-side counterpart (`server.js`)
`APP_ROUTE_RE = /^\/r\/\d{1,15}(?:\/t\/\d{1,15})?\/?\$/` — matches only digit-only IDs. These paths serve `index.html` directly without touching the filesystem (no traversal risk). Login at a permalink URL shows the login overlay on the same URL (no redirect), so the permalink survives sign-in.

---

## Build Process

### Development
No build step — load CSS/JS directly from `<link>`/`<script>` tags.

### Production
`public/dist/` is **not in git** (`.gitignore` `dist/`): a tracked bundle went dirty on every
`npm run build` in other installs and broke their next `git pull`.

With `NODE_ENV=production`, `server.js` builds it on every start via `bootAppBundle()`
(`build/build.js`): the `{{APP_CSS}}` / `{{APP_JS}}` blocks of `index.html` are concatenated in
order and minified with esbuild `transformSync` (no bundling, so top-level JS names stay global
for inline handlers) into:
- `public/dist/stoa.min.css`
- `public/dist/stoa.min.js`

Both files are written to temp names and renamed only after both minified, so a failed build
leaves no half-new pair. `serveIndex` swaps in the bundle tags only when `appBundleReady` (this
start built it); otherwise — dev, smoke boot, or `[build] App bundle FAILED` — it serves the
per-module tags, never a stale bundle. Skipped on `STOA_SMOKE_BOOT` (Easy Update's test boot
runs from the live checkout). `esbuild` is therefore a runtime `dependency`, not dev-only.

`npm run build` still exists (vendor bundles in `public/vendor/`, which *are* tracked, plus the
app bundle). The pre-commit hook no longer rebuilds or stages anything.

The agent bundle (`dist/stoa.js`) is **not** built by `npm run build` by default: the live server
reads it per request for `/api/client/manifest`, so a build from a branch checkout would push
unmerged code to every agent. `server.js` rebuilds it on every start. Opt in with
`node build/build.js --agent` (`npm run build -- --agent`); honours `STOA_AGENT_BUNDLE_DIR`.

---

## Agent CLI versions & model listing

- **CLI versions** (Settings → agent detail, `public/js/settings/agents.js`): one row per installed harness from `actor.harness_status`, with an Update button → `POST /api/agents/:id/harnesses/:name/update`. State lives in `sCliUpdateState` (`actorId:harness`), fed by the global WS `harness_update_status` (`sHandleHarnessUpdateStatus`) and seeded from `harness_status[].update` on load/`actor_status` (`sSyncCliUi`). A local `requested` state covers the HTTP round-trip; only a live state or the same `request_id` may replace it. `allActors[].online` goes stale on disconnect, so buttons read `sCliOnline` (set from every `actor_status`).
- Rows are a 4-column grid (`.s-cli-row { display: contents }`) so every Update button lines up; a container query on `.s-cli-group` switches to 2 columns under 560px of panel width (the settings sidebar eats viewport width, so a viewport media query is wrong here).
- **Unlisted models**: model items carry `listed` (false = the agent's CLI no longer lists it). They are never filtered out — a model missing from the CLI list can still run. `modelListedOnAgent()` / `withAgentListed()` in `composer/models.js` read it per agent; the composer dropdown shows a quiet "not listed" tag, `<select>`s and the room tier picker append `MODEL_UNLISTED_SUFFIX` with `MODEL_UNLISTED_HINT` as the tooltip.
- Custom Claude models (Settings → Platforms card, `/api/settings/custom-models*`) were removed: models the CLI knows come from the harness scan instead.
