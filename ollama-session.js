// ollama-session.js — HTTP client for Ollama API
// Interface mirrors claude-session.js: EventEmitter, send(), abort(), shutdown()
const { EventEmitter } = require('events');
const http = require('http');
const https = require('https');

class OllamaSession extends EventEmitter {
  constructor({ workDir = process.cwd(), adapterConfig = {} } = {}) {
    super();
    this.workDir = workDir;
    this.busy = false;
    this._queue = [];
    this._currentResolve = null;
    this._currentReject = null;
    this._currentOnToken = null;
    this._currentOnState = null;
    this._currentOnTool = null;
    this._accContent = '';
    this._dead = false;
    this._aborted = false;
    this._req = null;

    const cfg = adapterConfig || {};
    this.host = cfg.ollama_host || process.env.OLLAMA_HOST || 'http://localhost:11434';
    this.modelChat = cfg.model_chat || process.env.STOA_MODEL_CHAT || 'ara';
    this.modelVision = cfg.model_vision || process.env.STOA_MODEL_VISION || 'qwen2.5vl:7b';
    this.historyLimit = parseInt(cfg.history_limit ?? 10) || 10;
    // resumeId is always null — Ollama has no session persistence
    this.resumeId = null;
  }

  _startTask({ prompt, imageData, history, onToken, onState, onTool, resolve, reject }) {
    this.busy = true;
    this._aborted = false;
    this._currentResolve = resolve;
    this._currentReject = reject;
    this._currentOnToken = onToken || null;
    this._currentOnState = onState || null;
    this._currentOnTool = onTool || null;
    this._accContent = '';

    onState?.('requesting');

    const model = imageData ? this.modelVision : this.modelChat;
    const userMsg = imageData
      ? { role: 'user', content: prompt, images: [imageData.base64] }
      : { role: 'user', content: prompt };

    const messages = history && history.length
      ? [...history.slice(-this.historyLimit), userMsg]
      : [userMsg];

    const body = JSON.stringify({
      model,
      messages,
      stream: true,
      think: false,
    });

    this._doStream(body, onState, resolve, reject);
  }

  _doStream(body, onState, resolve, reject) {
    let url;
    try { url = new URL('/api/chat', this.host); } catch (e) {
      const r = this._currentReject;
      this._clearCurrent();
      r?.(new Error(`Invalid ollama_host: ${this.host}`));
      return;
    }

    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = lib.request(options, (res) => {
      let buffer = '';
      onState?.('streaming');

      res.on('data', (chunk) => {
        if (this._aborted) return;
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            const token = data.message?.content;
            if (token) {
              this._accContent += token;
              this._currentOnToken?.(token);
            }
            if (data.done) {
              if (this._aborted) return;
              const content = this._accContent;
              const res = this._currentResolve;
              this._clearCurrent();
              onState?.('complete');
              res?.({ content, sessionId: null });
            }
          } catch {}
        }
      });

      res.on('end', () => {
        if (this._aborted || !this._currentResolve) return;
        const content = this._accContent;
        const res = this._currentResolve;
        this._clearCurrent();
        onState?.('complete');
        res?.({ content, sessionId: null });
      });

      res.on('error', (err) => {
        if (this._aborted) return;
        const rej = this._currentReject;
        this._clearCurrent();
        rej?.(err);
      });
    });

    req.on('error', (err) => {
      if (this._aborted) return;
      const rej = this._currentReject;
      this._clearCurrent();
      rej?.(err);
    });

    this._req = req;
    req.write(body);
    req.end();
  }

  _clearCurrent() {
    this._currentResolve = null;
    this._currentReject = null;
    this._currentOnToken = null;
    this._currentOnState = null;
    this._currentOnTool = null;
    this._accContent = '';
    this.busy = false;
    this._req = null;
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      this._startTask(next);
    }
  }

  send({ prompt, imageData = null, history = null, onToken, onState, onTool } = {}) {
    return new Promise((resolve, reject) => {
      const task = { prompt, imageData, history, onToken, onState, onTool, resolve, reject };
      if (this.busy) {
        this._queue.push(task);
      } else {
        this._startTask(task);
      }
    });
  }

  abort() {
    if (!this.busy) return;
    this._aborted = true;
    const content = this._accContent || '';
    const resolve = this._currentResolve;
    this._currentResolve = null;
    this._currentReject = null;
    this._currentOnToken = null;
    this._currentOnState = null;
    this._currentOnTool = null;
    this._accContent = '';
    this.busy = false;
    this._req?.destroy();
    this._req = null;
    resolve?.({ content, sessionId: null, aborted: true });
  }

  shutdown() {
    this._dead = true;
    this._req?.destroy();
  }
}

module.exports = { OllamaSession };
