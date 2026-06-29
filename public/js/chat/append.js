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

  if (m.created_at) {
    const timeEl = document.createElement('span');
    timeEl.className = 'h-msg-time';
    const ts = m.created_at.endsWith('Z') ? m.created_at : m.created_at.replace(' ', 'T') + 'Z';
    timeEl.textContent = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(timeEl);
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

