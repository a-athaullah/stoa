// ── Scheduled triggers panel ────────────────────────────────────────────────
// Room-sidebar popover: an AI participant of the room runs a task on an
// interval or on a daily / weekly / monthly / yearly wall-clock slot. The
// server (lib/schedule.js) owns validation and next_run_at; this panel only
// builds schedule_spec and renders what the API returns.

const SCHED_TYPES = ['interval', 'daily', 'weekly', 'monthly', 'yearly'];
const SCHED_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SCHED_WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SCHED_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SCHED_MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const SCHED_INTERVAL_PRESETS = [15, 30, 60, 180, 360, 720, 1440];
const SCHED_TZ_LABELS = { 'Asia/Jakarta': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT', UTC: 'UTC', 'Etc/UTC': 'UTC' };
const SCHED_COMMON_TZS = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'UTC'];
const SCHED_TASK_MIN = 10;
const SCHED_TASK_MAX = 4000;
const SCHED_ROOM_LIMIT = 20;
const SCHED_ERRORS = {
  schedule_limit: `this room already has ${SCHED_ROOM_LIMIT} triggers`,
};
const SCHED_ICONS = {
  edit:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
  clock: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

let _schedPanel = null;

function schedEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function schedBrowserTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

function schedAllTimeZones() {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return []; }
}

function schedTzLabel(tz) {
  return SCHED_TZ_LABELS[tz] || String(tz || 'UTC').split('/').pop().replace(/_/g, ' ');
}

function schedOrdinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return n + 'th';
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}

function schedIntervalText(min) {
  if (min === 60) return 'every hour';
  if (min % 60 === 0) return `every ${min / 60} hours`;
  if (min > 60) return `every ${Math.floor(min / 60)} h ${min % 60} min`;
  return `every ${min} min`;
}

function schedDaysText(days) {
  const set = new Set(days || []);
  if (set.size === 7) return 'every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'weekends';
  return SCHED_WEEK_ORDER.filter(d => set.has(d)).map(d => SCHED_DAY_NAMES[d]).join(', ');
}

// short=true → compact chip for list rows; otherwise a full sentence for the preview.
function schedSummary(spec, short) {
  if (!spec || !SCHED_TYPES.includes(spec.type)) return 'unknown schedule';
  if (spec.type === 'interval') return schedIntervalText(spec.every_minutes);
  const at = `${spec.at} ${schedTzLabel(spec.tz)}`;
  if (spec.type === 'daily') return short ? `daily · ${at}` : `every day at ${at}`;
  if (spec.type === 'weekly') {
    const d = schedDaysText(spec.days);
    if (short) return `${d} · ${at}`;
    const lead = { 'every day': 'every day', weekdays: 'every weekday', weekends: 'every weekend' }[d] || `every ${d}`;
    return `${lead} at ${at}`;
  }
  if (spec.type === 'monthly') {
    return short ? `monthly · ${schedOrdinal(spec.day)} · ${at}` : `every month on the ${schedOrdinal(spec.day)} at ${at}`;
  }
  const md = `${SCHED_MONTH_NAMES[spec.month - 1] || '?'} ${spec.day}`;
  return short ? `yearly · ${md} · ${at}` : `every year on ${md} at ${at}`;
}

function schedSummaryNote(spec) {
  if (spec.type === 'monthly' && spec.day > 28) return `months without a ${schedOrdinal(spec.day)} run on their last day`;
  if (spec.type === 'yearly' && spec.month === 2 && spec.day === 29) return 'non-leap years run on Feb 28';
  return '';
}

function schedParseUtc(s) {
  if (!s) return null;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
  return isNaN(d) ? null : d;
}

function schedRelative(d) {
  const min = Math.round((d - Date.now()) / 60000);
  if (min <= 0) return 'due now';
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
}

function schedNextRunText(sched) {
  const d = schedParseUtc(sched.next_run_at);
  if (!sched.enabled || !d) return 'paused';
  const spec = sched.schedule_spec || {};
  const tz = spec.type && spec.type !== 'interval' ? (spec.tz || 'UTC') : schedBrowserTz();
  let when;
  try {
    when = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  } catch {
    when = d.toISOString().slice(0, 16).replace('T', ' ');
  }
  return `next ${when} ${schedTzLabel(tz)} · ${schedRelative(d)}`;
}

