'use strict';
// Skills from a git repository: validating what the owner types (url / ref / folder), `git ls-remote`
// for "is there an update", and a shallow clone read into the same [{ path, data, mode }] entries an
// archive import produces (then B.assembleBundle, so every bundle limit applies unchanged).
//
// git runs with the server's own credentials (SSH keys, credential helpers), so only the owner's
// session reaches this module (lib/skills.js refuses an agent caller). Hardening: spawn without a
// shell, "--" before the url, only https / ssh transports (file only under STOA_TEST=1, for the
// tests' local bare repos), no prompts, no hooks, no submodules, no LFS smudge, a hard timeout, and
// the temporary clone is always removed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const B = require('./skill-bundle');

const TIMEOUT_MS = 60_000;
const OUTPUT_MAX = 1024 * 1024;
const URL_MAX = 500;
const REF_MAX = 200;
const SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
// A branch or tag name, stricter than git check-ref-format: no leading "-" (option injection) or "/",
// no "..", "//", "@{", trailing "/" / "." / ".lock".
const REF_RE = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
const USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const SCP_RE = /^([A-Za-z0-9_][A-Za-z0-9._-]*)@([^:/\s]+):([^\s]+)$/;

const testMode = () => process.env.STOA_TEST === '1';
const bad = (why) => new B.SkillError('invalid_url', `Unsupported git URL: ${why}`);

// → the url to store and hand to git, or throws invalid_url. Forms: https://host[:port]/path,
// ssh://[user@]host[:port]/path, user@host:path (scp style); file:///abs only in test mode.
function checkGitUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw bad('url is required');
  const url = raw.trim();
  if (url.length > URL_MAX) throw bad(`longer than ${URL_MAX} characters`);
  if (/[\u0000- \u007f\\]/.test(url)) throw bad('spaces, control characters and backslashes are not allowed');
  if (url.startsWith('-')) throw bad('must not start with "-"');
  const scp = !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url) && url.match(SCP_RE);
  if (scp) {
    if (!HOST_RE.test(scp[2])) throw bad('invalid host');
    if (scp[3].startsWith('-') || scp[3].startsWith('/')) throw bad('invalid repository path');
    return url;
  }
  let u;
  try { u = new URL(url); } catch { throw bad('use https://…, ssh://… or user@host:path'); }
  if (u.protocol === 'file:' && testMode()) return url;
  if (u.protocol !== 'https:' && u.protocol !== 'ssh:') throw bad('only https:// and ssh:// (or user@host:path) are allowed');
  if (u.password || (u.protocol === 'https:' && u.username)) throw bad('credentials in the URL are not allowed; use an SSH key or a git credential helper on the server');
  if (!HOST_RE.test(u.hostname)) throw bad('invalid host');
  if (u.username && !USER_RE.test(u.username)) throw bad('invalid user name');
  if (u.search || u.hash) throw bad('query strings and fragments are not allowed');
  if (u.pathname === '/' || !u.pathname) throw bad('missing repository path');
  return url;
}

// → ref or null (the remote's default branch). Throws invalid_ref.
function checkRef(ref) {
  if (ref == null || ref === '') return null;
  const no = (why) => new B.SkillError('invalid_ref', `Invalid branch or tag: ${why}`);
  if (typeof ref !== 'string') throw no('must be a string');
  const r = ref.trim();
  if (!r) return null;
  if (r.length > REF_MAX) throw no(`longer than ${REF_MAX} characters`);
  if (!REF_RE.test(r) || r.includes('..') || r.includes('//') || r.endsWith('/') || r.endsWith('.') || r.endsWith('.lock') || r.split('/').some(s => s.startsWith('.'))) {
    throw no('use letters, digits and . _ - / (no leading "-", no "..")');
  }
  return r;
}

// → normalized folder inside the repository, or null for the root. Throws invalid_path.
function checkSubdir(p) {
  if (p == null) return null;
  if (typeof p !== 'string') throw new B.SkillError('invalid_path', 'path must be a string');
  const s = p.trim().replace(/\/+$/, '');
  return s ? B.checkPath(s) : null;
}

