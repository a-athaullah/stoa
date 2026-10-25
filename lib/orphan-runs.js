'use strict';

// Self-healing for runs that end without an agent_complete (see server.js "Self-healing:
// wake the parent"). Server-only: takes the db so the startup cleanup can be tested on a
// temp DB (the test suite cannot restart the server).

const INTERRUPTED_RESULT_META = JSON.stringify({ exit_reason: 'interrupted' });
// awaiting_agent rows: sub-agent bubbles errored by the server run timeout while the agent may
// still be running them (AWAITING_AGENT_RESULT_META in server.js).
const RUN_IN_FLIGHT_SQL = "(state IN ('streaming','requesting') OR (state='error' AND sub_agent_id IS NOT NULL AND json_extract(result_meta, '$.awaiting_agent')=1))";
const ORPHAN_WAKE_LIMIT = 3; // interrupted wakes per (thread, sub-agent) per hour
const orphanWakeEnabled = () => process.env.STOA_ORPHAN_WAKE !== 'off';

function createOrphanRuns({ db, postWakeSystemEvent }) {
  // rows: { id, room_id, participant_id, thread_id, sub_agent_id, sub_agent_label }
  function enqueueOrphanWakes(rows) {
    if (!orphanWakeEnabled()) return;
    for (const r of rows) {
      if (!r.sub_agent_id) continue;
      try {
        if (db.prepare('SELECT 1 FROM pending_wakes WHERE sub_agent_message_id=?').get(r.id)) continue;
        // Counts this row too: it is already stamped interrupted with completed_at=now.
        const recent = db.prepare(`SELECT COUNT(*) AS c FROM messages
          WHERE room_id=? AND thread_id IS ? AND sub_agent_id=?
            AND json_extract(result_meta, '$.exit_reason')='interrupted'
            AND completed_at >= datetime('now', '-1 hour')`).get(r.room_id, r.thread_id ?? null, r.sub_agent_id).c;
        if (recent > ORPHAN_WAKE_LIMIT) {
          postWakeSystemEvent(r.room_id, r.participant_id, r.thread_id ?? null,
            `sub-agent ${r.sub_agent_label || 'sub-agent'} terputus berulang (${recent}× dalam 1 jam) — auto-wake dihentikan, butuh manusia`);
          continue;
        }
        db.prepare('INSERT INTO pending_wakes (room_id, parent_participant_id, sub_agent_message_id, thread_id) VALUES (?,?,?,?)')
          .run(r.room_id, r.participant_id, r.id, r.thread_id ?? null);
      } catch (e) { console.error('[wake] orphan enqueue error:', e.message); }
    }
  }

  // On startup every in-flight run is dead: agents keep running across a server restart, and
  // the ones still busy report it on reconnect and are un-orphaned there (agent_connect).
  function cleanupStartupOrphans() {
    const rows = db.prepare(`UPDATE messages SET state='error', result_meta=?, completed_at=datetime('now'), content=CASE WHEN content='' THEN '(interrupted — server restart)' ELSE content END WHERE ${RUN_IN_FLIGHT_SQL} RETURNING id, room_id, participant_id, thread_id, sub_agent_id, sub_agent_label, content`).all(INTERRUPTED_RESULT_META);
    enqueueOrphanWakes(rows);
    return rows;
  }

  return { enqueueOrphanWakes, cleanupStartupOrphans };
}

module.exports = { createOrphanRuns, INTERRUPTED_RESULT_META, RUN_IN_FLIGHT_SQL, orphanWakeEnabled };
