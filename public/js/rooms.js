// ── Chat header ────────────────────────────────────────────────────────────
function renderChatHeader(room, participants) {
  const header = document.getElementById('chat-header');
  header.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.id = 'mobile-back';
  backBtn.setAttribute('aria-label', 'back to rooms');
  backBtn.innerHTML = '&#8592;';
  backBtn.onclick = () => document.body.classList.remove('in-chat');
  header.appendChild(backBtn);

  if (document.body.classList.contains('sidebar-collapsed')) {
    const roomsToggle = document.createElement('button');
    roomsToggle.className = 'h-rooms-toggle';
    roomsToggle.title = 'Show room list';
    roomsToggle.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/></svg>`;
    roomsToggle.onclick = () => toggleSidebar();
    header.appendChild(roomsToggle);
  }

  const info = document.createElement('div');
  info.className = 'h-header-info';

  const name = document.createElement('div');
  name.className = 'h-room-name';
  name.textContent = room.title;
  name.title = 'Click to rename';
  name.onclick = () => {
    name.contentEditable = 'true';
    name.classList.add('editing');
    name.focus();
    const range = document.createRange();
    range.selectNodeContents(name);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  async function commitRename() {
    name.contentEditable = 'false';
    name.classList.remove('editing');
    const newTitle = name.textContent.trim();
    if (newTitle && newTitle !== room.title) {
      const oldTitle = room.title;
      room.title = newTitle;
      try {
        const r = await fetch(`/api/rooms/${room.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        });
        if (!r.ok) throw new Error('rename failed');
      } catch { showToast('Failed to rename room', { error: true }); room.title = oldTitle; name.textContent = oldTitle; }
    } else {
      name.textContent = room.title;
    }
  }
  name.addEventListener('blur', commitRename);
  name.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
    if (e.key === 'Escape') { name.textContent = room.title; name.blur(); }
  });
  info.appendChild(name);

  const tagline = document.createElement('div');
  tagline.className = 'h-room-tagline';
  const n = participants.length;
  tagline.textContent = n === 1 ? 'one voice.' : n === 2 ? 'two voices.' : n + ' voices.';
  const modelLabel = formatModelName(room.workdir_model);
  if (modelLabel) {
    const badge = document.createElement('span');
    badge.className = 'h-model-badge';
    badge.textContent = modelLabel;
    tagline.appendChild(badge);
  }
  info.appendChild(tagline);

  header.appendChild(info);

  const sealsWrap = document.createElement('div');
  sealsWrap.className = 'h-header-seals';
  for (const p of participants) {
    const wrap = document.createElement('div');
    wrap.className = 'h-header-seal';
    wrap.appendChild(makeAvatar(p.name, p.avatar_color, p.avatar_url, 26));
    sealsWrap.appendChild(wrap);
  }

  const addWrap = document.createElement('div');
  addWrap.style.cssText = 'position:relative;display:inline-flex';

  const addBtn = document.createElement('button');
  addBtn.className = 'h-add-participant';
  addBtn.textContent = '+';
  addBtn.title = 'Add participant';

  const dropdown = document.createElement('div');
  dropdown.className = 'h-add-dropdown';

  addBtn.onclick = (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains('open')) {
      dropdown.classList.remove('open');
      return;
    }
    dropdown.innerHTML = '';
    const currentIds = new Set(participants.map(p => p.actor_id));
    const available = allActors.filter(a => !currentIds.has(a.id));
    if (!available.length) {
      const empty = document.createElement('div');
      empty.className = 'h-add-dropdown-empty';
      empty.textContent = 'No participants to add';
      dropdown.appendChild(empty);
    } else {
      for (const actor of available) {
        const item = document.createElement('div');
        item.className = 'h-add-dropdown-item';
        item.appendChild(makeAvatar(actor.name, actor.avatar_color, actor.avatar_url, 20));
        const label = document.createElement('span');
        label.textContent = actor.name;
        item.appendChild(label);
        item.onclick = async (ev) => {
          ev.stopPropagation();
          dropdown.classList.remove('open');
          try {
            await fjson(`/api/rooms/${currentRoomId}/participants`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ actor_id: actor.id }),
            });
          } catch { showToast('Failed to add participant', { error: true }); }
        };
        dropdown.appendChild(item);
      }
    }
    dropdown.classList.add('open');
    setTimeout(() => {
      document.addEventListener('click', () => dropdown.classList.remove('open'), { once: true });
    }, 0);
  };

  addWrap.appendChild(addBtn);
  addWrap.appendChild(dropdown);
  sealsWrap.appendChild(addWrap);
  header.appendChild(sealsWrap);

  // Search button
  const searchBtn = document.createElement('button');
  searchBtn.className = 'h-header-action-btn';
  searchBtn.title = 'Search in room';
  searchBtn.style.marginLeft = '8px';
  searchBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  searchBtn.onclick = () => toggleRoomSearch();
  header.appendChild(searchBtn);

  // Export button
  const exportWrap = document.createElement('div');
  exportWrap.style.cssText = 'position:relative;display:inline-flex;margin-left:8px';
  const exportBtn = document.createElement('button');
  exportBtn.className = 'h-header-action-btn';
  exportBtn.title = 'Export conversation';
  exportBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v9M5 8l3 3 3-3"/><path d="M3 13h10"/></svg>`;
  const exportDrop = document.createElement('div');
  exportDrop.className = 'h-export-dropdown';
  exportDrop.innerHTML = `
    <button class="h-export-opt" data-fmt="json">JSON</button>
    <button class="h-export-opt" data-fmt="csv">CSV</button>`;
  exportBtn.onclick = (e) => {
    e.stopPropagation();
    exportDrop.classList.toggle('open');
    setTimeout(() => document.addEventListener('click', () => exportDrop.classList.remove('open'), { once: true }), 0);
  };
  exportDrop.querySelectorAll('.h-export-opt').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      exportDrop.classList.remove('open');
      const fmt = btn.dataset.fmt;
      const a = document.createElement('a');
      a.href = `/api/rooms/${room.id}/export?format=${fmt}`;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
  });
  exportWrap.appendChild(exportBtn);
  exportWrap.appendChild(exportDrop);
  header.appendChild(exportWrap);

  const hasClaudeAgent = participants.some(p => p.type === 'ai' && p.adapter === 'claude');
  if (hasClaudeAgent) {
    const compactBtn = document.createElement('button');
    compactBtn.className = 'h-header-action-btn h-compact-btn';
    compactBtn.title = 'Compact sessions';
    compactBtn.style.marginLeft = '8px';
    compactBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l5-4 5 4"/><path d="M3 10l5 4 5-4"/></svg>`;
    compactBtn.onclick = () => {
      if (compactBtn.disabled) return;
      compactSessions(room.id);
    };
    header.appendChild(compactBtn);
  }

  const wsToggle = document.createElement('button');
  wsToggle.className = 'h-ws-toggle' + (document.getElementById('workspace-panel').classList.contains('open') ? ' active' : '');
  wsToggle.title = 'Dev Workspace';
  wsToggle.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M14 4v16"/></svg>`;
  wsToggle.onclick = toggleWorkspacePanel;
  header.appendChild(wsToggle);
}

