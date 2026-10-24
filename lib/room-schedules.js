'use strict';
// Scheduled triggers: the one implementation of list / create / update / delete / doctor on
// room_schedules. Both the HTTP routes (/api/rooms/:id/schedules…) and the built-in MCP tools
// (stoa__schedule_*) call it, so validation, the per-room cap, the room notice and the
// room_schedule_changed broadcast cannot drift between the two paths.
//
// Every operation is scoped to one room and takes the calling agent's actor id (null for the
// owner's session). → { status, body } with an HTTP status code; body.error on failure.

const { validateScheduleSpec, computeNextRun, describeSchedule, diagnoseSchedule } = require('./schedule');

const SCHEDULES_PER_ROOM = 20;
const TASK_MIN = 10;
const TASK_MAX = 4000;
const fmtUtc = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
const ok = (body) => ({ status: 200, body });
const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } });

// Same floor as the interactive trigger (R4) plus a ceiling: the task is posted verbatim.
function validTask(t) {
  if (typeof t !== 'string') return null;
  const task = t.trim();
  if (task.length < TASK_MIN || task.length > TASK_MAX || /^(test|todo|tbd|placeholder|\.+)$/i.test(task)) return null;
  return task;
}
const parseEnabled = (v) => (v === true || v === 1) ? 1 : (v === false || v === 0) ? 0 : null;

