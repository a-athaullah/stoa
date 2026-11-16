'use strict';

// Session recovery after a restart (self-healing 3/3). The agent's connector keeps a work journal on
// its own disk (lib/work-journal.js): one entry per session whose turn or background work was running.
// When a connector process dies (self-update, owner restart, crash, SIGKILL), its entries stay behind.
//
// Who decides: the server. After agent_connect, when the agent is current, agent_ready carries
// recover_journal: true and the connector answers with recovery_report (the entries another process
// wrote, each already marked: recovered_at + recovery_count + 1). Here every entry is checked and gets
// one verdict, sent back as recovery_result:
//   recover  → queued in pending_recoveries (durable: a server restart between report and trigger keeps
//              it), then triggered through the server's normal path (triggerAiResponse) in the same
//              thread, so it obeys the agent's max_concurrent queue, resumes the thread's session and
//              shows up as a normal run. The prompt and a system_event in the thread say what happened.
//   skip     → the work is handled another way: a run is in flight in the thread, a queued wake / retrigger
//              will continue it, or the thread was marked complete.
//   discard  → not this agent's (room / thread / sub-agent not its own), the room is archived, the entry
//              is malformed, or it is older than the max age.
//   limit    → the session was recovered more than the limit in a row: stopped, the thread is told, and
//              its running card goes back to Backlog with the reason.
// Every verdict but recover removes the entry on the agent.
//
// Why the server decides: entries come from the agent's disk and are untrusted. Ownership (room
// participant, thread root in that room, sub-agent owned by the agent and linked to the room) and the
// card (looked up by thread on the server, never the entry's task_id) can only be checked here, and
// the server's trigger path already has the queueing, offline/outdated handling and run bookkeeping.
//
// Where the consecutive count lives: in the journal entry (recovery_count), on the agent's disk. It is
// raised before the entry is reported, survives a connector restart and a server restart alike, is
// carried into the entry the recovery run writes, and resets only when that session's work settles
// (the entry is removed). A connector that crash-loops while recovering therefore reaches the limit.
//
// A server restart alone recovers nothing: the connector process lives on, its runs continue and are
// revived on reconnect (agent_connect active_message_ids), and its entries carry its own pid, which it
// never reports. Only entries of a dead process are reported, once per process.
//
// Card grace (lib/room-tasks-runner.js): a pending_recoveries row counts as thread activity
// (server.js taskThreadBusy), so the restart grace never sends a card to Backlog while its recovery
// waits; the recovery run itself is a run in flight. A failed recovery run (agent_error) or a row the
// agent never picked up (PENDING_MAX_AGE_MIN) sends the card to Backlog with the reason. An interrupted
// recovery run (the connector died again) does not: its entry is still on disk and comes back on the
// next connect, counted.
//
// Settings (.env, PATCH /api/settings): RECOVERY_MAX_PER_THREAD (default 3, 1-20),
// RECOVERY_MAX_AGE_HOURS (default 24, 1-168).

const REPORT_MAX = 50;
const SESSION_KEY_MAX = 4096;
const RESUME_ID_RE = /^[A-Za-z0-9._:-]{1,256}$/;
const STATES = new Set(['turn_running', 'background_only']);
const EXITS = new Set(['update', 'restart', 'crash']);
const PENDING_MAX_AGE_MIN = 30;
const DEFAULT_MAX_PER_THREAD = 3;
const DEFAULT_MAX_AGE_HOURS = 24;
// Errors that mean the recovery run was cut off, not that it failed: the journal brings it back.
const INTERRUPTED_ERRORS = new Set(['agent_disconnected', 'agent_disconnected_mid_trigger', 'agent_timeout']);

