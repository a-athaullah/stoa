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
}

// ── Thinking bubble (before tokens arrive) ─────────────────────────────────
function showThinking(msgId, actorName, color, symbol, avatarUrl) {
  if (document.getElementById('msg-' + msgId)) return; // already exists
  const inner = document.getElementById('messages-inner');
  if (!inner) return;

  const row = document.createElement('div');
  row.className = 'h-msg-row ai';
  row.id = 'msg-' + msgId;

  // Seal
  const sealWrap = document.createElement('div');
  sealWrap.className = 'h-msg-seal-wrap';
  sealWrap.appendChild(makeAvatar(actorName, color, avatarUrl, 40));
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

// ── Append streaming token ─────────────────────────────────────────────────
function appendToken(msgId, token) {
  const row = document.getElementById('msg-' + msgId);
  if (!row) return;

  streaming[msgId] = (streaming[msgId] || '') + token;

  // First token: replace thinking bubble with real bubble
  let bubble = row.querySelector('.h-bubble');
  if (!bubble) {
    const thinkBubble = row.querySelector('.h-thinking-bubble');
    if (thinkBubble) {
      const body = thinkBubble.parentElement;
      bubble = document.createElement('div');
      bubble.className = 'h-bubble streaming';
      // Copy colors from thinking bubble
      bubble.style.background = thinkBubble.style.background;
      bubble.style.borderColor  = thinkBubble.style.borderColor;
      bubble.style.letterSpacing = '';
      bubble.style.borderTopLeftRadius = '4px';
      body.replaceChild(bubble, thinkBubble);

      // Add stream caption
      const color = row.querySelector('.h-msg-name').style.color;
      const caption = document.createElement('div');
      caption.className = 'h-stream-caption';
      caption.style.color = color;
      caption.innerHTML =
        '<span class="h-dot"></span>' +
        '<span class="h-dot"></span>' +
        '<span class="h-dot"></span>' +
        '<span class="h-status">' +
          '<span class="a">thinking</span>' +
          '<span class="b">writing</span>' +
        '</span>';
      caption.id = 'caption-' + msgId;
      body.appendChild(caption);
    }
  }
  if (!bubble) return;

  const color = row.querySelector('.h-msg-name').style.color;
  bubble.innerHTML = '';
  bubble.appendChild(document.createTextNode(streaming[msgId]));
  const cursor = document.createElement('span');
  cursor.className = 'h-cursor';
  cursor.style.color = color;
  bubble.appendChild(cursor);

  scrollToBottom();
}

// ── Finalize streaming message ─────────────────────────────────────────────
function finalizeMessage(msgId, content, fileUrl, fileName, attachments, aiModel) {
  const row = document.getElementById('msg-' + msgId);
  if (!row) return;

  const bubble = row.querySelector('.h-bubble, .h-thinking-bubble');
  if (bubble) {
    bubble.classList.remove('streaming');
    // If it was a thinking bubble, convert to regular bubble styling first
    if (bubble.classList.contains('h-thinking-bubble')) {
      bubble.classList.remove('h-thinking-bubble');
      bubble.classList.add('h-bubble');
      bubble.style.color = '';
      bubble.style.fontFamily = '';
      bubble.style.fontSize = '';
      bubble.style.lineHeight = '';
      bubble.style.borderTopLeftRadius = '4px';
    }

    bubble.innerHTML = '';
    if (attachments?.length || (fileUrl && fileName)) {
      renderAttachments(bubble, { file_url: fileUrl, file_name: fileName, attachments });
    }
    const textDiv = document.createElement('div');
    textDiv.innerHTML = highlightMentions(renderMarkdown(content || ''));
    bubble.appendChild(textDiv);
    if (aiModel) {
      const modelTag = document.createElement('div');
      modelTag.className = 'h-msg-model';
      modelTag.textContent = aiModel;
      bubble.appendChild(modelTag);
    }
    addCopyButtons(bubble);
  linkifyFilePaths(bubble);
  }

  // Add message action buttons (reply + copy) if not already present
  const body = row.querySelector('.h-msg-body');
  if (body && !body.querySelector('.h-msg-actions')) {
    const actions = document.createElement('div');
    actions.className = 'h-msg-actions';
    actions.innerHTML =
      `<button class="h-msg-action-btn" data-action="reply" title="Reply"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg></button>` +
      `<button class="h-msg-action-btn" data-action="copy" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>` +
      `<button class="h-msg-action-btn" data-action="delete" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
    const actorName = row.querySelector('.h-msg-name')?.textContent || '';
    const avatarColor = row.querySelector('.h-msg-name')?.style.color || '';
    const msgAttachments = attachments || (fileUrl ? [{ url: fileUrl, name: fileName || '', type: /\.(png|jpe?g|gif|webp|svg)$/i.test(fileName || '') ? 'image' : 'file' }] : []);
    actions.querySelector('[data-action="reply"]').onclick = () => startReply(msgId, actorName, avatarColor, content, msgAttachments);
    actions.querySelector('[data-action="copy"]').onclick = async function() {
      if (await copyToClipboard(content || '')) showCopyFeedback(this);
    };
    actions.querySelector('[data-action="delete"]').onclick = () => deleteMessage(msgId);
    body.style.position = 'relative';
    body.appendChild(actions);
  }

  // Add time to AI message meta
  const meta = row.querySelector('.h-msg-meta');
  if (meta && !meta.querySelector('.h-msg-time')) {
    const timeEl = document.createElement('span');
    timeEl.className = 'h-msg-time';
    timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(timeEl);
  }

  // Remove stream caption
  const caption = document.getElementById('caption-' + msgId);
  if (caption) caption.remove();

  // Add "done" indicator if there's a process trail
  const trail = row.querySelector('.h-process-trail');
  if (trail) {
    const done = document.createElement('div');
    done.className = 'h-process-done';
    done.textContent = 'done';
    trail.appendChild(done);
  }

  delete streaming[msgId];
}

// ── Process trail (tool steps below bubble) ────────────────────────────────
function toolSummary(name, input) {
  if (!input) return '';
  const keyMap = { Bash: 'command', Read: 'file_path', Write: 'file_path', Edit: 'file_path',
    Glob: 'pattern', Grep: 'pattern', WebFetch: 'url', WebSearch: 'query',
    NotebookEdit: 'notebook_path', mcp__ide__executeCode: 'code' };
  const key = keyMap[name];
  let val = (key && input[key]) ? String(input[key]) : (Object.values(input).find(v => typeof v === 'string') || '');
  if (val.length > 64) val = val.slice(0, 61) + '…';
  return val;
}

function appendToolStep(msgId, tool) {
  const row = document.getElementById('msg-' + msgId);
  if (!row) return;

  const body = row.querySelector('.h-msg-body');
  if (!body) return;

  let trail = body.querySelector('.h-process-trail');
  if (!trail) {
    trail = document.createElement('div');
    trail.className = 'h-process-trail';
    body.appendChild(trail);
  }

  const step = document.createElement('div');
  step.className = 'h-process-step';

  const toolEl = document.createElement('span');
  toolEl.className = 'h-process-tool';
  toolEl.textContent = tool.name;

  const inputEl = document.createElement('span');
  inputEl.className = 'h-process-input';
  inputEl.textContent = toolSummary(tool.name, tool.input);

  step.appendChild(toolEl);
  step.appendChild(inputEl);
  trail.appendChild(step);
  scrollToBottom();
}

// ── Invite card ────────────────────────────────────────────────────────────
function showInviteCard(msg) {
  const inner = document.getElementById('messages-inner');
  if (!inner) return;

  const suggested = msg.suggested_actor;
  // Try to find the proposer from actorByName if server sends actor_name
  const proposer = msg.actor_name ? actorByName[msg.actor_name] : null;

  const card = document.createElement('div');
  card.className = 'h-invite-card';

  const label = document.createElement('div');
  label.className = 'h-invite-label';
  label.textContent = 'a suggestion from the room';
  card.appendChild(label);

  const title = document.createElement('div');
  title.className = 'h-invite-title';
  if (proposer) {
    title.innerHTML =
      `<span style="color:${proposer.avatar_color};font-style:italic">${escHtml(proposer.name)}</span>` +
      ` would like to invite ` +
      `<span style="color:${suggested.avatar_color};font-style:italic">${escHtml(suggested.name)}</span>.`;
  } else {
    title.innerHTML =
      `an invitation for ` +
      `<span style="color:${suggested.avatar_color};font-style:italic">${escHtml(suggested.name)}</span>` +
      ` to join this room.`;
  }
  card.appendChild(title);

  if (msg.reason) {
    const reason = document.createElement('div');
    reason.className = 'h-invite-reason';
    reason.textContent = msg.reason;
    card.appendChild(reason);
  }

  const actions = document.createElement('div');
  actions.className = 'h-invite-actions';

  const approveBtn = document.createElement('button');
  approveBtn.className = 'h-btn-primary';
  approveBtn.textContent = 'invite';
  approveBtn.onclick = () => resolveInvite(msg.invite_id, true, [approveBtn, rejectBtn]);

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'h-btn-secondary';
  rejectBtn.textContent = 'not now';
  rejectBtn.onclick = () => resolveInvite(msg.invite_id, false, [approveBtn, rejectBtn]);

  actions.appendChild(approveBtn);
  actions.appendChild(rejectBtn);
  card.appendChild(actions);

  inner.appendChild(card);
  scrollToBottom();
}

async function resolveInvite(inviteId, approved, btns) {
  btns.forEach(b => b.disabled = true);
  try {
    const invRes = await fetch(`/api/invites/${inviteId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved }),
    });
    if (!invRes.ok) throw new Error('resolve failed');
    if (approved && currentRoomId) {
      const parts = await fjson(`/api/rooms/${currentRoomId}/participants`);
      roomParticipantsCache[currentRoomId] = parts;
      renderRoomDots(currentRoomId, parts);
      const room = { id: currentRoomId, title: document.querySelector('.h-room-name')?.textContent || '' };
      renderChatHeader(room, parts);
    }
  } catch (err) {
    console.error('Failed to resolve invite:', err);
    btns.forEach(b => b.disabled = false);
  }
}

