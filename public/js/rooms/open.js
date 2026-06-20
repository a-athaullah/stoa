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
    hideCompactBar();
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
  if (typeof updateModelSelector === 'function') updateModelSelector(room, parts);
  fjson(`/api/rooms/${room.id}/skills`).then(s => { allSkills = s; }).catch(e => { allSkills = []; console.error('Failed to load skills for room', room.id, e); });

  connectWS(room.id);
}

