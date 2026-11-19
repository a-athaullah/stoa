'use strict';
// Knowledge (3/6): knowledge nodes from a .md / .txt document an agent adds (stoa__knowledge_add) or
// the owner uploads from the room's knowledge panel (6/6, upload()).
//
// The agent names a file on its machine; its own connector reads it (knowledge_file_read, checks in
// lib/knowledge-file.js) and the server checks the text again. An upload sends the text in the request.
// Both go through store(), the one place that checks and writes a document. The document is split per ATX heading
// outside code fences, without an LLM: one node per section, source = (document_id, section). Raw
// text is never stored, only the scrubbed section text (summary) and the sha256 of the whole file.
//
// Identity in a room is the name: adding it again compares sections by key and hash, so an unchanged
// section keeps its node (and id), a changed one is rewritten, a new one inserted and a section that
// is gone loses its source row (knowledge_sources_ad deletes the node). Deleting the document
// cascades the same way. Document nodes are never merge targets of conversation extraction
// (lib/knowledge-extraction.js), so a node is owned by exactly one document section.
//
// Privacy: adding needs eligibleRoom() (lib/knowledge-extraction.js), checked before the file is
// asked for and again before writing; listing and deleting do not, so a document never gets stuck.
const crypto = require('crypto');
const { createKnowledgeGraph, createKnowledgeActivity, toBlob, scrub, graphChanged } = require('./knowledge-graph');
const { KNOWLEDGE_DOC_MAX_BYTES, nameError } = require('./knowledge-file');
const { MAX_TEXT } = require('./semantic-index');

const CATEGORIES = ['eng', 'ops', 'dec', 'res'];
const SECTIONS_MAX = 300;
const TITLE_MAX = 120;
// A node is embedded as `${title}\n${summary}` and the index only reads its first MAX_TEXT chars:
// a longer section would have text no semantic search can find. So every part fits whole.
const SECTION_MAX = MAX_TEXT - TITLE_MAX - 1;
const PATH_MAX = 4096;
const LIST_MAX = 500;
const EMBED_BATCH = 16;
const INTRO = '(intro)';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

// Code fence opener/closer (CommonMark): up to 3 spaces, then ≥3 backticks or tildes.
function fenceOf(line) {
  let i = 0;
  while (i < 3 && line[i] === ' ') i++;
  const ch = line[i];
  if (ch !== '`' && ch !== '~') return null;
  let n = 0;
  while (line[i + n] === ch) n++;
  if (n < 3) return null;
  return { ch, n, rest: line.slice(i + n) };
}

// ATX heading: up to 3 spaces, 1-6 '#', then a space/tab or end of line. → { level, text } or null.
// String scanning, not a regex: a line can be the whole 512 KB file.
function headingOf(line) {
  let i = 0;
  while (i < 3 && line[i] === ' ') i++;
  let level = 0;
  while (line[i + level] === '#') level++;
  if (level < 1 || level > 6) return null;
  const after = line[i + level];
  if (after !== undefined && after !== ' ' && after !== '\t') return null;
  let text = line.slice(i + level).trim();
  // Optional closing sequence: " ##" at the end (or the whole text is '#'s).
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end--;
  if (end === 0) text = '';
  else if (end < text.length && (text[end - 1] === ' ' || text[end - 1] === '\t')) text = text.slice(0, end).trim();
  return { level, text: oneLine(text) };
}

// Cuts text to at most max chars, at paragraph breaks (blank line) where possible; a paragraph
// longer than max is cut hard (never inside a surrogate pair).
function splitLong(text, max) {
  const parts = [];
  let cur = '';
  const push = () => { if (cur.trim()) parts.push(cur.trim()); cur = ''; };
  for (const para of text.split(/\n[ \t]*\n/)) {
    const piece = cur ? `${cur}\n\n${para}` : para;
    if (piece.length <= max) { cur = piece; continue; }
    push();
    let rest = para;
    while (rest.length > max) {
      let cut = max;
      const c = rest.charCodeAt(cut - 1);
      if (c >= 0xd800 && c <= 0xdbff) cut--;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut);
    }
    cur = rest;
  }
  push();
  return parts.filter(Boolean);
}

