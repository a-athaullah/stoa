'use strict';
// Room messages for agents and the owner's UI: the one implementation of posting a proactive agent
// message, reading the room feed, listing threads and reading one thread. The HTTP routes
// (/api/rooms/:id/message, /messages, /threads, /threads/:id) and the built-in MCP tools
// (lib/stoa-mcp-tools.js) both call it, so thread validation, idempotency and the @mention cascade
// cannot drift between the two paths. Callers authorize first. → { status, body }.

const fs = require('fs');
const path = require('path');

const ok = (body) => ({ status: 200, body });
const fail = (status, error) => ({ status, body: { error } });

const MSG_COLS = `m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type,
  sa.avatar_color AS sub_agent_avatar_color, sa.avatar_symbol AS sub_agent_avatar_symbol, sa.avatar_url AS sub_agent_avatar_url, sa.role AS sub_agent_role`;
const MSG_FROM = `FROM messages m
  JOIN room_participants rp ON rp.id=m.participant_id
  JOIN actors a ON a.id=rp.actor_id
  LEFT JOIN sub_agents sa ON sa.id=m.sub_agent_id`;
// Rows the feed shows: finished messages plus the system notices the history keeps.
const FEED_STATES = `AND (
    (m.state = 'complete' AND (m.content != '' OR m.image_url IS NOT NULL OR m.attachments IS NOT NULL))
    OR (m.state = 'system_event' AND m.content LIKE '% · session compacted')
    OR (m.state = 'system_event' AND m.content LIKE '% · reauth')
    OR (m.state = 'system_event' AND m.content LIKE '% · automation')
    OR (m.state = 'system_event' AND m.content LIKE '% · schedule')
    OR (m.state = 'system_event' AND m.content LIKE '% · config')
    OR (m.state = 'error' AND m.broadcast_reason IS NOT NULL)
  )`;
// Per-root thread summary, roots-only mode.
const THREAD_SUMMARY = `,
  CASE WHEN m.thread_id IS NULL THEN (SELECT COUNT(*) FROM messages r WHERE r.thread_id = m.id) END AS thread_count,
  CASE WHEN m.thread_id IS NULL THEN (SELECT MAX(r.created_at) FROM messages r WHERE r.thread_id = m.id) END AS thread_last_at,
  CASE WHEN m.thread_id IS NULL THEN (EXISTS (SELECT 1 FROM messages r WHERE r.thread_id = m.id AND r.state IN ('streaming','requesting'))) END AS thread_active,
  CASE WHEN m.thread_id IS NULL THEN (SELECT GROUP_CONCAT(DISTINCT rp2.actor_id) FROM messages r JOIN room_participants rp2 ON rp2.id=r.participant_id WHERE r.thread_id = m.id) END AS thread_participant_ids,
  CASE WHEN m.thread_id IS NULL THEN (EXISTS (SELECT 1 FROM messages r WHERE r.thread_id = m.id AND r.state = 'error')) END AS thread_has_error,
  CASE WHEN m.thread_id IS NULL THEN (SELECT GROUP_CONCAT(DISTINCT r.sub_agent_label || ':' || rp2.actor_id) FROM messages r JOIN room_participants rp2 ON rp2.id=r.participant_id WHERE r.thread_id = m.id AND r.sub_agent_label IS NOT NULL) END AS thread_sub_agent_participants`;
