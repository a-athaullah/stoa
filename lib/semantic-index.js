'use strict';
// Semantic half of hybrid search. Owns the embedding worker (lib/semantic-worker.js) and the
// message_embeddings backfill. Everything here is best effort: until the model is loaded, after it
// fails, or when a query times out, search() resolves null and callers fall back to keyword-only.
//
// Backfill: newest complete messages without a vector for the current model are embedded in small
// batches, then the loop sleeps as long as the batch took (≤50% of the worker's threads). It is
// resumable by construction — progress is the table itself — and kick() wakes it for new or
// edited messages (an edit deletes the row via trigger, see migrations/20261021-message-embeddings.sql).
const path = require('path');
const { Worker } = require('worker_threads');

const MODEL = 'Xenova/multilingual-e5-small';
const HASH_MODEL = 'hash-trigram-384';
const DIM = 384;
// e5 truncates at 512 tokens anyway; cutting characters first keeps multi-MB messages from being
// tokenized in full. The write guard below compares the same prefix.
const MAX_TEXT = 2000;
// "ok", "siap", "done": embeddings of tiny messages sit close to every short query and crowd out
// real hits, so they get a NULL row instead.
const MIN_TEXT = 12;
const BATCH = 16;
const MIN_PAUSE_MS = 200;
const KICK_DEBOUNCE_MS = 1500;
const SWEEP_MS = 10 * 60 * 1000;
const EMBED_TIMEOUT_MS = 120 * 1000;
const SEARCH_TIMEOUT_MS = 4000;
const MAX_RESTARTS = 3;

function createSemanticIndex({ db, dbPath, backend = 'transformers', modelDir, threads = 2, log = console }) {
  const model = backend === 'hash' ? HASH_MODEL : MODEL;
  let worker = null;
  let state = 'off';
  let lastError = null;
  let restarts = 0;
  let reqSeq = 0;
  const pending = new Map();
  let kickTimer = null;
  let sweepTimer = null;
  let running = false;

  const missingStmt = db.prepare(`
    SELECT m.id, m.room_id, substr(m.content, 1, ${MAX_TEXT}) AS text FROM messages m
    WHERE m.state = 'complete'
      AND NOT EXISTS (SELECT 1 FROM message_embeddings e WHERE e.message_id = m.id AND e.model = ?)
    ORDER BY m.id DESC LIMIT ?
  `);
  // Only stored when the message still has the text that was embedded: it may have been edited
  // or deleted while the worker was busy.
  const writeStmt = db.prepare(`
    INSERT OR REPLACE INTO message_embeddings (message_id, model, vec)
    SELECT ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM messages WHERE id = ? AND state = 'complete' AND substr(content, 1, ${MAX_TEXT}) = ?
    )
  `);
  const writeBatch = db.transaction(rows => {
    for (const r of rows) writeStmt.run(r.id, model, r.vec, r.id, r.text);
  });
  const storedStmt = db.prepare(`
    SELECT message_id FROM message_embeddings
    WHERE model = ? AND vec IS NOT NULL AND message_id IN (SELECT value FROM json_each(?))
  `);
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM message_embeddings WHERE model = ? AND vec IS NOT NULL');

  function call(msg, timeoutMs) {
    if (!worker) return Promise.reject(new Error('worker not running'));
    const id = ++reqSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ ...msg, id });
    });
  }

  function rejectAll(err) {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
    pending.clear();
  }

  function start() {
    state = 'loading';
    worker = new Worker(path.join(__dirname, 'semantic-worker.js'), {
      workerData: { dbPath, model, backend, modelDir, threads },
    });
    worker.unref();
    worker.on('message', msg => {
      if (msg.type === 'ready') {
        state = 'ready';
        restarts = 0;
        log.log(`[semantic] ready: ${model} (${msg.count} vectors loaded)`);
        kick();
        return;
      }
      if (msg.type === 'fatal') { lastError = msg.error; worker.terminate(); return; }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.type === 'failed') p.reject(new Error(msg.error));
      else p.resolve(msg);
    });
    worker.on('error', err => { lastError = err.message; });
    worker.on('exit', code => {
      worker = null;
      rejectAll(new Error('worker exited'));
      state = 'failed';
      log.error(`[semantic] worker exited (code ${code}): ${lastError || 'unknown error'} — search falls back to keyword`);
      // A missing optional dependency or a model that cannot load will not fix itself.
      if (/Cannot find module|MODULE_NOT_FOUND/.test(lastError || '')) return;
      if (restarts++ < MAX_RESTARTS) setTimeout(start, 30000 * restarts).unref();
    });
    if (!sweepTimer) { sweepTimer = setInterval(kick, SWEEP_MS); sweepTimer.unref(); }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms).unref());

  async function backfill() {
    if (running) return;
    running = true;
    try {
      while (state === 'ready') {
        const batch = missingStmt.all(model, BATCH);
        if (!batch.length) return;
        const skip = [], todo = [];
        for (const m of batch) (m.text.trim().length < MIN_TEXT ? skip : todo).push(m);
        const t0 = Date.now();
        let results = [];
        if (todo.length) {
          try {
            results = (await call({ type: 'embed', items: todo }, EMBED_TIMEOUT_MS)).results;
          } catch (e) {
            log.error(`[semantic] backfill batch failed: ${e.message}`);
            return;
          }
        }
        const byId = new Map(results.map(r => [r.id, r.vec]));
        writeBatch([
          ...skip.map(m => ({ id: m.id, text: m.text, vec: null })),
          ...todo.filter(m => byId.has(m.id)).map(m => {
            const v = byId.get(m.id);
            return { id: m.id, text: m.text, vec: v ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : null };
          }),
        ]);
        await sleep(Math.max(MIN_PAUSE_MS, Date.now() - t0));
      }
    } catch (e) {
      log.error(`[semantic] backfill stopped: ${e.message}`);
    } finally {
      running = false;
    }
  }

  function kick() {
    if (state !== 'ready' || kickTimer) return;
    kickTimer = setTimeout(() => { kickTimer = null; backfill(); }, KICK_DEBOUNCE_MS);
    kickTimer.unref();
  }

  // Resolves { ids, scores } best first, or null when semantic search is unavailable right now.
  // `rooms` (array of room ids) restricts the candidates; null = every room.
  async function search(text, { rooms = null, k = 20 } = {}) {
    if (state !== 'ready' || !text) return null;
    try {
      const r = await call({ type: 'search', text: String(text).slice(0, MAX_TEXT), rooms, k }, SEARCH_TIMEOUT_MS);
      return { ids: r.ids, scores: r.scores };
    } catch (e) {
      log.error(`[semantic] query failed, keyword only: ${e.message}`);
      return null;
    }
  }

  // Drops ids from the worker's in-memory index once their stored vector is gone (message deleted,
  // or edited and waiting to be re-embedded). Ids that still have a vector are kept: the backfill
  // only re-sends messages without a row, so dropping those would lose them until restart.
  function forget(ids) {
    if (!worker || !ids.length) return;
    const kept = new Set(storedStmt.all(model, JSON.stringify(ids)).map(r => r.message_id));
    const gone = ids.filter(id => !kept.has(id));
    if (gone.length) worker.postMessage({ type: 'forget', ids: gone });
  }

  function status() {
    return { state, model, dim: DIM, indexed: countStmt.get(model).n, error: state === 'failed' ? lastError : null };
  }

  return { start, kick, search, forget, status, get ready() { return state === 'ready'; } };
}

module.exports = { createSemanticIndex, MODEL, HASH_MODEL, DIM, MIN_TEXT, MAX_TEXT };
