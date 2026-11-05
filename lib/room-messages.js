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

const MSG_COLS = `m.*, rp.actor_id, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type,
  sa.avatar_color AS sub_agent_avatar_color, sa.avatar_symbol AS sub_agent_avatar_symbol, sa.avatar_url AS sub_agent_avatar_url, sa.role AS sub_agent_role`;
const MSG_FROM = `FROM messages m
  JOIN room_participants rp ON rp.id=m.participant_id
  JOIN actors a ON a.id=rp.actor_id
  LEFT JOIN sub_agents sa ON sa.id=m.sub_agent_id`;
// One message with its author and sub-agent identity. Every live message event builds its row with
// this, the same columns the feed/thread reads return, so a sub-agent's avatar and role cannot be
// missing live and only appear after a reload.
const MESSAGE_BY_ID = `SELECT ${MSG_COLS} ${MSG_FROM} WHERE m.id=?`;
// The message a reply quotes (reply_msg). Reads and live events both attach it through
// enrichReply, so the quote above a bubble cannot appear only after a reload.
const REPLY_QUOTE = `SELECT m.id, substr(m.content, 1, 300) AS content, m.image_url, m.file_url, m.file_name, m.attachments, a.name as actor_name, a.avatar_color
  FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
  WHERE m.id IN (SELECT value FROM json_each(?))`;
// What a live run event (message_state) carries so a client can draw — or redraw — the bubble.
const RUN_EVENT_FIELDS = ['thread_id', 'actor_id', 'actor_name', 'avatar_color', 'avatar_symbol', 'avatar_url', 'sub_agent_id', 'sub_agent_label',
  'sub_agent_avatar_color', 'sub_agent_avatar_symbol', 'sub_agent_avatar_url', 'sub_agent_role', 'reply_to', 'reply_msg', 'skill_refs'];
// Rows the feed shows: finished messages plus the system notices the history keeps.
const FEED_STATES = `AND (
    (m.state = 'complete' AND (m.content != '' OR m.image_url IS NOT NULL OR m.attachments IS NOT NULL))
    OR (m.state = 'system_event' AND m.content LIKE '% · session compacted')
    OR (m.state = 'system_event' AND m.content LIKE '% · reauth')
    OR (m.state = 'system_event' AND m.content LIKE '% · automation')
    OR (m.state = 'system_event' AND m.content LIKE '% · schedule')
    OR (m.state = 'system_event' AND m.content LIKE '% · config')
    OR (m.state = 'error' AND m.broadcast_reason IS NOT NULL)
    OR (m.state = 'system_event' AND m.broadcast_reason IS NOT NULL)
  )`;
// join_room history: the feed rows plus runs still in flight, so a reload redraws their bubbles.
const HISTORY_STATES = `AND (
    (m.state IN ('complete','streaming','requesting') AND (m.content != '' OR m.image_url IS NOT NULL OR m.attachments IS NOT NULL OR m.state IN ('streaming','requesting')))
    OR (m.state = 'system_event' AND m.content LIKE '% · session compacted')
    OR (m.state = 'system_event' AND m.content LIKE '% · reauth')
    OR (m.state = 'system_event' AND m.content LIKE '% · automation')
    OR (m.state = 'system_event' AND m.content LIKE '% · schedule')
    OR (m.state = 'system_event' AND m.content LIKE '% · config')
    OR (m.state = 'error' AND m.broadcast_reason IS NOT NULL)
    OR (m.state = 'system_event' AND m.broadcast_reason IS NOT NULL)
  )`;
