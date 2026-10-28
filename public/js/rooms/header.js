// ── Chat header ────────────────────────────────────────────────────────────
function renderChatHeader(room, participants) {
  const header = document.getElementById('chat-header');
  header.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.id = 'mobile-back';
  backBtn.setAttribute('aria-label', 'back to rooms');
  backBtn.innerHTML = '&#8592;';
  backBtn.onclick = () => document.body.classList.remove('in-chat');
  header.appendChild(backBtn);

  if (document.body.classList.contains('sidebar-collapsed')) {
    const roomsToggle = document.createElement('button');
    roomsToggle.className = 'h-rooms-toggle';
    roomsToggle.title = 'Show room list';
    roomsToggle.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/></svg>`;
    roomsToggle.onclick = () => toggleSidebar();
    header.appendChild(roomsToggle);
  }

  const info = document.createElement('div');
  info.className = 'h-header-info';

  const name = document.createElement('div');
  name.className = 'h-room-name';
  name.textContent = room.title;
  name.title = 'Click to rename';
  name.onclick = () => {
    name.contentEditable = 'true';
    name.classList.add('editing');
    name.focus();
    const range = document.createRange();
    range.selectNodeContents(name);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  async function commitRename() {
    name.contentEditable = 'false';
    name.classList.remove('editing');
    const newTitle = name.textContent.trim();
    if (newTitle && newTitle !== room.title) {
      const oldTitle = room.title;
      room.title = newTitle;
      try {
        const r = await fetch(`/api/rooms/${room.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        });
        if (!r.ok) throw new Error('rename failed');
      } catch { showToast('Failed to rename room', { error: true }); room.title = oldTitle; name.textContent = oldTitle; }
    } else {
      name.textContent = room.title;
    }
  }
  name.addEventListener('blur', commitRename);
  name.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
    if (e.key === 'Escape') { name.textContent = room.title; name.blur(); }
  });
  info.appendChild(name);

  const tagline = document.createElement('span');
  tagline.className = 'h-room-tagline';
  const modelShort = (room.model || currentRoomData?.model || '').replace(/^claude-/, '') || '';
  const effectiveParticipants = participants?.length ? participants : (roomParticipantsCache[room.id] || []);
  const agentCount = effectiveParticipants.filter(p => p.type === 'ai').length;

  if (modelShort) {
    const pill = document.createElement('span');
    pill.className = 'h-model-pill';
    pill.textContent = modelShort;
    tagline.appendChild(pill);
    tagline.appendChild(document.createTextNode(' · '));
  }

  const saCount = (roomSubAgentsCache[room.id] || []).length;
  const countParts = [`${agentCount} agent${agentCount !== 1 ? 's' : ''}`];
  if (saCount) countParts.push(`${saCount} sub-agent${saCount !== 1 ? 's' : ''}`);
  tagline.appendChild(document.createTextNode(countParts.join(' · ')));
  const primary = agentCount > 1 ? effectiveParticipants.find(p => p.type === 'ai' && isPrimaryParticipant(p, room)) : null;
  if (primary) {
    tagline.appendChild(document.createTextNode(' · '));
    const lead = document.createElement('span');
    lead.className = 'h-room-primary';
    lead.title = PRIMARY_AGENT_HINT;
    lead.textContent = `primary: ${primary.name}`;
    tagline.appendChild(lead);
  }
  info.appendChild(tagline);

  header.appendChild(info);

  if (room.id) header.appendChild(buildHeaderActivityCtl(room));
}

// ── Header activity: active threads + sub-agent runs in one pill/popover ──────
// One control so "threads" and "sub-agents" never stack as two look-alike pills.
// State survives header re-renders of the same room; switching rooms resets it.
const _activity = { roomId: null, room: null, open: false, runs: [], threads: null, threadsFailed: false, seq: 0, timer: null };

