// gemini-adapter.js — spawn-per-message for server-side fallback
const { spawn } = require('child_process');
const crypto = require('crypto');

function spawnGemini({ prompt, sessionId = null, imageFilePath = null, workDir = process.cwd(), onToken, onState, onTool, flags = [] }) {
  const geminiSessionId = sessionId || crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '-o', 'stream-json',
      '-y',
      '--skip-trust',
      '--session-id', geminiSessionId,
      ...flags,
    ];

    if (sessionId) args.push('-r', 'latest');

    const proc = spawn('gemini', args, { cwd: workDir, windowsHide: true });

    let buffer = '';
    onState?.('requesting');

    proc.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          if (event.type === 'init') {
            onState?.('streaming');
          }

          if (event.type === 'message' && event.role === 'assistant' && event.delta) {
            onToken?.(event.content || '');
          }

          if (event.type === 'tool_use') {
            if (event.tool_name === 'update_topic') continue;
            onTool?.({ name: event.tool_name, input: event.parameters || {} });
          }
        } catch {}
      }
    });

    proc.stderr.on('data', () => {});

    proc.on('close', code => {
      onState?.('complete');
      if (code !== 0 && !geminiSessionId) return reject(new Error(`gemini exited ${code}`));
      resolve(geminiSessionId);
    });

    proc.on('error', reject);
  });
}

module.exports = { spawnGemini };
