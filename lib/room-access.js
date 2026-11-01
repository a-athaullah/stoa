'use strict';
// Which rooms an agent session may reach outside its own room (owner decision 2026-11-01): the
// built-in MCP read tools with room_id / stoa__rooms_list (lib/stoa-mcp-tools.js), and every 'room'
// route of a sub-agent credential (lib/agent-scope.js, server.js agentScopeAllowed).
//   agent      → a participant of the room
//   sub-agent  → linked to the room (room_sub_agents) AND its parent still a participant
//   both       → the room is not archived
// A missing room and a room the caller may not reach answer alike, so ids cannot be probed.

function createRoomAccess(db) {
  const SUB_LINKED = '(@sub IS NULL OR EXISTS (SELECT 1 FROM room_sub_agents rsa WHERE rsa.room_id=r.id AND rsa.sub_agent_id=@sub))';
  const MEMBER = 'EXISTS (SELECT 1 FROM room_participants rp WHERE rp.room_id=r.id AND rp.actor_id=@actor)';
  const q = {
    member: db.prepare(`SELECT 1 FROM rooms r WHERE r.id=@room AND r.archived_at IS NULL AND ${MEMBER} AND ${SUB_LINKED}`),
    list: db.prepare(`SELECT r.id, r.title,
        COALESCE((SELECT m.created_at FROM messages m WHERE m.room_id=r.id ORDER BY m.id DESC LIMIT 1), r.created_at) AS last_activity
      FROM rooms r WHERE r.archived_at IS NULL AND ${MEMBER} AND ${SUB_LINKED}
      ORDER BY last_activity DESC, r.id DESC LIMIT @limit`),
  };
  const params = (actorId, subAgentId) => ({ actor: actorId, sub: subAgentId ?? null });

  function canReach(roomId, { actorId, subAgentId = null }) {
    if (!Number.isInteger(roomId) || roomId <= 0) return false;
    return !!q.member.get({ room: roomId, ...params(actorId, subAgentId) });
  }

  function list({ actorId, subAgentId = null }, limit = 200) {
    return q.list.all({ ...params(actorId, subAgentId), limit });
  }

  return { canReach, list };
}

module.exports = { createRoomAccess };
