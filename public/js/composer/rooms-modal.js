// ── Create room modal ───────────────────────────────────────────────────────
// prefix lets this be reused by both the new-room modal ('new-room') and the
// add-agent modal ('add-agent'), which share the same workdir-picker markup.
async function loadWorkdirsForActor(actorId, prefix = 'new-room') {
  const section = document.getElementById(`${prefix}-workdir-section`);
  const sel = document.getElementById(`${prefix}-workdir`);
  const newWdRow = document.getElementById(`${prefix}-new-workdir-row`);
  if (!actorId) { section.style.display = 'none'; return; }

  let workdirs;
  try { workdirs = await fjson(`/api/actors/${actorId}/workdirs`); } catch { workdirs = []; }
  sel.innerHTML = '';
  section.style.display = 'block';
  newWdRow.style.display = 'none';
  const nameCounts = {};
  workdirs.forEach(w => {
    const n = w.label || w.path.split(/[/\\]/).pop() || w.path;
    nameCounts[n] = (nameCounts[n] || 0) + 1;
  });
  workdirs.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.id;
    const basename = w.label || w.path.split(/[/\\]/).pop() || w.path;
    const wdName = nameCounts[basename] > 1 ? w.path : basename;
    opt.textContent = wdName + (w.is_default ? ' (default)' : '');
    if (w.is_default) opt.selected = true;
    sel.appendChild(opt);
  });

  sel.disabled = false;
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ new folder…';
  sel.appendChild(newOpt);
  const newWdInput = document.getElementById(`${prefix}-new-workdir-input`);
  if (workdirs.length === 0) {
    newOpt.selected = true;
    newWdRow.style.display = 'flex';
    if (newWdInput && !newWdInput.value) newWdInput.value = '~/';
  }

  // Remove old listener by cloning
  const newSel = sel.cloneNode(true);
  sel.parentNode.replaceChild(newSel, sel);
  newSel.addEventListener('change', () => {
    const showing = newSel.value === '__new__';
    newWdRow.style.display = showing ? 'flex' : 'none';
    if (showing && newWdInput && !newWdInput.value) newWdInput.value = '~/';
  });
}

async function openNewRoomModal() {
  try {
    const freshActors = await fjson('/api/actors');
    allActors = freshActors;
    actorByName = {};
    allActors.forEach(a => actorByName[a.name] = a);
  } catch { showToast('Failed to load agents', { error: true }); }
  if (!allActors.some(a => a.type === 'ai')) { openSettings(); return; }
  const modal = document.getElementById('new-room-modal');
  const nameInput = document.getElementById('new-room-name');
  const actorsEl = document.getElementById('new-room-actors');

  actorsEl.innerHTML = '';
  const aiActors = allActors.filter(a => a.type === 'ai');
  aiActors.forEach((actor, i) => {
    const label = document.createElement('label');
    label.className = 'h-actor-check';

    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'new-room-actor';
    rb.value = actor.id;
    if (i === 0) rb.checked = true;
    label.appendChild(rb);
    label.appendChild(makeAvatar(actor.name, actor.avatar_color, actor.avatar_url, 22));

    const name = document.createElement('span');
    name.className = 'h-actor-check-name';
    name.textContent = actor.name.toLowerCase();
    label.appendChild(name);

    actorsEl.appendChild(label);
  });

  nameInput.value = '';
  modal.style.display = 'flex';
  nameInput.focus();

  // Load workdirs for selected actor
  const firstAI = aiActors[0];
  if (firstAI) await loadWorkdirsForActor(firstAI.id);
  // Change listener on actor radio buttons
  document.querySelectorAll('#new-room-actors input[type=radio]').forEach(rb => {
    rb.addEventListener('change', () => loadWorkdirsForActor(rb.value));
  });
}