// → [{ key, text }] in document order. clean runs on each heading text before keys are built, so
// two headings that only differ in a redacted secret still get distinct keys (" #2"), and on each
// section body before it is cut, so a cut never splits a secret into pieces the redaction misses
// and the stored text is exactly what was measured.
// key: heading path "H1 > H2 > H3"; the same path again gets " #2", " #3"; text before the first
// heading is "(intro)"; a section over SECTION_MAX chars becomes " [part N]" pieces. Sections with
// no text under their heading are skipped. Setext headings (underlined with === / ---) are not
// recognised: they stay text of the section they are in.
function splitSections(text, { clean = (s) => s } = {}) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const raw = [];
  const stack = [];
  let cur = { key: INTRO, lines: [] };
  let fence = null;
  for (const line of lines) {
    if (fence) {
      const f = fenceOf(line);
      if (f && f.ch === fence.ch && f.n >= fence.n && !f.rest.trim()) fence = null;
      cur.lines.push(line);
      continue;
    }
    const f = fenceOf(line);
    if (f && !(f.ch === '`' && f.rest.includes('`'))) {
      fence = f;
      cur.lines.push(line);
      continue;
    }
    const h = headingOf(line);
    if (!h) { cur.lines.push(line); continue; }
    raw.push(cur);
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push({ level: h.level, text: oneLine(clean(h.text)) || '(untitled)' });
    cur = { key: stack.map(s => s.text).join(' > '), lines: [] };
  }
  raw.push(cur);

  const seen = new Map();
  const out = [];
  for (const s of raw) {
    const n = (seen.get(s.key) || 0) + 1;
    seen.set(s.key, n);
    const key = n > 1 ? `${s.key} #${n}` : s.key;
    const body = clean(s.lines.join('\n')).trim();
    if (!body) continue;
    const parts = body.length > SECTION_MAX ? splitLong(body, SECTION_MAX) : [body];
    if (parts.length === 1) out.push({ key, text: parts[0] });
    else parts.forEach((p, i) => out.push({ key: `${key} [part ${i + 1}]`, text: p }));
  }
  return out;
}

// "name: H1 > H2"; too long → "name: H2" (last heading); still too long → cut.
function titleFor(name, key) {
  const full = `${name}: ${key}`;
  if (full.length <= TITLE_MAX) return full;
  const last = key.split(' > ').pop();
  const short = `${name}: ${last}`;
  return short.length <= TITLE_MAX ? short : `${short.slice(0, TITLE_MAX - 1)}…`;
}

const ok = (body) => ({ status: 200, body });
const fail = (status, error) => ({ status, body: { error } });
const posInt = (v) => (Number.isInteger(v) && v > 0 ? v : null);

