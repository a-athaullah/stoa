'use strict';
// Knowledge (6/6): the 3D positions of the knowledge brain and the graph it is drawn from
// (GET /api/knowledge/graph, session-only like every knowledge owner view).
//
// Projection: PCA of the node embeddings (active and stale nodes whose vector is of the index's model),
// three components by power iteration on the covariance, from a fixed start vector: the same vectors
// always give the same basis, no randomness. A vector's coordinates on the components are divided by
// the basis spreads and squashed into the unit ball (radius tanh(|p|/2), direction kept). The ball is
// then poured into the brain volume of the page (inside(), x left-right, y up, z front, roughly
// [-1, 1]): the sign of x picks the hemisphere, |x| runs from the midline (0) to the outside (1), and
// the radius is scaled by how far the volume reaches along that direction from the hemisphere's
// centre (ray march). Close vectors stay close, and the whole reads as a brain. A small jitter from
// the node id keeps nodes with nearly equal vectors from covering each other.
//
// Stable: the basis (mean, components, spreads, model, n_basis) and each node's position are stored
// (migrations/20261120-knowledge-layout.sql). A new node is projected with the stored basis, so the
// others never move. The basis is computed again only when
//   - there is none yet (and at least one node has a vector of the model), or
//   - the index's model is not the basis model (or the vector length changed), or
//   - it came from fewer than EARLY_BASIS nodes and there are now at least twice as many (early phase:
//     a basis of 3 nodes says little about 300).
// A rebuild rewrites every projected position once. A node whose vector changes loses its position
// (trigger knowledge_nodes_layout_au) and is projected again. A node without a vector of the model
// (index not ready, another model) sits at a spot drawn from its id inside the volume, model '', until
// it has one. A stored position that is no longer inside the volume (the brain shape changed) is
// placed again the same way, once; every position still inside keeps its place. Positions are filled
// lazily when the graph is read, never on the extraction write path.
//
// The graph lists at most NODES_MAX nodes (most used first, then id) without summaries; edges only
// between listed nodes.
// Payload (decided, task #39 QA): about 190 bytes per node with its edges, so ~580 KB raw at 3,000
// nodes. It goes gzip-compressed (lib/http-compress.js), is read once per page open and per
// knowledge_graph_changed (debounced in the page), and is served from the stored positions; shorter
// field names or a binary format would save little on the wire for a harder contract.
const { fromBlob, toBlob } = require('./knowledge-graph');

const NODES_MAX = 20000;
const EARLY_BASIS = 50;
// Covariance cost grows with n·dims²: past this many nodes an evenly spaced sample (by id) is enough
// to find the main directions.
const BASIS_SAMPLE_MAX = 2000;
const POWER_ITERS = 300;
const JITTER = 0.015;
const RAY_MAX = 1.4;
const RAY_STEP = 0.01;
const HEMI_CENTRE = [0.36, 0.08, 0];

// Brain volume of the page: public/js/knowledge/brain-volume.js, the same file the page draws the
// brain from, so node positions and the drawn shape cannot drift apart. → 0 outside, 1 cerebrum,
// 2 cerebellum, 3 brain stem.
const { kbInside } = require('../public/js/knowledge/brain-volume');
const inside = (p) => kbInside(p[0], p[1], p[2]);

