// ── Open room ──────────────────────────────────────────────────────────────
let openRoomSeq = 0;

async function openRoom(room, opts = {}) {
  const seq = ++openRoomSeq;
  if (settingsOpen) {
    settingsOpen = false;
    sStopPolling();
    document.body.classList.remove('settings-mode');
    document.getElementById('settings-inner').classList.remove('visible');
    if (typeof setAppNavActive === 'function') setAppNavActive('inbox');
  }
  closeRoomSearch();
  if (typeof closeThread === 'function') closeThread({ history: 'none' });
  // Save draft from previous room
  saveDraft(currentRoomId);
  if (window.stopVoiceRecognition) window.stopVoiceRecognition();

  // The previous room's socket must not write into this room's feed while it loads.
  disconnectWS();
  currentRoomId = room.id;
  currentRoomData = room;
  currentRoomWorkdirId = room.workdir_id || null;
  routeWrite(room.id, null, opts.history || 'push');
  tasksOnRoomOpen(room);
  clearRouteNotFound();
  clearRoomDisplay();
  clearComposerProcessing();

  document.querySelectorAll('.h-room-row').forEach(el => {
    el.classList.toggle('active', el.dataset.roomId == room.id);
  });

  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('chat-inner').classList.add('visible');
  document.body.classList.add('in-chat');

  // Restore draft for this room
  restoreDraft(room.id);

  Object.keys(streaming).forEach(k => delete streaming[k]);
  Object.keys(runReplies).forEach(k => delete runReplies[k]);
  Object.keys(runSkillRefs).forEach(k => delete runSkillRefs[k]);
  if (!paintCachedFeed(room.id)) {
    document.getElementById('messages-inner').innerHTML = '';
    oldestMessageId = null;
    noMoreOlder = true;
  }

  const [partsRes, saRes] = await Promise.allSettled([
    fjson(`/api/rooms/${room.id}/participants`),
    fjson(`/api/rooms/${room.id}/sub-agents`),
  ]);
  if (seq !== openRoomSeq) return;
  if (partsRes.status === 'rejected') {
    setConnected(false);
    setTimeout(() => { if (seq === openRoomSeq) openRoom(room, opts); }, 3000);
    return;
  }
  const parts = partsRes.value;
  roomParticipantsCache[room.id] = parts;
  if (saRes.status === 'fulfilled') {
    roomSubAgentsCache[room.id] = saRes.value.linked || [];
  } else {
    roomSubAgentsCache[room.id] = [];
    console.error('[room] failed to load sub-agents', room.id, saRes.reason);
  }

  renderRoomDots(room.id, parts);
  renderChatHeader(room, parts);
  renderRoomSidebar(room, parts);
  renderComposerSeal();
  if (typeof updateModelSelector === 'function') updateModelSelector(room, parts);
  loadContextState(room.id);

  connectWS(room.id);
}