function schedDefaultForm(agents) {
  const now = new Date();
  return {
    editId: null, target: agents[0]?.actor_id ?? null,
    type: 'daily', every: 60, at: '09:00', tz: schedBrowserTz(),
    days: new Set([now.getDay()]), day: now.getDate(), month: now.getMonth() + 1, yday: now.getDate(),
    task: '', error: '', busy: false,
  };
}

function schedFormFromSchedule(sched) {
  const spec = sched.schedule_spec || {};
  const f = schedDefaultForm([]);
  f.editId = sched.id;
  f.target = sched.target_actor_id;
  f.type = SCHED_TYPES.includes(spec.type) ? spec.type : 'daily';
  if (spec.every_minutes) f.every = spec.every_minutes;
  if (spec.at) f.at = spec.at;
  if (spec.tz) f.tz = spec.tz;
  if (Array.isArray(spec.days) && spec.days.length) f.days = new Set(spec.days);
  if (spec.type === 'monthly' && spec.day) f.day = spec.day;
  if (spec.type === 'yearly') { if (spec.month) f.month = spec.month; if (spec.day) f.yday = spec.day; }
  f.task = sched.task || '';
  return f;
}

function schedSpecFromForm(f) {
  if (f.type === 'interval') return { type: 'interval', every_minutes: f.every };
  const base = { type: f.type, at: f.at, tz: f.tz };
  if (f.type === 'weekly') base.days = [...f.days].sort((a, b) => a - b);
  if (f.type === 'monthly') base.day = f.day;
  if (f.type === 'yearly') { base.month = f.month; base.day = f.yday; }
  return base;
}

function schedValidateForm(f) {
  if (!f.target) return 'pick an agent';
  if (f.type === 'interval' && !(Number.isInteger(f.every) && f.every >= 5 && f.every <= 1440)) return 'interval must be 5–1440 minutes';
  if (f.type !== 'interval' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.at)) return 'pick a time';
  if (f.type === 'weekly' && !f.days.size) return 'pick at least one day';
  if (f.task.trim().length < SCHED_TASK_MIN) return `task needs at least ${SCHED_TASK_MIN} characters`;
  return '';
}

// room_schedule_changed (websocket.js) → refresh the open panel for that room.
function onRoomScheduleChanged(roomId) {
  if (!_schedPanel || !_schedPanel.pop.isConnected) { _schedPanel = null; return; }
  if (_schedPanel.roomId === Number(roomId)) _schedPanel.reload();
}

