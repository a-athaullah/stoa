// codex-session.js — Codex CLI exec adapter for Stoa
// Spawns `codex exec` per turn (one-shot), reads JSONL events from stdout.
// Resume via `codex exec resume <thread_id>`.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const SANDBOX_MODE = 'danger-full-access';

function escapeTomlValue(str) {
  return JSON.stringify(String(str));
}

// Stoa MCP gateway. Codex reads the bearer token from the env var named here, so it stays out of
// argv. approve: Stoa runs codex with approval policy "never", and without this every MCP tool call
// is refused as "requires approval"; access control happens in the gateway.
function mcpConfigArgs(env) {
  if (!env?.STOA_MCP_TOKEN || !env?.STOA_MCP_URL) return [];
  return [
    '-c', `mcp_servers.stoa.url=${escapeTomlValue(env.STOA_MCP_URL)}`,
    '-c', 'mcp_servers.stoa.bearer_token_env_var="STOA_MCP_TOKEN"',
    '-c', 'mcp_servers.stoa.default_tools_approval_mode="approve"',
    // Codex's default (60 s) would cut a call the gateway holds for owner approval.
    ...(/^\d+$/.test(env.MCP_TOOL_TIMEOUT || '') ? ['-c', `mcp_servers.stoa.tool_timeout_sec=${Math.ceil(Number(env.MCP_TOOL_TIMEOUT) / 1000)}`] : []),
  ];
}

// Same name shape as Claude Code (mcp__<server>__<tool>), so the chat labels gateway tools for both.
function mcpToolStep(item) {
  const args = item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments) ? item.arguments : {};
  if (typeof item.server !== 'string' || !item.server || typeof item.tool !== 'string' || !item.tool) {
    return { name: 'mcp_tool_call', input: args };
  }
  return { name: `mcp__${item.server}__${item.tool}`, input: args };
}

class CodexSession extends EventEmitter {
  constructor({ workDir = process.cwd(), flags = [], resumeId = null, env = null, systemPrompt = null, model = null } = {}) {
    super();
    this.workDir = workDir;
    this.flags = flags || [];
    this.resumeId = resumeId;
    this.env = env;
    this.systemPrompt = systemPrompt;
    this.model = model;
    this.proc = null;
    this.busy = false;
    this._queue = [];
    this._currentResolve = null;
    this._currentReject = null;
    this._currentOnToken = null;
    this._currentOnState = null;
    this._currentOnTool = null;
    this._currentTaskId = null;
    this._accContent = '';
    this._usage = null;
    this._threadId = resumeId || null;
  }

  _buildArgs(isResume) {
    const args = ['exec'];
    if (isResume && this._threadId) {
      args.push('resume', '--json', '--skip-git-repo-check', '--ignore-user-config');
      args.push('-c', `sandbox_mode="${SANDBOX_MODE}"`, ...mcpConfigArgs(this.env));
      if (this.model) args.push('-m', this.model);
      if (this.systemPrompt) args.push('-c', `developer_instructions=${escapeTomlValue(this.systemPrompt)}`);
      args.push(this._threadId, '-');
    } else {
      args.push('--json', '--skip-git-repo-check', '--ignore-user-config');
      args.push('-c', `sandbox_mode="${SANDBOX_MODE}"`, ...mcpConfigArgs(this.env));
      if (this.model) args.push('-m', this.model);
      if (this.systemPrompt) args.push('-c', `developer_instructions=${escapeTomlValue(this.systemPrompt)}`);
      args.push('-');
    }
    return args;
  }

