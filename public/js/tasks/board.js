// ── Room task board ────────────────────────────────────────────────────────
// Board view of the current room: 4 columns, toolbar (runner, concurrency, filter, add), drag and
// keyboard moves. The board always belongs to currentRoomId: switching rooms clears it, the snapshot is
// re-read when the room socket (re)joins, and task_* events of another room are ignored. The runner
// itself lives on the server, so a room keeps running while another room is open.
// The detail drawer is in tasks/drawer.js, the statistics panel in tasks/stats.js; all HTTP goes through
// tasks/api.js.

const TASK_COLS = ['awaiting', 'backlog', 'ongoing', 'finished'];
const TASK_DROP_COLS = ['awaiting', 'backlog', 'finished'];
const TASK_COL_LABEL = { awaiting: 'Awaiting', backlog: 'Backlog', ongoing: 'Ongoing', finished: 'Finished' };
const TASK_COL_SUB = { awaiting: 'Needs your confirmation', backlog: 'Order = runner priority', ongoing: 'Managed by the runner', finished: 'Newest first' };
const TASK_STATUS_LABEL = { running: 'Running', queued: 'Queued', blocked: 'Blocked', failed: 'Failed', awaiting: 'Awaiting', done: 'Done' };
const TASK_PRIORITY_LABEL = { high: 'High', med: 'Medium', low: 'Low', none: 'None' };
const TASK_VIEW_KEY = 'stoa-task-view';
const TASK_MODES = [
  { value: 'quiet', label: 'When quiet', hint: 'A card finishes when its thread goes quiet; the last reply is the result.' },
  { value: 'agent', label: 'Agent decides', hint: 'A card finishes only when the agent calls complete, block or fail.' },
];

const TASK_ICONS = {
  play: 'M7 4.8v14.4L18.5 12z', pause: 'M8.5 5v14M15.5 5v14', stop: 'M6.5 6.5h11v11h-11z', plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14', filter: 'M4 6.5h16M7 12h10M10 17.5h4', x: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  lock: 'M8 11V8.5a4 4 0 0 1 8 0V11M6 11h12v9H6z', clock: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5V12l3 2',
  alert: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 8v5M12 16.2v.1', check: 'M5 12.5l4.5 4.5L19 7.5',
  spin: 'M12 3.5a8.5 8.5 0 1 0 8.5 8.5', grip: 'M9.5 6.5v.1M14.5 6.5v.1M9.5 12v.1M14.5 12v.1M9.5 17.5v.1M14.5 17.5v.1',
  thread: 'M4.5 5h15v10.5H9.5l-5 4z', chart: 'M4.5 19.5h15M7.5 16.5v-4M12 16.5V7M16.5 16.5v-6.5', retry: 'M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4.5v4h4', arrow: 'M7 17L17 7M9 7h8v8',
  board: 'M4.5 4.5h4v15h-4zM10 4.5h4v10h-4zM15.5 4.5h4v12.5h-4z', chevron: 'M9.5 6l6 6-6 6', checks: 'M4.5 7l2 2 3.5-4M4.5 15l2 2 3.5-4M13 7.5h6.5M13 15.5h6.5',
};

// Shared with tasks/drawer.js.
const tasksUi = {
  roomId: null,
  roomTitle: '',
  seq: 0,
  loaded: false,
  loadError: null,
  tasks: new Map(),
  threadRoots: new Set(), // root message ids of runner messages in this room
  settings: { concurrency: 1, running: false, completion_mode: 'quiet' },
  view: 'chat',
  filter: { assignee: new Set(), label: new Set(), status: new Set() },
  quickAdd: null,
  quickAddFocus: false,
  bannerDismissed: null,
  pending: null, // { id, col, index } while a move request is in flight
  grab: null, // keyboard move: { id, fromCol, fromIndex, col, index }
  openId: null,
  pendingOpenId: null,
  busy: new Set(), // task ids with a request in flight
};

// ── Small DOM helpers (text only) ────────────────────────────────────────────
function tbEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}
function tbIcon(name, extra) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'tb-i' + (extra ? ' ' + extra : ''));
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', TASK_ICONS[name]);
  if (name === 'grip') p.setAttribute('stroke-width', '2.6');
  s.appendChild(p);
  return s;
}
function tbSetBtn(btn, iconName, label) {
  btn.replaceChildren();
  if (iconName) btn.appendChild(tbIcon(iconName));
  if (label) btn.appendChild(tbEl('span', null, label));
}
function tbButton(cls, iconName, label) {
  const b = tbEl('button', cls);
  b.type = 'button';
  tbSetBtn(b, iconName, label);
  return b;
}
// Task timestamps are SQLite UTC ('YYYY-MM-DD HH:MM:SS', no zone); tbDate parses them as UTC and these show local time.
function tbYearOpt(d, now) { return d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }; }
function tbDay(iso, now = new Date()) {
  const d = tbDate(iso);
  return d ? d.toLocaleDateString([], { day: 'numeric', month: 'short', ...tbYearOpt(d, now) }) : '';
}
function tbWhen(iso, now = new Date()) {
  const d = tbDate(iso);
  return d ? d.toLocaleString([], { day: 'numeric', month: 'short', ...tbYearOpt(d, now), hour: '2-digit', minute: '2-digit' }) : '';
}
function tbFull(iso) {
  const d = tbDate(iso);
  return d ? d.toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }) : '';
}
function tbDuration(fromIso, toIso) {
  const a = tbDate(fromIso), b = tbDate(toIso);
  if (!a || !b || b < a) return '';
  return tbSecs(Math.round((b - a) / 1000));
}
function tbSecs(s) {
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  const days = Math.floor(h / 24);
  return days + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}
// <time> with the short text shown and the full local date and time on hover.
function tbTimeEl(iso, text, cls) {
  const t = tbEl('time', cls || null, text);
  const d = tbDate(iso);
  if (d) { t.dateTime = d.toISOString(); t.title = tbFull(iso); }
  return t;
}
function tbDate(iso) {
  if (!iso) return null;
  const s = String(iso);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}
function tbErr(err) { showToast(err && err.message ? err.message : 'Something went wrong', { error: true }); }

let _tbLiveEl = null;
function tbAnnounce(text) {
  if (!_tbLiveEl) {
    _tbLiveEl = tbEl('div', 'tb-sr');
    _tbLiveEl.setAttribute('aria-live', 'assertive');
    document.body.appendChild(_tbLiveEl);
  }
  _tbLiveEl.textContent = '';
  setTimeout(() => { _tbLiveEl.textContent = text; }, 20);
}

// ── Derived state ────────────────────────────────────────────────────────────
function tbTask(id) { return tasksUi.tasks.get(id) || null; }
function tbSeqLabel(id) { const t = tbTask(id); return t ? '#' + t.seq : '#?'; }

function tbRankCmp(a, b) {
  if (a.rank < b.rank) return -1;
  if (a.rank > b.rank) return 1;
  return a.id - b.id;
}
function tbFinishedCmp(a, b) {
  const ta = (tbDate(a.finished_at) || tbDate(a.updated_at) || new Date(0)).getTime();
  const tb = (tbDate(b.finished_at) || tbDate(b.updated_at) || new Date(0)).getTime();
  return tb - ta || b.id - a.id;
}

// Column order comes from the server (rank); Finished shows newest first. A move in flight or a
// keyboard grab is drawn at its target until the server answers.
function tbColIds(col) {
  const list = [...tasksUi.tasks.values()].filter(t => t.col === col);
  list.sort(col === 'finished' ? tbFinishedCmp : tbRankCmp);
  let ids = list.map(t => t.id);
  const ov = tasksUi.grab || tasksUi.pending;
  if (ov && tasksUi.tasks.has(ov.id)) {
    ids = ids.filter(i => i !== ov.id);
    if (ov.col === col) ids.splice(Math.max(0, Math.min(ov.index, ids.length)), 0, ov.id);
  }
  return ids;
}
function tbShownCol(task) {
  const ov = tasksUi.grab || tasksUi.pending;
  return ov && ov.id === task.id ? ov.col : task.col;
}

function tbCounts() {
  let running = 0, awaiting = 0, backlog = 0;
  for (const t of tasksUi.tasks.values()) {
    if (t.status === 'running') running++;
    if (t.col === 'awaiting') awaiting++;
    if (t.col === 'backlog') backlog++;
  }
  return { running, awaiting, backlog };
}

function tbBlockInfo(task) {
  const open = Array.isArray(task.waiting_on) ? task.waiting_on : [];
  if (!open.length) return null;
  const hard = open.find(d => { const dep = tbTask(d); return !dep || dep.col === 'awaiting' || dep.status === 'failed'; });
  return { id: hard !== undefined ? hard : open[0], hard: hard !== undefined };
}

