// ── Task board statistics ──────────────────────────────────────────────────
// Panel over the board in the drawer's slot (the two never show together): totals, tasks finished per
// week or month as a thin bar chart (with the same numbers as a table for screen readers), run duration
// and retries. Data: GET /api/rooms/:id/tasks/stats?tz=<minutes east of UTC>, so the server buckets
// finished_at by this browser's local day. While open, task changes refresh it (debounced).

const TB_STATS_REFRESH_MS = 2000;
const TB_STATS_RANGE = {
  week: { label: 'Week', unit: 'week', span: '12 weeks', caption: 'Tasks finished per week, last 12 weeks' },
  month: { label: 'Month', unit: 'month', span: '12 months', caption: 'Tasks finished per month, last 12 months' },
};
const _tbS = { open: false, range: 'week', roomId: null, data: null, loading: false, error: null, seq: 0, timer: 0 };

function tbStatsEl() { return document.getElementById('tb-stats'); }
function tasksStatsOpen() { return _tbS.open; }

// Minutes east of UTC, the sign the API expects (getTimezoneOffset is minutes west).
function tbStatsTz(date = new Date()) {
  const tz = -date.getTimezoneOffset();
  return Number.isInteger(tz) ? Math.max(-840, Math.min(840, tz)) : 0;
}

function tasksOpenStats() {
  if (tasksUi.openId && typeof tasksCloseDrawer === 'function') tasksCloseDrawer({ focus: false });
  const p = tbStatsEl();
  if (!p) return;
  _tbS.open = true;
  tbRenderStats();
  p.classList.add('open');
  tbPaintStatsBtn();
  setTimeout(() => { if (_tbS.open) p.focus({ preventScroll: true }); }, 30);
  tbLoadStats();
}

function tasksCloseStats({ focus = true } = {}) {
  if (!_tbS.open) return;
  _tbS.open = false;
  _tbS.seq++;
  _tbS.loading = false;
  clearTimeout(_tbS.timer);
  const p = tbStatsEl();
  if (p) { p.classList.remove('open'); p.replaceChildren(); }
  tbPaintStatsBtn();
  if (!focus) return;
  const b = document.getElementById('tb-stats-btn');
  if (b && b.isConnected) b.focus();
}

function tasksToggleStats() {
  if (_tbS.open) tasksCloseStats();
  else tasksOpenStats();
}

// Another room's numbers must never show, not even for the moment a reload takes.
function tasksStatsRoomChanged() {
  tasksCloseStats({ focus: false });
  Object.assign(_tbS, { roomId: null, data: null, error: null });
}

// task_upsert / task_delete of the current room, and a socket rejoin (events are not replayed).
function tasksStatsNoteChange() {
  if (!_tbS.open) return;
  clearTimeout(_tbS.timer);
  _tbS.timer = setTimeout(() => { if (_tbS.open) tbLoadStats(); }, TB_STATS_REFRESH_MS);
}

function tbPaintStatsBtn() {
  const b = document.getElementById('tb-stats-btn');
  if (!b) return;
  b.setAttribute('aria-expanded', String(_tbS.open));
  b.classList.toggle('on', _tbS.open);
}

async function tbLoadStats() {
  const roomId = tasksUi.roomId;
  if (!Number.isInteger(roomId)) return;
  clearTimeout(_tbS.timer);
  const seq = ++_tbS.seq;
  if (_tbS.roomId !== roomId) { _tbS.roomId = roomId; _tbS.data = null; }
  _tbS.loading = true;
  _tbS.error = null;
  if (!_tbS.data) tbRenderStats();
  let data;
  try { data = await TasksApi.stats(roomId, tbStatsTz()); } catch (err) {
    if (seq !== _tbS.seq) return;
    _tbS.loading = false;
    _tbS.error = (err && err.message) || 'Could not load statistics';
    tbRenderStats();
    return;
  }
  if (seq !== _tbS.seq || roomId !== tasksUi.roomId || !_tbS.open) return;
  _tbS.loading = false;
  if (tbValidStats(data)) _tbS.data = data;
  else _tbS.error = 'The server sent statistics this page cannot read';
  tbRenderStats();
}

function tbValidStats(d) {
  const buckets = a => Array.isArray(a) && a.every(b => b && typeof b.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.start));
  return !!(d && d.totals && typeof d.totals === 'object' && d.finished && buckets(d.finished.week) && buckets(d.finished.month));
}

function tbStatNum(v) { return Number.isFinite(v) && v > 0 ? Math.round(v) : 0; }

