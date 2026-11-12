// ── Task drawer ────────────────────────────────────────────────────────────
// Detail panel of one card, over the board (no scrim, the board stays usable): title, state, column,
// priority, assignee, labels, description, checklist, dependencies, thread link, Log/Comments tabs and
// Retry / Awaiting / Delete. State shared with tasks/board.js through tasksUi.

const TASK_EVENT_PAGE = 100;
const _tbD = { from: null, lastId: null, tab: 'log', editDesc: false, delArm: false, events: [], hasMore: false, loading: false, error: null, seq: 0 };

function tbDrawerEl() { return document.getElementById('tb-drawer'); }

function tasksOpenDrawer(id, from) {
  if (!tasksUi.tasks.has(id)) return;
  const switching = tasksUi.openId !== id;
  tasksUi.openId = id;
  _tbD.from = from || null;
  _tbD.lastId = id;
  if (switching) Object.assign(_tbD, { tab: 'log', editDesc: false, delArm: false, events: [], hasMore: false, error: null });
  const d = tbDrawerEl();
  if (!d) return;
  tbRenderDrawer();
  d.classList.add('open');
  tasksRender();
  setTimeout(() => d.focus(), 30);
  if (switching) tbLoadEvents();
}

function tasksCloseDrawer({ focus = true } = {}) {
  if (!tasksUi.openId) return;
  tasksUi.openId = null;
  _tbD.seq++;
  const d = tbDrawerEl();
  if (d) { d.classList.remove('open'); d.replaceChildren(); }
  tasksRender();
  if (!focus) return;
  const back = _tbD.from && _tbD.from.isConnected ? _tbD.from : null;
  if (back) { back.focus(); return; }
  const c = document.querySelector('#tb-board .tb-card[data-id="' + _tbD.lastId + '"]');
  if (c) c.focus();
}

function tbDrawerBusy() {
  const a = document.activeElement;
  const d = tbDrawerEl();
  return a && d && d.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type === 'text'));
}

function tasksRefreshDrawer({ reload = false } = {}) {
  if (!tasksUi.openId) return;
  if (!tasksUi.tasks.has(tasksUi.openId)) { tasksCloseDrawer({ focus: false }); return; }
  if (!tbDrawerBusy()) tbRenderDrawer();
  if (reload) tbLoadEvents();
}

async function tbLoadEvents(before) {
  const id = tasksUi.openId, roomId = tasksUi.roomId;
  const seq = ++_tbD.seq;
  _tbD.loading = true;
  _tbD.error = null;
  if (!tbDrawerBusy()) tbRenderDrawer();
  let data;
  try { data = await TasksApi.get(roomId, id, { before, limit: TASK_EVENT_PAGE }); } catch (err) {
    if (seq !== _tbD.seq) return;
    _tbD.loading = false;
    _tbD.error = err.message || 'Failed to load the log';
    if (!tbDrawerBusy()) tbRenderDrawer();
    return;
  }
  if (seq !== _tbD.seq || id !== tasksUi.openId || roomId !== tasksUi.roomId) return;
  _tbD.loading = false;
  const page = Array.isArray(data && data.events) ? data.events : [];
  _tbD.hasMore = page.length >= TASK_EVENT_PAGE;
  tbMergeEvents(before === undefined ? [] : _tbD.events, page);
  if (data && tbValidTask(data, roomId)) {
    const { events, ...task } = data;
    tasksUi.tasks.set(task.id, task);
    tasksRender();
  }
  if (!tbDrawerBusy()) tbRenderDrawer();
}

function tbMergeEvents(base, more) {
  const byId = new Map(base.map(e => [e.id, e]));
  for (const e of more) if (e && Number.isInteger(e.id) && e.task_id === tasksUi.openId) byId.set(e.id, e);
  _tbD.events = [...byId.values()].sort((a, b) => a.id - b.id);
}

function tasksDrawerAddEvent(ev) {
  if (!ev || ev.task_id !== tasksUi.openId) return;
  tbMergeEvents(_tbD.events, [ev]);
  if (!tbDrawerBusy()) tbRenderDrawer();
}

