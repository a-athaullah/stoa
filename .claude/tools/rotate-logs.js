#!/usr/bin/env node
// Rotate the launchd server logs (logs/stoa.log, logs/stoa.err) without restarting the server.
//
// Copy-truncate, never rename: launchd holds the log open (O_APPEND) for the whole life of the
// server process. Replacing the file (`tail > tmp && mv tmp log`, the old cron job) leaves that
// fd writing into the unlinked inode — every line after the first rotation was lost. Truncating
// in place keeps the inode, and O_APPEND makes the next write land at offset 0.
//
// Usage: node .claude/tools/rotate-logs.js [--max-mb=10] [--dir=<logs dir>] [--dry-run]
// Cron:  0 * * * * /opt/homebrew/bin/node $HOME/project/Stoa/.claude/tools/rotate-logs.js
// Output: {dir, maxBytes, dryRun, files: [{file, size, rotated}]}
'use strict';
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const dir = path.resolve(args.dir || path.join(__dirname, '..', '..', 'logs'));
const maxMb = Number(args['max-mb'] ?? 10);
if (!Number.isFinite(maxMb) || maxMb <= 0) {
  console.error(JSON.stringify({ error: '--max-mb must be a positive number' }));
  process.exit(1);
}
const maxBytes = Math.round(maxMb * 1024 * 1024);
const dryRun = !!args['dry-run'];

const files = [];
for (const name of ['stoa.log', 'stoa.err']) {
  const file = path.join(dir, name);
  let size;
  try { size = fs.statSync(file).size; } catch { continue; }
  const rotated = size > maxBytes;
  if (rotated && !dryRun) {
    // One generation kept: <name>.1 is overwritten. Lines written between copy and truncate
    // (milliseconds) are lost — acceptable for a debug log.
    fs.copyFileSync(file, `${file}.1`);
    fs.truncateSync(file, 0);
  }
  files.push({ file, size, rotated });
}
console.log(JSON.stringify({ dir, maxBytes, dryRun, files }, null, 2));
