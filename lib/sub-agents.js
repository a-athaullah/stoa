'use strict';
// Sub-agent definitions: the one implementation of list / create / update / delete / link-to-room /
// trigger. The HTTP routes (/api/actors/:id/sub-agents, /api/sub-agents/:id, /api/rooms/:id/sub-agents,
// /api/rooms/:id/sub-agent-trigger) and the built-in MCP tools (lib/stoa-mcp-tools.js) both call it,
// so label / tier / harness / model validation cannot drift between the two paths.
//
// update / remove take parentActorId: null for the owner's session, else the calling agent — a row of
// another parent then resolves as "not found". → { status, body }.

const SUB_AGENT_DESCRIPTION_MAX = 500;
const SUB_AGENT_ROLE_MAX = 40;
const LABEL_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,29}$/;
const TIERS = ['quick', 'standard', 'deep'];
// Agents can create sub-agents themselves (stoa__sub_agent_create), so the count per parent is capped.
const SUB_AGENTS_PER_ACTOR = 30;
const UPDATABLE = ['label', 'tier', 'model', 'workdir', 'system_prompt', 'enabled', 'harness', 'avatar_color', 'avatar_symbol', 'description', 'role'];
const TASK_MIN = 10;
const ok = (body, status = 200) => ({ status, body });
const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } });

// Returns { value } (trimmed string or null) or { error } for an optional sub-agent text field.
function normalizeSubAgentText(v, field, max, { singleLine = false } = {}) {
  if (v === null) return { value: null };
  if (typeof v !== 'string') return { error: `${field} must be a string or null` };
  const t = v.trim();
  if (t.length > max) return { error: `${field} must be at most ${max} characters` };
  if (singleLine && /[\u0000-\u001f\u007f]/.test(t)) return { error: `${field} must be a single line without control characters` };
  return { value: t || null };
}
const normalizeSubAgentDescription = v => normalizeSubAgentText(v, 'description', SUB_AGENT_DESCRIPTION_MAX);
const normalizeSubAgentRole = v => normalizeSubAgentText(v, 'role', SUB_AGENT_ROLE_MAX, { singleLine: true });

// R4: reject empty / placeholder / too-short tasks.
function validTask(t) {
  const task = typeof t === 'string' ? t.trim() : '';
  if (task.length < TASK_MIN || /^(test|todo|tbd|placeholder|\.+)$/i.test(task)) return null;
  return task;
}

