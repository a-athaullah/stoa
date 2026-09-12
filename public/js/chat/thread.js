// ── Thread panel ────────────────────────────────────────────────────────────
let activeThreadId = null;          // root message ID of open thread (null = closed)
let threadLoadingOlder = false;
let threadNoMoreOlder = false;
let threadOldestMsgId = null;

const threadContextState = {};      // actor_id → context data (thread-scoped)

function _getThreadPanel() { return document.getElementById('thread-panel'); }
function _getThreadBody()  { return document.getElementById('thread-body'); }

function isThreadOpen() { return activeThreadId !== null; }

// ── Open thread ─────────────────────────────────────────────────────────────
async function openThread(rootId) {
  if (activeThreadId === rootId) return;

  activeThreadId = rootId;

  // Update URL param
  const url = new URL(location.href);
  url.searchParams.set('thread', rootId);
  history.replaceState(null, '', url);

  // Highlight active root in feed
  document.querySelectorAll('.h-feed-root').forEach(el => {
    el.classList.toggle('h-feed-root-active', el.dataset.rootId == rootId);
  });

  let panel = _getThreadPanel();
  if (!panel) {
    _createThreadPanel();
    panel = _getThreadPanel();
  }

  panel.classList.add('open');
  document.getElementById('chat-inner')?.classList.add('has-thread');

  _updateRoomHeaderThread(rootId);
  await _loadThread(rootId);
  restoreThreadDraft(currentRoomId, rootId);
  document.getElementById('thread-msg-input')?.focus();
}

function closeThread() {
  if (!activeThreadId) return;
  saveThreadDraft(currentRoomId, activeThreadId);
  activeThreadId = null;

  const url = new URL(location.href);
  url.searchParams.delete('thread');
  history.replaceState(null, '', url);

  document.querySelectorAll('.h-feed-root').forEach(el => el.classList.remove('h-feed-root-active'));

  const panel = _getThreadPanel();
  if (panel) panel.classList.remove('open');
  document.getElementById('chat-inner')?.classList.remove('has-thread');

  _updateRoomHeaderThread(null);

  // Clear thread context state
  Object.keys(threadContextState).forEach(k => delete threadContextState[k]);
  updateThreadContextBar();

  clearThreadAttachments();
}

