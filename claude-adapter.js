const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Spawn claude and stream token events to a callback
// Returns: { sessionId, promise }
function spawnClaude({ prompt, sessionId = null, imageFilePath = null, workDir = 'C:\\Stoa', onToken, onState, onTool, flags = [] }) {
  const content = [];
  if (imageFilePath && fs.existsSync(imageFilePath)) {
    const base64 = fs.readFileSync(imageFilePath).toString('base64');
    const ext = path.extname(imageFilePath).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
    content.push({ type: 'image', source: { type: 'base64', media_type: mimeMap[ext] || 'image/png', data: base64 } });
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

    const proc = spawn('claude', args, { cwd: workDir, shell: true, windowsHide: true });

    proc.stdin.on('error', () => {});
    proc.stdin.write(stdinData + '\n');
    proc.stdin.end();

    let finalSessionId = sessionId;
    let buffer = '';
    let pendingTool = null;

    onState?.('requesting');

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
            if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
              pendingTool = { name: e.content_block.name, inputJson: '' };
            }
            if (e?.type === 'content_block_delta' && e.delta?.type === 'input_json_delta' && pendingTool) {
              pendingTool.inputJson += e.delta.partial_json || '';
            }
            if (e?.type === 'content_block_stop' && pendingTool) {
              let input = {};
              try { input = JSON.parse(pendingTool.inputJson); } catch {}
              onTool?.({ name: pendingTool.name, input });
              pendingTool = null;
            }
            if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') onToken?.(e.delta.text);
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
