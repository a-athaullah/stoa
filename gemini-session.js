// gemini-session.js — spawn-per-message gemini session
// Each send() spawns a new gemini process. Session continuity via --session-id.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const crypto = require('crypto');


class GeminiSession extends EventEmitter {
  constructor({ workDir = process.cwd(), flags = [], resumeId = null } = {}) {
    super();
    this.workDir = workDir;
    this.flags = flags;
    this.sessionId = resumeId || crypto.randomUUID();
    this.proc = null;
    this.busy = false;
    this._queue = [];
    this._currentResolve = null;
    this._currentReject = null;
    this._currentOnToken = null;
    this._currentOnState = null;
    this._currentOnTool = null;
    this._accContent = '';
    this._dead = false;
    this._messageCount = resumeId ? 1 : 0;
  }

  _startTask({ prompt, imageData, onToken, onState, onTool, resolve, reject }) {
    this.busy = true;
    this._currentResolve = resolve;
    this._currentReject = reject;
    this._currentOnToken = onToken || null;
    this._currentOnState = onState || null;
    this._currentOnTool = onTool || null;
    this._accContent = '';

    const args = [
      '--prompt=.',
      '-o', 'stream-json',
      '-y',
      '--skip-trust',
      '--session-id', this.sessionId,
      ...this.flags,
    ];

    if (this._messageCount > 0) {
      args.push('-r', 'latest');
    }
    this._messageCount++;

    onState?.('requesting');

    this.proc = spawn('gemini', args, { cwd: this.workDir, shell: true, windowsHide: true });
    this.proc.stdin.write(prompt);
    this.proc.stdin.end();

    let buffer = '';

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
    });

    this.proc.on('close', code => {
      const content = this._accContent || '';
      const sessionId = this.sessionId;
      const res = this._currentResolve;
      const rej = this._currentReject;
      this._clearCurrent();

      if (code !== 0 && !content) {
        rej?.(new Error(`gemini exited ${code}`));
      } else {
        res?.({ content, sessionId });
      }
    });

    this.proc.on('error', err => {
      const rej = this._currentReject;
      this._clearCurrent();
      rej?.(err);
    });
  }

  _handleEvent(event) {
    if (event.type === 'init') {
      this._currentOnState?.('streaming');
    }

    if (event.type === 'message' && event.role === 'assistant' && event.delta) {
      this._accContent += event.content || '';
      this._currentOnToken?.(event.content || '');
    }

    if (event.type === 'tool_use') {
      if (event.tool_name === 'update_topic') return;
      this._currentOnTool?.({ name: event.tool_name, input: event.parameters || {} });
    }

    if (event.type === 'result') {
      this._currentOnState?.('complete');
    }
  }

  _clearCurrent() {
    this._currentResolve = null;
    this._currentReject = null;
    this._currentOnToken = null;
    this._currentOnState = null;
    this._currentOnTool = null;
    this._accContent = '';
    this.busy = false;
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      this._startTask(next);
    }
  }

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
    this.busy = false;
    resolve?.({ content, sessionId: this.sessionId, aborted: true });
    this.proc?.kill('SIGTERM');
  }

  shutdown() {
    this._dead = true;
    this.proc?.kill('SIGTERM');
  }
}

module.exports = { GeminiSession };
