'use strict';
// Room and agent system prompts: the one implementation of read and write, shared by the HTTP
// routes and the built-in MCP tools (lib/stoa-mcp-tools.js). Callers authorize first
// (room participant / the agent itself). → { status, body }.

const SYSTEM_PROMPT_MAX_BYTES = 65536;
const ok = (body) => ({ status: 200, body });
const fail = (status, error) => ({ status, body: { error } });

function createSystemPrompts({ db }) {
  const q = {
    room: db.prepare('SELECT system_prompt, max_active_threads FROM rooms WHERE id=?'),
    roomPrompt: db.prepare('UPDATE rooms SET system_prompt=? WHERE id=?'),
    roomThreads: db.prepare('UPDATE rooms SET max_active_threads=? WHERE id=?'),
    actor: db.prepare('SELECT system_prompt, type FROM actors WHERE id=?'),
    actorPrompt: db.prepare('UPDATE actors SET system_prompt=? WHERE id=?'),
  };

  function roomGet(roomId) {
    const room = q.room.get(roomId);
    if (!room) return fail(404, 'room not found');
    return ok({ system_prompt: room.system_prompt, max_active_threads: room.max_active_threads });
  }

  function roomSet(roomId, data) {
    if (!q.room.get(roomId)) return fail(404, 'room not found');
    if (!data || typeof data !== 'object') return fail(400, 'Invalid JSON');
    if (data.system_prompt !== undefined && data.system_prompt !== null && typeof data.system_prompt !== 'string') {
      return fail(400, 'system_prompt must be string or null');
    }
    if (typeof data.system_prompt === 'string' && data.system_prompt.length > SYSTEM_PROMPT_MAX_BYTES) {
      return fail(400, 'system_prompt exceeds 64KB limit');
    }
    if (data.max_active_threads !== undefined && (!Number.isInteger(data.max_active_threads) || data.max_active_threads < 1 || data.max_active_threads > 20)) {
      return fail(400, 'max_active_threads must be an integer between 1 and 20');
    }
    if (typeof data.system_prompt === 'string' || data.system_prompt === null) q.roomPrompt.run(data.system_prompt, roomId);
    if (Number.isInteger(data.max_active_threads)) q.roomThreads.run(data.max_active_threads, roomId);
    return roomGet(roomId);
  }

  function actorOf(actorId) {
    const actor = q.actor.get(actorId);
    if (!actor) return { err: fail(404, 'actor not found') };
    if (actor.type !== 'ai') return { err: fail(404, 'system-prompt only for AI actors') };
    return { actor };
  }

  function actorGet(actorId) {
    const { actor, err } = actorOf(actorId);
    return err || ok({ system_prompt: actor.system_prompt || null });
  }

  function actorSet(actorId, data) {
    const { err } = actorOf(actorId);
    if (err) return err;
    if (!data || typeof data !== 'object') return fail(400, 'Invalid JSON');
    const prompt = data.system_prompt;
    if (prompt !== null && prompt !== undefined && typeof prompt !== 'string') return fail(400, 'system_prompt must be string or null');
    if (typeof prompt === 'string' && Buffer.byteLength(prompt) > SYSTEM_PROMPT_MAX_BYTES) return fail(400, 'system_prompt exceeds 64KB limit');
    q.actorPrompt.run(prompt ?? null, actorId);
    return ok({ system_prompt: prompt ?? null });
  }

  return { roomGet, roomSet, actorGet, actorSet };
}

module.exports = { createSystemPrompts, SYSTEM_PROMPT_MAX_BYTES };
