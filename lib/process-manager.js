'use strict';
// Which process manager will start the SERVER again after it exits? Same rule as lib/supervisor.js for
// agents: env is inherited by anything started from a managed shell, so every answer also needs the
// parent to be the manager itself. A server orphaned onto PID 1 (`(node server.js &)`, nohup + logout)
// has launchd or systemd as its parent without being a job of either — the job env (XPC_SERVICE_NAME =
// the job label; INVOCATION_ID, systemd >= 232) tells them apart. 'unknown' disables restart/update
// instead of exiting a server nothing would start again.
const fs = require('fs');
const { execFileSync } = require('child_process');
const { detectSupervisor } = require('./supervisor');

// { comm, args } of a process, or null (no `ps`, e.g. Windows, or the process is gone).
function processInfo(pid) {
  try {
    const ps = (field) => execFileSync('ps', ['-p', String(pid), '-o', `${field}=`], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { comm: ps('comm'), args: ps('args') };
  } catch {
    return null;
  }
}

function detectProcessManager({ env = process.env, ppid = process.ppid, exists = fs.existsSync, parent = processInfo, readFile, homedir } = {}) {
  if (exists('/.dockerenv')) return 'docker';
  if (detectSupervisor({ env, ppid, readFile, homedir }) === 'pm2') return 'pm2';
  const p = parent(ppid);
  if (!p) return 'unknown';
  if (env.SUPERVISOR_ENABLED && /supervisord/.test(p.args)) return 'supervisord';
  const xpc = env.XPC_SERVICE_NAME || '';
  if (/launchd/.test(p.comm) && xpc && xpc !== '0' && !xpc.startsWith('application.')) return 'launchd';
  if (/systemd/.test(p.comm) && env.INVOCATION_ID) return 'systemd';
  return 'unknown';
}

module.exports = { detectProcessManager };
