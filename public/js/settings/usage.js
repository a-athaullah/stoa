// Settings — usage tab
async function sLoadUsageTab() {
  const panel = document.getElementById('usage-panel');
  if (!panel) return;
  panel.innerHTML = '<div style="color:var(--h-ink-faint);font-size:13px;padding:24px 0">Loading...</div>';
  let data;
  try { data = await fjson('/api/usage/stats?days=30'); }
  catch { panel.innerHTML = '<div style="color:var(--h-ink-faint);font-size:13px;padding:24px 0">Failed to load usage data.</div>'; return; }

  const t = data.totals || {};
  const totalTokens = (t.input_tokens || 0) + (t.output_tokens || 0) + (t.cache_read_tokens || 0) + (t.cache_creation_tokens || 0);
  const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
  const fmtCost = n => '$' + (n || 0).toFixed(4);

  let html = `
    <div style="margin-bottom:20px">
      <div style="font-size:12px;color:var(--h-ink-faint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Last 30 days</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
        <div class="usage-stat-card"><div class="usage-stat-value">${fmt(totalTokens)}</div><div class="usage-stat-label">total tokens</div></div>
        <div class="usage-stat-card"><div class="usage-stat-value">${fmt(t.output_tokens || 0)}</div><div class="usage-stat-label">output tokens</div></div>
        <div class="usage-stat-card"><div class="usage-stat-value">${fmt(t.cache_read_tokens || 0)}</div><div class="usage-stat-label">cache hits</div></div>
        <div class="usage-stat-card"><div class="usage-stat-value">${fmtCost(t.cost_usd)}</div><div class="usage-stat-label">cost USD</div></div>
        <div class="usage-stat-card"><div class="usage-stat-value">${t.turns || 0}</div><div class="usage-stat-label">turns</div></div>
        <div class="usage-stat-card"><div class="usage-stat-value">${data.activeDays || 0}</div><div class="usage-stat-label">active days</div></div>
      </div>
    </div>`;

  if (data.byModel?.length) {
    html += `<div style="font-size:12px;color:var(--h-ink-faint);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">by model</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="color:var(--h-ink-faint);border-bottom:1px solid var(--h-rule)">
        <th style="text-align:left;padding:6px 8px;font-weight:500">model</th>
        <th style="text-align:right;padding:6px 8px;font-weight:500">turns</th>
        <th style="text-align:right;padding:6px 8px;font-weight:500">input</th>
        <th style="text-align:right;padding:6px 8px;font-weight:500">output</th>
        <th style="text-align:right;padding:6px 8px;font-weight:500">cost</th>
      </tr></thead><tbody>`;
    for (const m of data.byModel) {
      html += `<tr style="border-bottom:1px solid var(--h-rule)">
        <td style="padding:7px 8px;font-family:var(--h-mono);font-size:12px">${m.model}</td>
        <td style="padding:7px 8px;text-align:right;color:var(--h-ink-faint)">${m.turns}</td>
        <td style="padding:7px 8px;text-align:right;color:var(--h-ink-faint)">${fmt(m.input_tokens)}</td>
        <td style="padding:7px 8px;text-align:right;color:var(--h-ink-faint)">${fmt(m.output_tokens)}</td>
        <td style="padding:7px 8px;text-align:right">${fmtCost(m.cost_usd)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
  } else {
    html += '<div style="color:var(--h-ink-faint);font-size:13px;margin-top:8px">No usage data yet. Claude Code agent turns will appear here.</div>';
  }

  panel.innerHTML = html;
}