// "https://host/team/pdf-skill.git" → "pdf-skill", for a SKILL.md without a name.
function repoName(url) {
  const tail = url.replace(/\/+$/, '').split(/[/:]/).pop() || '';
  return tail.replace(/\.git$/, '');
}

function gitEnv() {
  const env = {};
  // The server's own GIT_DIR / GIT_WORK_TREE / GIT_CONFIG_* must not leak into the clone.
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15',
    GIT_LFS_SKIP_SMUDGE: '1',
  };
}

function gitConfig() {
  return [
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always',
    ...(testMode() ? ['-c', 'protocol.file.allow=always'] : []),
    '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false',
  ];
}

// stderr → a SkillError the owner can act on. The url never holds credentials (checkGitUrl), but
// any "scheme://user:pass@" git might echo is masked anyway.
function gitError(stderr) {
  const text = String(stderr).replace(/(\w+:\/\/)[^/@\s]+@/g, '$1***@');
  const last = text.split('\n').map(l => l.replace(/^(fatal|error|remote): */i, '').trim()).filter(Boolean).pop() || 'git failed';
  const tail = last.slice(0, 200);
  if (/Host key verification failed/i.test(text)) return new B.SkillError('git_auth_failed', 'The server does not know this host\'s SSH key yet: connect once from the server (ssh) to accept it', 502);
  if (/Permission denied|Authentication failed|could not read (Username|Password)|terminal prompts disabled|access denied|HTTP Basic: Access denied|returned error: 40[13]/i.test(text)) {
    return new B.SkillError('git_auth_failed', 'Access denied by the git host: add the server\'s SSH key to your account, or check the repository permissions', 502);
  }
  if (/Remote branch .* not found|couldn't find remote ref|not our ref/i.test(text)) return new B.SkillError('git_ref_not_found', 'Branch or tag not found in the repository', 404);
  if (/Repository not found|does not appear to be a git repository|not found|returned error: 404/i.test(text)) return new B.SkillError('git_repo_not_found', 'Repository not found (or no access to it)', 404);
  if (/Could not resolve host|Connection (refused|timed out)|Operation timed out|Network is unreachable/i.test(text)) return new B.SkillError('git_unreachable', `Cannot reach the git host: ${tail}`, 502);
  return new B.SkillError('git_failed', `git failed: ${tail}`, 502);
}

// → stdout (string). Rejects with a SkillError.
function runGit(args, { cwd, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn('git', [...gitConfig(), ...args], { cwd, env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return reject(new B.SkillError('git_unavailable', `Cannot run git on the server: ${e.message}`, 500)); }
    const out = [];
    const err = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let settled = false;
    const done = (fn) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (c) => { outBytes += c.length; if (outBytes <= OUTPUT_MAX) out.push(c); else child.kill('SIGKILL'); });
    child.stderr.on('data', (c) => { errBytes += c.length; if (errBytes <= 64 * 1024) err.push(c); });
    child.on('error', (e) => done(() => reject(e.code === 'ENOENT'
      ? new B.SkillError('git_unavailable', 'git is not installed on the Stoa server', 500)
      : new B.SkillError('git_failed', `git failed: ${e.message}`, 502))));
    child.on('close', (code) => done(() => {
      if (timedOut) return reject(new B.SkillError('git_timeout', `git did not finish within ${Math.round(timeoutMs / 1000)} seconds`, 504));
      if (outBytes > OUTPUT_MAX) return reject(new B.SkillError('git_failed', 'git produced too much output', 502));
      if (code !== 0) return reject(gitError(Buffer.concat(err).toString('utf8')));
      resolve(Buffer.concat(out).toString('utf8'));
    }));
  });
}

