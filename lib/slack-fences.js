'use strict';

// Slack renders ``` fences anywhere on a line (e.g. `STATUS: X``` *Sent using*`),
// but GFM only closes a fence that starts its own line. Substituted into an
// automation prompt, such a fence leaks the code block over every field after it.
function normalizeSlackCodeFences(text) {
  if (typeof text !== 'string' || !text.includes('```')) return text;
  const parts = text.split(/(`{3,})/);
  let out = '';
  let open = false;
  let needBreak = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 0) {
      if (needBreak && part && !part.startsWith('\n')) out += '\n';
      out += part;
      needBreak = false;
      continue;
    }
    // Opening fence: a leading break only if it is not already at line start.
    // Closing fence: always on its own line. Both need a break after.
    if (out && !out.endsWith('\n')) out += '\n';
    out += part;
    needBreak = true;
    open = !open;
  }
  if (open) out += (out.endsWith('\n') ? '' : '\n') + '```';
  return out;
}

module.exports = { normalizeSlackCodeFences };
