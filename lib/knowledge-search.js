'use strict';
// Knowledge (4/6): stoa__knowledge_search for every agent, the usage log behind the graph's "neurons
// lighting up", and the usage counts of its history mode (GET /api/knowledge/usage).
//
// Scope: every ACTIVE node of every room. Which rooms feed the graph at all is decided when nodes are
// written (knowledge_enabled, KNOWLEDGE_EXCLUDED_ROOM_IDS: lib/knowledge-extraction.js eligibleRoom), so
// a node that exists may be found by any agent. A stale node is never returned: its summary may still
// describe deleted content (migrations/20261118-knowledge-schema.sql).
// Where it came from is narrower: a source (message or document) carries its room / thread / message
// ids and the room title only when the caller may reach that room (lib/room-access.js canReach, the
// rule of the read tools: participant, sub-agent linked, not archived). Every other source is counted in
// hidden_sources and says nothing else, so a room id cannot be probed. A document source keeps its name
// and section without its room: they are part of the node's title (lib/knowledge-documents.js titleFor),
// already shown.
//
// Ranking is the hybrid rule of message search (server.js searchMessages): text matches and cosine
// neighbours fused by rank (lib/search-query.js fuseRrf). Text: each query word (prefix match from
// MIN_PREFIX_LEN chars, "quoted phrase" exact) in the title counts 2, in the summary 1. Semantic: the
// query vector (e5 "query:" prefix, embed passage:false) against node vectors of the index's model, the
// best SEMANTIC_K, dropping hits far below the best. Index not ready, timeout or failure → text only.
//
// Both halves scan the active nodes in memory: the vectors have to be read for the cosine anyway, and a
// JS scan matches Unicode words the way the query is parsed (SQLite lower()/LIKE fold ASCII only).
// The graph is one owner's knowledge (hundreds to a few thousand nodes, summaries ≤ MAX_TEXT chars).
const { parseSearchTerms, fuseRrf, words, MAX_INPUT, MIN_PREFIX_LEN } = require('./search-query');
const { SEARCH_TIMEOUT_MS } = require('./semantic-index');
const { fromBlob, dot } = require('./knowledge-graph');
const { createRoomAccess } = require('./room-access');

const LIMIT_DEFAULT = 8;
const LIMIT_MAX = 20;
const SEMANTIC_K = 20;
// Same relative cutoff as message search: small-model cosines sit in a narrow band, so hits far below
// the best one are noise rather than a weaker match.
const SEMANTIC_REL_CUTOFF = 0.05;
// Sources listed per node; the rest are counted in more_sources.
const SOURCES_MAX = 10;
// Usage history ranges (GET /api/knowledge/usage) as SQLite datetime modifiers, on the same clock as
// the used_at default.
const USAGE_RANGES = { '24h': '-24 hours', '7d': '-7 days', '30d': '-30 days' };

// `+node_id`: without it the planner walks idx_knowledge_usage_node to skip the GROUP BY sort, i.e. reads
// every row ever logged; this way only the range is read, from idx_knowledge_usage_time alone.
const USAGE_SQL = `SELECT node_id, COUNT(*) AS count FROM knowledge_usage WHERE used_at >= datetime('now', ?)
  GROUP BY +node_id ORDER BY count DESC, node_id`;

const ok = (body) => ({ status: 200, body });
const fail = (status, error) => ({ status, body: { error } });

// Query units: a loose chunk splits into its words (`stoa-agent` → stoa, agent), a quoted phrase stays
// whole and matches only as adjacent words.
function queryUnits(query) {
  const units = [];
  const seen = new Set();
  for (const t of parseSearchTerms(query)) {
    for (const u of t.exact ? [{ words: t.words, exact: true }] : t.words.map(w => ({ words: [w], exact: false }))) {
      const key = (u.exact ? 'e:' : 'w:') + u.words.join(' ');
      if (!seen.has(key)) { seen.add(key); units.push(u); }
    }
  }
  return units;
}

function unitIn(u, textWords, joined) {
  if (u.exact) return joined.includes(` ${u.words.join(' ')} `);
  const w = u.words[0];
  return w.length >= MIN_PREFIX_LEN ? textWords.some(x => x.startsWith(w)) : textWords.includes(w);
}

// 0..1: title hit 2, else summary hit 1, per unit, over 2 × units.
function textScore(units, node) {
  const tw = words(node.title);
  const sw = words(node.summary ?? '');
  const tj = ` ${tw.join(' ')} `;
  const sj = ` ${sw.join(' ')} `;
  let s = 0;
  for (const u of units) s += unitIn(u, tw, tj) ? 2 : unitIn(u, sw, sj) ? 1 : 0;
  return s / (2 * units.length);
}