const ROOTS_ONLY = 'AND (m.thread_id IS NULL OR m.broadcast_reason IS NOT NULL)';
// Display order is (feed_pos, id) — see migrations/20261026-message-feed-pos.sql. The before/since
// cursors stay message ids: @cur is resolved to that row's feed_pos (a missing row falls back to the
// id itself, which is what its feed_pos would have been).
const CURSOR = '(COALESCE((SELECT c.feed_pos FROM messages c WHERE c.id=@cur AND c.room_id=@room), @cur), @cur)';
const toCursor = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function createRoomMessages({ db, broadcast, broadcastGlobal, resolveThread, enrichAutomation, enrichAutomationList, enrichReply, getThreadRootPreview, cascadeMentions, uploadsDir }) {
  const q = {
    room: db.prepare('SELECT id, archived_at FROM rooms WHERE id=?'),
    participant: db.prepare('SELECT rp.id FROM room_participants rp WHERE rp.room_id=? AND rp.actor_id=?'),
    byEvent: db.prepare('SELECT id, content FROM messages WHERE room_id=? AND client_event_id=?'),
    ownSubAgent: db.prepare('SELECT id, label FROM sub_agents WHERE id=? AND parent_actor_id=?'),
    insert: db.prepare("INSERT INTO messages (room_id, participant_id, content, client_event_id, thread_id, state, sub_agent_id, sub_agent_label, file_url, file_name, attachments) VALUES (?, ?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?)"),
    full: db.prepare(`SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
      FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id WHERE m.id=?`),
    feedBefore: {
      roots: db.prepare(`SELECT * FROM (SELECT ${MSG_COLS} ${THREAD_SUMMARY} ${MSG_FROM}
        WHERE m.room_id=@room AND (m.feed_pos, m.id) < ${CURSOR} ${ROOTS_ONLY} ${FEED_STATES} ORDER BY m.feed_pos DESC, m.id DESC LIMIT @limit) t ORDER BY feed_pos, id`),
      all: db.prepare(`SELECT * FROM (SELECT ${MSG_COLS} ${MSG_FROM}
        WHERE m.room_id=@room AND (m.feed_pos, m.id) < ${CURSOR} ${FEED_STATES} ORDER BY m.feed_pos DESC, m.id DESC LIMIT @limit) t ORDER BY feed_pos, id`),
    },
    feedSince: {
      roots: db.prepare(`SELECT ${MSG_COLS} ${THREAD_SUMMARY} ${MSG_FROM}
        WHERE m.room_id=@room AND (m.feed_pos, m.id) > ${CURSOR} ${ROOTS_ONLY} ${FEED_STATES} ORDER BY m.feed_pos, m.id LIMIT 500`),
      all: db.prepare(`SELECT ${MSG_COLS} ${MSG_FROM}
        WHERE m.room_id=@room AND (m.feed_pos, m.id) > ${CURSOR} ${FEED_STATES} ORDER BY m.feed_pos, m.id LIMIT 500`),
    },
    threadsActive: db.prepare(`
      SELECT m.id, m.content, m.created_at, a.name as actor_name,
        (SELECT COUNT(*) FROM messages r WHERE r.thread_id=m.id) as reply_count,
        (SELECT MAX(r2.created_at) FROM messages r2 WHERE r2.thread_id=m.id) as last_reply_at
      FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id
      JOIN actors a ON a.id=rp.actor_id
      WHERE m.room_id=? AND m.thread_id IS NULL
        AND EXISTS (SELECT 1 FROM messages r3 WHERE r3.thread_id=m.id AND r3.state IN ('streaming','requesting'))
      ORDER BY m.id DESC`),
    // One query for the whole room (no per-thread N+1): who is running in each active thread.
    threadsRunning: db.prepare(`
      SELECT m.thread_id, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url,
        m.sub_agent_id, m.sub_agent_label, sa.avatar_color AS sub_agent_avatar_color,
        sa.avatar_symbol AS sub_agent_avatar_symbol, sa.avatar_url AS sub_agent_avatar_url
      FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id
      JOIN actors a ON a.id=rp.actor_id
      LEFT JOIN sub_agents sa ON sa.id=m.sub_agent_id
      WHERE m.room_id=? AND m.thread_id IS NOT NULL AND m.state IN ('streaming','requesting')
      ORDER BY m.id`),
    threadsAll: db.prepare(`
      SELECT m.id, m.content, m.created_at, a.name as actor_name,
        (SELECT COUNT(*) FROM messages r WHERE r.thread_id=m.id) as reply_count,
        (SELECT MAX(r2.created_at) FROM messages r2 WHERE r2.thread_id=m.id) as last_reply_at
      FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id
      JOIN actors a ON a.id=rp.actor_id
      WHERE m.room_id=? AND m.thread_id IS NULL
        AND EXISTS (SELECT 1 FROM messages r3 WHERE r3.thread_id=m.id)
      ORDER BY last_reply_at DESC NULLS LAST`),
    threadRoot: db.prepare(`SELECT ${MSG_COLS} ${MSG_FROM} WHERE m.id=? AND m.room_id=? AND m.thread_id IS NULL`),
    threadBefore: db.prepare(`SELECT ${MSG_COLS} ${MSG_FROM} WHERE m.thread_id=@root AND m.room_id=@room AND (m.feed_pos, m.id) < ${CURSOR} ORDER BY m.feed_pos DESC, m.id DESC LIMIT @limit`),
    threadLatest: db.prepare(`SELECT ${MSG_COLS} ${MSG_FROM} WHERE m.thread_id=? AND m.room_id=? ORDER BY m.feed_pos DESC, m.id DESC LIMIT ?`),
    replied: db.prepare(`SELECT m2.content, a2.name as actor_name FROM messages m2
      JOIN room_participants rp2 ON rp2.id=m2.participant_id JOIN actors a2 ON a2.id=rp2.actor_id WHERE m2.id=?`),
  };

  function enrichThreadData(m) {
    if (m.broadcast_reason && m.thread_id) {
      m.thread_root_preview = getThreadRootPreview(m.thread_id);
      return;
    }
    const sap = m.thread_sub_agent_participants ? m.thread_sub_agent_participants.split(',').map(s => { const [label, aid] = s.split(':'); return { label, actor_id: Number(aid) }; }) : [];
    m.thread = { count: m.thread_count || 0, last_at: m.thread_last_at || null, active: !!m.thread_active, participant_ids: m.thread_participant_ids ? m.thread_participant_ids.split(',').map(Number) : [], has_error: !!m.thread_has_error, sub_agent_participants: sap };
  }

  // Proactive message from an agent (authenticated by the caller). data: content, thread_id,
  // event_id (idempotency key), sub_agent_id + attachments (agent client delivering a turn the CLI
  // ran on its own, under the right identity, with its uploaded [send:] files).
  function send(roomId, agentId, data) {
    if (!data || typeof data !== 'object') return fail(400, 'Invalid JSON');
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    if (!content) return fail(400, 'content required');
    const rawEventId = typeof data.event_id === 'string' ? data.event_id.trim() : '';
    const eventId = rawEventId && rawEventId.length <= 128 ? rawEventId : null;

    const room = q.room.get(roomId);
    if (!room) return fail(404, 'room not found');
    if (room.archived_at) return fail(400, 'room is archived');
    const participant = q.participant.get(roomId, agentId);
    if (!participant) return fail(403, 'agent is not a participant in this room');

    const threadId = data.thread_id ? parseInt(data.thread_id) : null;
    if (threadId) {
      const threadErr = resolveThread(roomId, threadId);
      if (threadErr) return fail(400, threadErr);
    }

    if (eventId) {
      const existing = q.byEvent.get(roomId, eventId);
      if (existing) {
        if (existing.content !== content) return fail(409, 'event_id conflict: content mismatch');
        return ok({ message_id: existing.id, idempotent: true });
      }
    }

    let subAgent = null;
    if (data.sub_agent_id != null) {
      const saId = Number(data.sub_agent_id);
      if (!Number.isInteger(saId) || saId <= 0) return fail(400, 'invalid sub_agent_id');
      subAgent = q.ownSubAgent.get(saId, agentId);
      if (!subAgent) return fail(403, 'sub-agent not found for this agent');
    }
    const attachments = [];
    if (data.attachments != null) {
      if (!Array.isArray(data.attachments) || data.attachments.length > 10) return fail(400, 'attachments must be an array of at most 10 items');
      for (const a of data.attachments) {
        const okUrl = typeof a?.url === 'string' && /^\/uploads\/[A-Za-z0-9._-]+$/.test(a.url) && !a.url.includes('..');
        const okName = typeof a?.name === 'string' && a.name.length > 0 && a.name.length <= 255;
        if (!okUrl || !okName) return fail(400, 'invalid attachment (url must be an /uploads/ file, name 1-255 chars)');
        if (!fs.existsSync(path.join(uploadsDir, a.url.slice('/uploads/'.length)))) return fail(400, `attachment not found: ${a.url}`);
        attachments.push({ url: a.url, name: a.name, type: a.type === 'image' ? 'image' : 'file' });
      }
    }
    const single = attachments.length === 1 ? attachments[0] : null;
    const messageId = q.insert.run(roomId, participant.id, content, eventId, threadId, subAgent?.id ?? null, subAgent?.label ?? null,
      single?.url ?? null, single?.name ?? null, attachments.length > 1 ? JSON.stringify(attachments) : null).lastInsertRowid;

    const row = q.full.get(messageId);
    enrichAutomation(row);
    broadcast(roomId, { type: 'message_new', message: row });
    broadcastGlobal({ type: 'room_activity', room_id: roomId });
    // Cascade @mentions (fire-and-forget). At room level, sub-agent replies go under this message.
    cascadeMentions(roomId, agentId, content, threadId || Number(messageId), subAgent?.id ?? null)
      .catch(e => console.error('[proactive-cascade]', e.message));
    return ok({ message_id: messageId });
  }

  // Room feed. scopeAll=false → thread roots (+ broadcast thread replies) with a thread summary each.
  // before → the `limit` rows shown just above that message; else up to 500 rows shown after `since`.
  function feed(roomId, { before = null, since = 0, limit = 50, scopeAll = false } = {}) {
    const mode = scopeAll ? 'all' : 'roots';
    const rows = before
      ? q.feedBefore[mode].all({ room: roomId, cur: toCursor(before), limit })
      : q.feedSince[mode].all({ room: roomId, cur: toCursor(since) });
    const enriched = enrichReply(rows);
    enrichAutomationList(enriched);
    if (!scopeAll) enriched.forEach(enrichThreadData);
    return ok(enriched);
  }

  function threads(roomId, state) {
    if (!q.room.get(roomId)) return fail(404, 'room not found');
    if (state !== 'active') return ok(q.threadsAll.all(roomId));
    const running = new Map();
    for (const { thread_id: tid, ...run } of q.threadsRunning.all(roomId)) {
      if (!running.has(tid)) running.set(tid, []);
      running.get(tid).push(run);
    }
    return ok(q.threadsActive.all(roomId).map(t => ({ ...t, running: running.get(t.id) || [] })));
  }

  function thread(roomId, rootId, { before = null, limit = 100 } = {}) {
    const root = q.threadRoot.get(rootId, roomId);
    if (!root) return fail(404, 'thread root not found');
    const messages = (before ? q.threadBefore.all({ root: rootId, room: roomId, cur: toCursor(before), limit }) : q.threadLatest.all(rootId, roomId, limit)).reverse();
    for (const m of messages) {
      if (!m.reply_to) continue;
      const replied = q.replied.get(m.reply_to);
      if (replied) m.reply_msg = { content: replied.content?.substring(0, 300), actor_name: replied.actor_name };
    }
    enrichAutomation(root);
    enrichAutomationList(messages);
    return ok({ thread_id: rootId, root, messages });
  }

  return { send, feed, threads, thread };
}

module.exports = { createRoomMessages };
