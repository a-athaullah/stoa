// ── Thread feed — roots-only renderer ──────────────────────────────────────
// threadSummaries: rootMsgId → {count, last_at, active, participants}
const threadSummaries = {};

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
    when.textContent = '· ' + _relativeTime(s.last_at);
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
    const body = row.querySelector('.h-msg-body');
    if (body) body.appendChild(chip);
  }
}

// Called on thread_summary WS event
function handleThreadSummary(msg) {
  threadSummaries[msg.root_id] = {
    count: msg.count,
    last_at: msg.last_at,
    active: msg.active,
  };
  updateThreadChip(msg.root_id);
}

// After loading feed messages, attach chips from pre-fetched thread data
function attachThreadChips(messages) {
  for (const m of messages) {
    if (!m.thread_id && m.thread) {
      threadSummaries[m.id] = {
        count: m.thread.count || 0,
        last_at: m.thread.last_at,
        active: m.thread.active || false,
      };
      if (m.thread.count > 0) updateThreadChip(m.id);
    }
  }
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
