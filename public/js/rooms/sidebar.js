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
  const msgEl = document.getElementById('compact-message');
  const agentsEl = document.getElementById('compact-agents');
  if (!bar) return;
  if (compactingParticipants.length > 0) {
    const names = compactingParticipants.map(p => p.name).join(', ');
    if (msgEl) msgEl.textContent = `${names} session compacting…`;
    if (agentsEl) {
      agentsEl.innerHTML = '';
      compactingParticipants.forEach(p => {
        const indicator = document.createElement('div');
        indicator.className = 'h-compact-agent';
        indicator.dataset.participantId = p.participant_id;
        const spinner = document.createElement('div');
        spinner.className = 'h-compact-spinner';
        const label = document.createElement('span');
        label.className = 'h-compact-label';
        label.textContent = p.name;
        indicator.appendChild(spinner);
        indicator.appendChild(label);
        agentsEl.appendChild(indicator);
      });
    }
  }
  bar.classList.add('visible');
  document.querySelector('.h-composer-box')?.classList.add('ai-processing');
  document.getElementById('msg-input')?.blur();
  const btn = document.querySelector('.h-compact-btn');
  if (btn) { btn.disabled = true; btn.classList.add('active'); }
}

function updateCompactBar(completedParticipantIds) {
  const completedIds = completedParticipantIds || [];
  if (completedIds.length === 0) return;
  const agentsEl = document.getElementById('compact-agents');
  if (!agentsEl) return;
  completedIds.forEach(pid => {
    const indicator = agentsEl.querySelector(`[data-participant-id="${pid}"]`);
    if (indicator && !indicator.classList.contains('completed')) {
      indicator.classList.add('completed');
      const spinner = indicator.querySelector('.h-compact-spinner');
      if (spinner) spinner.className = 'h-compact-check';
    }
  });
}

function hideCompactBar() {
  compactingRoomId = null;
  compactingParticipants = [];
  const bar = document.getElementById('compact-bar');
  const msgEl = document.getElementById('compact-message');
  const agentsEl = document.getElementById('compact-agents');
  if (bar) bar.classList.remove('visible');
  if (msgEl) msgEl.textContent = '';
  if (agentsEl) agentsEl.innerHTML = '';
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

