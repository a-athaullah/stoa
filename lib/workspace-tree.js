'use strict';
// Workspace panel data for a workdir on the server's own disk: the file tree and git state.
// Everything here is async. The sync versions (readdirSync walk + execSync git) blocked the event
// loop for 70-330 ms on large workdirs, and the client asks for the tree on every room switch and
// every finished run, so all rooms' streams stalled while one tree was built.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const IGNORE = new Set(['.git', 'node_modules', '.next', '__pycache__', '.venv', 'dist', 'build']);
const MAX_DEPTH = 3;
// readdir runs on libuv's thread pool (4 threads by default), shared with zlib (gzip, WS deflate)
// and dns. A fan-out walk would queue thousands of scandirs ahead of them; 2 in flight leaves room.
const WALK_CONCURRENCY = 2;
const GIT_TIMEOUT_MS = 10000;

function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

// Same shape and order as the client expects: folders first (name order), then files; a folder at
// depth < 1 starts open. Folders deeper than maxDepth come back with no children. An unreadable
// directory is an empty folder, as before.
async function buildFileTree(rootPath, maxDepth = MAX_DEPTH) {
  const run = limiter(WALK_CONCURRENCY);
  const walk = async (dirPath, depth) => {
    if (depth > maxDepth) return [];
    let entries;
    try { entries = await run(() => fs.promises.readdir(dirPath, { withFileTypes: true })); } catch { return []; }
    const dirs = entries.filter(e => e.isDirectory() && !IGNORE.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
    const children = await Promise.all(dirs.map(d => walk(path.join(dirPath, d.name), depth + 1)));
    const result = dirs.map((d, i) => ({ t: 'folder', name: d.name, depth, open: depth < 1, children: children[i] }));
    for (const f of files) result.push({ t: path.extname(f.name).slice(1) || 'file', name: f.name, depth });
    return result;
  };
  return walk(rootPath, 0);
}

// git without a shell: the arguments are fixed and cwd is the workdir.
function git(cwd, args, maxBuffer) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer, windowsHide: true, timeout: GIT_TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

// Paths git reports as changed. Not a repository, git missing, or a timeout → [] (the tree still shows).
async function gitModified(cwd) {
  try {
    const out = await git(cwd, ['status', '--porcelain'], 512 * 1024);
    return out.split('\n').filter(Boolean).map(l => l.slice(3).trim());
  } catch { return []; }
}

const gitDiff = (cwd) => git(cwd, ['diff'], 1024 * 1024);

// One tree build per (path, depth) at a time: a room switch and a finished run, or several open
// tabs, ask for the same tree together and share the walk instead of repeating it.
function createFileListService() {
  const inflight = new Map();
  return function fileList(rootPath, maxDepth = MAX_DEPTH) {
    const key = `${maxDepth}\0${rootPath}`;
    if (inflight.has(key)) return inflight.get(key);
    const p = Promise.all([buildFileTree(rootPath, maxDepth), gitModified(rootPath)])
      .then(([tree, modified]) => ({ tree, modified }))
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}

// file_list `max_depth`: an integer 0-3; anything else → 3 (the full panel tree).
function parseMaxDepth(v) {
  return Number.isInteger(v) && v >= 0 && v <= MAX_DEPTH ? v : MAX_DEPTH;
}

module.exports = { buildFileTree, gitModified, gitDiff, createFileListService, parseMaxDepth };