function tbStatusKey(task) {
  if (task.col === 'awaiting') return 'awaiting';
  if (task.status === 'running') return 'running';
  if (task.status === 'done' || task.col === 'finished') return 'done';
  if (task.status === 'failed') return 'failed';
  if (task.status === 'blocked') return 'blocked';
  if (task.col === 'backlog' && tbBlockInfo(task)) return 'blocked';
  return 'queued';
}

function tbAssigneeKey(task) {
  if (task.assignee_sub_agent_id) return 's:' + task.assignee_sub_agent_id;
  if (task.assignee_actor_id) return 'a:' + task.assignee_actor_id;
  return 'p';
}

// Assignee candidates: AI participants and linked sub-agents of the room; 'p' = the room's primary agent.
function tbAssignees() {
  const rid = tasksUi.roomId;
  const parts = (roomParticipantsCache[rid] || []).filter(p => p.type === 'ai');
  const primary = parts.find(p => isPrimaryParticipant(p, currentRoomData)) || parts[0] || null;
  const out = [{ key: 'p', name: primary ? primary.name : 'Primary agent', primary: true, actor: primary }];
  for (const p of parts) out.push({ key: 'a:' + p.actor_id, name: p.name, actor: p });
  for (const sa of roomSubAgentsCache[rid] || []) out.push({ key: 's:' + sa.id, name: sa.label, sub: sa });
  return out;
}
function tbAssigneeFor(task) {
  const key = tbAssigneeKey(task);
  return tbAssignees().find(a => a.key === key) || { key, name: key.startsWith('s:') ? 'Sub-agent' : 'Agent' };
}

// The agent that took the card into Ongoing itself (no runner thread); null for runner cards.
function tbClaimerFor(task) {
  if (!task || task.claimed_by_actor_id == null) return null;
  const rid = tasksUi.roomId;
  if (task.claimed_by_sub_agent_id != null) {
    const sa = (roomSubAgentsCache[rid] || []).find(s => s.id === task.claimed_by_sub_agent_id);
    return sa ? { name: sa.label, sub: sa } : { name: 'Sub-agent' };
  }
  const a = (roomParticipantsCache[rid] || []).find(p => p.actor_id === task.claimed_by_actor_id)
    || allActors.find(x => x.id === task.claimed_by_actor_id);
  return a ? { name: a.name, actor: a } : { name: 'Agent' };
}
// Who is working on it now: the claiming agent while a claimed card runs, otherwise the assignee.
function tbWorkerFor(task) {
  return (task.status === 'running' && tbClaimerFor(task)) || tbAssigneeFor(task);
}

function tbAvatarFor(entry, size) {
  if (entry && entry.sub) {
    const sa = entry.sub;
    return makeAvatarEl(sa.parent_name || '', sa.parent_avatar_color, null, size, sa.label, sa.avatar_color, sa.avatar_symbol, sa.avatar_url, sa.id, sa.parent_actor_id);
  }
  const a = entry && entry.actor;
  if (a) return makeAvatar(a.name, a.avatar_color, a.avatar_url, size, a.actor_id ?? a.id);
  const blank = tbEl('span', 'tb-av-blank', entry && entry.name ? entry.name.charAt(0).toUpperCase() : '?');
  blank.style.width = blank.style.height = size + 'px';
  return blank;
}

function tbMatches(task) {
  const f = tasksUi.filter;
  if (f.assignee.size && !f.assignee.has(tbAssigneeKey(task))) return false;
  if (f.label.size && !(task.labels || []).some(l => f.label.has(l))) return false;
  if (f.status.size && !f.status.has(tbStatusKey(task))) return false;
  return true;
}
function tbFilterCount() { const f = tasksUi.filter; return f.assignee.size + f.label.size + f.status.size; }
function tbArchived() { return !!(currentRoomData && currentRoomData.archived_at); }

