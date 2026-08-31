// ── Day separator ───────────────────────────────────────────────────────────
let _lastDayKey = null;

function resetDaySeparator() { _lastDayKey = null; }

function dayLabel(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (d.getTime() === today.getTime()) return 'Today';
  if (d.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function makeDaySeparator(dateStr) {
  const el = document.createElement('div');
  el.className = 'h-day-separator';
  el.setAttribute('data-day', dateStr);
  const label = document.createElement('span');
  label.className = 'h-day-separator-label';
  label.textContent = dateStr;
  el.appendChild(label);
  return el;
}

function maybeInsertDaySep(inner, ts) {
  const d = new Date(ts);
  const key = d.toLocaleDateString();
  if (key === _lastDayKey) return;
  _lastDayKey = key;
  inner.appendChild(makeDaySeparator(dayLabel(d)));
}

// ── Result chip (Phase 4) ────────────────────────────────────────────────────
// Quiet metadata line under an agent bubble: how the run ended + token/duration
// cost. `raw` is the JSON string stored in messages.result_meta (or null).
// Returns a DOM node, or null when there is nothing to show.
const _RESULT_EXIT = {
  completed: { glyph: '✓', label: 'completed' },
  stopped:   { glyph: '⏹', label: 'stopped' },
  timeout:   { glyph: '⚠', label: 'timeout' },
  error:     { glyph: '⚠', label: 'error' },
};
function _fmtTokens(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(n);
}
function _fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  return r ? m + 'm ' + r + 's' : m + 'm';
}
function buildResultChip(raw) {
  if (!raw) return null;
  let meta = raw;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { return null; } }
  if (!meta || typeof meta !== 'object' || !meta.exit_reason) return null;
  const e = _RESULT_EXIT[meta.exit_reason] || { glyph: '•', label: String(meta.exit_reason) };
  const parts = [e.glyph + ' ' + e.label];
  const tok = meta.tokens;
  if (tok && (tok.input || tok.output)) parts.push(_fmtTokens((tok.input || 0) + (tok.output || 0)) + ' tok');
  if (meta.duration_ms) parts.push(_fmtDuration(meta.duration_ms));
  const chip = document.createElement('div');
  chip.className = 'h-msg-result' + (meta.exit_reason === 'timeout' || meta.exit_reason === 'error' ? ' warn' : '');
  chip.textContent = parts.join(' · ');
  return chip;
}

