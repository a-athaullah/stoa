// Leaked "[thinking]" marker that weaker non-Anthropic models prefix onto their reply. The agent
// strips it from the final content server-side; mirror that here so it doesn't flicker mid-stream.
const THINKING_MARKER_RE = /^\s*(?:\[thinking\]\s*)+/;

// ── Live run quote ───────────────────────────────────────────────────────────
// message_state / message_complete carry the run's reply_msg. The thread panel shows it like
// appendThreadMessage does after a reload; feed roots never show one (appendFeedRootRow).
const runReplies = {}; // msgId -> {reply_to, reply_msg}

function setRunReply(msgId, msg) {
  if (msg?.reply_msg) runReplies[msgId] = { reply_to: msg.reply_to, reply_msg: msg.reply_msg };
}

function appendRunReplyQuote(row, bubble, msgId) {
  if (runReplies[msgId] && row.closest('#thread-body')) bubble.appendChild(buildReplyQuote(runReplies[msgId]));
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
  appendRunReplyQuote(row, bubble, msgId);
  bubble.appendChild(document.createTextNode(streaming[msgId].replace(THINKING_MARKER_RE, '')));
  const cursor = document.createElement('span');
  cursor.className = 'h-cursor';
  cursor.style.color = color;
  bubble.appendChild(cursor);

  scrollToBottom();
}

// ── Finalize streaming message ─────────────────────────────────────────────
function finalizeMessage(msgId, content, fileUrl, fileName, attachments, aiModel, resultMeta, modelSource) {
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
    appendRunReplyQuote(row, bubble, msgId);
    if (attachments?.length || (fileUrl && fileName)) {
      renderAttachments(bubble, { file_url: fileUrl, file_name: fileName, attachments });
    }
    const textDiv = document.createElement('div');
    textDiv.innerHTML = highlightMentions(renderMarkdown(content || ''));
    bubble.appendChild(textDiv);
    if (aiModel) {
      bubble.appendChild(buildModelTag(aiModel, modelSource));
    }
    const resultChip = buildResultChip(resultMeta);
    if (resultChip) bubble.appendChild(resultChip);
    addCopyButtons(bubble);
  linkifyFilePaths(bubble);
  externalLinksNewTab(bubble);
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
    const inThread = !!row.closest('#thread-body');
    actions.querySelector('[data-action="reply"]').onclick = inThread
      ? () => startThreadReply(msgId, actorName, avatarColor, content)
      : () => startReply(msgId, actorName, avatarColor, content, msgAttachments);
    actions.querySelector('[data-action="copy"]').onclick = async function() {
      if (await copyToClipboard(content || '')) showCopyFeedback(this);
    };
    actions.querySelector('[data-action="delete"]').onclick = () => deleteMessage(msgId);
    addMessageLinkAction(actions, msgId, inThread ? activeThreadId : null, currentRoomId);
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

  // Process trail cleanup (R29: cleanup_progress / tool_progress=new)
  const trail = row.querySelector('.h-process-trail');
  if (trail) {
    const isFailed = !!row.querySelector('.h-msg-fail');
    const shouldClean = !isFailed && (getCleanupProgress() === 'on' || getToolProgress() === 'new');
    if (shouldClean) {
      trail.remove();
    } else {
      const done = document.createElement('div');
      done.className = 'h-process-done';
      done.textContent = 'done';
      trail.appendChild(done);
    }
  }

  delete streaming[msgId];
  delete runReplies[msgId];
}

// ── Run ended by the server ─────────────────────────────────────────────────
// Agent disconnect, run timeout, agent updating, stop while offline: the server sends
// message_state error with the row's stored text. The row stays (drawn first if this client
// never had it) and keeps its text, like after a reload.
function showInterruptedRun(msg, container) {
  if (!document.getElementById('msg-' + msg.message_id)) {
    if (!container || !msg.actor_name) return;
    showThinking(msg.message_id, msg.actor_name, msg.avatar_color, msg.avatar_symbol, msg.avatar_url, msg.sub_agent_label, container, msg.sub_agent_avatar_color, msg.sub_agent_avatar_symbol, msg.sub_agent_avatar_url, msg.sub_agent_role, msg.sub_agent_id);
  }
  setRunReply(msg.message_id, msg);
  finalizeMessage(msg.message_id, msg.content, null, null, null, null, msg.result_meta);
  const row = document.getElementById('msg-' + msg.message_id);
  if (row) row.dataset.runInterrupted = '1';
}

// The agent reconnected and resumed the run: its interrupted row (live, or an error row from
// history) goes back to thinking, in place.
function takeInterruptedRun(msgId) {
  const row = document.getElementById('msg-' + msgId);
  if (!row?.dataset.runInterrupted) return null;
  const spot = { parent: row.parentNode, next: row.nextElementSibling };
  row.remove();
  return spot;
}