// ── Room lifecycle ───────────────────────────────────────────────────────────
function tbStoredViews() {
  try { const v = JSON.parse(localStorage.getItem(TASK_VIEW_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function tbStoreView(roomId, view) {
  const all = tbStoredViews();
  if (view === 'board') all[roomId] = 'board'; else delete all[roomId];
  try { localStorage.setItem(TASK_VIEW_KEY, JSON.stringify(all)); } catch {}
}

function tasksOnRoomOpen(room) {
  tbCloseAllTransient();
  if (typeof tasksCloseDrawer === 'function') tasksCloseDrawer({ focus: false });
  if (typeof tasksStatsRoomChanged === 'function') tasksStatsRoomChanged();
  Object.assign(tasksUi, {
    roomId: room.id, roomTitle: room.title || '', loaded: false, loadError: null, quickAdd: null, quickAddFocus: false, bannerDismissed: null,
    pending: null, grab: null, openId: null, pendingOpenId: null,
  });
  tasksUi.seq++;
  tasksUi.tasks = new Map();
  tasksUi.threadRoots = new Set();
  tasksUi.busy = new Set();
  tasksUi.settings = { concurrency: 1, running: false, completion_mode: 'quiet' };
  tasksUi.filter = { assignee: new Set(), label: new Set(), status: new Set() };
  tbClearBoardDom();
  tasksSetView(tbStoredViews()[room.id] === 'board' ? 'board' : 'chat', { store: false, render: false });
  tasksRender();
}

// The previous room's cards must not stay in the DOM, even hidden behind the chat view.
function tbClearBoardDom() {
  const board = document.getElementById('tb-board');
  if (board) board.replaceChildren();
  const banner = document.getElementById('tb-banner');
  if (banner) { banner.replaceChildren(); banner.hidden = true; }
}

// Root messages posted by the runner: their thread is a task thread even before task_upsert brings thread_id.
function tasksNoteMessage(m) {
  if (m && !m.thread_id && m.automation && Number.isInteger(m.automation.task_id) && m.room_id === tasksUi.roomId) tasksUi.threadRoots.add(m.id);
}

// The chat auto-opens a thread when an agent starts replying; a task thread must not cover the board.
function tasksKeepThreadClosed(threadId) {
  if (!tasksBoardOpen() || !threadId) return false;
  if (tasksUi.threadRoots.has(threadId)) return true;
  for (const t of tasksUi.tasks.values()) if (t.thread_id === threadId) return true;
  return false;
}

// Called when the room socket joins (first open and every reconnect): events are not replayed.
async function tasksOnSocketOpen(roomId) {
  if (roomId !== tasksUi.roomId) return;
  const seq = ++tasksUi.seq;
  let data;
  try { data = await TasksApi.list(roomId); } catch (err) {
    if (seq !== tasksUi.seq) return;
    tasksUi.loadError = err.message || 'Failed to load tasks';
    tasksRender();
    return;
  }
  if (seq !== tasksUi.seq || roomId !== tasksUi.roomId) return;
  tasksUi.tasks = new Map();
  for (const t of (data && Array.isArray(data.tasks) ? data.tasks : [])) if (tbValidTask(t, roomId)) tasksUi.tasks.set(t.id, t);
  if (data && data.settings) tbApplySettings(data.settings);
  tasksUi.loaded = true;
  tasksUi.loadError = null;
  if (tasksUi.openId && !tasksUi.tasks.has(tasksUi.openId)) tasksCloseDrawer({ focus: false });
  tasksRender();
  if (tasksUi.openId && typeof tasksRefreshDrawer === 'function') tasksRefreshDrawer({ reload: true });
  if (typeof tasksStatsNoteChange === 'function') tasksStatsNoteChange();
  if (tasksUi.pendingOpenId) {
    const id = tasksUi.pendingOpenId;
    tasksUi.pendingOpenId = null;
    tbOpenTaskById(id);
  }
}

function tbValidTask(t, roomId) {
  return t && Number.isInteger(t.id) && t.room_id === roomId && TASK_COLS.includes(t.col);
}
function tbApplySettings(s) {
  if (!s) return;
  if (Number.isInteger(s.concurrency)) tasksUi.settings.concurrency = s.concurrency;
  if (typeof s.running === 'boolean' || s.running === 0 || s.running === 1) tasksUi.settings.running = !!s.running;
  tasksUi.settings.idle_reason = s.idle_reason || null;
  if (TASK_MODES.some(m => m.value === s.completion_mode)) tasksUi.settings.completion_mode = s.completion_mode;
}

// WS task_* events. Only the current room's events touch the board.
function tasksHandleWs(msg) {
  if (msg.room_id !== tasksUi.roomId || !tasksUi.loaded) return;
  if (msg.type === 'task_upsert') {
    if (!tbValidTask(msg.task, tasksUi.roomId)) return;
    const prev = tasksUi.tasks.get(msg.task.id);
    if (!prev || prev.col !== msg.task.col) msg.task._fresh = true;
    tasksUi.tasks.set(msg.task.id, msg.task);
    if (prev && prev.col !== 'backlog' && msg.task.col === 'backlog') tasksUi.bannerDismissed = null;
    tasksRender();
    if (tasksUi.openId === msg.task.id && typeof tasksRefreshDrawer === 'function') tasksRefreshDrawer();
    if (typeof tasksStatsNoteChange === 'function') tasksStatsNoteChange();
  } else if (msg.type === 'task_delete') {
    const id = msg.task_id;
    if (!tasksUi.tasks.has(id)) return;
    tasksUi.tasks.delete(id);
    if (tasksUi.grab && tasksUi.grab.id === id) tasksUi.grab = null;
    if (tasksUi.openId === id) { tasksCloseDrawer({ focus: false }); showToast('This task was deleted'); }
    tasksRender();
    if (typeof tasksStatsNoteChange === 'function') tasksStatsNoteChange();
  } else if (msg.type === 'task_event') {
    if (tasksUi.openId === msg.task_id && typeof tasksDrawerAddEvent === 'function') tasksDrawerAddEvent(msg.event);
  } else if (msg.type === 'task_settings') {
    tbApplySettings(msg.settings);
    tasksRender();
  }
}

// ── View switching ───────────────────────────────────────────────────────────
function tasksBoardOpen() { return tasksUi.view === 'board'; }

// The board slides over #chat-feed-col (tb-mode shows it, tb-shown slides it in); tb-covered hides the chat
// underneath once the slide has finished, so the chat stays visible while the board moves.
const TB_SLIDE_MS = 200;
let _tbSlideTimer = 0;

function tasksSetView(view, { store = true, render = true, focus = false } = {}) {
  const col = document.getElementById('chat-feed-col');
  const msgs = document.getElementById('messages');
  const next = view === 'board' ? 'board' : 'chat';
  if (next === tasksUi.view && col && col.classList.contains('tb-mode') === (next === 'board')) { if (render) tasksRender(); return; }
  if (next === 'board') {
    if (msgs && !(col && col.classList.contains('tb-mode'))) tasksUi.chatScroll = msgs.scrollTop;
    if (typeof closeRoomSearch === 'function') closeRoomSearch();
  } else {
    tbCloseAllTransient();
    if (typeof tasksCloseDrawer === 'function') tasksCloseDrawer({ focus: false });
    if (typeof tasksCloseStats === 'function') tasksCloseStats({ focus: false });
  }
  tasksUi.view = next;
  tbEnsureRoot();
  if (col) tbSlide(col, next === 'board', render && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (next === 'chat' && msgs && tasksUi.chatScroll !== undefined) msgs.scrollTop = tasksUi.chatScroll;
  if (store && tasksUi.roomId) tbStoreView(tasksUi.roomId, next);
  if (typeof _hideRsbTooltip === 'function') _hideRsbTooltip();
  if (render) tasksRender();
  if (focus && next === 'board') {
    const close = document.getElementById('tb-close');
    if (close) close.focus({ preventScroll: true });
  }
}

function tbSlide(col, open, animate) {
  clearTimeout(_tbSlideTimer);
  if (open) {
    if (!animate) { col.classList.add('tb-mode', 'tb-shown', 'tb-covered'); return; }
    if (!col.classList.contains('tb-mode')) {
      col.classList.add('tb-mode');
      col.getBoundingClientRect();
    }
    col.classList.add('tb-shown');
    _tbSlideTimer = setTimeout(() => col.classList.add('tb-covered'), TB_SLIDE_MS);
    return;
  }
  col.classList.remove('tb-covered', 'tb-shown');
  if (!animate) { col.classList.remove('tb-mode'); return; }
  _tbSlideTimer = setTimeout(() => col.classList.remove('tb-mode'), TB_SLIDE_MS);
}

function tasksToggleView() {
  if (tasksBoardOpen()) tbCloseBoard();
  else tasksSetView('board', { focus: true });
}

// Back to chat from the board header, Esc or the Tasks button; focus returns to the visible Tasks button.
function tbCloseBoard() {
  tasksSetView('chat');
  const nav = [document.getElementById('rsb-tasks'), document.getElementById('tb-hbtn')].find(b => b && b.getClientRects().length);
  if (nav) nav.focus({ preventScroll: true });
}

// "Task #seq" in a chat message: open the board (if needed) and the card's drawer.
function tasksOpenFromMessage(taskId, seq) {
  if (!tasksBoardOpen()) tasksSetView('board');
  let id = Number.isInteger(taskId) ? taskId : null;
  if (!tasksUi.loaded) { tasksUi.pendingOpenId = id !== null ? id : { seq }; return; }
  tbOpenTaskById(id !== null ? id : { seq });
}
function tbOpenTaskById(ref) {
  let id = ref;
  if (ref && typeof ref === 'object') {
    const hit = [...tasksUi.tasks.values()].find(t => t.seq === ref.seq);
    id = hit ? hit.id : null;
  }
  if (!Number.isInteger(id) || !tasksUi.tasks.has(id)) { showToast('This task no longer exists'); return; }
  tasksOpenDrawer(id, null);
}

// ── Navigation: rail button (desktop) + header button (under 1024px, where the rail is hidden) ──
function tasksRailButton(mkBtn) {
  const b = mkBtn('Tasks', '', () => tasksToggleView());
  b.id = 'rsb-tasks';
  b.classList.add('tb-nav-btn', 'is-view');
  b.setAttribute('aria-controls', 'task-board');
  tbPaintNavBtn(b);
  return b;
}

function tasksHeaderControls(room) {
  if (room) tasksRoomRenamed(room.id, room.title);
  const b = tbEl('button', 'tb-nav-btn tb-hbtn');
  b.type = 'button';
  b.id = 'tb-hbtn';
  b.title = 'Open Tasks';
  b.setAttribute('aria-controls', 'task-board');
  b.addEventListener('click', () => tasksToggleView());
  tbPaintNavBtn(b);
  return b;
}

function tasksRoomRenamed(roomId, title) {
  if (roomId !== tasksUi.roomId) return;
  tasksUi.roomTitle = title || '';
  tbPaintTitle();
}

function tbPaintTitle() {
  const name = document.getElementById('tb-title-room');
  if (name) name.textContent = tasksUi.roomTitle;
}

function tbPaintNavBtn(b) {
  const { running, awaiting } = tbCounts();
  const on = tasksBoardOpen();
  b.replaceChildren(tbIcon('board'));
  if (running) b.appendChild(tbEl('span', 'tb-pip tb-pip-run', String(running)));
  if (awaiting) b.appendChild(tbEl('span', 'tb-pip tb-pip-wait', String(awaiting)));
  b.classList.toggle('active', on);
  b.setAttribute('aria-pressed', String(on));
  const parts = [running ? running + ' running' : '', awaiting ? awaiting + ' awaiting' : ''].filter(Boolean);
  const label = 'Tasks' + (parts.length ? ' · ' + parts.join(', ') : '');
  b.setAttribute('aria-label', label);
  b.dataset.tooltip = label;
}

function tasksPaintNav() {
  const rail = document.getElementById('rsb-tasks');
  if (rail) tbPaintNavBtn(rail);
  const hbtn = document.getElementById('tb-hbtn');
  if (hbtn) tbPaintNavBtn(hbtn);
}

// ── Root ─────────────────────────────────────────────────────────────────────
function tbEnsureRoot() {
  let root = document.getElementById('task-board');
  if (root) return root;
  const col = document.getElementById('chat-feed-col');
  const header = document.getElementById('chat-header');
  if (!col || !header) return null;
  root = tbEl('section', 'tb-root');
  root.id = 'task-board';
  root.setAttribute('aria-labelledby', 'tb-title');

  const head = tbEl('div', 'tb-head');
  const close = tbButton('tb-close', 'chevron');
  close.id = 'tb-close';
  close.title = 'Back to chat';
  close.setAttribute('aria-label', 'Close Tasks, back to chat');
  close.addEventListener('click', tbCloseBoard);
  const title = tbEl('h2', 'tb-title');
  title.id = 'tb-title';
  const roomName = tbEl('span', 'tb-title-room');
  roomName.id = 'tb-title-room';
  roomName.textContent = tasksUi.roomTitle;
  title.append('Task', tbEl('span', 'tb-title-sep', ' · '), roomName);
  head.append(close, title);

  const bar = tbEl('div', 'tb-toolbar');
  const g1 = tbEl('div', 'tb-group');
  const play = tbButton('tb-btn tb-primary', 'play', 'Play');
  play.id = 'tb-play';
  play.addEventListener('click', tbOnPlay);
  const stop = tbButton('tb-btn', 'stop', 'Stop');
  stop.id = 'tb-stop';
  stop.addEventListener('click', tbOnStop);
  g1.append(play, stop);
  const sep = tbEl('div', 'tb-sep');
  sep.setAttribute('aria-hidden', 'true');
  const g2 = tbEl('div', 'tb-group');
  const cl = tbEl('span', 'tb-stepper-l', 'Parallel');
  cl.id = 'tb-conc-l';
  const stepper = tbEl('div', 'tb-stepper');
  stepper.setAttribute('role', 'group');
  stepper.setAttribute('aria-labelledby', 'tb-conc-l');
  const dec = tbButton('', 'minus');
  dec.id = 'tb-conc-dec';
  dec.setAttribute('aria-label', 'Fewer parallel tasks');
  dec.addEventListener('click', () => tbSetConcurrency(-1));
  const out = tbEl('output');
  out.id = 'tb-conc-v';
  out.setAttribute('aria-live', 'polite');
  const inc = tbButton('', 'plus');
  inc.id = 'tb-conc-inc';
  inc.setAttribute('aria-label', 'More parallel tasks');
  inc.addEventListener('click', () => tbSetConcurrency(1));
  stepper.append(dec, out, inc);
  g2.append(cl, stepper);
  const g3 = tbEl('div', 'tb-group');
  const ml = tbEl('span', 'tb-seg-l', 'Finish');
  ml.id = 'tb-mode-l';
  const hint = tbEl('span', 'tb-sr');
  hint.id = 'tb-mode-hint';
  const seg = tbEl('div', 'tb-seg');
  seg.id = 'tb-mode';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-labelledby', 'tb-mode-l');
  seg.setAttribute('aria-describedby', 'tb-mode-hint');
  for (const m of TASK_MODES) {
    const b = tbButton('', null, m.label);
    b.dataset.mode = m.value;
    b.title = m.hint;
    b.addEventListener('click', () => tbSetCompletionMode(m.value));
    seg.appendChild(b);
  }
  g3.append(ml, seg, hint);
  const filter = tbButton('tb-btn tb-ghost', 'filter', 'Filter');
  filter.id = 'tb-filter';
  filter.setAttribute('aria-haspopup', 'dialog');
  filter.setAttribute('aria-expanded', 'false');
  filter.addEventListener('click', () => (_tbPop && _tbPop.btn === filter ? tbClosePop() : tbOnFilter()));
  const stats = tbButton('tb-btn tb-ghost', 'chart', 'Stats');
  stats.id = 'tb-stats-btn';
  stats.title = 'Statistics';
  stats.setAttribute('aria-controls', 'tb-stats');
  stats.setAttribute('aria-expanded', 'false');
  stats.addEventListener('click', () => tasksToggleStats());
  const spacer = tbEl('div', 'tb-spacer');
  const status = tbEl('span', 'tb-status');
  status.id = 'tb-status';
  status.setAttribute('role', 'status');
  const add = tbButton('tb-btn', 'plus', 'Task');
  add.id = 'tb-add';
  add.setAttribute('aria-label', 'Add task');
  add.addEventListener('click', () => tbOpenQuickAdd('backlog'));
  bar.append(g1, sep, g2, g3, filter, stats, spacer, status, add);

  const banner = tbEl('div', 'tb-banner');
  banner.id = 'tb-banner';
  banner.hidden = true;
  const board = tbEl('div', 'tb-board');
  board.id = 'tb-board';
  board.addEventListener('pointerdown', tbOnPointerDown);
  board.addEventListener('click', e => {
    if (_tbSuppressClick) { _tbSuppressClick = false; return; }
    const card = e.target.closest('.tb-card');
    if (card) tasksOpenDrawer(Number(card.dataset.id), card);
  });
  board.addEventListener('keydown', tbOnBoardKey);

  const drawer = tbEl('aside', 'tb-drawer');
  drawer.id = 'tb-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'false');
  drawer.setAttribute('aria-labelledby', 'tb-d-title');
  drawer.tabIndex = -1;

  const statsPanel = tbEl('aside', 'tb-drawer tb-stats');
  statsPanel.id = 'tb-stats';
  statsPanel.setAttribute('role', 'dialog');
  statsPanel.setAttribute('aria-modal', 'false');
  statsPanel.setAttribute('aria-labelledby', 'tb-s-title');
  statsPanel.tabIndex = -1;

  root.append(head, bar, banner, board, drawer, statsPanel);
  header.after(root);
  return root;
}

// ── Render ───────────────────────────────────────────────────────────────────
function tasksRender() {
  tasksPaintNav();
  if (!tasksBoardOpen()) return;
  if (!tbEnsureRoot()) return;
  tbRenderToolbar();
  tbRenderBanner();
  tbRenderBoard();
}

function tbRenderToolbar() {
  const s = tasksUi.settings;
  const { running, backlog } = tbCounts();
  const ro = tbArchived() || !tasksUi.loaded;
  const play = document.getElementById('tb-play');
  tbSetBtn(play, s.running ? 'pause' : 'play', s.running ? 'Pause' : 'Play');
  play.setAttribute('aria-pressed', String(s.running));
  play.title = s.running ? 'Pause: running tasks finish, no new task starts' : 'Run the Backlog from the top';
  play.disabled = ro || tasksUi.busy.has('runner');
  const stop = document.getElementById('tb-stop');
  stop.disabled = ro || running === 0 || tasksUi.busy.has('runner');
  stop.title = running ? 'Stop the runner and cancel running tasks' : 'Nothing is running';
  document.getElementById('tb-conc-v').textContent = String(s.concurrency);
  document.getElementById('tb-conc-dec').disabled = ro || s.concurrency <= 1;
  document.getElementById('tb-conc-inc').disabled = ro || s.concurrency >= 5;
  for (const b of document.getElementById('tb-mode').children) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === s.completion_mode));
    b.disabled = ro;
  }
  const mode = TASK_MODES.find(m => m.value === s.completion_mode);
  document.getElementById('tb-mode-hint').textContent = mode ? mode.hint : '';
  const fb = document.getElementById('tb-filter');
  tbSetBtn(fb, 'filter', 'Filter');
  if (tbFilterCount()) fb.appendChild(tbEl('span', 'tb-fcount', String(tbFilterCount())));
  document.getElementById('tb-add').disabled = ro;
  const st = document.getElementById('tb-status');
  st.replaceChildren(tbEl('i', 'tb-led'));
  let text, cls = '';
  if (tbArchived()) text = 'Room archived · read-only';
  else if (!tasksUi.loaded) text = tasksUi.loadError ? 'Could not load tasks' : 'Loading…';
  else if (s.running && running) { text = `Running ${running} · ${backlog} left`; cls = 'on'; }
  else if (s.running) { text = `Waiting · ${backlog} left`; cls = 'on'; }
  else if (running) { text = `Paused · finishing ${running}`; cls = 'paused'; }
  else text = `Runner stopped · ${backlog} in Backlog`;
  st.className = 'tb-status' + (cls ? ' ' + cls : '');
  st.appendChild(tbEl('span', null, text));
}

function tbRenderBanner() {
  const b = document.getElementById('tb-banner');
  b.replaceChildren();
  b.className = 'tb-banner';
  const s = tasksUi.settings;
  const { running } = tbCounts();
  if (!tasksUi.loaded) { b.hidden = true; return; }
  const backlogIds = tbColIds('backlog');
  if (!s.running && !running && s.idle_reason === 'empty' && !backlogIds.length && tasksUi.bannerDismissed !== 'done') {
    b.classList.add('done');
    b.append(tbIcon('check'), tbEl('span', null, 'Every Backlog task is done. The runner stopped.'));
    b.appendChild(tbBannerDismiss('done'));
    b.hidden = false;
    return;
  }
  const idle = (s.running || s.idle_reason === 'blocked') && !running && backlogIds.length;
  if (!idle) { b.hidden = true; return; }
  const blocked = backlogIds.filter(id => { const t = tbTask(id); return t.status !== 'failed' && tbStatusKey(t) === 'blocked'; }).length;
  const failed = backlogIds.filter(id => tbTask(id).status === 'failed').length;
  const waiting = blocked + tbColIds('awaiting').length;
  const key = 'idle:' + waiting + ':' + failed;
  if (tasksUi.bannerDismissed === key || (!waiting && !failed)) { b.hidden = true; return; }
  b.appendChild(tbIcon('lock'));
  const parts = [];
  if (waiting) parts.push(`${waiting} ${waiting === 1 ? 'task is' : 'tasks are'} waiting on a dependency or confirmation.`);
  if (failed) parts.push(`${failed} failed and ${failed === 1 ? 'needs' : 'need'} Retry.`);
  b.appendChild(tbEl('span', null, parts.join(' ')));
  const show = tbButton('tb-btn tb-sm', null, 'Show');
  show.addEventListener('click', () => { tasksUi.filter.status = new Set(['blocked', 'awaiting', 'failed']); tasksRender(); });
  b.append(show, tbBannerDismiss(key));
  b.hidden = false;
}
function tbBannerDismiss(key) {
  const x = tbButton('tb-iconbtn', 'x');
  x.setAttribute('aria-label', 'Dismiss');
  x.addEventListener('click', () => { tasksUi.bannerDismissed = key; tasksRender(); });
  return x;
}

function tbBadgeFor(task) {
  const k = tbStatusKey(task);
  const mk = (cls, ic, text, spin) => {
    const b = tbEl('span', 'tb-badge ' + cls);
    b.append(tbIcon(ic, spin ? 'tb-spin' : ''), tbEl('span', null, text));
    return b;
  };
  if (k === 'running') return mk('run', 'spin', 'Running', true);
  if (k === 'failed') return mk('fail', 'alert', 'Failed');
  if (k === 'awaiting') return mk('await', 'clock', 'Confirm');
  if (k === 'done') return mk('ok', 'check', 'Done');
  if (k === 'blocked') {
    const bi = tbBlockInfo(task);
    if (!bi) return mk('hard', 'lock', 'Blocked');
    return mk(bi.hard ? 'hard' : 'wait', 'lock', (bi.hard ? 'blocked ' : 'waiting ') + tbSeqLabel(bi.id));
  }
  return null;
}

function tbRenderCard(id) {
  const task = tbTask(id);
  const k = tbStatusKey(task);
  const c = tbEl('div', 'tb-card is-' + k);
  c.dataset.id = String(id);
  c.tabIndex = 0;
  c.setAttribute('role', 'button');
  c.setAttribute('aria-roledescription', 'card');
  if (tasksUi.openId === id) c.classList.add('sel');
  if (tasksUi.grab && tasksUi.grab.id === id) c.classList.add('grabbed');
  if (tasksUi.busy.has(id)) c.classList.add('busy');
  if (!tbMatches(task)) c.classList.add('hide');
  if (task._fresh) { c.classList.add('arrive'); delete task._fresh; }
  const top = tbEl('div', 'tb-c-top');
  top.appendChild(tbEl('span', 'tb-c-id', '#' + task.seq));
  if (task.priority && task.priority !== 'none') {
    const d = tbEl('span', 'tb-pdot ' + task.priority);
    d.title = TASK_PRIORITY_LABEL[task.priority] + ' priority';
    top.appendChild(d);
  }
  const g = tbEl('span', 'tb-grip');
  g.appendChild(tbIcon('grip'));
  g.setAttribute('aria-hidden', 'true');
  top.appendChild(g);
  c.appendChild(top);
  c.appendChild(tbEl('div', 'tb-c-title', task.title));
  const foot = tbEl('div', 'tb-c-foot');
  const b = tbBadgeFor(task);
  if (b) foot.appendChild(b);
  const doneOn = k === 'done' ? tbDay(task.finished_at) : '';
  if (doneOn) foot.appendChild(tbTimeEl(task.finished_at, doneOn, 'tb-c-date'));
  const list = Array.isArray(task.checklist) ? task.checklist : [];
  const p = tbEl('span', 'tb-prog');
  if (list.length) p.append(tbIcon('checks'), tbEl('span', null, list.filter(x => x.done).length + '/' + list.length));
  foot.appendChild(p);
  const who = tbWorkerFor(task);
  const av = tbAvatarFor(who, 20);
  av.title = who.name;
  foot.appendChild(av);
  c.appendChild(foot);
  c.setAttribute('aria-label', ['#' + task.seq, task.title, b ? b.textContent : '', doneOn ? 'finished ' + doneOn : '', who.name].filter(Boolean).join(', '));
  return c;
}

function tbRenderBoard() {
  if (_tbDrag && _tbDrag.started) { _tbPendingRender = true; return; }
  const board = document.getElementById('tb-board');
  const scrolls = {};
  board.querySelectorAll('.tb-col').forEach(cl => { scrolls[cl.dataset.col] = cl.querySelector('.tb-list').scrollTop; });
  const boardScroll = board.scrollLeft;
  const active = document.activeElement;
  const focusedId = active && board.contains(active) && active.closest('.tb-card') ? active.closest('.tb-card').dataset.id : null;
  const qaFocused = active && active.classList && active.classList.contains('tb-qa');
  const qaValue = qaFocused ? active.value : (_tbQaDraft || '');
  board.replaceChildren();
  if (!tasksUi.loaded) {
    const e = tbEl('div', 'tb-loading', tasksUi.loadError ? tasksUi.loadError : 'Loading tasks…');
    if (tasksUi.loadError) {
      const retry = tbButton('tb-btn tb-sm', 'retry', 'Try again');
      retry.addEventListener('click', () => { tasksUi.loadError = null; tasksRender(); tasksOnSocketOpen(tasksUi.roomId); });
      e.appendChild(retry);
    }
    board.appendChild(e);
    return;
  }
  const ro = tbArchived();
  const { running } = tbCounts();
  for (const col of TASK_COLS) {
    const ids = tbColIds(col);
    const c = tbEl('section', 'tb-col');
    c.dataset.col = col;
    c.setAttribute('aria-label', TASK_COL_LABEL[col]);
    const h = tbEl('div', 'tb-col-h');
    h.appendChild(tbEl('h3', null, TASK_COL_LABEL[col]));
    const visible = ids.filter(id => tbMatches(tbTask(id))).length;
    if (col === 'ongoing') {
      const n = tbEl('span', 'tb-n' + (running ? ' cap' : ''), running + ' / ' + tasksUi.settings.concurrency);
      n.title = 'Running / parallel limit';
      h.appendChild(n);
    } else {
      h.appendChild(tbEl('span', 'tb-n', tbFilterCount() ? visible + ' / ' + ids.length : String(ids.length)));
    }
    c.appendChild(h);
    c.appendChild(tbEl('div', 'tb-col-sub', TASK_COL_SUB[col]));
    const list = tbEl('div', 'tb-list');
    list.setAttribute('role', 'list');
    for (const id of ids) list.appendChild(tbRenderCard(id));
    if (!ids.length) list.appendChild(tbEmptyState(col));
    else if (!visible) list.appendChild(tbEl('div', 'tb-empty', 'No cards match the filter.'));
    c.appendChild(list);
    if ((col === 'awaiting' || col === 'backlog') && !ro) {
      const f = tbEl('div', 'tb-col-f');
      if (tasksUi.quickAdd === col) {
        const qa = tbEl('textarea', 'tb-qa');
        qa.rows = 2;
        qa.maxLength = 200;
        qa.placeholder = 'Task title…';
        qa.setAttribute('aria-label', 'Add task to ' + TASK_COL_LABEL[col]);
        qa.value = qaValue;
        qa.addEventListener('keydown', e => tbOnQuickAddKey(e, col));
        qa.addEventListener('input', () => { _tbQaDraft = qa.value; });
        qa.addEventListener('blur', () => {
          setTimeout(() => {
            if (qa.isConnected && tasksUi.quickAdd === col && !qa.value.trim() && document.activeElement !== qa) { tasksUi.quickAdd = null; tbRenderBoard(); }
          }, 120);
        });
        f.appendChild(qa);
        f.appendChild(tbEl('div', 'tb-qa-hint', 'Enter to add, Esc when done'));
      } else {
        const ab = tbButton('tb-add-btn', 'plus', 'Add task');
        ab.addEventListener('click', () => tbOpenQuickAdd(col));
        f.appendChild(ab);
      }
      c.appendChild(f);
    }
    board.appendChild(c);
  }
  board.scrollLeft = boardScroll;
  board.querySelectorAll('.tb-col').forEach(cl => { cl.querySelector('.tb-list').scrollTop = scrolls[cl.dataset.col] || 0; });
  if (focusedId) {
    const n = board.querySelector('.tb-card[data-id="' + focusedId + '"]');
    if (n) n.focus({ preventScroll: true });
  }
  if (qaFocused || tasksUi.quickAddFocus) {
    const qa = board.querySelector('.tb-qa');
    if (qa) {
      qa.focus();
      qa.setSelectionRange(qa.value.length, qa.value.length);
      if (tasksUi.quickAddFocus) qa.scrollIntoView({ block: 'nearest' });
    }
    tasksUi.quickAddFocus = false;
  }
}

function tbEmptyState(col) {
  const e = tbEl('div', 'tb-empty');
  const ro = tbArchived();
  if (col === 'ongoing' && tasksUi.settings.running) {
    e.appendChild(tbEl('span', null, 'The runner is waiting for a card it can take from Backlog.'));
    return e;
  }
  const text = {
    awaiting: 'Nothing is waiting for your confirmation.', backlog: 'Backlog is empty.',
    ongoing: 'Nothing is running. Press Play to start.', finished: 'Finished tasks show up here.',
  }[col];
  e.appendChild(tbEl('span', null, text));
  if (ro) return e;
  let b;
  if (col === 'awaiting' || col === 'backlog') {
    b = tbButton('tb-btn tb-sm', 'plus', 'Add task');
    b.addEventListener('click', () => tbOpenQuickAdd(col));
  } else if (col === 'ongoing') {
    b = tbButton('tb-btn tb-sm', 'play', 'Play');
    b.disabled = !tbColIds('backlog').length;
    b.addEventListener('click', tbOnPlay);
  } else {
    b = tbButton('tb-btn tb-sm', null, 'Go to Backlog');
    b.addEventListener('click', () => {
      const bl = document.querySelector('#tb-board .tb-col[data-col="backlog"]');
      if (bl) bl.scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'smooth' });
    });
  }
  e.appendChild(b);
  return e;
}