// ── Compact sessions ──────────────────────────────────────────────────────
let compactingRoomId = null;

function compactSessions(roomId) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'compact_session', room_id: roomId }));
}

function showCompactBar(total, roomId) {
  compactingRoomId = roomId ?? currentRoomId;
  const bar = document.getElementById('compact-bar');
  const fill = document.getElementById('compact-fill');
  if (!bar || !fill) return;
  if (total <= 1) {
    fill.style.width = '100%';
    fill.classList.add('indeterminate');
  } else {
    fill.style.width = '0%';
    fill.classList.remove('indeterminate');
  }
  bar.classList.add('visible');
  document.querySelector('.h-composer-box')?.classList.add('ai-processing');
  document.getElementById('msg-input')?.blur();
  const btn = document.querySelector('.h-compact-btn');
  if (btn) { btn.disabled = true; btn.classList.add('active'); }
}

function updateCompactBar(completed, total) {
  const fill = document.getElementById('compact-fill');
  if (!fill) return;
  if (total > 1) {
    fill.classList.remove('indeterminate');
    fill.style.width = Math.round((completed / total) * 100) + '%';
  }
}

function hideCompactBar() {
  compactingRoomId = null;
  const bar = document.getElementById('compact-bar');
  const fill = document.getElementById('compact-fill');
  if (bar) bar.classList.remove('visible');
  if (fill) { fill.classList.remove('indeterminate'); fill.style.width = '0%'; }
  document.querySelector('.h-composer-box')?.classList.remove('ai-processing');
  document.getElementById('msg-input')?.focus();
  const btn = document.querySelector('.h-compact-btn');
  if (btn) { btn.disabled = false; btn.classList.remove('active'); }
}