const isId = (v) => Number.isSafeInteger(v) && v > 0;
const isIso = (v) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const utc = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const TEXT = {
  en: {
    cause: { update: 'connector self-update', restart: 'connector restart', crash: 'connector crash or forced kill' },
    server: 'the Stoa server restarted too',
    head: (n, max) => `[automatic recovery ${n}/${max}]`,
    body: (at, cause, bg, task) => `The connector/server restarted at ${at} (cause: ${cause}). ${bg ? 'Your background work' : 'Your turn'} stopped and its process is gone.${task ? ` Task #${task} is still ongoing.` : ''} Check the state, continue or redo that work, then update the thread.`,
    limit: (n, max, task) => `Automatic recovery stopped: this session was recovered ${n - 1} times in a row (limit ${max}) and its work was cut off again.${task ? ` Task #${task} went back to Backlog.` : ''} A human needs to pick it up.`,
    failed: (why, task) => `Automatic recovery failed (${why}).${task ? ` Task #${task} went back to Backlog.` : ''}`,
    notReady: (min) => `the agent was not ready within ${min} minutes`,
  },
  id: {
    cause: { update: 'update konektor', restart: 'konektor di-restart', crash: 'konektor crash atau dihentikan paksa' },
    server: 'server Stoa juga restart',
    head: (n, max) => `[pemulihan otomatis ${n}/${max}]`,
    body: (at, cause, bg, task) => `Konektor/server restart pada ${at} (sebab: ${cause}). ${bg ? 'Pekerjaan latarmu' : 'Giliranmu'} terhenti dan prosesnya sudah mati.${task ? ` Task #${task} masih ongoing.` : ''} Periksa statenya, lanjutkan atau ulangi pekerjaan itu, lalu kabari thread.`,
    limit: (n, max, task) => `Pemulihan otomatis dihentikan: sesi ini sudah dipulihkan ${n - 1} kali berturut-turut (batas ${max}) dan pekerjaannya terputus lagi.${task ? ` Task #${task} dikembalikan ke backlog.` : ''} Butuh manusia untuk melanjutkan.`,
    failed: (why, task) => `Pemulihan otomatis gagal (${why}).${task ? ` Task #${task} dikembalikan ke backlog.` : ''}`,
    notReady: (min) => `agent tidak siap dalam ${min} menit`,
  },
  ja: {
    cause: { update: 'コネクタの自己更新', restart: 'コネクタの再起動', crash: 'コネクタのクラッシュまたは強制終了' },
    server: 'Stoa サーバーも再起動しました',
    head: (n, max) => `[自動復旧 ${n}/${max}]`,
    body: (at, cause, bg, task) => `コネクタ/サーバーが ${at} に再起動しました（原因: ${cause}）。${bg ? 'バックグラウンド作業' : 'あなたのターン'}は中断され、そのプロセスは終了しています。${task ? `タスク #${task} はまだ進行中です。` : ''}状態を確認し、作業を続行するかやり直してから、スレッドに報告してください。`,
    limit: (n, max, task) => `自動復旧を停止しました: このセッションは ${n - 1} 回連続で復旧され（上限 ${max}）、再び中断されました。${task ? `タスク #${task} はバックログに戻りました。` : ''}人による対応が必要です。`,
    failed: (why, task) => `自動復旧に失敗しました（${why}）。${task ? `タスク #${task} はバックログに戻りました。` : ''}`,
    notReady: (min) => `エージェントが ${min} 分以内に準備できませんでした`,
  },
  ko: {
    cause: { update: '커넥터 자체 업데이트', restart: '커넥터 재시작', crash: '커넥터 충돌 또는 강제 종료' },
    server: 'Stoa 서버도 재시작됨',
    head: (n, max) => `[자동 복구 ${n}/${max}]`,
    body: (at, cause, bg, task) => `커넥터/서버가 ${at}에 재시작되었습니다 (원인: ${cause}). ${bg ? '백그라운드 작업' : '당신의 턴'}이 중단되었고 프로세스는 종료되었습니다.${task ? ` 작업 #${task}은(는) 아직 진행 중입니다.` : ''} 상태를 확인하고 작업을 계속하거나 다시 한 뒤 스레드에 알려 주세요.`,
    limit: (n, max, task) => `자동 복구 중단: 이 세션은 ${n - 1}회 연속 복구되었고(한도 ${max}) 작업이 다시 중단되었습니다.${task ? ` 작업 #${task}은(는) 백로그로 돌아갔습니다.` : ''} 사람의 확인이 필요합니다.`,
    failed: (why, task) => `자동 복구 실패 (${why}).${task ? ` 작업 #${task}은(는) 백로그로 돌아갔습니다.` : ''}`,
    notReady: (min) => `에이전트가 ${min}분 안에 준비되지 않았습니다`,
  },
  zh: {
    cause: { update: '连接器自更新', restart: '连接器重启', crash: '连接器崩溃或被强制终止' },
    server: 'Stoa 服务器也重启了',
    head: (n, max) => `[自动恢复 ${n}/${max}]`,
    body: (at, cause, bg, task) => `连接器/服务器于 ${at} 重启（原因：${cause}）。${bg ? '你的后台工作' : '你的回合'}已中断，进程已结束。${task ? `任务 #${task} 仍在进行中。` : ''}请检查状态，继续或重做该工作，然后在线程中汇报。`,
    limit: (n, max, task) => `自动恢复已停止：该会话已连续恢复 ${n - 1} 次（上限 ${max}），工作再次中断。${task ? `任务 #${task} 已退回待办。` : ''}需要人工处理。`,
    failed: (why, task) => `自动恢复失败（${why}）。${task ? `任务 #${task} 已退回待办。` : ''}`,
    notReady: (min) => `代理未在 ${min} 分钟内就绪`,
  },
};
const textFor = (lang) => (Object.hasOwn(TEXT, lang) ? TEXT[lang] : TEXT.en);

