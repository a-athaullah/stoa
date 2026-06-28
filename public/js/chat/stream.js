// Leaked "[thinking]" marker that weaker non-Anthropic models prefix onto their reply. The agent
// strips it from the final content server-side; mirror that here so it doesn't flicker mid-stream.
const THINKING_MARKER_RE = /^\s*(?:\[thinking\]\s*)+/;

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
  bubble.appendChild(document.createTextNode(streaming[msgId].replace(THINKING_MARKER_RE, '')));
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

