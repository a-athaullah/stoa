'use strict';
// Skill bundles: reading what an import hands the server (SKILL.md, .zip / .skill, .tar / .tar.gz,
// a folder sent as multipart, a public GitHub URL) into one validated { skillMd, files } shape, and
// the SKILL.md frontmatter both ways. Every archive goes through the same path checks and size
// limits, because an archive is the main attack surface of the feature (zip-slip, symlinks, bombs).
// Pure apart from the GitHub fetch, which takes its fetch as a parameter so tests never hit the network.

const crypto = require('crypto');
const path = require('path');
const zlib = require('zlib');
const yauzl = require('yauzl');
const tarStream = require('tar-stream');

const LIMITS = {
  totalBytes: 50 * 1024 * 1024,
  fileBytes: 20 * 1024 * 1024,
  files: 300,
  skillMdBytes: 64 * 1024,
  pathChars: 200,
  depth: 8,
  // An entry that inflates more than 100x is treated as a bomb — but only past 1 MiB, since a small
  // repetitive text file (a table, a template) legitimately compresses that well.
  ratio: 100,
  ratioMinBytes: 1024 * 1024,
  // Entries a zip may list at all (dirs and ignored metadata included) before we stop reading it.
  zipEntries: 2000,
  downloadBytes: 50 * 1024 * 1024,
  downloadTimeoutMs: 30_000,
  redirects: 3,
};

const NAME_RE = /^[a-z][a-z0-9-]{1,47}$/;
// Composer / harness commands a skill must not shadow.
const RESERVED_NAMES = new Set([
  'compact', 'clear', 'help', 'model', 'models', 'skills', 'skill', 'reauth', 'logout', 'login',
  'status', 'stop', 'cost', 'config', 'init', 'memory', 'resume', 'review', 'exit', 'quit', 'new', 'reset',
]);
const DESCRIPTION_MAX = 500;
const ARGUMENT_HINT_MAX = 200;
const SKILL_MD = 'SKILL.md';

class SkillError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, message, status) => { throw new SkillError(code, message, status); };

// → null when valid, else { code, error }.
function checkName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    return { code: 'name_invalid', error: 'Name must be 2-48 characters: lowercase letters, digits and hyphens, starting with a letter' };
  }
  if (RESERVED_NAMES.has(name)) return { code: 'name_reserved', error: `"/${name}" is a built-in command` };
  return null;
}

// "Header Gen!" → "header-gen". The result still has to pass checkName.
function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 48).replace(/-+$/, '');
}

// One line, no control characters, whitespace collapsed.
function oneLine(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Paths ─────────────────────────────────────────────────────────────────────────────────────

// A path inside a skill: relative, POSIX, no traversal. → normalized path, or throws invalid_path.
function checkPath(p) {
  const bad = (why) => fail('invalid_path', `Invalid file path ${JSON.stringify(String(p).slice(0, 80))}: ${why}`);
  if (typeof p !== 'string' || !p) bad('empty');
  if (p.length > LIMITS.pathChars) bad(`longer than ${LIMITS.pathChars} characters`);
  if (/[\u0000-\u001f\u007f]/.test(p)) bad('control character');
  if (p.includes('\\')) bad('backslash');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) bad('absolute path');
  const segs = p.split('/');
  if (segs.some(s => s === '..')) bad('".." segment');
  if (segs.some(s => s === '' || s === '.')) bad('empty or "." segment');
  if (segs.length > LIMITS.depth) bad(`deeper than ${LIMITS.depth} levels`);
  return p;
}

// macOS archive noise, dropped without failing the import: __MACOSX/, .DS_Store and the AppleDouble
// "._<name>" files BSD tar / Finder add next to every file (they would also break top-level detection).
function isIgnoredPath(p) {
  const segs = p.split('/');
  const base = segs[segs.length - 1];
  return segs[0] === '__MACOSX' || base === '.DS_Store' || base.startsWith('._');
}

// ── Frontmatter ───────────────────────────────────────────────────────────────────────────────

const KEY_RE = /^([A-Za-z0-9_][A-Za-z0-9_-]*):(?:[ \t]+(.*?))?[ \t]*$/;

function unquote(v) {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1); }
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v.replace(/[ \t]+#.*$/, '');
}

