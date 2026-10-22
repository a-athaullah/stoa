// claude-session.js — persistent claude process, one per AI agent instance
// Feed messages via stdin, read streaming responses from stdout.
// No --print flag: process stays alive between turns.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Stoa MCP gateway. The header holds the literal ${STOA_MCP_TOKEN}; Claude Code expands it from the
// process env, so the token never appears in argv (visible in ps). No --strict-mcp-config: the
// user's own MCP servers keep working.
function mcpConfigArgs(env) {
  if (!env?.STOA_MCP_TOKEN || !env?.STOA_MCP_URL) return [];
  const config = { mcpServers: { stoa: { type: 'http', url: env.STOA_MCP_URL, headers: { Authorization: 'Bearer ${STOA_MCP_TOKEN}' } } } };
  return ['--mcp-config', JSON.stringify(config)];
}

class ClaudeSession extends EventEmitter {
  constructor({ workDir = process.cwd(), flags = [], resumeId = null, env = null } = {}) {
    super();
    this.workDir = workDir;
    this.flags = flags;
    this.resumeId = resumeId;
    this.env = env;
    this.proc = null;
    this.buffer = '';
    this.busy = false;
    this._restarting = false;
    this._queue = [];
    this._currentResolve = null;
    this._currentReject = null;
    this._currentOnToken = null;
    this._currentOnState = null;
    this._currentOnTool = null;
    this._currentTaskId = null;
    this._accContent = '';
    this._pendingTool = null;
    this._turnStarted = false;
    this._autoTurn = null;
    this._backgroundTasks = [];
    // stable debug log path: one file per workdir in os.tmpdir()
    const wdHash = require('crypto').createHash('sha1').update(workDir).digest('hex').slice(0, 8);
    this.debugLogPath = path.join(os.tmpdir(), `stoa-claude-${wdHash}.log`);
    this._start();
  }