function hash32(n) {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
// mulberry32: a small seeded generator, enough for placement.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Positions are stored and sent at 3 decimals (1/1000 of a ~2-unit brain is under a pixel);
// every inside() check is made on the rounded point, so what the page gets is inside.
const COORD = 1e3;
const snap = (p) => p.map(v => Math.round(v * COORD) / COORD);
const at = (o, d, r) => snap([o[0] + d[0] * r, o[1] + d[1] * r, o[2] + d[2] * r]);

// Unit-ball point b → point inside the volume (see header). The hemisphere centre is inside, so the
// search along the ray always ends on an inside point.
function pour(b, id) {
  const h = b[0] < 0 ? -1 : 1;
  const local = [2 * Math.abs(b[0]) - 1, b[1], b[2]];
  const len = Math.hypot(local[0], local[1], local[2]);
  let p = HEMI_CENTRE.slice();
  if (len > 1e-9) {
    const d = [local[0] / len, local[1] / len, local[2] / len];
    let reach = 0;
    for (let r = RAY_MAX; r > 0; r -= RAY_STEP) if (inside(at(HEMI_CENTRE, d, r))) { reach = r; break; }
    const want = Math.min(len, 1) * reach;
    for (let k = 0; k * RAY_STEP <= want + RAY_STEP; k++) {
      const lo = want - k * RAY_STEP, hi = want + k * RAY_STEP;
      if (lo >= 0 && inside(at(HEMI_CENTRE, d, lo))) { p = at(HEMI_CENTRE, d, lo); break; }
      if (hi <= reach && inside(at(HEMI_CENTRE, d, hi))) { p = at(HEMI_CENTRE, d, hi); break; }
    }
  }
  p[0] *= h;
  const r = rng(hash32(id));
  const j = snap([p[0] + (r() * 2 - 1) * JITTER, p[1] + (r() * 2 - 1) * JITTER, p[2] + (r() * 2 - 1) * JITTER]);
  return inside(j) ? j : p;
}

// A node without a vector: a spot drawn from its id (rejection sampling in the bounding box).
function idPosition(id) {
  const r = rng(hash32(id) ^ 0x51ed270b);
  for (let i = 0; i < 1000; i++) {
    const p = snap([(r() - 0.5) * 1.8, (r() - 0.5) * 2, (r() - 0.5) * 2]);
    if (inside(p)) return p;
  }
  return HEMI_CENTRE.slice();
}

// vecs: Float32Array[] of one length. → { mean, comps: [3 × Float64Array], spread: [3] }.
function computeBasis(vecs) {
  const n = vecs.length;
  const D = vecs[0].length;
  const mean = new Float64Array(D);
  for (const v of vecs) for (let i = 0; i < D; i++) mean[i] += v[i];
  for (let i = 0; i < D; i++) mean[i] /= n;
  const C = new Float64Array(D * D);
  const c = new Float64Array(D);
  for (const v of vecs) {
    for (let i = 0; i < D; i++) c[i] = v[i] - mean[i];
    for (let i = 0; i < D; i++) {
      const ci = c[i];
      if (ci === 0) continue;
      const row = i * D;
      for (let j = i; j < D; j++) C[row + j] += ci * c[j];
    }
  }
  for (let i = 0; i < D; i++) {
    for (let j = i; j < D; j++) {
      const val = C[i * D + j] / n;
      C[i * D + j] = val;
      C[j * D + i] = val;
    }
  }
  const comps = [];
  const w = new Float64Array(D);
  for (let k = 0; k < 3; k++) {
    // Fixed start, different per component: deterministic, and never orthogonal to everything.
    let v = new Float64Array(D);
    for (let i = 0; i < D; i++) v[i] = 1 + ((i * 7919 + k * 104729) % 97) / 97;
    let norm = Math.hypot(...v);
    for (let i = 0; i < D; i++) v[i] /= norm;
    let lambda = 0;
    for (let it = 0; it < POWER_ITERS; it++) {
      for (let i = 0; i < D; i++) {
        let s = 0;
        const row = i * D;
        for (let j = 0; j < D; j++) s += C[row + j] * v[j];
        w[i] = s;
      }
      norm = 0;
      for (let i = 0; i < D; i++) norm += w[i] * w[i];
      norm = Math.sqrt(norm);
      if (norm < 1e-12) { v.fill(0); lambda = 0; break; }
      let diff = 0;
      for (let i = 0; i < D; i++) { const x = w[i] / norm; diff += Math.abs(x - v[i]); v[i] = x; }
      lambda = norm;
      if (diff < 1e-9) break;
    }
    // Sign: the largest coordinate positive, so the same data never flips an axis.
    let big = 0;
    for (let i = 1; i < D; i++) if (Math.abs(v[i]) > Math.abs(v[big])) big = i;
    if (v[big] < 0) for (let i = 0; i < D; i++) v[i] = -v[i];
    for (let i = 0; i < D; i++) {
      const lv = lambda * v[i];
      if (lv === 0) continue;
      const row = i * D;
      for (let j = 0; j < D; j++) C[row + j] -= lv * v[j];
    }
    comps.push(v);
  }
  const spread = comps.map(comp => {
    let s = 0;
    for (const vec of vecs) {
      let p = 0;
      for (let i = 0; i < D; i++) p += (vec[i] - mean[i]) * comp[i];
      s += p * p;
    }
    const sd = Math.sqrt(s / n);
    return sd > 1e-9 ? sd : 1;
  });
  return { mean, comps, spread };
}

// Stored as Float32: [mean (D), comp1 (D), comp2 (D), comp3 (D), spread (3)].
function packBasis(b) {
  const D = b.mean.length;
  const out = new Float32Array(4 * D + 3);
  out.set(b.mean, 0);
  b.comps.forEach((c, k) => out.set(c, (k + 1) * D));
  out.set(b.spread, 4 * D);
  return toBlob(out);
}
function unpackBasis(blob, D) {
  const f = fromBlob(blob);
  if (f.length !== 4 * D + 3) return null;
  return { mean: f.subarray(0, D), comps: [1, 2, 3].map(k => f.subarray(k * D, (k + 1) * D)), spread: Array.from(f.subarray(4 * D)) };
}

// Vector → position in the volume.
function project(basis, vec, id) {
  const D = vec.length;
  const p = basis.comps.map((comp, k) => {
    let s = 0;
    for (let i = 0; i < D; i++) s += (vec[i] - basis.mean[i]) * comp[i];
    return s / basis.spread[k];
  });
  const r = Math.hypot(p[0], p[1], p[2]);
  const b = r > 1e-12 ? p.map(x => (x / r) * Math.tanh(r / 2)) : [0, 0, 0];
  return pour(b, id);
}

const round = (x, d) => Math.round(x * d) / d;

// model: the semantic index's model id (lib/semantic-index.js), whether or not it is loaded yet.
function createKnowledgeLayout({ db, model, log = console }) {
  const q = {
    basis: db.prepare('SELECT model, dims, n_basis, basis, computed_at FROM knowledge_layout_basis WHERE id=1'),
    saveBasis: db.prepare(`INSERT OR REPLACE INTO knowledge_layout_basis (id, model, dims, n_basis, basis, computed_at)
      VALUES (1, ?, ?, ?, ?, datetime('now'))`),
    // Vectors of one model have one length; should a row ever differ, the common length wins.
    vecInfo: db.prepare(`SELECT length(embedding) AS bytes, COUNT(*) AS n FROM knowledge_nodes
      WHERE embedding IS NOT NULL AND embedding_model=? GROUP BY bytes ORDER BY n DESC, bytes DESC LIMIT 1`),
    vecsAll: db.prepare('SELECT id, embedding FROM knowledge_nodes WHERE embedding IS NOT NULL AND embedding_model=? AND length(embedding)=? ORDER BY id'),
    vecsOf: db.prepare(`SELECT id, embedding FROM knowledge_nodes WHERE id IN (SELECT value FROM json_each(?))
      AND embedding IS NOT NULL AND embedding_model=? AND length(embedding)=?`),
    dropProjected: db.prepare("DELETE FROM knowledge_node_layout WHERE model <> ''"),
    put: db.prepare('INSERT OR REPLACE INTO knowledge_node_layout (node_id, x, y, z, model) VALUES (?, ?, ?, ?, ?)'),
    // uses_total: idx_knowledge_usage_node; the node limit keeps the most used.
    nodes: db.prepare(`SELECT n.id, n.title, n.category, n.status,
        (n.embedding IS NOT NULL AND n.embedding_model=@model AND length(n.embedding)=@bytes) AS has_vec,
        l.x, l.y, l.z, l.model AS placed_model, COALESCE(u.c, 0) AS uses_total
      FROM knowledge_nodes n
      LEFT JOIN knowledge_node_layout l ON l.node_id=n.id
      LEFT JOIN (SELECT node_id, COUNT(*) AS c FROM knowledge_usage GROUP BY node_id) u ON u.node_id=n.id
      ORDER BY uses_total DESC, n.id LIMIT ${NODES_MAX}`),
    edges: db.prepare('SELECT node_a, node_b, weight FROM knowledge_edges'),
  };

  // The basis to project with, rebuilt first when the rules in the header say so. → basis row or null.
  const ensureBasis = db.transaction(() => {
    const row = q.basis.get();
    const info = q.vecInfo.get(model);
    if (!info || !info.bytes || info.bytes % 4) return row;
    const { bytes } = info;
    const dims = bytes / 4;
    const rebuild = !row || row.model !== model || row.dims !== dims || (row.n_basis < EARLY_BASIS && info.n >= 2 * row.n_basis);
    if (!rebuild) return row;
    const all = q.vecsAll.all(model, bytes);
    const step = Math.max(1, all.length / BASIS_SAMPLE_MAX);
    const sample = [];
    for (let i = 0; i < all.length && sample.length < BASIS_SAMPLE_MAX; i += step) sample.push(fromBlob(all[Math.floor(i)].embedding));
    const t0 = Date.now();
    const basis = computeBasis(sample);
    q.saveBasis.run(model, dims, sample.length, packBasis(basis));
    q.dropProjected.run();
    for (const r of all) {
      const p = project(basis, fromBlob(r.embedding), r.id);
      q.put.run(r.id, p[0], p[1], p[2], model);
    }
    log.log(`[knowledge] layout basis: ${model} from ${sample.length} nodes, ${all.length} positions (${Date.now() - t0} ms)`);
    return q.basis.get();
  });

  // Positions missing or of the wrong kind for the listed nodes, in one transaction.
  const fill = db.transaction((need, basisRow) => {
    const basis = basisRow ? unpackBasis(basisRow.basis, basisRow.dims) : null;
    const vecs = new Map();
    const withVec = need.filter(r => r.has_vec).map(r => r.id);
    if (basis && withVec.length) {
      for (const r of q.vecsOf.all(JSON.stringify(withVec), model, basisRow.dims * 4)) vecs.set(r.id, fromBlob(r.embedding));
    }
    for (const r of need) {
      const vec = vecs.get(r.id);
      const p = vec ? project(basis, vec, r.id) : idPosition(r.id);
      q.put.run(r.id, p[0], p[1], p[2], vec ? model : '');
    }
  });

  // → { status, body } (the GET /api/knowledge/graph contract).
  function graph() {
    const basisRow = ensureBasis();
    const usable = basisRow && basisRow.model === model ? basisRow : null;
    const args = { model, bytes: usable ? usable.dims * 4 : -1 };
    let rows = q.nodes.all(args);
    // A stored position outside the volume (placed before the brain shape changed) is placed again
    // the same way; positions still inside stay put.
    const need = rows.filter(r => r.placed_model == null || (r.has_vec ? r.placed_model !== model : r.placed_model !== '')
      || !inside([r.x, r.y, r.z]));
    if (need.length) {
      fill(need, usable);
      rows = q.nodes.all(args);
    }
    const ids = new Set(rows.map(r => r.id));
    const degree = new Map();
    const edges = [];
    for (const e of q.edges.all()) {
      if (!ids.has(e.node_a) || !ids.has(e.node_b)) continue;
      edges.push([e.node_a, e.node_b, round(e.weight, 1e3)]);
      degree.set(e.node_a, (degree.get(e.node_a) || 0) + 1);
      degree.set(e.node_b, (degree.get(e.node_b) || 0) + 1);
    }
    const nodes = rows.map(r => ({
      id: r.id, title: r.title, category: r.category, status: r.status,
      x: r.x, y: r.y, z: r.z,
      degree: degree.get(r.id) || 0, uses_total: r.uses_total,
    }));
    return {
      status: 200,
      body: {
        nodes, edges, counts: { nodes: nodes.length, edges: edges.length },
        layout: { model: usable?.model ?? null, computed_at: usable?.computed_at ?? null },
      },
    };
  }

  return { graph };
}

module.exports = { createKnowledgeLayout, inside, computeBasis, project, pour, idPosition, packBasis, unpackBasis, NODES_MAX, EARLY_BASIS, BASIS_SAMPLE_MAX };
