// Settings — usage tab
let _usagePeriod = 'all';   // 'all' | '30' | '7'
let _usageView = 'summary'; // 'summary' | 'model'
let _usageData = null;

const _usageFmt = n => n >= 1e9 ? (n/1e9).toFixed(2)+'B' : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n||0);
const _usageCost = n => '$' + (n||0).toFixed(2);
const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const _pad = n => String(n).padStart(2,'0');
const _MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

async function sLoadUsageTab() {
  const panel = document.getElementById('usage-panel');
  if (!panel) return;
  panel.innerHTML = '<div style="color:var(--h-ink-faint);font-size:13px;padding:24px 0">Loading…</div>';
  const tzOffset = -new Date().getTimezoneOffset(); // minutes east of UTC (WIB = +420)
  try { _usageData = await fjson('/api/usage/stats?period=' + _usagePeriod + '&tz_offset=' + tzOffset); }
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
      <button class="usage-seg-btn${_usageView==='summary'?' active':''}" onclick="_setUsageView('summary')">Summary</button>
      <button class="usage-seg-btn${_usageView==='model'?' active':''}" onclick="_setUsageView('model')">Model</button>
    </div>`;
  const periodSeg = `
    <div class="usage-seg">
      <button class="usage-seg-btn${_usagePeriod==='all'?' active':''}" onclick="_setUsagePeriod('all')">All</button>
      <button class="usage-seg-btn${_usagePeriod==='30'?' active':''}" onclick="_setUsagePeriod('30')">30d</button>
      <button class="usage-seg-btn${_usagePeriod==='7'?' active':''}" onclick="_setUsagePeriod('7')">7d</button>
    </div>`;

  let body = _usageView === 'summary' ? _renderUsageSummary(d) : _renderUsageModel(d);

  panel.innerHTML = `
    <div class="usage-topbar">${viewSeg}${periodSeg}</div>
    ${body}`;
}

function _renderUsageSummary(d) {
  const t = d.totals || {};
  const totalTokens = (t.input_tokens||0)+(t.output_tokens||0)+(t.cache_read_tokens||0)+(t.cache_creation_tokens||0);
  const peak = d.peakHour != null ? _pad(d.peakHour)+':00' : '—';

  const cards = [
    ['Avg token/msg', _usageFmt(t.turns ? Math.round(totalTokens / t.turns) : 0)],
    ['Messages', _usageFmt(t.turns)],
    ['Total tokens', _usageFmt(totalTokens)],
    ['Active days', _usageFmt(d.activeDays)],
    ['Current streak', (d.streakCurrent||0)+'d'],
    ['Longest streak', (d.streakLongest||0)+'d'],
    ['Peak hour', peak],
    ['Input tokens', _usageFmt(t.input_tokens)],
    ['Total cost', _usageCost(t.cost_usd)],
    ['Top model', d.favoriteModel || '—'],
    ['Cache hits', _usageFmt(t.cache_read_tokens)],
    ['Output tokens', _usageFmt(t.output_tokens)],
  ];
  const cardsHtml = cards.map(([label,val]) => {
    const wide = label === 'Top model' ? ' usage-stat-card--wide' : '';
    return `<div class="usage-stat-card${wide}"><div class="usage-stat-label">${label}</div><div class="usage-stat-value" title="${val}">${val}</div></div>`;
  }).join('');

  return `
    <div class="usage-cards">${cardsHtml}</div>
    ${_renderHeatmap(d.daily || [])}
`;
}

function _renderHeatmap(daily) {
  const map = {};
  daily.forEach(x => map[x.day] = x.tokens);
  const max = Math.max(1, ...daily.map(x => x.tokens));
  const WEEKS = 26, DAYS = WEEKS*7;
  const _DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  // Walk back from local midnight; keys are local calendar dates to match the server's
  // tz-offset day-bucketing (see /api/usage/stats).
  const today = new Date(); today.setHours(0,0,0,0);
  const cells = [];
  for (let i = DAYS-1; i >= 0; i--) {
    // Step back i calendar days via setDate (DST-safe) rather than subtracting fixed ms —
    // a 23h/25h DST day would otherwise land on the wrong calendar date.
    const dt = new Date(today); dt.setDate(today.getDate() - i);
    const key = dt.getFullYear()+'-'+_pad(dt.getMonth()+1)+'-'+_pad(dt.getDate());
    const v = map[key] || 0;
    let lvl = 0;
    if (v > 0) { const r = v/max; lvl = r > 0.66 ? 4 : r > 0.33 ? 3 : r > 0.1 ? 2 : 1; }
    const tip = `${_DAY[dt.getDay()]}, ${dt.getDate()} ${_MON[dt.getMonth()]} — ${v > 0 ? _usageFmt(v)+' tokens' : 'no activity'}`;
    cells.push(`<span class="usage-cell usage-cell-${lvl}" data-tip="${tip}"></span>`);
  }
  return `<div class="usage-heatmap" style="grid-template-columns:repeat(${WEEKS},minmax(0,1fr))">${cells.join('')}</div>`;
}

function _renderUsageModel(d) {
  if (!d.byModel?.length) return '<div style="color:var(--h-ink-faint);font-size:13px;padding:8px 0">No model data yet.</div>';

  const COLORS = ['#528AF5','#3A6FD8','#7FAAFF','#2855B5','#9FC4FF','#1E44A8','#B3D0FF','#4E8AFF','#6CA0F6','#A0BFFA'];
  const models = d.byModel.map(m => m.model);
  const colorMap = {};
  models.forEach((m, i) => { colorMap[m] = COLORS[i % COLORS.length]; });

  // build day→model→tokens map from dailyByModel.
  // r.day is always a 'YYYY-MM-DD' string: usage_log.created_at fills via DEFAULT (datetime('now'))
  // and is never inserted NULL, so date(created_at, tzMod) can't return NULL here. Even a stray NULL
  // becomes the object key "null" (string), so day.slice(5,7) below stays safe. Not a finding.
  const dailyByModel = d.dailyByModel || [];
  const dayMap = {};
  dailyByModel.forEach(r => {
    if (!dayMap[r.day]) dayMap[r.day] = {};
    dayMap[r.day][r.model] = (r.input_tokens || 0) + (r.output_tokens || 0);
  });
  const days = Object.keys(dayMap).sort();

  // SVG chart
  const W = 680, H = 160, padL = 46, padR = 8, padT = 10, padB = 28;
  const cW = W - padL - padR, cH = H - padT - padB;
  const maxTotal = Math.max(1, ...days.map(day => Object.values(dayMap[day]).reduce((s,v)=>s+v,0)));
  const barSlot = days.length ? cW / days.length : cW;
  const barW = Math.max(1, Math.min(14, barSlot - 1));

  const barsEl = days.map((day, i) => {
    const x = padL + i * barSlot + barSlot/2 - barW/2;
    let stackY = padT + cH;
    return models.map(model => {
      const v = dayMap[day][model] || 0;
      if (!v) return '';
      const h = v / maxTotal * cH;
      stackY -= h;
      return `<rect x="${x.toFixed(1)}" y="${stackY.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="${colorMap[model]}"/>`;
    }).join('');
  }).join('');

  const yTicks = [0.25,0.5,0.75,1.0].map(r => ({ v: Math.round(maxTotal*r), y: padT + cH*(1-r) }));
  const yEl = yTicks.map(t =>
    `<text x="${padL-4}" y="${t.y+3}" text-anchor="end" fill="var(--h-ink-faint)" font-size="9">${_usageFmt(t.v)}</text>`+
    `<line x1="${padL}" y1="${t.y}" x2="${W-padR}" y2="${t.y}" stroke="var(--h-hair-soft)" stroke-width="0.5"/>`
  ).join('');

  const labelStep = Math.max(1, Math.ceil(days.length / 10));
  const xEl = days.map((day, i) => [day, i]).filter(([_, i]) => i % labelStep === 0 || i === days.length-1).map(([day, i]) => {
    const x = padL + i * barSlot + barSlot/2;
    const mm = day.slice(5,7), dd = day.slice(8,10);
    return `<text x="${x.toFixed(1)}" y="${H-6}" text-anchor="middle" fill="var(--h-ink-faint)" font-size="9">${parseInt(dd)} ${_MON[parseInt(mm)-1]}</text>`;
  }).join('');

  const baselineEl = `<line x1="${padL}" y1="${padT+cH}" x2="${W-padR}" y2="${padT+cH}" stroke="var(--h-hair-soft)" stroke-width="1"/>`;
  const chartSvg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block;margin-bottom:10px">${yEl}${baselineEl}${barsEl}${xEl}</svg>`;

  // model list
  const totalTok = d.byModel.reduce((s,m) => s + m.input_tokens + m.output_tokens, 0) || 1;
  const listRows = d.byModel.map(m => {
    const tok = m.input_tokens + m.output_tokens;
    const pct = (tok / totalTok * 100).toFixed(1);
    const color = colorMap[m.model] || '#888';
    return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0">
      <span style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></span>
      <span style="flex:1;font-size:11px;color:var(--h-ink);font-family:var(--h-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(m.model)}</span>
      <span style="font-size:10px;color:var(--h-ink-faint);white-space:nowrap">${_usageFmt(m.input_tokens)}in · ${_usageFmt(m.output_tokens)}out</span>
      <span style="font-size:11px;font-weight:600;color:var(--h-ink);min-width:40px;text-align:right">${pct}%</span>
    </div>`;
  }).join('');

  return `${chartSvg}<div style="max-width:${W}px">${listRows}</div>`;
}