function createSubAgents({ db, broadcast, getHarnessModels, deleteAvatarFile, onDeleted, resolveThread, isAgentOnline, runSubAgent, limit = SUB_AGENTS_PER_ACTOR }) {
  const q = {
    aiActor: db.prepare("SELECT id FROM actors WHERE id=? AND type='ai'"),
    adapter: db.prepare('SELECT adapter FROM actors WHERE id=?'),
    ofParent: db.prepare('SELECT * FROM sub_agents WHERE parent_actor_id=? ORDER BY label'),
    countOfParent: db.prepare('SELECT COUNT(*) AS c FROM sub_agents WHERE parent_actor_id=?'),
    one: db.prepare('SELECT * FROM sub_agents WHERE id=?'),
    harnesses: db.prepare('SELECT name FROM harnesses'),
    nameCollision: db.prepare('SELECT 1 FROM actors WHERE LOWER(name)=LOWER(?)'),
    insert: db.prepare('INSERT INTO sub_agents (parent_actor_id, label, tier, model, workdir, system_prompt, harness, description, role) VALUES (?,?,?,?,?,?,?,?,?)'),
    linkedRooms: db.prepare('SELECT room_id FROM room_sub_agents WHERE sub_agent_id=?'),
    deleteMemory: db.prepare('DELETE FROM sub_agent_memory WHERE sub_agent_id=?'),
    remove: db.prepare('DELETE FROM sub_agents WHERE id=?'),
    room: db.prepare('SELECT id FROM rooms WHERE id=?'),
    inRoom: db.prepare('SELECT 1 FROM room_participants WHERE room_id=? AND actor_id=?'),
    labelCollision: db.prepare(`
      SELECT sa2.label, a.name AS parent_name FROM room_sub_agents rsa
      JOIN sub_agents sa2 ON sa2.id=rsa.sub_agent_id
      JOIN actors a ON a.id=sa2.parent_actor_id
      WHERE rsa.room_id=? AND sa2.label=? AND sa2.parent_actor_id!=?`),
    link: db.prepare('INSERT OR IGNORE INTO room_sub_agents (room_id, sub_agent_id) VALUES (?,?)'),
    triggerRoom: db.prepare('SELECT id, archived_at, spawns_paused, max_sub_agents, max_spawns_per_hour FROM rooms WHERE id=?'),
    participant: db.prepare('SELECT id FROM room_participants WHERE room_id=? AND actor_id=?'),
    linkedById: db.prepare(`SELECT sa.* FROM room_sub_agents rsa JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
      WHERE rsa.room_id=? AND sa.id=? AND sa.enabled=1`),
    linkedByLabel: db.prepare(`SELECT sa.* FROM room_sub_agents rsa JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
      WHERE rsa.room_id=? AND sa.label=? AND sa.enabled=1`),
    running: db.prepare("SELECT COUNT(*) AS c FROM messages WHERE room_id=? AND sub_agent_id IS NOT NULL AND state='streaming'"),
    lastHour: db.prepare("SELECT COUNT(*) AS c FROM messages WHERE room_id=? AND parent_message_id IS NOT NULL AND created_at >= datetime('now','-1 hour')"),
    orchMsg: db.prepare('SELECT id FROM messages WHERE participant_id=? AND room_id=? ORDER BY id DESC LIMIT 1'),
    parentAi: db.prepare(`SELECT rp.id as participant_id, a.id as actor_id, a.name, a.adapter, a.adapter_config, a.avatar_color, a.avatar_symbol, a.avatar_url
      FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.id=?`),
  };
  const parentAdapter = (actorId) => q.adapter.get(actorId)?.adapter || 'claude';
  const harnessError = (h) => {
    const valid = q.harnesses.all().map(r => r.name);
    return valid.includes(h) ? null : fail(400, `harness must be one of: ${valid.join(', ')} (or null to inherit)`);
  };
  const modelError = (actorId, harness, model) => {
    const effH = harness || parentAdapter(actorId);
    const hModels = getHarnessModels(actorId, effH);
    if (hModels.length && !new Set(hModels.map(m => m.model_id)).has(model)) return fail(400, `model "${model}" not available for harness ${effH}`);
    return null;
  };
  // A row the caller may touch: any row for the owner, only its own for an agent.
  const owned = (id, parentActorId) => {
    const sa = q.one.get(id);
    return sa && (parentActorId == null || sa.parent_actor_id === parentActorId) ? sa : null;
  };

  function list(actorId) {
    const adapter = parentAdapter(actorId);
    return ok(q.ofParent.all(actorId).map(r => ({ ...r, effective_harness: r.harness || adapter })));
  }

  function create(actorId, data) {
    if (!q.aiActor.get(actorId)) return fail(404, 'AI actor not found');
    if (!data || typeof data !== 'object') return fail(400, 'Invalid JSON');
    const { label, tier, model, workdir, system_prompt, harness } = data;
    let description = null;
    if (data.description !== undefined) {
      const d = normalizeSubAgentDescription(data.description);
      if (d.error) return fail(400, d.error);
      description = d.value;
    }
    let role = null;
    if (data.role !== undefined) {
      const r = normalizeSubAgentRole(data.role);
      if (r.error) return fail(400, r.error);
      role = r.value;
    }
    if (typeof label !== 'string' || !label.trim()) return fail(400, 'label required');
    if (!LABEL_RE.test(label.trim())) return fail(400, 'label must start with a letter, 1-30 chars, alphanumeric/dash/underscore');
    if (tier && !TIERS.includes(tier)) return fail(400, 'tier must be quick, standard, or deep');
    if (harness !== undefined && harness !== null) {
      const bad = harnessError(harness);
      if (bad) return bad;
    }
    if (q.nameCollision.get(label.trim())) return fail(409, `label "${label.trim()}" conflicts with an existing actor name`);
    if (model) {
      const bad = modelError(actorId, harness, model);
      if (bad) return bad;
    }
    try {
      // Cap check and insert in one transaction so two concurrent creates can't both pass the count.
      const newId = db.transaction(() => {
        if (q.countOfParent.get(actorId).c >= limit) return null;
        return q.insert.run(actorId, label.trim(), tier || 'quick', model || null, workdir || null, system_prompt || null, harness || null, description, role).lastInsertRowid;
      })();
      if (!newId) return fail(409, `sub-agent limit reached: max ${limit} sub-agents per agent`, { limit });
      return ok(q.one.get(newId), 201);
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(409, `label "${label.trim()}" already exists for this agent`);
      throw e;
    }
  }

  function update(id, data, { parentActorId = null } = {}) {
    const sa = owned(id, parentActorId);
    if (!sa) return fail(404, 'sub-agent not found');
    if (!data || typeof data !== 'object') return fail(400, 'Invalid JSON');
    const updates = [];
    const params = [];
    for (const key of UPDATABLE) {
      if (data[key] === undefined) continue;
      if (key === 'label') {
        if (typeof data.label !== 'string' || !data.label.trim()) return fail(400, 'label required');
        if (!LABEL_RE.test(data.label.trim())) return fail(400, 'invalid label format');
        if (q.nameCollision.get(data.label.trim())) return fail(409, 'label conflicts with actor name');
        updates.push('label=?'); params.push(data.label.trim());
      } else if (key === 'tier') {
        if (!TIERS.includes(data.tier)) return fail(400, 'invalid tier');
        updates.push('tier=?'); params.push(data.tier);
      } else if (key === 'enabled') {
        updates.push('enabled=?'); params.push(data.enabled ? 1 : 0);
      } else if (key === 'harness') {
        if (data.harness !== null) {
          const bad = harnessError(data.harness);
          if (bad) return bad;
        }
        updates.push('harness=?'); params.push(data.harness ?? null);
      } else if (key === 'description') {
        const d = normalizeSubAgentDescription(data.description);
        if (d.error) return fail(400, d.error);
        updates.push('description=?'); params.push(d.value);
      } else if (key === 'role') {
        const r = normalizeSubAgentRole(data.role);
        if (r.error) return fail(400, r.error);
        updates.push('role=?'); params.push(r.value);
      } else if (key === 'avatar_color') {
        if (data.avatar_color !== null && !/^#[0-9a-fA-F]{6}$/.test(data.avatar_color)) return fail(400, 'avatar_color must be null or #RRGGBB');
        updates.push('avatar_color=?'); params.push(data.avatar_color ?? null);
      } else if (key === 'avatar_symbol') {
        if (data.avatar_symbol !== null) {
          const sym = String(data.avatar_symbol).trim();
          if (sym.length < 1 || sym.length > 4 || /[<>]/.test(sym)) return fail(400, 'avatar_symbol must be 1-4 chars, no <>');
          updates.push('avatar_symbol=?'); params.push(sym);
        } else {
          updates.push('avatar_symbol=?'); params.push(null);
        }
      } else {
        updates.push(`${key}=?`); params.push(data[key] ?? null);
      }
    }
    if (!updates.length) return fail(400, 'no fields to update');
    const newModel = data.model !== undefined ? (data.model ?? null) : sa.model;
    if (newModel) {
      const bad = modelError(sa.parent_actor_id, data.harness !== undefined ? (data.harness ?? null) : sa.harness, newModel);
      if (bad) return bad;
    }
    params.push(id);
    try {
      db.prepare(`UPDATE sub_agents SET ${updates.join(', ')} WHERE id=?`).run(...params);
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(409, 'label already exists for this agent');
      throw e;
    }
    const row = q.one.get(id);
    for (const r of q.linkedRooms.all(id)) broadcast(r.room_id, { type: 'sub_agent_updated', sub_agent: row });
    return ok(row);
  }

  // → { status: 204 } on success (the HTTP route answers with no body). Missing rows are a no-op for
  // the owner (idempotent DELETE, as before) but "not found" for an agent.
  function remove(id, { parentActorId = null } = {}) {
    const sa = owned(id, parentActorId);
    if (!sa) return parentActorId == null ? ok(null, 204) : fail(404, 'sub-agent not found');
    const rooms = q.linkedRooms.all(id);
    if (sa.avatar_url) deleteAvatarFile(sa.avatar_url);
    q.deleteMemory.run(id);
    onDeleted(id);
    q.remove.run(id);
    for (const r of rooms) broadcast(r.room_id, { type: 'sub_agent_unlinked', room_id: r.room_id, sub_agent_id: id });
    return { status: 204, body: null, sub_agent: sa };
  }

  function link(roomId, subAgentId) {
    if (!subAgentId) return fail(400, 'sub_agent_id required');
    const sa = q.one.get(subAgentId);
    if (!sa) return fail(404, 'sub-agent not found');
    if (!q.room.get(roomId)) return fail(404, 'room not found');
    if (!q.inRoom.get(roomId, sa.parent_actor_id)) return fail(403, 'parent agent is not a participant in this room');
    const collision = q.labelCollision.get(roomId, sa.label, sa.parent_actor_id);
    if (collision) return fail(409, `label "${sa.label}" already in this room (from ${collision.parent_name})`);
    q.link.run(roomId, subAgentId);
    broadcast(roomId, { type: 'sub_agent_linked', room_id: roomId, sub_agent_id: subAgentId });
    return ok({ ok: true });
  }

  // Fire-and-forget: accepted at once. The orchestrator must not block waiting — with
  // MAX_CONCURRENT=1 that would deadlock (Gap 4).
  function trigger(roomId, agentId, data) {
    if (!data || typeof data !== 'object') return fail(400, 'Invalid JSON');
    const task = validTask(data.task);
    if (!task) return fail(400, 'invalid_task');

    const room = q.triggerRoom.get(roomId);
    if (!room) return fail(404, 'room not found');
    if (room.archived_at) return fail(400, 'room is archived');
    if (room.spawns_paused) return fail(409, 'spawns_paused');

    const parentPart = q.participant.get(roomId, agentId);
    if (!parentPart) return fail(403, 'agent is not a participant in this room');

    const threadId = data.thread_id ? parseInt(data.thread_id) : null;
    if (threadId) {
      const threadErr = resolveThread(roomId, threadId);
      if (threadErr) return fail(400, threadErr);
    }

    // Resolve by id or label; must be linked in this room AND owned by the requester (parent-only, Gap 2).
    let sub;
    if (data.sub_agent_id) sub = q.linkedById.get(roomId, parseInt(data.sub_agent_id));
    else if (data.label) sub = q.linkedByLabel.get(roomId, String(data.label));
    else return fail(400, 'sub_agent_id or label required');
    if (!sub) return fail(404, 'sub-agent not found in this room');
    if (sub.parent_actor_id !== agentId) return fail(403, 'not your sub-agent');

    // Budget: concurrent cap (running sub-agent messages) + hourly rate (orchestrator spawns).
    if (q.running.get(roomId).c >= room.max_sub_agents) return fail(429, 'max_concurrent');
    if (q.lastHour.get(roomId).c >= room.max_spawns_per_hour) return fail(429, 'budget_exceeded');

    // Marker message (non-null parent_message_id) → enables the one-shot auto-wake on completion.
    const parentMessageId = q.orchMsg.get(parentPart.id, roomId)?.id ?? null;
    const ai = q.parentAi.get(parentPart.id);
    const effectiveHarness = sub.harness || ai.adapter || 'claude';
    ai.sub_agent = { id: sub.id, label: sub.label, tier: sub.tier, model: sub.model, workdir: sub.workdir, system_prompt: sub.system_prompt, harness: effectiveHarness, avatar_color: sub.avatar_color, avatar_symbol: sub.avatar_symbol, avatar_url: sub.avatar_url, description: sub.description, role: sub.role };
    ai.parent_message_id = parentMessageId;
    ai.prompt_outside_history = true;

    // The parent's stoa-agent runs the sub-agent, so it must be online.
    if (!isAgentOnline(agentId)) return fail(503, 'parent_offline', { message: `${ai.name} sedang offline — sub-agent tidak bisa dijalankan` });
    runSubAgent(roomId, ai, task, threadId);
    return ok({ ok: true, label: sub.label });
  }

  return { list, create, update, remove, link, trigger, limit };
}

module.exports = { createSubAgents };
