'use strict';
// Task board runner: takes Backlog cards of a room in rank order and runs each one as its own thread
// (root = the "from task" message, provider 'task'), up to the room's concurrency. Lives on the server,
// independent of any open UI: a room keeps running while the owner looks at another room.
//
// Design decisions (pre-empting audit findings):
//   • Tick triggers: play, a run ending, concurrency up, a card entering Backlog, a dependency finishing
//     (lib/room-tasks.js kicks), plus the poll loop (retries after a thread_limit / an offline agent).
//   • Never at startup on its own: reap() turns every runner off (no new card starts until the owner presses
//     Play again: nobody has seen the board since the restart, and the interrupted cards wait for their
//     recovery first). A restart does not touch a running card (col, status, thread_id, message_id, no
//     event): its work is resumed in the same thread (self-healing 3/3) rather than lost or run twice.
//     Until then a card that was running before the restart is in a grace period (restartGraceMs from
//     reap): its thread is quiet only because the process died, so the quiet / no-reply / maxMs checks
//     skip it. Activity in its thread ends the grace and the normal checks resume: the thread busy (the
//     agent reconnected and revived the run, server.js agent_connect), a new agent reply, or the reply
//     the restart stamped '(interrupted)' no longer being so (the agent replayed its agent_complete /
//     agent_error for it after reconnecting: same message id, so the id alone would miss it).
//     No activity by the end of the grace, by the room's completion_mode (read live):
//       'quiet' → back to Backlog with RESTART_UNRECOVERED (returnToBacklog): the quiet check would
//         otherwise finish the card from the reply the restart cut off.
//       'agent' → the card stays running and only the grace ends: a long quiet thread is normal in that
//         mode (the agent waits on a test suite / deploy in the background, on a machine the server
//         restart did not touch), so the usual safety net takes over, its maxMs clock counted from the end
//         of the grace (AGENT_UNDECIDED → Awaiting).
//   • returnToBacklog(roomId, taskId, reason): a running card back to Backlog, idle, in its place, with an
//     event 'stopped' that names the reason (recovery failed / its limit passed). Its thread stays linked.
//     It does not abort a turn: the caller uses it when nothing runs in the thread any more (Stop aborts).
//   • A card keeps its thread across moves. Started again (runner or an agent's claim) after it went back
//     to Backlog without an outcome (Stop, returnToBacklog, an agent's release) or out of Awaiting /
//     Finished, the run continues in that thread: the task message is posted as a reply there, so the
//     agent has the earlier work in context. A new thread only when the old one is gone (root deleted) or
//     after stoa__task_retry: a failed run is retried from scratch (lib/room-tasks.js retry clears it).
//     The run's checks only count agent replies after its own task message (lastReply), not the earlier run's.
//   • A card whose dependencies are not all Finished is skipped without moving: it keeps its place and
//     becomes eligible the moment the dependency finishes.
//   • How a run ends is the room's completion_mode (room_task_settings), read live on every check:
//     'quiet' (default) — done = the card's thread is quiet: no run in flight, no queued message, no
//       pending wake or retrigger, for settleMs in a row (a reply that @mentions another agent starts the
//       next turn within that window). The last agent reply then decides: complete → Finished
//       (result_summary), error → failed. An agent may end the run earlier with stoa__task_complete /
//       _block / _fail; a later quiet thread is then a no-op (finish is pinned to the run's thread and
//       status 'running'). stoa__task_complete marks the card's thread complete in both modes
//       (lib/room-tasks.js complete; the mark waits until the agent turn is over, lib/thread-complete-defer.js).
//     'agent' — a quiet thread ends nothing (a turn can end while a deploy / test suite still runs in the
//       background, or while the agent waits for a human). Only stoa__task_complete (Finished, thread
//       marked complete), _block (Awaiting) or _fail (failed) end it, and only from the agent the
//       card was given to (lib/room-tasks.js checkWorking). No reminder is posted: a quiet thread is the
//       normal state of an agent waiting on a background job or a human, and a reminder would only start a
//       wasted turn. One safety net for an agent that forgets or crashes: maxMs of quiet (counted from the
//       moment the thread went quiet) → the card goes to Awaiting, reason AGENT_UNDECIDED (status
//       'blocked', the thread is not marked complete; pinned to the run's thread like finish). Any activity
//       (a run, a wake, a message: the thread turning busy, or a new agent reply between polls) restarts
//       the clock.
//     Switching mode while cards run: the other mode's timers are dropped, so a card starts the new
//     mode's clock from zero (quiet→agent: no card finishes from quiet any more; agent→quiet: the card
//     settles settleMs after it is next seen quiet). The instruction already posted in a card's message
//     keeps the old mode's wording.
//   • noReplyMs applies in both modes: a card whose thread has no agent reply at all fails after it.
//   • Stop aborts the turns of every running card (the same cancel path as the stop button) and puts the
//     cards back in Backlog where they were. Idempotent.
//   • A card an agent started itself (claimed_by_actor_id set, no thread) is the agent's: no quiet-thread
//     or no-reply check and the startup reaper keeps it running (no server-side turn carries it). It still
//     takes a concurrency slot, and Stop puts it back in Backlog like any running card.
//   • Nothing runnable and nothing running → the runner turns itself off with idle_reason
//     'empty' (Backlog done) | 'blocked' (only dependency-blocked / failed / awaiting cards left) |
//     'error' (archived room, no agent to run a card, agent offline); last_error says which.

