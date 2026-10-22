// ── Process trail (tool steps below bubble) ────────────────────────────────
function toolSummary(name, input) {
  if (!input) return '';
  const keyMap = { Bash: 'command', Read: 'file_path', Write: 'file_path', Edit: 'file_path',
    Glob: 'pattern', Grep: 'pattern', WebFetch: 'url', WebSearch: 'query',
    NotebookEdit: 'notebook_path', mcp__ide__executeCode: 'code' };
  const key = keyMap[name];
  let val = (key && input[key]) ? String(input[key]) : (Object.values(input).find(v => typeof v === 'string') || '');
  if (val.length > 64) val = val.slice(0, 61) + '…';
  return val;
}

// Gateway tools reach Claude Code as mcp__stoa__<slug>__<tool>; the gateway splits slug and tool at the first "__".
function parseStoaMcpTool(name) {
  const prefix = 'mcp__stoa__';
  if (typeof name !== 'string' || !name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  const sep = rest.indexOf('__');
  if (sep <= 0 || sep + 2 >= rest.length) return null;
  return { slug: rest.slice(0, sep), tool: rest.slice(sep + 2) };
}

function appendToolStep(msgId, tool) {
  const row = document.getElementById('msg-' + msgId);
  if (!row) return;

  const body = row.querySelector('.h-msg-body');
  if (!body) return;

  let trail = body.querySelector('.h-process-trail');
  if (!trail) {
    trail = document.createElement('div');
    trail.className = 'h-process-trail';
    body.appendChild(trail);
  }

  const step = document.createElement('div');
  step.className = 'h-process-step';

  const toolEl = document.createElement('span');
  toolEl.className = 'h-process-tool';
  const gw = parseStoaMcpTool(tool.name);
  toolEl.textContent = gw ? gw.tool : tool.name;

  const inputEl = document.createElement('span');
  inputEl.className = 'h-process-input';
  inputEl.textContent = toolSummary(tool.name, tool.input);

  step.appendChild(toolEl);
  if (gw) {
    const via = document.createElement('span');
    via.className = 'h-process-via';
    via.dataset.mcpSlug = gw.slug;
    via.textContent = mcpViaText(mcpServerNameBySlug(gw.slug));
    via.title = tool.name;
    step.appendChild(via);
  }
  step.appendChild(inputEl);
  trail.appendChild(step);
  scrollToBottom();
}

