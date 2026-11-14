'use strict';
// Marks a thread complete without losing to the agent's own closing reply.
//
// A thread's complete mark covers the replies that exist when it is written (thread_completed_through);
// any later reply reopens it. An agent asks for the mark (stoa__thread_complete, stoa__task_complete) from
// inside one of its turns, and that turn's closing reply lands after the call. So an agent's request waits
// until the requesting agent's turn is over, then marks the thread through the last message by then:
//   - a turn Stoa started (the agent has a run in flight in the thread): the run ends (any outcome);
//   - a turn the CLI ran on its own after a background task (no run, the reply arrives as a proactive
//     POST /message with unsolicited: true): that reply is posted and leaves no background task behind.
// While an agent sequence is still running in the thread, the mark waits for it too (its next replies
// would reopen the thread). A fallback timer, re-armed by every post of the requesting agent in the
// thread, writes the mark once nothing has happened for settleMs and nothing runs there, so a request
// never hangs when no closing reply comes (a turn with no output). A human request is written at once;
// a human mark, reopen or message in the thread drops a waiting request. Pending requests live in
// memory: a server restart drops them (the thread stays open, as before the call).
//
//   seqActive(roomId, rootId) -> bool                          an agent sequence runs in the thread
//   agentRunning(roomId, rootId, actorId, subAgentId) -> bool  that agent has a run in flight there
//   complete(roomId, rootId)                                   writes the mark (and tells the room)
function createThreadCompleteDefer({
  seqActive, agentRunning, complete, settleMs = 10 * 60_000, log = console,
  setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  const pending = new Map();
  const key = (roomId, rootId) => `${roomId}:${rootId}`;
  const run = (roomId, rootId) => {
    try { complete(roomId, rootId); } catch (e) { log.error(`[thread-complete] ${roomId}:${rootId}:`, e.message); }
  };
  const busy = (p) => seqActive(p.roomId, p.rootId) || agentRunning(p.roomId, p.rootId, p.actorId, p.subAgentId);
  const drop = (k) => {
    const p = pending.get(k);
    if (p) { clearTimer(p.timer); pending.delete(k); }
    return p;
  };
  const settle = (k) => { const p = drop(k); if (p) run(p.roomId, p.rootId); };
  const arm = (k, p) => {
    clearTimer(p.timer);
    p.timer = setTimer(() => {
      if (pending.get(k) !== p) return;
      if (busy(p)) arm(k, p); else settle(k);
    }, settleMs);
    p.timer?.unref?.();
  };
  const settleIfReady = (k, p) => { if (p.ready && !seqActive(p.roomId, p.rootId)) settle(k); };

  return {
    // fromTurn: an agent asked (tool call); actorId / subAgentId = that agent. Otherwise a human: at once.
    request(roomId, rootId, { fromTurn = false, actorId = null, subAgentId = null } = {}) {
      const k = key(roomId, rootId);
      drop(k);
      if (!fromTurn) { run(roomId, rootId); return 'done'; }
      const p = { roomId, rootId, actorId, subAgentId: subAgentId ?? null, ready: false, timer: null };
      // No run of this agent in flight = the call comes from a turn the CLI ran on its own.
      p.inRun = agentRunning(roomId, rootId, p.actorId, p.subAgentId);
      pending.set(k, p);
      arm(k, p);
      return 'deferred';
    },
    // Call when an agent run or an agent sequence in the thread has ended, whatever the outcome.
    turnEnded(roomId, rootId) {
      const k = key(roomId, rootId);
      const p = pending.get(k);
      if (!p) return;
      if (p.inRun && !agentRunning(roomId, rootId, p.actorId, p.subAgentId)) p.ready = true;
      settleIfReady(k, p);
    },
    // Call when an agent posted a message in the thread. final = the closing reply of a turn the CLI ran
    // on its own (unsolicited, no background task left).
    agentPosted(roomId, rootId, actorId, subAgentId, { final = false } = {}) {
      const k = key(roomId, rootId);
      const p = pending.get(k);
      if (!p || p.actorId !== actorId || p.subAgentId !== (subAgentId ?? null)) return;
      arm(k, p);
      if (final && !p.inRun) p.ready = true;
      settleIfReady(k, p);
    },
    // A human mark, reopen or message supersedes a completion still waiting.
    cancel(roomId, rootId) { drop(key(roomId, rootId)); },
    isPending: (roomId, rootId) => pending.has(key(roomId, rootId)),
    pendingCount: () => pending.size,
  };
}

module.exports = { createThreadCompleteDefer };