// The task message is short on purpose: the card (description, checklist) lives on the board and the agent
// reads it with stoa__task_get. The per-room completion rule lives in the tool descriptions (lib/room-tasks.js);
// only completion_mode 'agent' adds its marker here, since a tool description cannot know the room's mode.
const TEXT = {
  en: {
    task: (seq, title) => `Execute task #${seq}: ${title}`,
    read: id => `task_id ${id} · read the card with stoa__task_get before you start`,
    agent: 'ends only with stoa__task_complete / _block / _fail',
  },
  id: {
    task: (seq, title) => `Kerjakan task #${seq}: ${title}`,
    read: id => `task_id ${id} · baca kartunya dengan stoa__task_get sebelum mulai`,
    agent: 'selesai hanya lewat stoa__task_complete / _block / _fail',
  },
  ja: {
    task: (seq, title) => `タスク #${seq} を実行: ${title}`,
    read: id => `task_id ${id} · 開始前に stoa__task_get でカードを読んでください`,
    agent: '終了は stoa__task_complete / _block / _fail のみ',
  },
  ko: {
    task: (seq, title) => `작업 #${seq} 실행: ${title}`,
    read: id => `task_id ${id} · 시작하기 전에 stoa__task_get으로 카드를 읽으세요`,
    agent: 'stoa__task_complete / _block / _fail로만 끝남',
  },
  zh: {
    task: (seq, title) => `执行任务 #${seq}：${title}`,
    read: id => `task_id ${id} · 开始前请用 stoa__task_get 读取卡片`,
    agent: '仅通过 stoa__task_complete / _block / _fail 结束',
  },
};