// readFile(ident, path) → Promise<{ name, content } | { status, error }>: the session's own
// connector reads the file (server.js readAgentKnowledgeFile).
function createKnowledgeDocuments({ db, semantic, eligibleRoom, readFile, notify = () => {}, log = console, edgeSim = 0.85, excludedRoom = () => false }) {
  const graph = createKnowledgeGraph(db, { edgeSim });
  const activity = createKnowledgeActivity({ db, notify, log, excludedRoom });
  // One add per (room, name) at a time; the transaction re-checks the document row as well.
  const busy = new Set();

  const q = {
    doc: db.prepare('SELECT id, content_hash, updated_at FROM knowledge_documents WHERE room_id=? AND name=?'),
    sources: db.prepare(`SELECT s.id, s.node_id, s.section, s.section_hash, n.embedding_model, n.status FROM knowledge_sources s
      JOIN knowledge_nodes n ON n.id=s.node_id WHERE s.document_id=?`),
    insertDoc: db.prepare(`INSERT INTO knowledge_documents (name, content_hash, bytes, added_by_actor_id, room_id, updated_at, updated_by_actor_id)
      VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`),
    updateDoc: db.prepare(`UPDATE knowledge_documents SET content_hash=?, bytes=?, updated_at=datetime('now'), updated_by_actor_id=? WHERE id=?`),
    insertNode: db.prepare('INSERT INTO knowledge_nodes (title, summary, category, embedding, embedding_model) VALUES (?, ?, ?, ?, ?)'),
    updateNode: db.prepare(`UPDATE knowledge_nodes SET title=?, summary=?, category=?, embedding=?, embedding_model=?,
      status='active', stale_at=NULL, updated_at=datetime('now') WHERE id=?`),
    insertSource: db.prepare('INSERT INTO knowledge_sources (node_id, document_id, section, section_hash) VALUES (?, ?, ?, ?)'),
    updateSource: db.prepare('UPDATE knowledge_sources SET section_hash=? WHERE id=?'),
    deleteSource: db.prepare('DELETE FROM knowledge_sources WHERE id=?'),
    activeNode: db.prepare("SELECT 1 FROM knowledge_nodes WHERE id=? AND status='active'"),
    list: db.prepare(`SELECT d.id, d.name, d.bytes, (SELECT COUNT(*) FROM knowledge_sources s WHERE s.document_id=d.id) AS sections,
      a.name AS added_by, d.created_at, d.updated_at, u.name AS updated_by
      FROM knowledge_documents d LEFT JOIN actors a ON a.id=d.added_by_actor_id LEFT JOIN actors u ON u.id=d.updated_by_actor_id
      WHERE d.room_id=? ORDER BY d.name LIMIT ${LIST_MAX + 1}`),
    sectionCount: db.prepare('SELECT COUNT(*) AS n FROM knowledge_sources WHERE document_id=?'),
    remove: db.prepare('DELETE FROM knowledge_documents WHERE id=? AND room_id=?'),
    docName: db.prepare('SELECT name FROM knowledge_documents WHERE id=? AND room_id=?'),
  };

  async function embedAll(texts) {
    const out = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      if (!semantic.ready) return null;
      const vecs = await semantic.embed(texts.slice(i, i + EMBED_BATCH), { passage: true });
      if (!vecs) return null;
      out.push(...vecs);
    }
    return out;
  }

  // stoa__knowledge_add. args: { path, name?, category? } → { status, body }.
  async function add(ident, args) {
    const roomId = ident.roomId;
    if (typeof args.path !== 'string' || !args.path.trim() || args.path.length > PATH_MAX) return fail(400, `path required (at most ${PATH_MAX} characters)`);
    if (args.name !== undefined) {
      const err = nameError(args.name);
      if (err) return fail(400, err);
    }
    // Category and room are checked before the agent is asked for the file, and again by store().
    if (args.category !== undefined && !CATEGORIES.includes(args.category)) return fail(400, `category must be one of ${CATEGORIES.join(', ')}`);
    if (!eligibleRoom(roomId)) return fail(403, 'knowledge is not enabled for this room');

    const file = await readFile(ident, args.path.trim());
    if (file.error) return fail(file.status || 400, file.error);
    if (typeof file.content !== 'string') return fail(502, 'the agent sent no file content');
    return store(ident, { content: file.content, name: args.name ?? file.name, nameFromFile: args.name === undefined, category: args.category });
  }

  // Upload from the owner's panel (POST /api/rooms/:id/knowledge/documents). ident: { actorId (the
  // owner), roomId }; data: the parsed JSON body { name, content, category? } → { status, body }.
  async function upload(ident, data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(400, 'body must be { "name", "content", "category"? }');
    const err = nameError(data.name);
    if (err) return fail(400, err);
    if (typeof data.content !== 'string') return fail(400, 'content must be a string');
    return store(ident, { content: data.content, name: data.name, nameFromFile: false, category: data.category });
  }

  // The one write path of both: text checks, eligibleRoom, split, embed, upsert by (room, name).
  async function store(ident, { content, name, nameFromFile, category: cat }) {
    const roomId = ident.roomId;
    if (cat !== undefined && !CATEGORIES.includes(cat)) return fail(400, `category must be one of ${CATEGORIES.join(', ')}`);
    const category = cat ?? 'res';
    if (!eligibleRoom(roomId)) return fail(403, 'knowledge is not enabled for this room');
    if (Buffer.byteLength(content, 'utf8') > KNOWLEDGE_DOC_MAX_BYTES) return fail(413, `document is larger than ${KNOWLEDGE_DOC_MAX_BYTES / 1024} KB`);
    if (content.includes('\u0000')) return fail(400, 'document is not text (NUL byte)');
    // A JSON string may carry a lone surrogate ("\ud800"), which is not text either.
    if (!content.isWellFormed()) return fail(400, 'document is not valid UTF-8 text');
    const nameErr = nameError(name);
    if (nameErr) return fail(400, nameFromFile ? `file name: ${nameErr} (pass name)` : nameErr);

    // Section keys are stored (knowledge_sources.section): headings are scrubbed like the text.
    const sections = splitSections(content, { clean: scrub });
    const safeName = scrub(name);
    if (!sections.length) return fail(400, 'document has no text');
    if (sections.length > SECTIONS_MAX) return fail(400, `document has ${sections.length} sections (max ${SECTIONS_MAX}); split it into smaller files`);

    const key = `${roomId}\u0000${name}`;
    if (busy.has(key)) return fail(409, 'this document is being added already; try again when that call is done');
    busy.add(key);
    try {
      if (!eligibleRoom(roomId)) return fail(403, 'knowledge is not enabled for this room');
      const hash = sha256(content);
      const bytes = Buffer.byteLength(content, 'utf8');
      const wanted = sections.map(s => {
        const title = titleFor(safeName, s.key);
        const summary = s.text;
        return { key: s.key, title, summary, category, hash: sha256(`${category}\n${title}\n${summary}`) };
      });
      const before = q.doc.get(roomId, name);
      const old = new Map((before ? q.sources.all(before.id) : []).map(r => [r.section, r]));
      const fresh = (w) => {
        const o = old.get(w.key);
        return o && o.section_hash === w.hash && o.embedding_model === semantic.model && o.status === 'active';
      };
      const toWrite = wanted.filter(w => !fresh(w));
      const gone = [...old.values()].filter(o => !wanted.some(w => w.key === o.section));
      const summary = { name, sections: wanted.length, added: 0, updated: 0, removed: gone.length, unchanged_sections: wanted.length - toWrite.length };
      if (before && before.content_hash === hash && !toWrite.length && !gone.length) {
        return ok({ document_id: before.id, unchanged: true, ...summary });
      }

      let vecs = [];
      if (toWrite.length) {
        vecs = await embedAll(toWrite.map(w => `${w.title}\n${w.summary}`));
        if (!vecs) return fail(503, 'the knowledge index is not ready yet; try again in a few minutes');
      }

      const r = db.transaction(() => {
        if (!eligibleRoom(roomId)) return fail(403, 'knowledge is not enabled for this room');
        const now = q.doc.get(roomId, name);
        if ((now?.id ?? null) !== (before?.id ?? null) || now?.updated_at !== before?.updated_at) {
          return fail(409, 'the document changed meanwhile; try again');
        }
        let docId;
        if (before) {
          docId = before.id;
          q.updateDoc.run(hash, bytes, ident.actorId, docId);
        } else {
          docId = Number(q.insertDoc.run(name, hash, bytes, ident.actorId, roomId, ident.actorId).lastInsertRowid);
        }
        for (const o of gone) q.deleteSource.run(o.id);
        const changed = [];
        toWrite.forEach((w, i) => {
          const vec = vecs[i];
          const o = old.get(w.key);
          if (o) {
            q.updateNode.run(w.title, w.summary, w.category, toBlob(vec), semantic.model, o.node_id);
            q.updateSource.run(w.hash, o.id);
            changed.push([o.node_id, vec]);
            summary.updated++;
          } else {
            const nodeId = Number(q.insertNode.run(w.title, w.summary, w.category, toBlob(vec), semantic.model).lastInsertRowid);
            q.insertSource.run(nodeId, docId, w.key, w.hash);
            changed.push([nodeId, vec]);
            summary.added++;
          }
        });
        if (changed.length) {
          const live = graph.activeNodes(semantic.model);
          for (const [id, vec] of changed) if (q.activeNode.get(id)) graph.edgesFor(id, vec, live);
        }
        return { ...ok({ document_id: docId, ...summary }), nodeIds: changed.map(([id]) => id) };
      })();
      if (r.status === 200) {
        log.log(`[knowledge] document ${r.body.document_id} room=${roomId}: ${summary.sections} sections, +${summary.added} ~${summary.updated} -${summary.removed}`);
        // A new hash with the same sections rewrites the document row only.
        if (summary.added || summary.updated || summary.removed) {
          graphChanged(notify, log, 'document_add', roomId);
          activity('document_add', {
            roomId, actorId: ident.actorId ?? null, subAgentId: ident.subAgentId ?? null, nodeIds: r.nodeIds,
            added: summary.added, updated: summary.updated, removed: summary.removed, docName: safeName,
          });
        }
      }
      return { status: r.status, body: r.body };
    } finally {
      busy.delete(key);
    }
  }

  function list(roomId) {
    const rows = q.list.all(roomId);
    return ok({ documents: rows.slice(0, LIST_MAX), ...(rows.length > LIST_MAX ? { truncated: true } : {}) });
  }

  // ident: who removed it (stoa__knowledge_document_delete); none from the owner's panel.
  function remove(roomId, id, ident = null) {
    if (!posInt(id)) return fail(400, 'id must be a positive integer');
    const r = db.transaction(() => {
      const nodes = q.sectionCount.get(id).n;
      const name = q.docName.get(id, roomId)?.name;
      // The room is part of the key: a document of another room answers exactly like a missing one.
      if (!q.remove.run(id, roomId).changes) return fail(404, 'document not found');
      log.log(`[knowledge] document ${id} room=${roomId} deleted (${nodes} sections)`);
      return { ...ok({ deleted: id, sections_removed: nodes }), name };
    })();
    if (r.status === 200 && r.body.sections_removed) {
      graphChanged(notify, log, 'document_remove', roomId);
      activity('document_remove', {
        roomId, actorId: ident?.actorId ?? null, subAgentId: ident?.subAgentId ?? null, removed: r.body.sections_removed, docName: scrub(r.name),
      });
    }
    return { status: r.status, body: r.body };
  }

  return { add, upload, list, remove };
}

module.exports = { createKnowledgeDocuments, splitSections, titleFor, SECTION_MAX, SECTIONS_MAX, TITLE_MAX, CATEGORIES };
