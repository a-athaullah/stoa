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