// A thread is complete while its root carries the owner's mark and no reply is newer than the reply
// it was marked through (migrations/20261105-thread-complete.sql). A new reply on any insert path
// reopens it by itself; every read derives the status from this one expression.
const THREAD_COMPLETED = (root) => `(${root}.thread_completed_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM messages rc WHERE rc.thread_id = ${root}.id AND rc.id > ${root}.thread_completed_through))`;
const THREAD_COMPLETED_AT = (root) => `CASE WHEN ${THREAD_COMPLETED(root)} THEN ${root}.thread_completed_at END`;
// Per-root thread summary, roots-only mode.
const THREAD_SUMMARY = `,
  CASE WHEN m.thread_id IS NULL THEN ${THREAD_COMPLETED_AT('m')} END AS thread_done_at,
  CASE WHEN m.thread_id IS NULL THEN (SELECT COUNT(*) FROM messages r WHERE r.thread_id = m.id) END AS thread_count,
  CASE WHEN m.thread_id IS NULL THEN (SELECT MAX(r.created_at) FROM messages r WHERE r.thread_id = m.id) END AS thread_last_at,
  CASE WHEN m.thread_id IS NULL THEN (EXISTS (SELECT 1 FROM messages r WHERE r.thread_id = m.id AND r.state IN ('streaming','requesting'))) END AS thread_active,
  CASE WHEN m.thread_id IS NULL THEN (SELECT GROUP_CONCAT(DISTINCT rp2.actor_id) FROM messages r JOIN room_participants rp2 ON rp2.id=r.participant_id WHERE r.thread_id = m.id) END AS thread_participant_ids,
  CASE WHEN m.thread_id IS NULL THEN (EXISTS (SELECT 1 FROM messages r WHERE r.thread_id = m.id AND r.state = 'error')) END AS thread_has_error,
  CASE WHEN m.thread_id IS NULL THEN (SELECT GROUP_CONCAT(DISTINCT r.sub_agent_label || ':' || rp2.actor_id) FROM messages r JOIN room_participants rp2 ON rp2.id=r.participant_id WHERE r.thread_id = m.id AND r.sub_agent_label IS NOT NULL) END AS thread_sub_agent_participants`;
// Thread list row. completed_at is the derived one: null for an open (or reopened) thread.
const THREADS_WITH_REPLIES = `
  SELECT m.id, m.content, m.created_at, a.name as actor_name,
    (SELECT COUNT(*) FROM messages r WHERE r.thread_id=m.id) as reply_count,
    (SELECT MAX(r2.created_at) FROM messages r2 WHERE r2.thread_id=m.id) as last_reply_at,
    ${THREAD_COMPLETED_AT('m')} as completed_at
  FROM messages m
  JOIN room_participants rp ON rp.id=m.participant_id
  JOIN actors a ON a.id=rp.actor_id
  WHERE m.room_id=? AND m.thread_id IS NULL
    AND EXISTS (SELECT 1 FROM messages r3 WHERE r3.thread_id=m.id)`;
