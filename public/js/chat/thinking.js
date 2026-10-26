// ── Thinking bubble (before tokens arrive) ─────────────────────────────────
function showThinking(msgId, actorName, color, symbol, avatarUrl, subAgentLabel, container, saAvatarColor, saAvatarSymbol, saAvatarUrl, saRole, saId) {
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
  sealWrap.appendChild(makeAvatarEl(actorName, color, avatarUrl, isThreadPanel ? 28 : 40, subAgentLabel, saAvatarColor, saAvatarSymbol, saAvatarUrl, saId));
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
  const roleEl = makeSubAgentRoleEl(subAgentLabel, saRole);
  if (roleEl) body.appendChild(roleEl);

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
  applyQueueBadge(msgId);
  scrollToBottom();
}


// ── Agent queue position badge ─────────────────────────────────────────────
// Server sends message_queue {message_id, position|null}; a run waiting in the agent's
// queue shows "queued #N" in place of the thinking indicator until it starts.
const queuePositions = new Map();

function applyQueueBadge(msgId) {
  const position = queuePositions.get(msgId);
  document.querySelectorAll(`[id="msg-${msgId}"]`).forEach(row => {
    const thinking = row.querySelector('.h-thinking-bubble');
    const host = thinking || row.querySelector('.t-col, .h-msg-body');
    let badge = row.querySelector('.h-queue-badge');
    if (!position || !host) {
      if (badge) badge.remove();
      if (thinking) thinking.classList.remove('is-queued');
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'h-queue-badge';
      const meta = thinking ? null : host.querySelector(':scope > .t-meta, :scope > .h-msg-meta');
      if (meta) meta.after(badge);
      else host.appendChild(badge);
    }
    badge.textContent = `Queued #${position}`;
    if (thinking) thinking.classList.add('is-queued');
  });
}

function setQueuePosition(msgId, position) {
  if (Number.isInteger(position) && position > 0) queuePositions.set(msgId, position);
  else queuePositions.delete(msgId);
  applyQueueBadge(msgId);
}

function clearQueuePositions() {
  const ids = [...queuePositions.keys()];
  queuePositions.clear();
  ids.forEach(applyQueueBadge);
}
