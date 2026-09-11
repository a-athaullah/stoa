// ── Thinking bubble (before tokens arrive) ─────────────────────────────────
function showThinking(msgId, actorName, color, symbol, avatarUrl, subAgentLabel, container) {
  if (document.getElementById('msg-' + msgId)) return; // already exists
  const inner = container || document.getElementById('messages-inner');
  if (!inner) return;

  const isThreadPanel = inner.id === 'thread-body';
  const row = document.createElement('div');
  row.className = isThreadPanel ? 'h-thread-msg-row' : 'h-msg-row ai';
  row.id = 'msg-' + msgId;

  // Seal
  const sealWrap = document.createElement('div');
  sealWrap.className = 'h-msg-seal-wrap';
  sealWrap.appendChild(makeAvatarEl(actorName, color, avatarUrl, isThreadPanel ? 28 : 40, subAgentLabel));
  row.appendChild(sealWrap);

  // Body
  const body = document.createElement('div');
  body.className = 'h-msg-body';

  const meta = document.createElement('div');
  meta.className = 'h-msg-meta';
  const nameEl = document.createElement('span');
  nameEl.className = 'h-msg-name';
  nameEl.style.color = color;
  // Sub-agent: show label as primary name, orchestrator in parens — "FE-Review (Ara)"
  nameEl.textContent = subAgentLabel || actorName;
  meta.appendChild(nameEl);
  if (subAgentLabel) {
    const subEl = document.createElement('span');
    subEl.className = 'h-msg-sub';
    subEl.textContent = '(' + actorName + ')';
    meta.appendChild(subEl);
  }
  body.appendChild(meta);

  // Thinking bubble
  const bubble = document.createElement('div');
  bubble.className = 'h-thinking-bubble';
  applyBubbleColor(bubble, color, subAgentLabel);
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

