// ── Context window indicator ──────────────────────────────────────────────
// Tracks per-participant context window fill and renders a thin bar below
// the compact bar. Expands on hover to show details.
const contextState = {}; // actor_id → { context_tokens_used, context_limit, actor_name, model }

function contextBarColor(pct) {
  if (pct >= 0.90) return 'oklch(0.55 0.20 27)';
  if (pct >= 0.75) return 'oklch(0.65 0.18 55)';
  if (pct >= 0.50) return 'oklch(0.72 0.15 85)';
  return 'oklch(0.62 0.14 155)';
}

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function updateContextBar() {
  const bar = document.getElementById('context-bar');
  if (!bar) return;

  let maxPct = 0;
  let maxEntry = null;
  const entries = Object.values(contextState);
  for (const e of entries) {
    const pct = e.context_limit > 0 ? e.context_tokens_used / e.context_limit : 0;
    if (pct > maxPct) { maxPct = pct; maxEntry = e; }
  }

  if (maxPct < 0.01 || !maxEntry) {
    bar.classList.remove('visible');
    bar.innerHTML = '';
    return;
  }

  bar.classList.add('visible');
  bar.innerHTML = '';

  const fill = document.createElement('div');
  fill.className = 'h-context-fill';
  fill.style.width = Math.min(100, maxPct * 100).toFixed(1) + '%';
  fill.style.background = contextBarColor(maxPct);
  bar.appendChild(fill);

  const label = document.createElement('span');
  label.className = 'h-context-label';
  label.textContent = Math.round(maxPct * 100) + '% context';
  bar.appendChild(label);

  const tooltip = document.createElement('div');
  tooltip.className = 'h-context-tooltip';
  if (entries.length === 1) {
    tooltip.textContent = `${formatTokens(maxEntry.context_tokens_used)} / ${formatTokens(maxEntry.context_limit)} tokens`;
  } else {
    tooltip.innerHTML = entries
      .filter(e => e.context_tokens_used > 0)
      .sort((a, b) => b.context_tokens_used - a.context_tokens_used)
      .map(e => {
        const p = e.context_limit > 0 ? Math.round(e.context_tokens_used / e.context_limit * 100) : 0;
        const name = (e.actor_name || 'agent').replace(/</g, '&lt;');
        return `<div style="display:flex;justify-content:space-between;gap:16px;padding:2px 0"><span>${name}</span><span style="color:var(--h-ink-mute)">${formatTokens(e.context_tokens_used)} / ${formatTokens(e.context_limit)} (${p}%)</span></div>`;
      }).join('');
  }
  bar.appendChild(tooltip);
}

function handleContextUpdate(msg) {
  if (msg.room_id !== currentRoomId) return;
  contextState[msg.actor_id] = {
    context_tokens_used: msg.context_tokens_used,
    context_limit: msg.context_limit,
    actor_name: msg.actor_name || contextState[msg.actor_id]?.actor_name || 'agent',
    model: msg.model,
  };
  updateContextBar();
}

function loadContextState(roomId) {
  Object.keys(contextState).forEach(k => delete contextState[k]);
  updateContextBar();
  fjson(`/api/rooms/${roomId}/context`).then(data => {
    if (roomId !== currentRoomId) return;
    for (const p of (data.participants || [])) {
      contextState[p.actor_id] = {
        context_tokens_used: p.context_tokens_used,
        context_limit: p.context_limit,
        actor_name: p.actor_name,
        model: null,
      };
    }
    updateContextBar();
  }).catch(() => {});
}