// ── Quick add ────────────────────────────────────────────────────────────────
let _tbQaDraft = '';
function tbOpenQuickAdd(col) {
  if (tbArchived()) return;
  if (tasksUi.quickAdd !== col) _tbQaDraft = '';
  tasksUi.quickAdd = col;
  tasksUi.quickAddFocus = true;
  tbRenderBoard();
  const c = document.querySelector('#tb-board .tb-col[data-col="' + col + '"]');
  if (c) c.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}
async function tbOnQuickAddKey(e, col) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tasksUi.quickAdd = null; _tbQaDraft = ''; tbRenderBoard(); return; }
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  const qa = e.target;
  const title = qa.value.trim();
  if (!title || qa.dataset.busy) return;
  const roomId = tasksUi.roomId;
  const body = { title: title.slice(0, 200), col };
  if (col === 'awaiting') body.await_reason = 'Added to Awaiting by hand';
  qa.dataset.busy = '1';
  try {
    const task = await TasksApi.create(roomId, body);
    if (roomId !== tasksUi.roomId) return;
    if (tbValidTask(task, roomId)) { task._fresh = !tasksUi.tasks.has(task.id); tasksUi.tasks.set(task.id, task); }
    _tbQaDraft = '';
    if (qa.isConnected) qa.value = '';
    tasksUi.quickAddFocus = true;
    tasksRender();
  } catch (err) { tbErr(err); } finally { delete qa.dataset.busy; }
}

