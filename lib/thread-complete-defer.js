'use strict';
// Marks a thread complete without losing to the agent's own closing reply.
//
// A thread's complete mark covers the replies that exist when it is written (thread_completed_through);
// any later reply reopens it. When an agent calls stoa__task_complete mid-turn, its final answer (and any
// proactive message) lands AFTER the mark and would reopen the thread at once. So a completion requested
// from inside a running turn waits for that turn to end, then marks the thread complete through the last
// message that exists by then (a failed or cancelled turn still ends the turn, so it is marked as well).
// A completion with no turn running, or one a human asks for, is written immediately.
//
//   turnActive(roomId, rootId) -> bool   an agent turn is running in that thread
//   complete(roomId, rootId)             writes the mark (and tells the room)
function createThreadCompleteDefer({ turnActive, complete, log = console }) {
  const pending = new Set();
  const key = (roomId, rootId) => `${roomId}:${rootId}`;
  const run = (roomId, rootId) => {
    try { complete(roomId, rootId); } catch (e) { log.error(`[thread-complete] ${roomId}:${rootId}:`, e.message); }
  };
  return {
    // fromTurn: the request comes from an agent tool call (not from a human).
    request(roomId, rootId, { fromTurn = false } = {}) {
      if (fromTurn && turnActive(roomId, rootId)) { pending.add(key(roomId, rootId)); return 'deferred'; }
      run(roomId, rootId);
      return 'done';
    },
    // Call when a turn in the thread has ended, whatever the outcome.
    turnEnded(roomId, rootId) {
      if (pending.delete(key(roomId, rootId))) run(roomId, rootId);
    },
    // A human mark or reopen supersedes a completion still waiting for the turn.
    cancel(roomId, rootId) { pending.delete(key(roomId, rootId)); },
    pendingCount: () => pending.size,
  };
}

module.exports = { createThreadCompleteDefer };
