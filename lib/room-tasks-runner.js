'use strict';
// Task board runner: takes Backlog cards of a room in rank order and runs each one as its own thread
// (root = the "from task" message, provider 'task'), up to the room's concurrency. Lives on the server,
// independent of any open UI: a room keeps running while the owner looks at another room.
//
// Design decisions (pre-empting audit findings):
//   • Tick triggers: play, a run ending, concurrency up, a card entering Backlog, a dependency finishing
//     (lib/room-tasks.js kicks), plus the poll loop (retries after a thread_limit / an offline agent).
//   • Never at startup on its own: reap() puts every running card back in Backlog (event 'stopped',
//     reason 'server restart') and turns every runner off; the owner presses Play again.
//   • A card whose dependencies are not all Finished is skipped without moving: it keeps its place and
//     becomes eligible the moment the dependency finishes.
//   • How a run ends is the room's completion_mode (room_task_settings), read live on every check:
//     'quiet' (default) — done = the card's thread is quiet: no run in flight, no queued message, no
//       pending wake or retrigger, for settleMs in a row (a reply that @mentions another agent starts the
//       next turn within that window). The last agent reply then decides: complete → Finished
//       (result_summary), error → failed. An agent may end the run earlier with stoa__task_complete /
//       _block / _fail; a later quiet thread is then a no-op (finish is pinned to the run's thread and
//       status 'running').
//     'agent' — a quiet thread ends nothing (a turn can end while a deploy / test suite still runs in the
//       background, or while the agent waits for a human). Only stoa__task_complete (Finished, and the
//       thread is marked complete), _block (Awaiting) or _fail (failed) end it, and only from the agent the
//       card was given to (lib/room-tasks.js checkWorking). Safety nets for an agent that forgets or
//       crashes, both counted from the moment the thread went quiet:
//         nudgeMs quiet → ONE reminder in the card's thread to that agent (TEXT.nudge);
//         maxMs quiet   → the card goes to Awaiting, reason AGENT_UNDECIDED (status 'blocked', the thread
//                         is not marked complete; pinned to the run's thread like finish).
//       Loop safety: the reminder's own turn (the first busy spell after it was sent) is the reminder's,
//       not new activity: it does not move the maxMs clock, so an agent that answers every reminder
//       without deciding still reaches Awaiting at maxMs. After that turn the thread is quiet again and a
//       next reminder needs nudgeMs of quiet again — at most one reminder per quiet spell, never a burst.
//       Any other activity (a run, a wake, a message: the thread turning busy outside a reminder's turn)
//       resets both clocks.
//     Switching mode while cards run: the other mode's timers are dropped, so a card starts the new
//     mode's clock from zero (quiet→agent: no card finishes from quiet any more; agent→quiet: the card
//     settles settleMs after it is next seen quiet). The instruction already posted in a card's message
//     keeps the old mode's wording; the reminder (agent mode) restates how to end it.
//   • noReplyMs applies in both modes: a card whose thread has no agent reply at all fails after it.
//   • Stop aborts the turns of every running card (the same cancel path as the stop button) and puts the
//     cards back in Backlog where they were. Idempotent.
//   • A card an agent started itself (claimed_by_actor_id set, no thread) is the agent's: no quiet-thread
//     or no-reply check and the startup reaper keeps it running (no server-side turn carries it). It still
//     takes a concurrency slot, and Stop puts it back in Backlog like any running card.
//   • Nothing runnable and nothing running → the runner turns itself off with idle_reason
//     'empty' (Backlog done) | 'blocked' (only dependency-blocked / failed / awaiting cards left) |
//     'error' (archived room, no agent to run a card, agent offline); last_error says which.

