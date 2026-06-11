// ── Scroll ──────────────────────────────────────────────────────────────────
function scrollToBottom(force) {
  const el = document.getElementById('messages');
  if (!el) return;
  if (force || el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
    el.scrollTop = el.scrollHeight;
  }
}

// ── Load older messages on scroll to top ───────────────────────────────────
async function loadOlderMessages() {
  if (loadingOlder || noMoreOlder || !oldestMessageId || !currentRoomId) return;
  loadingOlder = true;

  const container = document.getElementById('messages');
  const inner     = document.getElementById('messages-inner');

  const spinner = document.createElement('div');
  spinner.style.cssText = 'text-align:center;padding:12px;color:var(--h-ink-mute);font-size:13px;font-family:var(--h-sans)';
  spinner.textContent = 'loading…';
  inner.prepend(spinner);

  try {
    const msgs = await fjson(`/api/rooms/${currentRoomId}/messages?before=${oldestMessageId}&limit=50`);

    spinner.remove();

    if (!msgs.length) { noMoreOlder = true; loadingOlder = false; return; }

    // Build rows into a fragment using appendMessage's container param
    const frag = document.createDocumentFragment();
    msgs.forEach(m => {
      if (!document.getElementById('msg-' + m.id)) appendMessage(m, frag);
    });

    // Snapshot scroll anchor, then prepend, then restore
    const prevHeight = inner.scrollHeight;
    const prevTop    = container.scrollTop;
    inner.prepend(frag);
    container.scrollTop = prevTop + (inner.scrollHeight - prevHeight);

    oldestMessageId = msgs[0].id;
    if (msgs.length < 50) noMoreOlder = true;
  } catch {
    spinner.remove();
    showToast('Failed to load older messages', { error: true });
  }
  loadingOlder = false;
}

function initScrollLoader() {
  const container = document.getElementById('messages');
  container.addEventListener('scroll', () => {
    if (container.scrollTop < 120) loadOlderMessages();
  });
}

