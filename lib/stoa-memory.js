'use strict';
// Room memory, agent memory (MEMORY.md / USER.md) and sub-agent memory: the one implementation of
// read and write. The HTTP routes and the built-in MCP tools (lib/stoa-mcp-tools.js) both call it,
// so the char budgets cannot drift between the two paths.
// Callers authorize first (room participant / self / parent of the sub-agent). → { status, body }.

const ROOM_MEMORY_BUDGET = 1800;
const AGENT_MEMORY_BUDGETS = { 'MEMORY.md': 2200, 'USER.md': 1375 };
const SUB_AGENT_MEMORY_BUDGET = 2200;
const ok = (body) => ({ status: 200, body });
const fail = (status, error) => ({ status, body: { error } });

function createStoaMemory({ db }) {
  const q = {
    room: db.prepare('SELECT id FROM rooms WHERE id=?'),
    roomRow: db.prepare('SELECT content, updated_at FROM room_memory WHERE room_id=?'),
    roomUpsert: db.prepare("INSERT INTO room_memory (room_id, content, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(room_id) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at"),
    agentRow: db.prepare('SELECT content, updated_at FROM agent_memory WHERE actor_id=? AND file=?'),
    agentUpsert: db.prepare("INSERT INTO agent_memory (actor_id, file, content, updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(actor_id, file) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at"),
    subAgent: db.prepare('SELECT id, parent_actor_id FROM sub_agents WHERE id=?'),
    subRow: db.prepare('SELECT content, updated_at FROM sub_agent_memory WHERE sub_agent_id=?'),
    subUpsert: db.prepare("INSERT INTO sub_agent_memory (sub_agent_id, content, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(sub_agent_id) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at"),
  };
  const contentOf = (data, budget) => {
    if (!data || typeof data.content !== 'string') return fail(400, 'content (string) required');
    if (data.content.length > budget) return fail(400, `content exceeds ${budget} char budget`);
    return null;
  };

  function roomGet(roomId) {
    if (!q.room.get(roomId)) return fail(404, 'room not found');
    const row = q.roomRow.get(roomId);
    const content = row?.content ?? '';
    return ok({ content, char_count: content.length, budget: ROOM_MEMORY_BUDGET, updated_at: row?.updated_at ?? null });
  }

  function roomSet(roomId, data) {
    if (!q.room.get(roomId)) return fail(404, 'room not found');
    const bad = contentOf(data, ROOM_MEMORY_BUDGET);
    if (bad) return bad;
    q.roomUpsert.run(roomId, data.content);
    const row = q.roomRow.get(roomId);
    return ok({ content: row.content, char_count: row.content.length, budget: ROOM_MEMORY_BUDGET, updated_at: row.updated_at });
  }

  function agentGet(actorId) {
    return ok({
      files: Object.keys(AGENT_MEMORY_BUDGETS).map(file => {
        const row = q.agentRow.get(actorId, file);
        const content = row?.content ?? '';
        return { file, content, char_count: content.length, budget: AGENT_MEMORY_BUDGETS[file], updated_at: row?.updated_at ?? null };
      }),
    });
  }

  function agentSet(actorId, file, data) {
    const budget = AGENT_MEMORY_BUDGETS[file];
    if (!budget) return fail(400, 'file must be MEMORY.md or USER.md');
    const bad = contentOf(data, budget);
    if (bad) return bad;
    q.agentUpsert.run(actorId, file, data.content);
    const row = q.agentRow.get(actorId, file);
    return ok({ file, content: row.content, char_count: row.content.length, budget, updated_at: row.updated_at });
  }

  // agentId null = owner session; otherwise only the parent agent reaches the sub-agent's memory.
  function subAgentAccess(subAgentId, agentId) {
    const sa = q.subAgent.get(subAgentId);
    if (!sa) return fail(404, 'sub-agent not found');
    if (agentId && agentId !== sa.parent_actor_id) return fail(403, 'forbidden');
    return null;
  }

  function subAgentGet(subAgentId) {
    const row = q.subRow.get(subAgentId);
    const content = row?.content ?? '';
    return ok({ content, char_count: content.length, budget: SUB_AGENT_MEMORY_BUDGET, updated_at: row?.updated_at ?? null });
  }

  function subAgentSet(subAgentId, data) {
    const bad = contentOf(data, SUB_AGENT_MEMORY_BUDGET);
    if (bad) return bad;
    q.subUpsert.run(subAgentId, data.content);
    const row = q.subRow.get(subAgentId);
    return ok({ content: row.content, char_count: row.content.length, budget: SUB_AGENT_MEMORY_BUDGET, updated_at: row.updated_at });
  }

  return { roomGet, roomSet, agentGet, agentSet, subAgentAccess, subAgentGet, subAgentSet };
}

module.exports = { createStoaMemory };
