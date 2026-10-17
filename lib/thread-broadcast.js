'use strict';

const BROADCAST_VALID_REASONS = new Set(['automation_match', 'error', 'limit']);
const LIMIT_PATTERN = /\b(rate.?limit|429|quota.?exceed|usage.?limit|too.?many.?requests)\b/i;
const BROADCAST_FLOOD_MS = 10 * 60 * 1000;

function classifyBroadcastError(content) {
  if (!content || typeof content !== 'string') return 'error';
  return LIMIT_PATTERN.test(content) ? 'limit' : 'error';
}

function createThreadBroadcast({ db, broadcastToRoom, enrichFn, now }) {
  const _flood = new Map();
  const _now = now || (() => Date.now());

  function getThreadRootPreview(threadId) {
    if (!threadId) return null;
    const root = db.prepare('SELECT content FROM messages WHERE id=?').get(threadId);
    if (!root?.content) return null;
    return root.content.slice(0, 80);
  }

  function setBroadcastReason(messageId, reason, roomId) {
    if (!BROADCAST_VALID_REASONS.has(reason)) return false;
    db.prepare('UPDATE messages SET broadcast_reason=? WHERE id=?').run(reason, messageId);
    if (roomId != null) emitBroadcast(roomId, messageId);
    return true;
  }

  function emitBroadcast(roomId, messageId) {
    const row = db.prepare(`
      SELECT m.*, a.name as actor_name, a.avatar_color, a.avatar_symbol, a.avatar_url, a.type as actor_type
      FROM messages m JOIN room_participants rp ON rp.id=m.participant_id JOIN actors a ON a.id=rp.actor_id
      WHERE m.id=?`).get(messageId);
    if (!row) return;
    if (enrichFn) enrichFn(row);
    row.thread_root_preview = getThreadRootPreview(row.thread_id);
    broadcastToRoom(roomId, { type: 'message_broadcast', message: row });
  }

  function canBroadcastError(threadId) {
    const t = _now();
    const last = _flood.get(threadId);
    if (last && t - last < BROADCAST_FLOOD_MS) return false;
    _flood.set(threadId, t);
    if (_flood.size > 500) {
      const cutoff = t - BROADCAST_FLOOD_MS;
      for (const [k, v] of _flood) { if (v < cutoff) _flood.delete(k); }
    }
    return true;
  }

  return { setBroadcastReason, emitBroadcast, canBroadcastError, getThreadRootPreview };
}

module.exports = { createThreadBroadcast, classifyBroadcastError, BROADCAST_VALID_REASONS, BROADCAST_FLOOD_MS };
