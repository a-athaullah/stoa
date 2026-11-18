'use strict';
// Connector side of knowledge extraction (server: lib/knowledge-extraction.js). A
// knowledge_extract job runs in its own one-off claude process, never in a room session: no
// tools (--tools ""), no MCP server at all (--strict-mcp-config without --mcp-config), no slash
// commands or skills, no saved session, in an empty directory of its own (so no project CLAUDE.md
// or workdir files). The transcript is untrusted input; a summary must not be able to act.
// It is not in sessionPool or the work journal, and the process is killed when the answer is in
// or the timeout hits. Answer: knowledge_extract_result { job_id, ok, text | error | busy }.
const fs = require('fs');
const path = require('path');
const os = require('os');

const MODEL_RE = /^[A-Za-z0-9._:[\]-]{1,100}$/;
const MAX_PROMPT = 256 * 1024;
const MAX_OUTPUT = 256 * 1024;
const MIN_TIMEOUT_MS = 30 * 1000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function knowledgeArgs(model) {
  const args = [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--tools', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
  ];
  if (typeof model === 'string' && MODEL_RE.test(model)) args.push('--model', model);
  return args;
}

// The child gets no Stoa credentials: it has no tool to use them, and it does not need them.
function childEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!/^STOA_/.test(k)) out[k] = v;
  return out;
}

// spawn: child_process.spawn (injected in tests). busy(): the connector is at its run limit.
function createKnowledgeRunner({ spawn, send, busy = () => false, workDir = path.join(os.homedir(), '.stoa', 'knowledge-work'), env = process.env, log = console, minTimeoutMs = MIN_TIMEOUT_MS }) {
  let running = null;

  function reply(jobId, body) {
    send({ type: 'knowledge_extract_result', job_id: jobId, ...body });
  }

  function handle(msg) {
    const jobId = msg?.job_id;
    if (!Number.isSafeInteger(jobId)) return;
    if (typeof msg.prompt !== 'string' || !msg.prompt || msg.prompt.length > MAX_PROMPT) {
      return reply(jobId, { ok: false, error: 'invalid prompt' });
    }
    if (running || busy()) return reply(jobId, { ok: false, busy: true });
    const timeoutMs = Number.isSafeInteger(msg.timeout_ms) ? Math.min(MAX_TIMEOUT_MS, Math.max(minTimeoutMs, msg.timeout_ms)) : DEFAULT_TIMEOUT_MS;
    try {
      fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
    } catch (e) {
      return reply(jobId, { ok: false, error: `workdir: ${e.code || e.message}` });
    }
    let proc;
    try {
      proc = spawn('claude', knowledgeArgs(msg.model), { cwd: workDir, env: childEnv(env), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) {
      return reply(jobId, { ok: false, error: `spawn: ${e.code || e.message}` });
    }
    let done = false;
    let buf = '';
    let size = 0;
    const finish = (body) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      running = null;
      try { proc.kill('SIGKILL'); } catch {}
      reply(jobId, body);
      log.log(`[knowledge] job ${jobId} ${body.ok ? 'answered' : 'failed'}`);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `timeout after ${Math.round(timeoutMs / 1000)}s` }), timeoutMs);
    timer.unref?.();
    running = { jobId, proc };
    proc.on('error', e => finish({ ok: false, error: `claude: ${e.code || e.message}` }));
    proc.stdin.on('error', () => {});
    proc.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_OUTPUT) return finish({ ok: false, error: 'output too large' });
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        if (!l.trim()) continue;
        let ev;
        try { ev = JSON.parse(l); } catch { continue; }
        if (ev?.type !== 'result') continue;
        if (ev.is_error || typeof ev.result !== 'string') finish({ ok: false, error: `claude result error${ev.subtype ? ` (${String(ev.subtype).slice(0, 40)})` : ''}` });
        else finish({ ok: true, text: ev.result });
        return;
      }
    });
    proc.on('close', code => finish({ ok: false, error: `claude exited (code ${code}) without a result` }));
    const message = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: msg.prompt }] } });
    proc.stdin.write(message + '\n');
    proc.stdin.end();
  }

  return { handle, get running() { return running ? running.jobId : null; } };
}

module.exports = { createKnowledgeRunner, knowledgeArgs, childEnv };
