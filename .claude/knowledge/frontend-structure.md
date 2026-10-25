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
