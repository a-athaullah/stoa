// ── Search ──────────────────────────────────────────────────────────────────
// Shared by the global sidebar search and the in-room search bar.
function searchSnippetNode(r, className) {
  const el = document.createElement('div');
  el.className = className;
  if (r.snippet) el.innerHTML = DOMPurify.sanitize(r.snippet, { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: [] });
  else el.textContent = (r.content || '').slice(0, 200);
  return el;
}

function searchBadges(r) {
  const frag = document.createDocumentFragment();
  const rootId = r.thread_root_id || r.thread_id;
  if (rootId) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'h-search-badge h-search-badge-thread';
    btn.textContent = 'thread';
    btn.title = r.thread_root_preview ? `Open thread: ${r.thread_root_preview.slice(0, 80)}` : 'Open thread';
    btn.dataset.roomId = r.room_id;
    btn.dataset.threadId = rootId;
    frag.appendChild(btn);
  }
  if (r.match === 'semantic') {
    const tag = document.createElement('span');
    tag.className = 'h-search-badge h-search-badge-semantic';
    tag.textContent = 'related';
    tag.title = 'Matched by meaning, not by exact words';
    frag.appendChild(tag);
  }
  return frag;
}

// Accepts the array contract and a defensive { results, semantic } envelope.
function searchRows(body) {
  if (Array.isArray(body)) return body;
  return Array.isArray(body?.results) ? body.results : [];
}

function searchStateNode(className, text) {
  const el = document.createElement('div');
  el.className = className;
  el.setAttribute('role', 'status');
  el.textContent = text;
  return el;
}