function showUploadError(msg) {
  const el = document.getElementById('upload-error');
  document.getElementById('upload-error-text').textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 5000);
}

// ── Upload with progress ──────────────────────────────────────────────────
function uploadWithProgress(file) {
  return new Promise((resolve, reject) => {
    const prog = document.getElementById('upload-progress');
    const fill = document.getElementById('upload-progress-fill');
    const text = document.getElementById('upload-progress-text');
    prog.classList.add('visible');
    prog.classList.remove('processing');
    fill.style.width = '0%';
    text.textContent = 'Uploading...';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload/raw');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'file'));
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        fill.style.width = pct + '%';
        const kb = Math.round(e.loaded / 1024);
        const totalKb = Math.round(e.total / 1024);
        if (pct < 100) {
          text.textContent = `Uploading... ${pct}% (${kb}/${totalKb} KB)`;
        } else {
          prog.classList.add('processing');
          text.textContent = 'Processing...';
        }
      }
    };
    xhr.onload = () => {
      prog.classList.remove('visible', 'processing');
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('Invalid response')); }
      } else {
        reject(new Error('Upload failed: ' + xhr.status));
      }
    };
    xhr.onerror = () => { prog.classList.remove('visible', 'processing'); reject(new Error('Network error')); };
    xhr.send(file);
  });
}

