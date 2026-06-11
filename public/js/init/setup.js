function syncNewRoomBtn() {
  const hasAI = allActors.some(a => a.type === 'ai');
  document.getElementById('new-room-btn').classList.toggle('no-agents', !hasAI);
  document.getElementById('s-no-agent-banner')?.classList.toggle('visible', !hasAI);
}

// ── First-run setup ───────────────────────────────────────────────────────────
async function checkSetup() {
  let needsSetup;
  try { ({ needsSetup } = await fjson('/api/setup/status')); } catch { return; }
  if (!needsSetup) return;

  const overlay = document.getElementById('setup-overlay');
  const input   = document.getElementById('setup-name-input');
  const btn     = document.getElementById('setup-submit-btn');
  overlay.style.display = 'flex';
  setTimeout(() => input.focus(), 50);

  async function submit() {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    btn.disabled = true;
    try {
      await fjson('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      overlay.style.display = 'none';
    } catch (e) {
      console.error('Setup failed:', e);
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

