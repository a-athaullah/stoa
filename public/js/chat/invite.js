// ── Invite card ────────────────────────────────────────────────────────────
function showInviteCard(msg) {
  const inner = document.getElementById('messages-inner');
  if (!inner) return;

  const suggested = msg.suggested_actor;
  // Try to find the proposer from actorByName if server sends actor_name
  const proposer = msg.actor_name ? actorByName[msg.actor_name] : null;

  const card = document.createElement('div');
  card.className = 'h-invite-card';

  const label = document.createElement('div');
  label.className = 'h-invite-label';
  label.textContent = 'a suggestion from the room';
  card.appendChild(label);

  const title = document.createElement('div');
  title.className = 'h-invite-title';
  if (proposer) {
    title.innerHTML =
      `<span style="color:${proposer.avatar_color};font-style:italic">${escHtml(proposer.name)}</span>` +
      ` would like to invite ` +
      `<span style="color:${suggested.avatar_color};font-style:italic">${escHtml(suggested.name)}</span>.`;
  } else {
    title.innerHTML =
      `an invitation for ` +
      `<span style="color:${suggested.avatar_color};font-style:italic">${escHtml(suggested.name)}</span>` +
      ` to join this room.`;
  }
  card.appendChild(title);

  if (msg.reason) {
    const reason = document.createElement('div');
    reason.className = 'h-invite-reason';
    reason.textContent = msg.reason;
    card.appendChild(reason);
  }

  const actions = document.createElement('div');
  actions.className = 'h-invite-actions';

  const approveBtn = document.createElement('button');
  approveBtn.className = 'h-btn-primary';
  approveBtn.textContent = 'invite';
  approveBtn.onclick = () => resolveInvite(msg.invite_id, true, [approveBtn, rejectBtn]);

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'h-btn-secondary';
  rejectBtn.textContent = 'not now';
  rejectBtn.onclick = () => resolveInvite(msg.invite_id, false, [approveBtn, rejectBtn]);

  actions.appendChild(approveBtn);
  actions.appendChild(rejectBtn);
  card.appendChild(actions);

  inner.appendChild(card);
  scrollToBottom();
}

async function resolveInvite(inviteId, approved, btns) {
  btns.forEach(b => b.disabled = true);
  try {
    const invRes = await fetch(`/api/invites/${inviteId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved }),
    });
    if (!invRes.ok) throw new Error('resolve failed');
    if (approved && currentRoomId) {
      const parts = await fjson(`/api/rooms/${currentRoomId}/participants`);
      roomParticipantsCache[currentRoomId] = parts;
      renderRoomDots(currentRoomId, parts);
      const room = { id: currentRoomId, title: document.querySelector('.h-room-name')?.textContent || '' };
      renderChatHeader(room, parts);
    }
  } catch (err) {
    console.error('Failed to resolve invite:', err);
    btns.forEach(b => b.disabled = false);
  }
}

function showUploadError(msg) {
  const el = document.getElementById('upload-error');
  document.getElementById('upload-error-text').textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 5000);
}