// PATCH one or more fields; the response (or the task_upsert that follows) is the truth.
async function tbPatchTask(id, patch) {
  const roomId = tasksUi.roomId;
  tasksUi.busy.add(id);
  try {
    const next = await TasksApi.update(roomId, id, patch);
    if (roomId === tasksUi.roomId && tbValidTask(next, roomId)) tasksUi.tasks.set(next.id, next);
  } catch (err) { tbErr(err); } finally {
    tasksUi.busy.delete(id);
    if (roomId === tasksUi.roomId) { tasksRender(); tasksRefreshDrawer(); }
  }
}

async function tbTaskAction(id, fn) {
  const roomId = tasksUi.roomId;
  tasksUi.busy.add(id);
  tbRenderDrawer();
  try {
    const next = await fn(roomId);
    if (roomId === tasksUi.roomId && tbValidTask(next, roomId)) tasksUi.tasks.set(next.id, next);
    return true;
  } catch (err) { tbErr(err); return false; } finally {
    tasksUi.busy.delete(id);
    if (roomId === tasksUi.roomId) { tasksRender(); tasksRefreshDrawer(); }
  }
}

function tbSelect(options, value, onChange, label) {
  const s = tbEl('select');
  s.setAttribute('aria-label', label);
  for (const [v, text, disabled] of options) {
    const o = tbEl('option', null, text);
    o.value = v;
    if (disabled) o.disabled = true;
    if (v === value) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener('change', () => onChange(s.value, s));
  return s;
}

function tbWouldCycle(taskId, depId) {
  const seen = new Set();
  const stack = [depId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const t = tbTask(cur);
    if (t) stack.push(...(t.blocked_by || []));
  }
  return false;
}

function tbEventActor(ev) {
  if (ev.actor_kind === 'system' || ev.actor_id == null) return { name: 'Runner', system: true };
  if (ev.actor_kind === 'sub_agent') {
    const sa = (roomSubAgentsCache[tasksUi.roomId] || []).find(s => s.id === ev.actor_id);
    return sa ? { name: sa.label, sub: sa } : { name: 'Sub-agent' };
  }
  const a = allActors.find(x => x.id === ev.actor_id);
  return a ? { name: a.name, actor: a } : { name: ev.actor_kind === 'human' ? 'Someone' : 'Agent' };
}

function tbEventText(ev) {
  const m = ev.meta && typeof ev.meta === 'object' ? ev.meta : {};
  const reason = m.reason || ev.body || '';
  const col = c => TASK_COL_LABEL[c] || c || '';
  const dep = () => { const d = m.depends_on_id ?? m.dep_id; return Number.isInteger(m.depends_on_seq) ? '#' + m.depends_on_seq : (Number.isInteger(d) ? tbSeqLabel(d) : ''); };
  switch (ev.kind) {
    case 'created': return 'created the card';
    case 'edited': return 'edited the ' + (Array.isArray(m.fields) && m.fields.length ? m.fields.join(', ') : 'card');
    case 'moved': return m.from_col && m.from_col === m.to_col ? 'reordered it in ' + col(m.to_col) : 'moved it to ' + col(m.to_col);
    case 'started': return 'started it in a new thread';
    case 'completed': return 'marked it done';
    case 'failed': return 'failed' + (reason ? ': ' + reason : '');
    case 'blocked': return 'blocked it' + (reason ? ': ' + reason : '');
    case 'retry': return 'ran Retry';
    case 'stopped': return 'stopped it' + (reason ? ' (' + reason + ')' : '');
    case 'dep_added': return 'added dependency ' + dep();
    case 'dep_removed': return 'removed dependency ' + dep();
    case 'awaiting': return 'moved it to Awaiting' + (reason ? ': ' + reason : '');
    case 'confirmed': return 'approved it to Backlog';
    default: return ev.kind || '';
  }
}

function tbRunnerAvatar() {
  const a = tbEl('span', 'tb-av-sys');
  a.appendChild(tbIcon('play'));
  return a;
}

function tbStateBox(task) {
  const k = tbStatusKey(task);
  const box = (cls, ic, main, sub) => {
    const b = tbEl('div', 'tb-d-state ' + cls);
    b.appendChild(tbIcon(ic, ic === 'spin' ? 'tb-spin' : ''));
    const txt = tbEl('div');
    txt.appendChild(tbEl('div', null, main));
    if (sub) txt.appendChild(tbEl('small', null, sub));
    b.appendChild(txt);
    return b;
  };
  const who = tbAssigneeFor(task).name;
  if (k === 'running') return box('run', 'spin', who + ' is working on it', 'Started ' + tbWhen(task.started_at) + ' · cannot be moved, use Stop');
  if (k === 'failed') return box('fail', 'alert', 'Failed on attempt ' + (task.attempts || 1), task.fail_reason || '');
  if (k === 'awaiting') return box('await', 'clock', 'Waiting for your confirmation', task.await_reason || '');
  if (k === 'blocked') {
    if (task.status === 'blocked') return box('wait', 'lock', 'Blocked', task.await_reason || task.fail_reason || '');
    const bi = tbBlockInfo(task);
    const dep = tbTask(bi.id);
    if (!dep) return box('wait', 'lock', 'Blocked: a dependency no longer exists');
    const where = dep.status === 'failed' ? 'Failed' : TASK_COL_LABEL[dep.col];
    return box('wait', 'lock', bi.hard ? `Blocked: #${dep.seq} is in ${where}` : `Waiting for #${dep.seq} to finish`, dep.title);
  }
  if (k === 'done' && task.finished_at) return box('', 'check', 'Finished ' + tbWhen(task.finished_at), task.result_summary || '');
  return null;
}

function tbRenderDrawer() {
  const d = tbDrawerEl();
  if (!d) return;
  const task = tbTask(tasksUi.openId);
  if (!task) { d.replaceChildren(); return; }
  const id = task.id;
  const k = tbStatusKey(task);
  const isRun = k === 'running';
  const ro = tbArchived();
  const busy = tasksUi.busy.has(id);
  const scroll = d.querySelector('.tb-d-body') ? d.querySelector('.tb-d-body').scrollTop : 0;
  d.replaceChildren();

  const top = tbEl('div', 'tb-d-top');
  top.append(tbEl('span', 'tb-c-id', '#' + task.seq), tbEl('span', 'tb-colchip', TASK_COL_LABEL[task.col]), tbEl('span', 'tb-spacer'));
  const x = tbButton('tb-iconbtn', 'x');
  x.setAttribute('aria-label', 'Close');
  x.addEventListener('click', () => tasksCloseDrawer());
  top.appendChild(x);
  d.appendChild(top);

  const body = tbEl('div', 'tb-d-body');
  const ti = tbEl('textarea', 'tb-d-title');
  ti.id = 'tb-d-title';
  ti.rows = 1;
  ti.maxLength = 200;
  ti.value = task.title;
  ti.readOnly = ro;
  ti.setAttribute('aria-label', 'Title');
  const fit = () => { ti.style.height = 'auto'; ti.style.height = ti.scrollHeight + 'px'; };
  ti.addEventListener('input', fit);
  ti.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); ti.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ti.value = task.title; ti.blur(); }
  });
  ti.addEventListener('blur', () => {
    const v = ti.value.trim();
    if (v && v !== task.title) tbPatchTask(id, { title: v });
    else { ti.value = task.title; tasksRefreshDrawer(); }
  });
  body.appendChild(ti);
  requestAnimationFrame(fit);

  const st = tbStateBox(task);
  if (st) body.appendChild(st);

  const meta = tbEl('dl', 'tb-meta');
  const row = (label, node) => { meta.appendChild(tbEl('dt', null, label)); const dd = tbEl('dd'); dd.appendChild(node); meta.appendChild(dd); };
  const colSel = tbSelect(TASK_COLS.map(c => [c, TASK_COL_LABEL[c], c === 'ongoing' && task.col !== 'ongoing']), task.col, (v, s) => {
    s.value = task.col;
    tbMoveWithReason(id, v, undefined, s);
  }, 'Column');
  colSel.disabled = isRun || ro || busy;
  row('Column', colSel);
  const prioSel = tbSelect(['high', 'med', 'low', 'none'].map(p => [p, TASK_PRIORITY_LABEL[p]]), task.priority || 'none', v => tbPatchTask(id, { priority: v }), 'Priority');
  prioSel.disabled = ro || busy;
  row('Priority', prioSel);
  const assSel = tbSelect(tbAssignees().map(a => [a.key, a.primary ? a.name + ' (primary)' : a.name]), tbAssigneeKey(task), v => {
    tbPatchTask(id, v.startsWith('s:') ? { assignee_sub_agent_id: Number(v.slice(2)) } : { assignee_actor_id: v.startsWith('a:') ? Number(v.slice(2)) : null });
  }, 'Assignee');
  assSel.disabled = isRun || ro || busy;
  if (isRun) assSel.title = 'The assignee cannot change while the task runs';
  row('Assignee', assSel);
  row('Labels', tbLabelsEditor(task, ro || busy));
  body.appendChild(meta);
  const times = tbTimesSection(task);
  if (times) body.appendChild(times);

  body.appendChild(tbDescSection(task, ro));
  body.appendChild(tbChecklistSection(task, ro || busy));
  body.appendChild(tbDepsSection(task, ro || busy || isRun));

  const th = tbEl('div', 'tb-sec');
  const tb = tbButton('tb-btn', 'thread', 'Open thread');
  tb.appendChild(tbIcon('arrow'));
  tb.disabled = !task.thread_id;
  tb.addEventListener('click', () => {
    const threadId = task.thread_id;
    tasksSetView('chat');
    if (typeof openThread === 'function') openThread(threadId);
  });
  th.appendChild(tb);
  if (!task.thread_id) th.appendChild(tbEl('div', 'tb-note', 'The thread is created when the task starts.'));
  body.appendChild(th);

  body.appendChild(tbTabsSection(task, ro));
  d.appendChild(body);
  body.scrollTop = scroll;

  if (!ro) d.appendChild(tbDrawerFoot(task, k, busy));
}