// The recovery prompt (also the system_event the thread shows).
function composeRecoveryText({ lang = 'en', restartedAt, exit, serverRestarted = false, state, taskSeq = null, count, max }) {
  const L = textFor(lang);
  const cause = [L.cause[exit] || L.cause.crash, serverRestarted ? L.server : null].filter(Boolean).join('; ');
  return `${L.head(count, max)} ${L.body(utc(restartedAt), cause, state === 'background_only', taskSeq)}`;
}

function envInt(name, def, min, max) {
  const v = parseInt(process.env[name], 10);
  return Number.isSafeInteger(v) && v >= min && v <= max ? v : def;
}
function recoveryLimits() {
  return {
    maxPerThread: envInt('RECOVERY_MAX_PER_THREAD', DEFAULT_MAX_PER_THREAD, 1, 20),
    maxAgeHours: envInt('RECOVERY_MAX_AGE_HOURS', DEFAULT_MAX_AGE_HOURS, 1, 168),
  };
}

// Shape check of one reported entry → the normalized entry, or null. Ids are re-checked against the
// DB in decide(); this only refuses what cannot be an entry at all.
function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = raw;
  if (typeof e.session_key !== 'string' || !e.session_key || e.session_key.length > SESSION_KEY_MAX || e.session_key.includes('\0')) return null;
  if (!isId(e.room_id)) return null;
  for (const f of ['thread_id', 'sub_agent_id']) if (e[f] != null && !isId(e[f])) return null;
  if (!STATES.has(e.state) || !isIso(e.updated_at)) return null;
  if (!Number.isSafeInteger(e.recovery_count) || e.recovery_count < 1) return null;
  return {
    session_key: e.session_key,
    room_id: e.room_id,
    thread_id: e.thread_id ?? null,
    sub_agent_id: e.sub_agent_id ?? null,
    state: e.state,
    updated_at: e.updated_at,
    recovery_count: e.recovery_count,
    exit: EXITS.has(e.exit) ? e.exit : 'crash',
    resume_session_id: typeof e.resume_session_id === 'string' && RESUME_ID_RE.test(e.resume_session_id) ? e.resume_session_id : null,
  };
}