  _start() {
    this._dead = false;
    this._restarting = false;
    const args = [
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--dangerously-skip-permissions',
      '--debug-file', this.debugLogPath,
      ...mcpConfigArgs(this.env),
      ...this.flags,
    ];
    const spawnOpts = { cwd: this.workDir, windowsHide: true };
    if (this.env) spawnOpts.env = { ...process.env, ...this.env };
    this.proc = spawn('claude', args, spawnOpts);
    this.proc.stdin.on('error', () => {});
    this.buffer = '';

    this.proc.stdout.on('data', chunk => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try { this._handleEvent(JSON.parse(line)); } catch {}
      }
    });

    this._stderrBuf = '';
    this.proc.stderr.on('data', d => {
      process.stderr.write(d);
      this._stderrBuf += d.toString();
    });

    this.proc.on('close', (code, signal) => {
      if (this._dead) return;
      if (this._stderrBuf.includes('No conversation found')) {
        console.error('[session] Resume ID invalid, restarting without resume...');
        this.flags = this.flags.filter((f, i, arr) => f !== '--resume' && arr[i - 1] !== '--resume');
        this.resumeId = null;
      }
      const lastStderr = this._stderrBuf.trim().split('\n').slice(-3).join(' | ');
      console.error(`[session] claude process exited code=${code} signal=${signal}${lastStderr ? ' stderr=' + lastStderr.slice(0, 200) : ''}, restarting in 3s...`);
      this._stderrBuf = '';
      if (this._currentReject) {
        const reject = this._currentReject;
        this._clearCurrent({ drain: false });
        reject(new Error('claude process exited unexpectedly'));
      }
      this._autoTurn = null;
      this._backgroundTasks = [];
      this._restarting = true;
      setTimeout(() => {
        if (this._dead) return;
        this._start();
        this._drainQueue();
      }, 3000);
    });
  }

  _clearCurrent({ drain = true } = {}) {
    this._currentResolve = null;
    this._currentReject = null;
    this._currentOnToken = null;
    this._currentOnState = null;
    this._currentOnTool = null;
    this._currentTaskId = null;
    this._accContent = '';
    this._pendingTool = null;
    this._turnStarted = false;
    this.busy = false;
    if (drain) this._drainQueue();
  }

  _drainQueue() {
    if (this.busy || this._autoTurn || this._dead || this._restarting || this._queue.length === 0) return;
    this._startTask(this._queue.shift());
  }

  hasBackgroundTasks() {
    return this._backgroundTasks.length > 0;
  }

  isTurnActive() {
    return this.busy || !!this._autoTurn;
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
    this._pendingTool = null;
    this._turnStarted = false;

    const content = [];
    if (imageData) {
      content.push({ type: 'image', source: { type: 'base64', media_type: imageData.mimeType, data: imageData.base64 } });
    }
    content.push({ type: 'text', text: prompt });

    const message = JSON.stringify({ type: 'user', message: { role: 'user', content } });
    this.proc.stdin.write(message + '\n');
  }

  // The CLI also runs turns Stoa never asked for: on resume with an orphaned background shell it
  // emits a synthetic empty `result` before our prompt's turn, and when a background task finishes
  // while idle it runs a turn of its own. Only events of a started turn may settle the current task.
  _isTurnEvent(event) {
    if (event.type === 'stream_event' || event.type === 'assistant') return true;
    return event.type === 'system' && (event.subtype === 'status' || event.subtype === 'compact_boundary');
  }

  _handleEvent(event) {
    if (event.type === 'system' && event.subtype === 'background_tasks_changed') {
      this._backgroundTasks = Array.isArray(event.tasks) ? event.tasks : [];
      return;
    }

    if (this._isTurnEvent(event)) {
      if (this.busy) this._turnStarted = true;
      else if (!this._autoTurn) this._autoTurn = { content: '' };
    }

    if (this._autoTurn && !this.busy) {
      this._handleAutoTurnEvent(event);
      return;
    }

    if (event.type === 'system' && event.subtype === 'status') {
      this.emit('status', event.status);
      this._currentOnState?.(event.status);
    }

    if (event.type === 'stream_event') {
      const e = event.event;

      if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
        this._pendingTool = { name: e.content_block.name, id: e.content_block.id, inputJson: '' };
      }

      if (e?.type === 'content_block_delta' && e.delta?.type === 'input_json_delta' && this._pendingTool) {
        this._pendingTool.inputJson += e.delta.partial_json || '';
      }

      if (e?.type === 'content_block_stop' && this._pendingTool) {
        let input = {};
        try { input = JSON.parse(this._pendingTool.inputJson); } catch {}
        this._currentOnTool?.({ name: this._pendingTool.name, input });
        this._pendingTool = null;
      }

      if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        this._accContent += e.delta.text;
        this._currentOnToken?.(e.delta.text);
      }
    }

    if (event.type === 'result') {
      if (!this.busy) return;
      if (!this._turnStarted) {
        console.warn(`[session] ignoring result emitted before turn started: task=${this._currentTaskId} resultLen=${(event.result || '').length} subtype=${event.subtype || ''}`);
        return;
      }
      // Use streamed tokens if available, otherwise fall back to result field
      const content = this._accContent || event.result || '';
      const sessionId = event.session_id;
      const usage = event.usage || null;
      const modelUsage = event.modelUsage || null;
      const totalCostUsd = event.total_cost_usd || 0;
      // Phase 4: the CLI result event also carries wall-clock + a subtype that
      // distinguishes a clean finish from an error stop (e.g. error_max_turns).
      // These were previously dropped; they feed the run's result_meta chip.
      const durationMs = event.duration_ms || null;
      const subtype = event.subtype || null;
      const resolve = this._currentResolve;
      this._clearCurrent();
      resolve?.({ content, sessionId, usage, modelUsage, totalCostUsd, durationMs, subtype });
    }
  }

  _handleAutoTurnEvent(event) {
    if (event.type === 'stream_event') {
      const e = event.event;
      if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') this._autoTurn.content += e.delta.text;
      return;
    }
    if (event.type !== 'result') return;
    const content = this._autoTurn.content || event.result || '';
    this._autoTurn = null;
    this.emit('unsolicited_result', { content, sessionId: event.session_id || null });
    this._drainQueue();
  }

  // Send a message and await the complete response.
  // Returns Promise<{ content, sessionId }>.
  send({ prompt, imageData = null, onToken, onState, onTool, taskId } = {}) {
    return new Promise((resolve, reject) => {
      const task = { prompt, imageData, onToken, onState, onTool, resolve, reject, taskId };
      if (this.busy || this._restarting || this._autoTurn) {
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
    this._pendingTool = null;
    this._turnStarted = false;
    this.busy = false;
    this._restarting = true;
    resolve?.({ content, sessionId: null, aborted: true });
    this.proc?.kill('SIGTERM');
  }

  cancelTask(taskId) {
    if (this._currentTaskId === taskId && this.busy) {
      this.abort();
      return true;
    }
    const idx = this._queue.findIndex(t => t.taskId === taskId);
    if (idx !== -1) {
      const [removed] = this._queue.splice(idx, 1);
      removed.resolve?.({ content: '', sessionId: null, aborted: true });
      return true;
    }
    return false;
  }

  shutdown() {
    this._dead = true;
    if (this._currentReject) {
      const reject = this._currentReject;
      this._clearCurrent();
      reject(new Error('session shutdown'));
    }
    const queued = this._queue.splice(0);
    for (const t of queued) t.reject?.(new Error('session shutdown'));
    this.proc?.kill('SIGTERM');
  }
}

module.exports = { ClaudeSession, mcpConfigArgs };