// Bucket starts are local calendar dates already (the server shifted them by tz): build them as local dates.
function tbStatsDay(start) {
  const [y, m, d] = start.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function tbStatsBucketLabel(start, range, now = new Date()) {
  const d = tbStatsDay(start);
  if (range === 'month') return d.toLocaleDateString([], { month: 'short', ...tbYearOpt(d, now) });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...tbYearOpt(d, now) });
}
function tbStatsBucketName(start, range) {
  const d = tbStatsDay(start);
  if (range === 'month') return d.toLocaleDateString([], { month: 'long', year: 'numeric' });
  return 'Week of ' + d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Render ───────────────────────────────────────────────────────────────────
function tbRenderStats() {
  const p = tbStatsEl();
  if (!p || !_tbS.open) return;
  const focusKey = p.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.sk : null;
  const scroll = p.querySelector('.tb-d-body') ? p.querySelector('.tb-d-body').scrollTop : 0;
  p.replaceChildren();

  const top = tbEl('div', 'tb-d-top');
  const h = tbEl('h2', 'tb-s-title', 'Statistics');
  h.id = 'tb-s-title';
  const x = tbButton('tb-iconbtn', 'x');
  x.setAttribute('aria-label', 'Close statistics');
  x.dataset.sk = 'close';
  x.addEventListener('click', () => tasksCloseStats());
  top.append(h, tbEl('span', 'tb-spacer'), x);
  p.appendChild(top);

  const body = tbEl('div', 'tb-d-body tb-s-body');
  const live = tbEl('p', 'tb-sr');
  live.setAttribute('role', 'status');
  body.appendChild(live);
  const d = _tbS.data && _tbS.roomId === tasksUi.roomId ? _tbS.data : null;
  if (!d) {
    if (_tbS.error) body.appendChild(tbStatsError());
    else { body.appendChild(tbEl('p', 'tb-s-note', 'Loading…')); live.textContent = 'Loading statistics'; }
  } else {
    if (_tbS.error) body.appendChild(tbStatsError());
    body.append(tbStatsTiles(d), tbStatsChart(d), tbStatsRetries(d));
  }
  p.appendChild(body);
  body.scrollTop = scroll;
  if (focusKey) {
    const again = p.querySelector('[data-sk="' + focusKey + '"]');
    if (again) again.focus({ preventScroll: true });
  }
}

function tbStatsError() {
  const box = tbEl('div', 'tb-d-state fail tb-s-err');
  box.setAttribute('role', 'alert');
  box.append(tbIcon('alert'), tbEl('span', null, _tbS.error));
  const again = tbButton('tb-btn tb-sm', null, 'Try again');
  again.dataset.sk = 'retry';
  again.addEventListener('click', () => tbLoadStats());
  box.appendChild(again);
  return box;
}

function tbStatsTile(label, value, sub, cls) {
  const t = tbEl('div', 'tb-s-tile' + (cls ? ' ' + cls : ''));
  t.append(tbEl('dt', null, label), tbEl('dd', 'tb-s-v', value));
  if (sub) t.appendChild(tbEl('dd', 'tb-s-sub', sub));
  return t;
}

function tbStatsSecs(v) { return Number.isFinite(v) && v >= 0 ? tbSecs(Math.round(v)) : ''; }

function tbStatsTiles(d) {
  const t = d.totals || {};
  const dur = d.duration || {};
  const grid = tbEl('dl', 'tb-s-tiles');
  const open = ['awaiting', 'backlog', 'ongoing'].map(c => tbStatNum(t[c]) + ' ' + TASK_COL_LABEL[c].toLowerCase()).join(' · ');
  const all = tbStatNum(t.all), done = tbStatNum(t.finished);
  grid.appendChild(tbStatsTile('Tasks', String(all), open));
  grid.appendChild(tbStatsTile('Finished', String(done), all ? Math.round((done / all) * 100) + '% of all tasks' : 'No tasks yet'));
  const failed = tbStatNum(t.failed), retried = tbStatNum((d.retries || {}).tasks_with_retry);
  grid.appendChild(tbStatsTile('Failed', String(failed), retried + ' ' + (retried === 1 ? 'task' : 'tasks') + ' retried', failed ? 'warn' : ''));
  const samples = tbStatNum(dur.samples);
  const avg = samples ? tbStatsSecs(dur.avg_seconds) : '';
  let sub = 'No timed runs yet';
  if (avg) {
    const med = tbStatsSecs(dur.median_seconds), max = tbStatsSecs(dur.max_seconds);
    sub = [med ? 'median ' + med : '', max ? 'longest ' + max : ''].filter(Boolean).join(' · ') || samples + ' runs';
  }
  const tile = tbStatsTile('Average run', avg || '—', sub);
  if (avg) tile.title = 'From ' + samples + ' finished ' + (samples === 1 ? 'task' : 'tasks') + ' with a start and finish time';
  grid.appendChild(tile);
  return grid;
}

function tbStatsChart(d) {
  const range = TB_STATS_RANGE[_tbS.range] ? _tbS.range : 'week';
  const meta = TB_STATS_RANGE[range];
  const buckets = (d.finished && d.finished[range]) || [];
  const sec = tbEl('section', 'tb-s-sec');
  sec.setAttribute('aria-labelledby', 'tb-s-fin-h');
  const head = tbEl('div', 'tb-s-sec-h');
  const h = tbEl('h3', null, 'Finished');
  h.id = 'tb-s-fin-h';
  const seg = tbEl('div', 'tb-seg tb-s-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Group finished tasks by');
  for (const [key, m] of Object.entries(TB_STATS_RANGE)) {
    const b = tbButton('', null, m.label);
    b.dataset.sk = 'range-' + key;
    b.setAttribute('aria-pressed', String(key === range));
    b.addEventListener('click', () => { if (_tbS.range !== key) { _tbS.range = key; tbRenderStats(); } });
    seg.appendChild(b);
  }
  head.append(h, seg);
  sec.appendChild(head);

  const counts = buckets.map(b => tbStatNum(b.count));
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) {
    const empty = tbEl('div', 'tb-s-empty');
    empty.append(tbIcon('checks'), tbEl('p', null, 'No tasks finished in the last ' + meta.span + '.'));
    sec.appendChild(empty);
    return sec;
  }
  const max = Math.max(...counts);
  const best = counts.indexOf(max);
  sec.appendChild(tbEl('p', 'tb-s-note', total + ' finished in the last ' + meta.span + ' · busiest ' + meta.unit + ': ' + tbStatsBucketLabel(buckets[best].start, range) + ' (' + max + ')'));

  const chart = tbEl('div', 'tb-s-chart');
  chart.setAttribute('aria-hidden', 'true');
  chart.style.setProperty('--n', String(buckets.length));
  buckets.forEach((b, i) => {
    const c = counts[i];
    const col = tbEl('div', 'tb-s-col' + (i === buckets.length - 1 ? ' now' : ''));
    col.title = tbStatsBucketName(b.start, range) + ': ' + c + ' finished';
    col.appendChild(tbEl('span', 'tb-s-n', c ? String(c) : ''));
    const bar = tbEl('i', 'tb-s-bar' + (c ? '' : ' zero'));
    if (c) bar.style.height = Math.max(4, Math.round((c / max) * 100)) + '%';
    col.appendChild(bar);
    const show = (buckets.length - 1 - i) % 3 === 0;
    col.appendChild(tbEl('span', 'tb-s-x', show ? tbStatsBucketLabel(b.start, range) : ''));
    chart.appendChild(col);
  });
  sec.appendChild(chart);

  const table = tbEl('table', 'tb-sr');
  table.appendChild(tbEl('caption', null, meta.caption));
  const hr = tbEl('tr');
  hr.append(tbEl('th', null, meta.label), tbEl('th', null, 'Finished'));
  const thead = tbEl('thead');
  thead.appendChild(hr);
  const tbody = tbEl('tbody');
  buckets.forEach((b, i) => {
    const r = tbEl('tr');
    r.append(tbEl('th', null, tbStatsBucketName(b.start, range)), tbEl('td', null, String(counts[i])));
    tbody.appendChild(r);
  });
  table.append(thead, tbody);
  sec.appendChild(table);
  return sec;
}

function tbStatsRetries(d) {
  const r = d.retries || {};
  const sec = tbEl('section', 'tb-s-sec');
  sec.setAttribute('aria-labelledby', 'tb-s-ret-h');
  const head = tbEl('div', 'tb-s-sec-h');
  const h = tbEl('h3', null, 'Retries and failures');
  h.id = 'tb-s-ret-h';
  head.appendChild(h);
  const dl = tbEl('dl', 'tb-s-rows');
  const row = (label, v) => {
    const w = tbEl('div');
    w.append(tbEl('dt', null, label), tbEl('dd', null, String(tbStatNum(v))));
    dl.appendChild(w);
  };
  row('Tasks retried', r.tasks_with_retry);
  row('Retries in total', r.total_retries);
  row('Failed runs', r.failed_events);
  sec.append(head, dl);
  return sec;
}