// Created / Started / Finished (only those set) and the run time between Started and Finished.
function tbTimesSection(task) {
  const rows = [['Created', task.created_at], ['Started', task.started_at], ['Finished', task.finished_at]].filter(r => tbDate(r[1]));
  if (!rows.length) return null;
  const dl = tbEl('dl', 'tb-times');
  for (const [label, iso] of rows) {
    const dd = tbEl('dd');
    dd.appendChild(tbTimeEl(iso, tbWhen(iso)));
    dl.append(tbEl('dt', null, label), dd);
  }
  const took = tbDuration(task.started_at, task.finished_at);
  if (took) dl.append(tbEl('dt', null, 'Took'), tbEl('dd', null, took));
  return dl;
}

function tbLabelsEditor(task, disabled) {
  const id = task.id;
  const labels = Array.isArray(task.labels) ? task.labels : [];
  const box = tbEl('div', 'tb-labels');
  for (const l of labels) {
    const chip = tbEl('span', 'tb-lchip');
    chip.appendChild(tbEl('span', null, l));
    if (!disabled) {
      const rm = tbButton('', 'x');
      rm.setAttribute('aria-label', 'Remove label ' + l);
      rm.addEventListener('click', () => tbPatchTask(id, { labels: labels.filter(y => y !== l) }));
      chip.appendChild(rm);
    }
    box.appendChild(chip);
  }
  if (!disabled && labels.length < 8) {
    const li = tbEl('input', 'tb-linput');
    li.type = 'text';
    li.maxLength = 24;
    li.placeholder = '+ label';
    li.setAttribute('aria-label', 'Add label');
    li.addEventListener('keydown', async e => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const v = li.value.trim().toLowerCase().slice(0, 24);
      li.value = '';
      if (!v || labels.includes(v)) return;
      await tbPatchTask(id, { labels: labels.concat(v) });
      const again = tbDrawerEl() && tbDrawerEl().querySelector('.tb-linput');
      if (again) again.focus();
    });
    box.appendChild(li);
  }
  return box;
}

