// claude-adapter-lite — no DB dependency, for remote agents (Linux/Mac)
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');

function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const base64 = Buffer.concat(chunks).toString('base64');
        const mimeType = (res.headers['content-type'] || 'image/png').split(';')[0];
        resolve({ base64, mimeType });
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function spawnClaude({ prompt, sessionId = null, imageUrl = null, workDir = process.cwd(), onToken, onState, flags = [] }) {
  const content = [];

  if (imageUrl) {
    try {
      const { base64, mimeType } = await fetchImage(imageUrl);
      content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } });
    } catch (err) {
      console.error('[adapter] image fetch failed, continuing text-only:', err.message);
    }
  }
  content.push({ type: 'text', text: prompt });

  // Always use stream-json stdin to avoid shell escaping issues with long/multiline prompts
  const stdinData = JSON.stringify({ type: 'user', message: { role: 'user', content } });

  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--dangerously-skip-permissions',
      '--input-format', 'stream-json',
      ...flags,
    ];
    if (sessionId) args.push('--resume', sessionId);

    const proc = spawn('claude', args, { cwd: workDir });
    let finalSessionId = sessionId;
    let buffer = '';

    onState?.('requesting');

    proc.stdin.on('error', () => {});
    proc.stdin.write(stdinData + '\n');
    proc.stdin.end();

    proc.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.session_id) finalSessionId = event.session_id;
          if (event.type === 'system' && event.subtype === 'status') onState?.(event.status);
          if (event.type === 'stream_event') {
            const e = event.event;
            if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
              onToken?.(e.delta.text);
            }
          }
        } catch {}
      }
    });

    proc.stderr.on('data', () => {});
    proc.on('close', code => {
      onState?.('complete');
      if (code !== 0 && !finalSessionId) return reject(new Error(`claude exited ${code}`));
      resolve(finalSessionId);
    });
    proc.on('error', reject);
  });
}

module.exports = { spawnClaude };