// ── Create panel DOM ─────────────────────────────────────────────────────────
function _createThreadPanel() {
  const chatBodyRow = document.getElementById('chat-body-row');
  if (!chatBodyRow) return;

  const panel = document.createElement('div');
  panel.id = 'thread-panel';
  panel.className = 'h-thread-panel';

  // Header
  const header = document.createElement('div');
  header.id = 'thread-header';
  header.className = 'h-thread-header';

  const title = document.createElement('div');
  title.id = 'thread-header-title';
  title.className = 'h-thread-header-title';
  header.appendChild(title);

  const controls = document.createElement('div');
  controls.className = 'h-thread-controls';

  const stopBtn = document.createElement('button');
  stopBtn.id = 'thread-stop-btn';
  stopBtn.className = 'h-thread-ctrl-btn';
  stopBtn.title = 'Stop generation';
  stopBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
  stopBtn.onclick = () => stopThreadGeneration();
  controls.appendChild(stopBtn);

  const compactBtn = document.createElement('button');
  compactBtn.id = 'thread-compact-btn';
  compactBtn.className = 'h-thread-ctrl-btn';
  compactBtn.title = 'Compact this thread';
  compactBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
  compactBtn.onclick = () => compactThread();
  controls.appendChild(compactBtn);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'h-thread-ctrl-btn';
  closeBtn.title = 'Close thread';
  closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  closeBtn.onclick = closeThread;
  controls.appendChild(closeBtn);

  header.appendChild(controls);
  panel.appendChild(header);

  // Compact bar (thread-scoped)
  const compactBar = document.createElement('div');
  compactBar.id = 'thread-compact-bar';
  compactBar.className = 'h-compact-bar';
  panel.appendChild(compactBar);

  // Context bar (thread-scoped)
  const contextBar = document.createElement('div');
  contextBar.id = 'thread-context-bar';
  contextBar.className = 'h-context-bar';
  panel.appendChild(contextBar);

  // Scroll container + inner
  const scroll = document.createElement('div');
  scroll.id = 'thread-scroll';
  scroll.className = 'h-thread-scroll';

  const body = document.createElement('div');
  body.id = 'thread-body';
  body.className = 'h-thread-body';
  scroll.appendChild(body);
  panel.appendChild(scroll);

  // Load older on scroll to top
  scroll.addEventListener('scroll', () => {
    if (scroll.scrollTop < 120) _loadOlderThreadMessages();
  });

  // Footer: dedicated thread composer
  const footer = document.createElement('div');
  footer.id = 'thread-footer';
  footer.className = 'h-thread-footer';

  // Reply bar (quote-reply)
  const replyBar = document.createElement('div');
  replyBar.id = 'thread-reply-bar';
  replyBar.className = 'h-reply-bar';
  const replyBarContent = document.createElement('div');
  replyBarContent.className = 'reply-bar-content';
  const replyBarName = document.createElement('div');
  replyBarName.className = 'reply-bar-name';
  replyBarName.id = 'thread-reply-bar-name';
  const replyBarText = document.createElement('div');
  replyBarText.className = 'reply-bar-text';
  replyBarText.id = 'thread-reply-bar-text';
  replyBarContent.append(replyBarName, replyBarText);
  const replyBarClose = document.createElement('button');
  replyBarClose.id = 'thread-reply-bar-close';
  replyBarClose.title = 'Cancel reply';
  replyBarClose.textContent = '×';
  replyBarClose.onclick = clearThreadReply;
  replyBar.append(replyBarContent, replyBarClose);
  footer.appendChild(replyBar);

  // Composer box
  const composerBox = document.createElement('div');
  composerBox.className = 'h-composer-box h-thread-composer-box';
  composerBox.style.position = 'relative';

  // Attach preview
  const attachPreview = document.createElement('div');
  attachPreview.id = 'thread-attach-preview';
  composerBox.appendChild(attachPreview);

  // Format bar
  const fmtBar = document.createElement('div');
  fmtBar.className = 'h-fmt-bar';
  const fmtBtns = [
    { fmt: 'bold',       title: 'Bold (Ctrl+B)',       icon: '<path d="M6 4h7a5 5 0 0 1 3.5 8.6A5.5 5.5 0 0 1 14 22H6V4zm3 3v4h4a2 2 0 1 0 0-4H9zm0 7v5h5a2.5 2.5 0 1 0 0-5H9z"/>', fill: true },
    { fmt: 'italic',     title: 'Italic (Ctrl+I)',     icon: '<path d="M10 4h8v3h-2.8l-4.4 10H14v3H6v-3h2.8l4.4-10H10V4z"/>', fill: true },
    { fmt: 'code',       title: 'Code',                icon: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>', fill: false },
    { fmt: 'codeblock',  title: 'Code block',          icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="8 10 4 14 8 18" transform="scale(.7) translate(5,3)"/><polyline points="16 10 20 14 16 18" transform="scale(.7) translate(5,3)"/>', fill: false },
  ];
  fmtBtns.forEach(({ fmt, title, icon, fill }) => {
    const btn = document.createElement('button');
    btn.className = 'h-fmt-btn';
    btn.dataset.fmt = fmt;
    btn.title = title;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'}>${icon}</svg>`;
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      if (typeof applyFormat === 'function') applyFormat(fmt);
    });
    fmtBar.appendChild(btn);
  });
  composerBox.appendChild(fmtBar);

  // Input area
  const composerTop = document.createElement('div');
  composerTop.className = 'h-composer-top';
  const inputEl = document.createElement('div');
  inputEl.id = 'thread-msg-input';
  inputEl.contentEditable = 'true';
  inputEl.setAttribute('role', 'textbox');
  inputEl.setAttribute('aria-multiline', 'true');
  inputEl.dataset.placeholder = 'Reply in thread…';
  composerTop.appendChild(inputEl);
  composerBox.appendChild(composerTop);

  // Actions row
  const actionsRow = document.createElement('div');
  actionsRow.className = 'h-composer-actions';

  // Attach button
  const attachWrap = document.createElement('span');
  attachWrap.style.position = 'relative';
  const threadAttachBtn = document.createElement('button');
  threadAttachBtn.className = 'h-icon-btn';
  threadAttachBtn.title = 'Attach file';
  threadAttachBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.5l-8.5 8.5a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/></svg>';
  const threadAttachMenu = document.createElement('div');
  threadAttachMenu.className = 'attach-menu';
  const threadAttachPhoto = document.createElement('button');
  threadAttachPhoto.className = 'attach-menu-item';
  threadAttachPhoto.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg> Photo / Image';
  const threadAttachFile = document.createElement('button');
  threadAttachFile.className = 'attach-menu-item';
  threadAttachFile.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> File';
  threadAttachMenu.append(threadAttachPhoto, threadAttachFile);
  attachWrap.append(threadAttachBtn, threadAttachMenu);

  threadAttachBtn.addEventListener('click', e => { e.stopPropagation(); threadAttachMenu.classList.toggle('visible'); });
  document.addEventListener('click', () => threadAttachMenu.classList.remove('visible'));

  function _threadHandleFileUpload(file, isImage) {
    if (typeof uploadWithProgress !== 'function') return;
    uploadWithProgress(file).then(({ url, name }) => {
      addThreadAttachment(url, name || file.name, isImage ? 'image' : 'file');
    }).catch(err => {
      if (typeof showUploadError === 'function') showUploadError(err.message || 'Upload failed');
    });
  }

  threadAttachPhoto.addEventListener('click', () => {
    threadAttachMenu.classList.remove('visible');
    const fi = document.createElement('input');
    fi.type = 'file'; fi.accept = 'image/*'; fi.multiple = true;
    fi.onchange = () => { for (const f of fi.files) _threadHandleFileUpload(f, true); };
    fi.click();
  });
  threadAttachFile.addEventListener('click', () => {
    threadAttachMenu.classList.remove('visible');
    const fi = document.createElement('input');
    fi.type = 'file'; fi.multiple = true;
    fi.onchange = () => { for (const f of fi.files) _threadHandleFileUpload(f, false); };
    fi.click();
  });

  actionsRow.appendChild(attachWrap);
  actionsRow.appendChild(document.createElement('span')).style.flex = '1';

  // Stop button (thread-level)
  const threadStopAction = document.createElement('button');
  threadStopAction.id = 'thread-stop-action';
  threadStopAction.title = 'Stop generation (Esc)';
  threadStopAction.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg> stop';
  threadStopAction.onclick = () => stopThreadGeneration();
  actionsRow.appendChild(threadStopAction);

  // Send button
  const sendBtn = document.createElement('button');
  sendBtn.id = 'thread-send-btn';
  sendBtn.className = 'h-send-btn';
  sendBtn.title = 'Send (Enter)';
  sendBtn.setAttribute('aria-label', 'Send');
  sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M1.5 2.1c0-.46.5-.75.9-.53l15.7 7.7a.6.6 0 0 1 0 1.06l-15.7 7.7c-.4.23-.9-.06-.9-.53V11.5L11 10 1.5 8.5V2.1z"/></svg>';
  sendBtn.onclick = sendThreadMessage;
  actionsRow.appendChild(sendBtn);
  composerBox.appendChild(actionsRow);
  footer.appendChild(composerBox);
  panel.appendChild(footer);

  // Keyboard handling for thread input
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendThreadMessage(); }
    if (e.key === 'Escape') closeThread();
  });

  // Paste image in thread
  inputEl.addEventListener('paste', async e => {
    const items = [...(e.clipboardData?.items || [])];
    const img = items.find(i => i.type.startsWith('image/'));
    if (!img) return;
    e.preventDefault();
    const file = img.getAsFile();
    if (typeof uploadWithProgress === 'function') {
      try { const { url, name } = await uploadWithProgress(file); addThreadAttachment(url, name || file.name, 'image'); } catch (err) { if (typeof showUploadError === 'function') showUploadError(err.message || 'Upload failed'); }
    }
  });

  // Drag-drop file in thread panel
  panel.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  panel.addEventListener('drop', e => {
    e.preventDefault();
    const files = [...(e.dataTransfer.files || [])];
    files.forEach(f => _threadHandleFileUpload(f, f.type.startsWith('image/')));
  });

  chatBodyRow.appendChild(panel);

  // Mobile: swipe right to close
  let _swipeStartX = 0;
  panel.addEventListener('touchstart', e => { _swipeStartX = e.touches[0].clientX; }, { passive: true });
  panel.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - _swipeStartX;
    if (dx > 80) closeThread();
  }, { passive: true });
}

