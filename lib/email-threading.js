'use strict';

function sanitizeDisplayName(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\r\n\x00-\x1f]/g, '').trim().slice(0, 100);
}

function normalizeRefIds({ inReplyTo, references }) {
  const refs = [inReplyTo, ...(Array.isArray(references) ? references.slice(-49) : [])];
  const filtered = refs.filter(id => id && typeof id === 'string' && id.length <= 500);
  return [...new Set(filtered)].slice(0, 50);
}

function findEmailReplyThread(db, { connId, from, refIds, targetRoomId }) {
  if (!refIds || refIds.length === 0 || !connId) return null;
  const placeholders = refIds.map(() => '?').join(',');
  const matchRow = db.prepare(
    `SELECT emi.thread_id, et.from_address FROM email_message_ids emi
     JOIN email_threads et ON et.thread_id = emi.thread_id
     WHERE emi.message_id IN (${placeholders}) AND emi.connection_id = ?`
  ).get(...refIds, connId);
  if (!matchRow) return null;
  if (from.toLowerCase() !== matchRow.from_address.toLowerCase()) return null;
  const threadRoot = db.prepare('SELECT id, room_id FROM messages WHERE id=?').get(matchRow.thread_id);
  if (!threadRoot || threadRoot.room_id !== targetRoomId) return null;
  return { threadId: matchRow.thread_id, roomId: threadRoot.room_id };
}

module.exports = { sanitizeDisplayName, normalizeRefIds, findEmailReplyThread };
