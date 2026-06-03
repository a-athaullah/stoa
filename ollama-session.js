// ollama-session.js — HTTP client for Ollama API with tool use support
// Interface mirrors claude-session.js: EventEmitter, send(), abort(), shutdown()
const { EventEmitter } = require('events');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const OLLAMA_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a shell command and return stdout/stderr. Use for running scripts, listing files, checking git status, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file by absolute path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write or overwrite a file with the given content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
          content: { type: 'string', description: 'File content' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and directories at a given path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search for a pattern in files. Returns matching lines with file and line number.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (regex)' },
          path: { type: 'string', description: 'File or directory to search in' },
          recursive: { type: 'boolean', description: 'Search recursively in directory' }
        },
        required: ['pattern', 'path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'http_get',
      description: 'Fetch a URL and return the response body as text. Useful for reading documentation or API responses.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using DuckDuckGo and return relevant results.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  }
];

function executeTool(name, args, workDir) {
  try {
    if (name === 'bash') {
      const out = execSync(args.command, {
        cwd: workDir || process.env.HOME,
        timeout: 60_000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return out || '(no output)';
    } else if (name === 'read_file') {
      return fs.readFileSync(args.path, 'utf8');
    } else if (name === 'write_file') {
      fs.mkdirSync(path.dirname(args.path), { recursive: true });
      fs.writeFileSync(args.path, args.content, 'utf8');
      return 'Written successfully.';
    } else if (name === 'list_dir') {
      const entries = fs.readdirSync(args.path, { withFileTypes: true });
      return entries.map(e => (e.isDirectory() ? '[dir] ' : '') + e.name).join('\n');
    } else if (name === 'grep') {
      const flags = args.recursive ? '-rn' : '-n';
      const out = execSync(`grep ${flags} -E ${JSON.stringify(args.pattern)} ${JSON.stringify(args.path)} 2>&1 || true`, {
        encoding: 'utf8', timeout: 15_000,
      });
      return out.slice(0, 8000) || '(no matches)';
    } else if (name === 'http_get') {
      const out = execSync(`curl -sL --max-time 15 ${JSON.stringify(args.url)}`, {
        encoding: 'utf8', timeout: 20_000,
      });
      return out.slice(0, 8000);
    } else if (name === 'web_search') {
      const encoded = encodeURIComponent(args.query);
      const out = execSync(`curl -sL --max-time 15 "https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1"`, {
        encoding: 'utf8', timeout: 20_000,
      });
      try {
        const data = JSON.parse(out);
        const results = [];
        if (data.AbstractText) results.push(data.AbstractText);
        if (data.RelatedTopics) {
          data.RelatedTopics.slice(0, 5).forEach(t => {
            if (t.Text) results.push(`- ${t.Text}`);
          });
        }
        return results.join('\n') || '(no results)';
      } catch {
        return out.slice(0, 2000);
      }
    }
    return `Unknown tool: ${name}`;
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

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

  async _startTask({ prompt, imageData, history, onToken, onState, onTool, resolve, reject }) {
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

    let messages = history && history.length
      ? [...history.slice(-this.historyLimit), userMsg]
      : [userMsg];

    const MAX_TOOL_ROUNDS = 10;
    let round = 0;

    try {
      while (round < MAX_TOOL_ROUNDS) {
        if (this._aborted) break;
        round++;

        const body = JSON.stringify({
          model,
          messages,
          stream: true,
          think: false,
          tools: model === this.modelVision ? undefined : OLLAMA_TOOLS,
        });

        const result = await this._doStreamRound(body, onState, round === 1);
        if (this._aborted) break;

        if (result.tool_calls && result.tool_calls.length > 0) {
          messages.push({ role: 'assistant', content: result.content || '', tool_calls: result.tool_calls });

          for (const tc of result.tool_calls) {
            const name = tc.function?.name;
            const args = tc.function?.arguments || {};
            onTool?.({ type: 'tool_use', name, input: args });
            const toolResult = executeTool(name, args, this.workDir);
            onTool?.({ type: 'tool_result', name, content: toolResult.slice(0, 2000) });
            messages.push({ role: 'tool', content: toolResult.slice(0, 8000), name });
          }
        } else {
          break;
        }
      }

      if (!this._aborted) {
        const content = this._accContent;
        const res = this._currentResolve;
        this._clearCurrent();
        onState?.('complete');
        res?.({ content, sessionId: null });
      }
    } catch (err) {
      if (!this._aborted) {
        const rej = this._currentReject;
        this._clearCurrent();
        rej?.(err);
      }
    }
  }

  _doStreamRound(body, onState, isFirstRound) {
    return new Promise((resolve, reject) => {
      if (isFirstRound) onState?.('streaming');

      let url;
      try { url = new URL('/api/chat', this.host); } catch (e) { return reject(e); }

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
        let roundContent = '';
        let roundToolCalls = null;
        let resolved = false;

        const done = (val) => {
          if (!resolved) { resolved = true; resolve(val); }
        };

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
                roundContent += token;
                this._accContent += token;
                this._currentOnToken?.(token);
              }
              if (data.message?.tool_calls) {
                roundToolCalls = data.message.tool_calls;
              }
              if (data.done) {
                done({ content: roundContent, tool_calls: roundToolCalls });
              }
            } catch {}
          }
        });

        res.on('end', () => {
          done({ content: roundContent, tool_calls: roundToolCalls });
        });

        res.on('error', (err) => {
          if (!resolved) { resolved = true; reject(err); }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      this._req = req;
      req.write(body);
      req.end();
    });
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
