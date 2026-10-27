'use strict';
// Skills library: the one implementation of list / read / create / import / update / restore /
// delete, the agent manifest + blob reads, and resolving "/name" tokens in a prompt. The HTTP routes
// (/api/skills*, /api/skill-blobs/*) call it today and the built-in MCP tools will call the same
// functions, so validation and ownership cannot drift between the paths.
//
// caller: null for the owner's session, else { actorId, subAgentId } — the agent (or sub-agent)
// doing it. A mutation of a skill the caller did not create resolves as 404, never 403, so an agent
// cannot probe which skills exist through the error. Reads are open to every agent (skills are global).
// → { status, body } (blob reads return { status, path } / { status, body }).
//
// File contents are content-addressed blobs in blobsDir/<aa>/<sha256>; skill_files rows reference
// them. A blob is written before the rows that reference it, and both happen in one synchronous
// stretch, so the GC (which runs between events) never sees a blob that is about to be referenced.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const B = require('./skill-bundle');

const SKILLS_PER_ACTOR = 50;
const SKILLS_TOTAL = 200;
const REVISIONS_KEPT = 20;
const NOTE_MAX = 300;
const MAX_REFS = 3;
const SHA_RE = /^[0-9a-f]{64}$/;
// "/name" at the start of the prompt or after whitespace, ending at whitespace or the end.
const REF_RE = /(?:^|\s)\/([a-z][a-z0-9-]{1,47})(?=\s|$)/g;

const ok = (body, status = 200) => ({ status, body });
const fail = (status, code, error) => ({ status, body: { error, code } });
const fromError = (e) => {
  if (e instanceof B.SkillError) return fail(e.status, e.code, e.message);
  throw e;
};