// ── Composer seal ──────────────────────────────────────────────────────────
function renderComposerSeal() {
  const el = document.getElementById('composer-seal');
  if (!el || !humanActor) return;
  el.innerHTML = '';
  el.appendChild(makeAvatar(humanActor.name, humanActor.avatar_color, humanActor.avatar_url, 24));
}

// ── Sidebar footer (human actor) ────────────────────────────────────────────
function renderSidebarFooter() {
  const footer = document.getElementById('sidebar-footer');
  if (!humanActor) return;
  footer.innerHTML = '';
  footer.appendChild(makeAvatar(humanActor.name, humanActor.avatar_color, humanActor.avatar_url, 22));
  const nameEl = document.createElement('span');
  nameEl.className = 'h-footer-name';
  nameEl.textContent = humanActor.name.toLowerCase();
  footer.appendChild(nameEl);
  const conn = document.createElement('span');
  conn.className = 'h-conn-status';
  conn.innerHTML = '<span class="h-conn-dot"></span><span class="h-conn-label">offline</span>';
  footer.appendChild(conn);
  const isDark = document.documentElement.classList.contains('dark');
  const themeBtn = document.createElement('button');
  themeBtn.id = 'theme-toggle';
  themeBtn.className = 'h-theme-btn';
  themeBtn.setAttribute('aria-label', 'toggle theme');
  themeBtn.title = isDark ? 'switch to light' : 'switch to dark';
  themeBtn.innerHTML = isDark ? SUN_SVG : MOON_SVG;
  themeBtn.onclick = toggleTheme;
  footer.appendChild(themeBtn);
}

// ── Room list ──────────────────────────────────────────────────────────────
let currentRoomTab = 'rooms';

function switchRoomTab(tab) {
  currentRoomTab = tab;
  document.getElementById('tab-rooms').classList.toggle('active', tab === 'rooms');
  document.getElementById('tab-archived').classList.toggle('active', tab === 'archived');
  document.getElementById('rooms-active-header').style.display = tab === 'rooms' ? '' : 'none';
  refreshRoomList();
}