function createRoomSchedules({ db, broadcast, now = () => new Date(), limit = SCHEDULES_PER_ROOM }) {
  const SELECT = `
    SELECT s.id, s.room_id, s.target_actor_id, t.name AS target_name,
           s.created_by_actor_id, c.name AS created_by_name, c.type AS created_by_type,
           s.task, s.schedule_spec, s.enabled, s.next_run_at, s.last_run_at, s.last_error, s.run_count, s.created_at
    FROM room_schedules s JOIN actors t ON t.id=s.target_actor_id JOIN actors c ON c.id=s.created_by_actor_id`;
  const q = {
    room: db.prepare('SELECT id FROM rooms WHERE id=?'),
    inRoom: db.prepare('SELECT 1 FROM room_participants WHERE room_id=? AND actor_id=? LIMIT 1'),
    aiParticipant: db.prepare(`SELECT 1 FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
      WHERE rp.room_id=? AND rp.actor_id=? AND a.type='ai'`),
    one: db.prepare(`${SELECT} WHERE s.id=? AND s.room_id=?`),
    ofRoom: db.prepare(`${SELECT} WHERE s.room_id=? ORDER BY s.id`),
    raw: db.prepare('SELECT * FROM room_schedules WHERE id=? AND room_id=?'),
    count: db.prepare('SELECT COUNT(*) AS c FROM room_schedules WHERE room_id=?'),
    insert: db.prepare(`INSERT INTO room_schedules (room_id, target_actor_id, created_by_actor_id, task, schedule_spec, enabled, next_run_at)
      VALUES (?,?,?,?,?,?,?)`),
    remove: db.prepare('DELETE FROM room_schedules WHERE id=?'),
    owner: db.prepare("SELECT id FROM actors WHERE type='human' LIMIT 1"),
    doctor: db.prepare(`
      SELECT s.id, s.target_actor_id, s.enabled, s.next_run_at, s.last_error,
             EXISTS (SELECT 1 FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
                     WHERE rp.room_id=s.room_id AND rp.actor_id=s.target_actor_id AND a.type='ai') AS is_participant
      FROM room_schedules s WHERE s.room_id=? ORDER BY s.id`),
    noticeAuthor: db.prepare(`SELECT rp.id, a.name FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
      WHERE rp.room_id=? AND rp.actor_id=? LIMIT 1`),
    insertNotice: db.prepare("INSERT INTO messages (room_id, participant_id, content, state) VALUES (?,?,?,'system_event')"),
  };

  const outRow = (r) => {
    if (!r) return null;
    try { r.schedule_spec = JSON.parse(r.schedule_spec); } catch { r.schedule_spec = null; }
    return r;
  };
  const isAiParticipant = (roomId, actorId) => !!q.aiParticipant.get(roomId, actorId);

  // An agent-made schedule fires tasks in the room, so the owner sees every create/update/delete.
  // Suffix " · schedule" keeps it in the history filters.
  function postNotice(agentId, roomId, verb, sched) {
    const part = q.noticeAuthor.get(roomId, agentId);
    if (!part || !sched) return;
    const clean = (v, max) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);
    const content = `${clean(part.name, 64)} ${verb} schedule #${sched.id} for ${clean(sched.target_name, 64)} (${clean(describeSchedule(sched.schedule_spec), 80)}) · schedule`;
    const r = q.insertNotice.run(roomId, part.id, content);
    broadcast(roomId, { type: 'message_new', message: { id: Number(r.lastInsertRowid), room_id: roomId, content, state: 'system_event', created_at: now().toISOString() } });
  }

  function changed(agentId, roomId, verb, row) {
    broadcast(roomId, { type: 'room_schedule_changed', room_id: roomId });
    if (agentId) postNotice(agentId, roomId, verb, row);
  }

  // Gate shared by both paths: the room exists and an agent caller is one of its participants.
  // → null when allowed, else a failure result.
  function access(roomId, agentId) {
    if (!Number.isInteger(roomId) || !q.room.get(roomId)) return fail(404, 'room not found');
    if (agentId && !q.inRoom.get(roomId, agentId)) return fail(403, 'agent_scope_denied');
    return null;
  }

  function list(roomId) {
    return ok({ schedules: q.ofRoom.all(roomId).map(outRow) });
  }

  function doctor(roomId) {
    const nowMs = now().getTime();
    return ok({ room_id: roomId, diagnoses: q.doctor.all(roomId).map(s => ({ schedule_id: s.id, ...diagnoseSchedule(s, nowMs) })) });
  }

  function create(roomId, agentId, data) {
    if (!data || typeof data !== 'object') return fail(400, 'Invalid JSON');
    const targetId = Number(data.target_actor_id);
    if (!Number.isInteger(targetId) || targetId <= 0) return fail(400, 'target_actor_id required');
    if (!isAiParticipant(roomId, targetId)) return fail(400, 'invalid_target: must be an AI agent in this room');
    const task = validTask(data.task);
    if (!task) return fail(400, 'invalid_task');
    const specRes = validateScheduleSpec(data.schedule_spec);
    if (!specRes.ok) return fail(400, `invalid_schedule: ${specRes.error}`);
    const enabled = data.enabled === undefined ? 1 : parseEnabled(data.enabled);
    if (enabled === null) return fail(400, 'enabled must be a boolean');
    const creatorId = agentId || q.owner.get()?.id;
    if (!creatorId) return fail(500, 'no human actor');
    const nextRun = enabled ? fmtUtc(computeNextRun(specRes.spec, now())) : null;
    // Cap check and insert in one transaction so two concurrent creates can't both pass the count.
    const newId = db.transaction(() => {
      if (q.count.get(roomId).c >= limit) return null;
      return q.insert.run(roomId, targetId, creatorId, task, JSON.stringify(specRes.spec), enabled, nextRun).lastInsertRowid;
    })();
    if (!newId) return fail(400, 'schedule_limit', { limit });
    const row = outRow(q.one.get(newId, roomId));
    changed(agentId, roomId, 'created', row);
    return ok({ ok: true, schedule: row });
  }

  function update(roomId, agentId, schedId, data) {
    const existing = q.raw.get(schedId, roomId);
    if (!existing) return fail(404, 'schedule not found');
    if (!data || typeof data !== 'object') return fail(400, 'Invalid JSON');
    const updates = [];
    const params = [];
    let spec = null;
    try { spec = JSON.parse(existing.schedule_spec); } catch {}
    if (data.target_actor_id !== undefined) {
      const targetId = Number(data.target_actor_id);
      if (!Number.isInteger(targetId) || targetId <= 0 || !isAiParticipant(roomId, targetId)) {
        return fail(400, 'invalid_target: must be an AI agent in this room');
      }
      updates.push('target_actor_id=?'); params.push(targetId);
    }
    if (data.task !== undefined) {
      const task = validTask(data.task);
      if (!task) return fail(400, 'invalid_task');
      updates.push('task=?'); params.push(task);
    }
    if (data.schedule_spec !== undefined) {
      const specRes = validateScheduleSpec(data.schedule_spec);
      if (!specRes.ok) return fail(400, `invalid_schedule: ${specRes.error}`);
      spec = specRes.spec;
      updates.push('schedule_spec=?'); params.push(JSON.stringify(spec));
    }
    let enabled = existing.enabled;
    if (data.enabled !== undefined) {
      enabled = parseEnabled(data.enabled);
      if (enabled === null) return fail(400, 'enabled must be a boolean');
      updates.push('enabled=?'); params.push(enabled);
    }
    // Recompute next_run_at when the spec changed or the schedule is (re)enabled;
    // clear it when disabled so the loop skips it.
    if (enabled && (data.schedule_spec !== undefined || !existing.enabled)) {
      const specRes = validateScheduleSpec(spec);
      if (!specRes.ok) return fail(400, 'invalid_schedule: stored spec is invalid — send schedule_spec');
      updates.push('next_run_at=?', 'last_error=NULL'); params.push(fmtUtc(computeNextRun(specRes.spec, now())));
    } else if (!enabled) {
      updates.push('next_run_at=NULL');
    }
    if (!updates.length) return fail(400, 'nothing to update');
    params.push(schedId);
    db.prepare(`UPDATE room_schedules SET ${updates.join(', ')} WHERE id=?`).run(...params);
    const row = outRow(q.one.get(schedId, roomId));
    changed(agentId, roomId, 'updated', row);
    return ok({ ok: true, schedule: row });
  }

  function remove(roomId, agentId, schedId) {
    const row = outRow(q.one.get(schedId, roomId));
    if (!row) return fail(404, 'schedule not found');
    q.remove.run(schedId);
    changed(agentId, roomId, 'deleted', row);
    return ok({ ok: true });
  }

  return { access, list, doctor, create, update, remove, limit };
}

