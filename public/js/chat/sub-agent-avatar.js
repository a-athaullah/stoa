// ── Sub-agent avatar ──────────────────────────────────────────────────────
// A sub-agent without its own photo gets a letter seal of its label, coloured with
// its own colour or the parent's. Never the parent's photo: that reads as the
// parent agent speaking.
function makeAvatarEl(name, color, url, size, subAgentLabel, saAvatarColor, saAvatarSymbol, saAvatarUrl, saId) {
  if (!subAgentLabel) return makeAvatar(name, color, url, size);
  const wrap = document.createElement('div');
  wrap.className = 'h-sa-avatar-wrap';
  if (saId) wrap.dataset.saId = String(saId);
  wrap.dataset.saLabel = subAgentLabel;
  wrap.dataset.saSize = String(size);
  wrap.dataset.saParentColor = color || '';
  fillSubAgentAvatar(wrap, { avatar_url: saAvatarUrl, avatar_color: saAvatarColor, avatar_symbol: saAvatarSymbol });
  return wrap;
}

function fillSubAgentAvatar(wrap, sa) {
  const size = Number(wrap.dataset.saSize);
  const label = wrap.dataset.saLabel;
  let el;
  if (sa.avatar_url) {
    el = document.createElement('img');
    el.src = sa.avatar_url;
    el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;display:inline-block`;
    el.alt = label;
  } else {
    el = document.createElement('span');
    el.className = 'h-seal';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.background = sa.avatar_color || wrap.dataset.saParentColor || '#888';
    el.style.fontSize = (size * 0.52) + 'px';
    el.textContent = sa.avatar_symbol || label.charAt(0).toUpperCase();
  }
  wrap.replaceChildren(el);
}

// Repaints every rendered avatar of this sub-agent (feed, thread, thinking, sidebar)
// after a sub_agent_updated broadcast. Matched by sub-agent id: actor names are not
// unique and can be renamed. Avatars rendered without an id are never repainted.
function refreshSubAgentAvatars(sa, root = document) {
  if (!sa.id) return;
  const id = String(sa.id);
  for (const wrap of root.querySelectorAll('.h-sa-avatar-wrap[data-sa-id]')) {
    if (wrap.dataset.saId === id) fillSubAgentAvatar(wrap, sa);
  }
}

// message_state (thinking) carries only the label; labels are unique among the
// sub-agents linked to a room, so the open room's cache resolves the id.
function roomSubAgentIdByLabel(label) {
  if (!label) return null;
  return (roomSubAgentsCache[currentRoomId] || []).find(s => s.label === label)?.id || null;
}
