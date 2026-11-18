'use strict';
// Knowledge: the vector and edge rules shared by conversation extraction (lib/knowledge-extraction.js)
// and documents (lib/knowledge-documents.js), so both write the same graph the same way.
const os = require('os');
const { redactSecrets } = require('./harness-error');

const EDGES_MAX = 8;

const toBlob = v => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = b => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// Secrets (tokens, keys) and the home path out of text that is stored or embedded.
const scrub = s => redactSecrets(s, os.homedir()).trim();
// At most n UTF-16 units, never ending inside a surrogate pair.
function cut(s, n) {
  if (s.length <= n) return s;
  const c = s.charCodeAt(n - 1);
  return s.slice(0, c >= 0xd800 && c <= 0xdbff ? n - 1 : n);
}

// Markdown → plain text for previews: fences, headings, quotes, rules, emphasis, strike, code ticks
// and link/image syntax go (a link keeps its text). Opening * and _ need a non-space after and no word
// character before, so "2 * 3" and snake_case stay as they are.
function plainText(s) {
  return s
    .replace(/^ {0,3}(?:```|~~~).*$/gm, '')
    .replace(/^ {0,3}([-*_])(?: *\1){2,} *$/gm, '')
    .replace(/^ {0,3}#{1,6}(?=\s|$)\s*/gm, '')
    .replace(/^ {0,3}(?:> ?)+/gm, '')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/!?\[([^\]\n]+)\]\[[^\]\n]*\]/g, '$1')
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')
    .replace(/(`+)([^`\n]+?)\1(?!`)/g, '$2')
    .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, '$1')
    .replace(/(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*])?\*(?![\w*])/g, (m, t) => t ?? m)
    .replace(/(?<![\w_])_(?=[^\s_])([^_\n]*?[^\s_])?_(?![\w_])/g, (m, t) => t ?? m);
}

// knowledge_graph_changed: one per operation that wrote nodes or edges, sent after its commit so a
// refetch sees the change. room_id: the room the operation came from (null when there is none).
function graphChanged(notify, log, reason, roomId) {
  try { notify({ type: 'knowledge_graph_changed', reason, room_id: roomId ?? null }); }
  catch (e) { log.error(`[knowledge] knowledge_graph_changed broadcast failed: ${e.message}`); }
}

// activeNodes(model) → [{ id, title, summary, vec, doc }] (doc: the node has a document source);
// edgesFor(nodeId, vec, nodes): replaces the node's edges with its nearest nodes at cosine ≥ edgeSim
// (at most EDGES_MAX, stored once as node_a < node_b, weight = cosine). Call inside the writer's transaction.
function createKnowledgeGraph(db, { edgeSim = 0.85 } = {}) {
  const q = {
    activeVecs: db.prepare(`SELECT n.id, n.title, n.summary, n.embedding,
      EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.node_id=n.id AND s.document_id IS NOT NULL) AS doc
      FROM knowledge_nodes n WHERE n.status='active' AND n.embedding IS NOT NULL AND n.embedding_model=?`),
    clearEdges: db.prepare('DELETE FROM knowledge_edges WHERE node_a=? OR node_b=?'),
    addEdge: db.prepare('INSERT OR REPLACE INTO knowledge_edges (node_a, node_b, weight) VALUES (?, ?, ?)'),
  };

  function activeNodes(model) {
    return q.activeVecs.all(model).filter(r => r.embedding.length % 4 === 0)
      .map(r => ({ id: r.id, title: r.title, summary: r.summary, vec: fromBlob(r.embedding), doc: r.doc === 1 }));
  }

  function edgesFor(nodeId, vec, nodes) {
    q.clearEdges.run(nodeId, nodeId);
    const near = nodes.filter(n => n.id !== nodeId && n.vec.length === vec.length)
      .map(n => ({ id: n.id, sim: dot(n.vec, vec) })).filter(n => n.sim >= edgeSim)
      .sort((a, b) => b.sim - a.sim).slice(0, EDGES_MAX);
    for (const n of near) q.addEdge.run(Math.min(nodeId, n.id), Math.max(nodeId, n.id), n.sim);
  }

  return { activeNodes, edgesFor };
}

module.exports = { createKnowledgeGraph, toBlob, fromBlob, dot, scrub, cut, plainText, graphChanged, EDGES_MAX };