function tbDescSection(task, ro) {
  const id = task.id;
  const ds = tbEl('div', 'tb-sec');
  const dh = tbEl('div', 'tb-sec-h');
  dh.appendChild(tbEl('h5', null, 'Description'));
  if (!_tbD.editDesc && !ro) {
    const eb = tbButton('tb-btn tb-ghost tb-sm', null, 'Edit');
    eb.addEventListener('click', () => {
      _tbD.editDesc = true;
      tbRenderDrawer();
      const ta = tbDrawerEl().querySelector('.tb-desc-ta');
      if (ta) ta.focus();
    });
    dh.appendChild(eb);
  }
  ds.appendChild(dh);
  if (_tbD.editDesc && !ro) {
    const ta = tbEl('textarea', 'tb-ta tb-desc-ta');
    ta.value = task.description || '';
    ta.maxLength = 20000;
    ta.setAttribute('aria-label', 'Description');
    ta.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _tbD.editDesc = false; tbRenderDrawer(); } });
    ds.appendChild(ta);
    const r = tbEl('div', 'tb-pop-row');
    const cancel = tbButton('tb-btn tb-ghost tb-sm', null, 'Cancel');
    cancel.addEventListener('click', () => { _tbD.editDesc = false; tbRenderDrawer(); });
    const save = tbButton('tb-btn tb-primary tb-sm', null, 'Save');
    save.addEventListener('click', () => {
      const v = ta.value;
      _tbD.editDesc = false;
      if (v !== (task.description || '')) tbPatchTask(id, { description: v });
      else tbRenderDrawer();
    });
    r.append(cancel, save);
    ds.appendChild(r);
  } else if ((task.description || '').trim()) {
    const md = tbEl('div', 'tb-md');
    md.innerHTML = renderMarkdown(task.description);
    ds.appendChild(md);
  } else {
    ds.appendChild(tbEl('div', 'tb-md tb-empty-md', 'No description yet.'));
  }
  return ds;
}