// The title is plain text on the board, but the message is rendered as markdown: a title like `<img src=x>`
// or `**x**` must show (and reach the agent) as typed. A code span keeps the text byte-for-byte for the
// agent, unlike backslash escapes; text without such characters stays plain.
const MD_ACTIVE = /[\\`*_[\]<>~&!|]/;
function literal(text) {
  if (!MD_ACTIVE.test(text)) return text;
  const fence = '`'.repeat(Math.max(0, ...(text.match(/`+/g) || []).map(r => r.length)) + 1);
  const pad = /^[` ]|[` ]$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

// The message the runner posts for a card (also what the owner sees in the room): title + task_id only.
// mode = the room's completion_mode ('quiet' | 'agent').
function composeTaskMessage(task, { lang = 'en', subAgentLabel = null, mode = 'quiet' } = {}) {
  const L = Object.hasOwn(TEXT, lang) ? TEXT[lang] : TEXT.en;
  const head = `${subAgentLabel ? `@${subAgentLabel} ` : ''}**${L.task(task.seq, literal(task.title))}**`;
  return `${head}\n(${L.read(task.id)}${mode === 'agent' ? ` · ${L.agent}` : ''})`;
}

const SUMMARY_MAX = 500;
const REASON_MAX = 1000;
const AGENT_UNDECIDED = 'the agent did not decide (no stoa__task_complete / _block / _fail before the time limit)';
const RESTART_UNRECOVERED = 'not resumed after the server restart (no activity in its thread within the recovery grace period)';

// dispatch(roomId, text, automation, threadId) posts the owner-side message: a new thread root when
// threadId is null, else a reply in that thread (a card that keeps the thread of an interrupted run).
function createRoomTasksRunner({
  db, tasks, dispatch, threadBusy, abortThread, agentOnline, primaryActorId, agentLang = () => 'en',
  settleMs = 3000, noReplyMs = 120000, maxMs = 10800000, restartGraceMs = 600000, log = console,
}) {
  const T = tasks.run;
  const q = {
    room: db.prepare('SELECT id, archived_at, max_active_threads FROM rooms WHERE id=?'),
    human: db.prepare(`SELECT 1 FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.room_id=? AND a.type='human' LIMIT 1`),
    aiParticipant: db.prepare(`SELECT 1 FROM room_participants rp JOIN actors a ON a.id=rp.actor_id
      WHERE rp.room_id=? AND rp.actor_id=? AND a.type='ai'`),
    subAgent: db.prepare(`SELECT sa.label FROM room_sub_agents rsa JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
      WHERE rsa.room_id=? AND sa.id=? AND sa.parent_actor_id=? AND sa.enabled=1`),
    activeThreads: db.prepare(`SELECT COUNT(DISTINCT thread_id) AS c FROM messages
      WHERE room_id=? AND thread_id IS NOT NULL AND state IN ('streaming','requesting')`),
    runningOf: db.prepare("SELECT id, thread_id FROM room_tasks WHERE room_id=? AND status='running'"),
    runningAll: db.prepare(`SELECT id, room_id, seq, thread_id, assignee_actor_id, assignee_sub_agent_id,
        (julianday('now') - julianday(started_at)) * 86400000 AS age_ms
      FROM room_tasks WHERE status='running' AND claimed_by_actor_id IS NULL`),
    candidates: db.prepare(`SELECT t.*, EXISTS (SELECT 1 FROM room_task_deps d JOIN room_tasks x ON x.id=d.depends_on_id
        WHERE d.task_id=t.id AND x.col<>'finished') AS waiting
      FROM room_tasks t WHERE t.room_id=? AND t.col='backlog' AND t.status='idle' ORDER BY t.rank, t.id`),
    leftover: db.prepare(`SELECT COUNT(*) AS c FROM room_tasks WHERE room_id=? AND (col='awaiting' OR (col='backlog' AND status IN ('idle','failed')))`),
    runningRooms: db.prepare('SELECT room_id FROM room_task_settings WHERE running=1'),
    // The newest agent reply of the current run: after the card's newest task message in its thread (the
    // root, or the reply a run posted when it continued the thread of an earlier one; idx_messages_task_id).
    lastReply: db.prepare(`SELECT m.id, m.state, m.content, json_extract(m.result_meta, '$.exit_reason') AS exit_reason FROM messages m JOIN room_participants rp ON rp.id=m.participant_id
      JOIN actors a ON a.id=rp.actor_id WHERE m.thread_id=? AND m.room_id=? AND a.type='ai' AND m.state IN ('complete','error')
        AND m.id > (SELECT COALESCE(MAX(x.id), 0) FROM messages x WHERE x.task_id=? AND x.room_id=? AND (x.id=? OR x.thread_id=?))
      ORDER BY m.id DESC LIMIT 1`),
    reapRunning: db.prepare("SELECT id, room_id, thread_id FROM room_tasks WHERE status='running' AND claimed_by_actor_id IS NULL"),
    reapSettings: db.prepare('UPDATE room_task_settings SET running=0 WHERE running=1'),
  };
  const quietSince = new Map(); // taskId → ms the thread was first seen quiet ('quiet' mode)
  // taskId → 'agent' mode clock: { since: start of the quiet spell, lastId: newest agent reply id when last
  // seen }. A new agent reply counts as activity even when its whole turn fell between two polls.
  const decide = new Map();
  // taskId → { until, lastId }: restart grace of a card that was running before the restart (see header).
  const recovering = new Map();
  const forget = (taskId) => { quietSince.delete(taskId); decide.delete(taskId); recovering.delete(taskId); };
  const lastReplyOf = (r) => q.lastReply.get(r.thread_id, r.room_id, r.id, r.room_id, r.thread_id, r.thread_id);

  // The runner turns itself off and tells the room why.
  function idle(roomId, reason, error = null) {
    T.writeSettings(roomId, { running: 0, last_error: error });
    T.setIdleReason(roomId, reason);
    T.pushSettings(roomId);
  }

  function startCard(roomId, card, target, subLabel, mode) {
    if (!T.start(roomId, card.id)) return false;
    const task = tasks.get(roomId, card.id).body;
    const thread = task.thread_id ?? null; // kept from an earlier run: continue there (see header)
    const text = composeTaskMessage(task, { lang: agentLang(target), subAgentLabel: subLabel, mode });
    const automation = { id: null, name: task.title, provider: 'task', target_actor_id: target, task_id: task.id, task_seq: task.seq };
    T.pushTask(roomId, card.id);
    T.pushSettings(roomId);
    const failRun = (reason) => {
      try { T.finish(roomId, card.id, { ok: false, reason }, T.SYSTEM, thread); }
      catch (e) { log.error(`[tasks] room ${roomId} task ${card.id} could not be marked failed:`, e.message); }
    };
    Promise.resolve()
      .then(() => dispatch(roomId, text, automation, thread))
      .then((msgId) => {
        if (!msgId) failRun('the task message was not delivered');
        else if (!thread) T.attach(roomId, card.id, msgId);
      })
      .catch((e) => {
        log.error(`[tasks] room ${roomId} task ${card.id} dispatch error:`, e.message);
        failRun(`dispatch error: ${String(e.message).slice(0, 200)}`);
      });
    return true;
  }

  function tick(roomId) {
    const s = T.settings(roomId);
    if (!s.running) return;
    const room = q.room.get(roomId);
    if (!room) return;
    if (room.archived_at) return idle(roomId, 'error', 'room is archived');
    if (!q.human.get(roomId)) return idle(roomId, 'error', 'room has no human participant');
    const running = q.runningOf.all(roomId).length;
    let slots = s.concurrency - running;
    let started = 0;
    let lastError = null;
    if (slots > 0) {
      // Each run opens a thread; at the room's cap the message would be stored but not run.
      let free = (room.max_active_threads ?? 3) - q.activeThreads.get(roomId).c;
      if (free <= 0) {
        if (s.last_error !== 'thread_limit') { T.writeSettings(roomId, { last_error: 'thread_limit' }); T.pushSettings(roomId); }
        return;
      }
      for (const card of q.candidates.all(roomId)) {
        if (slots <= 0 || free <= 0) break;
        if (card.waiting) continue;
        const target = card.assignee_actor_id ?? primaryActorId(roomId);
        if (!target || !q.aiParticipant.get(roomId, target)) { lastError = `task #${card.seq}: no AI agent in this room to run it`; continue; }
        let subLabel = null;
        if (card.assignee_sub_agent_id != null) {
          subLabel = q.subAgent.get(roomId, card.assignee_sub_agent_id, target)?.label ?? null;
          if (!subLabel) { lastError = `task #${card.seq}: its sub-agent is no longer linked to this room`; continue; }
        }
        if (!agentOnline(target)) { lastError = `task #${card.seq}: agent is offline`; continue; }
        if (startCard(roomId, card, target, subLabel, s.completion_mode)) { slots--; free--; started++; }
      }
    }
    if (running + started > 0) {
      if (lastError !== s.last_error && (lastError || s.last_error)) { T.writeSettings(roomId, { last_error: lastError }); T.pushSettings(roomId); }
      return;
    }
    if (lastError) return idle(roomId, 'error', lastError);
    return idle(roomId, q.leftover.get(roomId).c > 0 ? 'blocked' : 'empty');
  }

  function safeTick(roomId) {
    try { tick(roomId); } catch (e) { log.error(`[tasks] room ${roomId} tick error:`, e.message); }
  }

  // 'agent' mode, thread quiet with a reply: Awaiting after maxMs of quiet (see header).
  function checkUndecided(r, last, now) {
    const st = decide.get(r.id);
    if (!st || last.id !== st.lastId) { decide.set(r.id, { since: now, lastId: last.id }); return; }
    if (now - st.since >= maxMs) undecided(r);
  }

  function undecided(r) {
    decide.delete(r.id);
    T.block(r.room_id, r.id, AGENT_UNDECIDED, T.SYSTEM, r.thread_id);
  }

  // Restart grace (see header): { lastId, interrupted } = the newest agent reply of the run and whether it
  // carries the server's interrupted stamp. Anything else seen later is activity.
  const replyMark = (r) => {
    const last = r.thread_id ? lastReplyOf(r) : null;
    return { lastId: last?.id ?? null, interrupted: last?.exit_reason === 'interrupted' };
  };

  // → true while the checks must leave the card alone (see header).
  function inGrace(r, now, mode) {
    const rec = recovering.get(r.id);
    if (!rec) return false;
    if (r.thread_id) {
      const mark = replyMark(r);
      if (threadBusy(r.room_id, r.thread_id) || mark.lastId !== rec.lastId || mark.interrupted !== rec.interrupted) {
        recovering.delete(r.id);
        return false;
      }
    }
    if (now < rec.until) return true;
    recovering.delete(r.id);
    if (mode === 'agent') return false;
    returnToBacklog(r.room_id, r.id, RESTART_UNRECOVERED);
    return true;
  }

  // Ends runs whose thread went quiet (see header). Called by the poll loop and on a room's idle event.
  function checkRuns(roomId = null) {
    const now = Date.now();
    const rows = q.runningAll.all();
    const live = new Set(rows.map(r => r.id));
    for (const id of [...quietSince.keys(), ...decide.keys(), ...recovering.keys()]) if (!live.has(id)) forget(id);
    const modes = new Map();
    const modeOf = (rid) => {
      if (!modes.has(rid)) modes.set(rid, T.settings(rid).completion_mode);
      return modes.get(rid);
    };
    for (const r of rows) {
      if (roomId != null && r.room_id !== roomId) continue;
      try {
        if (inGrace(r, now, modeOf(r.room_id))) continue;
        if (!r.thread_id) {
          // Claimed but the message never got an id (dispatch still pending or lost).
          if (r.age_ms > noReplyMs) T.finish(r.room_id, r.id, { ok: false, reason: 'the task message was not delivered' }, T.SYSTEM, null);
          continue;
        }
        const agentMode = modeOf(r.room_id) === 'agent';
        // Switching mode drops the other mode's clock: the card starts the new mode from zero.
        if (agentMode) quietSince.delete(r.id); else decide.delete(r.id);
        if (threadBusy(r.room_id, r.thread_id)) {
          forget(r.id); // activity: the quiet clock restarts
          continue;
        }
        const last = lastReplyOf(r);
        if (!last) {
          if (r.age_ms > noReplyMs) T.finish(r.room_id, r.id, { ok: false, reason: 'no reply from the agent' }, T.SYSTEM, r.thread_id);
          continue;
        }
        if (agentMode) { checkUndecided(r, last, now); continue; }
        if (!quietSince.has(r.id)) { quietSince.set(r.id, now); continue; }
        if (now - quietSince.get(r.id) < settleMs) continue;
        quietSince.delete(r.id);
        const content = String(last.content || '').trim();
        if (last.state === 'complete') T.finish(r.room_id, r.id, { ok: true, summary: content.slice(0, SUMMARY_MAX) || null }, T.SYSTEM, r.thread_id);
        else T.finish(r.room_id, r.id, { ok: false, reason: (content || 'the agent run ended with an error').slice(0, REASON_MAX) }, T.SYSTEM, r.thread_id);
      } catch (e) {
        log.error(`[tasks] task ${r.id} check error:`, e.message);
      }
    }
  }

  function poll() {
    checkRuns();
    for (const { room_id } of q.runningRooms.all()) safeTick(room_id);
  }

  // ── Owner controls (human only; lib/room-tasks.js access() already ran) ──
  const result = (roomId) => ({ status: 200, body: { settings: T.settings(roomId), counts: T.counts(roomId) } });
  const humanOnly = (who) => (T.isHuman(who) ? null : { status: 403, body: { error: 'only a human controls the runner' } });

  function play(roomId, who) {
    const denied = humanOnly(who);
    if (denied) return denied;
    T.writeSettings(roomId, { running: 1, last_error: null });
    T.pushSettings(roomId);
    safeTick(roomId);
    return result(roomId);
  }

  function pause(roomId, who) {
    const denied = humanOnly(who);
    if (denied) return denied;
    T.writeSettings(roomId, { running: 0 });
    T.setIdleReason(roomId, null);
    T.pushSettings(roomId);
    return result(roomId);
  }

  function stop(roomId, who) {
    const denied = humanOnly(who);
    if (denied) return denied;
    T.writeSettings(roomId, { running: 0 });
    T.setIdleReason(roomId, null);
    for (const r of q.runningOf.all(roomId)) {
      if (r.thread_id) {
        try { abortThread(roomId, r.thread_id); } catch (e) { log.error(`[tasks] task ${r.id} abort error:`, e.message); }
      }
      forget(r.id);
      T.returnToBacklog(roomId, r.id, 'stopped by user', who);
    }
    T.pushSettings(roomId);
    return result(roomId);
  }

  // A running card back to Backlog with a reason (see header) → { status, body } like the owner controls.
  function returnToBacklog(roomId, taskId, reason) {
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (!text || text.length > REASON_MAX) return { status: 400, body: { error: `reason required (1-${REASON_MAX} characters)` } };
    if (!T.returnToBacklog(roomId, taskId, text)) return { status: 409, body: { error: 'task is not running' } };
    forget(taskId);
    T.pushSettings(roomId);
    setImmediate(() => safeTick(roomId));
    return { status: 200, body: tasks.get(roomId, taskId).body };
  }

  // Startup: every runner off; running cards stay as they are, in their restart grace (see header). A card
  // an agent started itself is not checked by the runner at all: it stays the agent's. Runs after
  // cleanupStartupOrphans (server.js), so a reply that was in flight is already stamped interrupted here.
  function reap() {
    const until = Date.now() + restartGraceMs;
    const rows = q.reapRunning.all();
    for (const r of rows) recovering.set(r.id, { until, ...replyMark(r) });
    const off = q.reapSettings.run().changes;
    return { interrupted: rows.length, runnersOff: off };
  }

  tasks.run.onKick((roomId) => setImmediate(() => safeTick(roomId)));

  return { tick: safeTick, checkRuns, poll, play, pause, stop, reap, returnToBacklog };
}

module.exports = { createRoomTasksRunner, composeTaskMessage, AGENT_UNDECIDED, RESTART_UNRECOVERED };
