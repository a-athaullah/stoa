// ── Compact sessions ──────────────────────────────────────────────────────
let compactingRoomId = null;
let compactingParticipants = [];

function compactSessions(roomId) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'compact_session', room_id: roomId }));
}

function showCompactBar(roomId, participants) {
  compactingRoomId = roomId ?? currentRoomId;
  compactingParticipants = participants || [];
  const bar = document.getElementById('compact-bar');
  if (!bar) return;
  bar.innerHTML = '';
  compactingParticipants.forEach(p => {
    const fill = document.createElement('div');
    fill.className = 'h-compact-fill';
    fill.dataset.participantId = p.participant_id;
    bar.appendChild(fill);
  });
  bar.classList.add('visible');
  document.querySelector('.h-composer-box')?.classList.add('ai-processing');
  document.getElementById('msg-input')?.blur();
  const btn = document.querySelector('.h-compact-btn');
  if (btn) { btn.disabled = true; btn.classList.add('active'); }
}

function updateCompactBar(completedParticipantIds) {
  const completedIds = completedParticipantIds || [];
  if (completedIds.length === 0) return;
  const bar = document.getElementById('compact-bar');
  if (!bar) return;
  completedIds.forEach(pid => {
    const fill = bar.querySelector(`[data-participant-id="${pid}"]`);
    if (fill && !fill.classList.contains('completed')) {
      fill.classList.add('completed');
    }
  });
}

function hideCompactBar() {
  compactingRoomId = null;
  compactingParticipants = [];
  const bar = document.getElementById('compact-bar');
  if (bar) {
    bar.classList.remove('visible');
    bar.innerHTML = '';
  }
  document.querySelector('.h-composer-box')?.classList.remove('ai-processing');
  document.getElementById('msg-input')?.focus();
  const btn = document.querySelector('.h-compact-btn');
  if (btn) { btn.disabled = false; btn.classList.remove('active'); }
}

// ── Composer seal ──────────────────────────────────────────────────────────
function renderComposerSeal() {
  const el = document.getElementById('composer-seal');
  if (!el || !humanActor) return;
  el.innerHTML = '';
  el.appendChild(makeAvatar(humanActor.name, humanActor.avatar_color, humanActor.avatar_url, 24));
}

// ── Sidebar footer (human actor) ────────────────────────────────────────────
function renderSidebarFooter() {
  const footer = document.getElementById('sidebar-footer');
  if (!humanActor) return;
  footer.innerHTML = '';
  footer.appendChild(makeAvatar(humanActor.name, humanActor.avatar_color, humanActor.avatar_url, 22));
  const nameEl = document.createElement('span');
  nameEl.className = 'h-footer-name';
  nameEl.textContent = humanActor.name.toLowerCase();
  footer.appendChild(nameEl);
  const conn = document.createElement('span');
  conn.className = 'h-conn-status';
  conn.innerHTML = '<span class="h-conn-dot"></span><span class="h-conn-label">offline</span>';
  footer.appendChild(conn);
  const isDark = document.documentElement.classList.contains('dark');
  const themeBtn = document.createElement('button');
  themeBtn.id = 'theme-toggle';
  themeBtn.className = 'h-theme-btn';
  themeBtn.setAttribute('aria-label', 'toggle theme');
  themeBtn.title = isDark ? 'switch to light' : 'switch to dark';
  themeBtn.innerHTML = isDark ? SUN_SVG : MOON_SVG;
  themeBtn.onclick = toggleTheme;
  footer.appendChild(themeBtn);
}