function buildHeaderActivityCtl(room) {
  if (_activity.roomId !== room.id) {
    Object.assign(_activity, { roomId: room.id, open: false, runs: [], threads: null, threadsFailed: false });
    _activity.seq++;
  }
  _activity.room = room;

  const ctl = document.createElement('div');
  ctl.className = 'h-activity-ctl';
  ctl.id = 'h-activity-ctl';

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'h-activity-pill';
  pill.setAttribute('aria-haspopup', 'dialog');
  pill.setAttribute('aria-controls', 'h-activity-pop');
  const dot = document.createElement('span');
  dot.className = 'h-activity-dot';
  const label = document.createElement('span');
  label.className = 'h-activity-label';
  pill.append(dot, label);
  pill.onclick = e => { e.stopPropagation(); _activity.open ? closeActivityPopover() : openActivityPopover(); };

  const paused = document.createElement('button');
  paused.type = 'button';
  paused.className = 'h-activity-paused';
  paused.title = 'New sub-agent spawns are blocked — running ones finish normally';
  paused.setAttribute('aria-haspopup', 'dialog');
  paused.setAttribute('aria-controls', 'h-activity-pop');
  paused.innerHTML = '<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2.5" y="2" width="2.6" height="8" rx=".8"/><rect x="6.9" y="2" width="2.6" height="8" rx=".8"/></svg>';
  paused.setAttribute('aria-label', 'spawns paused');
  const pausedText = document.createElement('span');
  pausedText.className = 'h-activity-paused-text';
  pausedText.textContent = 'spawns paused';
  paused.appendChild(pausedText);
  paused.onclick = pill.onclick;

  const pop = document.createElement('div');
  pop.className = 'h-activity-pop';
  pop.id = 'h-activity-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'room activity');
  pop.addEventListener('click', e => e.stopPropagation());
  pop.addEventListener('keydown', _activityKeydown);

  ctl.append(pill, paused, pop);
  _syncActivityPill(ctl);
  if (_activity.open) _renderActivityPopover(ctl);

  _refreshRuns();
  if (_activity.timer) clearInterval(_activity.timer);
  _activity.timer = setInterval(() => {
    if (!document.getElementById('h-activity-ctl')) { clearInterval(_activity.timer); _activity.timer = null; return; }
    if (document.hidden || _activity.open) return;
    _refreshRuns();
  }, 3000);
  return ctl;
}

// Called from setRoomActiveThreads when the open room's count moves.
function renderHeaderThreadPill() {
  const ctl = document.getElementById('h-activity-ctl');
  if (!ctl || _activity.roomId !== currentRoomId) return;
  _syncActivityPill(ctl);
  if (_activity.open) _loadActiveThreads();
}

function _activityCounts() {
  return { threads: roomActiveThreads[_activity.roomId] || 0, runs: _activity.runs.length, paused: !!_activity.room?.spawns_paused };
}

function _syncActivityPill(ctl) {
  const { threads, runs, paused } = _activityCounts();
  const parts = [];
  if (threads) parts.push(`${threads} thread${threads === 1 ? '' : 's'}`);
  if (runs) parts.push(`${runs} sub-agent${runs === 1 ? '' : 's'}`);
  const pill = ctl.querySelector('.h-activity-pill');
  pill.hidden = !parts.length;
  pill.querySelector('.h-activity-label').textContent = parts.join(' · ');
  const pausedEl = ctl.querySelector('.h-activity-paused');
  pausedEl.hidden = !paused;
  for (const b of [pill, pausedEl]) b.setAttribute('aria-expanded', String(_activity.open));
  ctl.hidden = !parts.length && !paused && !_activity.open;
  ctl.querySelector('.h-activity-pop').hidden = !_activity.open;
}

async function _refreshRuns() {
  const roomId = _activity.roomId;
  let runs;
  try { runs = await fjson(`/api/rooms/${roomId}/sub-agent-runs`); } catch { return; }
  if (roomId !== _activity.roomId || !Array.isArray(runs)) return;
  _activity.runs = runs;
  const ctl = document.getElementById('h-activity-ctl');
  if (!ctl) return;
  _syncActivityPill(ctl);
  if (_activity.open) _renderActivityPopover(ctl);
}

function openActivityPopover() {
  const ctl = document.getElementById('h-activity-ctl');
  if (!ctl) return;
  _activity.open = true;
  const header = document.getElementById('chat-header');
  ctl.style.setProperty('--h-activity-pop-top', Math.round(header.getBoundingClientRect().bottom + 4) + 'px');
  _syncActivityPill(ctl);
  _renderActivityPopover(ctl);
  _loadActiveThreads();
  _refreshRuns();
}

