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
// Brain views (6/6): node detail, recent searches and document upload. The owner sees every source
// and use, except where a room that is NOW on KNOWLEDGE_EXCLUDED_ROOM_IDS is involved: such a source
// is only counted (hidden_sources), such a use names no room. An archived room is shown (flagged).
//
// Graph events: knowledge_graph_changed { reason, room_id } (graphChanged in lib/knowledge-graph.js)
// reaches the owner's browsers once per operation that wrote nodes or edges, after its commit:
// extract (lib/knowledge-extraction.js), document_add / document_remove (lib/knowledge-documents.js,
// agent and upload alike), node_delete (here), message_delete / room_delete (server.js, only when the
// deleted messages or room had knowledge sources: knowledge_sources_ad then deletes or stales nodes,
// see sourcesIn). Failed and no-op operations send none. The room toggle sends none either: it
// changes no node (switching off keeps them). A message edit stales its nodes in a trigger
// (knowledge_messages_au) without an event; the node stays in the graph, and its re-extraction sends
// extract.
//
// knowledge_activity (createKnowledgeActivity in lib/knowledge-graph.js) is what the brain's live card
// says happened; sent here for node_delete and room_toggle (only when the setting changed).
//
// Every id from the path or query is checked here (positive integer), so server.js only routes.

const { scrub, cut, plainText, graphChanged, createKnowledgeActivity } = require('./knowledge-graph');
const { LIMIT_MAX: SEARCH_LIMIT_MAX } = require('./knowledge-search');

