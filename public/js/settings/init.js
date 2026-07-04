function initGlobalWs() {
  let reconnectDelay = 3000;
  function connect() {
    globalWs = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);
    globalWs.onopen = () => {
      reconnectDelay = 3000;
      globalWs.send(JSON.stringify({ type: 'subscribe_global' }));
      refreshRoomList();
      if (typeof autoState !== 'undefined' && autoState.loaded) {
        autoState.loaded = false;
        if (document.getElementById('s-tab-automation')?.style.display !== 'none') {
          sLoadAutomationTab();
        }
      }
    };
    globalWs.onmessage = async e => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'actor_status') handleActorStatus(msg.actor);
      if (msg.type === 'agent_scan_complete') sFinishSetupSlip(msg.actor_id);
      if (msg.type === 'actor_removed') handleActorRemoved(msg.actor_id, msg.affected_rooms);
      if (msg.type === 'server_restart') handleServerRestart(msg);
      if (msg.type === 'room_deleted' || msg.type === 'room_archived') {
        if (currentRoomId === msg.room_id) {
          currentRoomId = null;
          document.getElementById('messages-inner').innerHTML = '';
          document.getElementById('chat-header').innerHTML = '';
        }
        refreshRoomList();
      }
      if (msg.type === 'room_restored' || msg.type === 'room_pinned' || msg.type === 'room_unpinned') {
        refreshRoomList();
      }
      if (msg.type === 'wa_qr' && typeof autoHandleWaQr === 'function') autoHandleWaQr(msg);
      if (msg.type === 'conn_status' && typeof autoHandleConnStatus === 'function') autoHandleConnStatus(msg);
      if (msg.type === 'model_update') handleModelUpdate(msg);
      if (msg.type === 'room_created' || msg.type === 'room_activity' || msg.type === 'room_updated') {
        if (msg.type === 'room_activity' && msg.room_id !== currentRoomId) {
          const roomEl = document.querySelector(`.h-room-row[data-room-id="${msg.room_id}"]`);
          const roomTitle = roomEl?.querySelector('.h-room-title-text')?.textContent || 'Room';
          showDesktopNotif(`New message in ${roomTitle}`, '', msg.room_id);
        }
        refreshRoomList();
      }
    };
    globalWs.onclose = () => { setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 1.5, 30000); };
    globalWs.onerror = e => console.warn('[globalWs] error', e);
  }
  connect();
}

async function refreshRoomList() {
  try {
    const isArchived = currentRoomTab === 'archived';
    const rooms = await fjson(`/api/rooms${isArchived ? '?archived=1' : ''}`);
    renderRoomList(rooms);
    if (rooms.length) {
      const ids = rooms.map(r => r.id).join(',');
      const grouped = await fjson(`/api/rooms/participants?ids=${ids}`);
      for (const room of rooms) {
        const parts = grouped[room.id] || [];
        roomParticipantsCache[room.id] = parts;
        renderRoomDots(room.id, parts);
      }
    }
    return true;
  } catch (e) { console.error('refreshRoomList failed:', e); return false; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshRoomList();
    if (typeof autoState !== 'undefined' && autoState.loaded) {
      autoState.loaded = false;
      if (document.getElementById('s-tab-automation')?.style.display !== 'none') {
        sLoadAutomationTab();
      }
    }
  }
});

function handleActorStatus(actor) {
  if (!actor) return;
  const existing = allActors.find(a => a.id === actor.id);
  if (actor.online) {
    if (existing) {
      Object.assign(existing, actor);
    } else {
      allActors.push(actor);
      actorByName[actor.name] = actor;
      syncNewRoomBtn();
    }
    // Update settings list row
    const existingRow = document.getElementById('s-row-' + actor.id);
    if (!existingRow) {
      // New actor — add to settings list
      if (!sRowStates.has(actor.id)) sRowStates.set(actor.id, { state: 'default', draft: actor.name });
      const list = document.getElementById('s-agents-list');
      if (list) list.prepend(sMakeRow({ ...actor }, true));
      settingsActors = allActors.filter(a => a.type !== 'human' || a.id === humanActor?.id);
    }
    // Update add panel if open and waiting
    if (sAddPanel?.phase === 'waiting' && actor.type === 'ai' && !sAddPanel.baselineIds?.has(String(actor.id))) {
      sAddPanel.phase = 'connected'; sAddPanel.newActor = actor;
      sStopPolling();
      const waiting = document.getElementById('s-waiting-pill');
      const panel = document.getElementById('s-add-panel');
      if (waiting) waiting.replaceWith(sMakeConnectedSlip(actor));
      else if (panel) panel.appendChild(sMakeConnectedSlip(actor));
      fjson(`/api/actors/${actor.id}/workdirs`).then(wds => { if (wds.length) sFinishSetupSlip(actor.id); }).catch(e => { console.error('Failed to load workdirs in handleActorStatus', e); });
    }
  }
  // Always update status dot and word
  const dot = document.getElementById('s-dot-' + actor.id);
  const word = document.getElementById('s-word-' + actor.id);
  if (dot) dot.className = actor.online ? 's-dot-on' : 's-dot-off';
  if (word) word.textContent = actor.online ? 'online' : 'offline';
  // Update version in sub text when agent reconnects with new version
  if (actor.client_version && actor.online) {
    const sub = document.querySelector(`#s-row-${actor.id} .s-agent-sub`);
    if (sub) {
      const text = sub.textContent;
      const vMatch = text.match(/· v[\d.]+/);
      if (vMatch) sub.textContent = text.replace(/· v[\d.]+/, `· v${actor.client_version}`);
      else sub.textContent = text.replace(/· joined/, `· v${actor.client_version} · joined`);
    }
  }
  // Update refresh/update button disabled state
  const row = document.getElementById('s-row-' + actor.id);
  if (row) {
    row.querySelectorAll('.s-icon-btn').forEach(btn => {
      if (btn.title === 'Rescan workdirs & skills' || btn.title === 'Force update agent code' ||
          btn.title === 'Offline') {
        btn.disabled = !actor.online;
        btn.title = actor.online
          ? (btn.title === 'Offline' ? 'Rescan workdirs & skills' : btn.title)
          : 'Offline';
      }
    });
  }
}