// → the commit sha `ref` (null = the default branch) points at on the remote. A branch wins over a
// tag of the same name, the same as `git clone --branch`; an annotated tag resolves to its commit.
async function remoteCommit(url, ref, opts = {}) {
  const patterns = ref ? [`refs/heads/${ref}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`] : ['HEAD'];
  const stdout = await runGit(['ls-remote', '--', url, ...patterns], opts);
  const refs = new Map();
  for (const line of stdout.split('\n')) {
    const [sha, name] = line.split('\t');
    if (name && SHA_RE.test(sha)) refs.set(name, sha);
  }
  const sha = ref
    ? refs.get(`refs/heads/${ref}`) || refs.get(`refs/tags/${ref}^{}`) || refs.get(`refs/tags/${ref}`)
    : refs.get('HEAD');
  if (!sha) throw new B.SkillError(ref ? 'git_ref_not_found' : 'git_repo_not_found', ref ? 'Branch or tag not found in the repository' : 'The repository is empty', 404);
  return sha;
}

// Reads `dir` (a checked-out folder) into bundle entries. Real bytes counted against the bundle
// limits as it goes; symlinks refused (a checkout writes them as real links); ".git" skipped.
function readTree(dir) {
  const out = [];
  let total = 0;
  let files = 0;
  const walk = (abs, rel) => {
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      if (d.name === '.git') continue;
      const relPath = rel ? `${rel}/${d.name}` : d.name;
      const p = B.checkPath(relPath);
      const full = path.join(abs, d.name);
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) throw new B.SkillError('symlink', `Symbolic links are not allowed: ${p}`);
      if (st.isDirectory()) { walk(full, p); continue; }
      if (!st.isFile()) continue;
      if (B.isIgnoredPath(p)) { out.push({ path: p, data: Buffer.alloc(0), mode: 0o644 }); continue; }
      if (++files > B.LIMITS.files) throw new B.SkillError('too_many_files', `A skill can hold at most ${B.LIMITS.files} files`);
      if (st.size > B.LIMITS.fileBytes) throw new B.SkillError('too_large', `${p} is larger than ${B.LIMITS.fileBytes / 1048576} MB`);
      total += st.size;
      if (total > B.LIMITS.totalBytes) throw new B.SkillError('too_large', `The skill is larger than ${B.LIMITS.totalBytes / 1048576} MB in total`);
      out.push({ path: p, data: fs.readFileSync(full), mode: (st.mode & 0o111) ? 0o755 : 0o644 });
    }
  };
  walk(dir, '');
  return out;
}

// Shallow clone of `ref` (null = default branch), then the folder `subdir` read as a bundle.
// → { commit, bundle } where bundle is B.assembleBundle()'s result.
async function fetchSkill({ url, ref, subdir }, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stoa-skill-git-'));
  try {
    const repo = path.join(tmp, 'repo');
    await runGit(['clone', '--depth', '1', '--single-branch', '--no-tags', '--no-recurse-submodules',
      ...(ref ? ['--branch', ref] : []), '--', url, repo], opts);
    const commit = (await runGit(['rev-parse', 'HEAD'], { ...opts, cwd: repo })).trim();
    if (!SHA_RE.test(commit)) throw new B.SkillError('git_failed', 'git returned an unexpected commit id', 502);
    let root = repo;
    if (subdir) {
      // Each segment is checked, so a symlinked folder cannot point the read outside the clone.
      for (const seg of subdir.split('/')) {
        root = path.join(root, seg);
        let st;
        try { st = fs.lstatSync(root); } catch { st = null; }
        if (!st || !st.isDirectory()) throw new B.SkillError('missing_skill_md', `Folder "${subdir}" not found in the repository`);
      }
    }
    const entries = readTree(root);
    if (!entries.length) throw new B.SkillError('missing_skill_md', subdir ? `Folder "${subdir}" is empty` : 'The repository is empty');
    const fallbackName = subdir ? subdir.split('/').pop() : repoName(url);
    let bundle;
    try { bundle = B.assembleBundle(entries, { fallbackName }); }
    catch (e) {
      if (e instanceof B.SkillError && e.code === 'missing_skill_md') {
        throw new B.SkillError('missing_skill_md', `No SKILL.md found in ${subdir ? `"${subdir}"` : 'the repository root'} (or inside a single folder there)`);
      }
      throw e;
    }
    return { commit, bundle: { ...bundle, folderName: fallbackName } };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { checkGitUrl, checkRef, checkSubdir, repoName, remoteCommit, fetchSkill, runGit, TIMEOUT_MS };
