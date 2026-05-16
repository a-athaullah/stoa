// claude-session.js — persistent claude process, one per AI agent instance
// Feed messages via stdin, read streaming responses from stdout.
// No --print flag: process stays alive between turns.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class ClaudeSession extends EventEmitter {
  constructor({ workDir = process.cwd(), flags = [], resumeId = null } = {}) {
    super();
    this.workDir = workDir;
    this.flags = flags;
    this.resumeId = resumeId;
    this.proc = null;
    this.buffer = '';
    this.busy = false;
    this._queue = [];
    this._currentResolve = null;
    this._currentReject = null;
    this._currentOnToken = null;
    this._currentOnState = null;
    this._currentOnTool = null;
    this._accContent = '';
    this._pendingTool = null;
    this._start();
  }

  _start() {
    this._dead = false;
    const args = [
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--dangerously-skip-permissions',
      ...this.flags,
    ];
    this.proc = spawn('claude', args, { cwd: this.workDir, windowsHide: true });
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

    this.proc.on('close', () => {
      if (this._dead) return;
      // If resume ID is invalid, drop it and restart fresh
      if (this._stderrBuf.includes('No conversation found')) {
        console.error('[session] Resume ID invalid, restarting without resume...');
        this.flags = this.flags.filter((f, i, arr) => f !== '--resume' && arr[i - 1] !== '--resume');
        this.resumeId = null;
      }
      console.error('[session] claude process exited, restarting in 3s...');
      if (this._currentReject) {
        const reject = this._currentReject;
        this._clearCurrent();
        reject(new Error('claude process exited unexpectedly'));
      }
      setTimeout(() => { if (!this._dead) this._start(); }, 3000);
    });
  }

  _clearCurrent() {
    this._currentResolve = null;
    this._currentReject = null;
    this._currentOnToken = null;
    this._currentOnState = null;
    this._currentOnTool = null;
    this._accContent = '';
    this._pendingTool = null;
    this.busy = false;
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      this._startTask(next);
    }
  }

  _startTask({ prompt, imageData, onToken, onState, onTool, resolve, reject }) {
    this.busy = true;
    this._currentResolve = resolve;
    this._currentReject = reject;
    this._currentOnToken = onToken || null;
    this._currentOnState = onState || null;
    this._currentOnTool = onTool || null;
    this._accContent = '';
    this._pendingTool = null;

    const content = [];
    if (imageData) {
      content.push({ type: 'image', source: { type: 'base64', media_type: imageData.mimeType, data: imageData.base64 } });
    }
    content.push({ type: 'text', text: prompt });

    const message = JSON.stringify({ type: 'user', message: { role: 'user', content } });
    this.proc.stdin.write(message + '\n');
  }

  _handleEvent(event) {
    if (event.type === 'system' && event.subtype === 'status') {
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
      // Use streamed tokens if available, otherwise fall back to result field
      const content = this._accContent || event.result || '';
      const sessionId = event.session_id;
      const resolve = this._currentResolve;
      this._clearCurrent();
      resolve?.({ content, sessionId });
    }
  }

  // Send a message and await the complete response.
  // Returns Promise<{ content, sessionId }>.
  send({ prompt, imageData = null, onToken, onState, onTool } = {}) {
    return new Promise((resolve, reject) => {
      const task = { prompt, imageData, onToken, onState, onTool, resolve, reject };
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
    this._accContent = '';
    this._pendingTool = null;
    this.busy = false;
    resolve?.({ content, sessionId: null, aborted: true });
    this.proc?.kill('SIGTERM');
  }

  shutdown() {
    this._dead = true;
    this.proc?.kill('SIGTERM');
  }
}

module.exports = { ClaudeSession };