// ── Flat thread message renderer ─────────────────────────────────────────────
// Renders without bubble background — matches Slack-style thread panel design.
// Keeps .h-bubble and .h-msg-body present for stream.js/finalizeMessage compat.
function appendThreadMessage(m, container) {
  if (!container) return;
  if (m.id && document.getElementById('msg-' + m.id)) return;

  if (m.state === 'streaming' || m.state === 'requesting') {
    showThinking(m.id, m.actor_name, m.avatar_color, m.avatar_symbol, m.avatar_url, m.sub_agent_label, container);
    return;
  }

  const row = document.createElement('div');
  row.className = 'h-thread-msg-row';
  row.id = 'msg-' + m.id;

  const seal = document.createElement('div');
  seal.className = 'h-msg-seal-wrap';
  seal.appendChild(makeAvatarEl(m.actor_name, m.avatar_color, m.avatar_url, 28, m.sub_agent_label));
  row.appendChild(seal);

  const body = document.createElement('div');
  body.className = 'h-msg-body';
  body.style.position = 'relative';

  const meta = document.createElement('div');
  meta.className = 'h-msg-meta';

  const nameEl = document.createElement('span');
  nameEl.className = 'h-msg-name';
  nameEl.style.color = m.avatar_color;
  nameEl.textContent = m.sub_agent_label || m.actor_name;
  meta.appendChild(nameEl);

  if (m.sub_agent_label) {
    const subEl = document.createElement('span');
    subEl.className = 'h-msg-sub';
    subEl.textContent = '(' + m.actor_name + ')';
    meta.appendChild(subEl);
  }

  if (m.created_at) {
    const timeEl = document.createElement('span');
    timeEl.className = 'h-msg-time';
    const ts = m.created_at.endsWith('Z') ? m.created_at : m.created_at.replace(' ', 'T') + 'Z';
    timeEl.textContent = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(timeEl);
  }
  body.appendChild(meta);

  const bubble = document.createElement('div');
  bubble.className = 'h-bubble';

  if (m.reply_msg) {
    const quote = document.createElement('div');
    quote.className = 'h-reply-quote';
    const replyAttachments = typeof getAttachments === 'function' ? getAttachments(m.reply_msg) : [];
    let quoteText = escHtml((m.reply_msg.content || '').substring(0, 150));
    if (replyAttachments.length) {
      const urls = replyAttachments.map(a => `<div class="h-reply-quote-file">${escHtml(a.url)}</div>`).join('');
      quoteText = urls + quoteText;
    }
    const replyColor = (m.reply_msg.avatar_color || 'var(--h-ink)').replace(/[^a-zA-Z0-9().,%# \-]/g, '');
    quote.innerHTML = `<div class="h-reply-quote-name" style="color:${replyColor}">${escHtml(m.reply_msg.actor_name)}</div><div class="h-reply-quote-text">${quoteText}</div>`;
    quote.onclick = () => {
      const el = document.getElementById('msg-' + m.reply_to);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.transition = 'background 0.3s'; el.style.background = 'color-mix(in srgb, #d39749 15%, transparent)'; setTimeout(() => { el.style.background = ''; }, 2000); }
    };
    bubble.appendChild(quote);
  }

  if (typeof renderAttachments === 'function') renderAttachments(bubble, m);

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

  body.appendChild(bubble);
  row.appendChild(body);
  container.appendChild(row);

  if (typeof addCopyButtons === 'function') addCopyButtons(bubble);
  if (typeof linkifyFilePaths === 'function') linkifyFilePaths(bubble);
  if (typeof externalLinksNewTab === 'function') externalLinksNewTab(bubble);
}

// ── Load thread messages ─────────────────────────────────────────────────────
async function _loadThread(rootId) {
  const body = _getThreadBody();
  if (!body) return;

  body.innerHTML = '';
  threadLoadingOlder = false;
  threadNoMoreOlder = false;
  threadOldestMsgId = null;

  // Update header with root message snippet
  _updateThreadHeader(rootId);

  try {
    const resp = await fjson(`/api/rooms/${currentRoomId}/threads/${rootId}`);
    if (activeThreadId !== rootId) return; // navigated away

    // New contract: {root, messages} — root = root msg, messages = replies only
    // Legacy fallback: array of all messages
    const root = resp && !Array.isArray(resp) ? resp.root : null;
    const msgs = resp && !Array.isArray(resp) ? (resp.messages || []) : (Array.isArray(resp) ? resp.filter(m => m.id !== rootId) : []);

    body.innerHTML = '';

    // Render root message pinned at top
    if (root) {
      _renderThreadRoot(root, body);
    }

    // Divider + reply count
    const divider = document.createElement('div');
    divider.className = 'h-thread-divider';
    divider.textContent = msgs.length === 0 ? 'No replies yet' : msgs.length + (msgs.length === 1 ? ' reply' : ' replies');
    body.appendChild(divider);

    const savedDay = _lastDayKey;
    _lastDayKey = null;
    msgs.forEach(m => appendThreadMessage(m, body));
    _lastDayKey = savedDay;

    if (msgs.length > 0) threadOldestMsgId = msgs[0].id;
    threadNoMoreOlder = msgs.length < 100;

    _scrollThreadToBottom(true);
  } catch (e) {
    console.error('[thread] load failed', e);
  }
}

function _renderThreadRoot(m, container) {
  const row = document.createElement('div');
  row.className = 'h-thread-root-row';
  row.id = 'thread-root-msg-' + m.id;

  const seal = document.createElement('div');
  seal.className = 'h-msg-seal-wrap';
  seal.appendChild(makeAvatarEl(m.actor_name, m.avatar_color, m.avatar_url, 28, m.sub_agent_label));
  row.appendChild(seal);

  const body = document.createElement('div');
  body.className = 'h-msg-body';

  const meta = document.createElement('div');
  meta.className = 'h-msg-meta';
  const nameEl = document.createElement('span');
  nameEl.className = 'h-msg-name';
  nameEl.style.color = m.avatar_color;
  nameEl.textContent = m.sub_agent_label || m.actor_name;
  meta.appendChild(nameEl);
  if (m.created_at) {
    const timeEl = document.createElement('span');
    timeEl.className = 'h-msg-time';
    const ts = m.created_at.endsWith('Z') ? m.created_at : m.created_at.replace(' ', 'T') + 'Z';
    timeEl.textContent = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(timeEl);
  }
  body.appendChild(meta);

  const bubble = document.createElement('div');
  bubble.className = 'h-bubble';
  if (typeof renderAttachments === 'function') renderAttachments(bubble, m);
  if (m.content) {
    const textDiv = document.createElement('div');
    textDiv.innerHTML = highlightMentions(renderMarkdown(m.content));
    bubble.appendChild(textDiv);
  }
  body.appendChild(bubble);
  row.appendChild(body);
  container.appendChild(row);

  if (typeof addCopyButtons === 'function') addCopyButtons(bubble);
  if (typeof linkifyFilePaths === 'function') linkifyFilePaths(bubble);
  if (typeof externalLinksNewTab === 'function') externalLinksNewTab(bubble);
}

async function _loadOlderThreadMessages() {
  if (threadLoadingOlder || threadNoMoreOlder || !threadOldestMsgId || !activeThreadId) return;
  threadLoadingOlder = true;

  const scroll = document.getElementById('thread-scroll');
  const body = _getThreadBody();
  if (!scroll || !body) { threadLoadingOlder = false; return; }

  const spinner = document.createElement('div');
  spinner.style.cssText = 'text-align:center;padding:12px;color:var(--h-ink-mute);font-size:13px';
  spinner.textContent = 'loading…';
  body.prepend(spinner);

  try {
    const resp = await fjson(`/api/rooms/${currentRoomId}/threads/${activeThreadId}?before=${threadOldestMsgId}&limit=50`);
    const msgs = resp && !Array.isArray(resp) ? (resp.messages || []) : (Array.isArray(resp) ? resp : []);
    spinner.remove();
    if (!msgs.length) { threadNoMoreOlder = true; threadLoadingOlder = false; return; }

    const savedDay = _lastDayKey;
    _lastDayKey = null;
    const frag = document.createDocumentFragment();
    msgs.forEach(m => { if (!document.getElementById('msg-' + m.id)) appendThreadMessage(m, frag); });
    _lastDayKey = savedDay;

    const prevHeight = body.scrollHeight;
    const prevTop = scroll.scrollTop;
    body.prepend(frag);
    scroll.scrollTop = prevTop + (body.scrollHeight - prevHeight);

    threadOldestMsgId = msgs[0].id;
    if (msgs.length < 50) threadNoMoreOlder = true;
  } catch {
    spinner.remove();
    showToast('Failed to load older messages', { error: true });
  }
  threadLoadingOlder = false;
}

function _scrollThreadToBottom(force) {
  const scroll = document.getElementById('thread-scroll');
  if (!scroll) return;
  if (force || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120) {
    scroll.scrollTop = scroll.scrollHeight;
  }
}

// ── Thread header ─────────────────────────────────────────────────────────────
function _updateThreadHeader(rootId) {
  const titleEl = document.getElementById('thread-header-title');
  if (!titleEl) return;
  const rootRow = document.getElementById('msg-' + rootId);
  const snippet = rootRow?.querySelector('.h-bubble')?.textContent?.slice(0, 80)
    || rootRow?.querySelector('.h-msg-name')?.textContent
    || 'Thread';
  titleEl.textContent = snippet;
  titleEl.title = snippet;
}

// ── Stop / compact thread ────────────────────────────────────────────────────
function stopThreadGeneration() {
  if (!activeThreadId || !ws || ws.readyState !== WebSocket.OPEN) return;
  // Find streaming messages in thread body
  const body = _getThreadBody();
  if (!body) return;
  body.querySelectorAll('.h-msg-row, .h-thread-msg-row').forEach(row => {
    const msgId = row.id.replace('msg-', '');
    if (processingMessages.has(parseInt(msgId, 10)) || processingMessages.has(msgId)) {
      ws.send(JSON.stringify({ type: 'stop_generation', room_id: currentRoomId, message_id: parseInt(msgId, 10) }));
    }
  });
}

function compactThread() {
  if (!activeThreadId || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'compact_session', room_id: currentRoomId, thread_id: activeThreadId }));
}

