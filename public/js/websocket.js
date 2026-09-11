// ── WebSocket ──────────────────────────────────────────────────────────────
let wsReconnectDelay = 3000;
window.currentBusyInputMode = 'interrupt';

function _updateQueuePill(n) {
  const pill = document.getElementById('queue-pill');
  if (!pill) return;
  if (n > 0) {
    pill.textContent = n + (n === 1 ? ' message queued' : ' messages queued');
    pill.classList.add('visible');
  } else {
    pill.classList.remove('visible');
  }
}

function connectWS(roomId) {
  if (ws) { ws.onclose = null; ws.close(); }
  setConnected(false);
  window.currentBusyInputMode = 'interrupt';
  _updateQueuePill(0);

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
    resetDaySeparator();
    if (typeof clearThreadSummaries === 'function') clearThreadSummaries();
    if (typeof clearThreadPanel === 'function') clearThreadPanel();
    msg.messages.forEach(m => appendMessage(m));
    // Attach thread chips and make roots clickable
    if (typeof attachThreadChips === 'function') attachThreadChips(msg.messages);
    msg.messages.forEach(m => {
      if (!m.thread_id && typeof makeFeedMessageClickable === 'function') makeFeedMessageClickable(m.id);
    });
    initDayFloater();
    if (msg.messages.length > 0) oldestMessageId = msg.messages[0].id;
    noMoreOlder = msg.messages.length < 100;
    for (const m of msg.messages) {
      if (m.state === 'streaming' || m.state === 'requesting') {
        showThinking(m.id, m.actor_name, m.avatar_color, m.avatar_symbol, m.avatar_url);
        setComposerProcessing(m.id);
      }
    }
    scrollToBottom(true);
    // Check if there's a deep-link thread param
    if (typeof checkThreadDeepLink === 'function') checkThreadDeepLink();
    return;
  }

  if (msg.type === 'message_new') {
    const m = msg.message;
    const tId = m.thread_id || null;
    if (tId) {
      // Update chip in feed for this thread's root
      if (msg.thread_summary && typeof handleThreadSummary === 'function') handleThreadSummary(msg.thread_summary);
      // Route to open thread panel if it matches
      if (typeof activeThreadId !== 'undefined' && activeThreadId === tId) {
        const body = document.getElementById('thread-body');
        appendMessage(m, body);
        if (typeof _scrollThreadToBottom === 'function') _scrollThreadToBottom();
      }
    } else {
      appendMessage(m);
      // Make new root message clickable
      if (typeof makeFeedMessageClickable === 'function') makeFeedMessageClickable(m.id);
      scrollToBottom(true);
    }
    return;
  }

  if (msg.type === 'thread_summary') {
    if (typeof handleThreadSummary === 'function') handleThreadSummary(msg);
    return;
  }

  if (msg.type === 'system_event') {
    const dominated = ['requesting', 'idle'];
    if (dominated.includes(msg.status)) return;
    const liveStatus = getLiveStatus();
    // 'off' — skip display entirely (but still allow done-event cleanup below)
    if (liveStatus === 'off' && msg.status) return;
    // Route to thread panel or feed
    const tId = msg.thread_id || null;
    const inner = (tId && typeof activeThreadId !== 'undefined' && activeThreadId === tId)
      ? document.getElementById('thread-body')
      : document.getElementById('messages-inner');
    if (!inner) return;
    const baseName = msg.actor_name || 'Agent';
    const displayName = msg.sub_agent_label ? `${baseName} (${msg.sub_agent_label})` : baseName;
    const actorKey = msg.sub_agent_label ? `${baseName}:${msg.sub_agent_label}` : baseName;
    const last = inner.lastElementChild;
    const isOwnStatus = last?.classList.contains('h-system-event') && last.dataset.actor === actorKey && !last.dataset.done;
    if (!msg.status) {
      const isOwnDone = last?.classList.contains('h-system-event') && last.dataset.actor === actorKey;
      if (isOwnDone) {
        if (liveStatus === 'off') { last.remove(); } else { last.textContent = `${displayName} · selesai`; last.dataset.done = '1'; }
      }
      return;
    }
    // 'verb' — show only the first word of status
    const statusText = liveStatus === 'verb' ? msg.status.split(/\s+/)[0] : msg.status;
    if (isOwnStatus) {
      last.textContent = `${displayName} · ${statusText}`;
      return;
    }
    const el = document.createElement('div');
    el.className = 'h-system-event';
    el.dataset.actor = actorKey;
    el.textContent = `${displayName} · ${statusText}`;
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
      const tId = msg.thread_id || null;
      const targetContainer = (tId && typeof activeThreadId !== 'undefined' && activeThreadId === tId)
        ? document.getElementById('thread-body')
        : document.getElementById('messages-inner');
      const last = targetContainer?.lastElementChild;
      if (last?.classList.contains('h-system-event') && last.dataset.actor?.startsWith(msg.actor_name)) last.remove();
      showThinking(msg.message_id, msg.actor_name, msg.avatar_color, msg.avatar_symbol, msg.avatar_url, msg.sub_agent_label, targetContainer);
      setComposerProcessing(msg.message_id);
    }
    if (msg.state === 'error' || (typeof FAILURE_STATES !== 'undefined' && FAILURE_STATES.has(msg.state))) {
      const el = document.getElementById('msg-' + msg.message_id);
      if (el) {
        const bubble = el.querySelector('.h-bubble, .h-thinking-bubble');
        if (bubble) {
          bubble.classList.remove('streaming');
          if (bubble.classList.contains('h-thinking-bubble')) {
            bubble.classList.remove('h-thinking-bubble');
            bubble.classList.add('h-bubble');
          }
          bubble.innerHTML = '';
          const failDiv = document.createElement('div');
          failDiv.className = 'h-msg-fail';
          const exitLabel = msg.exit_reason || msg.state;
          const exitEntry = (typeof _RESULT_EXIT !== 'undefined' && _RESULT_EXIT[exitLabel]) || { glyph: '⚠', label: exitLabel };
          let text = exitEntry.glyph + ' ' + (msg.sub_agent_label ? msg.sub_agent_label + ' — ' : '') + exitEntry.label;
          if (msg.error_text) text += ': ' + msg.error_text;
          if (msg.duration_ms) text += ' (after ' + _fmtDuration(msg.duration_ms) + ')';
          failDiv.textContent = text;
          bubble.appendChild(failDiv);
        }
      }
      clearComposerProcessing(msg.message_id);
    }
    return;
  }

  if (msg.type === 'message_stream_reset') {
    const el = document.getElementById('msg-' + msg.message_id);
    if (el) {
      const bubble = el.querySelector('.h-bubble');
      if (bubble) { bubble.innerHTML = ''; bubble.classList.add('streaming'); }
    }
    return;
  }

  if (msg.type === 'message_token') {
    appendToken(msg.message_id, msg.token);
    // Scroll the right container
    if (msg.thread_id && typeof activeThreadId !== 'undefined' && activeThreadId === msg.thread_id) {
      if (typeof _scrollThreadToBottom === 'function') _scrollThreadToBottom();
    }
    return;
  }

  if (msg.type === 'message_complete') {
    finalizeMessage(msg.message_id, msg.content, msg.file_url, msg.file_name, msg.attachments, msg.ai_model, msg.result_meta);
    clearComposerProcessing(msg.message_id);
    // Update thread chip if this was a thread reply
    if (msg.thread_summary && typeof handleThreadSummary === 'function') handleThreadSummary(msg.thread_summary);
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
    if (getToolProgress() !== 'off') {
      appendToolStep(msg.message_id, msg.tool);
      wsScheduleRefresh();
    }
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
      }).catch(e => { console.error('[ws] actor_invited: failed to refresh participants', e); });
    }
    return;
  }

  if (msg.type === 'compact_start') {
    if (msg.room_id !== currentRoomId) return;
    const inThread = msg.thread_id && typeof activeThreadId !== 'undefined' && activeThreadId === msg.thread_id;
    if (inThread && typeof showThreadCompactBar === 'function') showThreadCompactBar(msg.participants);
    else showCompactBar(msg.room_id, msg.participants);
    return;
  }

  if (msg.type === 'compact_progress') {
    if (msg.room_id !== currentRoomId) return;
    const inThread = msg.thread_id && typeof activeThreadId !== 'undefined' && activeThreadId === msg.thread_id;
    if (inThread && typeof updateThreadCompactBar === 'function') updateThreadCompactBar(msg.completed_participant_ids);
    else updateCompactBar(msg.completed_participant_ids);
    return;
  }

  if (msg.type === 'compact_done') {
    if (msg.room_id !== currentRoomId) return;
    const inThread = msg.thread_id && typeof activeThreadId !== 'undefined' && activeThreadId === msg.thread_id;
    if (inThread && typeof hideThreadCompactBar === 'function') hideThreadCompactBar();
    else hideCompactBar();
    return;
  }

  if (msg.type === 'context_update') {
    // Route to thread context bar if update is for the open thread
    const inThread = msg.thread_id && typeof activeThreadId !== 'undefined' && activeThreadId === msg.thread_id;
    if (inThread && typeof threadContextState !== 'undefined' && typeof updateThreadContextBar === 'function') {
      threadContextState[msg.actor_id] = {
        context_tokens_used: msg.context_tokens_used,
        context_limit: msg.context_limit,
        actor_name: msg.actor_name,
        model: msg.model,
      };
      updateThreadContextBar();
    } else {
      handleContextUpdate(msg);
    }
    return;
  }

  if (msg.type === 'compact_error') {
    if (msg.room_id !== currentRoomId) return;
    const inThread = msg.thread_id && typeof activeThreadId !== 'undefined' && activeThreadId === msg.thread_id;
    if (inThread && typeof hideThreadCompactBar === 'function') hideThreadCompactBar();
    else hideCompactBar();
    showToast(msg.error || 'Compact failed', { error: true });
    return;
  }

  if (msg.type === 'server_restart') {
    handleServerRestart(msg);
    return;
  }

  if (msg.type === 'server_restarting') {
    handleServerRestarting();
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
    if (msg.error) {
      console.warn('[ws] file_read error:', msg.error);
      const f = wsOpenFiles.find(f => f.name === msg.path);
      if (f) { f.error = msg.error; f.loaded = false; }
      if (wsActiveView === 'file' && wsActiveFile === msg.path) wsRenderContent();
      return;
    }
    const panel = document.getElementById('workspace-panel');
    if (!panel.classList.contains('open')) toggleWorkspacePanel();
    if (msg.base64) {
      const ext = wsGetExt(msg.path);
      const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', ico:'image/x-icon', bmp:'image/bmp', pdf:'application/pdf' };
      const existing = wsOpenFiles.find(f => f.name === msg.path);
      if (existing) { existing.base64 = msg.base64; existing.loaded = true; }
      else wsOpenFiles.push({ name: msg.path, content: '', base64: msg.base64, ext, loaded: true });
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

  if (msg.type === 'room_model_changed') {
    if (typeof handleModelUpdate === 'function') handleModelUpdate(msg);
    if (typeof _setDropdownValue === 'function') {
      // model_config carries platform_id — pass it through so only the correct row is highlighted.
      const platformId = typeof parsePlatformId === 'function' ? parsePlatformId(msg.model_config) : null;
      _setDropdownValue(msg.model, null, platformId);
    }
    return;
  }

  if (msg.type === 'send_error') {
    console.warn('[send_error]', msg.error, msg.code);
    return;
  }

  if (msg.type === 'display_settings') {
    applyDisplaySettings(msg.room, msg.global);
    return;
  }

  if (msg.type === 'room_setting') {
    if (msg.key === 'busy_input_mode') window.currentBusyInputMode = msg.value || 'interrupt';
    applyRoomDisplaySetting(msg.key, msg.value);
    return;
  }

  if (msg.type === 'room_setting_ack') {
    if (msg.key === 'busy_input_mode') window.currentBusyInputMode = msg.value || 'interrupt';
    applyRoomDisplaySetting(msg.key, msg.value);
    return;
  }

  if (msg.type === 'queue_updated') {
    _updateQueuePill(msg.queued || 0);
    return;
  }
}

// ── Server restart (same-port) notification ──────────────────────────────
let _serverRestartPending = false;
function handleServerRestarting() {
  _serverRestartPending = true;
  if (typeof showAppNotice === 'function') showAppNotice('running');
}
function _onGlobalWsReconnectAfterRestart() {
  if (!_serverRestartPending) return;
  _serverRestartPending = false;
  if (typeof showAppNotice === 'function') showAppNotice('done');
  if (typeof sLoadProcessManager === 'function') sLoadProcessManager();
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

