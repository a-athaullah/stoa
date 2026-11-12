'use strict';
// Kanban task board per room: the one implementation of the card operations. The HTTP routes
// (/api/rooms/:id/tasks…) and the built-in MCP tools (stoa__task_*) both call it, so validation,
// permissions, events and the WS broadcasts cannot drift between the two paths. The runner
// (lib/room-tasks-runner.js) changes run state through the run* functions here for the same reason.
//
// Every operation is scoped to one room and takes the caller:
//   who = { actorId: null }                    → the owner's session (human)
//   who = { actorId, subAgentId: null }        → an agent secret / MCP session
//   who = { actorId, subAgentId }              → a sub-agent of that agent
// → { status, body } with an HTTP status code; body.error on failure.
//
// A card id only resolves inside its room: a card of another room answers 404, like a missing one.

const COLS = ['awaiting', 'backlog', 'ongoing', 'finished'];
const PRIORITIES = ['none', 'low', 'med', 'high'];
// How a runner card's run ends (room_task_settings.completion_mode, lib/room-tasks-runner.js header).
const COMPLETION_MODES = ['quiet', 'agent'];
const LIMITS = {
  title: 200, description: 20000, labels: 8, label: 24, checklist: 50, checkText: 200,
  deps: 20, comment: 4000, reason: 1000, summary: 500, tasksPerRoom: 1000, eventsPage: 100,
};
const ok = (body, status = 200) => ({ status, body });
const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } });

// ── Rank: fractional string keys over base 36, compared bytewise (SQLite BINARY = JS <) ──
// A key never ends in '0', so there is always room between two keys. The client never sends a
// rank: it names a neighbour (before_id / after_id) and the server computes the key.
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const RANK_MAX_LEN = 24; // longer → the column group is re-spread (rebalance)

