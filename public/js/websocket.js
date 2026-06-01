// ── WebSocket ──────────────────────────────────────────────────────────────
let wsReconnectDelay = 3000;

function connectWS(roomId) {
  if (ws) { ws.onclose = null; ws.close(); }
  setConnected(false);

  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);

  ws.onopen = () => {
    wsReconnectDelay = 3000;
    ws.send(JSON.stringify({ type: 'join_room', room_id: roomId }));
    ws.send(JSON.stringify({ type: 'file_list' }));
    ws.send(JSON.stringify({ type: 'git_diff' }));
    setConnected(true);
  };

  ws.onmessage = e => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    handleWsMessage(msg);
  };

  ws.onclose = () => {
    setConnected(false);
    setTimeout(() => { if (currentRoomId === roomId) connectWS(roomId); }, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, 30000);
  };

  ws.onerror = e => console.warn('[ws] error', e);
}

function handleWsMessage(msg) {
  if (msg.type === 'history') {
    const inner = document.getElementById('messages-inner');
    inner.innerHTML = '';
    oldestMessageId = null;
    noMoreOlder = false;
    msg.messages.forEach(m => appendMessage(m));
    if (msg.messages.length > 0) oldestMessageId = msg.messages[0].id;
    noMoreOlder = msg.messages.length < 100;
    for (const m of msg.messages) {
      if (m.state === 'streaming' || m.state === 'requesting') {
        showThinking(m.id, m.actor_name, m.avatar_color, m.avatar_symbol, m.avatar_url);
        setComposerProcessing(m.id);
      }
    }
    scrollToBottom(true);
    return;
  }

  if (msg.type === 'message_new') {
    appendMessage(msg.message);
    scrollToBottom(true);
    return;
  }

  if (msg.type === 'system_event') {
    const dominated = ['requesting', 'idle'];
    if (dominated.includes(msg.status)) return;
    const inner = document.getElementById('messages-inner');
    if (!inner) return;
    const el = document.createElement('div');
    el.className = 'h-system-event';
    el.textContent = `${msg.actor_name || 'Agent'} · ${msg.status}`;
    inner.appendChild(el);
    scrollToBottom();
    return;
  }

  if (msg.type === 'message_deleted') {
    const row = document.getElementById('msg-' + msg.message_id);
    if (row) row.remove();
    return;
  }

  if (msg.type === 'message_state') {
    if ((msg.state === 'requesting' || msg.state === 'streaming') && msg.actor_name) {
      showThinking(msg.message_id, msg.actor_name, msg.avatar_color, msg.avatar_symbol, msg.avatar_url);
      setComposerProcessing(msg.message_id);
    }
    if (msg.state === 'error') {
      const el = document.getElementById('msg-' + msg.message_id);
      if (el) {
        const bubble = el.querySelector('.h-bubble, .h-thinking-bubble');
        if (bubble) { bubble.classList.remove('streaming'); bubble.textContent = '(error responding)'; }
      }
      clearComposerProcessing(msg.message_id);
    }
    return;
  }

  if (msg.type === 'message_token') {
    appendToken(msg.message_id, msg.token);
    return;
  }

  if (msg.type === 'message_complete') {
    finalizeMessage(msg.message_id, msg.content, msg.file_url, msg.file_name, msg.attachments);
    clearComposerProcessing(msg.message_id);
    refreshRoomList();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'file_list' }));
      ws.send(JSON.stringify({ type: 'git_diff' }));
    }
    if (document.visibilityState !== 'visible') {
      const el = document.getElementById('msg-' + msg.message_id);
      const actorName = el?.querySelector('.h-msg-name')?.textContent || 'Agent';
      showDesktopNotif(actorName, msg.content?.slice(0, 120), currentRoomId);
    }
    return;
  }

  if (msg.type === 'message_tool') {
    appendToolStep(msg.message_id, msg.tool);
    wsScheduleRefresh();
    return;
  }

  if (msg.type === 'model_update') {
    handleModelUpdate(msg);
    return;
  }

  if (msg.type === 'invite_suggestion') {
    showInviteCard(msg);
    return;
  }

  if (msg.type === 'skill_invoked') {
    const inner = document.getElementById('messages-inner');
    if (!inner) return;
    const notice = document.createElement('div');
    notice.className = 'h-skill-notice';
    const targets = msg.targets.map(n => n.toLowerCase()).join(', ');
    notice.textContent = `/${msg.skill_name} → ${targets}`;
    inner.appendChild(notice);
    scrollToBottom();
    return;
  }

  if (msg.type === 'system_notice') {
    const inner = document.getElementById('messages-inner');
    if (!inner) return;
    const notice = document.createElement('div');
    notice.className = 'h-skill-notice';
    notice.textContent = msg.text;
    inner.appendChild(notice);
    scrollToBottom();
    return;
  }

  if (msg.type === 'participant_joined') {
    const actor = allActors.find(a => a.id === msg.actor_id);
    const name = actor ? actor.name : 'Someone';
    const now = new Date();
    const ts = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const inner = document.getElementById('messages-inner');
    if (inner) {
      const notice = document.createElement('div');
      notice.className = 'h-system-event';
      notice.textContent = `${name} invited to this room · ${ts}`;
      inner.appendChild(notice);
      scrollToBottom();
    }
    if (currentRoomId) {
      fjson(`/api/rooms/${currentRoomId}/participants`).then(parts => {
        roomParticipantsCache[currentRoomId] = parts;
        renderRoomDots(currentRoomId, parts);
        const room = { id: currentRoomId, title: document.querySelector('.h-room-name')?.textContent || '' };
        renderChatHeader(room, parts);
      }).catch(() => {});
    }
    return;
  }

  if (msg.type === 'compact_start') {
    showCompactBar(msg.total);
    return;
  }

  if (msg.type === 'compact_progress') {
    updateCompactBar(msg.completed, msg.total);
    return;
  }

  if (msg.type === 'compact_done') {
    hideCompactBar();
    return;
  }

  if (msg.type === 'compact_error') {
    hideCompactBar();
    showToast(msg.error || 'Compact failed', { error: true });
    return;
  }

  if (msg.type === 'server_restart') {
    handleServerRestart(msg);
    return;
  }

  if (msg.type === 'file_list') {
    if (msg.error) { console.warn('[ws] file_list error:', msg.error); return; }
    wsFileTreeData = msg.tree || [];
    wsFileTreeRoot = msg.root || '';
    wsModifiedFiles = new Set(msg.modified || []);
    if (wsActiveView === 'files') wsRenderContent();
    return;
  }

  if (msg.type === 'file_read') {
    if (msg.error) { console.warn('[ws] file_read error:', msg.error); return; }
    const panel = document.getElementById('workspace-panel');
    if (!panel.classList.contains('open')) toggleWorkspacePanel();
    if (msg.base64) {
      const ext = wsGetExt(msg.path);
      const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', ico:'image/x-icon', bmp:'image/bmp' };
      const existing = wsOpenFiles.find(f => f.name === msg.path);
      if (existing) existing.base64 = msg.base64;
      else wsOpenFiles.push({ name: msg.path, content: '', base64: msg.base64, ext });
      wsActiveFile = msg.path;
      wsActiveView = 'file';
      wsRenderTabs();
      wsRenderContent();
    } else {
      wsOpenFile(msg.path, msg.content);
      if (msg.mtime) wsFileMtimes[msg.path] = msg.mtime;
    }
    return;
  }

  if (msg.type === 'git_diff') {
    if (msg.error) { console.warn('[ws] git_diff error:', msg.error); return; }
    wsGitDiffData = msg.files || [];
    const gitTab = document.querySelector('[data-ws-pin="git"]');
    if (gitTab) {
      let badge = gitTab.querySelector('.ws-git-badge');
      if (wsGitDiffData.length) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'ws-git-badge'; gitTab.appendChild(badge); }
        badge.textContent = wsGitDiffData.length;
      } else if (badge) { badge.remove(); }
    }
    if (wsActiveView === 'git') wsRenderContent();
    return;
  }

  if (msg.type === 'file_write_result') {
    if (msg.ok) {
      wsEditDirty = false;
      const f = wsOpenFiles.find(f => f.name === wsActiveFile);
      if (f) f.content = wsEditContent;
      if (msg.mtime) wsFileMtimes[msg.path] = msg.mtime;
      const key = 'stoa-draft-' + (currentRoomId || '') + '-' + msg.path;
      try { localStorage.removeItem(key); } catch {}
      wsRenderTabs();
      wsShowToast('File saved', 'success');
    } else if (msg.error === 'conflict') {
      if (msg.current_mtime) wsFileMtimes[msg.path] = msg.current_mtime;
      wsShowDialog('File changed', '<strong>' + wsEscHtml(msg.path?.split('/').pop()) + '</strong> was modified externally while you were editing. Overwrite the disk version with your edits, or reload?',
        [{ label: 'Cancel', cls: 'ghost' },
         { label: 'Overwrite', cls: 'danger', action: () => { delete wsFileMtimes[msg.path]; wsSaveFile(); } },
         { label: 'Reload', cls: 'primary', action: () => { wsEditMode = false; wsEditDirty = false; ws.send(JSON.stringify({ type: 'file_read', path: msg.path })); } }]);
    } else {
      wsShowToast('Save failed — ' + (msg.error || 'unknown error'), 'error');
    }
    wsEditSaving = false;
    wsRenderToolbarActions();
    return;
  }

  if (msg.type === 'file_create_result') {
    if (msg.ok) {
      wsShowToast('Created ' + msg.path, 'success');
      if (ws) ws.send(JSON.stringify({ type: 'file_list' }));
    } else { wsShowToast('Create failed — ' + (msg.error || 'unknown'), 'error'); }
    return;
  }

  if (msg.type === 'file_delete_result') {
    if (msg.ok) {
      wsCloseFile(msg.path);
      wsShowToast('Deleted', 'success');
      if (ws) ws.send(JSON.stringify({ type: 'file_list' }));
    } else { wsShowToast('Delete failed — ' + (msg.error || 'unknown'), 'error'); }
    return;
  }

  if (msg.type === 'file_rename_result') {
    if (msg.ok) {
      const f = wsOpenFiles.find(f => f.name === msg.path);
      if (f) { f.name = msg.new_path; if (wsActiveFile === msg.path) wsActiveFile = msg.new_path; }
      wsRenderTabs();
      wsShowToast('Renamed', 'success');
      if (ws) ws.send(JSON.stringify({ type: 'file_list' }));
    } else { wsShowToast('Rename failed — ' + (msg.error || 'unknown'), 'error'); }
    return;
  }
}

// ── Server restart notification ───────────────────────────────────────────
let pendingRestartUrl = null;
function handleServerRestart(msg) {
  const safePort = String(msg.new_port).replace(/\D/g, '');
  pendingRestartUrl = safePort;
  const newOrigin = location.protocol + '//' + location.hostname + ':' + safePort;
  const banner = document.createElement('div');
  banner.className = 'h-restart-banner';
  banner.textContent = `Server berpindah ke port ${safePort}. `;
  const link = document.createElement('a');
  link.href = newOrigin + location.pathname;
  link.textContent = 'Buka di tab baru';
  banner.appendChild(link);
  banner.appendChild(document.createTextNode(' atau tunggu redirect otomatis...'));
  document.body.appendChild(banner);
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  if (globalWs) { globalWs.onclose = null; globalWs.close(); globalWs = null; }
  setTimeout(() => { location.href = newOrigin + location.pathname; }, 4000);
}

