// ── Utility ─────────────────────────────────────────────────────────────────
function relativeTime(ts) {
  // SQLite returns UTC without timezone — force UTC parse to avoid 7h offset in WIB
  const utc = typeof ts === 'string' && !ts.endsWith('Z') ? ts.trim().replace(' ', 'T') + 'Z' : ts;
  const diff = (Date.now() - new Date(utc)) / 1000;
  if (diff < 60)   return 'now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 86400)return Math.floor(diff / 3600) + 'h';
  return Math.floor(diff / 86400) + 'd';
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function formatModelName(model) {
  if (!model) return null;
  return model
    .replace(/^claude-/, '')
    .replace(/-(\d)/, ' $1')
    .replace(/-preview$/, '');
}

function handleModelUpdate(msg) {
  if (msg.room_id && msg.room_id !== currentRoomId) return;
  const badge = document.querySelector('.h-model-badge');
  if (badge) badge.remove();
  const label = formatModelName(msg.model);
  // Sync thread composer model label
  const threadModelWrap = document.getElementById('thread-model-selector-wrap');
  const threadModelLabel = document.getElementById('thread-model-label');
  if (threadModelWrap && threadModelLabel) {
    if (label) {
      threadModelLabel.textContent = label;
      threadModelWrap.style.display = 'inline-flex';
    } else {
      threadModelWrap.style.display = 'none';
    }
  }
  // Sync room header tagline (format: "model · N agents")
  const tagline = document.querySelector('.h-room-tagline');
  if (tagline) {
    const current = tagline.textContent;
    const agentsPart = current.includes(' · ') ? current.split(' · ').slice(-1)[0] : current;
    const modelShort = msg.model ? msg.model.replace(/^claude-/, '') : '';
    const parts = [];
    if (modelShort) parts.push(modelShort);
    if (agentsPart) parts.push(agentsPart);
    tagline.textContent = parts.join(' · ');
  }
}