function closeActivityPopover({ focusPill = false } = {}) {
  if (!_activity.open) return;
  _activity.open = false;
  _activity.threads = null;
  _activity.threadsFailed = false;
  _activity.seq++;
  const ctl = document.getElementById('h-activity-ctl');
  if (!ctl) return;
  ctl.querySelector('.h-activity-pop').textContent = '';
  _syncActivityPill(ctl);
  if (focusPill) ctl.querySelector('.h-activity-pill:not([hidden]), .h-activity-paused:not([hidden])')?.focus();
  _refreshRuns();
}

async function _loadActiveThreads() {
  const roomId = _activity.roomId;
  const seq = ++_activity.seq;
  let threads = null;
  try { threads = await fjson(`/api/rooms/${roomId}/threads?state=active`); } catch {}
  if (seq !== _activity.seq || roomId !== _activity.roomId || !_activity.open) return;
  _activity.threads = Array.isArray(threads) ? threads : null;
  _activity.threadsFailed = !Array.isArray(threads);
  const ctl = document.getElementById('h-activity-ctl');
  if (ctl) _renderActivityPopover(ctl);
}

function _renderActivityPopover(ctl) {
  const pop = ctl.querySelector('.h-activity-pop');
  const focusKey = pop.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  pop.textContent = '';
  const { threads: threadCount, paused } = _activityCounts();
  const threads = _activity.threads;
  const runs = _activity.runs;

  if (_activity.threadsFailed) {
    pop.appendChild(_activitySection('active threads', null, _activityNote("couldn't load threads")));
  } else if (threads === null && threadCount) {
    pop.appendChild(_activitySection('active threads', null, _activityNote('loading…')));
  } else if (threads?.length) {
    const list = document.createElement('div');
    list.className = 'h-activity-list';
    for (const t of threads) list.appendChild(_activityThreadItem(t));
    pop.appendChild(_activitySection('active threads', null, list));
  }

  if (runs.length || paused) {
    const body = document.createElement('div');
    body.className = 'h-activity-list';
    for (const r of runs) body.appendChild(_activityRunRow(r));
    const sec = _activitySection('sub-agents', runs.length ? `${runs.length} of ${_activity.room?.max_sub_agents || 3}` : null, body);
    sec.appendChild(_activityRunFoot(paused));
    pop.appendChild(sec);
  }

  if (!pop.childElementCount) pop.appendChild(_activityNote('nothing running right now'));
  const target = focusKey && pop.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
  if (target) target.focus();
}

function _activitySection(title, aside, body) {
  const sec = document.createElement('section');
  sec.className = 'h-activity-sec';
  const head = document.createElement('div');
  head.className = 'h-activity-head';
  const h = document.createElement('span');
  h.textContent = title;
  head.appendChild(h);
  if (aside) {
    const a = document.createElement('span');
    a.className = 'h-activity-aside';
    a.textContent = aside;
    head.appendChild(a);
  }
  sec.append(head, body);
  return sec;
}

function _activityNote(text) {
  const n = document.createElement('div');
  n.className = 'h-activity-note';
  n.textContent = text;
  return n;
}

function _activityThreadItem(t) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'h-activity-thread';
  item.dataset.focusKey = 't' + t.id;

  const preview = document.createElement('span');
  preview.className = 'h-activity-preview';
  preview.textContent = String(t.content || '').replace(/\s+/g, ' ').trim().slice(0, 160) || '(no text)';

  const meta = document.createElement('span');
  meta.className = 'h-activity-meta';
  const runners = [];
  const seen = new Set();
  for (const r of t.running || []) {
    const name = r.sub_agent_label || r.actor_name;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    runners.push({ name, color: r.sub_agent_label ? (r.sub_agent_avatar_color || r.avatar_color) : r.avatar_color });
  }
  for (const r of runners.slice(0, 3)) {
    const d = document.createElement('span');
    d.className = 'h-activity-runner';
    if (r.color) d.style.setProperty('--runner-color', r.color);
    meta.appendChild(d);
  }
  const who = document.createElement('span');
  who.className = 'h-activity-who';
  who.textContent = runners.length ? runners.map(r => r.name).join(', ') : (t.actor_name || '');
  const when = document.createElement('span');
  when.className = 'h-activity-when';
  const ts = t.last_reply_at || t.created_at;
  when.textContent = ts ? relativeTime(ts) : '';
  meta.append(who, when);

  item.append(preview, meta);
  item.onclick = () => { closeActivityPopover(); openThread(t.id); };
  return item;
}