const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 200;
const OFFSET_MAX = 1_000_000;
const QUERY_MAX = 200;
const PREVIEW_CHARS = 200;
// Node detail (GET /api/knowledge/nodes/:id): sources listed, uses listed.
const DETAIL_SOURCES_MAX = 20;
const DETAIL_USERS_MAX = 10;
// GET /api/knowledge/usage/recent: searches returned.
const RECENT_DEFAULT = 20;
const RECENT_MAX = 50;

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
  const activity = createKnowledgeActivity({ db, notify, log, excludedRoom });
  const NODE_FILTER = `FROM knowledge_node_rooms nr JOIN knowledge_nodes n ON n.id=nr.node_id
    WHERE nr.room_id=@room
      AND (@doc IS NULL OR EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.node_id=n.id AND s.document_id=@doc))
      AND (@q IS NULL OR instr(lower(n.title), lower(@q)) > 0)`;
  const q = {
    room: db.prepare('SELECT id, knowledge_enabled, archived_at FROM rooms WHERE id=?'),
    roomSources: db.prepare(`SELECT 1 WHERE EXISTS (SELECT 1 FROM knowledge_documents d JOIN knowledge_sources s ON s.document_id=d.id WHERE d.room_id=?)
      OR EXISTS (SELECT 1 FROM messages m JOIN knowledge_sources s ON s.message_id=m.id WHERE m.room_id=?)`),
    messageSources: db.prepare(`SELECT 1 FROM knowledge_sources WHERE message_id=?
      UNION ALL SELECT 1 FROM messages m JOIN knowledge_sources s ON s.message_id=m.id WHERE m.thread_id=? LIMIT 1`),
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
    node: db.prepare('SELECT id, title, summary, category, status, stale_at, created_at, updated_at FROM knowledge_nodes WHERE id=?'),
    nodeUses: db.prepare(`SELECT
        COALESCE(SUM(used_at >= datetime('now', '-24 hours')), 0) AS d1,
        COALESCE(SUM(used_at >= datetime('now', '-7 days')), 0) AS d7,
        COALESCE(SUM(used_at >= datetime('now', '-30 days')), 0) AS d30
      FROM knowledge_usage WHERE node_id=?`),
    nodeSources: db.prepare(`SELECT s.message_id, m.thread_id, s.document_id, d.name AS document_name, s.section,
        COALESCE(m.room_id, d.room_id) AS room_id, r.title AS room_title, r.archived_at
      FROM knowledge_sources s
      LEFT JOIN messages m ON m.id=s.message_id
      LEFT JOIN knowledge_documents d ON d.id=s.document_id
      LEFT JOIN rooms r ON r.id=COALESCE(m.room_id, d.room_id)
      WHERE s.node_id=? ORDER BY s.id`),
    messageText: db.prepare('SELECT id, content FROM messages WHERE id IN (SELECT value FROM json_each(?))'),
    nodeUsers: db.prepare(`SELECT u.actor_id, a.name AS actor_name, u.sub_agent_id, COALESCE(sa.label, u.sub_agent_label) AS sub_agent_label,
        u.room_id, r.title AS room_title, u.used_at
      FROM knowledge_usage u LEFT JOIN actors a ON a.id=u.actor_id LEFT JOIN sub_agents sa ON sa.id=u.sub_agent_id
      LEFT JOIN rooms r ON r.id=u.room_id
      WHERE u.node_id=? ORDER BY u.id DESC LIMIT ${DETAIL_USERS_MAX}`),
    recent: db.prepare(`SELECT u.id, u.node_id, u.actor_id, a.name AS actor_name, u.sub_agent_id,
        COALESCE(sa.label, u.sub_agent_label) AS sub_agent_label, u.room_id, r.title AS room_title, u.used_at
      FROM knowledge_usage u LEFT JOIN actors a ON a.id=u.actor_id LEFT JOIN sub_agents sa ON sa.id=u.sub_agent_id
      LEFT JOIN rooms r ON r.id=u.room_id
      ORDER BY u.id DESC LIMIT ?`),
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
      activity('room_toggle', { roomId: room.id, enabled: !!want, byOwner: true });
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
    const r = db.transaction(() => {
      if (!q.nodeInRoom.get(id, room.id)) return fail(404, 'node not found');
      q.deleteNode.run(id);
      const archived = q.archivedNode.get(id);
      log.log(`[knowledge] node ${id} deleted from room ${room.id}${archived ? ' (usage archived)' : ''}`);
      return ok({ deleted: id, archived: !!archived });
    })();
    if (r.status === 200) {
      graphChanged(notify, log, 'node_delete', room.id);
      activity('node_delete', { roomId: room.id, nodeId: id, removed: 1, byOwner: true });
    }
    return r;
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

  // Who used a node / searched, as the brain shows it: no room when that room is excluded now.
  function useOf(r) {
    return {
      actor: { id: r.actor_id, name: r.actor_name ?? null },
      sub_agent: r.sub_agent_id != null || r.sub_agent_label != null ? { id: r.sub_agent_id ?? null, label: r.sub_agent_label ?? null } : null,
      room: excludedRoom(r.room_id) ? null : { id: r.room_id, title: r.room_title ?? null },
      used_at: r.used_at,
    };
  }

  // GET /api/knowledge/nodes/:id
  function nodeDetail(rawNodeId) {
    const id = posId(rawNodeId);
    if (!id) return fail(400, 'node id must be a positive integer');
    const n = q.node.get(id);
    if (!n) return fail(404, 'node not found');
    const uses = q.nodeUses.get(id);
    const shown = [];
    let hidden = 0, more = 0;
    for (const s of q.nodeSources.all(id)) {
      if (s.room_id == null || excludedRoom(s.room_id)) { hidden++; continue; }
      if (shown.length >= DETAIL_SOURCES_MAX) { more++; continue; }
      shown.push(s);
    }
    const msgIds = shown.filter(s => s.message_id != null).map(s => s.message_id);
    const text = new Map(msgIds.length ? q.messageText.all(JSON.stringify(msgIds)).map(m => [m.id, m.content]) : []);
    const sources = shown.map(s => (s.message_id != null
      ? {
        type: 'message', room_id: s.room_id, room_title: s.room_title, room_archived: s.archived_at != null,
        thread_id: s.thread_id ?? null, message_id: s.message_id,
        // Scrubbed whole, then cut: a cut first could split a secret the redaction no longer sees.
        preview: cut(plainText(scrub(String(text.get(s.message_id) ?? ''))).replace(/\s+/g, ' ').trim(), PREVIEW_CHARS),
      }
      : { type: 'document', document_id: s.document_id, name: s.document_name, section: s.section ?? null, room_id: s.room_id, room_title: s.room_title }));
    return ok({
      id: n.id, title: n.title, summary: n.summary, category: n.category, status: n.status, stale_at: n.stale_at,
      created_at: n.created_at, updated_at: n.updated_at,
      uses: { '24h': uses.d1, '7d': uses.d7, '30d': uses.d30 },
      sources, more_sources: more, hidden_sources: hidden,
      recent_users: q.nodeUsers.all(id).map(useOf),
    });
  }

  // GET /api/knowledge/usage/recent — the brain's feed after a reload. One search wrote its rows in
  // one transaction (lib/knowledge-search.js recordUse): consecutive ids with the same actor,
  // sub-agent, room and used_at. A search logs at most SEARCH_LIMIT_MAX rows, so the newest
  // limit × SEARCH_LIMIT_MAX rows hold the newest `limit` searches whole. The query is not stored.
  function recentUsage(params) {
    const limit = intParam(params.get('limit'), RECENT_DEFAULT, 1, RECENT_MAX);
    if (limit === undefined) return fail(400, `limit must be an integer from 1 to ${RECENT_MAX}`);
    const items = [];
    let key = null;
    for (const r of q.recent.all(limit * SEARCH_LIMIT_MAX)) {
      const k = `${r.actor_id}|${r.sub_agent_id ?? ''}|${r.room_id}|${r.used_at}`;
      if (k !== key) {
        if (items.length === limit) break;
        key = k;
        items.push({ node_ids: [], ...useOf(r) });
      }
      items[items.length - 1].node_ids.push(r.node_id);
    }
    // Rows came newest first; a search wrote its nodes best first.
    for (const it of items) it.node_ids.reverse();
    return ok({ items });
  }

  // Before a delete in server.js: whether the room, the message or (thread) its replies carry
  // knowledge sources, i.e. whether the delete will change the graph.
  function sourcesIn({ roomId = null, messageId = null, thread = false }) {
    if (roomId != null) return !!q.roomSources.get(roomId, roomId);
    return !!q.messageSources.get(messageId, thread ? messageId : null);
  }

  function graphDeleted(reason, roomId) {
    graphChanged(notify, log, reason, roomId);
  }

  // POST /api/rooms/:id/knowledge/documents — actorId: the owner (session).
  async function uploadDocument(rawRoomId, data, actorId) {
    const { room, error } = roomFor(rawRoomId);
    if (error) return error;
    const r = await docs.upload({ actorId, roomId: room.id }, data);
    if (r.status === 200 && !r.body.unchanged) {
      try { notify({ type: 'room_knowledge_changed', room_id: room.id, enabled: q.room.get(room.id)?.knowledge_enabled === 1 }); }
      catch (e) { log.error(`[knowledge] room_knowledge_changed broadcast failed: ${e.message}`); }
    }
    return r;
  }

  return {
    settings, setEnabled, documents, removeDocument, nodes, deleteNode, usage, forgetDeleted, nodeDetail, recentUsage, uploadDocument,
    sourcesIn, graphDeleted,
  };
}

module.exports = { createKnowledgeAdmin, LIMIT_DEFAULT, LIMIT_MAX, QUERY_MAX, PREVIEW_CHARS, DETAIL_SOURCES_MAX, DETAIL_USERS_MAX, RECENT_DEFAULT, RECENT_MAX };