// ── Thread attachment state ───────────────────────────────────────────────────
let threadPendingAttachments = [];

function addThreadAttachment(url, name, type) {
  threadPendingAttachments.push({ url, name, type });
  _renderThreadAttachPreview();
}

function removeThreadAttachment(idx) {
  threadPendingAttachments.splice(idx, 1);
  _renderThreadAttachPreview();
}

function clearThreadAttachments() {
  threadPendingAttachments = [];
  _renderThreadAttachPreview();
}

function _renderThreadAttachPreview() {
  const el = document.getElementById('thread-attach-preview');
  if (!el) return;
  if (!threadPendingAttachments.length) { el.classList.remove('visible'); el.innerHTML = ''; return; }
  el.classList.add('visible');
  el.innerHTML = threadPendingAttachments.map((a, i) => {
    if (a.type === 'image') return `<div class="attach-thumb"><img src="${a.url}" alt="${escHtml(a.name)}"><button class="attach-thumb-x" data-idx="${i}">&times;</button></div>`;
    return `<div class="attach-thumb-file"><span>${escHtml(a.name)}</span><button class="attach-thumb-x" data-idx="${i}">&times;</button></div>`;
  }).join('');
  el.querySelectorAll('.attach-thumb-x').forEach(btn => {
    btn.onclick = () => removeThreadAttachment(parseInt(btn.dataset.idx));
  });
}