{
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const searchClear = document.getElementById('search-clear');
  const roomList = document.getElementById('room-list');
  const roomsRow = document.querySelector('.h-rooms-row');
  let searchTimer = null;
  let searchCtl = null;

  function resetSearch() {
    clearTimeout(searchTimer);
    searchCtl?.abort();
    searchCtl = null;
    searchInput.value = '';
    searchClear.style.display = 'none';
    hideSearchResults();
  }

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    searchClear.style.display = q ? 'block' : 'none';
    clearTimeout(searchTimer);
    if (!q) { searchCtl?.abort(); searchCtl = null; hideSearchResults(); return; }
    searchTimer = setTimeout(() => doSearch(q), 250);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { resetSearch(); searchInput.blur(); }
  });

  searchClear.addEventListener('click', () => {
    resetSearch();
    searchInput.focus();
  });

  searchResults.addEventListener('click', e => {
    const badge = e.target.closest('.h-search-badge-thread');
    const item = e.target.closest('.h-search-result');
    if (!badge && !item) return;
    resetSearch();
    if (badge) {
      const threadId = Number(badge.dataset.threadId);
      goToMessage(Number(badge.dataset.roomId), threadId, threadId);
    } else {
      goToMessage(Number(item.dataset.roomId), Number(item.dataset.msgId), Number(item.dataset.threadId) || null);
    }
  });

  async function doSearch(q) {
    searchCtl?.abort();
    const ctl = new AbortController();
    searchCtl = ctl;
    searchResults.setAttribute('aria-busy', 'true');
    let rows;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=30`, { signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rows = searchRows(await res.json());
    } catch (err) {
      if (ctl.signal.aborted) return;
      rows = null;
    }
    if (searchCtl !== ctl) return;
    searchCtl = null;
    searchResults.removeAttribute('aria-busy');
    showSearchResults(q, rows);
  }

  function showSearchResults(q, rows) {
    roomList.style.display = 'none';
    roomsRow.style.display = 'none';
    searchResults.style.display = 'block';
    if (!rows) {
      searchResults.replaceChildren(searchStateNode('h-search-empty h-search-error', 'Search failed. Try again in a moment.'));
      return;
    }
    if (!rows.length) {
      searchResults.replaceChildren(searchStateNode('h-search-empty', `No results for “${q}”`));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const item = document.createElement('div');
      item.className = 'h-search-result';
      item.dataset.roomId = r.room_id;
      item.dataset.msgId = r.id;
      if (r.thread_id) item.dataset.threadId = r.thread_id;

      const head = document.createElement('div');
      head.className = 'h-search-room';
      const title = document.createElement('span');
      title.className = 'h-search-room-title';
      title.textContent = r.room_title || '';
      head.appendChild(title);
      if (r.archived_at) {
        const archived = document.createElement('span');
        archived.className = 'h-archived-badge';
        archived.textContent = 'archived';
        head.appendChild(archived);
      }
      head.appendChild(searchBadges(r));

      const meta = document.createElement('div');
      meta.className = 'h-search-meta';
      const actor = document.createElement('span');
      actor.className = 'h-search-actor';
      actor.textContent = r.actor_name || '';
      if (r.avatar_color) actor.style.color = r.avatar_color;
      const ts = r.created_at.endsWith('Z') ? r.created_at : r.created_at.replace(' ', 'T') + 'Z';
      const d = new Date(ts);
      const time = document.createElement('span');
      time.className = 'h-search-time';
      time.textContent = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
                         d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      meta.append(actor, time);

      item.append(head, meta, searchSnippetNode(r, 'h-search-snippet'));
      frag.appendChild(item);
    }
    searchResults.replaceChildren(frag);
  }

  function hideSearchResults() {
    searchResults.removeAttribute('aria-busy');
    searchResults.style.display = 'none';
    roomList.style.display = '';
    roomsRow.style.display = '';
  }
}

// ── In-room search ─────────────────────────────────────────────────────────
let roomSearchCtl = null;
let roomSearchDebounce = null;

function toggleRoomSearch() {
  const bar = document.getElementById('room-search-bar');
  const input = document.getElementById('room-search-input');
  const btn = document.querySelector('#chat-header .h-header-action-btn[title="Search in room"]');
  if (bar.classList.contains('visible')) {
    closeRoomSearch();
  } else {
    bar.classList.add('visible');
    if (btn) btn.classList.add('active');
    input.value = '';
    input.focus();
  }
}

function closeRoomSearch() {
  clearTimeout(roomSearchDebounce);
  roomSearchCtl?.abort();
  roomSearchCtl = null;
  const bar = document.getElementById('room-search-bar');
  bar.classList.remove('visible');
  const results = document.getElementById('room-search-results');
  results.classList.remove('visible');
  results.replaceChildren();
  const btn = document.querySelector('#chat-header .h-header-action-btn[title="Search in room"]');
  if (btn) btn.classList.remove('active');
  document.getElementById('room-search-count').textContent = '';
}

async function doRoomSearch(query) {
  const resultsEl = document.getElementById('room-search-results');
  const countEl = document.getElementById('room-search-count');
  roomSearchCtl?.abort();
  roomSearchCtl = null;
  const roomId = currentRoomId;
  if (!query.trim() || !roomId) {
    resultsEl.classList.remove('visible');
    resultsEl.replaceChildren();
    countEl.textContent = '';
    return;
  }
  const ctl = new AbortController();
  roomSearchCtl = ctl;
  let rows;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&room_id=${roomId}&limit=50`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = searchRows(await res.json());
  } catch {
    if (ctl.signal.aborted) return;
    rows = null;
  }
  if (roomSearchCtl !== ctl || currentRoomId !== roomId) return;
  roomSearchCtl = null;
  if (!rows) {
    countEl.textContent = 'search failed';
    resultsEl.replaceChildren(searchStateNode('h-room-search-state h-search-error', 'Search failed. Try again in a moment.'));
    resultsEl.classList.add('visible');
    return;
  }
  countEl.textContent = rows.length ? `${rows.length} found` : 'no results';
  if (!rows.length) {
    resultsEl.replaceChildren(searchStateNode('h-room-search-state', `No messages in this room match “${query.trim()}”`));
    resultsEl.classList.add('visible');
    return;
  }
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const item = document.createElement('div');
    item.className = 'h-room-search-result-item';
    item.dataset.roomId = r.room_id || roomId;
    item.dataset.msgId = r.id;
    if (r.thread_id) item.dataset.threadId = r.thread_id;
    const meta = document.createElement('div');
    meta.className = 'h-room-search-result-meta';
    const actor = document.createElement('span');
    actor.className = 'h-room-search-result-actor';
    actor.textContent = r.actor_name || '';
    if (r.avatar_color) actor.style.color = r.avatar_color;
    const time = document.createElement('span');
    time.className = 'h-room-search-result-time';
    time.textContent = relativeTime(r.created_at);
    meta.append(actor, time, searchBadges(r));
    item.append(meta, searchSnippetNode(r, 'h-room-search-result-snippet'));
    frag.appendChild(item);
  }
  resultsEl.replaceChildren(frag);
  resultsEl.classList.add('visible');
}

async function scrollToMessage(msgId) {
  const find = () => document.getElementById('messages-inner')?.querySelector('#msg-' + msgId);
  let el = find();
  if (!el && currentRoomId && oldestMessageId && msgId < oldestMessageId) {
    for (let i = 0; i < 20 && !el && !noMoreOlder; i++) {
      loadingOlder = false;
      await loadOlderMessages();
      el = find();
    }
  }
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.style.transition = 'background 0.3s';
  el.style.background = 'var(--h-flash)';
  setTimeout(() => { el.style.background = ''; }, 2000);
  return true;
}

(function() {
  const input = document.getElementById('room-search-input');
  const resultsEl = document.getElementById('room-search-results');
  input.addEventListener('input', () => {
    clearTimeout(roomSearchDebounce);
    roomSearchDebounce = setTimeout(() => doRoomSearch(input.value), 300);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeRoomSearch();
  });
  resultsEl.addEventListener('click', e => {
    const badge = e.target.closest('.h-search-badge-thread');
    const item = e.target.closest('.h-room-search-result-item');
    if (!badge && !item) return;
    resultsEl.classList.remove('visible');
    if (badge) {
      const threadId = Number(badge.dataset.threadId);
      goToMessage(Number(badge.dataset.roomId), threadId, threadId);
    } else {
      goToMessage(Number(item.dataset.roomId), Number(item.dataset.msgId), Number(item.dataset.threadId) || null);
    }
  });
  document.getElementById('room-search-close').onclick = closeRoomSearch;
})();
