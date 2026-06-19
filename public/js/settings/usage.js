// Settings — usage tab
let _usagePeriod = 'all';   // 'all' | '30' | '7'
let _usageView = 'ringkasan'; // 'ringkasan' | 'model'
let _usageData = null;

const _usageFmt = n => n >= 1e9 ? (n/1e9).toFixed(2)+'B' : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n||0);
const _usageCost = n => '$' + (n||0).toFixed(2);

async function sLoadUsageTab() {
  const panel = document.getElementById('usage-panel');
  if (!panel) return;
  panel.innerHTML = '<div style="color:var(--h-ink-faint);font-size:13px;padding:24px 0">Loading…</div>';
  try { _usageData = await fjson('/api/usage/stats?period=' + _usagePeriod); }
  catch { panel.innerHTML = '<div style="color:var(--h-ink-faint);font-size:13px;padding:24px 0">Failed to load usage data.</div>'; return; }
  _renderUsage();
}

function _setUsagePeriod(p) { _usagePeriod = p; sLoadUsageTab(); }
function _setUsageView(v) { _usageView = v; _renderUsage(); }

function _renderUsage() {
  const panel = document.getElementById('usage-panel');
  if (!panel || !_usageData) return;
  const d = _usageData;

  // top controls
  const viewSeg = `
    <div class="usage-seg">
      <button class="usage-seg-btn${_usageView==='ringkasan'?' active':''}" onclick="_setUsageView('ringkasan')">Ringkasan</button>
      <button class="usage-seg-btn${_usageView==='model'?' active':''}" onclick="_setUsageView('model')">Model</button>
    </div>`;
  const periodSeg = `
    <div class="usage-seg">
      <button class="usage-seg-btn${_usagePeriod==='all'?' active':''}" onclick="_setUsagePeriod('all')">Semua</button>
      <button class="usage-seg-btn${_usagePeriod==='30'?' active':''}" onclick="_setUsagePeriod('30')">30h</button>
      <button class="usage-seg-btn${_usagePeriod==='7'?' active':''}" onclick="_setUsagePeriod('7')">7h</button>
    </div>`;

  let body = _usageView === 'ringkasan' ? _renderUsageRingkasan(d) : _renderUsageModel(d);

  panel.innerHTML = `
    <div class="usage-topbar">${viewSeg}${periodSeg}</div>
    ${body}`;
}

function _renderUsageRingkasan(d) {
  const t = d.totals || {};
  const totalTokens = (t.input_tokens||0)+(t.output_tokens||0)+(t.cache_read_tokens||0)+(t.cache_creation_tokens||0);
  const peak = d.peakHour != null ? String(d.peakHour).padStart(2,'0')+':00' : '—';

  const cards = [
    ['Sesi', _usageFmt(d.sessions)],
    ['Pesan', _usageFmt(t.turns)],
    ['Total token', _usageFmt(totalTokens)],
    ['Hari aktif', _usageFmt(d.activeDays)],
    ['Streak saat ini', (d.streakCurrent||0)+'h'],
    ['Streak terpanjang', (d.streakLongest||0)+'h'],
    ['Jam puncak', peak],
    // extra info (not in original mock)
    ['Total biaya', _usageCost(t.cost_usd)],
    ['Output token', _usageFmt(t.output_tokens)],
    ['Cache hits', _usageFmt(t.cache_read_tokens)],
    ['Model favorit', d.favoriteModel || '—'],
  ];
  const cardsHtml = cards.map(([label,val]) => {
    const wide = label === 'Model favorit' ? ' usage-stat-card--wide' : '';
    return `<div class="usage-stat-card${wide}"><div class="usage-stat-label">${label}</div><div class="usage-stat-value" title="${val}">${val}</div></div>`;
  }).join('');

  return `
    <div class="usage-cards">${cardsHtml}</div>
    ${_renderHeatmap(d.daily || [])}
    <div class="usage-footer">${_usageComparison(totalTokens)}</div>`;
}

function _renderHeatmap(daily) {
  const map = {};
  daily.forEach(x => map[x.day] = x.tokens);
  const max = Math.max(1, ...daily.map(x => x.tokens));
  const WEEKS = 30, DAYS = WEEKS*7;
  const today = new Date(Date.now() + 7*3600000);
  const cells = [];
  for (let i = DAYS-1; i >= 0; i--) {
    const dt = new Date(today.getTime() - i*86400000);
    const key = dt.toISOString().slice(0,10);
    const v = map[key] || 0;
    let lvl = 0;
    if (v > 0) { const r = v/max; lvl = r > 0.66 ? 4 : r > 0.33 ? 3 : r > 0.1 ? 2 : 1; }
    cells.push(`<span class="usage-cell usage-cell-${lvl}" title="${key}: ${_usageFmt(v)} token"></span>`);
  }
  return `<div class="usage-heatmap">${cells.join('')}</div>`;
}

function _usageComparison(tokens) {
  // ~1.3 tokens per word approximation
  const books = [
    { name: 'Dune', words: 188000 },
    { name: 'War and Peace', words: 587000 },
    { name: 'Lord of the Rings', words: 481000 },
    { name: 'Harry Potter (seri lengkap)', words: 1084000 },
  ];
  const bookTokens = b => b.words * 1.3;
  // pick the largest book the user still surpasses, else smallest
  let chosen = books[0];
  for (const b of books) { if (tokens >= bookTokens(b)) chosen = b; }
  const ratio = tokens / bookTokens(chosen);
  if (ratio < 1) {
    const pct = Math.round(ratio*100);
    return `Kamu sudah menggunakan ~${pct}% dari token yang setara novel <em>${chosen.name}</em>.`;
  }
  const x = ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1);
  return `Kamu telah menggunakan ~${x}× lebih banyak token dibandingkan <em>${chosen.name}</em>.`;
}

function _renderUsageModel(d) {
  if (!d.byModel?.length) return '<div style="color:var(--h-ink-faint);font-size:13px;padding:8px 0">Belum ada data model.</div>';
  const rows = d.byModel.map(m => `
    <tr>
      <td class="usage-model-name">${m.model}</td>
      <td>${m.turns}</td>
      <td>${_usageFmt(m.input_tokens)}</td>
      <td>${_usageFmt(m.output_tokens)}</td>
      <td>${_usageFmt(m.cache_read_tokens)}</td>
      <td class="usage-model-cost">${_usageCost(m.cost_usd)}</td>
    </tr>`).join('');
  return `
    <table class="usage-table">
      <thead><tr>
        <th style="text-align:left">model</th><th>turns</th><th>input</th><th>output</th><th>cache</th><th>cost</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
