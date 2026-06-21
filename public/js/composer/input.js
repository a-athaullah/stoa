// ── HTML → Markdown ─────────────────────────────────────────────────────────
function htmlToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/​/g, '').replace(/ /g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = node.tagName.toLowerCase();
  const inner = () => Array.from(node.childNodes).map(htmlToMarkdown).join('');

  switch (tag) {
    case 'strong': case 'b': {
      const c = inner();
      return c ? `**${c}**` : '';
    }
    case 'em': case 'i': {
      const c = inner();
      return c ? `*${c}*` : '';
    }
    case 's': case 'del': case 'strike': {
      const c = inner();
      return c ? `~~${c}~~` : '';
    }
    case 'code':
      return node.closest('pre') ? inner() : `\`${inner()}\``;
    case 'pre': {
      const c = inner().replace(/\n$/, '');
      const prev = node.previousElementSibling;
      const next = node.nextElementSibling;
      const prevIsPre = prev?.tagName?.toLowerCase() === 'pre';
      const nextIsPre = next?.tagName?.toLowerCase() === 'pre';
      if (prevIsPre && nextIsPre) return c + '\n';
      if (prevIsPre) return c + '\n```\n\n';
      if (nextIsPre) return '\n```\n' + c + '\n';
      return '\n```\n' + c + '\n```\n\n';
    }
    case 'a': {
      const href = node.getAttribute('href') || '';
      const text = inner();
      if (!text || text === href) return href;
      return `[${text}](${href})`;
    }
    case 'blockquote': {
      const lines = inner().replace(/\n$/, '').split('\n');
      return lines.map(l => `> ${l}`).join('\n') + '\n\n';
    }
    case 'ol': case 'ul': {
      const c = inner();
      return c.endsWith('\n') ? c + '\n' : c + '\n\n';
    }
    case 'li': {
      const parent = node.parentElement?.tagName?.toLowerCase();
      const idx = Array.from(node.parentElement?.children || []).indexOf(node) + 1;
      const prefix = parent === 'ol' ? `${idx}. ` : '- ';
      return prefix + inner().replace(/\n$/, '').replace(/\n/g, '\n  ') + '\n';
    }
    case 'br':
      return '\n';
    case 'div': case 'p': {
      const c = inner();
      if (!c) return '\n';
      return c + (c.endsWith('\n') ? '' : '\n');
    }
    default: return inner();
  }
}

// ── Drafts per room ─────────────────────────────────────────────────────────
function saveDraft(roomId) {
  if (!roomId) return;
  const input = document.getElementById('msg-input');
  const html = input.innerHTML.trim();
  if (html && html !== '<br>') {
    localStorage.setItem('stoa-draft-' + roomId, html);
  } else {
    localStorage.removeItem('stoa-draft-' + roomId);
  }
}

function restoreDraft(roomId) {
  const input = document.getElementById('msg-input');
  const draft = localStorage.getItem('stoa-draft-' + roomId);
  input.innerHTML = draft || '';
}

function clearDraft(roomId) {
  if (roomId) localStorage.removeItem('stoa-draft-' + roomId);
}

// ── Composer processing state ───────────────────────────────────────────────
function setComposerProcessing(messageId) {
  processingMessages.add(messageId);
  document.querySelector('.h-composer-box')?.classList.add('ai-processing');
  document.getElementById('stop-btn')?.classList.add('visible');
  document.getElementById('msg-input')?.blur();
}

function clearComposerProcessing(messageId) {
  if (messageId) processingMessages.delete(messageId);
  else processingMessages.clear();
  if (processingMessages.size === 0) {
    document.querySelector('.h-composer-box')?.classList.remove('ai-processing');
    document.getElementById('stop-btn')?.classList.remove('visible');
    document.getElementById('msg-input')?.focus();
  }
}

function stopGeneration() {
  if (processingMessages.size === 0 || !ws || ws.readyState !== WebSocket.OPEN) return;
  for (const mid of processingMessages) {
    ws.send(JSON.stringify({ type: 'stop_generation', room_id: currentRoomId, message_id: mid }));
  }
  clearComposerProcessing();
}

// ── Reply ───────────────────────────────────────────────────────────────────
let pendingReplyTo = null;

function startReply(msgId, actorName, avatarColor, content, attachments) {
  pendingReplyTo = msgId;
  document.getElementById('reply-bar-name').textContent = actorName;
  document.getElementById('reply-bar-name').style.color = avatarColor || 'var(--h-ink)';
  let preview = (content || '').substring(0, 150);
  if (attachments && attachments.length) {
    const urls = attachments.map(a => a.url).join('\n');
    preview = preview ? preview + '\n' + urls : urls;
  }
  document.getElementById('reply-bar-text').textContent = preview;
  document.getElementById('reply-bar').classList.add('visible');
  document.getElementById('msg-input').focus();
}

function clearReply() {
  pendingReplyTo = null;
  document.getElementById('reply-bar').classList.remove('visible');
}

document.getElementById('reply-bar-close').onclick = clearReply;

// ── Send ────────────────────────────────────────────────────────────────────
function sendMessage() {
  const input = document.getElementById('msg-input');
  const content = htmlToMarkdown(input).replace(/​/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if ((!content && !pendingAttachments.length) || !ws || ws.readyState !== WebSocket.OPEN) return;
  input.innerHTML = '';
  const attachments = pendingAttachments.length ? [...pendingAttachments] : undefined;
  const replyTo = pendingReplyTo;
  clearAttachments();
  clearReply();
  ws.send(JSON.stringify({ type: 'send_message', room_id: currentRoomId, content, attachments, reply_to: replyTo }));
  clearDraft(currentRoomId);
}