// ── Runner actions ───────────────────────────────────────────────────────────
async function tbRunner(action) {
  const roomId = tasksUi.roomId;
  tasksUi.busy.add('runner');
  tasksRender();
  try {
    const r = await TasksApi.runner(roomId, action);
    if (roomId === tasksUi.roomId && r && r.settings) tbApplySettings(r.settings);
  } catch (err) { tbErr(err); } finally {
    tasksUi.busy.delete('runner');
    if (roomId === tasksUi.roomId) tasksRender();
  }
}
function tbOnPlay() {
  tasksUi.bannerDismissed = null;
  tbRunner(tasksUi.settings.running ? 'pause' : 'play');
}

let _tbConcTimer = null;
function tbSetConcurrency(delta) {
  const s = tasksUi.settings;
  const next = Math.max(1, Math.min(5, s.concurrency + delta));
  if (next === s.concurrency) return;
  s.concurrency = next;
  tasksRender();
  clearTimeout(_tbConcTimer);
  const roomId = tasksUi.roomId;
  _tbConcTimer = setTimeout(async () => {
    try {
      const r = await TasksApi.updateSettings(roomId, { concurrency: next });
      if (roomId === tasksUi.roomId && r) { tbApplySettings(r.settings || r); tasksRender(); }
    } catch (err) {
      tbErr(err);
      if (roomId === tasksUi.roomId) tasksOnSocketOpen(roomId);
    }
  }, 350);
}

