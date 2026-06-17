// ── Create room modal ───────────────────────────────────────────────────────
async function loadWorkdirsForActor(actorId) {
  const section = document.getElementById('new-room-workdir-section');
  const sel = document.getElementById('new-room-workdir');
  const newWdRow = document.getElementById('new-room-new-workdir-row');
  if (!actorId) { section.style.display = 'none'; return; }

  let workdirs;
  try { workdirs = await fjson(`/api/actors/${actorId}/workdirs`); } catch { workdirs = []; }
  sel.innerHTML = '';
  section.style.display = 'block';
  newWdRow.style.display = 'none';
  workdirs.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.id;
    const wdName = w.label || w.path.split('/').pop() || w.path;
    opt.textContent = wdName + (w.is_default ? ' (default)' : '');
    if (w.is_default) opt.selected = true;
    sel.appendChild(opt);
  });

  sel.disabled = false;
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ new folder…';
  sel.appendChild(newOpt);
  if (workdirs.length === 0) {
    newOpt.selected = true;
    newWdRow.style.display = 'flex';
  }

  // Remove old listener by cloning
  const newSel = sel.cloneNode(true);
  sel.parentNode.replaceChild(newSel, sel);
  newSel.addEventListener('change', () => {
    newWdRow.style.display = newSel.value === '__new__' ? 'flex' : 'none';
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

async function submitNewRoom() {
  const title = document.getElementById('new-room-name').value.trim();
  if (!title) return;

  const selected = document.querySelector('#new-room-actors input[type=radio]:checked');
  const participant_ids = selected ? [parseInt(selected.value)] : [];

  const wdSel = document.getElementById('new-room-workdir');
  const newWdInput = document.getElementById('new-room-new-workdir-input');
  let workdir_id = null;

  if (wdSel && wdSel.value === '__new__' && newWdInput?.value.trim()) {
    // Create new workdir on agent
    const selectedActor = document.querySelector('#new-room-actors input[type=radio]:checked');
    if (selectedActor) {
      try {
        const res = await fetch(`/api/actors/${selectedActor.value}/workdirs`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: newWdInput.value.trim() })
        });
        if (!res.ok) throw new Error('workdir creation failed');
        const wd = await res.json();
        workdir_id = wd.id;
      } catch { alert('Failed to create working directory'); return; }
    }
  } else if (wdSel && wdSel.value && wdSel.value !== '__new__') {
    workdir_id = parseInt(wdSel.value);
  }

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