// ── Thread reply ──────────────────────────────────────────────────────────────
let threadPendingReplyTo = null;

function startThreadReply(msgId, actorName, avatarColor, content) {
  threadPendingReplyTo = msgId;
  const nameEl = document.getElementById('thread-reply-bar-name');
  const textEl = document.getElementById('thread-reply-bar-text');
  const bar = document.getElementById('thread-reply-bar');
  if (nameEl) { nameEl.textContent = actorName; nameEl.style.color = avatarColor || 'var(--h-ink)'; }
  if (textEl) textEl.textContent = (content || '').substring(0, 150);
  if (bar) bar.classList.add('visible');
  document.getElementById('thread-msg-input')?.focus();
}

function clearThreadReply() {
  threadPendingReplyTo = null;
  document.getElementById('thread-reply-bar')?.classList.remove('visible');
}

// ── Draft per (room, thread) ─────────────────────────────────────────────────
function saveThreadDraft(roomId, threadId) {
  if (!roomId || !threadId) return;
  const inputEl = document.getElementById('thread-msg-input');
  if (!inputEl) return;
  const html = inputEl.innerHTML.trim();
  const key = 'stoa-thread-draft-' + roomId + '-' + threadId;
  if (html && html !== '<br>') {
    try { localStorage.setItem(key, html); } catch {}
  } else {
    try { localStorage.removeItem(key); } catch {}
  }
}