// Optimistic: the switch shows at once and reverts if the server refuses it.
async function tbSetCompletionMode(mode) {
  const s = tasksUi.settings;
  if (mode === s.completion_mode || tasksUi.busy.has('mode')) return;
  const roomId = tasksUi.roomId;
  const busy = tasksUi.busy;
  const prev = s.completion_mode;
  s.completion_mode = mode;
  busy.add('mode');
  tasksRender();
  try {
    const r = await TasksApi.updateSettings(roomId, { completion_mode: mode });
    if (roomId === tasksUi.roomId && r) tbApplySettings(r.settings || r);
  } catch (err) {
    tbErr(err);
    if (roomId === tasksUi.roomId && tasksUi.settings.completion_mode === mode) tasksUi.settings.completion_mode = prev;
  } finally {
    busy.delete('mode');
    if (roomId === tasksUi.roomId) tasksRender();
  }
}

// Stop cancels runner turns and sends every running card back to Backlog, so it always asks first and names what will be stopped.
function tbOnStop() {
  const runningIds = [...tasksUi.tasks.values()].filter(t => t.status === 'running').sort(tbRankCmp).map(t => t.id);
  if (!runningIds.length) return;
  const n = runningIds.length;
  const dlg = tbEl('dialog', 'tb-dialog');
  dlg.setAttribute('aria-labelledby', 'tb-stop-title');
  dlg.setAttribute('aria-describedby', 'tb-stop-desc');
  const h = tbEl('h2', null, 'Stop the runner?');
  h.id = 'tb-stop-title';
  const claimed = runningIds.filter(id => tbTask(id).claimed_by_actor_id != null).length;
  const r = n - claimed;
  const turns = !r ? '' : r === n ? (n === 1 ? ' Its turn is cancelled.' : ' Their turns are cancelled.') : (r === 1 ? ' The runner turn is cancelled.' : ` The ${r} runner turns are cancelled.`);
  const own = !claimed ? '' : claimed === 1 ? ' An agent that took a card itself is not interrupted, only its card moves.' : ' Agents that took cards themselves are not interrupted, only their cards move.';
  const p = tbEl('p', null, `${n === 1 ? 'The running task' : `The ${n} running tasks`} will be stopped too and ${n === 1 ? 'goes' : 'go'} back to Backlog.${turns}${own}`);
  p.id = 'tb-stop-desc';
  const ul = tbEl('ul', 'tb-dialog-list');
  for (const id of runningIds.slice(0, 5)) {
    const t = tbTask(id);
    const li = tbEl('li');
    li.append(tbEl('span', 'tb-c-id', '#' + t.seq), tbEl('span', null, t.title));
    ul.appendChild(li);
  }
  if (n > 5) ul.appendChild(tbEl('li', 'tb-more', `and ${n - 5} more`));
  const row = tbEl('div', 'tb-dialog-row');
  const keep = tbButton('tb-btn', null, 'Keep running');
  const yes = tbButton('tb-btn tb-danger-solid', 'stop', n === 1 ? 'Stop 1 task' : `Stop ${n} tasks`);
  row.append(keep, yes);
  dlg.append(h, p, ul, row);
  dlg.addEventListener('keydown', e => { if (e.key === 'Escape') e.stopPropagation(); });
  dlg.addEventListener('close', () => {
    dlg.remove();
    const btn = document.getElementById('tb-stop');
    if (btn && !btn.disabled) btn.focus();
  });
  keep.addEventListener('click', () => dlg.close());
  yes.addEventListener('click', () => { dlg.close(); tbRunner('stop'); });
  document.body.appendChild(dlg);
  dlg.showModal();
  keep.focus();
}

