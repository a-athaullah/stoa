'use strict';

// Pure helpers for the agent run queue reported by stoa.js (`agent_queue_status`).
// The agent is the only one that knows which triggers wait behind a busy slot,
// so the server keeps its last snapshot and derives positions and timings from it.

const MAX_REPORTED_IDS = 500;

function sanitizeIdList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const v of raw.slice(0, MAX_REPORTED_IDS)) {
    if (Number.isSafeInteger(v) && v > 0 && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

// prev/next: { queued: [id], running: [id] }. Returns
//   positions: queued ids whose 1-based position is new or changed
//   dequeued:  ids that were queued and no longer are (started, cancelled, or finished)
//   started:   ids that are running now and were not running before
function diffRunQueue(prev, next) {
  const prevPos = new Map((prev?.queued || []).map((id, i) => [id, i + 1]));
  const prevRunning = new Set(prev?.running || []);
  const nextQueued = new Set(next.queued);
  const positions = [];
  next.queued.forEach((id, i) => {
    if (prevPos.get(id) !== i + 1) positions.push({ id, position: i + 1 });
  });
  const dequeued = [...prevPos.keys()].filter(id => !nextQueued.has(id));
  const started = next.running.filter(id => !prevRunning.has(id));
  return { positions, dequeued, started };
}

// Durations of one turn from the timestamps the server observed (ms epoch).
// queue_depth: runs ahead of it on the same agent when it arrived (0 = started at once).
// parallel: runs active on the agent (itself included) at the moment it started.
function summarizeRunTiming(t, finishedAt) {
  if (!t || !Number.isFinite(t.started_at)) return null;
  const out = {
    queue_depth: t.queue_depth || 0,
    parallel: t.parallel || 1,
    queue_wait_ms: Math.max(0, t.started_at - (t.arrived_at ?? t.started_at)),
    run_ms: Math.max(0, finishedAt - t.started_at),
  };
  if (Number.isFinite(t.first_token_at)) out.first_token_ms = Math.max(0, t.first_token_at - t.started_at);
  return out;
}

// Run timeout for one dispatched trigger. The server pauses it while the agent reports the run
// as queued and re-arms the full window when it starts, so queue time never counts as a hang.
function createRunTimeout(ms, onTimeout) {
  let timer = null;
  const rearm = () => { clearTimeout(timer); timer = setTimeout(onTimeout, ms); };
  rearm();
  return { pause: () => { clearTimeout(timer); timer = null; }, rearm };
}

module.exports = { sanitizeIdList, diffRunQueue, summarizeRunTiming, createRunTimeout, MAX_REPORTED_IDS };
