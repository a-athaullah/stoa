// ── Thread feed — roots-only renderer ──────────────────────────────────────
// threadSummaries: rootMsgId → {count, last_at, active, participants}
const threadSummaries = {};

// ── Slack-style root row renderer ──────────────────────────────────────────
function appendFeedRootRow(m, inner) {
  if (!inner) inner = document.getElementById('messages-inner');
  if (!inner) return;
  if (m.id && document.getElementById('msg-' + m.id)) return;

  if (m.created_at) {
    const ts = m.created_at.endsWith('Z') ? m.created_at : m.created_at.replace(' ', 'T') + 'Z';
    maybeInsertDaySep(inner, ts);
  }

  const row = document.createElement('div');
  row.className = 't-root-row h-feed-root';
  row.id = 'msg-' + m.id;
  row.dataset.rootId = m.id;

  // Avatar (36px)
  const avatarWrap = document.createElement('div');
  avatarWrap.className = 't-avatar';
  avatarWrap.appendChild(makeAvatarEl(m.actor_name, m.avatar_color, m.avatar_url, 36, m.sub_agent_label));
  row.appendChild(avatarWrap);

  // Right column: name+time, content, reply summary
  const col = document.createElement('div');
  col.className = 't-col';

  const meta = document.createElement('div');
  meta.className = 't-meta';

  const nameEl = document.createElement('span');
  nameEl.className = 't-name';
  nameEl.style.color = m.avatar_color;
  nameEl.textContent = m.sub_agent_label || m.actor_name;
  meta.appendChild(nameEl);

  if (m.created_at) {
    const timeEl = document.createElement('span');
    timeEl.className = 't-time';
    const ts = m.created_at.endsWith('Z') ? m.created_at : m.created_at.replace(' ', 'T') + 'Z';
    const dateObj = new Date(ts);
    timeEl.textContent = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    timeEl.title = dateObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    meta.appendChild(timeEl);
  }
  col.appendChild(meta);

  if (m.content) {
    const content = document.createElement('div');
    content.className = 't-content';
    content.innerHTML = highlightMentions(renderMarkdown(m.content));
    col.appendChild(content);
  }

  row.appendChild(col);
  inner.appendChild(row);

  row.addEventListener('click', e => {
    if (e.target.closest('a, button, .h-thread-chip')) return;
    openThread(m.id);
  });

  if (m.thread && m.thread.count > 0) {
    const chip = _buildThreadChip(m.id);
    if (chip) col.appendChild(chip);
  }

  if (typeof addCopyButtons === 'function') addCopyButtons(row);
  if (typeof linkifyFilePaths === 'function') linkifyFilePaths(row);
  if (typeof externalLinksNewTab === 'function') externalLinksNewTab(row);
}

function _relativeTime(isoStr) {
  if (!isoStr) return '';
  const ts = isoStr.endsWith('Z') ? isoStr : isoStr.replace(' ', 'T') + 'Z';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function _buildThreadChip(rootId) {
  const s = threadSummaries[rootId];
  if (!s || s.count < 1) return null;

  const chip = document.createElement('div');
  chip.className = 'h-thread-chip' + (s.active ? ' active' : '');
  chip.dataset.rootId = rootId;

  if (s.participant_ids?.length) {
    const avatars = document.createElement('span');
    avatars.className = 'h-thread-chip-avatars';
    const show = s.participant_ids.slice(0, 3);
    show.forEach((aid, i) => {
      const actor = allActors.find(a => a.id === aid);
      if (!actor) return;
      const av = makeAvatar(actor.name, actor.avatar_color, actor.avatar_url, 20);
      av.classList?.add('h-thread-chip-av');
      if (!av.classList) av.className = (av.className || '') + ' h-thread-chip-av';
      av.style.zIndex = show.length - i;
      if (i > 0) av.style.marginLeft = '-6px';
      avatars.appendChild(av);
    });
    chip.appendChild(avatars);
  }

  if (s.active) {
    const pulse = document.createElement('span');
    pulse.className = 'h-thread-pulse';
    chip.appendChild(pulse);
  }

  const count = document.createElement('span');
  count.className = 'h-thread-chip-count';
  count.textContent = s.count + (s.count === 1 ? ' reply' : ' replies');
  chip.appendChild(count);

  if (s.last_at) {
    const when = document.createElement('span');
    when.className = 'h-thread-chip-time';
    when.textContent = _relativeTime(s.last_at);
    chip.appendChild(when);
  }

  chip.addEventListener('click', e => {
    e.stopPropagation();
    openThread(rootId);
  });

  return chip;
}

function updateThreadChip(rootId) {
  const existing = document.querySelector(`.h-thread-chip[data-root-id="${rootId}"]`);
  const s = threadSummaries[rootId];
  if (!s) return;

  const row = document.getElementById('msg-' + rootId);
  if (!row) return;

  if (existing) existing.remove();
  const chip = _buildThreadChip(rootId);
  if (chip) {
    const target = row.querySelector('.t-col') || row.querySelector('.h-msg-body');
    if (target) target.appendChild(chip);
  }
}

// Called on thread_summary WS event
function handleThreadSummary(msg) {
  threadSummaries[msg.root_id] = {
    count: msg.count,
    last_at: msg.last_at,
    active: msg.active,
    participant_ids: msg.participant_ids || [],
  };
  updateThreadChip(msg.root_id);
  _syncRoomThreadBadge();
}

// After loading feed messages, attach chips from pre-fetched thread data
function attachThreadChips(messages) {
  for (const m of messages) {
    if (!m.thread_id && m.thread) {
      threadSummaries[m.id] = {
        count: m.thread.count || 0,
        last_at: m.thread.last_at,
        active: m.thread.active || false,
        participant_ids: m.thread.participant_ids || [],
      };
      if (m.thread.count > 0) updateThreadChip(m.id);
    }
  }
  _syncRoomThreadBadge();
}

// Make root messages clickable to open thread
function makeFeedMessageClickable(msgId) {
  const row = document.getElementById('msg-' + msgId);
  if (!row) return;
  row.classList.add('h-feed-root');
  row.dataset.rootId = msgId;
  row.addEventListener('click', e => {
    if (e.target.closest('.h-msg-action-btn, .h-thread-chip, a, button, .h-reply-quote')) return;
    openThread(msgId);
  });
}

function clearThreadSummaries() {
  Object.keys(threadSummaries).forEach(k => delete threadSummaries[k]);
}

function getActiveThreadCount() {
  return Object.values(threadSummaries).filter(s => s.active).length;
}

function _syncRoomThreadBadge() {
  if (typeof updateRoomThreadBadge === 'function' && typeof currentRoomId !== 'undefined' && currentRoomId) {
    updateRoomThreadBadge(currentRoomId, getActiveThreadCount());
  }
}