function renderRoomList(rooms) {
  const list = document.getElementById('room-list');
  list.innerHTML = '';
  const isArchived = currentRoomTab === 'archived';
  for (const room of rooms) {
    const row = document.createElement('div');
    row.className = 'h-room-row' + (room.id === currentRoomId ? ' active' : '');
    row.dataset.roomId = room.id;

    if (isArchived) {
      row.classList.add('h-room-row-archived');
      const restoreBtn = document.createElement('div');
      restoreBtn.className = 'h-room-restore-btn';
      restoreBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>';
      restoreBtn.onclick = e => { e.stopPropagation(); restoreRoom(room); };
      row.appendChild(restoreBtn);
      const destroyBtn = document.createElement('div');
      destroyBtn.className = 'h-room-destroy-btn';
      destroyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      destroyBtn.onclick = e => { e.stopPropagation(); deleteRoom(room); };
      row.appendChild(destroyBtn);
    } else {
      const archiveBtn = document.createElement('div');
      archiveBtn.className = 'h-room-delete-btn';
      archiveBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';
      archiveBtn.onclick = e => { e.stopPropagation(); archiveRoom(room); };
      row.appendChild(archiveBtn);
    }

    const content = document.createElement('div');
    content.className = 'h-room-content';

    const top = document.createElement('div');
    top.className = 'h-room-row-top';

    const title = document.createElement('span');
    title.className = 'h-room-title-text';
    title.textContent = room.title;
    top.appendChild(title);

    const hasDraft = !!localStorage.getItem('stoa-draft-' + room.id);
    const time = document.createElement('span');
    time.className = 'h-room-time';
    if (hasDraft) {
      time.textContent = 'draft';
      time.style.color = '#d39749';
      time.style.fontWeight = '600';
    } else {
      time.textContent = (room.last_activity || room.created_at) ? relativeTime(room.last_activity || room.created_at) : (room.message_count + ' msg');
    }
    top.appendChild(time);

    const actionBtn = document.createElement('button');
    actionBtn.className = 'h-room-action';
    if (isArchived) {
      actionBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      actionBtn.title = 'Delete';
      actionBtn.style.color = '#c44';
      actionBtn.onclick = e => { e.stopPropagation(); deleteRoom(room); };

      const restoreActionBtn = document.createElement('button');
      restoreActionBtn.className = 'h-room-action';
      restoreActionBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>';
      restoreActionBtn.title = 'Restore';
      restoreActionBtn.onclick = e => { e.stopPropagation(); restoreRoom(room); };
      top.appendChild(restoreActionBtn);
    } else {
      actionBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';
      actionBtn.title = 'Archive';
      actionBtn.onclick = e => { e.stopPropagation(); archiveRoom(room); };
    }
    top.appendChild(actionBtn);

    content.appendChild(top);

    if (room.last_message) {
      const preview = document.createElement('div');
      preview.className = 'h-room-preview';
      const plain = room.last_message.replace(/[#*_~`>\[\]()!]/g, '').replace(/\n+/g, ' ').trim();
      preview.textContent = room.last_message_actor
        ? `${room.last_message_actor}: ${plain}`
        : plain;
      content.appendChild(preview);
    }

    const dots = document.createElement('div');
    dots.className = 'h-room-dots';
    dots.id = 'room-dots-' + room.id;
    content.appendChild(dots);

    row.appendChild(content);

    const cached = roomParticipantsCache[room.id];
    if (cached) renderRoomDots(room.id, cached);

    content.onclick = () => { if (!row.classList.contains('swiped')) openRoom(room); };
    initRoomSwipe(row);
    list.appendChild(row);
  }

  if (isArchived && rooms.length) {
    const delAll = document.createElement('div');
    delAll.style.cssText = 'text-align:center;padding:12px 0 4px';
    const delBtn = document.createElement('button');
    delBtn.style.cssText = 'background:transparent;border:1px solid var(--h-hairline);border-radius:6px;padding:5px 14px;font-family:var(--h-sans);font-size:12px;color:#c44;cursor:pointer';
    delBtn.textContent = 'delete all archived';
    delBtn.onclick = async () => {
      if (!confirm(`Delete all ${rooms.length} archived rooms? This cannot be undone.`)) return;
      try {
        for (const r of rooms) {
          const res = await fetch(`/api/rooms/${r.id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('delete failed');
        }
      } catch { showToast('Failed to delete all archived rooms', { error: true }); }
      refreshRoomList();
    };
    delAll.appendChild(delBtn);
    list.appendChild(delAll);
  }
}

function initRoomSwipe(row) {
  let startX = 0, startY = 0, dragging = false;
  const onStart = e => {
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX; startY = pt.clientY; dragging = true;
  };
  const onMove = e => {
    if (!dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - startX;
    const dy = pt.clientY - startY;
    if (Math.abs(dy) > Math.abs(dx)) { dragging = false; return; }
    if (dx > 30) {
      dragging = false;
      closeAllSwipes();
      row.classList.add('swiped');
    } else if (dx < -20 && row.classList.contains('swiped')) {
      dragging = false;
      row.classList.remove('swiped');
    }
  };
  const onEnd = () => { dragging = false; };
  row.addEventListener('touchstart', onStart, { passive: true });
  row.addEventListener('touchmove', onMove, { passive: true });
  row.addEventListener('touchend', onEnd);
}

function closeAllSwipes() {
  document.querySelectorAll('.h-room-row.swiped').forEach(r => r.classList.remove('swiped'));
}
document.addEventListener('click', e => {
  if (!e.target.closest('.h-room-row')) closeAllSwipes();
});

// Long-press to show message actions on mobile
(function() {
  let timer = null;
  let activeRow = null;
  const inner = document.getElementById('messages-inner');
  if (!inner) return;
  inner.addEventListener('touchstart', e => {
    const row = e.target.closest('.h-msg-row');
    if (!row || e.target.closest('.h-msg-action-btn')) return;
    timer = setTimeout(() => {
      document.querySelectorAll('.h-msg-row.show-actions').forEach(r => r.classList.remove('show-actions'));
      row.classList.add('show-actions');
      activeRow = row;
    }, 500);
  }, { passive: true });
  inner.addEventListener('touchend', () => clearTimeout(timer));
  inner.addEventListener('touchmove', () => clearTimeout(timer));
  document.addEventListener('click', e => {
    if (activeRow && !e.target.closest('.h-msg-actions')) {
      activeRow.classList.remove('show-actions');
      activeRow = null;
    }
  });
})();

async function archiveRoom(room) {
  try {
    const res = await fetch(`/api/rooms/${room.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) });
    if (!res.ok) throw new Error('archive failed');
  } catch { showToast('Failed to archive room', { error: true }); return; }
  if (currentRoomId === room.id) {
    currentRoomId = null;
    document.getElementById('messages-inner').innerHTML = '';
    document.getElementById('chat-header').innerHTML = '';
  }
  refreshRoomList();
}

async function restoreRoom(room) {
  try {
    const res = await fetch(`/api/rooms/${room.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: false }) });
    if (!res.ok) throw new Error('restore failed');
  } catch { showToast('Failed to restore room', { error: true }); return; }
  refreshRoomList();
}

async function deleteRoom(room) {
  if (!confirm(`Delete "${room.title}"? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/rooms/${room.id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('delete failed');
  } catch { showToast('Failed to delete room', { error: true }); return; }
  if (currentRoomId === room.id) {
    currentRoomId = null;
    document.getElementById('messages-inner').innerHTML = '';
    document.getElementById('chat-header').innerHTML = '';
  }
  refreshRoomList();
}

function renderRoomDots(roomId, participants) {
  const container = document.getElementById('room-dots-' + roomId);
  if (!container) return;
  container.innerHTML = '';
  for (const p of participants) {
    const dot = document.createElement('span');
    dot.className = 'h-actor-dot';
    dot.style.background = p.avatar_color;
    dot.title = p.name;
    container.appendChild(dot);
  }
}

// ── Open room ──────────────────────────────────────────────────────────────
async function openRoom(room) {
  if (settingsOpen) {
    settingsOpen = false;
    sStopPolling();
    document.getElementById('settings-row').classList.remove('active');
    document.getElementById('settings-inner').classList.remove('visible');
  }
  closeRoomSearch();
  // Save draft from previous room
  saveDraft(currentRoomId);
  if (window.stopVoiceRecognition) window.stopVoiceRecognition();

  currentRoomId = room.id;
  currentRoomWorkdirId = room.workdir_id || null;
  // Apply compact state: hide bar if switching away from compacting room
  if (compactingRoomId && compactingRoomId !== room.id) {
    const bar = document.getElementById('compact-bar');
    const fill = document.getElementById('compact-fill');
    if (bar) bar.classList.remove('visible');
    if (fill) { fill.classList.remove('indeterminate'); fill.style.width = '0%'; }
    compactingRoomId = null;
  }
  clearComposerProcessing();

  document.querySelectorAll('.h-room-row').forEach(el => {
    el.classList.toggle('active', el.dataset.roomId == room.id);
  });

  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('chat-inner').classList.add('visible');
  document.body.classList.add('in-chat');

  // Restore draft for this room
  restoreDraft(room.id);

  document.getElementById('messages-inner').innerHTML = '';
  Object.keys(streaming).forEach(k => delete streaming[k]);

  let parts = [];
  try {
    parts = await fjson(`/api/rooms/${room.id}/participants`);
  } catch {
    setConnected(false);
    setTimeout(() => openRoom(room), 3000);
    return;
  }
  roomParticipantsCache[room.id] = parts;
  renderRoomDots(room.id, parts);
  renderChatHeader(room, parts);
  renderComposerSeal();
  fjson(`/api/rooms/${room.id}/skills`).then(s => { allSkills = s; }).catch(e => { allSkills = []; console.error('Failed to load skills for room', room.id, e); });

  connectWS(room.id);
}