// A minimal YAML subset (key: value, quoted scalars, | and > block scalars), never a full YAML
// parser — the frontmatter comes from untrusted archives. Keys this module does not read keep their
// raw lines so a save writes them back untouched.
// → { fields: {key: string|null}, extras: [{key, lines}], body, warnings }
function parseFrontmatter(text) {
  const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const warnings = [];
  if (!src.startsWith('---\n')) return { fields: {}, extras: [], body: src, warnings };
  const lines = src.split('\n');
  let close = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i] === '---' || lines[i] === '...') { close = i; break; }
  if (close === -1) {
    warnings.push('SKILL.md frontmatter is not closed with "---"; it was read as body text');
    return { fields: {}, extras: [], body: src, warnings };
  }
  const blocks = [];
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    const m = line.match(KEY_RE);
    if (m) { blocks.push({ key: m[1], first: m[2] ?? '', lines: [line] }); continue; }
    if (blocks.length && (line === '' || /^[ \t]/.test(line))) { blocks[blocks.length - 1].lines.push(line); continue; }
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    warnings.push(`Unreadable frontmatter line ignored: ${line.slice(0, 60)}`);
  }
  const fields = {};
  const extras = [];
  for (const b of blocks) {
    const cont = b.lines.slice(1);
    let value;
    const block = b.first.match(/^([|>])[+-]?$/);
    if (block) {
      const kept = cont.map(l => l.replace(/^[ \t]+/, ''));
      while (kept.length && kept[kept.length - 1] === '') kept.pop();
      value = block[1] === '|' ? kept.join('\n') : kept.join(' ');
    } else if (b.first) {
      value = unquote(b.first.trim());
      const more = cont.map(l => l.trim()).filter(Boolean);
      if (more.length) value = [value, ...more].join(' ');
    } else {
      value = null;
    }
    fields[b.key] = value;
    if (!['name', 'description', 'argument-hint'].includes(b.key)) {
      while (b.lines.length > 1 && b.lines[b.lines.length - 1] === '') b.lines.pop();
      extras.push({ key: b.key, lines: b.lines });
    }
  }
  const body = lines.slice(close + 1).join('\n').replace(/^\n+/, '');
  return { fields, extras, body, warnings };
}