// ── Append message ─────────────────────────────────────────────────────────
function appendMessage(m, container) {
  const inner = container || document.getElementById('messages-inner');
  if (!inner) return;

  if (m.state === 'system_event') {
    const el = document.createElement('div');
    el.className = 'h-system-event';
    el.id = 'msg-' + m.id;
    el.textContent = m.content;
    inner.appendChild(el);
    return;
  }

  // Pesan yang masih streaming/requesting → tampilkan thinking bubble
  if (m.state === 'streaming' || m.state === 'requesting') {
    showThinking(m.id, m.actor_name, m.avatar_color, m.avatar_symbol, m.avatar_url);
    return;
  }

  const isHuman = m.actor_type === 'human';

  const row = document.createElement('div');
  row.className = 'h-msg-row ' + (isHuman ? 'human' : 'ai');
  row.id = 'msg-' + m.id;

  // Seal
  const sealWrap = document.createElement('div');
  sealWrap.className = 'h-msg-seal-wrap';
  sealWrap.appendChild(makeAvatar(m.actor_name, m.avatar_color, m.avatar_url, 40));
  row.appendChild(sealWrap);

  // Body
  const body = document.createElement('div');
  body.className = 'h-msg-body';

  // Meta: name + time
  const meta = document.createElement('div');
  meta.className = 'h-msg-meta';

  const nameEl = document.createElement('span');
  nameEl.className = 'h-msg-name';
  nameEl.style.color = m.avatar_color;
  nameEl.textContent = m.actor_name;
  meta.appendChild(nameEl);

  // Sub-agent identity — flat: "Ara (probe)". Kept as a sibling span so the
  // parent's .h-msg-name textContent stays clean (read back elsewhere to
  // recover actor_name). Label is a snapshot from the message row.
  if (m.sub_agent_label) {
    const subEl = document.createElement('span');
    subEl.className = 'h-msg-sub';
    subEl.textContent = '(' + m.sub_agent_label + ')';
    meta.appendChild(subEl);
  }

  if (m.created_at) {
    const timeEl = document.createElement('span');
    timeEl.className = 'h-msg-time';
    const ts = m.created_at.endsWith('Z') ? m.created_at : m.created_at.replace(' ', 'T') + 'Z';
    const dateObj = new Date(ts);
    timeEl.textContent = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    timeEl.title = dateObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    meta.appendChild(timeEl);
    maybeInsertDaySep(inner, ts);
  }

  body.appendChild(meta);

  // Bubble
  const bubble = document.createElement('div');
  bubble.className = 'h-bubble';
  bubble.style.background = bubbleBg(m.avatar_color);
  bubble.style.borderColor  = bubbleBorder(m.avatar_color);

  if (m.reply_msg) {
    const quote = document.createElement('div');
    quote.className = 'h-reply-quote';
    const replyAttachments = getAttachments(m.reply_msg);
    let quoteText = escHtml((m.reply_msg.content || '').substring(0, 150));
    if (replyAttachments.length) {
      const urls = replyAttachments.map(a => `<div class="h-reply-quote-file">${escHtml(a.url)}</div>`).join('');
      quoteText = urls + quoteText;
    }
    const replyColor = (m.reply_msg.avatar_color || 'var(--h-ink)').replace(/[^a-zA-Z0-9().,%# \-]/g, '');
    quote.innerHTML = `<div class="h-reply-quote-name" style="color:${replyColor}">${escHtml(m.reply_msg.actor_name)}</div><div class="h-reply-quote-text">${quoteText}</div>`;
    quote.onclick = () => { const el = document.getElementById('msg-' + m.reply_to); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.transition = 'background 0.3s'; el.style.background = 'color-mix(in srgb, #d39749 15%, transparent)'; setTimeout(() => { el.style.background = ''; }, 2000); } };
    bubble.appendChild(quote);
  }

  renderAttachments(bubble, m);

  if (m.content) {
    const textDiv = document.createElement('div');
    textDiv.innerHTML = highlightMentions(renderMarkdown(m.content));
    bubble.appendChild(textDiv);
  }

  if (m.ai_model) {
    const modelTag = document.createElement('div');
    modelTag.className = 'h-msg-model';
    modelTag.textContent = m.ai_model;
    bubble.appendChild(modelTag);
  }

  const resultChip = buildResultChip(m.result_meta);
  if (resultChip) bubble.appendChild(resultChip);

  const actions = document.createElement('div');
  actions.className = 'h-msg-actions';
  actions.innerHTML =
    `<button class="h-msg-action-btn" data-action="reply" title="Reply"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg></button>` +
    `<button class="h-msg-action-btn" data-action="copy" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>` +
    `<button class="h-msg-action-btn" data-action="delete" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
  actions.querySelector('[data-action="reply"]').onclick = () => startReply(m.id, m.actor_name, m.avatar_color, m.content, getAttachments(m));
  actions.querySelector('[data-action="copy"]').onclick = async function() {
    if (await copyToClipboard(m.content || '')) showCopyFeedback(this);
  };
  actions.querySelector('[data-action="delete"]').onclick = () => deleteMessage(m.id);

  body.appendChild(bubble);
  body.style.position = 'relative';
  body.appendChild(actions);
  row.appendChild(body);
  inner.appendChild(row);
  addCopyButtons(bubble);
  linkifyFilePaths(bubble);
  externalLinksNewTab(bubble);
}


// ── Day floater — single sticky pill driven by scroll (Slack-style) ────────
let _dayScrollHandler = null;

function initDayFloater() {
  const container = document.getElementById('messages');
  const inner = document.getElementById('messages-inner');
  if (!container || !inner) return;
  let floater = document.getElementById('h-day-floater');
  if (!floater) {
    floater = document.createElement('div');
    floater.id = 'h-day-floater';
    floater.className = 'h-day-floater';
    const lbl = document.createElement('span');
    lbl.className = 'h-day-floater-label';
    floater.appendChild(lbl);
    floater.style.visibility = 'hidden';
  }
  // Keep floater as first child of inner so position:sticky works within scroll container
  if (inner.firstChild !== floater) inner.prepend(floater);
  if (_dayScrollHandler) container.removeEventListener('scroll', _dayScrollHandler);
  _dayScrollHandler = () => updateDayFloater();
  container.addEventListener('scroll', _dayScrollHandler, { passive: true });
  updateDayFloater();
}

function updateDayFloater() {
  const container = document.getElementById('messages');
  const inner = document.getElementById('messages-inner');
  const floater = document.getElementById('h-day-floater');
  if (!container || !inner || !floater) return;
  const lbl = floater.querySelector('.h-day-floater-label');
  const containerTop = container.getBoundingClientRect().top;
  const seps = inner.querySelectorAll('.h-day-separator');
  let currentDay = null;
  let anySepVisibleAtTop = false;
  for (const sep of seps) {
    const r = sep.getBoundingClientRect();
    if (r.top < containerTop + 8) {
      currentDay = sep.getAttribute('data-day');
      // If the inline separator itself is right at the top edge, hide floater to avoid double pill
      if (r.bottom > containerTop) anySepVisibleAtTop = true;
    } else {
      break;
    }
  }
  if (currentDay && !anySepVisibleAtTop) {
    lbl.textContent = currentDay;
    floater.style.visibility = 'visible';
  } else {
    floater.style.visibility = 'hidden';
  }
}
