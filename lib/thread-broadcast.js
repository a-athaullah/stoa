'use strict';

const { MESSAGE_BY_ID } = require('./room-messages');

const BROADCAST_VALID_REASONS = new Set(['automation_match', 'error', 'limit']);
const LIMIT_PATTERN = /\b(rate.?limit(?:s|ed)?|429|quota.?exceed(?:ed|s)?|usage.?limit(?:s|ed)?|too.?many.?requests)\b/i;
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
    const row = db.prepare(MESSAGE_BY_ID).get(messageId);
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

  function maybeBroadcastError({ threadId, subAgentId, messageId, content, roomId, reason }) {
    if (!threadId || subAgentId) return false;
    if (!canBroadcastError(threadId)) return false;
    const r = reason || classifyBroadcastError(content);
    setBroadcastReason(messageId, r, roomId);
    return true;
  }

  // A run that ends complete after all (revived after a disconnect, or a result past the timeout)
  // is no longer an error: drop its error/limit echo from the room feed. automation_match stays.
  function clearErrorBroadcast(messageId, roomId) {
    const r = db.prepare("UPDATE messages SET broadcast_reason=NULL WHERE id=? AND broadcast_reason IN ('error','limit') RETURNING thread_id").get(messageId);
    if (!r) return false;
    broadcastToRoom(roomId, { type: 'message_broadcast_cleared', message_id: Number(messageId), thread_id: r.thread_id });
    return true;
  }

  return { setBroadcastReason, emitBroadcast, canBroadcastError, getThreadRootPreview, maybeBroadcastError, clearErrorBroadcast };
}

module.exports = { createThreadBroadcast, classifyBroadcastError, BROADCAST_VALID_REASONS, BROADCAST_FLOOD_MS };