// ── Built-in MCP tools (served by lib/mcp-gateway.js as stoa__<name>) ──
// Room and caller come from the MCP token only, never from arguments, so a tool can only touch
// schedules of the room the agent's session belongs to.
const SPEC_SCHEMA = {
  type: 'object',
  description: 'When it runs. One of: '
    + '{"type":"interval","every_minutes":5..1440} | '
    + '{"type":"daily","at":"HH:MM","tz":"Asia/Jakarta"} | '
    + '{"type":"weekly","at":"HH:MM","tz":"…","days":[0..6]} (0 = Sunday) | '
    + '{"type":"monthly","at":"HH:MM","tz":"…","day":1..31} (clamped to the month\'s last day) | '
    + '{"type":"yearly","at":"HH:MM","tz":"…","month":1..12,"day":1..31} (Feb 29 runs Feb 28 in non-leap years). '
    + '"at" is 24h wall-clock time in "tz", an IANA time zone name (default "UTC").',
  properties: {
    type: { type: 'string', enum: ['interval', 'daily', 'weekly', 'monthly', 'yearly'] },
    every_minutes: { type: 'integer', minimum: 5, maximum: 1440 },
    at: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
    tz: { type: 'string', description: 'IANA time zone, e.g. "Asia/Jakarta"' },
    days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, minItems: 1, maxItems: 7 },
    day: { type: 'integer', minimum: 1, maximum: 31 },
    month: { type: 'integer', minimum: 1, maximum: 12 },
  },
  required: ['type'],
};
const TASK_SCHEMA = {
  type: 'string', minLength: TASK_MIN, maxLength: TASK_MAX,
  description: 'Instruction posted into the room when the schedule fires. "@label" in it also runs that sub-agent.',
};
const ID_SCHEMA = { type: 'integer', minimum: 1, description: 'Schedule id (from stoa__schedule_list)' };
const TARGET_SCHEMA = { type: 'integer', minimum: 1, description: 'Actor id of the AI agent in this room that runs the task' };

function scheduleMcpTools(core) {
  const asResult = (r) => ({ content: [{ type: 'text', text: JSON.stringify(r.body) }], ...(r.status >= 400 ? { isError: true } : {}) });
  // ident.roomId null = a session outside any room (no schedules to act on).
  const inRoom = (fn) => (ident, args) => {
    if (ident.roomId == null) return asResult(fail(400, 'this MCP session is not bound to a room'));
    const denied = core.access(ident.roomId, ident.actorId);
    if (denied) return asResult(denied);
    return asResult(fn(ident, args && typeof args === 'object' ? args : {}));
  };
  const idArg = (args) => (Number.isInteger(args.schedule_id) && args.schedule_id > 0 ? args.schedule_id : null);
  const withId = (fn) => (ident, args) => {
    const id = idArg(args);
    return id ? fn(ident, args, id) : fail(400, 'schedule_id required');
  };
  return [
    {
      name: 'schedule_list',
      description: 'List the scheduled triggers of the room this session belongs to.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      call: inRoom((ident) => core.list(ident.roomId)),
    },
    {
      name: 'schedule_create',
      description: `Create a scheduled trigger in this room: at each run, "task" is posted to the target agent like an owner message. Max ${core.limit} schedules per room. The room sees a notice for every change you make.`,
      inputSchema: {
        type: 'object',
        properties: { task: TASK_SCHEMA, schedule_spec: SPEC_SCHEMA, target_actor_id: { ...TARGET_SCHEMA, description: `${TARGET_SCHEMA.description}; defaults to you` }, enabled: { type: 'boolean' } },
        required: ['task', 'schedule_spec'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      call: inRoom((ident, args) => core.create(ident.roomId, ident.actorId, {
        ...args, target_actor_id: args.target_actor_id === undefined ? ident.actorId : args.target_actor_id,
      })),
    },
    {
      name: 'schedule_update',
      description: 'Change a schedule of this room. Send only the fields to change; enabled:false pauses it.',
      inputSchema: {
        type: 'object',
        properties: { schedule_id: ID_SCHEMA, task: TASK_SCHEMA, schedule_spec: SPEC_SCHEMA, target_actor_id: TARGET_SCHEMA, enabled: { type: 'boolean' } },
        required: ['schedule_id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      call: inRoom(withId((ident, args, id) => {
        const { schedule_id, ...data } = args;
        return core.update(ident.roomId, ident.actorId, id, data);
      })),
    },
    {
      name: 'schedule_delete',
      description: 'Delete a schedule of this room.',
      inputSchema: { type: 'object', properties: { schedule_id: ID_SCHEMA }, required: ['schedule_id'], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: true },
      call: inRoom(withId((ident, args, id) => core.remove(ident.roomId, ident.actorId, id))),
    },
    {
      name: 'schedule_doctor',
      description: 'Health check of every schedule in this room: ok | error (last run failed or was skipped) | overdue | not_participant (target left the room).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      call: inRoom((ident) => core.doctor(ident.roomId)),
    },
  ];
}

module.exports = { createRoomSchedules, scheduleMcpTools, SCHEDULES_PER_ROOM };
