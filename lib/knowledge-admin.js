'use strict';
// Knowledge (5/6): the room's knowledge settings and management panel (routes in server.js, all
// session-only: not in lib/agent-scope.js, so an agent secret gets 403 — the panel shows what every
// agent looked up and deletes knowledge, an owner view).
//
// Toggle: rooms.knowledge_enabled. A room on KNOWLEDGE_EXCLUDED_ROOM_IDS or archived is locked: it
// cannot be switched on (403 / 409), switching off is never refused. Switching off drops the room's
// queued conversation jobs; nodes already made stay until the owner deletes them. Whether a room
// feeds knowledge at all stays the one rule eligibleRoom() of lib/knowledge-extraction.js.
//
// "Nodes of a room" = knowledge_node_rooms (migrations/20261119-knowledge-privacy.sql): every room the
// node has had a source in, kept after that source is gone. A node is deleted from a room's panel only
// when it came from that room. Deleting a node that was used archives its title and uses
// (knowledge_nodes_bd), so the history can still say who read it; "forget" drops that archive.
//
// Every id from the path or query is checked here (positive integer), so server.js only routes.

const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 200;
const OFFSET_MAX = 1_000_000;
const QUERY_MAX = 200;
const PREVIEW_CHARS = 200;

const ok = (body) => ({ status: 200, body });
const fail = (status, error, extra) => ({ status, body: { error, ...extra } });