// notify(data): to the owner's browser connections only (server.js broadcastGlobal), never to agents.
function createKnowledgeSearch({ db, semantic, notify = () => {}, log = console, now = () => new Date() }) {
  const roomAccess = createRoomAccess(db);
  const q = {
    active: db.prepare(`SELECT id, title, summary, category, CASE WHEN embedding_model=? THEN embedding END AS embedding
      FROM knowledge_nodes WHERE status='active'`),
    sources: db.prepare(`SELECT s.node_id, s.message_id, m.room_id AS message_room, m.thread_id,
        s.document_id, d.name AS document_name, s.section, d.room_id AS document_room
      FROM knowledge_sources s
      LEFT JOIN messages m ON m.id=s.message_id
      LEFT JOIN knowledge_documents d ON d.id=s.document_id
      WHERE s.node_id IN (SELECT value FROM json_each(?))
      ORDER BY s.node_id, s.id`),
    roomTitle: db.prepare('SELECT title FROM rooms WHERE id=?'),
    // sub_agent_label: kept for the history after the sub-agent is deleted (lib/knowledge-admin.js).
    use: db.prepare(`INSERT INTO knowledge_usage (node_id, actor_id, sub_agent_id, sub_agent_label, room_id)
      VALUES (@node, @actor, @sub, (SELECT label FROM sub_agents WHERE id=@sub), @room)`),
    usage: db.prepare(USAGE_SQL),
  };
  const recordUse = db.transaction((ids, ident) => {
    for (const id of ids) q.use.run({ node: id, actor: ident.actorId, sub: ident.subAgentId ?? null, room: ident.roomId });
  });

  function sourcesFor(nodeIds, ident) {
    const reach = new Map();
    const reachable = (roomId) => {
      if (!reach.has(roomId)) reach.set(roomId, roomAccess.canReach(roomId, ident) ? q.roomTitle.get(roomId)?.title ?? null : false);
      return reach.get(roomId);
    };
    const out = new Map(nodeIds.map(id => [id, { sources: [], hidden: 0, more: 0 }]));
    for (const s of q.sources.all(JSON.stringify(nodeIds))) {
      const o = out.get(s.node_id);
      const roomId = s.message_id != null ? s.message_room : s.document_room;
      const title = roomId != null ? reachable(roomId) : false;
      let src;
      if (s.message_id != null) {
        if (title === false) { o.hidden++; continue; }
        src = { type: 'message', room_id: roomId, room_title: title, thread_id: s.thread_id ?? null, message_id: s.message_id };
      } else {
        src = { type: 'document', name: s.document_name, section: s.section ?? null };
        if (title !== false) Object.assign(src, { room_id: roomId, room_title: title });
      }
      if (o.sources.length < SOURCES_MAX) o.sources.push(src); else o.more++;
    }
    return out;
  }

  // ident: { actorId, subAgentId, roomId } of an MCP session bound to a room the agent is in
  // (lib/stoa-mcp-tools.js asyncRoomTool). → { status, body: { results, semantic } }
  async function search(ident, args) {
    const { query, limit } = args;
    if (typeof query !== 'string' || !query.trim()) return fail(400, 'query must be a non-empty string');
    if (query.length > MAX_INPUT) return fail(400, `query is longer than ${MAX_INPUT} characters`);
    if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= LIMIT_MAX)) return fail(400, `limit must be an integer from 1 to ${LIMIT_MAX}`);
    const units = queryUnits(query);
    if (!units.length) return fail(400, 'query has no letters or digits to search for');
    const lim = limit ?? LIMIT_DEFAULT;

    // The only await: everything after it reads and writes in one synchronous run, so a node deleted
    // while the query was embedded is simply not there (no usage row for a node that is gone).
    let qvec = null;
    if (semantic?.ready) {
      const v = await semantic.embed([query], { passage: false, timeoutMs: SEARCH_TIMEOUT_MS });
      if (v?.[0]?.length) qvec = v[0];
    }

    const nodes = q.active.all(semantic?.model ?? null);
    const byId = new Map(nodes.map(n => [n.id, n]));
    const keyword = nodes.map(n => ({ id: n.id, s: textScore(units, n) })).filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || a.id - b.id).map(x => x.id);
    let semIds = [];
    if (qvec) {
      const sims = nodes.filter(n => n.embedding && n.embedding.length === qvec.length * 4)
        .map(n => ({ id: n.id, s: dot(fromBlob(n.embedding), qvec) }))
        .sort((a, b) => b.s - a.s || a.id - b.id).slice(0, SEMANTIC_K);
      // > 0: an orthogonal (or opposite) vector shares nothing with the query, even when it is the best.
      if (sims.length) semIds = sims.filter(x => x.s > 0 && x.s >= sims[0].s - SEMANTIC_REL_CUTOFF).map(x => x.id);
    }
    const top = fuseRrf(keyword, semIds).slice(0, lim);
    if (!top.length) return ok({ results: [], semantic: !!qvec });

    const ids = top.map(f => f.id);
    const src = sourcesFor(ids, ident);
    const results = top.map(f => {
      const n = byId.get(f.id);
      const s = src.get(f.id);
      return {
        id: n.id, title: n.title, summary: n.summary, category: n.category,
        score: Math.round(f.score * 1e4) / 1e4, match: f.keyword && f.semantic ? 'both' : f.keyword ? 'text' : 'semantic',
        sources: s.sources, ...(s.more ? { more_sources: s.more } : {}), ...(s.hidden ? { hidden_sources: s.hidden } : {}),
      };
    });
    recordUse(ids, ident);
    try {
      notify({ type: 'knowledge_used', node_ids: ids, actor_id: ident.actorId, sub_agent_id: ident.subAgentId ?? null, room_id: ident.roomId, at: now().toISOString() });
    } catch (e) {
      log.error(`[knowledge] knowledge_used broadcast failed: ${e.message}`);
    }
    return ok({ results, semantic: !!qvec });
  }

  // Uses per node in the last 24h / 7d / 30d, most used first. Nodes that still exist, stale included:
  // a stale node usually turns active again under the same id, and a deleted node takes its usage rows
  // with it (ON DELETE CASCADE). The history view decides how to draw a stale one.
  function usageCounts(range) {
    const mod = Object.hasOwn(USAGE_RANGES, range) ? USAGE_RANGES[range] : null;
    if (!mod) return fail(400, `range must be one of ${Object.keys(USAGE_RANGES).join(', ')}`);
    return ok({ range, nodes: q.usage.all(mod) });
  }

  return { search, usageCounts };
}

module.exports = { createKnowledgeSearch, LIMIT_DEFAULT, LIMIT_MAX, USAGE_RANGES, USAGE_SQL };