const PLAIN_SCALAR_RE = /^[A-Za-z0-9(][^\n]*$/;
const YAML_LITERAL_RE = /^(true|false|null|yes|no|on|off|~|[-+]?[0-9][0-9._]*)$/i;
function yamlScalar(v) {
  if (PLAIN_SCALAR_RE.test(v) && !/: | #|:$|\s$/.test(v) && !YAML_LITERAL_RE.test(v)) return v;
  return JSON.stringify(v);
}

// The form (name / description / argument_hint) is the one source of truth; the frontmatter is
// generated from it on every save so the two cannot drift.
function buildSkillMd({ name, description, argumentHint, extras = [], body }) {
  const fm = [`name: ${name}`, `description: ${yamlScalar(description)}`];
  if (argumentHint) fm.push(`argument-hint: ${yamlScalar(argumentHint)}`);
  for (const e of extras) fm.push(...e.lines);
  const text = String(body ?? '').replace(/\r\n?/g, '\n').replace(/^\n+/, '');
  return `---\n${fm.join('\n')}\n---\n\n${text}`;
}

// ── Bundle assembly ───────────────────────────────────────────────────────────────────────────

// entries: [{ path, data: Buffer, mode }] in archive order, paths already checkPath()ed or ignored.
// Strips a single top-level folder when SKILL.md is not at the root (the claude.ai .skill layout).
// → { skillMd, files: [{path, data, mode}] (SKILL.md excluded), folderName, warnings }
function assembleBundle(rawEntries, { fallbackName = '' } = {}) {
  const warnings = [];
  let ignored = 0;
  let entries = [];
  for (const e of rawEntries) {
    if (isIgnoredPath(e.path)) { ignored++; continue; }
    entries.push(e);
  }
  if (ignored) warnings.push(`Ignored ${ignored} macOS metadata file${ignored > 1 ? 's' : ''} (__MACOSX, .DS_Store, ._*)`);

  let folderName = fallbackName;
  const atRoot = entries.some(e => e.path.toLowerCase() === 'skill.md');
  if (!atRoot) {
    const tops = new Set(entries.map(e => e.path.split('/')[0]));
    const top = tops.size === 1 ? [...tops][0] : null;
    if (top && entries.some(e => e.path.toLowerCase() === `${top.toLowerCase()}/skill.md`) && entries.every(e => e.path.startsWith(top + '/'))) {
      entries = entries.map(e => ({ ...e, path: e.path.slice(top.length + 1) }));
      folderName = top;
    } else {
      fail('missing_skill_md', 'No SKILL.md found at the root of the bundle or inside a single top-level folder');
    }
  }

  const seen = new Map();
  for (const e of entries) {
    const key = e.path.toLowerCase();
    if (seen.has(key)) fail('duplicate_path', `Duplicate file path (names are compared case-insensitively): ${e.path}`);
    seen.set(key, e.path);
  }
  for (const key of seen.keys()) {
    const segs = key.split('/');
    for (let i = 1; i < segs.length; i++) {
      if (seen.has(segs.slice(0, i).join('/'))) fail('duplicate_path', `"${seen.get(segs.slice(0, i).join('/'))}" is both a file and a folder`);
    }
  }

  const skillEntry = entries.find(e => e.path.toLowerCase() === 'skill.md');
  if (skillEntry.path !== SKILL_MD) warnings.push(`${skillEntry.path} renamed to SKILL.md`);
  const files = entries.filter(e => e !== skillEntry);
  checkLimits([{ path: SKILL_MD, size: skillEntry.data.length }, ...files.map(f => ({ path: f.path, size: f.data.length }))]);
  const skillMd = decodeSkillMd(skillEntry.data);
  const exec = files.filter(f => f.mode === 0o755).length;
  if (exec) warnings.push(`${exec} file${exec > 1 ? 's keep their' : ' keeps its'} executable bit`);
  return { skillMd, files, folderName, warnings };
}

function decodeSkillMd(buf) {
  if (buf.length > LIMITS.skillMdBytes) fail('too_large', `SKILL.md is larger than ${LIMITS.skillMdBytes / 1024} KB`);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { fail('unsupported_format', 'SKILL.md is not valid UTF-8 text'); }
}

// files: [{path, size}] including SKILL.md.
function checkLimits(files) {
  if (files.length > LIMITS.files) fail('too_many_files', `A skill can hold at most ${LIMITS.files} files (got ${files.length})`);
  let total = 0;
  for (const f of files) {
    if (f.size > LIMITS.fileBytes) fail('too_large', `${f.path} is larger than ${LIMITS.fileBytes / 1048576} MB`);
    total += f.size;
  }
  if (total > LIMITS.totalBytes) fail('too_large', `The skill is larger than ${LIMITS.totalBytes / 1048576} MB in total`);
}

// Counts real bytes as they arrive (never the sizes an archive header claims).
function byteBudget() {
  let total = 0;
  return {
    add(n, entryBytes, p) {
      total += n;
      if (entryBytes > LIMITS.fileBytes) fail('too_large', `${p} is larger than ${LIMITS.fileBytes / 1048576} MB`);
      if (total > LIMITS.totalBytes) fail('too_large', `The bundle unpacks to more than ${LIMITS.totalBytes / 1048576} MB`);
    },
  };
}

// ── Zip / .skill ──────────────────────────────────────────────────────────────────────────────

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;

function readZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: false, validateEntrySizes: true }, (err, zip) => {
      if (err) return reject(new SkillError('invalid_archive', `Not a readable zip file: ${err.message}`));
      if (zip.entryCount > LIMITS.zipEntries) { zip.close(); return reject(new SkillError('too_many_files', `The zip lists more than ${LIMITS.zipEntries} entries`)); }
      const out = [];
      const budget = byteBudget();
      let done = false;
      const stop = (e) => { if (done) return; done = true; try { zip.close(); } catch {} reject(e instanceof SkillError ? e : new SkillError('invalid_archive', `Corrupt zip file: ${e.message}`)); };
      zip.on('error', stop);
      zip.on('end', () => { if (!done) { done = true; resolve(out); } });
      zip.on('entry', (entry) => {
        try {
          const name = new TextDecoder('utf-8').decode(entry.fileName);
          const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
          const isDir = name.endsWith('/') || (unixMode & S_IFMT) === S_IFDIR;
          const p = checkPath(isDir ? name.replace(/\/+$/, '') : name);
          if ((unixMode & S_IFMT) === S_IFLNK) fail('symlink', `Symbolic links are not allowed: ${p}`);
          if (isDir) return zip.readEntry();
          if (entry.isEncrypted()) fail('encrypted_entry', `Encrypted zip entries are not supported: ${p}`);
          if (entry.uncompressedSize > LIMITS.fileBytes) fail('too_large', `${p} is larger than ${LIMITS.fileBytes / 1048576} MB`);
          if (entry.uncompressedSize >= LIMITS.ratioMinBytes && entry.uncompressedSize > LIMITS.ratio * Math.max(1, entry.compressedSize)) {
            fail('too_large', `${p} has a compression ratio above ${LIMITS.ratio}x (possible zip bomb)`);
          }
          zip.openReadStream(entry, (e2, stream) => {
            if (e2) return stop(e2);
            const chunks = [];
            let n = 0;
            stream.on('data', (c) => {
              n += c.length;
              try { budget.add(c.length, n, p); } catch (e) { stream.destroy(); return stop(e); }
              chunks.push(c);
            });
            stream.on('error', stop);
            stream.on('end', () => {
              if (done) return;
              out.push({ path: p, data: Buffer.concat(chunks), mode: (unixMode & 0o111) ? 0o755 : 0o644 });
              zip.readEntry();
            });
          });
        } catch (e) { stop(e); }
      });
      zip.readEntry();
    });
  });
}

