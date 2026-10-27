// ── Open room ──────────────────────────────────────────────────────────────
async function openRoom(room, opts = {}) {
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

  currentRoomId = room.id;
  currentRoomData = room;
  currentRoomWorkdirId = room.workdir_id || null;
  routeWrite(room.id, null, opts.history || 'push');
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

  document.getElementById('messages-inner').innerHTML = '';
  Object.keys(streaming).forEach(k => delete streaming[k]);
  Object.keys(runReplies).forEach(k => delete runReplies[k]);

  let parts = [];
  try {
    parts = await fjson(`/api/rooms/${room.id}/participants`);
  } catch {
    setConnected(false);
    setTimeout(() => openRoom(room, opts), 3000);
    return;
  }
  roomParticipantsCache[room.id] = parts;

  try {
    const saData = await fjson(`/api/rooms/${room.id}/sub-agents`);
    roomSubAgentsCache[room.id] = saData.linked || [];
  } catch(e) {
    roomSubAgentsCache[room.id] = [];
    console.error('[room] failed to load sub-agents', room.id, e);
  }

  renderRoomDots(room.id, parts);
  renderChatHeader(room, parts);
  renderRoomSidebar(room, parts);
  renderComposerSeal();
  if (typeof updateModelSelector === 'function') updateModelSelector(room, parts);
  loadContextState(room.id);

  connectWS(room.id);
}

