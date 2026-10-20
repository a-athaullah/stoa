'use strict';
// Worker thread behind lib/semantic-index.js. Runs the embedding model off the server's event loop
// and holds every stored vector in memory, so a query is one embed plus one brute-force cosine pass
// (25k messages × 384 floats ≈ 40 MB, ~10 ms) — no vector extension needed at this scale.
//
// Messages in:  { type: 'embed', id, items: [{ id, room_id, text }] }
//               { type: 'search', id, text, rooms: number[] | null, k }
//               { type: 'forget', ids }
// Messages out: { type: 'ready', count } | { type: 'fatal', error }
//               { type: 'embedded', id, results: [{ id, vec: Float32Array | null }] }
//               { type: 'searched', id, ids, scores } | { type: 'failed', id, error }
const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');

const { dbPath, model, backend, modelDir, threads } = workerData;
const DIM = 384;
// This many failures in a row means the runtime is broken, not the input: stop instead of
// marking every remaining message as unembeddable.
const MAX_CONSECUTIVE_FAILURES = 3;

// e5 models are trained with these prefixes; leaving them off measurably hurts retrieval.
const QUERY_PREFIX = 'query: ';
const PASSAGE_PREFIX = 'passage: ';

async function loadTransformers() {
  const { pipeline, env } = require('@huggingface/transformers');
  env.cacheDir = modelDir;
  const extractor = await pipeline('feature-extraction', model, {
    dtype: 'q8',
    session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
  });
  // Batch size 1 on purpose: batches pad every text to the longest one, which on chat messages
  // was 2x slower and doubled memory in the spike (see ~/project/stoa-feature/search-hybrid.md).
  return async text => {
    const out = await extractor(text, { pooling: 'mean', normalize: true });
    return Float32Array.from(out.data);
  };
}

// Test backend (run-tests.js sets STOA_SEMANTIC_BACKEND=hash): deterministic character-trigram
// feature hashing, so integration tests exercise the real worker, backfill, storage and fusion
// paths without downloading a model. Shared trigrams ⇒ high cosine, which lets a test build a
// "semantic but not keyword" match from a misspelt word.
function loadHash() {
  return async text => {
    const v = new Float32Array(DIM);
    for (const w of text.toLowerCase().replace(/^(query|passage): /, '').match(/[\p{L}\p{N}]+/gu) || []) {
      const s = `#${w}#`;
      for (let i = 0; i + 3 <= s.length; i++) {
        let h = 2166136261;
        for (let j = i; j < i + 3; j++) h = Math.imul(h ^ s.charCodeAt(j), 16777619);
        v[(h >>> 0) % DIM] += 1;
      }
    }
    let n = 0;
    for (let i = 0; i < DIM; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < DIM; i++) v[i] /= n;
    return v;
  };
}

let ids = new Int32Array(1024);
let rooms = new Int32Array(1024);
let mat = new Float32Array(1024 * DIM);
let size = 0;
const slotOf = new Map();

function upsert(id, roomId, vec) {
  let slot = slotOf.get(id);
  if (slot === undefined) {
    if (size === ids.length) {
      const grow = (a, n) => { const b = new a.constructor(n); b.set(a); return b; };
      ids = grow(ids, ids.length * 2);
      rooms = grow(rooms, rooms.length * 2);
      mat = grow(mat, mat.length * 2);
    }
    slot = size++;
    slotOf.set(id, slot);
  }
  ids[slot] = id;
  rooms[slot] = roomId;
  mat.set(vec, slot * DIM);
}

function forget(id) {
  const slot = slotOf.get(id);
  if (slot === undefined) return;
  const last = --size;
  if (slot !== last) {
    ids[slot] = ids[last];
    rooms[slot] = rooms[last];
    mat.copyWithin(slot * DIM, last * DIM, (last + 1) * DIM);
    slotOf.set(ids[slot], slot);
  }
  slotOf.delete(id);
}

function loadStored() {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`
      SELECT e.message_id, m.room_id, e.vec FROM message_embeddings e
      JOIN messages m ON m.id = e.message_id
      WHERE e.model = ? AND e.vec IS NOT NULL
    `).iterate(model);
    for (const r of rows) {
      if (r.vec.length !== DIM * 4) continue;
      upsert(r.message_id, r.room_id, new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.length)));
    }
  } finally {
    db.close();
  }
}

let embed = null;
let failures = 0;
const searches = [];
const embeds = [];
let busy = false;

// The parent terminates the worker on 'fatal'; exiting here could drop the message.
function fatal(err) {
  embed = null;
  searches.length = embeds.length = 0;
  parentPort.postMessage({ type: 'fatal', error: String(err?.message || err) });
}

async function runSearch(job) {
  try {
    const q = await embed(QUERY_PREFIX + job.text);
    const allow = job.rooms ? new Set(job.rooms) : null;
    const hits = [];
    for (let s = 0; s < size; s++) {
      if (allow && !allow.has(rooms[s])) continue;
      let dot = 0;
      const off = s * DIM;
      for (let d = 0; d < DIM; d++) dot += mat[off + d] * q[d];
      hits.push([dot, ids[s]]);
    }
    hits.sort((a, b) => b[0] - a[0]);
    const top = hits.slice(0, job.k);
    parentPort.postMessage({ type: 'searched', id: job.id, ids: top.map(h => h[1]), scores: top.map(h => h[0]) });
  } catch (e) {
    parentPort.postMessage({ type: 'failed', id: job.id, error: String(e?.message || e) });
  }
}

async function runEmbed(job) {
  const results = [];
  for (const it of job.items) {
    // A search queued behind a backfill batch must not wait for the whole batch.
    while (searches.length) await runSearch(searches.shift());
    let vec = null;
    try {
      vec = await embed(PASSAGE_PREFIX + it.text);
      failures = 0;
      upsert(it.id, it.room_id, vec);
    } catch (e) {
      if (++failures >= MAX_CONSECUTIVE_FAILURES) return fatal(e);
    }
    results.push({ id: it.id, vec });
  }
  parentPort.postMessage({ type: 'embedded', id: job.id, results });
}

async function pump() {
  if (busy || !embed) return;
  busy = true;
  try {
    while (searches.length || embeds.length) {
      if (searches.length) await runSearch(searches.shift());
      else await runEmbed(embeds.shift());
    }
  } finally {
    busy = false;
  }
}

parentPort.on('message', msg => {
  if (msg.type === 'search') searches.push(msg);
  else if (msg.type === 'embed') embeds.push(msg);
  else if (msg.type === 'forget') { for (const id of msg.ids) forget(id); return; }
  pump();
});

(async () => {
  try {
    loadStored();
    embed = backend === 'hash' ? loadHash() : await loadTransformers();
  } catch (e) {
    return fatal(e);
  }
  parentPort.postMessage({ type: 'ready', count: size });
  pump();
})();