// ── Tar / tar.gz ──────────────────────────────────────────────────────────────────────────────

const GZIP_MAGIC = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

function gunzipBounded(buffer) {
  try {
    // Header overhead on top of the content budget: 512 bytes per entry plus padding.
    return zlib.gunzipSync(buffer, { maxOutputLength: LIMITS.totalBytes + 8 * 1024 * 1024 });
  } catch (e) {
    if (e.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError) fail('too_large', `The archive unpacks to more than ${LIMITS.totalBytes / 1048576} MB`);
    fail('invalid_archive', `Not a readable gzip file: ${e.message}`);
  }
}

// mapPath(name) → the path inside the skill, or null to skip the entry (GitHub: outside the folder).
function readTar(buffer, { mapPath = (n) => n } = {}) {
  const tarBuf = GZIP_MAGIC(buffer) ? gunzipBounded(buffer) : buffer;
  return new Promise((resolve, reject) => {
    const extract = tarStream.extract();
    const out = [];
    const budget = byteBudget();
    let files = 0;
    let done = false;
    const stop = (e) => { if (done) return; done = true; extract.destroy(); reject(e instanceof SkillError ? e : new SkillError('invalid_archive', `Corrupt tar file: ${e.message}`)); };
    extract.on('entry', (header, stream, next) => {
      try {
        const raw = String(header.name || '').replace(/^\.\//, '').replace(/\/+$/, '');
        const mapped = raw ? mapPath(raw) : null;
        if (mapped === null) { stream.on('end', next); stream.resume(); return; }
        const p = checkPath(mapped);
        if (header.type === 'directory') { stream.on('end', next); stream.resume(); return; }
        if (header.type === 'symlink' || header.type === 'link') fail('symlink', `Links are not allowed: ${p}`);
        if (header.type !== 'file' && header.type !== 'contiguous-file') fail('unsupported_format', `Unsupported tar entry type "${header.type}": ${p}`);
        if (++files > LIMITS.files) fail('too_many_files', `A skill can hold at most ${LIMITS.files} files`);
        if (header.size > LIMITS.fileBytes) fail('too_large', `${p} is larger than ${LIMITS.fileBytes / 1048576} MB`);
        const chunks = [];
        let n = 0;
        stream.on('data', (c) => {
          n += c.length;
          try { budget.add(c.length, n, p); } catch (e) { return stop(e); }
          chunks.push(c);
        });
        stream.on('end', () => {
          if (done) return;
          out.push({ path: p, data: Buffer.concat(chunks), mode: (header.mode & 0o111) ? 0o755 : 0o644 });
          next();
        });
      } catch (e) { stop(e); }
    });
    extract.on('finish', () => { if (!done) { done = true; resolve(out); } });
    extract.on('error', stop);
    extract.end(tarBuf);
  });
}

// ── Multipart (folder / file upload) ──────────────────────────────────────────────────────────

// The whole body is already in memory (capped by the caller), so a buffer split is enough.
// → [{ name, filename, data }]
function parseMultipart(body, contentType, { maxParts = 2 * LIMITS.files + 10 } = {}) {
  const m = String(contentType || '').match(/boundary=(?:"([^"]{1,70})"|([^\s;]{1,70}))/i);
  if (!m) fail('unsupported_format', 'Missing multipart boundary');
  const delim = Buffer.from(`--${m[1] || m[2]}`);
  const parts = [];
  let pos = body.indexOf(delim);
  if (pos === -1) fail('unsupported_format', 'Malformed multipart body');
  while (true) {
    pos += delim.length;
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break;
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;
    const headEnd = body.indexOf('\r\n\r\n', pos);
    if (headEnd === -1) fail('unsupported_format', 'Malformed multipart body');
    const next = body.indexOf(Buffer.concat([Buffer.from('\r\n'), delim]), headEnd + 4);
    if (next === -1) fail('unsupported_format', 'Malformed multipart body');
    const head = body.slice(pos, headEnd).toString('utf8');
    const disp = head.match(/content-disposition:[^\r\n]*/i)?.[0] || '';
    const name = disp.match(/\bname="([^"]*)"/i)?.[1] ?? null;
    const filename = disp.match(/\bfilename="([^"]*)"/i)?.[1] ?? null;
    if (parts.length >= maxParts) fail('too_many_files', `Too many parts in the upload (max ${maxParts})`);
    parts.push({ name, filename, data: body.slice(headEnd + 4, next) });
    pos = next + 2;
  }
  return parts;
}

