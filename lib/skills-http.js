'use strict';
// HTTP routes of the skills library (lib/skills.js holds the logic). Owner routes need the session;
// three routes are open to agent secrets through lib/agent-scope.js: the manifest, blob reads and
// import. The caller is derived here once: the owner's session → null, an agent → { actorId }.

const fs = require('fs');
const { parseMultipart, zipStream, SkillError } = require('./skill-bundle');

// Same cap as /api/upload/raw. JSON create / PATCH carry files as base64 (4/3 of the bytes).
const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_JSON = Math.ceil(MAX_UPLOAD * 4 / 3) + 1024 * 1024;

const ID = String.raw`(\d{1,15})`;
const NAME = String.raw`([a-z][a-z0-9-]{1,47})`;
const ROUTES = {
  list: new RegExp('^/api/skills$'),
  importer: new RegExp('^/api/skills/import$'),
  one: new RegExp(`^/api/skills/${ID}$`),
  file: new RegExp(`^/api/skills/${ID}/files/(.+)$`),
  revisions: new RegExp(`^/api/skills/${ID}/revisions$`),
  revision: new RegExp(`^/api/skills/${ID}/revisions/${ID}$`),
  restore: new RegExp(`^/api/skills/${ID}/revisions/${ID}/restore$`),
  exporter: new RegExp(`^/api/skills/${ID}/export$`),
  manifest: new RegExp(`^/api/skills/${NAME}/manifest$`),
  blob: new RegExp('^/api/skill-blobs/([^/]+)$'),
};

// → Buffer, or null after answering 413 (the socket is dropped once the answer is out, like upload/raw).
function readRaw(req, res, max) {
  const tooLarge = () => {
    res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
    res.end(JSON.stringify({ error: `Upload larger than ${Math.round(max / 1048576)} MB`, code: 'too_large', max_bytes: max }));
    res.on('finish', () => req.destroy());
  };
  const declared = parseInt(req.headers['content-length'] || '', 10);
  if (Number.isFinite(declared) && declared > max) { tooLarge(); return Promise.resolve(null); }
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > max) { over = true; tooLarge(); resolve(null); } else chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', () => { if (!over) { over = true; resolve(null); } });
  });
}

function decodePath(raw) {
  try { return raw.split('/').map(decodeURIComponent).join('/'); } catch { return null; }
}