function createSkills({ db, blobsDir, onChange = () => {}, fetchImpl = (...a) => fetch(...a), limits = {} }) {
  const perActor = limits.perActor ?? SKILLS_PER_ACTOR;
  const total = limits.total ?? SKILLS_TOTAL;
  const keep = limits.revisionsKept ?? REVISIONS_KEPT;

  const LIST_SQL = `SELECT s.*, r.version, r.file_count, r.total_bytes, r.manifest_hash,
      a.name AS actor_name, sa.label AS sub_agent_label
    FROM skills s
    LEFT JOIN skill_revisions r ON r.id=s.current_revision_id
    LEFT JOIN actors a ON a.id=s.created_by_actor_id
    LEFT JOIN sub_agents sa ON sa.id=s.created_by_sub_agent_id`;
  const q = {
    list: db.prepare(`${LIST_SQL} ORDER BY s.name`),
    one: db.prepare(`${LIST_SQL} WHERE s.id=?`),
    byName: db.prepare(`${LIST_SQL} WHERE s.name=?`),
    nameTaken: db.prepare('SELECT id FROM skills WHERE name=?'),
    countActor: db.prepare('SELECT COUNT(*) AS c FROM skills WHERE created_by_actor_id=?'),
    countAll: db.prepare('SELECT COUNT(*) AS c FROM skills'),
    revision: db.prepare('SELECT * FROM skill_revisions WHERE id=?'),
    revisionByVersion: db.prepare('SELECT * FROM skill_revisions WHERE skill_id=? AND version=?'),
    revisions: db.prepare(`SELECT r.id, r.version, r.manifest_hash, r.total_bytes, r.file_count, r.note, r.source_url, r.created_at,
        r.author_actor_id, r.author_sub_agent_id, a.name AS author_name, sa.label AS author_sub_agent_label
      FROM skill_revisions r LEFT JOIN actors a ON a.id=r.author_actor_id LEFT JOIN sub_agents sa ON sa.id=r.author_sub_agent_id
      WHERE r.skill_id=? ORDER BY r.version DESC`),
    files: db.prepare('SELECT path, sha256, size, mode FROM skill_files WHERE revision_id=? ORDER BY path'),
    maxVersion: db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM skill_revisions WHERE skill_id=?'),
    insertSkill: db.prepare(`INSERT INTO skills (name, description, argument_hint, created_by_actor_id, created_by_sub_agent_id)
      VALUES (?,?,?,?,?)`),
    insertRevision: db.prepare(`INSERT INTO skill_revisions (skill_id, version, body, manifest_hash, total_bytes, file_count,
      author_actor_id, author_sub_agent_id, note, source_url) VALUES (?,?,?,?,?,?,?,?,?,?)`),
    insertFile: db.prepare('INSERT INTO skill_files (revision_id, path, sha256, size, mode) VALUES (?,?,?,?,?)'),
    setCurrent: db.prepare(`UPDATE skills SET name=?, description=?, argument_hint=?, current_revision_id=?, updated_at=datetime('now') WHERE id=?`),
    setEnabled: db.prepare('UPDATE skills SET enabled=? WHERE id=?'),
    pruneRevisions: db.prepare(`DELETE FROM skill_revisions WHERE skill_id=? AND id != ? AND version <= (
      SELECT version FROM skill_revisions WHERE skill_id=? ORDER BY version DESC LIMIT 1 OFFSET ?)`),
    remove: db.prepare('DELETE FROM skills WHERE id=?'),
    // A blob an agent may read: in the current revision of an enabled skill.
    agentBlob: db.prepare(`SELECT 1 FROM skill_files f JOIN skills s ON s.current_revision_id=f.revision_id
      WHERE f.sha256=? AND s.enabled=1 LIMIT 1`),
    anyBlob: db.prepare('SELECT 1 FROM skill_files WHERE sha256=? LIMIT 1'),
    allShas: db.prepare('SELECT DISTINCT sha256 FROM skill_files'),
    enabledByNames: db.prepare(`${LIST_SQL} WHERE s.enabled=1 AND s.name IN (SELECT value FROM json_each(?))`),
  };

  // ── Blob store ──────────────────────────────────────────────────────────────────────────────

  const blobPath = (sha) => path.join(blobsDir, sha.slice(0, 2), sha);

  function writeBlob(data) {
    const sha = B.sha256(data);
    const fp = blobPath(sha);
    if (!fs.existsSync(fp)) {
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      const tmp = `${fp}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, fp);
    }
    return sha;
  }

  function readBlob(sha) {
    return fs.readFileSync(blobPath(sha));
  }

  // ── Shapes ──────────────────────────────────────────────────────────────────────────────────

  function item(r) {
    return {
      id: r.id, name: r.name, description: r.description, argument_hint: r.argument_hint ?? null,
      enabled: !!r.enabled, version: r.version ?? 0, file_count: r.file_count ?? 0, total_bytes: r.total_bytes ?? 0,
      updated_at: r.updated_at, created_at: r.created_at,
      created_by_actor_id: r.created_by_actor_id ?? null, created_by_sub_agent_id: r.created_by_sub_agent_id ?? null,
      creator_name: r.created_by_sub_agent_id ? (r.sub_agent_label ?? null) : (r.created_by_actor_id ? (r.actor_name ?? null) : null),
    };
  }

  function detail(r) {
    const rev = r.current_revision_id ? q.revision.get(r.current_revision_id) : null;
    return {
      ...item(r),
      body: rev ? B.parseFrontmatter(rev.body).body : '',
      files: rev ? q.files.all(rev.id) : [],
    };
  }

  const canMutate = (skill, caller) => !caller || (
    skill.created_by_actor_id === caller.actorId
    && (caller.subAgentId == null || skill.created_by_sub_agent_id === caller.subAgentId)
  );

  // ── Validation ──────────────────────────────────────────────────────────────────────────────

  function checkMeta({ name, description, argumentHint }, { skillId = null } = {}) {
    const bad = B.checkName(name);
    if (bad) throw new B.SkillError(bad.code, bad.error);
    const taken = q.nameTaken.get(name);
    if (taken && taken.id !== skillId) throw new B.SkillError('name_taken', `A skill named "/${name}" already exists`, 409);
    if (typeof description !== 'string' || !B.oneLine(description)) throw new B.SkillError('description_required', 'Description is required');
    if (B.oneLine(description).length > B.DESCRIPTION_MAX) throw new B.SkillError('too_large', `Description must be at most ${B.DESCRIPTION_MAX} characters`);
    if (argumentHint != null && (typeof argumentHint !== 'string' || B.oneLine(argumentHint).length > B.ARGUMENT_HINT_MAX)) {
      throw new B.SkillError('too_large', `argument_hint must be a string of at most ${B.ARGUMENT_HINT_MAX} characters`);
    }
  }

  function checkQuota(caller) {
    if (!caller) return;
    if (q.countActor.get(caller.actorId).c >= perActor) throw new B.SkillError('quota_exceeded', `An agent can create at most ${perActor} skills`, 429);
    if (q.countAll.get().c >= total) throw new B.SkillError('quota_exceeded', `The library is full (${total} skills); ask the owner to remove some`, 429);
  }

  function checkNote(note) {
    if (note == null) return null;
    if (typeof note !== 'string') throw new B.SkillError('invalid_note', 'note must be a string');
    const n = B.oneLine(note);
    if (n.length > NOTE_MAX) throw new B.SkillError('too_large', `note must be at most ${NOTE_MAX} characters`);
    return n || null;
  }

  // [{path, content_base64, mode?}] → [{path, data, mode}]. SKILL.md is the body, never a file entry.
  function decodeFiles(list, field) {
    if (list == null) return [];
    if (!Array.isArray(list)) throw new B.SkillError('invalid_files', `${field} must be an array`);
    if (list.length > B.LIMITS.files) throw new B.SkillError('too_many_files', `A skill can hold at most ${B.LIMITS.files} files`);
    return list.map((f) => {
      if (!f || typeof f !== 'object') throw new B.SkillError('invalid_files', `${field} entries must be objects`);
      const p = B.checkPath(f.path);
      if (p.toLowerCase() === 'skill.md') throw new B.SkillError('invalid_path', 'SKILL.md is the skill body; send it as body, not as a file');
      if (typeof f.content_base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.content_base64)) {
        throw new B.SkillError('invalid_files', `${p}: content_base64 must be base64`);
      }
      if (f.mode != null && f.mode !== 0o644 && f.mode !== 0o755) throw new B.SkillError('invalid_files', `${p}: mode must be 420 (0644) or 493 (0755)`);
      return { path: p, data: Buffer.from(f.content_base64, 'base64'), mode: f.mode ?? 0o644 };
    });
  }

  // fileMap: Map(path → {path, sha256, size, mode}) without SKILL.md. Rejects case-insensitive
  // duplicates and file-vs-folder clashes the same way an archive import does.
  function checkTree(fileMap) {
    const seen = new Map();
    for (const p of fileMap.keys()) {
      const k = p.toLowerCase();
      if (k === 'skill.md') throw new B.SkillError('invalid_path', 'SKILL.md is the skill body, not a file');
      if (seen.has(k)) throw new B.SkillError('duplicate_path', `Duplicate file path (names are compared case-insensitively): ${p}`);
      seen.set(k, p);
    }
    for (const k of seen.keys()) {
      const segs = k.split('/');
      for (let i = 1; i < segs.length; i++) {
        if (seen.has(segs.slice(0, i).join('/'))) throw new B.SkillError('duplicate_path', `"${seen.get(segs.slice(0, i).join('/'))}" is both a file and a folder`);
      }
    }
  }

  // ── Revisions ───────────────────────────────────────────────────────────────────────────────

  // Writes the blobs, then (synchronously, in one transaction) the revision and its file rows, and
  // points the skill at it. Returns false when nothing changed (same manifest as the current one).
  function commitRevision(skillId, { name, description, argumentHint, extras, body, fileMap, caller, note, sourceUrl, currentHash }) {
    const skillMd = B.buildSkillMd({ name, description: B.oneLine(description), argumentHint: argumentHint ? B.oneLine(argumentHint) : null, extras, body });
    const mdBuf = Buffer.from(skillMd, 'utf8');
    if (mdBuf.length > B.LIMITS.skillMdBytes) throw new B.SkillError('too_large', `SKILL.md is larger than ${B.LIMITS.skillMdBytes / 1024} KB`);
    checkTree(fileMap);
    const entries = [...fileMap.values()];
    B.checkLimits([{ path: B.SKILL_MD, size: mdBuf.length }, ...entries]);
    const all = [{ path: B.SKILL_MD, sha256: B.sha256(mdBuf), size: mdBuf.length, mode: 0o644 }, ...entries];
    const hash = B.manifestHash(all);
    if (currentHash && hash === currentHash) return false;
    writeBlob(mdBuf);
    for (const e of entries) if (e.data) writeBlob(e.data);
    db.transaction(() => {
      const version = q.maxVersion.get(skillId).v + 1;
      const totalBytes = all.reduce((n, f) => n + f.size, 0);
      const revId = Number(q.insertRevision.run(skillId, version, skillMd, hash, totalBytes, all.length,
        caller?.actorId ?? null, caller?.subAgentId ?? null, note ?? null, sourceUrl ?? null).lastInsertRowid);
      for (const f of all) q.insertFile.run(revId, f.path, f.sha256, f.size, f.mode);
      q.setCurrent.run(name, B.oneLine(description), argumentHint ? B.oneLine(argumentHint) : null, revId, skillId);
      q.pruneRevisions.run(skillId, revId, skillId, keep);
    })();
    return true;
  }

  const fileEntry = ({ path: p, data, mode }) => ({ path: p, data, sha256: B.sha256(data), size: data.length, mode });

  function currentState(skill) {
    const rev = q.revision.get(skill.current_revision_id);
    const fm = B.parseFrontmatter(rev.body);
    const fileMap = new Map();
    for (const f of q.files.all(rev.id)) if (f.path !== B.SKILL_MD) fileMap.set(f.path, f);
    return { rev, fm, fileMap };
  }

  // ── Create / import ─────────────────────────────────────────────────────────────────────────

  function insertSkill({ name, description, argumentHint, extras = [], body, files, caller, note, sourceUrl }) {
    checkMeta({ name, description, argumentHint });
    checkQuota(caller);
    const fileMap = new Map(files.map(f => [f.path, fileEntry(f)]));
    let id;
    db.transaction(() => {
      id = Number(q.insertSkill.run(name, B.oneLine(description), argumentHint ? B.oneLine(argumentHint) : null,
        caller?.actorId ?? null, caller?.subAgentId ?? null).lastInsertRowid);
      commitRevision(id, { name, description, argumentHint, extras, body, fileMap, caller, note, sourceUrl });
    })();
    onChange();
    return ok({ skill: detail(q.one.get(id)) }, 201);
  }

  function create(input, caller = null) {
    try {
      if (!input || typeof input !== 'object') return fail(400, 'invalid_body', 'Expected a JSON object');
      if (input.body != null && typeof input.body !== 'string') return fail(400, 'invalid_body', 'body must be a string');
      return insertSkill({
        name: input.name, description: input.description, argumentHint: input.argument_hint || null,
        body: input.body || '', files: decodeFiles(input.files, 'files'), caller, note: checkNote(input.note),
      });
    } catch (e) { return fromError(e); }
  }

  // An archive's frontmatter, made into a form: slug name (or the override / folder name),
  // one-line description (or the first line of the body), the rest of the keys kept raw.
  function bundleToForm(bundle, nameOverride) {
    const fm = B.parseFrontmatter(bundle.skillMd);
    const warnings = [...bundle.warnings, ...fm.warnings];
    let name = nameOverride ?? null;
    if (name == null) {
      const declared = fm.fields.name || bundle.folderName || '';
      name = B.slugify(declared);
      if (declared && name !== declared) warnings.push(`Name "${String(declared).slice(0, 60)}" changed to "${name}"`);
    }
    let description = B.oneLine(fm.fields.description || '');
    if (!description) {
      const firstLine = fm.body.split('\n').map(l => B.oneLine(l.replace(/^#+\s*/, ''))).find(Boolean) || '';
      if (firstLine) { description = firstLine; warnings.push('SKILL.md has no description; the first line of the body is used'); }
    }
    if (description.length > B.DESCRIPTION_MAX) {
      description = description.slice(0, B.DESCRIPTION_MAX - 1).trimEnd() + '…';
      warnings.push(`Description shortened to ${B.DESCRIPTION_MAX} characters`);
    }
    let argumentHint = B.oneLine(fm.fields['argument-hint'] || '') || null;
    if (argumentHint && argumentHint.length > B.ARGUMENT_HINT_MAX) { argumentHint = argumentHint.slice(0, B.ARGUMENT_HINT_MAX); warnings.push('argument-hint shortened'); }
    return { name, description, argumentHint, extras: fm.extras, body: fm.body, warnings };
  }

  // input: { kind: 'file', filename, data } | { kind: 'folder', files: [{path, data}] } | { kind: 'url', url }
  // name / description override what the bundle declares (a clashing name, a SKILL.md without description).
  async function importBundle(input, caller = null, { dryRun = false, name: nameOverride = null, description: descriptionOverride = null } = {}) {
    try {
      if (nameOverride != null && typeof nameOverride !== 'string') return fail(400, 'name_invalid', 'name must be a string');
      if (descriptionOverride != null && typeof descriptionOverride !== 'string') return fail(400, 'invalid_body', 'description must be a string');
      let bundle;
      let sourceUrl = null;
      if (input.kind === 'url') {
        if (typeof input.url !== 'string' || !input.url) return fail(400, 'invalid_url', 'url is required');
        bundle = await B.readGithub(input.url, fetchImpl);
        sourceUrl = bundle.sourceUrl;
      } else if (input.kind === 'folder') {
        if (!input.files.length) return fail(400, 'missing_skill_md', 'The folder is empty');
        if (input.files.length > B.LIMITS.files) return fail(400, 'too_many_files', `A skill can hold at most ${B.LIMITS.files} files`);
        bundle = B.assembleBundle(input.files.map(f => ({ path: B.checkPath(f.path), data: f.data, mode: 0o644 })));
      } else {
        const kind = B.detectKind(input.filename, input.data);
        if (kind === 'md') bundle = { skillMd: B.decodeSkillMd(input.data), files: [], folderName: B.baseName(input.filename), warnings: [] };
        else if (kind === 'zip') bundle = B.assembleBundle(await B.readZip(input.data), { fallbackName: B.baseName(input.filename) });
        else if (kind === 'tar') bundle = B.assembleBundle(await B.readTar(input.data), { fallbackName: B.baseName(input.filename) });
        else return fail(400, 'unsupported_format', 'Supported files: .md, .zip, .skill, .tar, .tar.gz, .tgz');
      }
      const form = bundleToForm(bundle, nameOverride);
      if (descriptionOverride != null && B.oneLine(descriptionOverride)) form.description = B.oneLine(descriptionOverride);
      if (dryRun) {
        const files = [
          { path: B.SKILL_MD, size: Buffer.byteLength(bundle.skillMd), mode: 0o644 },
          ...bundle.files.map(f => ({ path: f.path, size: f.data.length, mode: f.mode })),
        ];
        const nameProblem = B.checkName(form.name);
        if (nameProblem) form.warnings.push(nameProblem.error);
        if (!form.description) form.warnings.push('Description is required before the skill can be saved');
        return ok({ preview: {
          name: form.name, description: form.description, argument_hint: form.argumentHint, files,
          total_bytes: files.reduce((n, f) => n + f.size, 0), warnings: form.warnings, name_taken: !!q.nameTaken.get(form.name),
        } });
      }
      return insertSkill({ ...form, files: bundle.files, caller, note: 'Imported', sourceUrl });
    } catch (e) { return fromError(e); }
  }

  // ── Update ──────────────────────────────────────────────────────────────────────────────────

  const UPDATABLE = new Set(['name', 'description', 'argument_hint', 'body', 'enabled', 'upsert_files', 'delete_files', 'note']);

  function mutable(id, caller) {
    const skill = q.one.get(id);
    if (!skill || !canMutate(skill, caller)) return null;
    return skill;
  }

  function update(id, patch, caller = null) {
    try {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return fail(400, 'invalid_body', 'Expected a JSON object');
      const unknown = Object.keys(patch).filter(k => !UPDATABLE.has(k));
      if (unknown.length) return fail(400, 'invalid_body', `Unknown field(s): ${unknown.join(', ')}`);
      const skill = mutable(id, caller);
      if (!skill) return fail(404, 'not_found', 'Skill not found');
      if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') return fail(400, 'invalid_body', 'enabled must be a boolean');
      if (patch.body !== undefined && typeof patch.body !== 'string') return fail(400, 'invalid_body', 'body must be a string');
      if (patch.delete_files !== undefined && (!Array.isArray(patch.delete_files) || patch.delete_files.some(p => typeof p !== 'string'))) {
        return fail(400, 'invalid_files', 'delete_files must be an array of paths');
      }
      const upserts = decodeFiles(patch.upsert_files, 'upsert_files');
      const note = checkNote(patch.note);
      const { rev, fm, fileMap } = currentState(skill);
      for (const p of patch.delete_files || []) {
        if (!fileMap.has(p)) return fail(404, 'file_not_found', `No file ${p} in this skill`);
        fileMap.delete(p);
      }
      for (const f of upserts) fileMap.set(f.path, fileEntry(f));
      const next = {
        name: patch.name ?? skill.name,
        description: patch.description ?? skill.description,
        argumentHint: patch.argument_hint !== undefined ? (patch.argument_hint || null) : skill.argument_hint,
      };
      const contentChange = ['name', 'description', 'argument_hint', 'body', 'upsert_files', 'delete_files'].some(k => patch[k] !== undefined);
      if (contentChange) checkMeta(next, { skillId: skill.id });
      let changed = false;
      db.transaction(() => {
        if (contentChange) {
          changed = commitRevision(skill.id, {
            ...next, extras: fm.extras, body: patch.body ?? fm.body, fileMap, caller, note, currentHash: rev.manifest_hash,
          }) || changed;
        }
        if (patch.enabled !== undefined && !!skill.enabled !== patch.enabled) { q.setEnabled.run(patch.enabled ? 1 : 0, skill.id); changed = true; }
      })();
      if (changed) onChange();
      return ok({ skill: detail(q.one.get(skill.id)) });
    } catch (e) { return fromError(e); }
  }

  function putFile(id, rawPath, data, mode, caller = null) {
    let p;
    try { p = B.checkPath(rawPath); } catch (e) { return fromError(e); }
    return update(id, { upsert_files: [{ path: p, content_base64: data.toString('base64'), mode }] }, caller);
  }

  function deleteFile(id, rawPath, caller = null) {
    return update(id, { delete_files: [rawPath] }, caller);
  }

  function revisions(id) {
    const skill = q.one.get(id);
    if (!skill) return fail(404, 'not_found', 'Skill not found');
    return ok({ revisions: q.revisions.all(id).map(r => ({ ...r, current: r.id === skill.current_revision_id })) });
  }

  // A restore is a new revision with the old content, so the history itself is never rewritten.
  function restore(id, version, caller = null) {
    try {
      const skill = mutable(id, caller);
      if (!skill) return fail(404, 'not_found', 'Skill not found');
      const old = q.revisionByVersion.get(skill.id, version);
      if (!old) return fail(404, 'revision_not_found', `No version ${version} of this skill`);
      const fm = B.parseFrontmatter(old.body);
      const fileMap = new Map();
      for (const f of q.files.all(old.id)) if (f.path !== B.SKILL_MD) fileMap.set(f.path, f);
      const name = skill.name;
      const description = B.oneLine(fm.fields.description || skill.description);
      const argumentHint = B.oneLine(fm.fields['argument-hint'] || '') || null;
      checkMeta({ name, description, argumentHint }, { skillId: skill.id });
      const current = q.revision.get(skill.current_revision_id);
      const changed = commitRevision(skill.id, {
        name, description, argumentHint, extras: fm.extras, body: fm.body, fileMap, caller,
        note: `Restored version ${version}`, currentHash: current.manifest_hash,
      });
      if (changed) onChange();
      return ok({ skill: detail(q.one.get(skill.id)) });
    } catch (e) { return fromError(e); }
  }

  function remove(id, caller = null) {
    const skill = mutable(id, caller);
    if (!skill) return fail(404, 'not_found', 'Skill not found');
    q.remove.run(skill.id);
    onChange();
    return ok({ ok: true });
  }

  // ── Reads ───────────────────────────────────────────────────────────────────────────────────

  function list() {
    return ok({ skills: q.list.all().map(item) });
  }

  function get(id) {
    const r = q.one.get(id);
    return r ? ok({ skill: detail(r) }) : fail(404, 'not_found', 'Skill not found');
  }

  // Agents get enabled skills only; the owner's session also sees a disabled one.
  function manifest(name, { owner = false } = {}) {
    const r = typeof name === 'string' ? q.byName.get(name) : null;
    if (!r || !r.current_revision_id || (!owner && !r.enabled)) return fail(404, 'not_found', 'Skill not found');
    return ok({ id: r.id, name: r.name, version: r.version, manifest_hash: r.manifest_hash, files: q.files.all(r.current_revision_id) });
  }

  // → { status: 200, path } or a fail(). Owner: any blob a revision references; agent: only one in
  // the current revision of an enabled skill.
  function blob(sha, { owner = false } = {}) {
    if (typeof sha !== 'string' || !SHA_RE.test(sha)) return fail(404, 'not_found', 'Blob not found');
    if (!(owner ? q.anyBlob : q.agentBlob).get(sha)) return fail(404, 'not_found', 'Blob not found');
    const fp = blobPath(sha);
    if (!fs.existsSync(fp)) return fail(404, 'not_found', 'Blob not found');
    return { status: 200, path: fp };
  }

  // The enabled skills a prompt names with "/name" (first MAX_REFS distinct, in order), each with
  // what the trigger needs: the agent cache key and, for clients without the skill cache, the body.
  function resolveRefs(text) {
    if (typeof text !== 'string' || !text.includes('/')) return [];
    const names = [];
    for (const m of text.matchAll(REF_RE)) {
      if (!names.includes(m[1])) names.push(m[1]);
      if (names.length >= MAX_REFS * 4) break;
    }
    if (!names.length) return [];
    const rows = new Map(q.enabledByNames.all(JSON.stringify(names)).filter(r => r.current_revision_id).map(r => [r.name, r]));
    return names.filter(n => rows.has(n)).slice(0, MAX_REFS).map((n) => {
      const r = rows.get(n);
      return { id: r.id, name: r.name, version: r.version, manifest_hash: r.manifest_hash, file_count: r.file_count, body: q.revision.get(r.current_revision_id).body };
    });
  }

  // Blobs no revision references any more (deleted skills, pruned revisions). → count removed
  function gc() {
    const live = new Set(q.allShas.all().map(r => r.sha256));
    let removed = 0;
    let dirs;
    try { dirs = fs.readdirSync(blobsDir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return 0; throw e; }
    for (const d of dirs) {
      if (!d.isDirectory() || !/^[0-9a-f]{2}$/.test(d.name)) continue;
      const dir = path.join(blobsDir, d.name);
      for (const f of fs.readdirSync(dir)) {
        // Leftover temp files of an interrupted write are garbage too.
        if (SHA_RE.test(f) && live.has(f)) continue;
        try { fs.unlinkSync(path.join(dir, f)); removed++; } catch (e) { console.error('[skills-gc] delete error:', f, e.message); }
      }
    }
    return removed;
  }

  return { list, get, create, importBundle, update, putFile, deleteFile, revisions, restore, remove, manifest, blob, readBlob, resolveRefs, gc };
}

module.exports = { createSkills, SKILLS_PER_ACTOR, SKILLS_TOTAL, REVISIONS_KEPT, MAX_REFS };
