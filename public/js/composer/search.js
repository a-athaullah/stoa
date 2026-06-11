// ── Search ──────────────────────────────────────────────────────────────────
{
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const searchClear = document.getElementById('search-clear');
  const roomList = document.getElementById('room-list');
  const roomsRow = document.querySelector('.h-rooms-row');
  let searchTimer = null;

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    searchClear.style.display = q ? 'block' : 'none';
    clearTimeout(searchTimer);
    if (!q) { hideSearchResults(); return; }
    searchTimer = setTimeout(() => doSearch(q), 250);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { searchInput.value = ''; searchClear.style.display = 'none'; hideSearchResults(); searchInput.blur(); }
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    hideSearchResults();
    searchInput.focus();
  });

  async function doSearch(q) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=30`);
      if (!res.ok) { showToast('Search failed', { error: true }); return; }
      const rows = await res.json();
      showSearchResults(rows);
    } catch { showToast('Search failed', { error: true }); }
  }

  function showSearchResults(rows) {
    roomList.style.display = 'none';
    roomsRow.style.display = 'none';
    searchResults.style.display = 'block';
    if (!rows.length) {
      searchResults.innerHTML = '<div class="h-search-empty">No results found</div>';
      return;
    }
    searchResults.innerHTML = '';
    for (const r of rows) {
      const item = document.createElement('div');
      item.className = 'h-search-result';
      const ts = r.created_at.endsWith('Z') ? r.created_at : r.created_at.replace(' ', 'T') + 'Z';
      const time = new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
                   new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const archivedBadge = r.archived_at ? '<span class="h-archived-badge">archived</span>' : '';
      item.innerHTML =
        `<div class="h-search-room">${escHtml(r.room_title)}${archivedBadge}</div>` +
        `<div class="h-search-meta">` +
          `<span class="h-search-actor" style="color:${r.avatar_color || 'var(--h-ink)'}">${escHtml(r.actor_name)}</span>` +
          `<span class="h-search-time">${time}</span>` +
        `</div>` +
        `<div class="h-search-snippet">${escHtml(r.snippet).replace(/&lt;mark&gt;/g,'<mark>').replace(/&lt;\/mark&gt;/g,'</mark>')}</div>`;
      item.onclick = () => {
        searchInput.value = '';
        searchClear.style.display = 'none';
        hideSearchResults();
        navigateToMessage(r.room_id, r.id, r.room_title);
      };
      searchResults.appendChild(item);
    }
  }

  function hideSearchResults() {
    searchResults.style.display = 'none';
    roomList.style.display = '';
    roomsRow.style.display = '';
  }

  function navigateToMessage(roomId, msgId, roomTitle) {
    if (currentRoomId !== roomId) {
      openRoom({ id: roomId, title: roomTitle || 'Room' });
      setTimeout(() => scrollToMessage(msgId), 800);
    } else {
      scrollToMessage(msgId);
    }
  }
}

// ── In-room search ─────────────────────────────────────────────────────────
let roomSearchResults = [];
let roomSearchIdx = -1;

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
  const bar = document.getElementById('room-search-bar');
  bar.classList.remove('visible');
  const results = document.getElementById('room-search-results');
  results.classList.remove('visible');
  results.innerHTML = '';
  const btn = document.querySelector('#chat-header .h-header-action-btn[title="Search in room"]');
  if (btn) btn.classList.remove('active');
  document.getElementById('room-search-count').textContent = '';
}

async function doRoomSearch(query) {
  const resultsEl = document.getElementById('room-search-results');
  const countEl = document.getElementById('room-search-count');
  resultsEl.innerHTML = '';
  if (!query.trim() || !currentRoomId) {
    resultsEl.classList.remove('visible');
    countEl.textContent = '';
    return;
  }
  let rows;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&room_id=${currentRoomId}&limit=50`);
    if (!res.ok) throw new Error();
    rows = await res.json();
  } catch { countEl.textContent = 'search failed'; return; }
  countEl.textContent = rows.length ? `${rows.length} found` : 'no results';
  if (!rows.length) { resultsEl.classList.remove('visible'); return; }
  resultsEl.classList.add('visible');
  for (const r of rows) {
    const item = document.createElement('div');
    item.className = 'h-room-search-result-item';
    const meta = document.createElement('div');
    meta.className = 'h-room-search-result-meta';
    const actor = document.createElement('span');
    actor.className = 'h-room-search-result-actor';
    actor.textContent = r.actor_name;
    if (r.avatar_color) actor.style.color = r.avatar_color;
    const time = document.createElement('span');
    time.className = 'h-room-search-result-time';
    time.textContent = relativeTime(r.created_at);
    meta.appendChild(actor);
    meta.appendChild(time);
    const snippet = document.createElement('div');
    snippet.className = 'h-room-search-result-snippet';
    snippet.innerHTML = DOMPurify.sanitize(r.snippet);
    item.appendChild(meta);
    item.appendChild(snippet);
    item.onclick = () => {
      resultsEl.classList.remove('visible');
      scrollToMessage(r.id);
    };
    resultsEl.appendChild(item);
  }
}

async function scrollToMessage(msgId) {
  let el = document.getElementById('msg-' + msgId);
  if (!el && currentRoomId && oldestMessageId && msgId < oldestMessageId) {
    for (let i = 0; i < 20 && !el && !noMoreOlder; i++) {
      loadingOlder = false;
      await loadOlderMessages();
      el = document.getElementById('msg-' + msgId);
    }
  }
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'background 0.3s';
    el.style.background = 'color-mix(in srgb, #d39749 15%, transparent)';
    setTimeout(() => { el.style.background = ''; }, 2000);
  }
}

(function() {
  const input = document.getElementById('room-search-input');
  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => doRoomSearch(input.value), 300);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeRoomSearch();
  });
  document.getElementById('room-search-close').onclick = closeRoomSearch;
})();