function createSkillsHttp({ skills, json }) {
  const send = (res, r) => json(res, r.body, r.status);
  const callerOf = (req) => (req._authUser ? null : { actorId: Number(req.headers['x-agent-id']), subAgentId: null });

  async function readJson(req, res, max = MAX_JSON) {
    const raw = await readRaw(req, res, max);
    if (raw === null) return undefined;
    try { return JSON.parse(raw.toString('utf8')); }
    catch { json(res, { error: 'Invalid JSON', code: 'invalid_body' }, 400); return undefined; }
  }

  // multipart: one `file` part, or `files` parts with `paths` text parts in the same order (folder);
  // optional `name` / `description` text parts. JSON: { url, name?, description? }.
  async function importRequest(req, res, url) {
    const dryRun = url.searchParams.get('dry_run') === '1';
    const caller = callerOf(req);
    const type = String(req.headers['content-type'] || '').toLowerCase();
    if (type.startsWith('application/json')) {
      const body = await readJson(req, res, 64 * 1024);
      if (body === undefined) return;
      if (!body || typeof body !== 'object') return json(res, { error: 'Expected a JSON object', code: 'invalid_body' }, 400);
      return send(res, await skills.importBundle({ kind: 'url', url: body.url }, caller, { dryRun, name: body.name ?? null, description: body.description ?? null }));
    }
    if (!type.startsWith('multipart/form-data')) return json(res, { error: 'Send multipart/form-data or JSON {url}', code: 'unsupported_format' }, 415);
    const raw = await readRaw(req, res, MAX_UPLOAD);
    if (raw === null) return;
    let parts;
    try { parts = parseMultipart(raw, req.headers['content-type']); }
    catch (e) { if (e instanceof SkillError) return json(res, { error: e.message, code: e.code }, e.status); throw e; }
    const text = (p) => p.data.toString('utf8');
    const field = (n) => { const p = parts.find(x => x.name === n && x.filename === null); return p ? text(p).trim() || null : null; };
    const opts = { dryRun, name: field('name'), description: field('description') };
    const single = parts.filter(p => p.name === 'file' && p.filename !== null);
    const many = parts.filter(p => p.name === 'files' && p.filename !== null);
    const paths = parts.filter(p => p.name === 'paths' && p.filename === null).map(text);
    if (single.length === 1 && !many.length) {
      return send(res, await skills.importBundle({ kind: 'file', filename: single[0].filename, data: single[0].data }, caller, opts));
    }
    if (many.length && !single.length) {
      if (paths.length !== many.length) return json(res, { error: 'Each "files" part needs a matching "paths" part', code: 'invalid_path' }, 400);
      return send(res, await skills.importBundle({ kind: 'folder', files: many.map((p, i) => ({ path: paths[i], data: p.data })) }, caller, opts));
    }
    return json(res, { error: 'Send one "file" part, or "files" + "paths" parts for a folder', code: 'unsupported_format' }, 400);
  }

  function sendBlob(res, r) {
    if (r.status !== 200) return send(res, r);
    const stat = fs.statSync(r.path);
    // Never rendered by the browser: the UI previews text / whitelisted images itself (blob URLs).
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // Content-addressed: the bytes behind a sha never change.
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    fs.createReadStream(r.path).pipe(res);
  }

  // Streamed: a bundle can reach 50 MB, so entries go out one by one with backpressure. Past the
  // headers an error can only cut the transfer, which the client sees as a failed download.
  async function sendExport(res, r) {
    if (r.status !== 200) return send(res, r);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      // r.name is a skill name ([a-z][a-z0-9-]*), so it needs no quoting beyond the quotes.
      'Content-Disposition': `attachment; filename="${r.name}.zip"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    try {
      for await (const chunk of zipStream(r.entries, { date: new Date(`${r.created_at.replace(' ', 'T')}Z`) })) {
        if (res.destroyed) return;
        if (!res.write(chunk)) await new Promise((resolve) => { res.once('drain', resolve); res.once('close', resolve); });
      }
      res.end();
    } catch (e) {
      console.error(`[skills] export of ${r.name} failed: ${e.message}`);
      res.destroy();
    }
  }

  // → true when the request was a skills route (answered), else false.
  async function handle(req, res, url) {
    const p = url.pathname;
    if (p !== '/api/skills' && !p.startsWith('/api/skills/') && !p.startsWith('/api/skill-blobs/')) return false;
    const m = (re) => p.match(re);
    const owner = !!req._authUser;
    let r;

    if (req.method === 'GET' && (r = m(ROUTES.blob))) { sendBlob(res, skills.blob(r[1], { owner })); return true; }
    if (req.method === 'GET' && (r = m(ROUTES.manifest))) { send(res, skills.manifest(r[1], { owner })); return true; }
    if (req.method === 'POST' && m(ROUTES.importer)) { await importRequest(req, res, url); return true; }

    if (req.method === 'GET' && m(ROUTES.list)) { send(res, skills.list()); return true; }
    if (req.method === 'POST' && m(ROUTES.list)) {
      const body = await readJson(req, res);
      if (body !== undefined) send(res, skills.create(body, callerOf(req)));
      return true;
    }
    if ((r = m(ROUTES.one))) {
      const id = Number(r[1]);
      if (req.method === 'GET') { send(res, skills.get(id)); return true; }
      if (req.method === 'DELETE') { send(res, skills.remove(id, callerOf(req))); return true; }
      if (req.method === 'PATCH') {
        const body = await readJson(req, res);
        if (body !== undefined) send(res, skills.update(id, body, callerOf(req)));
        return true;
      }
    }
    if ((r = m(ROUTES.file))) {
      const id = Number(r[1]);
      const filePath = decodePath(r[2]);
      if (filePath === null) { json(res, { error: 'Malformed file path', code: 'invalid_path' }, 400); return true; }
      // The body is the file itself, so base_version rides in the query string here.
      const base = url.searchParams.get('base_version');
      if (base !== null && !/^\d{1,15}$/.test(base)) { json(res, { error: 'base_version must be a non-negative integer', code: 'invalid_body' }, 400); return true; }
      const baseVersion = base === null ? undefined : Number(base);
      if (req.method === 'PUT') {
        const mode = url.searchParams.has('mode') ? Number(url.searchParams.get('mode')) : undefined;
        const data = await readRaw(req, res, MAX_UPLOAD);
        if (data !== null) send(res, skills.putFile(id, filePath, data, mode, callerOf(req), baseVersion));
        return true;
      }
      if (req.method === 'DELETE') { send(res, skills.deleteFile(id, filePath, callerOf(req), baseVersion)); return true; }
    }
    if (req.method === 'GET' && (r = m(ROUTES.revisions))) { send(res, skills.revisions(Number(r[1]))); return true; }
    if (req.method === 'GET' && (r = m(ROUTES.revision))) { send(res, skills.revision(Number(r[1]), Number(r[2]))); return true; }
    if (req.method === 'GET' && (r = m(ROUTES.exporter))) {
      const v = url.searchParams.get('version');
      if (v !== null && !/^\d{1,15}$/.test(v)) { json(res, { error: 'version must be a positive integer', code: 'invalid_version' }, 400); return true; }
      await sendExport(res, skills.exportRef(Number(r[1]), v === null ? null : Number(v)));
      return true;
    }
    if (req.method === 'POST' && (r = m(ROUTES.restore))) { send(res, skills.restore(Number(r[1]), Number(r[2]), callerOf(req))); return true; }

    json(res, { error: 'Not found', code: 'not_found' }, 404);
    return true;
  }

  return { handle };
}

module.exports = { createSkillsHttp, MAX_UPLOAD };