function midpoint(a, b) {
  if (b !== null) {
    let n = 0;
    while ((a[n] || '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}

// Key strictly between a and b (null = open end). Throws when a >= b.
function keyBetween(a, b) {
  if (a != null && b != null && a >= b) throw new Error(`rank order: ${a} >= ${b}`);
  return midpoint(a || '', b ?? null);
}

// n keys spread evenly, all the same short length, ascending.
function evenKeys(n) {
  let w = 1;
  while (DIGITS.length ** w < n + 2) w++;
  w++;
  const span = DIGITS.length ** w;
  const keys = [];
  for (let i = 1; i <= n; i++) {
    let v = Math.floor((span * i) / (n + 1));
    let s = '';
    for (let k = 0; k < w; k++) { s = DIGITS[v % 36] + s; v = Math.floor(v / 36); }
    keys.push(s.replace(/0+$/, ''));
  }
  return keys;
}

// Backlog and Ongoing share one rank space: a running card keeps its Backlog rank, so Stop or a
// failure puts it back exactly where it was.
const rankGroup = (col) => (col === 'backlog' || col === 'ongoing' ? ['backlog', 'ongoing'] : [col]);

// ── Input normalisation ──
const isPosInt = (v) => Number.isInteger(v) && v > 0;
const str = (v) => (typeof v === 'string' ? v : null);

function cleanTitle(v) {
  const s = str(v)?.replace(/[\r\n]+/g, ' ').trim();
  return s && s.length <= LIMITS.title ? s : null;
}
function cleanReason(v) {
  const s = str(v)?.trim();
  return s && s.length <= LIMITS.reason ? s : null;
}
function cleanLabels(v) {
  if (!Array.isArray(v) || v.length > LIMITS.labels) return null;
  const out = [];
  for (const l of v) {
    const s = str(l)?.replace(/[\r\n]+/g, ' ').trim();
    if (!s || s.length > LIMITS.label) return null;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}
// Items keep a positive integer id the client sent (so a re-sent list keeps its ids); new ones get the next.
function cleanChecklist(v) {
  if (!Array.isArray(v) || v.length > LIMITS.checklist) return null;
  const used = new Set();
  const items = [];
  for (const it of v) {
    if (!it || typeof it !== 'object') return null;
    const text = str(it.text)?.replace(/[\r\n]+/g, ' ').trim();
    if (!text || text.length > LIMITS.checkText) return null;
    if (it.done !== undefined && typeof it.done !== 'boolean') return null;
    const id = isPosInt(it.id) && !used.has(it.id) ? it.id : null;
    if (id) used.add(id);
    items.push({ id, text, done: it.done === true });
  }
  let next = Math.max(0, ...used) + 1;
  for (const it of items) if (!it.id) it.id = next++;
  return items;
}
function cleanIdList(v) {
  if (!Array.isArray(v) || v.length > LIMITS.deps || !v.every(isPosInt)) return null;
  return [...new Set(v)];
}
const parseJson = (s, fallback) => { try { const v = JSON.parse(s); return v ?? fallback; } catch { return fallback; } };

// primaryActorId(roomId): the agent a card without assignee runs on (the runner's target).
// completeThread(roomId, rootId, { fromTurn }): marks a thread complete like the owner's button and tells the room;
// fromTurn = an agent asked, so the caller may wait for that agent's turn to end (lib/thread-complete-defer.js).
function createRoomTasks({ db, broadcast, primaryActorId = () => null, completeThread = () => {}, log = console }) {
  const TASK_COLS = `id, room_id, seq, title, description, col, rank, priority, labels, checklist, assignee_actor_id,
    assignee_sub_agent_id, status, await_reason, fail_reason, attempts, thread_id, message_id, result_summary,
    created_by_actor_id, created_at, started_at, finished_at, updated_at, claimed_by_actor_id, claimed_by_sub_agent_id`;
  const q = {
    room: db.prepare('SELECT id, archived_at FROM rooms WHERE id=?'),
    inRoom: db.prepare('SELECT 1 FROM room_participants WHERE room_id=? AND actor_id=? LIMIT 1'),
    subLinked: db.prepare(`SELECT 1 FROM room_sub_agents rsa JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
      WHERE rsa.room_id=? AND sa.id=? AND sa.parent_actor_id=?`),
    aiParticipant: db.prepare(`SELECT 1 FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
      WHERE rp.room_id=? AND rp.actor_id=? AND a.type='ai'`),
    roomSubAgent: db.prepare(`SELECT sa.id, sa.parent_actor_id, sa.label FROM room_sub_agents rsa
      JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
      JOIN room_participants rp ON rp.room_id=rsa.room_id AND rp.actor_id=sa.parent_actor_id
      WHERE rsa.room_id=? AND sa.id=? AND sa.enabled=1`),
    owner: db.prepare("SELECT id FROM actors WHERE type='human' ORDER BY id LIMIT 1"),
    one: db.prepare(`SELECT ${TASK_COLS} FROM room_tasks WHERE id=? AND room_id=?`),
    ofRoom: db.prepare(`SELECT ${TASK_COLS} FROM room_tasks WHERE room_id=? ORDER BY CASE col
      WHEN 'awaiting' THEN 0 WHEN 'backlog' THEN 1 WHEN 'ongoing' THEN 2 ELSE 3 END, rank, id`),
    depsOfRoom: db.prepare(`SELECT d.task_id, d.depends_on_id FROM room_task_deps d
      JOIN room_tasks t ON t.id=d.task_id WHERE t.room_id=?`),
    depsOf: db.prepare(`SELECT d.depends_on_id AS id, t.col FROM room_task_deps d JOIN room_tasks t ON t.id=d.depends_on_id
      WHERE d.task_id=? ORDER BY d.depends_on_id`),
    dependents: db.prepare('SELECT task_id FROM room_task_deps WHERE depends_on_id=?'),
    // Same claim as runStart plus the dependency check the runner does before it (a card waiting on an
    // unfinished one is never started), in one statement so the runner and an agent cannot both take it.
    claim: db.prepare(`UPDATE room_tasks SET col='ongoing', status='running', started_at=datetime('now'), finished_at=NULL,
      thread_id=NULL, message_id=NULL, fail_reason=NULL, result_summary=NULL, claimed_by_actor_id=?, claimed_by_sub_agent_id=?,
      updated_at=datetime('now')
      WHERE id=? AND room_id=? AND col='backlog' AND status='idle' AND NOT EXISTS (SELECT 1 FROM room_task_deps d
        JOIN room_tasks x ON x.id=d.depends_on_id WHERE d.task_id=room_tasks.id AND x.col<>'finished')`),
    count: db.prepare('SELECT COUNT(*) AS c FROM room_tasks WHERE room_id=?'),
    nextSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM room_tasks WHERE room_id=?'),
    insert: db.prepare(`INSERT INTO room_tasks (room_id, seq, title, description, col, rank, priority, labels, checklist,
      assignee_actor_id, assignee_sub_agent_id, await_reason, created_by_actor_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    addDep: db.prepare('INSERT OR IGNORE INTO room_task_deps (task_id, depends_on_id) VALUES (?,?)'),
    delDep: db.prepare('DELETE FROM room_task_deps WHERE task_id=? AND depends_on_id=?'),
    remove: db.prepare('DELETE FROM room_tasks WHERE id=?'),
    groupRanks: (n) => db.prepare(`SELECT id, rank FROM room_tasks WHERE room_id=? AND col IN (${Array(n).fill('?').join(',')}) AND id<>? ORDER BY rank, id`),
    setRank: db.prepare('UPDATE room_tasks SET rank=? WHERE id=?'),
    insertEvent: db.prepare(`INSERT INTO room_task_events (task_id, room_id, kind, actor_id, actor_kind, body, meta)
      VALUES (?,?,?,?,?,?,?) RETURNING id, task_id, room_id, kind, actor_id, actor_kind, body, meta, at`),
    events: db.prepare(`SELECT id, task_id, room_id, kind, actor_id, actor_kind, body, meta, at FROM room_task_events
      WHERE task_id=? AND id < ? ORDER BY id DESC LIMIT ?`),
    counts: db.prepare(`SELECT
      COALESCE(SUM(status='running'), 0) AS running, COALESCE(SUM(col='awaiting'), 0) AS awaiting,
      COALESCE(SUM(col='backlog'), 0) AS backlog, COALESCE(SUM(col='finished'), 0) AS finished
      FROM room_tasks WHERE room_id=?`),
    settings: db.prepare('SELECT room_id, concurrency, running, last_error, completion_mode, updated_at FROM room_task_settings WHERE room_id=?'),
    upsertSettings: db.prepare(`INSERT INTO room_task_settings (room_id, concurrency, running, last_error, completion_mode, updated_at)
      VALUES (@room_id, @concurrency, @running, @last_error, @completion_mode, datetime('now'))
      ON CONFLICT(room_id) DO UPDATE SET concurrency=@concurrency, running=@running, last_error=@last_error,
        completion_mode=@completion_mode, updated_at=datetime('now')`),
    inThread: db.prepare(`SELECT 1 FROM messages m JOIN room_participants rp ON rp.id=m.participant_id
      WHERE m.thread_id=? AND m.room_id=? AND rp.actor_id=? AND (? IS NULL OR m.sub_agent_id=?) LIMIT 1`),
  };
  const idleReasons = new Map(); // roomId → 'blocked' | 'empty' | 'error' (runner stopped itself)
  let kickRunner = () => {};

  // ── Output ──
  function outTask(r, deps) {
    const labels = parseJson(r.labels, []);
    const checklist = parseJson(r.checklist, []);
    return {
      ...r,
      labels: Array.isArray(labels) ? labels : [],
      checklist: Array.isArray(checklist) ? checklist : [],
      blocked_by: deps.map(d => d.id),
      waiting_on: deps.filter(d => d.col !== 'finished').map(d => d.id),
    };
  }
  const taskOut = (taskId, roomId) => {
    const r = q.one.get(taskId, roomId);
    return r ? outTask(r, q.depsOf.all(r.id)) : null;
  };
  const outEvent = (e) => ({ ...e, meta: parseJson(e.meta, {}) });

  function settingsOut(roomId) {
    const s = q.settings.get(roomId);
    return {
      room_id: roomId,
      concurrency: s?.concurrency ?? 1,
      running: !!s?.running,
      last_error: s?.last_error ?? null,
      completion_mode: s?.completion_mode ?? 'quiet',
      idle_reason: idleReasons.get(roomId) ?? null,
      updated_at: s?.updated_at ?? null,
    };
  }
  const counts = (roomId) => q.counts.get(roomId);

  function writeSettings(roomId, patch) {
    const cur = settingsOut(roomId);
    const next = {
      room_id: roomId, concurrency: cur.concurrency, running: cur.running ? 1 : 0, last_error: cur.last_error,
      completion_mode: cur.completion_mode, ...patch,
    };
    q.upsertSettings.run(next);
    if (next.running) idleReasons.delete(roomId);
  }

  // ── Broadcast + events ──
  const pushTask = (roomId, taskId) => {
    const task = taskOut(taskId, roomId);
    if (task) broadcast(roomId, { type: 'task_upsert', room_id: roomId, task });
    return task;
  };
  const pushSettings = (roomId) => broadcast(roomId, { type: 'task_settings', room_id: roomId, settings: settingsOut(roomId), counts: counts(roomId) });

  function actorOf(who) {
    if (!who || who.actorId == null) return { actor_id: q.owner.get()?.id ?? null, actor_kind: 'human' };
    if (who.subAgentId != null) return { actor_id: who.actorId, actor_kind: 'sub_agent' };
    if (who.actorId === 'system') return { actor_id: null, actor_kind: 'system' };
    return { actor_id: who.actorId, actor_kind: 'agent' };
  }
  const SYSTEM = { actorId: 'system' };

  function addEvent(roomId, taskId, who, kind, body = null, meta = {}) {
    const a = actorOf(who);
    const m = who?.subAgentId != null ? { ...meta, sub_agent_id: who.subAgentId } : meta;
    const e = outEvent(q.insertEvent.get(taskId, roomId, kind, a.actor_id, a.actor_kind, body, JSON.stringify(m)));
    broadcast(roomId, { type: 'task_event', room_id: roomId, task_id: taskId, event: e });
    return e;
  }

  // ── Access ──
  // Room exists; an agent is a participant (a sub-agent: linked to the room, parent a participant).
  // Writes on an archived room → 423 for everyone; agents never read an archived room. `halt` (runner
  // pause / stop) is the exception: a runner left on when the room was archived must still be stoppable.
  function access(roomId, who, { write = false, halt = false } = {}) {
    const room = Number.isInteger(roomId) ? q.room.get(roomId) : null;
    if (!room) return fail(404, 'room not found');
    if (who?.actorId != null) {
      if (!q.inRoom.get(roomId, who.actorId)) return fail(403, 'agent_scope_denied');
      if (who.subAgentId != null && !q.subLinked.get(roomId, who.subAgentId, who.actorId)) return fail(403, 'agent_scope_denied');
      if (room.archived_at && !write) return fail(403, 'agent_scope_denied');
    }
    if (write && !halt && room.archived_at) return fail(423, 'room is archived');
    return null;
  }
  const isHuman = (who) => !who || who.actorId == null;

  // ── Rank helpers ──
  // Cards re-ranked by rebalance() during the current write. Clients order cards by the rank they
  // received, so each one is pushed as task_upsert once the write has committed (not before: a rollback
  // would have broadcast ranks that never existed).
  let rebalanced = null;
  function rebalance(roomId, col, excludeId) {
    if (!rebalanced) throw new Error('rebalance outside placing()');
    const rows = q.groupRanks(rankGroup(col).length).all(roomId, ...rankGroup(col), excludeId ?? 0);
    const keys = evenKeys(rows.length);
    rows.forEach((r, i) => {
      if (r.rank === keys[i]) return;
      q.setRank.run(keys[i], r.id);
      rebalanced?.add(r.id);
    });
  }
  // Runs a write that may place a card (placeRank), then pushes the cards a rebalance moved.
  function placing(roomId, write) {
    if (rebalanced) return write();
    rebalanced = new Set();
    let moved;
    try { const out = write(); moved = rebalanced; return out; }
    finally {
      rebalanced = null;
      if (moved) for (const id of moved) pushTask(roomId, id);
    }
  }
  // Rank for a card placed in `col`: before / after a neighbour of that column, or at the end (or the top).
  // → { rank } | { error }. Neighbours are read without the card itself.
  function placeRank(roomId, col, { beforeId = null, afterId = null, top = false } = {}, selfId = 0) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = db.prepare(`SELECT id, rank FROM room_tasks WHERE room_id=? AND col=? AND id<>? ORDER BY rank, id`).all(roomId, col, selfId);
      let lo = null, hi = null;
      if (beforeId || afterId) {
        const i = rows.findIndex(r => r.id === (beforeId || afterId));
        if (i < 0) return { error: `${beforeId ? 'before_id' : 'after_id'} is not a task in column ${col}` };
        if (beforeId) { hi = rows[i].rank; lo = i > 0 ? rows[i - 1].rank : null; }
        else { lo = rows[i].rank; hi = i + 1 < rows.length ? rows[i + 1].rank : null; }
      } else if (top) {
        hi = rows.length ? rows[0].rank : null;
      } else {
        lo = rows.length ? rows[rows.length - 1].rank : null;
      }
      // Backlog/Ongoing share ranks: an end placement goes past running cards too, so a card that comes
      // back from Ongoing can never land between two Backlog cards it was not between.
      if (!beforeId && !afterId && rankGroup(col).length > 1) {
        const other = db.prepare(`SELECT MIN(rank) AS mn, MAX(rank) AS mx FROM room_tasks WHERE room_id=? AND col IN ('backlog','ongoing') AND id<>?`).get(roomId, selfId);
        if (top) hi = other.mn ?? hi; else lo = other.mx ?? lo;
      }
      let rank = null;
      try { if (lo == null || hi == null || lo < hi) rank = keyBetween(lo, hi); } catch { rank = null; }
      if (rank && rank.length <= RANK_MAX_LEN) return { rank };
      rebalance(roomId, col, selfId);
    }
    return { error: 'could not place the task' };
  }

  // ── Validation shared by create / update ──
  function resolveAssignee(roomId, data, current) {
    if (data.assignee_actor_id !== undefined && data.assignee_sub_agent_id !== undefined) {
      return { error: 'send assignee_actor_id or assignee_sub_agent_id, not both' };
    }
    let actorId = current ? current.assignee_actor_id : null;
    let subId = current ? current.assignee_sub_agent_id : null;
    if (data.assignee_actor_id !== undefined) {
      if (data.assignee_actor_id !== null && !isPosInt(data.assignee_actor_id)) return { error: 'assignee_actor_id must be an actor id or null' };
      actorId = data.assignee_actor_id;
      subId = null;
    }
    if (data.assignee_sub_agent_id !== undefined) {
      if (data.assignee_sub_agent_id === null) subId = null;
      else {
        if (!isPosInt(data.assignee_sub_agent_id)) return { error: 'assignee_sub_agent_id must be a sub-agent id or null' };
        const sa = q.roomSubAgent.get(roomId, data.assignee_sub_agent_id);
        if (!sa) return { error: 'invalid_assignee: sub-agent is not linked to this room' };
        subId = sa.id;
        actorId = sa.parent_actor_id;
      }
    }
    if (actorId != null && !q.aiParticipant.get(roomId, actorId)) return { error: 'invalid_assignee: must be an AI agent in this room' };
    return { actorId, subId };
  }

  // Deps of taskId (null on create) → { ids } | { error }. Rejects self, unknown / other-room ids and cycles.
  function checkDeps(roomId, taskId, ids) {
    const inRoom = new Set(q.ofRoom.all(roomId).map(t => t.id));
    for (const d of ids) {
      if (d === taskId) return { error: 'a task cannot depend on itself' };
      if (!inRoom.has(d)) return { error: `blocked_by: task ${d} is not a task of this room` };
    }
    if (taskId == null) return { ids };
    const graph = new Map();
    for (const e of q.depsOfRoom.all(roomId)) {
      if (e.task_id === taskId) continue; // replaced by ids below
      if (!graph.has(e.task_id)) graph.set(e.task_id, []);
      graph.get(e.task_id).push(e.depends_on_id);
    }
    graph.set(taskId, ids);
    // A cycle through taskId exists iff taskId is reachable from one of its new deps.
    const seen = new Set();
    const stack = [...ids];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === taskId) return { error: 'blocked_by would create a dependency cycle' };
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...(graph.get(cur) || []));
    }
    return { ids };
  }

  // ── Queries ──
  function list(roomId, filters = {}) {
    const deps = new Map();
    const tasks = q.ofRoom.all(roomId);
    const colOf = new Map(tasks.map(t => [t.id, t.col]));
    for (const e of q.depsOfRoom.all(roomId)) {
      if (!deps.has(e.task_id)) deps.set(e.task_id, []);
      deps.get(e.task_id).push({ id: e.depends_on_id, col: colOf.get(e.depends_on_id) });
    }
    let out = tasks.map(t => outTask(t, (deps.get(t.id) || []).sort((a, b) => a.id - b.id)));
    if (filters.col) out = out.filter(t => t.col === filters.col);
    if (filters.status) out = out.filter(t => t.status === filters.status);
    if (filters.assignee !== undefined && filters.assignee !== null) {
      out = out.filter(t => (filters.assignee === 'none' ? t.assignee_actor_id === null : t.assignee_actor_id === Number(filters.assignee)));
    }
    if (filters.label) out = out.filter(t => t.labels.includes(filters.label));
    if (filters.q) {
      const needle = String(filters.q).toLowerCase();
      out = out.filter(t => t.title.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle) || `#${t.seq}` === needle);
    }
    return ok({ tasks: out, settings: settingsOut(roomId), counts: counts(roomId) });
  }

  function get(roomId, taskId, { before = null, limit = 50 } = {}) {
    const task = taskOut(taskId, roomId);
    if (!task) return fail(404, 'task not found');
    const lim = Math.min(Math.max(Number.isInteger(limit) ? limit : 50, 1), LIMITS.eventsPage);
    const rows = q.events.all(taskId, isPosInt(before) ? before : Number.MAX_SAFE_INTEGER, lim + 1);
    const hasMore = rows.length > lim;
    return ok({ ...task, events: rows.slice(0, lim).reverse().map(outEvent), has_more_events: hasMore });
  }

  // ── Mutations ──
  function create(roomId, who, data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(400, 'Invalid JSON');
    const title = cleanTitle(data.title);
    if (!title) return fail(400, `title required (1-${LIMITS.title} characters)`);
    const description = data.description === undefined ? '' : str(data.description);
    if (description === null || description.length > LIMITS.description) return fail(400, `description must be text up to ${LIMITS.description} characters`);
    const col = data.col === undefined ? 'backlog' : data.col;
    if (col !== 'backlog' && col !== 'awaiting') return fail(400, "col must be 'backlog' or 'awaiting'");
    const awaitReason = col === 'awaiting' ? cleanReason(data.await_reason ?? data.reason) : null;
    if (col === 'awaiting' && !awaitReason) return fail(400, `await_reason required for col 'awaiting' (1-${LIMITS.reason} characters)`);
    const priority = data.priority === undefined ? 'none' : data.priority;
    if (!PRIORITIES.includes(priority)) return fail(400, `priority must be one of ${PRIORITIES.join(', ')}`);
    const labels = data.labels === undefined ? [] : cleanLabels(data.labels);
    if (!labels) return fail(400, `labels: up to ${LIMITS.labels} strings of 1-${LIMITS.label} characters`);
    const checklist = data.checklist === undefined ? [] : cleanChecklist(data.checklist);
    if (!checklist) return fail(400, `checklist: up to ${LIMITS.checklist} items {text (1-${LIMITS.checkText}), done?}`);
    const asg = resolveAssignee(roomId, data, null);
    if (asg.error) return fail(400, asg.error);
    const depIds = data.blocked_by === undefined ? [] : cleanIdList(data.blocked_by);
    if (!depIds) return fail(400, `blocked_by: up to ${LIMITS.deps} task ids`);
    const depCheck = checkDeps(roomId, null, depIds);
    if (depCheck.error) return fail(400, depCheck.error);
    const creator = actorOf(who).actor_id;

    const id = placing(roomId, () => db.transaction(() => {
      if (q.count.get(roomId).c >= LIMITS.tasksPerRoom) return null;
      const placed = placeRank(roomId, col);
      if (placed.error) throw new Error(placed.error);
      const newId = Number(q.insert.run(roomId, q.nextSeq.get(roomId).s, title, description, col, placed.rank, priority,
        JSON.stringify(labels), JSON.stringify(checklist), asg.actorId, asg.subId, awaitReason, creator).lastInsertRowid);
      for (const d of depIds) q.addDep.run(newId, d);
      addEvent(roomId, newId, who, 'created', null, { to_col: col, ...(awaitReason ? { reason: awaitReason } : {}) });
      if (col === 'awaiting') addEvent(roomId, newId, who, 'awaiting', awaitReason, { to_col: col, reason: awaitReason });
      for (const d of depIds) addEvent(roomId, newId, who, 'dep_added', null, { depends_on_id: d });
      return newId;
    })());
    if (!id) return fail(409, 'task_limit', { limit: LIMITS.tasksPerRoom });
    const task = pushTask(roomId, id);
    pushSettings(roomId);
    if (col === 'backlog') kickRunner(roomId);
    return ok(task, 201);
  }

  function update(roomId, who, taskId, data) {
    const cur = q.one.get(taskId, roomId);
    if (!cur) return fail(404, 'task not found');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(400, 'Invalid JSON');
    const sets = [];
    const params = [];
    const fields = [];
    if (data.title !== undefined) {
      const title = cleanTitle(data.title);
      if (!title) return fail(400, `title required (1-${LIMITS.title} characters)`);
      sets.push('title=?'); params.push(title); fields.push('title');
    }
    if (data.description !== undefined) {
      const d = str(data.description);
      if (d === null || d.length > LIMITS.description) return fail(400, `description must be text up to ${LIMITS.description} characters`);
      sets.push('description=?'); params.push(d); fields.push('description');
    }
    if (data.priority !== undefined) {
      if (!PRIORITIES.includes(data.priority)) return fail(400, `priority must be one of ${PRIORITIES.join(', ')}`);
      sets.push('priority=?'); params.push(data.priority); fields.push('priority');
    }
    if (data.labels !== undefined) {
      const labels = cleanLabels(data.labels);
      if (!labels) return fail(400, `labels: up to ${LIMITS.labels} strings of 1-${LIMITS.label} characters`);
      sets.push('labels=?'); params.push(JSON.stringify(labels)); fields.push('labels');
    }
    if (data.checklist !== undefined) {
      const checklist = cleanChecklist(data.checklist);
      if (!checklist) return fail(400, `checklist: up to ${LIMITS.checklist} items {text (1-${LIMITS.checkText}), done?}`);
      sets.push('checklist=?'); params.push(JSON.stringify(checklist)); fields.push('checklist');
    }
    const assigneeChange = data.assignee_actor_id !== undefined || data.assignee_sub_agent_id !== undefined;
    if ((assigneeChange || data.blocked_by !== undefined) && cur.status === 'running') {
      return fail(409, 'task is running: assignee and blocked_by can change once it stops');
    }
    if (assigneeChange) {
      const asg = resolveAssignee(roomId, data, cur);
      if (asg.error) return fail(400, asg.error);
      sets.push('assignee_actor_id=?', 'assignee_sub_agent_id=?'); params.push(asg.actorId, asg.subId); fields.push('assignee');
    }
    let added = [], removed = [];
    if (data.blocked_by !== undefined) {
      const ids = cleanIdList(data.blocked_by);
      if (!ids) return fail(400, `blocked_by: up to ${LIMITS.deps} task ids`);
      const chk = checkDeps(roomId, taskId, ids);
      if (chk.error) return fail(400, chk.error);
      const before = q.depsOf.all(taskId).map(d => d.id);
      added = ids.filter(d => !before.includes(d));
      removed = before.filter(d => !ids.includes(d));
    }
    if (!sets.length && data.blocked_by === undefined) return fail(400, 'nothing to update');
    db.transaction(() => {
      if (sets.length) {
        db.prepare(`UPDATE room_tasks SET ${sets.join(', ')}, updated_at=datetime('now') WHERE id=?`).run(...params, taskId);
        addEvent(roomId, taskId, who, 'edited', null, { fields });
      } else if (added.length || removed.length) {
        db.prepare("UPDATE room_tasks SET updated_at=datetime('now') WHERE id=?").run(taskId);
      }
      for (const d of added) { q.addDep.run(taskId, d); addEvent(roomId, taskId, who, 'dep_added', null, { depends_on_id: d }); }
      for (const d of removed) { q.delDep.run(taskId, d); addEvent(roomId, taskId, who, 'dep_removed', null, { depends_on_id: d }); }
    })();
    const task = pushTask(roomId, taskId);
    if (removed.length || assigneeChange) kickRunner(roomId);
    return ok(task);
  }

  function remove(roomId, who, taskId) {
    const cur = q.one.get(taskId, roomId);
    if (!cur) return fail(404, 'task not found');
    if (cur.status === 'running') return fail(409, 'task is running: stop it first');
    const dependents = q.dependents.all(taskId).map(r => r.task_id);
    db.transaction(() => {
      // The dependents' logs keep the trace: the card and its own events go with it (CASCADE).
      for (const t of dependents) addEvent(roomId, t, who, 'dep_removed', null, { depends_on_id: taskId, seq: cur.seq, deleted: true });
      q.remove.run(taskId);
    })();
    broadcast(roomId, { type: 'task_delete', room_id: roomId, task_id: taskId });
    for (const t of dependents) pushTask(roomId, t);
    pushSettings(roomId);
    if (dependents.length) kickRunner(roomId);
    return { status: 204, body: null };
  }

  // Status a card gets when it lands in a column by hand.
  function statusFor(col, cur) {
    if (col === 'finished') return 'done';
    if (col === 'backlog' && cur.col === 'backlog') return cur.status; // reorder keeps failed
    return 'idle';
  }

  function move(roomId, who, taskId, data) {
    const cur = q.one.get(taskId, roomId);
    if (!cur) return fail(404, 'task not found');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(400, 'Invalid JSON');
    const col = data.col;
    if (!COLS.includes(col)) return fail(400, `col must be one of ${COLS.join(', ')}`);
    const beforeId = data.before_id ?? null;
    const afterId = data.after_id ?? null;
    if ((beforeId !== null && !isPosInt(beforeId)) || (afterId !== null && !isPosInt(afterId))) return fail(400, 'before_id / after_id must be task ids');
    if (beforeId && afterId) return fail(400, 'send before_id or after_id, not both');
    if (beforeId === taskId || afterId === taskId) return fail(400, 'a task cannot be placed next to itself');
    if (col === 'ongoing') {
      // The owner starts cards with Play; an agent starts one itself (owner decision 2026-11-12). Ongoing has
      // no order of its own (a running card keeps its Backlog rank), so a move within it is refused too.
      if (cur.col === 'ongoing') return fail(409, 'task is already in ongoing');
      if (isHuman(who)) return fail(409, 'the runner moves a task to ongoing: press Play');
      if (beforeId || afterId) return fail(400, 'a started task keeps its Backlog place: drop before_id / after_id');
      return claim(roomId, who, cur);
    }
    if (cur.status === 'running' && col !== cur.col) {
      // The agent working on the card may end its run by moving it; the owner uses Stop (unchanged).
      if (isHuman(who) || checkWorking(roomId, who, cur)) return fail(409, 'task is running: stop it first');
      if (col === 'finished') return complete(roomId, who, taskId, {});
      if (col === 'awaiting') return block(roomId, who, taskId, { reason: data.reason });
      if (cur.claimed_by_actor_id == null) {
        return fail(409, settingsOut(roomId).completion_mode === 'agent'
          ? 'a runner task ends with stoa__task_complete, stoa__task_fail or stoa__task_block'
          : 'a runner task ends with your reply, stoa__task_fail or stoa__task_block');
      }
      if (!runReturn(roomId, taskId, 'released by the agent', who)) return fail(409, 'task is not running');
      pushSettings(roomId);
      kickRunner(roomId);
      return ok(taskOut(taskId, roomId));
    }
    let reason = null;
    if (col === 'awaiting' && cur.col !== 'awaiting') {
      reason = cleanReason(data.reason);
      if (!reason) return fail(400, `reason required to move a task to awaiting (1-${LIMITS.reason} characters)`);
    }
    const status = statusFor(col, cur);
    const res = placing(roomId, () => db.transaction(() => {
      const placed = placeRank(roomId, col, { beforeId, afterId }, taskId);
      if (placed.error) return placed;
      const leavingAwait = cur.col === 'awaiting' && col !== 'awaiting';
      db.prepare(`UPDATE room_tasks SET col=?, rank=?, status=?, await_reason=?, fail_reason=?,
        finished_at=CASE WHEN ?=1 THEN COALESCE(finished_at, datetime('now')) ELSE NULL END, updated_at=datetime('now') WHERE id=?`)
        .run(col, placed.rank, status, reason ?? (leavingAwait ? null : cur.await_reason), status === 'failed' ? cur.fail_reason : null,
          col === 'finished' ? 1 : 0, taskId);
      const meta = { from_col: cur.col, to_col: col, ...(reason ? { reason } : {}) };
      const kind = col === 'awaiting' && cur.col !== 'awaiting' ? 'awaiting'
        : cur.col === 'awaiting' && col === 'backlog' ? 'confirmed' : 'moved';
      addEvent(roomId, taskId, who, kind, reason, meta);
      return placed;
    })());
    if (res.error) return fail(400, res.error);
    const task = pushTask(roomId, taskId);
    if (col !== cur.col) {
      // A card finishing (or leaving Finished) changes what its dependents wait on.
      for (const t of q.dependents.all(taskId)) pushTask(roomId, t.task_id);
      pushSettings(roomId);
    }
    kickRunner(roomId);
    return ok(task);
  }

  // Agent: only for the card it is working on. A runner run: it has a message in the card's run thread.
  // A card an agent started itself: it is the claimer (a parent agent also for its sub-agent's claim, as a
  // parent's messages count in a runner thread whichever sub-agent wrote them).
  // A runner run in completion_mode 'agent': the decision ends the run (no quiet-thread fallback), so only
  // the agent the card was given to may make it: the runner's target (assignee, else the primary agent)
  // itself, or the sub-agent the card is assigned to. Another agent or sub-agent that posted in the thread
  // (an @mention, a helper) is refused.
  function checkWorking(roomId, who, cur) {
    if (cur.status !== 'running') return fail(409, 'task is not running');
    if (isHuman(who)) return null;
    const sub = who.subAgentId ?? null;
    let working;
    if (cur.claimed_by_actor_id != null) {
      working = cur.claimed_by_actor_id === who.actorId && (sub === null || sub === cur.claimed_by_sub_agent_id);
    } else if (!cur.thread_id) {
      working = false;
    } else if (settingsOut(roomId).completion_mode === 'agent') {
      working = who.actorId === (cur.assignee_actor_id ?? primaryActorId(roomId)) && (sub === null || sub === cur.assignee_sub_agent_id);
    } else {
      working = !!q.inThread.get(cur.thread_id, roomId, who.actorId, sub, sub);
    }
    return working ? null : fail(403, 'only the agent working on this task can change its run state');
  }

  // An agent starts a Backlog card itself: Ongoing, running, no runner thread. It counts against the
  // runner's concurrency like any running card, but an agent is not capped by it (the owner's Stop ends it).
  function claim(roomId, who, cur) {
    if (cur.col !== 'backlog') return fail(409, 'only a Backlog task can be started');
    if (cur.status === 'failed') return fail(409, 'task failed: retry it first');
    if (cur.status !== 'idle') return fail(409, 'task is not idle');
    const waiting = q.depsOf.all(cur.id).filter(d => d.col !== 'finished');
    if (waiting.length) return fail(409, 'task is waiting on unfinished tasks', { waiting_on: waiting.map(d => d.id) });
    const claimed = db.transaction(() => {
      if (!q.claim.run(who.actorId, who.subAgentId ?? null, cur.id, roomId).changes) return false;
      addEvent(roomId, cur.id, who, 'claimed', null, { from_col: 'backlog', to_col: 'ongoing' });
      return true;
    })();
    if (!claimed) return fail(409, 'task was started by someone else');
    const task = pushTask(roomId, cur.id);
    pushSettings(roomId);
    return ok(task);
  }

  function complete(roomId, who, taskId, data = {}) {
    const cur = q.one.get(taskId, roomId);
    if (!cur) return fail(404, 'task not found');
    const denied = checkWorking(roomId, who, cur);
    if (denied) return denied;
    const summary = data?.summary == null ? null : str(data.summary);
    if (data?.summary != null && summary === null) return fail(400, 'summary must be text');
    const r = finishRun(roomId, taskId, { ok: true, summary: summary ? summary.slice(0, LIMITS.summary) : null }, who, cur.thread_id);
    // completion_mode 'agent': completing the card is the decision that the work is done, so its thread is
    // marked complete too (as the owner's button would; a later message reopens it as usual).
    if (r.status === 200 && cur.thread_id && cur.claimed_by_actor_id == null && settingsOut(roomId).completion_mode === 'agent') {
      try { completeThread(roomId, cur.thread_id, { fromTurn: !isHuman(who) }); } catch (e) { log.error(`[tasks] task ${taskId} thread complete error:`, e.message); }
    }
    return r;
  }

  function block(roomId, who, taskId, data = {}) {
    const cur = q.one.get(taskId, roomId);
    if (!cur) return fail(404, 'task not found');
    const reason = cleanReason(data?.reason);
    if (!reason) return fail(400, `reason required (1-${LIMITS.reason} characters)`);
    const denied = checkWorking(roomId, who, cur);
    if (denied) return denied;
    return blockRun(roomId, taskId, reason, who, cur.thread_id);
  }

  function failTask(roomId, who, taskId, data = {}) {
    const cur = q.one.get(taskId, roomId);
    if (!cur) return fail(404, 'task not found');
    const reason = cleanReason(data?.reason);
    if (!reason) return fail(400, `reason required (1-${LIMITS.reason} characters)`);
    const denied = checkWorking(roomId, who, cur);
    if (denied) return denied;
    return finishRun(roomId, taskId, { ok: false, reason }, who, cur.thread_id);
  }

  function retry(roomId, who, taskId) {
    const cur = q.one.get(taskId, roomId);
    if (!cur) return fail(404, 'task not found');
    if (cur.status !== 'failed') return fail(409, 'only a failed task can be retried');
    db.transaction(() => {
      db.prepare("UPDATE room_tasks SET status='idle', fail_reason=NULL, attempts=attempts+1, updated_at=datetime('now') WHERE id=?").run(taskId);
      addEvent(roomId, taskId, who, 'retry', null, { attempts: cur.attempts + 1 });
    })();
    const task = pushTask(roomId, taskId);
    kickRunner(roomId);
    return ok(task);
  }

  function comment(roomId, who, taskId, data) {
    if (!q.one.get(taskId, roomId)) return fail(404, 'task not found');
    const body = str(data?.body)?.trim();
    if (!body || body.length > LIMITS.comment) return fail(400, `body required (1-${LIMITS.comment} characters)`);
    return ok(addEvent(roomId, taskId, who, 'comment', body), 201);
  }

  function getSettings(roomId) {
    return ok({ settings: settingsOut(roomId), counts: counts(roomId) });
  }

  function updateSettings(roomId, who, data) {
    if (!isHuman(who)) return fail(403, 'only a human changes the runner');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(400, 'Invalid JSON');
    if (data.concurrency === undefined && data.completion_mode === undefined) return fail(400, 'nothing to update');
    if (data.concurrency !== undefined && (!Number.isInteger(data.concurrency) || data.concurrency < 1 || data.concurrency > 5)) {
      return fail(400, 'concurrency must be an integer 1-5');
    }
    if (data.completion_mode !== undefined && !COMPLETION_MODES.includes(data.completion_mode)) {
      return fail(400, `completion_mode must be one of ${COMPLETION_MODES.join(', ')}`);
    }
    const before = settingsOut(roomId).concurrency;
    const patch = {};
    if (data.concurrency !== undefined) patch.concurrency = data.concurrency;
    if (data.completion_mode !== undefined) patch.completion_mode = data.completion_mode;
    writeSettings(roomId, patch);
    pushSettings(roomId);
    if (data.concurrency > before) kickRunner(roomId);
    return ok(settingsOut(roomId));
  }

  // ── Run state (runner + complete / block / fail) ──
  const settled = (roomId, taskId) => {
    const task = pushTask(roomId, taskId);
    for (const t of q.dependents.all(taskId)) pushTask(roomId, t.task_id);
    pushSettings(roomId);
    kickRunner(roomId);
    return ok(task);
  };

  // Claims a Backlog card for a run → true when it was still idle in Backlog.
  function runStart(roomId, taskId) {
    return db.transaction(() => {
      const r = db.prepare(`UPDATE room_tasks SET col='ongoing', status='running', started_at=datetime('now'),
        finished_at=NULL, thread_id=NULL, message_id=NULL, fail_reason=NULL, result_summary=NULL,
        claimed_by_actor_id=NULL, claimed_by_sub_agent_id=NULL, updated_at=datetime('now')
        WHERE id=? AND room_id=? AND col='backlog' AND status='idle'`).run(taskId, roomId);
      if (!r.changes) return false;
      addEvent(roomId, taskId, SYSTEM, 'started', null, { from_col: 'backlog', to_col: 'ongoing' });
      return true;
    })();
  }
  function runAttach(roomId, taskId, messageId) {
    const r = db.prepare(`UPDATE room_tasks SET thread_id=?, message_id=?, updated_at=datetime('now')
      WHERE id=? AND room_id=? AND status='running' AND thread_id IS NULL`).run(messageId, messageId, taskId, roomId);
    if (r.changes) pushTask(roomId, taskId);
    return r.changes > 0;
  }
  // Ends a run. threadId pins it to that run (a stale completion of an earlier run is ignored).
  function finishRun(roomId, taskId, { ok: success, summary = null, reason = null }, who = SYSTEM, threadId = undefined) {
    const changed = placing(roomId, () => db.transaction(() => {
      const cur = q.one.get(taskId, roomId);
      if (!cur || cur.status !== 'running' || (threadId !== undefined && cur.thread_id !== threadId)) return false;
      if (success) {
        const placed = placeRank(roomId, 'finished', { top: true }, taskId);
        if (placed.error) throw new Error(placed.error);
        db.prepare(`UPDATE room_tasks SET col='finished', rank=?, status='done', finished_at=datetime('now'), result_summary=?,
          updated_at=datetime('now') WHERE id=?`).run(placed.rank, summary, taskId);
        addEvent(roomId, taskId, who, 'completed', summary, { from_col: 'ongoing', to_col: 'finished' });
      } else {
        db.prepare(`UPDATE room_tasks SET col='backlog', status='failed', fail_reason=?, updated_at=datetime('now') WHERE id=?`)
          .run(String(reason || 'failed').slice(0, LIMITS.reason), taskId);
        addEvent(roomId, taskId, who, 'failed', reason, { from_col: 'ongoing', to_col: 'backlog', reason });
      }
      return true;
    })());
    if (!changed) return fail(409, 'task is not running');
    return settled(roomId, taskId);
  }
  // Ends a run in Awaiting (blocked, the reason asks a human). Pinned like finishRun: the agent's
  // stoa__task_block and the runner's "agent did not decide" timeout cannot both land.
  function blockRun(roomId, taskId, reason, who = SYSTEM, threadId = undefined) {
    const changed = placing(roomId, () => db.transaction(() => {
      const cur = q.one.get(taskId, roomId);
      if (!cur || cur.status !== 'running' || (threadId !== undefined && cur.thread_id !== threadId)) return false;
      const placed = placeRank(roomId, 'awaiting', {}, taskId);
      if (placed.error) throw new Error(placed.error);
      db.prepare(`UPDATE room_tasks SET col='awaiting', rank=?, status='blocked', await_reason=?, updated_at=datetime('now') WHERE id=?`)
        .run(placed.rank, reason, taskId);
      addEvent(roomId, taskId, who, 'blocked', reason, { from_col: cur.col, to_col: 'awaiting', reason });
      return true;
    })());
    if (!changed) return fail(409, 'task is not running');
    return settled(roomId, taskId);
  }
  // Stop / startup reaper: back to Backlog where it was, idle.
  function runReturn(roomId, taskId, reason, who = SYSTEM) {
    const changed = db.transaction(() => {
      const r = db.prepare(`UPDATE room_tasks SET col='backlog', status='idle', updated_at=datetime('now')
        WHERE id=? AND room_id=? AND status='running'`).run(taskId, roomId);
      if (!r.changes) return false;
      addEvent(roomId, taskId, who, 'stopped', reason, { from_col: 'ongoing', to_col: 'backlog', reason });
      return true;
    })();
    if (changed) pushTask(roomId, taskId);
    return changed;
  }

  return {
    access, list, get, create, update, remove, move, complete, block, fail: failTask, retry, comment,
    getSettings, updateSettings,
    // runner side
    run: {
      start: runStart, attach: runAttach, finish: finishRun, block: blockRun, returnToBacklog: runReturn,
      settings: settingsOut, counts, writeSettings, pushSettings, pushTask, addEvent, isHuman,
      setIdleReason: (roomId, reason) => { if (reason) idleReasons.set(roomId, reason); else idleReasons.delete(roomId); },
      onKick: (fn) => { kickRunner = fn; },
      row: (taskId, roomId) => q.one.get(taskId, roomId),
      SYSTEM,
    },
  };
}

// ── Built-in MCP tools (served by lib/mcp-gateway.js as stoa__<name>) ──
// Room and caller come from the MCP token only, never from arguments, so a tool only reaches cards of
// the room the session belongs to. Runner controls (play / pause / stop / concurrency) are not tools:
// only the owner drives the runner.
const ID = { type: 'integer', minimum: 1, description: 'Task id (task_id, from stoa__task_list; not the #seq number)' };
const NEIGHBOUR = { type: 'integer', minimum: 1, description: 'Place the task directly above (before_id) or below (after_id) this task of the target column' };
const EDITABLE = {
  title: { type: 'string', minLength: 1, maxLength: LIMITS.title },
  description: { type: 'string', maxLength: LIMITS.description, description: 'Markdown' },
  priority: { type: 'string', enum: PRIORITIES },
  labels: { type: 'array', items: { type: 'string', minLength: 1, maxLength: LIMITS.label }, maxItems: LIMITS.labels },
  checklist: {
    type: 'array', maxItems: LIMITS.checklist,
    description: 'The whole list (replaces it). Keep each item id to keep the item.',
    items: { type: 'object', properties: { id: { type: 'integer', minimum: 1 }, text: { type: 'string', minLength: 1, maxLength: LIMITS.checkText }, done: { type: 'boolean' } }, required: ['text'], additionalProperties: false },
  },
  assignee_actor_id: { type: ['integer', 'null'], minimum: 1, description: 'AI agent of this room that runs it; null = the room\'s primary agent' },
  assignee_sub_agent_id: { type: ['integer', 'null'], minimum: 1, description: 'Sub-agent linked to this room that runs it (its parent becomes assignee_actor_id)' },
  blocked_by: { type: 'array', items: { type: 'integer', minimum: 1 }, maxItems: LIMITS.deps, description: 'Task ids that must be Finished before this one runs (replaces the list)' },
};

function taskMcpTools(core) {
  const asResult = (r) => ({
    content: [{ type: 'text', text: r.body == null ? JSON.stringify({ ok: true }) : JSON.stringify(r.body) }],
    ...(r.status >= 400 ? { isError: true } : {}),
  });
  const tool = (name, description, properties, required, write, fn) => ({
    name, description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations: write ? { readOnlyHint: false, destructiveHint: name === 'task_delete' } : { readOnlyHint: true },
    call: (ident, rawArgs) => {
      if (ident.roomId == null) return asResult(fail(400, 'this MCP session is not bound to a room'));
      const who = { actorId: ident.actorId, subAgentId: ident.subAgentId ?? null };
      const denied = core.access(ident.roomId, who, { write });
      if (denied) return asResult(denied);
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      if (required.includes('id') && !isPosInt(args.id)) return asResult(fail(400, 'id required'));
      return asResult(fn(ident.roomId, who, args));
    },
  });
  const without = (o, k) => { const { [k]: _, ...rest } = o; return rest; };
  return [
    tool('task_list', 'List the task board of this room (Awaiting | Backlog | Ongoing | Finished), with runner settings and counts.',
      { col: { type: 'string', enum: COLS }, status: { type: 'string', enum: ['idle', 'running', 'blocked', 'failed', 'done'] }, q: { type: 'string', maxLength: 200 } },
      [], false, (roomId, who, a) => core.list(roomId, { col: a.col, status: a.status, q: a.q })),
    tool('task_get', 'One task of this room with its log and comments (newest 50 events).', { id: ID }, ['id'], false,
      (roomId, who, a) => core.get(roomId, a.id)),
    tool('task_create', 'Add a task to this room\'s board: Backlog (default; the runner may start it) or Awaiting (needs an await_reason; waits for a human).',
      { ...EDITABLE, col: { type: 'string', enum: ['backlog', 'awaiting'] }, await_reason: { type: 'string', maxLength: LIMITS.reason } },
      ['title'], true, (roomId, who, a) => core.create(roomId, who, a)),
    tool('task_update', 'Change fields of a task of this room. Send only the fields to change. assignee / blocked_by cannot change while it runs.',
      { id: ID, ...EDITABLE }, ['id'], true, (roomId, who, a) => core.update(roomId, who, a.id, without(a, 'id'))),
    tool('task_move', 'Move or reorder a task. "awaiting" needs a reason (asks a human). "ongoing" starts an idle Backlog task yourself (its dependencies Finished; no thread is opened): then you work on it and end it with stoa__task_complete / _block / _fail, or move it back to "backlog" to release it. The task you are working on: "finished" = complete, "awaiting" = block (reason). Out of Awaiting = confirm it. Without before_id / after_id it goes to the end of the column.',
      { id: ID, col: { type: 'string', enum: COLS }, before_id: NEIGHBOUR, after_id: NEIGHBOUR, reason: { type: 'string', maxLength: LIMITS.reason } },
      ['id', 'col'], true, (roomId, who, a) => core.move(roomId, who, a.id, without(a, 'id'))),
    tool('task_comment', 'Add a comment to a task of this room.', { id: ID, body: { type: 'string', minLength: 1, maxLength: LIMITS.comment } },
      ['id', 'body'], true, (roomId, who, a) => core.comment(roomId, who, a.id, a)),
    tool('task_complete', 'Finish the task you are working on (moves it to Finished). Optional summary of the result. When the room\'s runner waits for your decision (the task message says so), this is the only way the task is Finished, and its thread is marked complete: call it once the work is really done, not while a background job still runs.',
      { id: ID, summary: { type: 'string', maxLength: LIMITS.summary } }, ['id'], true, (roomId, who, a) => core.complete(roomId, who, a.id, a)),
    tool('task_block', 'Stop the task you are working on because it needs a human decision: it moves to Awaiting with your reason.',
      { id: ID, reason: { type: 'string', minLength: 1, maxLength: LIMITS.reason } }, ['id', 'reason'], true, (roomId, who, a) => core.block(roomId, who, a.id, a)),
    tool('task_fail', 'Mark the task you are working on as failed, with the reason. It goes back to Backlog as failed until someone retries it.',
      { id: ID, reason: { type: 'string', minLength: 1, maxLength: LIMITS.reason } }, ['id', 'reason'], true, (roomId, who, a) => core.fail(roomId, who, a.id, a)),
    tool('task_retry', 'Retry a failed task of this room: it becomes idle again in its place in Backlog, attempts + 1. The runner can then start it, or you can with stoa__task_move to "ongoing".',
      { id: ID }, ['id'], true, (roomId, who, a) => core.retry(roomId, who, a.id)),
    tool('task_delete', 'Delete a task of this room (not while it runs). Tasks that depended on it lose that dependency.',
      { id: ID }, ['id'], true, (roomId, who, a) => core.remove(roomId, who, a.id)),
  ];
}

module.exports = { createRoomTasks, taskMcpTools, keyBetween, evenKeys, COLS, LIMITS };
