'use strict';
// Automations: the one implementation of list / create / update / delete, plus the agent view of
// connections. The HTTP routes (/api/automations…) and the built-in MCP tools (lib/stoa-mcp-tools.js)
// both call it, so trigger-condition validation, the room scope and the "· automation" room notice
// cannot drift between the two paths.
//
// agentId: null for the owner's session, else the calling agent. An agent only sees and changes
// automations that target a room it is in (same rule as scope 'automation' in lib/agent-scope.js),
// and every change it makes is announced in the target room. → { status, body }.

const ok = (body) => ({ status: 200, body });
const fail = (status, error) => ({ status, body: { error } });

function createAutomationCrud({ db, validateConditions, postNotice }) {
  const q = {
    all: db.prepare('SELECT * FROM automations ORDER BY id DESC'),
    ofAgent: db.prepare(`SELECT a.* FROM automations a WHERE EXISTS (SELECT 1 FROM room_participants rp
      WHERE rp.room_id=a.target_room_id AND rp.actor_id=?) ORDER BY a.id DESC`),
    one: db.prepare('SELECT * FROM automations WHERE id=?'),
    inRoom: db.prepare('SELECT 1 FROM room_participants WHERE room_id=? AND actor_id=? LIMIT 1'),
    owns: db.prepare(`SELECT 1 FROM automations a JOIN room_participants rp ON rp.room_id=a.target_room_id
      WHERE a.id=? AND rp.actor_id=? LIMIT 1`),
    connection: db.prepare('SELECT 1 FROM automation_connections WHERE id=?'),
    connectionsLite: db.prepare('SELECT id, name, provider, status FROM automation_connections ORDER BY id ASC'),
    insert: db.prepare(`INSERT INTO automations (name, trigger_type, trigger_event, trigger_conditions, target_room_id, prompt_template, connection_id, reply_mode, watch_reply)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    update: db.prepare(`UPDATE automations SET name=?, trigger_event=?, trigger_conditions=?, target_room_id=?, prompt_template=?, enabled=?, connection_id=?, reply_mode=?, watch_reply=? WHERE id=?`),
    remove: db.prepare('DELETE FROM automations WHERE id=?'),
  };
  const agentInRoom = (agentId, roomId) => !!q.inRoom.get(roomId, agentId);
  const str = (v) => (typeof v === 'string' ? v.trim() : null);

  // Agent gate for an existing automation: it must target one of the agent's rooms.
  function access(agentId, autoId) {
    if (agentId && !q.owns.get(autoId, agentId)) return fail(403, 'agent_scope_denied');
    return null;
  }

  function list(agentId) {
    return ok(agentId ? q.ofAgent.all(agentId) : q.all.all());
  }

  // Agents get id / name / provider / status only, never credentials.
  function connections() {
    return ok(q.connectionsLite.all());
  }

  function create(agentId, body) {
    if (!body?.name || !body?.trigger_event || !body?.target_room_id || !body?.prompt_template) return fail(400, 'Missing required fields');
    if (str(body.name) === null || str(body.prompt_template) === null) return fail(400, 'name and prompt_template must be strings');
    const rawConds = body.trigger_conditions || '[]';
    const condsErr = validateConditions(rawConds);
    if (condsErr) return fail(400, condsErr);
    if (agentId) {
      if (!agentInRoom(agentId, parseInt(body.target_room_id))) return fail(403, 'agent_scope_denied');
      if (body.connection_id != null && body.connection_id !== '' && !q.connection.get(parseInt(body.connection_id))) {
        return fail(400, 'connection not found');
      }
    }
    const trigType = body.trigger_type || 'slack';
    const watchReply = (trigType === 'slack' || trigType === 'email') ? (body.watch_reply ? 1 : 0) : 0;
    const result = q.insert.run(
      str(body.name),
      trigType,
      body.trigger_event,
      typeof rawConds === 'string' ? rawConds : JSON.stringify(rawConds),
      parseInt(body.target_room_id),
      str(body.prompt_template),
      parseInt(body.connection_id) || null,
      body.reply_mode || 'none',
      watchReply,
    );
    const row = q.one.get(result.lastInsertRowid);
    if (agentId) postNotice(agentId, row.target_room_id, 'created', row);
    return ok(row);
  }

  function update(agentId, autoId, body) {
    if (!body || typeof body !== 'object') return fail(400, 'Invalid JSON');
    const denied = access(agentId, autoId);
    if (denied) return denied;
    const auto = q.one.get(autoId);
    if (!auto) return fail(404, 'Not found');
    if ((body.name !== undefined && str(body.name) === null) || (body.prompt_template !== undefined && str(body.prompt_template) === null)) {
      return fail(400, 'name and prompt_template must be strings');
    }
    const name = body.name !== undefined ? str(body.name) : auto.name;
    const event = body.trigger_event !== undefined ? body.trigger_event : auto.trigger_event;
    const conds = body.trigger_conditions !== undefined ? body.trigger_conditions : auto.trigger_conditions;
    if (body.trigger_conditions !== undefined) {
      const condsErr = validateConditions(conds);
      if (condsErr) return fail(400, condsErr);
    }
    const roomId = body.target_room_id !== undefined ? parseInt(body.target_room_id) : auto.target_room_id;
    if (agentId && roomId !== auto.target_room_id && !agentInRoom(agentId, roomId)) return fail(403, 'agent_scope_denied');
    const prompt = body.prompt_template !== undefined ? str(body.prompt_template) : auto.prompt_template;
    const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : auto.enabled;
    const connId = body.connection_id !== undefined ? (parseInt(body.connection_id) || null) : auto.connection_id;
    if (agentId && connId && connId !== auto.connection_id && !q.connection.get(connId)) return fail(400, 'connection not found');
    const replyMode = body.reply_mode !== undefined ? (body.reply_mode || 'none') : (auto.reply_mode || 'none');
    const trigType = auto.trigger_type || 'slack';
    const watchReply = body.watch_reply !== undefined
      ? ((trigType === 'slack' || trigType === 'email') ? (body.watch_reply ? 1 : 0) : 0)
      : (auto.watch_reply || 0);
    q.update.run(name, event, typeof conds === 'string' ? conds : JSON.stringify(conds), roomId, prompt, enabled, connId, replyMode, watchReply, autoId);
    const updated = q.one.get(autoId);
    if (agentId) {
      postNotice(agentId, updated.target_room_id, 'updated', updated);
      if (updated.target_room_id !== auto.target_room_id) postNotice(agentId, auto.target_room_id, 'moved away', updated);
    }
    return ok(updated);
  }

  function remove(agentId, autoId) {
    const denied = access(agentId, autoId);
    if (denied) return denied;
    const auto = q.one.get(autoId);
    q.remove.run(autoId);
    if (agentId && auto) postNotice(agentId, auto.target_room_id, 'deleted', auto);
    return ok({ ok: true });
  }

  return { list, connections, create, update, remove };
}

module.exports = { createAutomationCrud };