function buildSchedulePanel(pop, room) {
  const head = schedEl('div', 'sch-head');
  const countEl = schedEl('span', 'sch-count');
  const addBtn = schedEl('button', 'sch-add', '+ new trigger');
  addBtn.type = 'button';
  head.append(countEl, addBtn);
  const formHost = schedEl('div');
  const listHost = schedEl('div', 'sch-list');
  pop.append(head, formHost, listHost);

  let schedules = [], diagnoses = {}, agents = [], form = null, loaded = false;
  _schedPanel = { roomId: room.id, pop, reload: load };

  addBtn.onclick = () => { form = schedDefaultForm(agents); renderForm(); renderHead(); };

  async function load() {
    try {
      const [sc, doc, parts] = await Promise.all([
        fjson(`/api/rooms/${room.id}/schedules`),
        fjson(`/api/rooms/${room.id}/schedules/doctor`).catch(() => ({ diagnoses: [] })),
        fjson(`/api/rooms/${room.id}/participants`).catch(() => roomParticipantsCache[room.id] || []),
      ]);
      schedules = sc.schedules || [];
      diagnoses = Object.fromEntries((doc.diagnoses || []).map(d => [d.schedule_id, d]));
      agents = (Array.isArray(parts) ? parts : []).filter(p => p.type === 'ai');
      loaded = true;
      renderHead();
      renderList();
    } catch {
      listHost.replaceChildren();
      const err = schedEl('div', 'sch-load-error', 'failed to load triggers');
      const retry = schedEl('button', 'sch-link', 'retry');
      retry.type = 'button';
      retry.onclick = load;
      err.appendChild(retry);
      listHost.appendChild(err);
    }
  }

  function renderHead() {
    const active = schedules.filter(s => s.enabled).length;
    countEl.textContent = loaded ? `${active} active · ${schedules.length}/${SCHED_ROOM_LIMIT}` : '';
    addBtn.hidden = !!form;
    addBtn.disabled = !loaded || !agents.length || schedules.length >= SCHED_ROOM_LIMIT;
    addBtn.title = !agents.length && loaded ? 'add an AI agent to this room first'
      : schedules.length >= SCHED_ROOM_LIMIT ? SCHED_ERRORS.schedule_limit : '';
  }

  function agentOf(sched) {
    return agents.find(a => a.actor_id === sched.target_actor_id) || null;
  }

  function renderList() {
    listHost.replaceChildren();
    if (!schedules.length) {
      const empty = schedEl('div', 'sch-empty');
      empty.appendChild(schedEl('div', 'sch-empty-title', 'no scheduled triggers yet'));
      empty.appendChild(schedEl('div', 'sch-empty-body', agents.length
        ? 'an agent in this room runs a task on a schedule — or ask the agent to set one up for you'
        : 'add an AI agent to this room to schedule tasks for it'));
      listHost.appendChild(empty);
      return;
    }
    schedules.forEach(sched => listHost.appendChild(renderRow(sched)));
  }

  function renderRow(sched) {
    const row = schedEl('div', 'sch-row' + (sched.enabled ? '' : ' is-off'));
    const agent = agentOf(sched);
    const name = sched.target_name || agent?.name || '?';
    row.appendChild(makeAvatar(name, agent?.avatar_color, agent?.avatar_url, 26));

    const main = schedEl('div', 'sch-row-main');
    const top = schedEl('div', 'sch-row-top');
    top.appendChild(schedEl('span', 'sch-row-name', name));
    top.appendChild(schedEl('span', 'sch-chip', schedSummary(sched.schedule_spec, true)));
    const diag = diagnoses[sched.id];
    if (diag && diag.status !== 'ok') {
      const badge = schedEl('span', `sch-badge sch-badge-${diag.status === 'overdue' ? 'warn' : 'err'}`, diag.status.replace(/_/g, ' '));
      if (diag.details) badge.title = diag.details;
      top.appendChild(badge);
    }
    const task = schedEl('div', 'sch-row-task', sched.task);
    task.title = sched.task;
    const meta = schedEl('div', 'sch-row-meta');
    meta.appendChild(schedEl('span', null, schedNextRunText(sched)));
    if (sched.created_by_type === 'ai' && sched.created_by_name) meta.appendChild(schedEl('span', 'sch-by', `by ${sched.created_by_name}`));
    if (sched.last_error) {
      const le = schedEl('span', 'sch-last-error', 'last run skipped');
      le.title = sched.last_error;
      meta.appendChild(le);
    }
    main.append(top, task, meta);

    const ctrl = schedEl('div', 'sch-row-ctrl');
    ctrl.append(makeSwitch(sched, name), makeIconBtn(SCHED_ICONS.edit, `edit trigger for ${name}`, () => {
      form = schedFormFromSchedule(sched);
      renderForm(); renderHead();
      formHost.scrollIntoView({ block: 'nearest' });
    }), makeDeleteBtn(sched, name));
    row.append(main, ctrl);
    return row;
  }

  function makeIconBtn(svg, label, onClick) {
    const b = schedEl('button', 's-icon-btn');
    b.type = 'button';
    b.innerHTML = svg;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.onclick = onClick;
    return b;
  }

  function makeSwitch(sched, name) {
    const b = schedEl('button', 'sch-switch');
    b.type = 'button';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', sched.enabled ? 'true' : 'false');
    const label = `${sched.enabled ? 'pause' : 'resume'} trigger for ${name}`;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(schedEl('span', 'sch-switch-knob'));
    b.onclick = async () => {
      b.disabled = true;
      const ok = await send('PATCH', `/api/rooms/${room.id}/schedules/${sched.id}`, { enabled: !sched.enabled });
      if (!ok.ok) { showToast(ok.error, { error: true }); b.disabled = false; return; }
      load();
    };
    return b;
  }

  function makeDeleteBtn(sched, name) {
    const label = `delete trigger for ${name}`;
    const b = makeIconBtn(SCHED_ICONS.trash, label, null);
    let timer = null;
    b.onclick = async () => {
      if (!b.classList.contains('is-armed')) {
        b.classList.add('is-armed');
        b.title = 'click again to delete';
        b.setAttribute('aria-label', 'click again to delete');
        timer = setTimeout(() => { b.classList.remove('is-armed'); b.title = label; b.setAttribute('aria-label', label); }, 3000);
        return;
      }
      clearTimeout(timer);
      b.disabled = true;
      const ok = await send('DELETE', `/api/rooms/${room.id}/schedules/${sched.id}`);
      if (!ok.ok) { showToast(ok.error, { error: true }); b.disabled = false; return; }
      if (form && form.editId === sched.id) { form = null; renderForm(); }
      load();
    };
    return b;
  }

  async function send(method, url, body) {
    try {
      const r = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 401) { showLogin(); return { ok: false, error: 'session expired' }; }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: SCHED_ERRORS[data.code] || SCHED_ERRORS[data.error] || data.error || `failed (${r.status})` };
      return { ok: true, data };
    } catch {
      return { ok: false, error: 'network error' };
    }
  }

  function closeForm() {
    form = null;
    renderForm();
    renderHead();
  }

  function renderForm() {
    formHost.replaceChildren();
    if (!form) return;
    const f = form;
    const editing = f.editId ? schedules.find(s => s.id === f.editId) : null;

    const wrap = schedEl('div', 'sch-form');
    const ftop = schedEl('div', 'sch-form-top');
    ftop.appendChild(schedEl('span', 'sch-form-title', editing ? 'edit trigger' : 'new trigger'));
    const fx = schedEl('button', 's-icon-btn', '×');
    fx.type = 'button';
    fx.title = 'close';
    fx.setAttribute('aria-label', 'close');
    fx.onclick = closeForm;
    ftop.appendChild(fx);
    wrap.appendChild(ftop);

    const field = (label) => {
      const box = schedEl('div', 'sch-field');
      box.appendChild(schedEl('div', 'sch-label', label));
      wrap.appendChild(box);
      return box;
    };

    const agentField = field('agent');
    if (!agents.length) {
      agentField.appendChild(schedEl('div', 'sch-note', 'add an AI agent to this room first'));
    } else {
      const group = schedEl('div', 'sch-agents');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', 'agent');
      const known = agents.some(a => a.actor_id === f.target);
      if (!known && editing) group.appendChild(agentChip({ actor_id: f.target, name: editing.target_name || '?' }, true));
      agents.forEach(a => group.appendChild(agentChip(a, a.actor_id === f.target)));
      agentField.appendChild(group);
    }

    const typeField = field('repeat');
    const seg = schedEl('div', 'sch-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'repeat');
    SCHED_TYPES.forEach(t => {
      const b = schedEl('button', 'sch-seg-btn', t);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', t === f.type ? 'true' : 'false');
      b.onclick = () => { if (f.type !== t) { f.type = t; f.error = ''; renderForm(); } };
      seg.appendChild(b);
    });
    typeField.appendChild(seg);

    if (f.type === 'interval') renderIntervalFields(field);
    if (f.type === 'weekly') renderWeekdayField(field);
    if (f.type === 'monthly') renderMonthlyField(field);
    if (f.type === 'yearly') renderYearlyField(field);
    if (f.type !== 'interval') renderTimeField(field);

    const taskField = field('task');
    const ta = schedEl('textarea', 'sch-input sch-task');
    ta.value = f.task;
    ta.maxLength = SCHED_TASK_MAX;
    ta.rows = 3;
    ta.placeholder = 'summarize yesterday’s merged PRs and post the highlights here';
    ta.setAttribute('aria-label', 'task');
    const taskFoot = schedEl('div', 'sch-task-foot');
    const tip = schedEl('span', 'sch-hint');
    tip.append('tip: write ', schedEl('code', null, '@SubAgent'), ' in the task to hand the work to a sub-agent');
    const counter = schedEl('span', 'sch-counter');
    const syncCounter = () => { counter.textContent = `${f.task.length}/${SCHED_TASK_MAX}`; };
    syncCounter();
    ta.oninput = () => { f.task = ta.value; syncCounter(); };
    taskFoot.append(tip, counter);
    taskField.append(ta, taskFoot);

    const preview = schedEl('div', 'sch-preview');
    preview.setAttribute('aria-live', 'polite');
    wrap.appendChild(preview);

    const err = schedEl('div', 'sch-error');
    err.setAttribute('role', 'alert');
    err.textContent = f.error;
    wrap.appendChild(err);

    const actions = schedEl('div', 'sch-actions');
    const save = schedEl('button', 'h-btn-primary sch-save', editing ? 'save' : 'create trigger');
    save.type = 'button';
    save.disabled = f.busy || (!agents.length && !editing);
    save.onclick = () => submit(save, err);
    const cancel = schedEl('button', 'sch-link', 'cancel');
    cancel.type = 'button';
    cancel.onclick = closeForm;
    actions.append(save, cancel);
    wrap.appendChild(actions);

    formHost.appendChild(wrap);
    f.updatePreview = () => {
      preview.replaceChildren();
      const spec = schedSpecFromForm(f);
      const line = schedEl('div', 'sch-preview-line');
      const icon = schedEl('span', 'sch-preview-icon');
      icon.innerHTML = SCHED_ICONS.clock;
      const agentName = (agents.find(a => a.actor_id === f.target) || {}).name || editing?.target_name || 'agent';
      line.append(icon, schedEl('span', null, `${agentName} runs this ${schedSummary(spec, false)}`));
      preview.appendChild(line);
      const note = schedSummaryNote(spec);
      if (note) preview.appendChild(schedEl('div', 'sch-preview-sub', note));
      if (editing && editing.enabled && JSON.stringify(spec) === JSON.stringify(editing.schedule_spec)) {
        preview.appendChild(schedEl('div', 'sch-preview-sub', schedNextRunText(editing)));
      }
    };
    f.updatePreview();
  }

  function agentChip(a, on) {
    const b = schedEl('button', 'sch-agent');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.appendChild(makeAvatar(a.name, a.avatar_color, a.avatar_url, 18));
    b.appendChild(schedEl('span', null, a.name || '?'));
    b.onclick = () => { if (form.target !== a.actor_id) { form.target = a.actor_id; renderForm(); } };
    return b;
  }

  function renderIntervalFields(field) {
    const f = form;
    const box = field('every');
    const presets = schedEl('div', 'sch-presets');
    const input = schedEl('input', 'sch-input sch-num');
    SCHED_INTERVAL_PRESETS.forEach(min => {
      const b = schedEl('button', 'sch-pill', schedIntervalText(min).replace(/^every /, ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', f.every === min ? 'true' : 'false');
      b.onclick = () => { f.every = min; renderForm(); };
      presets.appendChild(b);
    });
    const custom = schedEl('label', 'sch-inline');
    input.type = 'number'; input.min = '5'; input.max = '1440'; input.step = '1';
    input.value = String(f.every);
    input.oninput = () => {
      f.every = Number(input.value);
      presets.querySelectorAll('.sch-pill').forEach((p, i) => p.setAttribute('aria-pressed', SCHED_INTERVAL_PRESETS[i] === f.every ? 'true' : 'false'));
      f.updatePreview();
    };
    custom.append('or ', input, ' min');
    box.append(presets, custom);
  }

  function renderWeekdayField(field) {
    const f = form;
    const box = field('on');
    const row = schedEl('div', 'sch-days');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'days of the week');
    SCHED_WEEK_ORDER.forEach(d => {
      const b = schedEl('button', 'sch-day', SCHED_DAY_NAMES[d]);
      b.type = 'button';
      b.setAttribute('aria-pressed', f.days.has(d) ? 'true' : 'false');
      b.onclick = () => {
        if (f.days.has(d)) f.days.delete(d); else f.days.add(d);
        b.setAttribute('aria-pressed', f.days.has(d) ? 'true' : 'false');
        f.updatePreview();
      };
      row.appendChild(b);
    });
    const quick = schedEl('div', 'sch-quick');
    [['weekdays', [1, 2, 3, 4, 5]], ['weekends', [0, 6]], ['every day', [0, 1, 2, 3, 4, 5, 6]]].forEach(([label, days]) => {
      const q = schedEl('button', 'sch-link', label);
      q.type = 'button';
      q.onclick = () => { f.days = new Set(days); renderForm(); };
      quick.appendChild(q);
    });
    box.append(row, quick);
  }

  function makeSelect(label, options, value, onChange) {
    const sel = schedEl('select', 'sch-input');
    sel.setAttribute('aria-label', label);
    options.forEach(([v, text]) => {
      const o = schedEl('option', null, text);
      o.value = String(v);
      if (v === value) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => onChange(Number(sel.value));
    return sel;
  }

  function dayOptions(max) {
    return Array.from({ length: max }, (_, i) => [i + 1, String(i + 1)]);
  }

  function renderMonthlyField(field) {
    const f = form;
    const box = field('on day');
    box.appendChild(makeSelect('day of month', dayOptions(31), f.day, v => { f.day = v; f.updatePreview(); }));
  }

  function renderYearlyField(field) {
    const f = form;
    const box = field('on');
    const row = schedEl('div', 'sch-inline');
    const months = SCHED_MONTH_NAMES.map((m, i) => [i + 1, m]);
    row.appendChild(makeSelect('month', months, f.month, v => {
      f.month = v;
      f.yday = Math.min(f.yday, SCHED_MONTH_DAYS[v - 1]);
      renderForm();
    }));
    row.appendChild(makeSelect('day', dayOptions(SCHED_MONTH_DAYS[f.month - 1]), f.yday, v => { f.yday = v; f.updatePreview(); }));
    box.appendChild(row);
  }

  function renderTimeField(field) {
    const f = form;
    const box = field('at');
    const row = schedEl('div', 'sch-inline');
    const time = schedEl('input', 'sch-input sch-time');
    time.type = 'time';
    time.value = f.at;
    time.setAttribute('aria-label', 'time (24h)');
    time.oninput = () => { f.at = time.value; f.updatePreview(); };

    const tz = schedEl('select', 'sch-input sch-tz');
    tz.setAttribute('aria-label', 'time zone');
    const common = [...new Set([f.tz, schedBrowserTz(), ...SCHED_COMMON_TZS])];
    const addGroup = (label, zones) => {
      const g = schedEl('optgroup');
      g.label = label;
      zones.forEach(z => {
        const short = schedTzLabel(z);
        const pretty = z.replace(/_/g, ' ');
        const o = schedEl('option', null, short !== pretty.split('/').pop() ? `${pretty} (${short})` : pretty);
        o.value = z;
        if (z === f.tz) o.selected = true;
        g.appendChild(o);
      });
      tz.appendChild(g);
    };
    addGroup('common', common);
    const rest = schedAllTimeZones().filter(z => !common.includes(z));
    if (rest.length) addGroup('all', rest);
    tz.onchange = () => { f.tz = tz.value; f.updatePreview(); };
    row.append(time, tz);
    box.appendChild(row);
  }

  async function submit(save, err) {
    const f = form;
    const problem = schedValidateForm(f);
    if (problem) { f.error = problem; err.textContent = problem; return; }
    const spec = schedSpecFromForm(f);
    const payload = { target_actor_id: f.target, task: f.task.trim(), schedule_spec: spec };
    f.busy = true;
    save.disabled = true;
    err.textContent = '';
    const res = f.editId
      ? await send('PATCH', `/api/rooms/${room.id}/schedules/${f.editId}`, payload)
      : await send('POST', `/api/rooms/${room.id}/schedules`, { ...payload, enabled: true });
    f.busy = false;
    if (form !== f) return;
    if (!res.ok) { f.error = res.error; err.textContent = res.error; save.disabled = false; return; }
    const saved = res.data && res.data.schedule;
    form = null;
    renderForm();
    if (saved && saved.next_run_at) showToast(`${f.editId ? 'saved' : 'created'} · ${schedNextRunText(saved)}`);
    load();
  }

  listHost.appendChild(schedEl('div', 'sch-loading', 'loading…'));
  renderHead();
  load();
}
