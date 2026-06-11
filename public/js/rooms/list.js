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
  const hasPinned = !isArchived && rooms.some(r => r.is_pinned);
  let addedDivider = false;

  if (hasPinned) {
    const header = document.createElement('div');
    header.className = 'h-room-section-header';
    header.textContent = 'Pinned';
    list.appendChild(header);
  }

  for (const room of rooms) {
    if (hasPinned && !room.is_pinned && !addedDivider) {
      addedDivider = true;
      const divider = document.createElement('div');
      divider.className = 'h-room-section-divider';
      list.appendChild(divider);
    }

    const row = document.createElement('div');
    row.className = 'h-room-row' + (room.id === currentRoomId ? ' active' : '') + (room.is_pinned ? ' pinned' : '');
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
      const pinMobileBtn = document.createElement('div');
      pinMobileBtn.className = 'h-room-pin-mobile-btn';
      pinMobileBtn.title = room.is_pinned ? 'Unpin' : 'Pin';
      pinMobileBtn.innerHTML = pinSvg(18);
      pinMobileBtn.onclick = e => { e.stopPropagation(); if (pinMobileBtn.disabled) return; pinMobileBtn.disabled = true; togglePinRoom(room, !room.is_pinned, pinMobileBtn); };
      row.appendChild(pinMobileBtn);
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

      const pinBtn = document.createElement('button');
      pinBtn.className = 'h-room-action h-room-pin-btn' + (room.is_pinned ? ' pinned' : '');
      pinBtn.title = room.is_pinned ? 'Unpin' : 'Pin';
      pinBtn.innerHTML = pinSvg(16);
      pinBtn.onclick = e => { e.stopPropagation(); if (pinBtn.disabled) return; pinBtn.disabled = true; togglePinRoom(room, !room.is_pinned, pinBtn); };
      top.appendChild(pinBtn);
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

function pinSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`;
}

async function togglePinRoom(room, pin, btn) {
  try {
    const res = await fetch(`/api/rooms/${room.id}/pin`, { method: pin ? 'POST' : 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || `Failed to ${pin ? 'pin' : 'unpin'} room`, { error: true });
      if (btn) btn.disabled = false;
      return;
    }
  } catch { showToast(`Failed to ${pin ? 'pin' : 'unpin'} room`, { error: true }); if (btn) btn.disabled = false; return; }
  const refreshed = await refreshRoomList();
  if (!refreshed && btn) btn.disabled = false;
}

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