// ── Popovers (filter, Awaiting reason) ───────────────────────────────────────
let _tbPop = null;
function tbClosePop({ focus = true } = {}) {
  if (!_tbPop) return;
  const cur = _tbPop;
  _tbPop = null;
  cur.node.remove();
  if (cur.btn.hasAttribute('aria-haspopup')) cur.btn.setAttribute('aria-expanded', 'false');
  if (focus && cur.btn.isConnected) cur.btn.focus();
  if (cur.onCancel) cur.onCancel();
}
function tbOpenPop(btn, node, onCancel) {
  tbClosePop({ focus: false });
  document.body.appendChild(node);
  const r = btn.getBoundingClientRect();
  const w = node.offsetWidth;
  node.style.top = Math.round(Math.min(r.bottom + 6, window.innerHeight - node.offsetHeight - 8)) + 'px';
  node.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8))) + 'px';
  if (btn.hasAttribute('aria-haspopup')) btn.setAttribute('aria-expanded', 'true');
  _tbPop = { node, btn, onCancel };
  const first = node.querySelector('input, button');
  if (first) first.focus();
}

function tbOnFilter() {
  const p = tbEl('div', 'tb-pop');
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', 'Filter');
  const group = (title, set, items) => {
    const g = tbEl('div');
    g.appendChild(tbEl('h4', null, title));
    for (const [v, text] of items) {
      const lab = tbEl('label');
      const cb = tbEl('input');
      cb.type = 'checkbox';
      cb.checked = set.has(v);
      cb.addEventListener('change', () => { if (cb.checked) set.add(v); else set.delete(v); tasksRender(); });
      lab.append(cb, tbEl('span', null, text));
      g.appendChild(lab);
    }
    return g;
  };
  const grid = tbEl('div', 'tb-pop-cols');
  const left = tbEl('div');
  left.appendChild(group('Assignee', tasksUi.filter.assignee, tbAssignees().map(a => [a.key, a.primary ? a.name + ' (primary)' : a.name])));
  const labels = [...new Set([...tasksUi.tasks.values()].flatMap(x => x.labels || []))].sort();
  if (labels.length) left.appendChild(group('Label', tasksUi.filter.label, labels.map(l => [l, l])));
  grid.appendChild(left);
  grid.appendChild(group('Status', tasksUi.filter.status, ['running', 'queued', 'blocked', 'failed', 'awaiting', 'done'].map(s => [s, TASK_STATUS_LABEL[s]])));
  p.appendChild(grid);
  const r = tbEl('div', 'tb-pop-row');
  const clear = tbButton('tb-btn tb-ghost tb-sm', null, 'Reset');
  clear.addEventListener('click', () => {
    tasksUi.filter.assignee.clear(); tasksUi.filter.label.clear(); tasksUi.filter.status.clear();
    tbClosePop();
    tasksRender();
  });
  r.appendChild(clear);
  p.appendChild(r);
  tbOpenPop(document.getElementById('tb-filter'), p);
}

function tasksAskReason(anchor, onOk, onCancel) {
  const p = tbEl('div', 'tb-pop');
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', 'Reason for moving to Awaiting');
  p.appendChild(tbEl('h4', null, 'Reason for moving to Awaiting'));
  const input = tbEl('input', 'tb-inline-in');
  input.type = 'text';
  input.maxLength = 200;
  input.placeholder = 'e.g. needs a schema decision';
  input.setAttribute('aria-label', 'Reason for moving to Awaiting');
  p.appendChild(input);
  const r = tbEl('div', 'tb-pop-row');
  const back = tbButton('tb-btn tb-ghost tb-sm', null, 'Back');
  const ok = tbButton('tb-btn tb-primary tb-sm', null, 'Move to Awaiting');
  let settled = false;
  const finish = accepted => {
    if (settled) return;
    const v = input.value.trim();
    if (accepted && !v) { input.focus(); input.setAttribute('aria-invalid', 'true'); return; }
    settled = true;
    tbClosePop();
    if (accepted) onOk(v);
    else if (onCancel) onCancel();
  };
  back.addEventListener('click', () => finish(false));
  ok.addEventListener('click', () => finish(true));
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  r.append(back, ok);
  p.appendChild(r);
  tbOpenPop(anchor, p, () => { if (!settled) { settled = true; if (onCancel) onCancel(); } });
  input.focus();
}

// ── Moves ────────────────────────────────────────────────────────────────────
// The server owns rank: the client sends its neighbours. before_id = the card below the drop point,
// after_id = the card above it (only when there is nothing below).
async function tasksMove(id, col, index, reason) {
  const task = tbTask(id);
  if (!task || tbArchived() || tasksUi.busy.has(id)) return;
  if (task.status === 'running') { showToast('A running task cannot be moved. Use Stop.'); return; }
  if (col === 'ongoing') { showToast('Ongoing is managed by the runner. Press Play to run the Backlog.'); return; }
  const confirming = task.col === 'awaiting' && col === 'backlog';
  const others = tbColIds(col).filter(x => x !== id);
  const at = confirming ? others.length : Math.max(0, Math.min(index === undefined ? others.length : index, others.length));
  if (task.col === col && tbColIds(col).indexOf(id) === at) return;
  if (task.col === col && col === 'finished') return;
  const body = { col };
  if (col !== 'finished' && !confirming) {
    if (others[at] !== undefined) body.before_id = others[at];
    else if (at > 0) body.after_id = others[at - 1];
  }
  if (col === 'awaiting' && task.col !== 'awaiting') body.reason = reason;
  const roomId = tasksUi.roomId;
  tasksUi.pending = { id, col, index: at };
  tasksUi.busy.add(id);
  if (task.col !== col) task._fresh = true;
  tasksRender();
  try {
    const next = await TasksApi.move(roomId, id, body);
    if (roomId !== tasksUi.roomId) return;
    if (tbValidTask(next, roomId)) tasksUi.tasks.set(next.id, next);
  } catch (err) {
    tbErr(err);
  } finally {
    if (roomId === tasksUi.roomId) {
      tasksUi.busy.delete(id);
      if (tasksUi.pending && tasksUi.pending.id === id) tasksUi.pending = null;
      tasksRender();
      if (tasksUi.openId === id && typeof tasksRefreshDrawer === 'function') tasksRefreshDrawer();
    }
  }
}

// Moving into Awaiting needs a reason; everything else moves straight away.
function tbMoveWithReason(id, col, index, anchor, onCancel) {
  const task = tbTask(id);
  if (!task) return;
  if (col === 'awaiting' && task.col !== 'awaiting') {
    tasksAskReason(anchor, reason => tasksMove(id, col, index, reason), onCancel);
    return;
  }
  tasksMove(id, col, index);
}

