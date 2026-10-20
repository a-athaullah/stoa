'use strict';
// Which process manager will bring this agent back after process.exit(0)? A manual restart is
// only safe when the answer is "pm2". PM2 injects pm_id into the child env, but env is inherited
// — `node stoa.js` started from a shell inside a PM2-managed process (e.g. an agent's own Bash
// tool) also sees pm_id. So also require that our parent is the PM2 daemon (pid in PM2_HOME/pm2.pid).
const fs = require('fs');
const os = require('os');
const path = require('path');

function detectSupervisor({ env = process.env, ppid = process.ppid, readFile = fs.readFileSync, homedir = os.homedir() } = {}) {
  if (env.pm_id === undefined || env.autorestart === 'false') return null;
  try {
    const pidFile = path.join(env.PM2_HOME || path.join(homedir, '.pm2'), 'pm2.pid');
    const daemonPid = parseInt(String(readFile(pidFile, 'utf8')).trim(), 10);
    return Number.isInteger(daemonPid) && daemonPid === ppid ? 'pm2' : null;
  } catch {
    return null;
  }
}

module.exports = { detectSupervisor };