const TEXT = {
  en: {
    task: (seq, title) => `Task #${seq}: ${title}`,
    checklist: 'Checklist',
    instruction: (seq, id) => `Work on this task (Task #${seq}, task_id ${id}). Done = your last reply in this thread. `
      + 'If you need a human decision, call stoa__task_block with the reason (or stoa__task_move to "awaiting"). '
      + 'If you cannot finish it, call stoa__task_fail with the reason. Tick checklist items with stoa__task_update.',
    instructionAgent: (seq, id) => `Work on this task (Task #${seq}, task_id ${id}). The task ends only when you call `
      + 'stoa__task_complete (done, with a summary), stoa__task_block (needs a human decision, with the reason) or '
      + 'stoa__task_fail (cannot be done, with the reason). Your last reply does NOT end it: while a background job '
      + 'still runs or you wait for a human decision, do not complete it. Tick checklist items with stoa__task_update.',
    nudge: (seq, id) => `Task #${seq} (task_id ${id}) is not decided yet: call stoa__task_complete, stoa__task_block or stoa__task_fail.`,
  },
  id: {
    task: (seq, title) => `Task #${seq}: ${title}`,
    checklist: 'Checklist',
    instruction: (seq, id) => `Kerjakan task ini (Task #${seq}, task_id ${id}). Selesai = balasan terakhirmu di thread ini. `
      + 'Jika butuh keputusan manusia, panggil stoa__task_block dengan alasannya (atau stoa__task_move ke "awaiting"). '
      + 'Jika tidak bisa diselesaikan, panggil stoa__task_fail dengan alasannya. Centang checklist dengan stoa__task_update.',
    instructionAgent: (seq, id) => `Kerjakan task ini (Task #${seq}, task_id ${id}). Kartu selesai hanya kalau kamu memanggil `
      + 'stoa__task_complete (selesai, dengan ringkasan), stoa__task_block (butuh keputusan manusia, dengan alasannya) atau '
      + 'stoa__task_fail (tidak bisa diselesaikan, dengan alasannya). Balasan terakhirmu TIDAK menyelesaikan kartu: selama '
      + 'proses latar masih jalan atau kamu menunggu keputusan manusia, jangan complete. Centang checklist dengan stoa__task_update.',
    nudge: (seq, id) => `Task #${seq} (task_id ${id}) belum diputuskan: panggil stoa__task_complete, stoa__task_block, atau stoa__task_fail.`,
  },
  ja: {
    task: (seq, title) => `タスク #${seq}: ${title}`,
    checklist: 'チェックリスト',
    instruction: (seq, id) => `このタスクを実行してください（タスク #${seq}、task_id ${id}）。このスレッドでの最後の返信で完了となります。`
      + '人間の判断が必要な場合は理由を添えて stoa__task_block を呼んでください（または stoa__task_move で "awaiting" へ）。'
      + '完了できない場合は理由を添えて stoa__task_fail を呼んでください。チェックリストは stoa__task_update で更新します。',
    instructionAgent: (seq, id) => `このタスクを実行してください（タスク #${seq}、task_id ${id}）。タスクが終わるのは、`
      + 'stoa__task_complete（完了、要約を添えて）、stoa__task_block（人間の判断が必要、理由を添えて）、'
      + 'stoa__task_fail（完了できない、理由を添えて）のいずれかを呼んだときだけです。最後の返信ではタスクは終わりません。'
      + 'バックグラウンド処理が実行中のときや人間の判断を待っているときは complete しないでください。チェックリストは stoa__task_update で更新します。',
    nudge: (seq, id) => `タスク #${seq}（task_id ${id}）はまだ決定されていません。stoa__task_complete、stoa__task_block、stoa__task_fail のいずれかを呼んでください。`,
  },
  ko: {
    task: (seq, title) => `작업 #${seq}: ${title}`,
    checklist: '체크리스트',
    instruction: (seq, id) => `이 작업을 수행하세요 (작업 #${seq}, task_id ${id}). 이 스레드의 마지막 답변이 완료입니다. `
      + '사람의 결정이 필요하면 이유와 함께 stoa__task_block을 호출하세요 (또는 stoa__task_move로 "awaiting"). '
      + '완료할 수 없으면 이유와 함께 stoa__task_fail을 호출하세요. 체크리스트는 stoa__task_update로 체크합니다.',
    instructionAgent: (seq, id) => `이 작업을 수행하세요 (작업 #${seq}, task_id ${id}). 작업은 `
      + 'stoa__task_complete(완료, 요약과 함께), stoa__task_block(사람의 결정 필요, 이유와 함께), '
      + 'stoa__task_fail(완료 불가, 이유와 함께) 중 하나를 호출할 때만 끝납니다. 마지막 답변으로는 끝나지 않습니다. '
      + '백그라운드 작업이 아직 실행 중이거나 사람의 결정을 기다리는 동안에는 complete하지 마세요. 체크리스트는 stoa__task_update로 체크합니다.',
    nudge: (seq, id) => `작업 #${seq} (task_id ${id})이(가) 아직 결정되지 않았습니다: stoa__task_complete, stoa__task_block 또는 stoa__task_fail을 호출하세요.`,
  },
  zh: {
    task: (seq, title) => `任务 #${seq}：${title}`,
    checklist: '检查清单',
    instruction: (seq, id) => `请完成此任务（任务 #${seq}，task_id ${id}）。你在此线程中的最后一条回复即表示完成。`
      + '如需人工决定，请带上原因调用 stoa__task_block（或用 stoa__task_move 移到 "awaiting"）。'
      + '如果无法完成，请带上原因调用 stoa__task_fail。用 stoa__task_update 勾选检查清单。',
    instructionAgent: (seq, id) => `请完成此任务（任务 #${seq}，task_id ${id}）。只有在你调用 `
      + 'stoa__task_complete（完成，附摘要）、stoa__task_block（需要人工决定，附原因）或 '
      + 'stoa__task_fail（无法完成，附原因）时，任务才会结束。你的最后一条回复不会结束任务：'
      + '后台任务仍在运行或在等待人工决定时，不要 complete。用 stoa__task_update 勾选检查清单。',
    nudge: (seq, id) => `任务 #${seq}（task_id ${id}）尚未决定：请调用 stoa__task_complete、stoa__task_block 或 stoa__task_fail。`,
  },
};