function tbChecklistSection(task, disabled) {
  const id = task.id;
  const list = Array.isArray(task.checklist) ? task.checklist : [];
  const cs = tbEl('div', 'tb-sec');
  const ch = tbEl('div', 'tb-sec-h');
  ch.appendChild(tbEl('h5', null, 'Checklist'));
  const done = list.filter(c => c.done).length;
  if (list.length) ch.appendChild(tbEl('span', 'tb-n', done + '/' + list.length));
  cs.appendChild(ch);
  if (list.length) {
    const bar = tbEl('div', 'tb-bar');
    const fill = tbEl('i');
    fill.style.width = Math.round((done / list.length) * 100) + '%';
    bar.appendChild(fill);
    cs.appendChild(bar);
  }
  const cl = tbEl('div', 'tb-cl');
  list.forEach((item, i) => {
    const lab = tbEl('label', item.done ? 'done' : '');
    const cb = tbEl('input');
    cb.type = 'checkbox';
    cb.checked = !!item.done;
    cb.disabled = disabled;
    cb.addEventListener('change', () => tbPatchTask(id, { checklist: list.map((c, j) => (j === i ? { ...c, done: cb.checked } : c)) }));
    lab.append(cb, tbEl('span', null, item.text));
    cl.appendChild(lab);
  });
  cs.appendChild(cl);
  if (!disabled && list.length < 50) {
    const ci = tbEl('input', 'tb-inline-in');
    ci.type = 'text';
    ci.maxLength = 200;
    ci.placeholder = 'Add item, Enter';
    ci.setAttribute('aria-label', 'Add checklist item');
    ci.addEventListener('keydown', async e => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const v = ci.value.trim();
      if (!v) return;
      ci.value = '';
      await tbPatchTask(id, { checklist: list.concat({ text: v, done: false }) });
      const again = tbDrawerEl() && tbDrawerEl().querySelector('.tb-cl ~ .tb-inline-in');
      if (again) again.focus();
    });
    cs.appendChild(ci);
  }
  return cs;
}