// ── GitHub ────────────────────────────────────────────────────────────────────────────────────

const GH_NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const GH_REF_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const GH_HOPS = new Set(['codeload.github.com', 'github.com']);

// https://github.com/<owner>/<repo>[/tree/<ref>[/<path>]] or .../blob/<ref>/<path>/SKILL.md.
// A ref containing "/" is not supported (it cannot be told apart from the path). → { owner, repo, ref, subpath }
function parseGithubUrl(raw) {
  const bad = (why) => fail('invalid_url', `Unsupported URL: ${why}. Use https://github.com/<owner>/<repo>[/tree/<ref>/<path>]`);
  // The URL parser resolves "." / ".." segments (also %2e-encoded), so "skills/../other" would quietly
  // become "other"; reject them on the raw string, before anything is parsed or fetched.
  const rawPath = String(raw).split(/[?#]/)[0];
  if (rawPath.split(/\/|%2f|%5c|\\/i).some(s => /^(?:\.|%2e){1,2}$/i.test(s))) bad('"." or ".." segment');
  let u;
  try { u = new URL(String(raw)); } catch { bad('not a URL'); }
  if (u.protocol !== 'https:') bad('only https is allowed');
  if (u.hostname !== 'github.com' || u.port || u.username || u.password) bad('only github.com is allowed');
  const segs = u.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return '\u0000'; } });
  if (segs.length < 2) bad('missing owner or repository');
  const owner = segs[0];
  const repo = segs[1].replace(/\.git$/, '');
  if (!GH_NAME_RE.test(owner) || !GH_NAME_RE.test(repo) || /^\.+$/.test(owner) || /^\.+$/.test(repo)) bad('invalid owner or repository name');
  let ref = 'HEAD';
  let rest = [];
  if (segs.length > 2) {
    if (segs[2] !== 'tree' && segs[2] !== 'blob') bad('expected /tree/<ref> or /blob/<ref>');
    if (!segs[3]) bad('missing ref');
    ref = segs[3];
    if (!GH_REF_RE.test(ref) || ref.includes('..')) bad('invalid ref');
    rest = segs.slice(4);
    if (segs[2] === 'blob') {
      if (!rest.length || rest[rest.length - 1].toLowerCase() !== 'skill.md') bad('a /blob/ URL must point at a SKILL.md');
      rest = rest.slice(0, -1);
    }
  }
  let subpath = '';
  if (rest.length) {
    try { subpath = checkPath(rest.join('/')); } catch (e) { bad(`invalid folder path (${e.message})`); }
  }
  return { owner, repo, ref, subpath };
}

