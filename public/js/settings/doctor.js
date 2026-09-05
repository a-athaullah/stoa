// Settings — doctor tab
let _doctorData = null;
let _doctorLoading = false;

const _fmtBytes = n => {
  if (n == null) return '—';
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
};
const _fmtNum = n => n == null ? '—' : n.toLocaleString();

async function sLoadDoctorTab() {
  const panel = document.getElementById('doctor-panel');
  if (!panel || _doctorLoading) return;
  _doctorLoading = true;
  panel.innerHTML = '<div style="color:var(--h-ink-faint);font-size:13px;padding:24px 0">Loading…</div>';
  try {
    _doctorData = await fjson('/api/health/db');
  } catch (e) {
    panel.innerHTML = `<div style="color:var(--h-ink-faint);font-size:13px;padding:24px 0">Failed to load: ${e.message}</div>`;
    _doctorLoading = false;
    return;
  }
  _doctorLoading = false;
  _renderDoctor();
  _debugBundleLoadList();
}

function _renderDoctor() {
  const panel = document.getElementById('doctor-panel');
  if (!panel || !_doctorData) return;
  const d = _doctorData;
  const counts = d.counts || {};
  const checks = d.checks || [];

  const failCount = checks.filter(c => !c.ok).length;
  const statusBadge = failCount === 0
    ? `<span style="color:var(--h-green,oklch(0.65 0.16 145));font-size:12px;font-weight:600">✓ all checks passed</span>`
    : `<span style="color:var(--h-red,oklch(0.6 0.18 27));font-size:12px;font-weight:600">⚠ ${failCount} check${failCount > 1 ? 's' : ''} failed</span>`;

  const statsRows = [
    ['DB size', _fmtBytes(d.size_bytes)],
    ['WAL size', _fmtBytes(d.wal_size_bytes)],
    ['Journal mode', d.journal_mode || '—'],
    ['Page size', _fmtBytes(d.page_size)],
    ['Pages', _fmtNum(d.page_count)],
    ['Freelist pages', _fmtNum(d.freelist_pages)],
  ].map(([k, v]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--h-hair-soft)">
      <span style="font-size:12.5px;color:var(--h-ink-mute)">${k}</span>
      <span style="font-size:12.5px;font-family:var(--h-mono);color:var(--h-ink)">${v}</span>
    </div>`).join('');

  const countRows = [
    ['Rooms', counts.rooms],
    ['Messages', counts.messages],
    ['Sessions', counts.ai_sessions],
    ['Agents', counts.agents],
  ].map(([k, v]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--h-hair-soft)">
      <span style="font-size:12.5px;color:var(--h-ink-mute)">${k}</span>
      <span style="font-size:12.5px;font-family:var(--h-mono);color:var(--h-ink)">${_fmtNum(v)}</span>
    </div>`).join('');

  const checksHtml = checks.map(c => {
    const icon = c.ok ? '✓' : '⚠';
    const color = c.ok ? 'var(--h-green,oklch(0.65 0.16 145))' : 'var(--h-red,oklch(0.6 0.18 27))';
    const fixBlock = !c.ok && c.fix ? `
      <div style="margin-top:6px;background:var(--h-code-bg,oklch(0.97 0 0));border-radius:6px;padding:6px 10px;display:flex;align-items:center;gap:8px;justify-content:space-between">
        <code style="font-family:var(--h-mono);font-size:11.5px;color:var(--h-ink)">${c.fix}</code>
        <button onclick="navigator.clipboard.writeText('${c.fix.replace(/'/g, "\\'")}')" style="flex-shrink:0;background:none;border:none;cursor:pointer;color:var(--h-ink-mute);font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid var(--h-border)">copy</button>
      </div>` : '';
    return `
      <div style="padding:8px 0;border-bottom:1px solid var(--h-hair-soft)">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="color:${color};font-size:13px;font-weight:600;min-width:14px">${icon}</span>
          <span style="font-size:12.5px;color:var(--h-ink);font-weight:${c.ok ? '400' : '600'}">${c.name}</span>
          ${c.value != null ? `<span style="font-size:11px;color:var(--h-ink-mute);margin-left:auto;font-family:var(--h-mono)">${c.value}</span>` : ''}
        </div>
        ${fixBlock}
      </div>`;
  }).join('');

  const section = (title, content) => `
    <div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:600;color:var(--h-ink-mute);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${title}</div>
      ${content}
    </div>`;

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      ${statusBadge}
      <button onclick="sLoadDoctorTab()" style="background:none;border:1px solid var(--h-border);border-radius:6px;padding:4px 10px;font-size:12px;color:var(--h-ink-mute);cursor:pointer">↻ refresh</button>
    </div>
    ${section('Database', statsRows)}
    ${section('Counts', countRows)}
    ${section('Health Checks', checksHtml || '<div style="font-size:12.5px;color:var(--h-ink-faint)">No checks available.</div>')}
    ${_renderImportSection()}
    ${_renderDebugBundleSection()}
  `;
}

function _renderImportSection() {
  return `
    <div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:600;color:var(--h-ink-mute);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Import Session</div>
      <div style="font-size:12.5px;color:var(--h-ink-mute);margin-bottom:10px">Import a Claude Code session transcript (.jsonl) into the current room.</div>
      <div id="doctor-import-area" style="border:1px dashed var(--h-border);border-radius:8px;padding:16px;text-align:center">
        <input type="file" id="doctor-import-file" accept=".jsonl" style="display:none" onchange="_doctorHandleImport(this)">
        <button onclick="document.getElementById('doctor-import-file').click()" style="background:none;border:1px solid var(--h-border);border-radius:6px;padding:6px 14px;font-size:12.5px;color:var(--h-ink);cursor:pointer">Choose .jsonl file</button>
        <div style="font-size:11px;color:var(--h-ink-faint);margin-top:6px">Max 50 MB</div>
      </div>
      <div id="doctor-import-result" style="margin-top:8px;font-size:12.5px;color:var(--h-ink-mute)"></div>
    </div>`;
}

function _renderDebugBundleSection() {
  return `
    <div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:600;color:var(--h-ink-mute);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Debug Bundle</div>
      <div style="font-size:12.5px;color:var(--h-ink-mute);margin-bottom:10px">Create a diagnostic snapshot for troubleshooting. All secrets are force-redacted. No message content is included.</div>
      <div id="debug-bundle-actions" style="margin-bottom:8px">
        <button id="debug-bundle-create-btn" onclick="_debugBundleShowConsent()" style="background:none;border:1px solid var(--h-border);border-radius:6px;padding:6px 14px;font-size:12.5px;color:var(--h-ink);cursor:pointer">Create debug bundle</button>
      </div>
      <div id="debug-bundle-consent" style="display:none;border:1px solid var(--h-border);border-radius:8px;padding:14px;margin-bottom:10px;background:var(--h-code-bg,oklch(0.97 0 0))">
        <div style="font-size:12.5px;color:var(--h-ink);margin-bottom:10px;line-height:1.5">
          This bundle will contain:<br>
          &bull; Database health stats &amp; table counts<br>
          &bull; Room and agent metadata (no message content)<br>
          &bull; Recent server log lines (force-redacted)<br><br>
          The bundle will be <b>readable only once</b>, then auto-deleted.<br>
          Expires in 24 hours. All API keys, emails, and secrets are redacted.
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="_debugBundleHideConsent()" style="background:none;border:1px solid var(--h-border);border-radius:6px;padding:5px 12px;font-size:12px;color:var(--h-ink-mute);cursor:pointer">Cancel</button>
          <button onclick="_debugBundleCreate()" style="background:var(--h-accent,oklch(0.55 0.15 250));border:none;border-radius:6px;padding:5px 12px;font-size:12px;color:#fff;cursor:pointer">I understand, create bundle</button>
        </div>
      </div>
      <div id="debug-bundle-list"></div>
      <div id="debug-bundle-status" style="font-size:12.5px;color:var(--h-ink-mute);margin-top:4px"></div>
    </div>`;
}

function _debugBundleShowConsent() {
  const el = document.getElementById('debug-bundle-consent');
  if (el) el.style.display = 'block';
}
function _debugBundleHideConsent() {
  const el = document.getElementById('debug-bundle-consent');
  if (el) el.style.display = 'none';
}

async function _debugBundleCreate() {
  _debugBundleHideConsent();
  const status = document.getElementById('debug-bundle-status');
  if (status) { status.textContent = 'Creating bundle...'; status.style.color = 'var(--h-ink-mute)'; }
  try {
    const r = await fetch('/api/debug/bundle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || r.statusText); }
    const data = await r.json();
    if (status) { status.textContent = 'Bundle created.'; status.style.color = 'var(--h-green,oklch(0.65 0.16 145))'; }
    _debugBundleLoadList();
  } catch (e) {
    if (status) { status.textContent = `Failed: ${e.message}`; status.style.color = 'var(--h-red,oklch(0.6 0.18 27))'; }
  }
}

async function _debugBundleLoadList() {
  const container = document.getElementById('debug-bundle-list');
  if (!container) return;
  try {
    const bundles = await fjson('/api/debug/bundles');
    if (!bundles.length) { container.innerHTML = ''; return; }
    container.innerHTML = bundles.map(b => {
      const expires = new Date(b.expires_at + 'Z');
      const remaining = Math.max(0, Math.round((expires - Date.now()) / 60000));
      return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--h-hair-soft)">
        <span style="font-size:11.5px;font-family:var(--h-mono);color:var(--h-ink-mute)">${b.id.slice(0, 8)}</span>
        <span style="font-size:11px;color:var(--h-ink-faint)">${_fmtBytes(b.size_bytes)} &middot; expires ${remaining}m</span>
        <button onclick="_debugBundleDownload('${b.id}')" style="margin-left:auto;background:none;border:1px solid var(--h-border);border-radius:4px;padding:2px 8px;font-size:11px;color:var(--h-ink);cursor:pointer">download</button>
        <button onclick="_debugBundleDelete('${b.id}')" style="background:none;border:1px solid var(--h-border);border-radius:4px;padding:2px 8px;font-size:11px;color:var(--h-red,oklch(0.6 0.18 27));cursor:pointer">delete</button>
      </div>`;
    }).join('');
  } catch {}
}