function createSessionRecovery({
  db, agentReady, agentLang = () => 'en', trigger, postSystemEvent, returnToBacklog, runInFlightSql,
  serverStartedAt = Date.now(), limits = recoveryLimits, now = () => Date.now(), log = console, orphanWakeEnabled = () => true,
}) {
  // Prepared on first use: the module may be loaded before the migrations ran.
  let q = null;
  const Q = () => q || (q = {
    participant: db.prepare(`SELECT rp.id AS participant_id, r.archived_at FROM room_participants rp JOIN rooms r ON r.id=rp.room_id
      WHERE rp.room_id=? AND rp.actor_id=?`),
    threadRoot: db.prepare('SELECT id, thread_completed_at FROM messages WHERE id=? AND room_id=? AND thread_id IS NULL'),
    subAgent: db.prepare(`SELECT sa.* FROM room_sub_agents rsa JOIN sub_agents sa ON sa.id=rsa.sub_agent_id
      WHERE rsa.room_id=? AND sa.id=? AND sa.parent_actor_id=? AND sa.enabled=1`),
    inFlight: db.prepare(`SELECT 1 FROM messages WHERE room_id=? AND participant_id=? AND (thread_id=? OR id=?)
      AND sub_agent_id IS ? AND ${runInFlightSql} LIMIT 1`),
    subWake: db.prepare(`SELECT 1 FROM pending_wakes pw JOIN messages m ON m.id=pw.sub_agent_message_id
      WHERE pw.room_id=? AND pw.thread_id=? AND m.sub_agent_id=? AND m.participant_id=? LIMIT 1`),
    // The sub-agent run the connector died in was stamped interrupted, which wakes the parent
    // (lib/orphan-runs.js): the parent decides how to go on, a second turn here would race it.
    subInterrupted: db.prepare(`SELECT 1 FROM messages WHERE room_id=? AND thread_id=? AND sub_agent_id=? AND participant_id=?
      AND state='error' AND json_extract(result_meta, '$.exit_reason')='interrupted' AND id=(SELECT MAX(id) FROM messages
        WHERE room_id=? AND thread_id=? AND sub_agent_id=? AND participant_id=?)`),
    retrigger: db.prepare('SELECT 1 FROM pending_retriggers WHERE participant_id=? AND (thread_id=? OR trigger_message_id=?) LIMIT 1'),
    card: db.prepare(`SELECT id, seq FROM room_tasks WHERE room_id=? AND thread_id=? AND status='running' ORDER BY id DESC LIMIT 1`),
    upsert: db.prepare(`INSERT INTO pending_recoveries (actor_id, room_id, participant_id, thread_id, sub_agent_id, session_key,
        state, exit_reason, server_restarted, restarted_at, resume_session_id, recovery_count)
      VALUES (@actor_id, @room_id, @participant_id, @thread_id, @sub_agent_id, @session_key, @state, @exit_reason, @server_restarted,
        @restarted_at, @resume_session_id, @recovery_count)
      ON CONFLICT(actor_id, session_key) DO UPDATE SET room_id=excluded.room_id, participant_id=excluded.participant_id,
        thread_id=excluded.thread_id, sub_agent_id=excluded.sub_agent_id, state=excluded.state, exit_reason=excluded.exit_reason,
        server_restarted=excluded.server_restarted, restarted_at=excluded.restarted_at, resume_session_id=excluded.resume_session_id,
        recovery_count=excluded.recovery_count, created_at=datetime('now')`),
    row: db.prepare('SELECT * FROM pending_recoveries WHERE id=?'),
    ofActor: db.prepare('SELECT id FROM pending_recoveries WHERE actor_id=? ORDER BY id'),
    claim: db.prepare('DELETE FROM pending_recoveries WHERE id=?'),
    expired: db.prepare("SELECT * FROM pending_recoveries WHERE created_at < datetime('now', ?) ORDER BY id"),
    participantRow: db.prepare(`SELECT rp.id AS participant_id, a.id AS actor_id, a.name, a.adapter, a.adapter_config, a.avatar_color,
        a.avatar_symbol, a.avatar_url FROM room_participants rp JOIN actors a ON a.id=rp.actor_id WHERE rp.id=?`),
  });

  const where = (e) => `room ${e.room_id} thread ${e.thread_id ?? '-'}${e.sub_agent_id ? ` sub-agent ${e.sub_agent_id}` : ''}`;

  // One reported entry → { action, reason, ctx }.
  function decide(actorId, e, lim) {
    const Qs = Q();
    const p = Qs.participant.get(e.room_id, actorId);
    if (!p) return { action: 'discard', reason: 'agent is not a participant of the room' };
    if (p.archived_at) return { action: 'discard', reason: 'room is archived' };
    if (!e.thread_id) return { action: 'discard', reason: 'no thread to resume in' };
    const root = Qs.threadRoot.get(e.thread_id, e.room_id);
    if (!root) return { action: 'discard', reason: 'thread not found in the room' };
    let sub = null;
    if (e.sub_agent_id) {
      sub = Qs.subAgent.get(e.room_id, e.sub_agent_id, actorId);
      if (!sub) return { action: 'discard', reason: 'sub-agent is not this agent\'s or not linked to the room' };
    }
    const ageMs = now() - Date.parse(e.updated_at);
    if (ageMs > lim.maxAgeHours * 3600_000) return { action: 'discard', reason: `older than the max age (${lim.maxAgeHours} h)` };
    if (root.thread_completed_at) return { action: 'skip', reason: 'thread is marked complete' };
    if (Qs.inFlight.get(e.room_id, p.participant_id, e.thread_id, e.thread_id, e.sub_agent_id)) return { action: 'skip', reason: 'a run is in flight in the thread' };
    if (Qs.retrigger.get(p.participant_id, e.thread_id, e.thread_id)) return { action: 'skip', reason: 'a queued retrigger continues the thread' };
    if (sub && orphanWakeEnabled() && (Qs.subWake.get(e.room_id, e.thread_id, sub.id, p.participant_id)
      || Qs.subInterrupted.get(e.room_id, e.thread_id, sub.id, p.participant_id, e.room_id, e.thread_id, sub.id, p.participant_id))) {
      return { action: 'skip', reason: 'the parent is woken for the interrupted sub-agent run' };
    }
    const card = Qs.card.get(e.room_id, e.thread_id) || null;
    if (e.recovery_count > lim.maxPerThread) return { action: 'limit', reason: `recovered ${e.recovery_count - 1}× in a row (limit ${lim.maxPerThread})`, ctx: { p, card } };
    return { action: 'recover', reason: `${e.state}, ${e.exit}, attempt ${e.recovery_count}/${lim.maxPerThread}${card ? `, task #${card.seq}` : ''}`, ctx: { p, card } };
  }

  // recovery_report from an authenticated agent → results for recovery_result.
  function report(actorId, payload) {
    const lim = limits();
    const raw = Array.isArray(payload?.entries) ? payload.entries.slice(0, REPORT_MAX) : [];
    const t = now();
    const restartedAt = isIso(payload?.restarted_at) ? Math.min(Date.parse(payload.restarted_at), t) : t;
    const decided = [];
    for (const r of raw) {
      const e = normalizeEntry(r);
      if (!e) {
        const key = typeof r?.session_key === 'string' && r.session_key.length <= SESSION_KEY_MAX ? r.session_key : null;
        if (key) decided.push({ e: { session_key: key, room_id: isId(r.room_id) ? r.room_id : '?', thread_id: isId(r.thread_id) ? r.thread_id : null }, action: 'discard', reason: 'malformed entry' });
        continue;
      }
      let d;
      try { d = decide(actorId, e, lim); } catch (err) { d = { action: 'skip', reason: `check failed: ${err.message}` }; }
      decided.push({ e, ...d });
    }
    const n = decided.filter(d => d.action === 'recover').length;
    log.log(`[recovery] restart: ${n} sesi akan dipulihkan (Actor #${actorId}, ${decided.length} entri dilaporkan)`);
    const label = { recover: 'dipulihkan', skip: 'dilewati', discard: 'dibuang', limit: 'dihentikan' };
    for (const d of decided) {
      log.log(`[recovery] ${label[d.action]}: Actor #${actorId} ${where(d.e)} — ${d.reason}`);
      try {
        if (d.action === 'recover') {
          Q().upsert.run({
            actor_id: actorId, room_id: d.e.room_id, participant_id: d.ctx.p.participant_id, thread_id: d.e.thread_id,
            sub_agent_id: d.e.sub_agent_id, session_key: d.e.session_key, state: d.e.state, exit_reason: d.e.exit,
            server_restarted: Date.parse(d.e.updated_at) < serverStartedAt ? 1 : 0, restarted_at: new Date(restartedAt).toISOString(),
            resume_session_id: d.e.resume_session_id, recovery_count: d.e.recovery_count,
          });
        } else if (d.action === 'limit') {
          stopAtLimit(actorId, d.e, d.ctx, lim);
        }
      } catch (err) {
        log.error(`[recovery] ${where(d.e)}: ${err.message}`);
      }
    }
    if (n) drain(actorId);
    return decided.map(d => ({ session_key: d.e.session_key, action: d.action, reason: d.reason }));
  }

  function stopAtLimit(actorId, e, { p, card }, lim) {
    const L = textFor(agentLang(actorId));
    postSystemEvent(e.room_id, p.participant_id, e.thread_id, L.limit(e.recovery_count, lim.maxPerThread, card?.seq ?? null));
    if (card) returnToBacklog(e.room_id, card.id, `automatic recovery stopped after ${e.recovery_count - 1} consecutive recoveries (limit ${lim.maxPerThread})`);
  }

  // why: English (task event, log); shown: the same for the thread in the agent's language.
  function failCard(row, why, shown = why) {
    const card = Q().card.get(row.room_id, row.thread_id);
    const L = textFor(agentLang(row.actor_id));
    postSystemEvent(row.room_id, row.participant_id, row.thread_id, L.failed(shown, card?.seq ?? null));
    if (card) returnToBacklog(row.room_id, card.id, `recovery failed: ${why}`);
    log.log(`[recovery] gagal: Actor #${row.actor_id} ${where(row)} — ${why}${card ? ` (task #${card.seq} → backlog)` : ''}`);
  }

  // Triggers one queued recovery. Stays queued while the agent is not ready (offline / outdated): its
  // next agent_connect drains it. Claimed (deleted) right before the trigger, so a second drain or a
  // server restart during the run cannot trigger it twice.
  async function drainOne(id) {
    const Qs = Q();
    const row = Qs.row.get(id);
    if (!row || !agentReady(row.actor_id)) return;
    const ai = Qs.participantRow.get(row.participant_id);
    let sub = null;
    if (row.sub_agent_id) sub = Qs.subAgent.get(row.room_id, row.sub_agent_id, row.actor_id);
    if (!ai || ai.actor_id !== row.actor_id || (row.sub_agent_id && !sub)) {
      Qs.claim.run(id);
      log.log(`[recovery] dibuang: Actor #${row.actor_id} ${where(row)} — participant or sub-agent gone`);
      return;
    }
    if (Qs.inFlight.get(row.room_id, row.participant_id, row.thread_id, row.thread_id, row.sub_agent_id)) {
      Qs.claim.run(id);
      log.log(`[recovery] dilewati: Actor #${row.actor_id} ${where(row)} — a run is in flight in the thread`);
      return;
    }
    if (Qs.claim.run(id).changes !== 1) return;
    const card = Qs.card.get(row.room_id, row.thread_id);
    const lim = limits();
    const text = composeRecoveryText({
      lang: agentLang(row.actor_id), restartedAt: Date.parse(row.restarted_at), exit: row.exit_reason, serverRestarted: !!row.server_restarted,
      state: row.state, taskSeq: card?.seq ?? null, count: row.recovery_count, max: lim.maxPerThread,
    });
    postSystemEvent(row.room_id, row.participant_id, row.thread_id, text);
    log.log(`[recovery] trigger: Actor #${row.actor_id} ${where(row)}${card ? ` task #${card.seq}` : ''} (attempt ${row.recovery_count}/${lim.maxPerThread})`);
    try {
      await trigger(row.room_id, {
        ...ai, sub_agent: sub, prompt_outside_history: true, no_skills: true,
        recovery: { session_key: row.session_key, recovery_count: row.recovery_count, resume_session_id: row.resume_session_id },
      }, text, row.thread_id);
    } catch (err) {
      const msg = String(err?.message || err);
      if (INTERRUPTED_ERRORS.has(msg)) {
        log.log(`[recovery] terputus: Actor #${row.actor_id} ${where(row)} — ${msg}; the journal reports it again on the next connect`);
        return;
      }
      failCard(row, msg.slice(0, 300));
    }
  }

  function drain(actorId) {
    for (const r of Q().ofActor.all(actorId)) {
      drainOne(r.id).catch(e => log.error('[recovery] drain error:', e.message));
    }
  }

  // Rows the agent never picked up (it stayed offline / outdated): given up with the reason.
  function sweep() {
    for (const row of Q().expired.all(`-${PENDING_MAX_AGE_MIN} minutes`)) {
      if (Q().claim.run(row.id).changes !== 1) continue;
      try { failCard(row, textFor('en').notReady(PENDING_MAX_AGE_MIN), textFor(agentLang(row.actor_id)).notReady(PENDING_MAX_AGE_MIN)); } catch (e) { log.error('[recovery] sweep error:', e.message); }
    }
  }

  return { report, drain, drainOne, sweep, decide };
}

module.exports = { createSessionRecovery, composeRecoveryText, normalizeEntry, recoveryLimits, PENDING_MAX_AGE_MIN, REPORT_MAX, DEFAULT_MAX_PER_THREAD, DEFAULT_MAX_AGE_HOURS };