// Path / query value → positive safe integer, or null.
function posId(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v !== 'string' || !/^[1-9]\d{0,15}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

// Optional query integer in [min, max]; absent or '' → def; anything else invalid → undefined.
function intParam(v, def, min, max) {
  if (v == null || v === '') return def;
  if (!/^\d{1,9}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= min && n <= max ? n : undefined;
}

function createKnowledgeAdmin({ db, eligibleRoom, excludedRoom, docs, notify = () => {}, log = console }) {
  const NODE_FILTER = `FROM knowledge_node_rooms nr JOIN knowledge_nodes n ON n.id=nr.node_id
    WHERE nr.room_id=@room
      AND (@doc IS NULL OR EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.node_id=n.id AND s.document_id=@doc))
      AND (@q IS NULL OR instr(lower(n.title), lower(@q)) > 0)`;
  const q = {
    room: db.prepare('SELECT id, knowledge_enabled, archived_at FROM rooms WHERE id=?'),
    counts: db.prepare(`SELECT
      (SELECT COUNT(*) FROM knowledge_documents WHERE room_id=@room) AS documents,
      (SELECT COUNT(*) FROM knowledge_node_rooms WHERE room_id=@room) AS nodes,
      (SELECT COUNT(*) FROM knowledge_node_rooms nr JOIN knowledge_nodes n ON n.id=nr.node_id
        WHERE nr.room_id=@room AND n.status='stale') AS stale_nodes`),
    setEnabled: db.prepare('UPDATE rooms SET knowledge_enabled=? WHERE id=?'),
    dropPending: db.prepare(`DELETE FROM knowledge_jobs WHERE room_id=? AND node_id IS NULL AND status='pending'`),
    docInRoom: db.prepare('SELECT 1 FROM knowledge_documents WHERE id=? AND room_id=?'),
    nodes: db.prepare(`SELECT n.id, n.title, n.category, n.status, substr(n.summary, 1, ${PREVIEW_CHARS}) AS summary_preview, n.updated_at,
        (SELECT COUNT(*) FROM knowledge_sources s WHERE s.node_id=n.id AND s.message_id IS NOT NULL) AS messages,
        (SELECT COUNT(*) FROM knowledge_sources s WHERE s.node_id=n.id AND s.document_id IS NOT NULL) AS documents,
        (SELECT COUNT(*) FROM knowledge_node_rooms o WHERE o.node_id=n.id AND o.room_id<>@room) AS other_rooms,
        (SELECT COUNT(*) FROM knowledge_usage u WHERE u.node_id=n.id) AS uses,
        (SELECT MAX(u.used_at) FROM knowledge_usage u WHERE u.node_id=n.id) AS last_used_at
      ${NODE_FILTER}
      ORDER BY n.updated_at DESC, n.id DESC LIMIT @limit OFFSET @offset`),
    nodeTotal: db.prepare(`SELECT COUNT(*) AS n ${NODE_FILTER}`),
    nodeInRoom: db.prepare('SELECT 1 FROM knowledge_node_rooms WHERE node_id=? AND room_id=?'),
    deleteNode: db.prepare('DELETE FROM knowledge_nodes WHERE id=?'),
    archivedNode: db.prepare('SELECT id FROM knowledge_deleted_nodes WHERE node_id=?'),
    liveUsage: db.prepare(`SELECT u.id, u.node_id, n.title AS node_title, u.actor_id, a.name AS actor_name,
        u.sub_agent_id, COALESCE(sa.label, u.sub_agent_label) AS sub_agent_label, u.room_id, r.title AS room_title, u.used_at
      FROM knowledge_usage u JOIN knowledge_nodes n ON n.id=u.node_id
      LEFT JOIN actors a ON a.id=u.actor_id LEFT JOIN sub_agents sa ON sa.id=u.sub_agent_id LEFT JOIN rooms r ON r.id=u.room_id
      WHERE u.node_id IN (SELECT node_id FROM knowledge_node_rooms WHERE room_id=@room)
        AND (@node IS NULL OR u.node_id=@node) AND (@before IS NULL OR u.id < @before)
      ORDER BY u.id DESC LIMIT @take`),
    // A live name wins over the snapshot (same as live uses); the snapshot covers a deleted actor / room.
    deletedUsage: db.prepare(`SELECT du.id, dn.node_id, dn.title AS node_title, dn.id AS deleted_id, dn.deleted_at,
        du.actor_id, COALESCE(a.name, du.actor_name) AS actor_name, du.sub_agent_id, COALESCE(sa.label, du.sub_agent_label) AS sub_agent_label,
        du.room_id, COALESCE(r.title, du.room_title) AS room_title, du.used_at
      FROM knowledge_deleted_node_rooms dr JOIN knowledge_deleted_nodes dn ON dn.id=dr.deleted_id
      JOIN knowledge_deleted_usage du ON du.deleted_id=dn.id
      LEFT JOIN actors a ON a.id=du.actor_id LEFT JOIN sub_agents sa ON sa.id=du.sub_agent_id LEFT JOIN rooms r ON r.id=du.room_id
      WHERE dr.room_id=@room AND (@node IS NULL OR dn.node_id=@node) AND (@before IS NULL OR du.id < @before)
      ORDER BY du.id DESC LIMIT @take`),
    deletedInRoom: db.prepare('SELECT 1 FROM knowledge_deleted_node_rooms WHERE deleted_id=? AND room_id=?'),
    forget: db.prepare('DELETE FROM knowledge_deleted_nodes WHERE id=?'),
  };

  function lockReason(room) {
    if (excludedRoom(room.id)) return 'excluded';
    if (room.archived_at != null) return 'archived';
    return null;
  }

  // → { room } or { error: { status, body } }
  function roomFor(rawId) {
    const id = posId(rawId);
    if (!id) return { error: fail(400, 'room id must be a positive integer') };
    const room = q.room.get(id);
    if (!room) return { error: fail(404, 'room not found') };
    return { room };
  }

  function settingsBody(room) {
    const reason = lockReason(room);
    return {
      enabled: room.knowledge_enabled === 1,
      eligible: eligibleRoom(room),
      locked: reason != null,
      lock_reason: reason,
      ...q.counts.get({ room: room.id }),
    };
  }

  function settings(rawRoomId) {
    const { room, error } = roomFor(rawRoomId);
    return error ?? ok(settingsBody(room));
  }

  function setEnabled(rawRoomId, data) {
    const { room, error } = roomFor(rawRoomId);
    if (error) return error;
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.enabled !== 'boolean') {
      return fail(400, 'body must be { "enabled": true | false }');
    }
    const reason = lockReason(room);
    if (data.enabled && reason === 'excluded') {
      return fail(403, 'this room is on KNOWLEDGE_EXCLUDED_ROOM_IDS: nothing from it is added to knowledge', { lock_reason: reason });
    }
    if (data.enabled && reason === 'archived') {
      return fail(409, 'this room is archived: restore it before adding it to knowledge', { lock_reason: reason });
    }
    const want = data.enabled ? 1 : 0;
    const changed = want !== room.knowledge_enabled;
    const dropped = db.transaction(() => {
      if (changed) q.setEnabled.run(want, room.id);
      return want ? 0 : q.dropPending.run(room.id).changes;
    })();
    if (changed || dropped) log.log(`[knowledge] room ${room.id} knowledge ${want ? 'on' : 'off'}${dropped ? ` (${dropped} queued jobs dropped)` : ''}`);
    if (changed) {
      try { notify({ type: 'room_knowledge_changed', room_id: room.id, enabled: !!want }); }
      catch (e) { log.error(`[knowledge] room_knowledge_changed broadcast failed: ${e.message}`); }
    }
    return ok(settingsBody(q.room.get(room.id)));
  }

  function documents(rawRoomId) {
    const { room, error } = roomFor(rawRoomId);
    return error ?? docs.list(room.id);
  }

  function removeDocument(rawRoomId, rawDocId) {
    const { room, error } = roomFor(rawRoomId);
    if (error) return error;
    const id = posId(rawDocId);
    if (!id) return fail(400, 'document id must be a positive integer');
    return docs.remove(room.id, id);
  }

  // params: URLSearchParams-like ({ get(name) }).
  function nodes(rawRoomId, params) {
    const { room, error } = roomFor(rawRoomId);
    if (error) return error;
    const limit = intParam(params.get('limit'), LIMIT_DEFAULT, 1, LIMIT_MAX);
    if (limit === undefined) return fail(400, `limit must be an integer from 1 to ${LIMIT_MAX}`);
    const offset = intParam(params.get('offset'), 0, 0, OFFSET_MAX);
    if (offset === undefined) return fail(400, `offset must be an integer from 0 to ${OFFSET_MAX}`);
    const rawQ = params.get('q');
    if (rawQ != null && rawQ.length > QUERY_MAX) return fail(400, `q is longer than ${QUERY_MAX} characters`);
    const text = rawQ != null && rawQ.trim() ? rawQ.trim() : null;
    const rawDoc = params.get('document_id');
    let doc = null;
    if (rawDoc != null && rawDoc !== '') {
      doc = posId(rawDoc);
      if (!doc) return fail(400, 'document_id must be a positive integer');
      // A document of another room answers exactly like a missing one.
      if (!q.docInRoom.get(doc, room.id)) return fail(404, 'document not found');
    }
    const args = { room: room.id, doc, q: text };
    const rows = q.nodes.all({ ...args, limit, offset });
    return ok({
      nodes: rows.map(r => ({
        id: r.id, title: r.title, category: r.category, status: r.status, summary_preview: r.summary_preview ?? '',
        sources: { messages: r.messages, documents: r.documents }, other_rooms: r.other_rooms,
        uses: r.uses, last_used_at: r.last_used_at ?? null, updated_at: r.updated_at,
      })),
      total: q.nodeTotal.get(args).n,
    });
  }

  // DELETE /api/knowledge/nodes/:id?room_id= — the room is the panel the delete came from; a node that
  // never had a source there answers like a missing one.
  function deleteNode(rawNodeId, rawRoomId) {
    const id = posId(rawNodeId);
    if (!id) return fail(400, 'node id must be a positive integer');
    if (rawRoomId == null || rawRoomId === '') return fail(400, 'room_id is required');
    const { room, error } = roomFor(rawRoomId);
    if (error) return error;
    return db.transaction(() => {
      if (!q.nodeInRoom.get(id, room.id)) return fail(404, 'node not found');
      q.deleteNode.run(id);
      const archived = q.archivedNode.get(id);
      log.log(`[knowledge] node ${id} deleted from room ${room.id}${archived ? ' (usage archived)' : ''}`);
      return ok({ deleted: id, archived: !!archived });
    })();
  }

  function usageItem(r, deleted) {
    return {
      id: r.id, node_id: r.node_id, node_title: r.node_title, deleted,
      ...(deleted ? { deleted_id: r.deleted_id, deleted_at: r.deleted_at } : {}),
      actor: { id: r.actor_id ?? null, name: r.actor_name ?? null },
      sub_agent: r.sub_agent_id != null || r.sub_agent_label != null ? { id: r.sub_agent_id ?? null, label: r.sub_agent_label ?? null } : null,
      room: { id: r.room_id ?? null, title: r.room_title ?? null },
      used_at: r.used_at,
    };
  }

  // Live and archived uses share one id space (knowledge_deleted_usage.id is the knowledge_usage.id
  // it was copied from), so newest first by id pages through both with one cursor.
  function usage(rawRoomId, params) {
    const { room, error } = roomFor(rawRoomId);
    if (error) return error;
    const limit = intParam(params.get('limit'), LIMIT_DEFAULT, 1, LIMIT_MAX);
    if (limit === undefined) return fail(400, `limit must be an integer from 1 to ${LIMIT_MAX}`);
    let node = null, before = null;
    const rawNode = params.get('node_id'), rawBefore = params.get('before_id');
    if (rawNode != null && rawNode !== '' && !(node = posId(rawNode))) return fail(400, 'node_id must be a positive integer');
    if (rawBefore != null && rawBefore !== '' && !(before = posId(rawBefore))) return fail(400, 'before_id must be a positive integer');
    const args = { room: room.id, node, before, take: limit + 1 };
    const merged = [
      ...q.liveUsage.all(args).map(r => usageItem(r, false)),
      ...q.deletedUsage.all(args).map(r => usageItem(r, true)),
    ].sort((a, b) => b.id - a.id);
    const items = merged.slice(0, limit);
    return ok({ items, next_before_id: merged.length > limit ? items[items.length - 1].id : null });
  }

  function forgetDeleted(rawRoomId, rawDeletedId) {
    const { room, error } = roomFor(rawRoomId);
    if (error) return error;
    const id = posId(rawDeletedId);
    if (!id) return fail(400, 'deleted id must be a positive integer');
    return db.transaction(() => {
      if (!q.deletedInRoom.get(id, room.id)) return fail(404, 'deleted node not found');
      q.forget.run(id);
      log.log(`[knowledge] archive ${id} of a deleted node forgotten from room ${room.id}`);
      return ok({ forgotten: id });
    })();
  }

  return { settings, setEnabled, documents, removeDocument, nodes, deleteNode, usage, forgetDeleted };
}

module.exports = { createKnowledgeAdmin, LIMIT_DEFAULT, LIMIT_MAX, QUERY_MAX, PREVIEW_CHARS };