// Follows at most LIMITS.redirects redirects by hand, each hop on the whitelist; streams the body
// against the size cap; one deadline for the whole download.
async function downloadGithubTarball({ owner, repo, ref }, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.downloadTimeoutMs);
  try {
    let url = `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/${encodeURIComponent(ref)}`;
    for (let hop = 0; ; hop++) {
      let res;
      try { res = await fetchImpl(url, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'stoa-skills' } }); }
      catch (e) { fail('fetch_failed', controller.signal.aborted ? 'GitHub download timed out' : `GitHub download failed: ${e.message}`, 502); }
      if (res.status >= 300 && res.status < 400) {
        if (hop >= LIMITS.redirects) fail('fetch_failed', 'Too many redirects from GitHub', 502);
        let next;
        try { next = new URL(res.headers.get('location') || '', url); } catch { fail('fetch_failed', 'GitHub sent an invalid redirect', 502); }
        if (next.protocol !== 'https:' || !GH_HOPS.has(next.hostname) || next.port || next.username || next.password) {
          fail('fetch_failed', `GitHub redirected to a host that is not allowed: ${next.hostname}`, 502);
        }
        url = next.href;
        continue;
      }
      if (res.status === 404) fail('fetch_failed', 'Repository, ref or folder not found (only public repositories are supported)', 404);
      if (!res.ok) fail('fetch_failed', `GitHub answered HTTP ${res.status}`, 502);
      const declared = parseInt(res.headers.get('content-length') || '', 10);
      if (Number.isFinite(declared) && declared > LIMITS.downloadBytes) fail('too_large', `The repository archive is larger than ${LIMITS.downloadBytes / 1048576} MB`);
      const chunks = [];
      let n = 0;
      try {
        for await (const c of res.body) {
          n += c.length;
          if (n > LIMITS.downloadBytes) { controller.abort(); fail('too_large', `The repository archive is larger than ${LIMITS.downloadBytes / 1048576} MB`); }
          chunks.push(Buffer.from(c));
        }
      } catch (e) {
        if (e instanceof SkillError) throw e;
        fail('fetch_failed', controller.signal.aborted ? 'GitHub download timed out' : `GitHub download failed: ${e.message}`, 502);
      }
      return Buffer.concat(chunks);
    }
  } finally {
    clearTimeout(timer);
  }
}

// → assembleBundle() result + sourceUrl
async function readGithub(rawUrl, fetchImpl) {
  const gh = parseGithubUrl(rawUrl);
  const tarball = await downloadGithubTarball(gh, fetchImpl);
  const prefix = gh.subpath ? gh.subpath + '/' : '';
  // codeload tarballs wrap everything in one "<repo>-<sha>/" folder.
  const entries = await readTar(tarball, {
    mapPath: (name) => {
      const slash = name.indexOf('/');
      if (slash === -1) return null;
      const inner = name.slice(slash + 1);
      if (!inner || !inner.startsWith(prefix)) return null;
      return inner.slice(prefix.length) || null;
    },
  });
  if (!entries.length) fail('missing_skill_md', gh.subpath ? `Folder "${gh.subpath}" not found in the repository` : 'The repository is empty');
  const fallbackName = gh.subpath ? gh.subpath.split('/').pop() : gh.repo;
  const bundle = assembleBundle(entries, { fallbackName });
  return { ...bundle, folderName: fallbackName, sourceUrl: String(rawUrl) };
}

// ── Single files ──────────────────────────────────────────────────────────────────────────────

// An upload's kind by its file name (then by magic bytes for an unnamed blob).
function detectKind(filename, data) {
  const n = String(filename || '').toLowerCase();
  if (n.endsWith('.md')) return 'md';
  if (n.endsWith('.zip') || n.endsWith('.skill')) return 'zip';
  if (n.endsWith('.tar.gz') || n.endsWith('.tgz') || n.endsWith('.tar')) return 'tar';
  if (data && data[0] === 0x50 && data[1] === 0x4b) return 'zip';
  if (data && GZIP_MAGIC(data)) return 'tar';
  return null;
}

function baseName(filename) {
  return path.posix.basename(String(filename || '').replace(/\\/g, '/')).replace(/\.(tar\.gz|tgz|tar|zip|skill|md)$/i, '');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Identity of a revision's content for the agent cache: changes iff a path, its bytes or its mode do.
function manifestHash(files) {
  const h = crypto.createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) h.update(`${f.path}\n${f.sha256}\n${f.size}\n${f.mode}\n`);
  return h.digest('hex');
}

module.exports = {
  LIMITS, NAME_RE, RESERVED_NAMES, DESCRIPTION_MAX, ARGUMENT_HINT_MAX, SKILL_MD, SkillError,
  checkName, slugify, oneLine, checkPath, isIgnoredPath, parseFrontmatter, buildSkillMd, assembleBundle, checkLimits,
  decodeSkillMd, readZip, readTar, parseMultipart, parseGithubUrl, downloadGithubTarball, readGithub, detectKind, baseName,
  sha256, manifestHash,
};
