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
  _updateThreadComposer();
}

function closeThread() {
  if (!activeThreadId) return;
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

  _updateThreadComposer();
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

  // Footer composer (thread-scoped reply bar + input)
  const footer = document.createElement('div');
  footer.id = 'thread-footer';
  footer.className = 'h-thread-footer';

  const replyBar = document.createElement('div');
  replyBar.id = 'thread-reply-bar';
  replyBar.className = 'h-reply-bar';
  replyBar.style.display = 'none';
  footer.appendChild(replyBar);

  const composerBox = document.createElement('div');
  composerBox.className = 'h-thread-composer';

  const inputEl = document.createElement('div');
  inputEl.id = 'thread-msg-input';
  inputEl.className = 'h-msg-input';
  inputEl.contentEditable = 'true';
  inputEl.setAttribute('role', 'textbox');
  inputEl.setAttribute('aria-multiline', 'true');
  inputEl.setAttribute('data-placeholder', 'Reply in thread…');
  composerBox.appendChild(inputEl);

  const sendBtn = document.createElement('button');
  sendBtn.id = 'thread-send-btn';
  sendBtn.className = 'h-send-btn';
  sendBtn.title = 'Send (Enter)';
  sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  sendBtn.onclick = sendThreadMessage;
  composerBox.appendChild(sendBtn);

  footer.appendChild(composerBox);
  panel.appendChild(footer);

  chatBodyRow.appendChild(panel);

  // Mobile: swipe right to close
  let _swipeStartX = 0;
  panel.addEventListener('touchstart', e => { _swipeStartX = e.touches[0].clientX; }, { passive: true });
  panel.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - _swipeStartX;
    if (dx > 80) closeThread();
  }, { passive: true });

  // Keyboard handling for thread input
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendThreadMessage();
    }
  });
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
    const msgs = await fjson(`/api/rooms/${currentRoomId}/threads/${rootId}`);
    if (activeThreadId !== rootId) return; // navigated away

    body.innerHTML = '';
    const savedDay = _lastDayKey;
    _lastDayKey = null;
    for (const m of msgs) {
      appendThreadMessage(m, body);
    }
    _lastDayKey = savedDay;

    if (msgs.length > 0) threadOldestMsgId = msgs[0].id;
    threadNoMoreOlder = msgs.length < 100;

    _scrollThreadToBottom(true);
  } catch (e) {
    console.error('[thread] load failed', e);
  }
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
    const msgs = await fjson(`/api/rooms/${currentRoomId}/threads/${activeThreadId}?before=${threadOldestMsgId}&limit=50`);
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

// ── Thread composer ───────────────────────────────────────────────────────────
function _updateThreadComposer() {
  const footer = document.getElementById('thread-footer');
  if (!footer) return;
  footer.style.display = activeThreadId ? '' : 'none';
}

function sendThreadMessage() {
  if (!activeThreadId || !ws || ws.readyState !== WebSocket.OPEN) return;
  const inputEl = document.getElementById('thread-msg-input');
  if (!inputEl) return;
  const content = htmlToMarkdown(inputEl).replace(/​/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!content) return;
  inputEl.innerHTML = '';

  // Save draft clear
  try { localStorage.removeItem('stoa-thread-draft-' + currentRoomId + '-' + activeThreadId); } catch {}

  ws.send(JSON.stringify({
    type: 'send_message',
    room_id: currentRoomId,
    content,
    thread_id: activeThreadId,
    event_id: crypto.randomUUID(),
  }));
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
    const panel = _getThreadPanel();
    if (panel) panel.querySelector('#thread-msg-input')?.focus();
  };
}

// ── Reset on room change ──────────────────────────────────────────────────────
function clearThreadPanel() {
  if (activeThreadId) {
    saveThreadDraft(currentRoomId, activeThreadId);
    activeThreadId = null;
  }
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