function restoreThreadDraft(roomId, threadId) {
  const inputEl = document.getElementById('thread-msg-input');
  if (!inputEl) return;
  const key = 'stoa-thread-draft-' + roomId + '-' + threadId;
  const draft = localStorage.getItem(key);
  inputEl.innerHTML = draft || '';
  if (draft) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(inputEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ── Thread send ───────────────────────────────────────────────────────────────
function sendThreadMessage() {
  if (!activeThreadId || !ws || ws.readyState !== WebSocket.OPEN) return;
  const inputEl = document.getElementById('thread-msg-input');
  if (!inputEl) return;
  const content = (typeof htmlToMarkdown === 'function' ? htmlToMarkdown(inputEl) : inputEl.textContent)
    .replace(/​/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!content && !threadPendingAttachments.length) return;

  inputEl.innerHTML = '';
  const attachments = threadPendingAttachments.length ? [...threadPendingAttachments] : undefined;
  const replyTo = threadPendingReplyTo;
  clearThreadAttachments();
  clearThreadReply();
  try { localStorage.removeItem('stoa-thread-draft-' + currentRoomId + '-' + activeThreadId); } catch {}

  ws.send(JSON.stringify({
    type: 'send_message',
    room_id: currentRoomId,
    content,
    attachments,
    reply_to: replyTo,
    thread_id: activeThreadId,
    event_id: crypto.randomUUID(),
  }));
}

// ── Context bar (thread-scoped) ───────────────────────────────────────────────
function updateThreadContextBar() {
  const bar = document.getElementById('thread-context-bar');
  if (!bar) return;

  let maxPct = 0;
  let maxEntry = null;
  for (const e of Object.values(threadContextState)) {
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
}

// ── Compact bar (thread-scoped) ───────────────────────────────────────────────
let threadCompactingParticipants = [];

function showThreadCompactBar(participants) {
  threadCompactingParticipants = participants || [];
  const bar = document.getElementById('thread-compact-bar');
  if (!bar) return;
  bar.innerHTML = '';
  threadCompactingParticipants.forEach(p => {
    const fill = document.createElement('div');
    fill.className = 'h-compact-fill';
    fill.dataset.participantId = p.participant_id;
    bar.appendChild(fill);
  });
  bar.classList.add('visible');
}

function updateThreadCompactBar(completedIds) {
  const bar = document.getElementById('thread-compact-bar');
  if (!bar) return;
  (completedIds || []).forEach(pid => {
    const fill = bar.querySelector(`[data-participant-id="${pid}"]`);
    if (fill) fill.classList.add('completed');
  });
}

function hideThreadCompactBar() {
  threadCompactingParticipants = [];
  const bar = document.getElementById('thread-compact-bar');
  if (bar) { bar.classList.remove('visible'); bar.innerHTML = ''; }
}

// ── Deep-link from URL params ─────────────────────────────────────────────────
function checkThreadDeepLink() {
  const threadId = new URL(location.href).searchParams.get('thread');
  if (threadId) openThread(parseInt(threadId, 10));
}

// ── Room header breadcrumb ────────────────────────────────────────────────────
function _updateRoomHeaderThread(rootId) {
  const header = document.getElementById('chat-header');
  if (!header) return;
  const existing = document.getElementById('chat-thread-breadcrumb');
  if (!rootId) {
    if (existing) existing.remove();
    return;
  }
  const crumb = existing || (() => {
    const el = document.createElement('div');
    el.id = 'chat-thread-breadcrumb';
    el.className = 'h-thread-breadcrumb';
    const info = header.querySelector('.h-header-info');
    if (info) info.after(el);
    else header.appendChild(el);
    return el;
  })();

  const row = document.getElementById('msg-' + rootId);
  const snippet = (row?.querySelector('.h-bubble')?.textContent?.slice(0, 40)
    || row?.querySelector('.h-msg-name')?.textContent
    || 'Thread').replace(/</g, '&lt;');
  crumb.innerHTML = `<span class="h-thread-breadcrumb-sep">›</span><span class="h-thread-breadcrumb-label" title="Click to focus thread">${snippet}</span>`;
  crumb.querySelector('.h-thread-breadcrumb-label').onclick = () => {
    document.getElementById('thread-msg-input')?.focus();
  };
}

// ── Reset on room change ──────────────────────────────────────────────────────
function clearThreadPanel() {
  if (activeThreadId) {
    saveThreadDraft(currentRoomId, activeThreadId);
    activeThreadId = null;
  }
  clearThreadAttachments();
  clearThreadReply();
  const panel = _getThreadPanel();
  if (panel) {
    panel.classList.remove('open');
    const body = _getThreadBody();
    if (body) body.innerHTML = '';
  }
  document.getElementById('chat-inner')?.classList.remove('has-thread');
  document.querySelectorAll('.h-feed-root').forEach(el => el.classList.remove('h-feed-root-active'));
  _updateRoomHeaderThread(null);
  Object.keys(threadContextState).forEach(k => delete threadContextState[k]);
  threadLoadingOlder = false;
  threadNoMoreOlder = false;
  threadOldestMsgId = null;
}