function _activityRunRow(r) {
  const row = document.createElement('div');
  row.className = 'h-activity-run';
  if (r.thread_id) {
    row.classList.add('has-thread');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.title = 'open thread';
    row.dataset.focusKey = 'r' + r.message_id;
    const go = () => { closeActivityPopover(); openThread(r.thread_id); };
    row.onclick = e => { if (!e.target.closest('button')) go(); };
    row.onkeydown = e => {
      if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      go();
    };
  }

  let mini;
  if (r.sub_agent_avatar_url) {
    mini = document.createElement('img');
    mini.className = 'h-activity-avatar';
    mini.src = r.sub_agent_avatar_url;
    mini.alt = '';
  } else {
    mini = document.createElement('span');
    mini.className = 'h-activity-avatar is-symbol';
    mini.style.setProperty('--sa-color', r.sub_agent_avatar_color || r.avatar_color || '#888');
    mini.textContent = r.sub_agent_avatar_symbol || (r.sub_agent_label || '?').charAt(0).toUpperCase();
  }

  const mid = document.createElement('div');
  mid.className = 'h-activity-run-mid';
  const name = document.createElement('span');
  name.className = 'h-activity-run-label';
  name.textContent = r.sub_agent_label || '';
  const sub = document.createElement('span');
  sub.className = 'h-activity-run-sub';
  sub.textContent = `${r.parent_name || ''}'s · running ${elapsedSince(r.created_at)}${r.thread_id ? ' · in thread' : ''}`;
  mid.append(name, sub);

  const tier = document.createElement('span');
  tier.className = 'h-activity-run-tier';
  tier.textContent = r.tier || '';

  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'h-activity-stop';
  stop.textContent = 'stop';
  stop.dataset.focusKey = 's' + r.message_id;
  stop.onclick = async () => {
    stop.disabled = true;
    try { await fetch(`/api/rooms/${_activity.roomId}/sub-agent-runs/${r.message_id}/stop`, { method: 'POST' }); }
    catch { showToast('Failed to stop', { error: true }); stop.disabled = false; return; }
    _refreshRuns();
  };

  row.append(mini, mid, tier, stop);
  return row;
}

function _activityRunFoot(paused) {
  const foot = document.createElement('div');
  foot.className = 'h-activity-foot';
  const note = document.createElement('span');
  note.className = 'h-activity-foot-note';
  note.textContent = paused ? 'spawns paused — running ones finish.' : 'pausing blocks new spawns — these finish.';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'h-activity-toggle';
  toggle.textContent = paused ? 'resume' : 'pause';
  toggle.dataset.focusKey = 'pause';
  toggle.onclick = async () => {
    const room = _activity.room;
    toggle.disabled = true;
    try {
      const res = await fetch(`/api/rooms/${room.id}/spawns-pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: !paused }) });
      const j = await res.json().catch(() => ({}));
      if (res.ok) room.spawns_paused = j.paused ? 1 : 0;
      else showToast(j.error || 'Failed', { error: true });
    } catch { showToast('Failed', { error: true }); }
    toggle.disabled = false;
    const ctl = document.getElementById('h-activity-ctl');
    if (ctl && room === _activity.room) { _syncActivityPill(ctl); if (_activity.open) _renderActivityPopover(ctl); }
    _refreshRuns();
  };
  foot.append(note, toggle);
  return foot;
}

function _activityKeydown(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...e.currentTarget.querySelectorAll('.h-activity-thread, .h-activity-run.has-thread')];
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement);
  const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
  items[next].focus();
}

document.addEventListener('click', e => {
  if (_activity.open && !e.target.closest('#h-activity-ctl')) closeActivityPopover();
});
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !_activity.open || !document.getElementById('h-activity-ctl')) return;
  e.preventDefault();
  e.stopPropagation();
  closeActivityPopover({ focusPill: true });
}, true);

// ── Sub-agent run controls ───────────────────────────────────────────────────
function elapsedSince(createdAt) {
  if (!createdAt) return '';
  const then = new Date(createdAt.replace(' ', 'T') + 'Z').getTime();
  let s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); s = s % 60;
  return `${m}m ${s}s`;
}