function tbDepsSection(task, disabled) {
  const id = task.id;
  const deps = Array.isArray(task.blocked_by) ? task.blocked_by : [];
  const dp = tbEl('div', 'tb-sec');
  const dph = tbEl('div', 'tb-sec-h');
  dph.appendChild(tbEl('h5', null, 'Dependencies'));
  dp.appendChild(dph);
  for (const depId of deps) {
    const dep = tbTask(depId);
    const r = tbEl('div', 'tb-dep');
    r.appendChild(tbEl('span', 'tb-c-id', dep ? '#' + dep.seq : '#?'));
    const name = tbButton('tb-dt', null, dep ? dep.title : 'Missing task');
    name.disabled = !dep;
    name.addEventListener('click', () => tasksOpenDrawer(depId, _tbD.from));
    r.appendChild(name);
    r.appendChild((dep && tbBadgeFor(dep)) || tbEl('span', 'tb-badge', dep ? 'Queued' : ''));
    if (!disabled) {
      const rm = tbButton('tb-iconbtn', 'x');
      rm.setAttribute('aria-label', 'Remove dependency ' + (dep ? '#' + dep.seq : ''));
      rm.addEventListener('click', () => tbPatchTask(id, { blocked_by: deps.filter(y => y !== depId) }));
      r.appendChild(rm);
    }
    dp.appendChild(r);
  }
  if (!disabled && deps.length < 20) {
    const candidates = [...tasksUi.tasks.values()].filter(o => o.id !== id && !deps.includes(o.id)).sort((a, b) => a.seq - b.seq);
    const depSel = tbSelect([['', 'Add dependency…']].concat(candidates.map(o => {
      const cyc = tbWouldCycle(id, o.id);
      return [String(o.id), '#' + o.seq + ' ' + o.title + (cyc ? ' (cycle)' : ''), cyc];
    })), '', v => {
      const depId = Number(v);
      if (!depId || tbWouldCycle(id, depId)) return;
      tbPatchTask(id, { blocked_by: deps.concat(depId) });
    }, 'Add dependency');
    depSel.classList.add('tb-dep-add');
    dp.appendChild(depSel);
  }
  if (deps.length) dp.appendChild(tbEl('div', 'tb-note', 'The runner skips this card until every dependency is finished.'));
  return dp;
}

function tbTabsSection(task, ro) {
  const ts = tbEl('div', 'tb-sec');
  const log = _tbD.events.filter(e => e.kind !== 'comment');
  const comments = _tbD.events.filter(e => e.kind === 'comment');
  const tabs = tbEl('div', 'tb-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const [key, label, n] of [['log', 'Log', log.length], ['comments', 'Comments', comments.length]]) {
    const b = tbEl('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(_tbD.tab === key));
    b.append(tbEl('span', null, label), tbEl('span', 'tb-n', String(n)));
    b.addEventListener('click', () => { _tbD.tab = key; tbRenderDrawer(); });
    tabs.appendChild(b);
  }
  ts.appendChild(tabs);
  if (_tbD.error) {
    const e = tbEl('div', 'tb-note', _tbD.error + ' ');
    const retry = tbButton('tb-btn tb-ghost tb-sm', null, 'Try again');
    retry.addEventListener('click', () => tbLoadEvents());
    e.appendChild(retry);
    ts.appendChild(e);
  } else if (_tbD.loading && !_tbD.events.length) {
    ts.appendChild(tbEl('div', 'tb-note', 'Loading…'));
  }
  if (_tbD.tab === 'log') {
    const ul = tbEl('ul', 'tb-log');
    for (const ev of [...log].reverse()) {
      const li = tbEl('li');
      const who = tbEventActor(ev);
      li.appendChild(who.system ? tbRunnerAvatar() : tbAvatarFor(who, 20));
      const txt = tbEl('div');
      txt.append(tbEl('b', null, who.name), document.createTextNode(' '), tbEl('span', 'tb-lt', tbEventText(ev)));
      li.appendChild(txt);
      li.appendChild(tbTimeEl(ev.at, tbWhen(ev.at)));
      ul.appendChild(li);
    }
    ts.appendChild(ul);
    if (_tbD.hasMore) {
      const more = tbButton('tb-btn tb-ghost tb-sm', null, 'Load older');
      more.disabled = _tbD.loading;
      more.addEventListener('click', () => tbLoadEvents(_tbD.events.length ? _tbD.events[0].id : undefined));
      ts.appendChild(more);
    }
  } else {
    if (!comments.length && !_tbD.loading) ts.appendChild(tbEl('div', 'tb-note', 'No comments yet.'));
    for (const c of comments) {
      const cm = tbEl('div', 'tb-cm');
      const w = tbEl('div', 'tb-cm-who');
      const who = tbEventActor(c);
      w.append(who.system ? tbRunnerAvatar() : tbAvatarFor(who, 20), tbEl('b', null, who.name), tbTimeEl(c.at, tbWhen(c.at)));
      cm.append(w, tbEl('p', null, c.body || ''));
      ts.appendChild(cm);
    }
    if (!ro) ts.appendChild(tbCommentForm(task));
  }
  return ts;
}

function tbCommentForm(task) {
  const form = tbEl('div', 'tb-cm-form');
  const ta = tbEl('textarea', 'tb-ta');
  ta.maxLength = 4000;
  ta.placeholder = 'Write a comment…';
  ta.setAttribute('aria-label', 'Write a comment');
  const sb = tbButton('tb-btn tb-sm', null, 'Send');
  const send = async () => {
    const v = ta.value.trim();
    if (!v || sb.disabled) return;
    const roomId = tasksUi.roomId, id = task.id;
    sb.disabled = true;
    try {
      const ev = await TasksApi.comment(roomId, id, v);
      if (roomId !== tasksUi.roomId || id !== tasksUi.openId) return;
      ta.value = '';
      ta.blur();
      if (ev) tasksDrawerAddEvent(ev);
      else tbRenderDrawer();
    } catch (err) { tbErr(err); } finally { if (sb.isConnected) sb.disabled = false; }
  };
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } });
  sb.addEventListener('click', send);
  const r = tbEl('div', 'tb-pop-row tb-cm-row');
  r.append(tbEl('span', 'tb-note', '⌘/Ctrl + Enter to send'), sb);
  form.append(ta, r);
  return form;
}