function handleActorRemoved(actorId, affectedRooms) {
  const actor = allActors.find(a => a.id === actorId);
  if (actor && actorByName[actor.name]) delete actorByName[actor.name];
  const idx = allActors.findIndex(a => a.id === actorId);
  if (idx >= 0) allActors.splice(idx, 1);
  settingsActors = settingsActors?.filter(a => a.id !== actorId);
  const sRow = document.getElementById('s-row-' + actorId);
  if (sRow) { sRow.style.maxHeight = '0'; sRow.style.padding = '0'; setTimeout(() => sRow.remove(), 220); }
  sRowStates.delete(actorId);
  syncNewRoomBtn();
  if (affectedRooms?.includes(currentRoomId)) {
    const cached = roomParticipantsCache[currentRoomId];
    if (cached) {
      roomParticipantsCache[currentRoomId] = cached.filter(p => p.actor_id !== actorId);
      const room = { id: currentRoomId, title: document.querySelector('.h-room-name')?.textContent || '' };
      renderChatHeader(room, roomParticipantsCache[currentRoomId] || []);
    }
  }
  refreshRoomList();
}

function initSettings() {
  document.getElementById('s-add-agent-btn').addEventListener('click', sOpenAddPanel);
  document.getElementById('s-mobile-back').addEventListener('click', closeSettingsToSidebar);

  // Tab clicks
  document.querySelectorAll('.s-tab[data-tab]').forEach(el => {
    el.addEventListener('click', () => sActivateTab(el.dataset.tab));
  });

  // Docs links inside other tabs — data-doc is the slug (without lang/ext)
  document.addEventListener('click', e => {
    const link = e.target.closest('.s-docs-link[data-doc]');
    if (!link) return;
    e.preventDefault();
    sActivateTab('docs');
    // strip possible extension, treat as slug
    const slug = link.dataset.doc.replace(/\.[a-z]{2}\.md$/, '').replace(/\.md$/, '');
    sOpenDoc(slug);
  });

  // Server tab saves
  document.getElementById('s-human-name-save').addEventListener('click', () => {
    const val = document.getElementById('s-human-name-input').value.trim();
    sSaveSetting('human_name', val || 'Human', 's-human-name-saved');
  });
  document.getElementById('s-public-url-save').addEventListener('click', () => {
    let val = document.getElementById('s-public-url-input').value.trim();
    try { const u = new URL(val); val = u.protocol + '//' + u.hostname; } catch {}
    document.getElementById('s-public-url-input').value = val;
    sSaveSetting('public_url', val, 's-public-url-saved');
  });
  document.getElementById('s-port-save').addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-port-input').value);
    if (!val || val < 1 || val > 65535 || val === sPort) return;
    if (!confirm(`Port akan diubah ke ${val}. Server akan restart dan browser akan redirect otomatis. Lanjutkan?`)) return;
    sSaveSetting('port', val, 's-port-saved');
  });
  document.getElementById('s-max-ai-turns-save').addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-max-ai-turns-input').value);
    if (!val || val < 1 || val > 100) return;
    sSaveSetting('max_ai_turns', val, 's-max-ai-turns-saved');
  });
  document.getElementById('s-max-concurrent-save').addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-max-concurrent-input').value);
    if (!val || val < 1 || val > 10) return;
    sSaveSetting('max_concurrent', val, 's-max-concurrent-saved');
  });
  document.getElementById('s-session-idle-ttl-save').addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-session-idle-ttl-input').value);
    if (!val || val < 1 || val > 60) return;
    sSaveSetting('session_idle_ttl', val, 's-session-idle-ttl-saved');
  });
  document.getElementById('s-compact-threshold-save')?.addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-compact-threshold-input').value);
    if (!val || val < 100 || val > 5000) return;
    sSaveSetting('auto_compact_threshold_kb', val, 's-compact-threshold-saved');
  });
  document.getElementById('s-cleanup-hour-save').addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-cleanup-hour-input').value);
    if (isNaN(val) || val < 0 || val > 23) return;
    sSaveSetting('cleanup_cron_hour', val, 's-cleanup-hour-saved');
  });
  document.getElementById('s-cleanup-age-save').addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-cleanup-age-input').value);
    if (!val || val < 1 || val > 720) return;
    sSaveSetting('cleanup_max_age_hours', val, 's-cleanup-age-saved');
  });
  document.getElementById("s-max-pinned-save").addEventListener("click", () => {
    const val = parseInt(document.getElementById("s-max-pinned-input").value);
    if (!val || val < 1 || val > 20) return;
    sSaveSetting("max_pinned_rooms", val, "s-max-pinned-saved");
  });
  ['s-human-name-input', 's-public-url-input', 's-port-input', 's-max-ai-turns-input', 's-max-concurrent-input', 's-session-idle-ttl-input', 's-cleanup-hour-input', 's-cleanup-age-input', 's-max-pinned-input'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') e.target.closest('.s-server-field').querySelector('.s-server-save').click();
    });
  });
  document.addEventListener('keydown', e => {
    if (!settingsOpen) return;
    if (e.key === 'Escape') {
      if (sAddPanel.open) { sCloseAddPanel(); e.preventDefault(); return; }
      for (const [id, rs] of sRowStates) {
        if (rs.state === 'renaming')       { sCancelRename(id); e.preventDefault(); return; }
        if (rs.state === 'confirm-delete') { sCancelDelete(id); e.preventDefault(); return; }
      }
    }
  });
  document.addEventListener('click', e => {
    if (!settingsOpen) return;
    for (const [id, rs] of sRowStates) {
      if (rs.state === 'confirm-delete') {
        const row = document.getElementById('s-row-' + id);
        if (row && !row.contains(e.target)) sCancelDelete(id);
      }
    }
  });

  // Avatar upload wiring
  const avatarDrop  = document.getElementById('s-avatar-drop');
  const avatarFile  = document.getElementById('s-avatar-file');
  const avatarRemove = document.getElementById('s-avatar-remove');
  if (avatarDrop && avatarFile) {
    avatarDrop.addEventListener('click', () => avatarFile.click());
    avatarDrop.addEventListener('dragover', e => { e.preventDefault(); avatarDrop.classList.add('drag-over'); });
    avatarDrop.addEventListener('dragleave', () => avatarDrop.classList.remove('drag-over'));
    avatarDrop.addEventListener('drop', e => {
      e.preventDefault();
      avatarDrop.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) sResizeAndUploadAvatar(file);
    });
    avatarFile.addEventListener('change', () => {
      const file = avatarFile.files[0];
      if (file) { sResizeAndUploadAvatar(file); avatarFile.value = ''; }
    });
  }
  if (avatarRemove) {
    avatarRemove.addEventListener('click', sRemoveAvatar);
  }

  // General tab: auth
  document.getElementById('s-auth-email-save').addEventListener('click', async () => {
    const email = document.getElementById('s-auth-email-input').value.trim();
    const errEl = document.getElementById('s-auth-error');
    errEl.textContent = '';
    try {
      const r = await fetch('/api/auth/email', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (r.ok) {
        const saved = document.getElementById('s-auth-email-saved');
        saved.classList.add('visible');
        setTimeout(() => saved.classList.remove('visible'), 2000);
      } else {
        errEl.textContent = await r.text();
      }
    } catch { errEl.textContent = 'Network error'; }
  });

  document.getElementById('s-auth-pw-save').addEventListener('click', async () => {
    const cur = document.getElementById('s-auth-cur-pw').value;
    const newPw = document.getElementById('s-auth-new-pw').value;
    const errEl = document.getElementById('s-auth-error');
    errEl.textContent = '';
    if (!cur || !newPw) { errEl.textContent = 'Fill both fields'; return; }
    if (newPw.length < 6) { errEl.textContent = 'New password must be at least 6 characters'; return; }
    try {
      const r = await fetch('/api/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: cur, new_password: newPw }),
      });
      if (r.ok) {
        document.getElementById('s-auth-cur-pw').value = '';
        document.getElementById('s-auth-new-pw').value = '';
        const saved = document.getElementById('s-auth-pw-saved');
        saved.classList.add('visible');
        setTimeout(() => saved.classList.remove('visible'), 2000);
      } else {
        errEl.textContent = await r.text();
      }
    } catch { errEl.textContent = 'Network error'; }
  });

  // Notification toggle
  document.getElementById('s-notif-toggle').addEventListener('click', () => {
    const toggle = document.getElementById('s-notif-toggle');
    notifEnabled = !notifEnabled;
    localStorage.setItem('stoa-notif', notifEnabled ? 'on' : 'off');
    toggle.classList.toggle('on', notifEnabled);
    if (notifEnabled) requestNotifPermission();
    const hint = document.getElementById('s-notif-hint');
    hint.textContent = notifEnabled ? 'You will be notified when agents respond in other rooms.' : 'Notifications are off.';
  });

  // Logout
  document.getElementById('s-logout-btn').addEventListener('click', doLogout);
}