// Resolve the chosen workdir_id for a modal (by element prefix). When "+ new folder" is
// selected, creates the workdir on the agent first. Returns the id, or null if none chosen.
// Throws if the creation request fails (caller shows the error).
async function resolveWorkdirIdFromModal(prefix, actorId) {
  const wdSel = document.getElementById(`${prefix}-workdir`);
  const newWdInput = document.getElementById(`${prefix}-new-workdir-input`);
  if (wdSel && wdSel.value === '__new__' && newWdInput?.value.trim()) {
    if (!actorId) return null;
    const res = await fetch(`/api/actors/${actorId}/workdirs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: newWdInput.value.trim() })
    });
    if (!res.ok) throw new Error('workdir creation failed');
    const wd = await res.json();
    return wd.id;
  } else if (wdSel && wdSel.value && wdSel.value !== '__new__') {
    return parseInt(wdSel.value);
  }
  return null;
}

async function submitNewRoom() {
  const title = document.getElementById('new-room-name').value.trim();
  if (!title) return;

  const selected = document.querySelector('#new-room-actors input[type=radio]:checked');
  const participant_ids = selected ? [parseInt(selected.value)] : [];

  let workdir_id;
  try { workdir_id = await resolveWorkdirIdFromModal('new-room', selected?.value); }
  catch { alert('Failed to create working directory'); return; }

  if (!workdir_id) { alert('Please select a working directory'); return; }
  document.getElementById('new-room-modal').style.display = 'none';

  try {
    const room = await fjson('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, participant_ids, workdir_id }),
    });
    const rooms = await fjson('/api/rooms');
    renderRoomList(rooms);
    openRoom(room);
  } catch { showToast('Failed to create room', { error: true }); }
}

// ── Add agent modal ──────────────────────────────────────────────────────────
// Mirrors the new-room modal minus the room name; lists only AI agents not yet in
// the room, and adds the selected one (with a chosen workdir) to the current room.
let addAgentRoomId = null;

async function openAddAgentModal(roomId, participants) {
  addAgentRoomId = roomId;
  try {
    const freshActors = await fjson('/api/actors');
    allActors = freshActors;
    actorByName = {};
    allActors.forEach(a => actorByName[a.name] = a);
  } catch { showToast('Failed to load agents', { error: true }); return; }

  const currentIds = new Set((participants || []).map(p => p.actor_id));
  const available = allActors.filter(a => a.type === 'ai' && !currentIds.has(a.id));
  if (!available.length) { showToast('No agents to add', {}); return; }

  const actorsEl = document.getElementById('add-agent-actors');
  actorsEl.innerHTML = '';
  available.forEach((actor, i) => {
    const label = document.createElement('label');
    label.className = 'h-actor-check';
    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'add-agent-actor';
    rb.value = actor.id;
    if (i === 0) rb.checked = true;
    label.appendChild(rb);
    label.appendChild(makeAvatar(actor.name, actor.avatar_color, actor.avatar_url, 22));
    const name = document.createElement('span');
    name.className = 'h-actor-check-name';
    name.textContent = actor.name.toLowerCase();
    label.appendChild(name);
    actorsEl.appendChild(label);
  });

  document.getElementById('add-agent-modal').style.display = 'flex';

  await loadWorkdirsForActor(available[0].id, 'add-agent');
  document.querySelectorAll('#add-agent-actors input[type=radio]').forEach(rb => {
    rb.addEventListener('change', () => loadWorkdirsForActor(rb.value, 'add-agent'));
  });
}

async function submitAddAgent() {
  if (!addAgentRoomId) return;
  const selected = document.querySelector('#add-agent-actors input[type=radio]:checked');
  if (!selected) { alert('Please select an agent'); return; }
  const actor_id = parseInt(selected.value);

  let workdir_id;
  try { workdir_id = await resolveWorkdirIdFromModal('add-agent', selected.value); }
  catch { alert('Failed to create working directory'); return; }

  if (!workdir_id) { alert('Please select a working directory'); return; }
  const roomId = addAgentRoomId;
  document.getElementById('add-agent-modal').style.display = 'none';

  try {
    await fjson(`/api/rooms/${roomId}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_id, workdir_id }),
    });
  } catch { showToast('Failed to add agent', { error: true }); }
}