function tbDrawerFoot(task, k, busy) {
  const id = task.id;
  const f = tbEl('div', 'tb-d-foot');
  if (k === 'failed') {
    const rb = tbButton('tb-btn tb-primary tb-sm', 'retry', 'Retry');
    rb.disabled = busy;
    rb.addEventListener('click', () => tbTaskAction(id, roomId => TasksApi.retry(roomId, id)));
    f.appendChild(rb);
  }
  if (task.col === 'awaiting') {
    const ab = tbButton('tb-btn tb-sm', null, 'Approve to Backlog');
    ab.disabled = busy;
    ab.addEventListener('click', () => tasksMove(id, 'backlog'));
    f.appendChild(ab);
  } else if (k !== 'running') {
    const ab = tbButton('tb-btn tb-sm', 'clock', 'Move to Awaiting');
    ab.disabled = busy;
    ab.addEventListener('click', () => tbMoveWithReason(id, 'awaiting', undefined, ab));
    f.appendChild(ab);
  }
  f.appendChild(tbEl('span', 'tb-spacer'));
  const del = tbEl('button', 'tb-btn tb-ghost tb-sm tb-danger tb-lockw');
  del.type = 'button';
  del.dataset.alt = 'Really delete?';
  del.appendChild(tbEl('span', null, _tbD.delArm ? 'Really delete?' : 'Delete'));
  del.disabled = k === 'running' || busy;
  if (k === 'running') del.title = 'A running task cannot be deleted. Use Stop first.';
  del.addEventListener('click', async () => {
    if (!_tbD.delArm) {
      _tbD.delArm = true;
      tbRenderDrawer();
      const again = tbDrawerEl().querySelector('.tb-danger');
      if (again) again.focus();
      return;
    }
    _tbD.delArm = false;
    const roomId = tasksUi.roomId, seq = task.seq;
    tasksUi.busy.add(id);
    tbRenderDrawer();
    try {
      await TasksApi.remove(roomId, id);
      if (roomId !== tasksUi.roomId) return;
      tasksUi.tasks.delete(id);
      tasksCloseDrawer({ focus: false });
      showToast(`Task #${seq} deleted`);
      const first = document.querySelector('#tb-board .tb-card');
      if (first) first.focus();
    } catch (err) { tbErr(err); } finally {
      tasksUi.busy.delete(id);
      if (roomId === tasksUi.roomId) { tasksRender(); tasksRefreshDrawer(); }
    }
  });
  del.addEventListener('blur', () => {
    if (_tbD.delArm) setTimeout(() => { if (_tbD.delArm && tasksUi.openId === id && !document.activeElement?.classList.contains('tb-danger')) { _tbD.delArm = false; tbRenderDrawer(); } }, 150);
  });
  f.appendChild(del);
  return f;
}