// ── Image paste ────────────────────────────────────────────────────────────
async function handleImagePaste(e) {
  const items = [...(e.clipboardData?.items || [])];
  const imageItem = items.find(i => i.type.startsWith('image/'));
  if (!imageItem) return;
  e.preventDefault();
  const file = imageItem.getAsFile();
  try {
    const { url, name } = await uploadWithProgress(file);
    addPendingAttachment(url, name || file.name, 'image');
  } catch (err) {
    showUploadError(err.message || 'Upload failed');
  }
}

function addPendingAttachment(url, name, type) {
  pendingAttachments.push({ url, name, type });
  renderAttachPreview();
}

function removePendingAttachment(idx) {
  pendingAttachments.splice(idx, 1);
  renderAttachPreview();
}

function clearAttachments() {
  pendingAttachments = [];
  renderAttachPreview();
}

function renderAttachPreview() {
  const el = document.getElementById('attach-preview');
  if (!pendingAttachments.length) { el.classList.remove('visible'); el.innerHTML = ''; return; }
  el.classList.add('visible');
  el.innerHTML = pendingAttachments.map((a, i) => {
    if (a.type === 'image') {
      return `<div class="attach-thumb"><img src="${a.url}" alt="${escHtml(a.name)}"><button class="attach-thumb-x" data-idx="${i}">&times;</button></div>`;
    }
    const ext = (a.name || '').split('.').pop()?.toUpperCase() || 'FILE';
    return `<div class="attach-thumb-file"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>${escHtml(a.name)}</span><button class="attach-thumb-x" data-idx="${i}">&times;</button></div>`;
  }).join('');
  el.querySelectorAll('.attach-thumb-x').forEach(btn => {
    btn.onclick = () => removePendingAttachment(parseInt(btn.dataset.idx));
  });
}