  _startTask({ prompt, imageData, onToken, onState, onTool, resolve, reject, taskId }) {
    this.busy = true;
    this._currentResolve = resolve;
    this._currentReject = reject;
    this._currentOnToken = onToken || null;
    this._currentOnState = onState || null;
    this._currentOnTool = onTool || null;
    this._currentTaskId = taskId || null;
    this._accContent = '';
    this._usage = null;

    const isResume = !!this._threadId;
    const args = this._buildArgs(isResume);
    const spawnOpts = { cwd: this.workDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
    if (this.env) spawnOpts.env = { ...process.env, ...this.env };

    this.proc = spawn('codex', args, spawnOpts);
    const myProc = this.proc;
    this.proc.stdin.on('error', () => {});

    let buffer = '';
    let stderrBuf = '';

    this.proc.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try { this._handleEvent(JSON.parse(line)); } catch {}
      }
    });

    this.proc.stderr.on('data', d => {
      process.stderr.write(d);
      stderrBuf += d.toString();
    });

    this.proc.on('close', (code, signal) => {
      if (myProc !== this.proc) return;
      if (this._currentResolve) {
        // Snapshot before _clearCurrent(): it nulls _usage and may start the next queued task.
        const content = this._accContent || '';
        const usage = this._usage;
        const sessionId = this._threadId;
        const res = this._currentResolve;
        this._clearCurrent();
        res({ content, sessionId, usage, modelUsage: null, totalCostUsd: 0, durationMs: null, subtype: code === 0 ? 'success' : null, isError: code !== 0 });
      }
    });

    this.proc.on('error', (err) => {
      if (myProc !== this.proc) return;
      if (this._currentReject) {
        const rej = this._currentReject;
        this._clearCurrent();
        rej(err);
      }
    });

    this.proc.stdin.write(prompt + '\n');
    this.proc.stdin.end();
  }

  _handleEvent(event) {
    if (event.type === 'thread.started' && event.thread_id) {
      this._threadId = event.thread_id;
      this.resumeId = event.thread_id;
    }

    if (event.type === 'turn.started') {
      this.emit('status', 'thinking');
      this._currentOnState?.('thinking');
    }

    if (event.type === 'item.completed') {
      if (event.item?.type === 'agent_message' && event.item.text) {
        this._accContent += event.item.text;
        this._currentOnToken?.(event.item.text);
      }
      if (event.item?.type === 'command_execution' || event.item?.type === 'file_change') {
        this._currentOnTool?.({ name: event.item.type, input: { command: event.item.command || event.item.path || '' } });
      }
      if (event.item?.type === 'mcp_tool_call') this._currentOnTool?.(mcpToolStep(event.item));
    }

    if (event.type === 'turn.completed' && event.usage) {
      // OpenAI input_tokens already includes cached tokens; usage_log follows Anthropic semantics
      // (input excludes cache) and stats sum input + cache_read, so split them to avoid double-counting.
      const input = event.usage.input_tokens || 0;
      const cached = event.usage.cached_input_tokens || 0;
      this._usage = {
        input_tokens: Math.max(0, input - cached),
        output_tokens: event.usage.output_tokens || 0,
        cache_read_input_tokens: cached,
        cache_creation_input_tokens: event.usage.cache_write_input_tokens || 0,
      };
    }
  }

  _clearCurrent() {
    this._currentResolve = null;
    this._currentReject = null;
    this._currentOnToken = null;
    this._currentOnState = null;
    this._currentOnTool = null;
    this._currentTaskId = null;
    this._accContent = '';
    this._usage = null;
    this.busy = false;
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      this._startTask(next);
    }
  }

  send({ prompt, imageData = null, onToken, onState, onTool, taskId } = {}) {
    return new Promise((resolve, reject) => {
      const task = { prompt, imageData, onToken, onState, onTool, resolve, reject, taskId };
      if (this.busy) {
        this._queue.push(task);
      } else {
        this._startTask(task);
      }
    });
  }

  abort() {
    if (!this.busy) return;
    const content = this._accContent || '';
    const resolve = this._currentResolve;
    this._currentResolve = null;
    this._currentReject = null;
    this._currentOnToken = null;
    this._currentOnState = null;
    this._currentOnTool = null;
    this._currentTaskId = null;
    this._accContent = '';
    this._usage = null;
    this.busy = false;
    resolve?.({ content, sessionId: this._threadId, aborted: true });
    this.proc?.kill('SIGTERM');
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      this._startTask(next);
    }
  }

  cancelTask(taskId) {
    if (this._currentTaskId === taskId && this.busy) {
      this.abort();
      return true;
    }
    const idx = this._queue.findIndex(t => t.taskId === taskId);
    if (idx !== -1) {
      const [removed] = this._queue.splice(idx, 1);
      removed.resolve?.({ content: '', sessionId: this._threadId, aborted: true });
      return true;
    }
    return false;
  }

  shutdown() {
    if (this._currentReject) {
      const reject = this._currentReject;
      this._currentResolve = null;
      this._currentReject = null;
      this._currentOnToken = null;
      this._currentOnState = null;
      this._currentOnTool = null;
      this._currentTaskId = null;
      this._accContent = '';
      this.busy = false;
      reject(new Error('session shutdown'));
    }
    const queued = this._queue.splice(0);
    for (const t of queued) t.reject?.(new Error('session shutdown'));
    this.proc?.kill('SIGTERM');
    this.proc = null;
  }
}

module.exports = { CodexSession, escapeTomlValue, mcpConfigArgs };
