// ── Thinking bubble (before tokens arrive) ─────────────────────────────────
function showThinking(msgId, actorName, color, symbol, avatarUrl, subAgentLabel) {
  if (document.getElementById('msg-' + msgId)) return; // already exists
  const inner = document.getElementById('messages-inner');
  if (!inner) return;

  const row = document.createElement('div');
  row.className = 'h-msg-row ai';
  row.id = 'msg-' + msgId;

  // Seal
  const sealWrap = document.createElement('div');
  sealWrap.className = 'h-msg-seal-wrap';
  if (subAgentLabel) {
    const container = document.createElement('div');
    container.className = 'h-sa-avatar-wrap';
    container.appendChild(makeAvatar(actorName, color, avatarUrl, 40));
    const badge = document.createElement('span');
    badge.className = 'h-sa-badge';
    badge.style.background = color || '#888';
    badge.textContent = subAgentLabel[0].toUpperCase();
    container.appendChild(badge);
    sealWrap.appendChild(container);
  } else {
    sealWrap.appendChild(makeAvatar(actorName, color, avatarUrl, 40));
  }
  row.appendChild(sealWrap);

  // Body
  const body = document.createElement('div');
  body.className = 'h-msg-body';

  const meta = document.createElement('div');
  meta.className = 'h-msg-meta';
  const nameEl = document.createElement('span');
  nameEl.className = 'h-msg-name';
  nameEl.style.color = color;
  nameEl.textContent = actorName;
  meta.appendChild(nameEl);
  body.appendChild(meta);

  // Thinking bubble
  const bubble = document.createElement('div');
  bubble.className = 'h-thinking-bubble';
  bubble.style.background = bubbleBg(color);
  bubble.style.borderColor  = bubbleBorder(color);
  bubble.style.color = color;
  bubble.innerHTML =
    '<span class="h-dot"></span>' +
    '<span class="h-dot"></span>' +
    '<span class="h-dot"></span>' +
    '<span class="h-status" style="font-family:var(--h-msg)">' +
      '<span class="a">thinking…</span>' +
      '<span class="b">writing…</span>' +
    '</span>';
  body.appendChild(bubble);
  row.appendChild(body);
  inner.appendChild(row);

  streaming[msgId] = '';
  scrollToBottom();
}