function _debugBundleDownload(id) {
  const a = document.createElement('a');
  a.href = `/api/debug/bundle/${id}`;
  a.download = `stoa-debug-${id.slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => _debugBundleLoadList(), 1000);
}

async function _debugBundleDelete(id) {
  try {
    await fetch(`/api/debug/bundle/${id}`, { method: 'DELETE' });
    _debugBundleLoadList();
  } catch {}
}

async function _doctorHandleImport(input) {
  const file = input.files?.[0];
  if (!file) return;
  const result = document.getElementById('doctor-import-result');
  if (!result) return;
  if (file.size > 50 * 1024 * 1024) {
    result.textContent = 'File too large (max 50 MB).';
    result.style.color = 'var(--h-red,oklch(0.6 0.18 27))';
    return;
  }
  if (!currentRoomId) {
    result.textContent = 'Open a room first to import a session.';
    result.style.color = 'var(--h-red,oklch(0.6 0.18 27))';
    return;
  }
  result.textContent = 'Uploading…';
  result.style.color = 'var(--h-ink-mute)';
  try {
    const r = await fetch(`/api/rooms/${currentRoomId}/sessions/import`, { method: 'POST', body: file });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const data = await r.json();
    result.textContent = `Imported ${data.imported_count} message${data.imported_count !== 1 ? 's' : ''}${data.skipped_count ? `, skipped ${data.skipped_count}` : ''}.`;
    result.style.color = 'var(--h-green,oklch(0.65 0.16 145))';
  } catch (e) {
    result.textContent = `Import failed: ${e.message}`;
    result.style.color = 'var(--h-red,oklch(0.6 0.18 27))';
  }
  input.value = '';
}