const ROOTS_ONLY = 'AND (m.thread_id IS NULL OR m.broadcast_reason IS NOT NULL)';
// Display order is (feed_pos, id) — see migrations/20261026-message-feed-pos.sql. The before/since
// cursors stay message ids: @cur is resolved to that row's feed_pos (a missing row falls back to the
// id itself, which is what its feed_pos would have been).
const CURSOR = '(COALESCE((SELECT c.feed_pos FROM messages c WHERE c.id=@cur AND c.room_id=@room), @cur), @cur)';
const toCursor = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function createRoomMessages({ db, broadcast, broadcastGlobal, resolveThread, enrichAutomation, enrichAutomationList, getThreadRootPreview, cascadeMentions, enqueueParentWake, uploadsDir }) {
  const q = {
    room: db.prepare('SELECT id, archived_at FROM rooms WHERE id=?'),
    participant: db.prepare('SELECT rp.id FROM room_participants rp WHERE rp.room_id=? AND rp.actor_id=?'),
    byEvent: db.prepare('SELECT id, content FROM messages WHERE room_id=? AND client_event_id=?'),
    ownSubAgent: db.prepare('SELECT id, label FROM sub_agents WHERE id=? AND parent_actor_id=?'),
    // The sub-agent's latest run in this room/thread: a run row is finished (completed_at) or still
    // streaming; a proactive message is neither.
    lastSubAgentRun: db.prepare(`SELECT state, wake_parent FROM messages WHERE room_id=? AND participant_id=? AND sub_agent_id=? AND thread_id IS ?
      AND (completed_at IS NOT NULL OR state='streaming') ORDER BY id DESC LIMIT 1`),
    insert: db.prepare("INSERT INTO messages (room_id, participant_id, content, client_event_id, thread_id, state, sub_agent_id, sub_agent_label, file_url, file_name, attachments) VALUES (?, ?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?)"),
    full: db.prepare(MESSAGE_BY_ID),
    replyQuotes: db.prepare(REPLY_QUOTE),
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
    history: db.prepare(`SELECT * FROM (SELECT ${MSG_COLS} ${THREAD_SUMMARY} ${MSG_FROM}
      WHERE m.room_id=? AND (m.thread_id IS NULL OR (m.broadcast_reason IS NOT NULL AND m.state NOT IN ('streaming','requesting'))) ${HISTORY_STATES}
      ORDER BY m.feed_pos DESC, m.id DESC LIMIT 100) AS recent ORDER BY feed_pos, id`),
    threadsActive: db.prepare(`
      SELECT m.id, m.content, m.created_at, a.name as actor_name,
        (SELECT COUNT(*) FROM messages r WHERE r.thread_id=m.id) as reply_count,
        (SELECT MAX(r2.created_at) FROM messages r2 WHERE r2.thread_id=m.id) as last_reply_at,
        ${THREAD_COMPLETED_AT('m')} as completed_at
      FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id
      JOIN actors a ON a.id=rp.actor_id
      WHERE m.room_id=? AND m.thread_id IS NULL
        AND EXISTS (SELECT 1 FROM messages r3 WHERE r3.thread_id=m.id AND r3.state IN ('streaming','requesting'))
      ORDER BY m.id DESC`),
    // One query for the whole room (no per-thread N+1): who is running in each active thread.
    threadsRunning: db.prepare(`
      SELECT m.thread_id, rp.actor_id, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url,
        m.sub_agent_id, m.sub_agent_label, sa.avatar_color AS sub_agent_avatar_color,
        sa.avatar_symbol AS sub_agent_avatar_symbol, sa.avatar_url AS sub_agent_avatar_url
      FROM messages m
      JOIN room_participants rp ON rp.id=m.participant_id
      JOIN actors a ON a.id=rp.actor_id
      LEFT JOIN sub_agents sa ON sa.id=m.sub_agent_id
      WHERE m.room_id=? AND m.thread_id IS NOT NULL AND m.state IN ('streaming','requesting')
      ORDER BY m.id`),
    // state=all / open / completed: threads with at least one reply, newest reply first.
    threadsAll: db.prepare(`SELECT * FROM (${THREADS_WITH_REPLIES}) ORDER BY last_reply_at DESC NULLS LAST`),
    threadsOpen: db.prepare(`SELECT * FROM (${THREADS_WITH_REPLIES}) WHERE completed_at IS NULL ORDER BY last_reply_at DESC NULLS LAST`),
    threadsCompleted: db.prepare(`SELECT * FROM (${THREADS_WITH_REPLIES}) WHERE completed_at IS NOT NULL ORDER BY last_reply_at DESC NULLS LAST`),
    threadRoot: db.prepare(`SELECT ${MSG_COLS}, ${THREAD_COMPLETED_AT('m')} AS thread_done_at ${MSG_FROM} WHERE m.id=? AND m.room_id=? AND m.thread_id IS NULL`),
    threadStatus: db.prepare(`SELECT ${THREAD_COMPLETED_AT('m')} AS completed_at FROM messages m WHERE m.id=?`),
    lastReply: db.prepare('SELECT MAX(id) AS id FROM messages WHERE thread_id=? AND room_id=?'),
    markComplete: db.prepare("UPDATE messages SET thread_completed_at=datetime('now'), thread_completed_through=? WHERE id=? AND room_id=? AND thread_id IS NULL"),
    markOpen: db.prepare('UPDATE messages SET thread_completed_at=NULL, thread_completed_through=NULL WHERE id=? AND room_id=? AND thread_id IS NULL'),
    threadBefore: db.prepare(`SELECT ${MSG_COLS} ${MSG_FROM} WHERE m.thread_id=@root AND m.room_id=@room AND (m.feed_pos, m.id) < ${CURSOR} ORDER BY m.feed_pos DESC, m.id DESC LIMIT @limit`),
    threadLatest: db.prepare(`SELECT ${MSG_COLS} ${MSG_FROM} WHERE m.thread_id=? AND m.room_id=? ORDER BY m.feed_pos DESC, m.id DESC LIMIT ?`),
  };

  function enrichReply(rows) {
    const ids = [...new Set(rows.filter(r => r.reply_to).map(r => r.reply_to))];
    if (!ids.length) return rows;
    const quoted = new Map(q.replyQuotes.all(JSON.stringify(ids)).map(r => [r.id, r]));
    return rows.map(r => r.reply_to && quoted.has(r.reply_to) ? { ...r, reply_msg: quoted.get(r.reply_to) } : r);
  }

  function row(id) {
    const r = q.full.get(id);
    return r ? enrichReply([r])[0] : r;
  }

  // message_state for a run, its identity read from the row. extra: content/result_meta etc.
  function runState(id, state, extra = {}, r = row(id)) {
    const payload = { type: 'message_state', message_id: Number(id), state };
    if (r) for (const k of RUN_EVENT_FIELDS) payload[k] = r[k] ?? null;
    return { ...payload, ...extra };
  }

  // A run the server ended in error. A notice left in the row (timeout, agent updating, stopped while
  // offline) travels with the event so the bubble shows what a reload shows; no text → bare error.
  function runError(id) {
    const r = row(id);
    if (!r?.content) return { type: 'message_state', message_id: Number(id), state: 'error' };
    return runState(id, 'error', { content: r.content, result_meta: r.result_meta ?? null }, r);
  }

  function enrichThreadData(m) {
    if (m.broadcast_reason && m.thread_id) {
      m.thread_root_preview = getThreadRootPreview(m.thread_id);
      return;
    }
    const sap = m.thread_sub_agent_participants ? m.thread_sub_agent_participants.split(',').map(s => { const [label, aid] = s.split(':'); return { label, actor_id: Number(aid) }; }) : [];
    m.thread = { count: m.thread_count || 0, last_at: m.thread_last_at || null, active: !!m.thread_active, participant_ids: m.thread_participant_ids ? m.thread_participant_ids.split(',').map(Number) : [], has_error: !!m.thread_has_error, sub_agent_participants: sap, completed: m.thread_done_at != null, completed_at: m.thread_done_at ?? null };
    delete m.thread_done_at;
  }

  // Proactive message from an agent (authenticated by the caller). data: content, thread_id,
  // event_id (idempotency key), sub_agent_id + attachments (agent client delivering a turn the CLI
  // ran on its own, under the right identity, with its uploaded [send:] files; unsolicited +
  // background_running mark such a turn, see wakeAfterUnsolicitedTurn).
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

    const newRow = row(messageId);
    enrichAutomation(newRow);
    broadcast(roomId, { type: 'message_new', message: newRow });
    broadcastGlobal({ type: 'room_activity', room_id: roomId });
    // Cascade @mentions (fire-and-forget). At room level, sub-agent replies go under this message.
    cascadeMentions(roomId, agentId, content, threadId || Number(messageId), subAgent?.id ?? null)
      .catch(e => console.error('[proactive-cascade]', e.message));
    if (subAgent && data.unsolicited === true && data.background_running === false) {
      wakeAfterUnsolicitedTurn(roomId, participant.id, subAgent.id, threadId, Number(messageId));
    }
    return ok({ message_id: messageId });
  }

  // A sub-agent run can end while its background task (test suite, render) still runs; the CLI then
  // reports the real result in a turn of its own, which arrives here, not as an agent_complete. That
  // turn wakes the parent as the run's completion would have: only when no background task is left
  // (earlier turns are progress) and only for a run that woke the parent (wake_parent=1 — not one a
  // human mentioned directly). A client that does not send background_running never wakes it.
  function wakeAfterUnsolicitedTurn(roomId, participantId, subAgentId, threadId, messageId) {
    try {
      const run = q.lastSubAgentRun.get(roomId, participantId, subAgentId, threadId);
      if (!run || run.state === 'streaming' || !run.wake_parent) return;
      enqueueParentWake(roomId, participantId, messageId, threadId);
    } catch (e) { console.error('[wake] unsolicited-turn enqueue error:', e.message); }
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

  // The last 100 feed rows a human client gets on join_room. Same thread summary as feed(), so the
  // two cannot drift (a field added to THREAD_SUMMARY/enrichThreadData reaches both).
  function history(roomId) {
    const enriched = enrichReply(q.history.all(roomId));
    enrichAutomationList(enriched);
    enriched.forEach(enrichThreadData);
    return enriched;
  }

  const withStatus = (t) => ({ ...t, completed: t.completed_at != null });

  // state: 'active' (an agent still running), 'open', 'completed'; anything else = every thread with replies.
  function threads(roomId, state) {
    if (!q.room.get(roomId)) return fail(404, 'room not found');
    if (state === 'open') return ok(q.threadsOpen.all(roomId).map(withStatus));
    if (state === 'completed') return ok(q.threadsCompleted.all(roomId).map(withStatus));
    if (state !== 'active') return ok(q.threadsAll.all(roomId).map(withStatus));
    const running = new Map();
    for (const { thread_id: tid, ...run } of q.threadsRunning.all(roomId)) {
      if (!running.has(tid)) running.set(tid, []);
      running.get(tid).push(run);
    }
    return ok(q.threadsActive.all(roomId).map(t => ({ ...withStatus(t), running: running.get(t.id) || [] })));
  }

  // Derived status of one thread root (see THREAD_COMPLETED).
  function threadStatus(rootId) {
    const completedAt = q.threadStatus.get(rootId)?.completed_at ?? null;
    return { completed: completedAt != null, completed_at: completedAt };
  }

  // Owner marks a thread complete (through its newest reply) or reopens it. Caller authorizes and
  // checks the room. Only a root with at least one reply is a thread.
  function setThreadCompleted(roomId, rootId, completed) {
    const through = q.lastReply.get(rootId, roomId)?.id;
    if (!through || !q.threadRoot.get(rootId, roomId)) return fail(404, 'thread not found');
    if (completed) q.markComplete.run(through, rootId, roomId);
    else q.markOpen.run(rootId, roomId);
    return ok({ thread_id: rootId, ...threadStatus(rootId) });
  }

  function thread(roomId, rootId, { before = null, limit = 100 } = {}) {
    const root = q.threadRoot.get(rootId, roomId);
    if (!root) return fail(404, 'thread root not found');
    root.completed = root.thread_done_at != null;
    root.completed_at = root.thread_done_at ?? null;
    delete root.thread_done_at;
    const messages = (before ? q.threadBefore.all({ root: rootId, room: roomId, cur: toCursor(before), limit }) : q.threadLatest.all(rootId, roomId, limit)).reverse();
    const enriched = enrichReply(messages);
    enrichAutomation(root);
    enrichAutomationList(enriched);
    return ok({ thread_id: rootId, root, messages: enriched });
  }

  return { send, feed, history, threads, thread, threadStatus, setThreadCompleted, row, runState, runError, enrichReply };
}

module.exports = { createRoomMessages, MESSAGE_BY_ID };