// ── Pointer drag ─────────────────────────────────────────────────────────────
let _tbDrag = null, _tbPendingRender = false, _tbSuppressClick = false, _tbGhost = null, _tbDropLine = null;
function tbOnPointerDown(e) {
  const card = e.target.closest('.tb-card');
  if (!card || e.button !== 0 || tbArchived()) return;
  if (e.pointerType === 'touch' && !e.target.closest('.tb-grip')) return;
  _tbDrag = { id: Number(card.dataset.id), x: e.clientX, y: e.clientY, started: false, card, dx: 0, dy: 0, target: null };
  if (e.target.closest('.tb-grip')) e.preventDefault();
}
function tbBeginDrag(e) {
  const task = tbTask(_tbDrag.id);
  if (!task || task.status === 'running' || tasksUi.busy.has(task.id)) {
    if (task && task.status === 'running') showToast('A running task cannot be moved. Use Stop.');
    _tbDrag = null;
    _tbSuppressClick = true;
    setTimeout(() => { _tbSuppressClick = false; }, 0);
    return;
  }
  _tbDrag.started = true;
  const r = _tbDrag.card.getBoundingClientRect();
  _tbDrag.dx = _tbDrag.x - r.left;
  _tbDrag.dy = _tbDrag.y - r.top;
  _tbGhost = _tbDrag.card.cloneNode(true);
  _tbGhost.classList.add('tb-drag-ghost');
  _tbGhost.classList.remove('sel', 'arrive');
  _tbGhost.removeAttribute('tabindex');
  _tbGhost.setAttribute('aria-hidden', 'true');
  _tbGhost.style.width = r.width + 'px';
  document.body.appendChild(_tbGhost);
  _tbDrag.card.classList.add('src');
  document.body.classList.add('tb-dragging');
  _tbDropLine = tbEl('div', 'tb-drop-line');
  _tbDropLine.setAttribute('aria-hidden', 'true');
  const og = document.querySelector('#tb-board .tb-col[data-col="ongoing"]');
  if (og) og.classList.add('no-drop');
  tbMoveGhost(e);
}
function tbMoveGhost(e) {
  _tbGhost.style.left = (e.clientX - _tbDrag.dx) + 'px';
  _tbGhost.style.top = (e.clientY - _tbDrag.dy) + 'px';
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const colEl = under && under.closest('#tb-board .tb-col');
  document.querySelectorAll('#tb-board .tb-col.drop-on').forEach(c => c.classList.remove('drop-on'));
  if (!colEl || !TASK_DROP_COLS.includes(colEl.dataset.col)) {
    _tbDropLine.remove();
    _tbDrag.target = null;
    if (colEl && colEl.dataset.col === 'ongoing') _tbDrag.hintOngoing = true;
    return;
  }
  colEl.classList.add('drop-on');
  const list = colEl.querySelector('.tb-list');
  const cards = [...list.querySelectorAll('.tb-card:not(.src):not(.hide)')];
  let idx = cards.findIndex(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
  if (idx === -1) idx = cards.length;
  const before = cards[idx] || null;
  const emptyNode = list.querySelector('.tb-empty');
  if (before) list.insertBefore(_tbDropLine, before);
  else if (emptyNode) list.insertBefore(_tbDropLine, emptyNode);
  else list.appendChild(_tbDropLine);
  const col = colEl.dataset.col;
  const ordered = tbColIds(col).filter(id => id !== _tbDrag.id);
  const beforeId = before ? Number(before.dataset.id) : null;
  _tbDrag.target = { col, index: beforeId === null ? ordered.length : ordered.indexOf(beforeId) };
  const lr = list.getBoundingClientRect();
  if (e.clientY < lr.top + 36) list.scrollTop -= 10;
  else if (e.clientY > lr.bottom - 36) list.scrollTop += 10;
  const board = document.getElementById('tb-board');
  const br = board.getBoundingClientRect();
  if (e.clientX < br.left + 30) board.scrollLeft -= 12;
  else if (e.clientX > br.right - 30) board.scrollLeft += 12;
}
function tbOnPointerMove(e) {
  if (!_tbDrag) return;
  if (!_tbDrag.started) {
    if (Math.hypot(e.clientX - _tbDrag.x, e.clientY - _tbDrag.y) < 5) return;
    tbBeginDrag(e);
    return;
  }
  e.preventDefault();
  tbMoveGhost(e);
}
function tbEndDrag(commit) {
  if (!_tbDrag) return;
  if (!_tbDrag.started) { _tbDrag = null; return; }
  _tbSuppressClick = true;
  setTimeout(() => { _tbSuppressClick = false; }, 0);
  const { target, id, hintOngoing } = _tbDrag;
  if (_tbGhost) _tbGhost.remove();
  if (_tbDropLine) _tbDropLine.remove();
  _tbGhost = _tbDropLine = null;
  document.body.classList.remove('tb-dragging');
  _tbDrag = null;
  _tbPendingRender = false;
  tbRenderBoard();
  if (commit && target) {
    const anchor = document.querySelector('#tb-board .tb-col[data-col="' + target.col + '"] h3');
    tbMoveWithReason(id, target.col, target.index, anchor || document.getElementById('tb-filter'));
  } else if (commit && hintOngoing) {
    showToast('Ongoing is managed by the runner. Press Play to run the Backlog.');
  }
}

// ── Keyboard: Enter opens, Space picks up / drops, arrows move, Esc cancels ───
function tbOnBoardKey(e) {
  const card = e.target.closest && e.target.closest('.tb-card');
  if (!card) return;
  const id = Number(card.dataset.id);
  const task = tbTask(id);
  if (!task) return;
  const g = tasksUi.grab;
  if (!g) {
    if (e.key === 'Enter') { e.preventDefault(); tasksOpenDrawer(id, card); }
    else if (e.key === ' ') {
      e.preventDefault();
      if (tbArchived()) return;
      if (task.status === 'running') { tbAnnounce('A running task cannot be moved. Use Stop.'); showToast('A running task cannot be moved. Use Stop.'); return; }
      if (tasksUi.busy.has(id)) return;
      const index = tbColIds(task.col).indexOf(id);
      tasksUi.grab = { id, fromCol: task.col, fromIndex: index, col: task.col, index };
      tbRenderBoard();
      tbAnnounce(`Task #${task.seq} picked up. Arrows to move, Space to drop, Esc to cancel.`);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = [...document.querySelectorAll('#tb-board .tb-col[data-col="' + tbShownCol(task) + '"] .tb-card:not(.hide)')];
      const i = all.indexOf(card) + (e.key === 'ArrowDown' ? 1 : -1);
      if (all[i]) all[i].focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      let ci = TASK_COLS.indexOf(tbShownCol(task));
      const step = e.key === 'ArrowRight' ? 1 : -1;
      for (ci += step; ci >= 0 && ci < TASK_COLS.length; ci += step) {
        const c = document.querySelector('#tb-board .tb-col[data-col="' + TASK_COLS[ci] + '"] .tb-card:not(.hide)');
        if (c) { c.focus(); c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); break; }
      }
    }
    return;
  }
  if (g.id !== id) return;
  const focusGrabbed = () => {
    const n = document.querySelector('#tb-board .tb-card[data-id="' + id + '"]');
    if (n) { n.focus(); n.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  };
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const len = tbColIds(g.col).length;
    const j = g.index + (e.key === 'ArrowDown' ? 1 : -1);
    if (j < 0 || j >= len) return;
    g.index = j;
    tbRenderBoard();
    focusGrabbed();
    tbAnnounce(`${TASK_COL_LABEL[g.col]}, position ${j + 1}`);
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const to = TASK_DROP_COLS[TASK_DROP_COLS.indexOf(g.col) + (e.key === 'ArrowRight' ? 1 : -1)];
    if (!to) return;
    const others = tbColIds(to).filter(x => x !== id).length;
    g.col = to;
    g.index = Math.min(g.index, others);
    tbRenderBoard();
    focusGrabbed();
    tbAnnounce(`${TASK_COL_LABEL[to]}, position ${g.index + 1}`);
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    tasksUi.grab = null;
    const moved = !(g.col === g.fromCol && g.index === g.fromIndex);
    tbRenderBoard();
    focusGrabbed();
    if (!moved) { tbAnnounce(`Task #${task.seq} dropped where it was.`); return; }
    tbAnnounce(`Task #${task.seq} dropped in ${TASK_COL_LABEL[g.col]}, position ${g.index + 1}.`);
    const anchor = document.querySelector('#tb-board .tb-card[data-id="' + id + '"]') || card;
    tbMoveWithReason(id, g.col, g.index, anchor, () => { tbAnnounce(`Cancelled. Task #${task.seq} returned.`); focusGrabbed(); });
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    tasksUi.grab = null;
    tbRenderBoard();
    focusGrabbed();
    tbAnnounce(`Cancelled. Task #${task.seq} returned.`);
  }
}

// ── Global wiring ────────────────────────────────────────────────────────────
function tbCloseAllTransient() {
  tbClosePop({ focus: false });
  if (_tbDrag) tbEndDrag(false);
  tasksUi.grab = null;
}

document.addEventListener('pointermove', tbOnPointerMove, { passive: false });
document.addEventListener('pointerup', () => tbEndDrag(true));
document.addEventListener('pointercancel', () => tbEndDrag(false));
document.addEventListener('pointerdown', e => {
  if (_tbPop && !_tbPop.node.contains(e.target) && !_tbPop.btn.contains(e.target)) tbClosePop({ focus: false });
});
window.addEventListener('resize', () => tbClosePop({ focus: false }));
// Registered before init/main.js, so the board's Esc (popover, drag, drawer, statistics, then the board) never
// reaches the global handler that stops a running generation.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !tasksBoardOpen() || document.querySelector('dialog[open]')) return;
  if (_tbPop) { tbClosePop(); e.stopImmediatePropagation(); return; }
  if (_tbDrag && _tbDrag.started) { tbEndDrag(false); e.stopImmediatePropagation(); return; }
  if (tasksUi.openId && !tasksUi.grab) { tasksCloseDrawer(); e.stopImmediatePropagation(); return; }
  if (typeof tasksStatsOpen === 'function' && tasksStatsOpen() && !tasksUi.grab) { tasksCloseStats(); e.stopImmediatePropagation(); return; }
  if (!e.defaultPrevented && !tasksUi.grab && tbEscClosesBoard(e.target)) { e.stopImmediatePropagation(); tbCloseBoard(); }
});
// Esc closes the board only when nothing above it handles Esc: focus is on the board, a Tasks button or the
// page itself (not the thread panel, workspace or settings), and no workspace overlay is open.
function tbEscClosesBoard(target) {
  if (typeof wsExpanded !== 'undefined' && wsExpanded) return false;
  if (document.querySelector('.ws-scrim, .ws-ctx-menu')) return false;
  if (!target || target === document.body || target === document.documentElement) return true;
  return !!(target.closest && target.closest('#task-board, #rsb-tasks, #tb-hbtn'));
}