// Title and checklist items are plain text on the board, but the message is rendered as markdown: a
// title like `<img src=x>` or `**x**` must show (and reach the agent) as typed. A code span keeps the
// text byte-for-byte for the agent, unlike backslash escapes; text without such characters stays plain.
const MD_ACTIVE = /[\\`*_[\]<>~&!|]/;
function literal(text) {
  if (!MD_ACTIVE.test(text)) return text;
  const fence = '`'.repeat(Math.max(0, ...(text.match(/`+/g) || []).map(r => r.length)) + 1);
  const pad = /^[` ]|[` ]$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

// The description stays markdown, but raw HTML in it shows as text: every unescaped `<` becomes `\<`, so
// no tag or html block can start (an <http(s)://…> autolink is kept; it is never HTML). Lines inside a
// fenced code block opened at column 0 are left alone: such a fence is always top level, so marked agrees
// on where the code starts and ends. Anything less certain is escaped (at worst a visible `\` in code).
function inertHtml(md) {
  let fence = null;
  return md.replace(/\r\n?/g, '\n').split('\n').map((line) => {
    if (fence) {
      const close = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      return line;
    }
    const open = line.match(/^(`{3,}|~{3,})(.*)$/);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) { fence = open[1]; return line; }
    return line.replace(/(\\*)<(https?:\/\/[^\s<>]*>)?/g, (m, bs, autolink) => (autolink || bs.length % 2 ? m : `${bs}\\<`));
  }).join('\n');
}

// The message the runner posts for a card (also what the owner sees in the room).
// mode = the room's completion_mode ('quiet' | 'agent'): it decides what the instruction says ends the card.
function composeTaskMessage(task, { lang = 'en', subAgentLabel = null, mode = 'quiet' } = {}) {
  const L = Object.hasOwn(TEXT, lang) ? TEXT[lang] : TEXT.en;
  const parts = [];
  parts.push(`${subAgentLabel ? `@${subAgentLabel} ` : ''}**${L.task(task.seq, literal(task.title))}**`);
  if (task.description && task.description.trim()) parts.push(inertHtml(task.description.trim()));
  if (task.checklist?.length) {
    parts.push(`${L.checklist}:\n${task.checklist.map(c => `- [${c.done ? 'x' : ' '}] ${literal(c.text)}`).join('\n')}`);
  }
  parts.push(`---\n${(mode === 'agent' ? L.instructionAgent : L.instruction)(task.seq, task.id)}`);
  return parts.join('\n\n');
}

// The reminder the runner posts in a card's thread when the agent has not decided (completion_mode 'agent').
function composeNudgeMessage(task, { lang = 'en', subAgentLabel = null } = {}) {
  const L = Object.hasOwn(TEXT, lang) ? TEXT[lang] : TEXT.en;
  return `${subAgentLabel ? `@${subAgentLabel} ` : ''}${L.nudge(task.seq, task.id)}`;
}

const SUMMARY_MAX = 500;
const REASON_MAX = 1000;
const AGENT_UNDECIDED = 'the agent did not decide (no stoa__task_complete / _block / _fail before the time limit)';

// dispatch(roomId, text, automation, threadId?) posts the owner-side message (threadId: into that thread).
function createRoomTasksRunner({
  db, tasks, dispatch, threadBusy, abortThread, agentOnline, primaryActorId, agentLang = () => 'en',
  settleMs = 3000, noReplyMs = 120000, nudgeMs = 600000, maxMs = 10800000, log = console,
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
    lastReply: db.prepare(`SELECT m.id, m.state, m.content FROM messages m JOIN room_participants rp ON rp.id=m.participant_id
      JOIN actors a ON a.id=rp.actor_id WHERE m.thread_id=? AND m.room_id=? AND m.id<>? AND a.type='ai' AND m.state IN ('complete','error') ORDER BY m.id DESC LIMIT 1`),
    reapRunning: db.prepare("SELECT id, room_id FROM room_tasks WHERE status='running' AND claimed_by_actor_id IS NULL"),
    reapSettings: db.prepare('UPDATE room_task_settings SET running=0 WHERE running=1'),
  };
  const quietSince = new Map(); // taskId → ms the thread was first seen quiet ('quiet' mode)
  // taskId → 'agent' mode clocks: { since: start of the quiet spell (maxMs clock), quietAt: start of the
  // current quiet stretch (nudgeMs clock), nudgeTurn: a reminder was sent and its turn is pending or running
  // (no further reminder meanwhile), sawBusy: that turn was seen, lastId: newest agent reply id when last seen }.
  // A new agent reply counts as activity even when its whole turn fell between two polls. See header.
  const decide = new Map();
  const forget = (taskId) => { quietSince.delete(taskId); decide.delete(taskId); };

  // The runner turns itself off and tells the room why.
  function idle(roomId, reason, error = null) {
    T.writeSettings(roomId, { running: 0, last_error: error });
    T.setIdleReason(roomId, reason);
    T.pushSettings(roomId);
  }

  function startCard(roomId, card, target, subLabel, mode) {
    if (!T.start(roomId, card.id)) return false;
    const task = tasks.get(roomId, card.id).body;
    const text = composeTaskMessage(task, { lang: agentLang(target), subAgentLabel: subLabel, mode });
    const automation = { id: null, name: task.title, provider: 'task', target_actor_id: target, task_id: task.id, task_seq: task.seq };
    T.pushTask(roomId, card.id);
    T.pushSettings(roomId);
    const failRun = (reason) => {
      try { T.finish(roomId, card.id, { ok: false, reason }, T.SYSTEM, null); }
      catch (e) { log.error(`[tasks] room ${roomId} task ${card.id} could not be marked failed:`, e.message); }
    };
    Promise.resolve()
      .then(() => dispatch(roomId, text, automation))
      .then((msgId) => {
        if (msgId) T.attach(roomId, card.id, msgId);
        else failRun('the task message was not delivered');
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

  // 'agent' mode: the reminder goes to the agent the card was given to, in the card's own thread.
  function nudge(r) {
    const target = r.assignee_actor_id ?? primaryActorId(r.room_id);
    if (!target) return;
    let subLabel = null;
    if (r.assignee_sub_agent_id != null) {
      subLabel = q.subAgent.get(r.room_id, r.assignee_sub_agent_id, target)?.label ?? null;
      if (!subLabel) return;
    }
    const text = composeNudgeMessage(r, { lang: agentLang(target), subAgentLabel: subLabel });
    const automation = { id: null, name: `Task #${r.seq}`, provider: 'task', target_actor_id: target, task_id: r.id, task_seq: r.seq };
    Promise.resolve()
      .then(() => dispatch(r.room_id, text, automation, r.thread_id))
      .catch((e) => log.error(`[tasks] room ${r.room_id} task ${r.id} reminder error:`, e.message));
  }

  // 'agent' mode, thread quiet with a reply: reminder at nudgeMs, Awaiting at maxMs (see header).
  function checkUndecided(r, last, now) {
    let st = decide.get(r.id);
    const fresh = { since: now, quietAt: now, nudgeTurn: false, sawBusy: false, lastId: last.id };
    if (st && last.id !== st.lastId) {
      if (st.nudgeTurn) st = { ...st, sawBusy: true, lastId: last.id }; // the reminder's turn answered
      else st = null; // a turn ran unseen between two polls: new activity
    }
    if (!st) { decide.set(r.id, fresh); return; }
    if (st.nudgeTurn) {
      if (!st.sawBusy) {
        // Reminder sent, its turn not seen yet (dispatch pending, or nothing ran): only the maxMs clock runs.
        if (now - st.since >= maxMs) undecided(r);
        return;
      }
      st = { ...st, quietAt: now, nudgeTurn: false, sawBusy: false };
      decide.set(r.id, st);
    }
    if (now - st.since >= maxMs) return undecided(r);
    if (now - st.quietAt >= nudgeMs) {
      decide.set(r.id, { ...st, nudgeTurn: true, sawBusy: false });
      nudge(r);
    }
  }

  function undecided(r) {
    decide.delete(r.id);
    T.block(r.room_id, r.id, AGENT_UNDECIDED, T.SYSTEM, r.thread_id);
  }

  // Ends runs whose thread went quiet (see header). Called by the poll loop and on a room's idle event.
  function checkRuns(roomId = null) {
    const now = Date.now();
    const rows = q.runningAll.all();
    const live = new Set(rows.map(r => r.id));
    for (const id of [...quietSince.keys(), ...decide.keys()]) if (!live.has(id)) forget(id);
    const modes = new Map();
    const modeOf = (rid) => {
      if (!modes.has(rid)) modes.set(rid, T.settings(rid).completion_mode);
      return modes.get(rid);
    };
    for (const r of rows) {
      if (roomId != null && r.room_id !== roomId) continue;
      try {
        if (!r.thread_id) {
          // Claimed but the message never got an id (dispatch still pending or lost).
          if (r.age_ms > noReplyMs) T.finish(r.room_id, r.id, { ok: false, reason: 'the task message was not delivered' }, T.SYSTEM, null);
          continue;
        }
        const agentMode = modeOf(r.room_id) === 'agent';
        // Switching mode drops the other mode's clock: the card starts the new mode from zero.
        if (agentMode) quietSince.delete(r.id); else decide.delete(r.id);
        if (threadBusy(r.room_id, r.thread_id)) {
          quietSince.delete(r.id);
          const st = decide.get(r.id);
          if (st?.nudgeTurn) decide.set(r.id, { ...st, sawBusy: true }); // the reminder's own turn
          else decide.delete(r.id); // new activity: both clocks restart
          continue;
        }
        const last = q.lastReply.get(r.thread_id, r.room_id, r.thread_id);
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

  // Startup: no turn survives a restart on the server side, so no runner run is running. A card an agent
  // started itself is not carried by a server turn: it stays the agent's.
  function reap() {
    const rows = q.reapRunning.all();
    for (const r of rows) T.returnToBacklog(r.room_id, r.id, 'server restart');
    const off = q.reapSettings.run().changes;
    return { returned: rows.length, runnersOff: off };
  }

  tasks.run.onKick((roomId) => setImmediate(() => safeTick(roomId)));

  return { tick: safeTick, checkRuns, poll, play, pause, stop, reap };
}

module.exports = { createRoomTasksRunner, composeTaskMessage, composeNudgeMessage, AGENT_UNDECIDED };
