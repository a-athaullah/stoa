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

function buildToolStep(name, summary) {
  const step = document.createElement('div');
  step.className = 'h-process-step';

  const toolEl = document.createElement('span');
  toolEl.className = 'h-process-tool';
  const gw = parseStoaMcpTool(name);
  toolEl.textContent = gw ? gw.tool : name;

  const inputEl = document.createElement('span');
  inputEl.className = 'h-process-input';
  inputEl.textContent = summary;

  step.appendChild(toolEl);
  if (gw) {
    const via = document.createElement('span');
    via.className = 'h-process-via';
    via.dataset.mcpSlug = gw.slug;
    via.textContent = mcpViaText(mcpServerNameBySlug(gw.slug));
    via.title = name;
    step.appendChild(via);
  }
  step.appendChild(inputEl);
  return step;
}

// Live rows carry .h-msg-body; a feed root row rendered from history (e.g. after a reload mid-run) only has .t-col.
function _trailHost(row) {
  return row.querySelector('.h-msg-body') || row.querySelector('.t-col');
}

function _ensureTrail(host) {
  let trail = host.querySelector(':scope > .h-process-trail');
  if (!trail) {
    trail = document.createElement('div');
    trail.className = 'h-process-trail';
    host.appendChild(trail);
  }
  return trail;
}

function appendToolStep(msgId, tool) {
  const row = document.getElementById('msg-' + msgId);
  if (!row) return;
  const host = _trailHost(row);
  if (!host) return;
  _ensureTrail(host).appendChild(buildToolStep(tool.name, toolSummary(tool.name, tool.input)));
  scrollToBottom();
}

// messages.tool_steps: JSON [{name, summary}] written by lib/tool-steps.js; anything malformed is dropped.
function parseSavedToolSteps(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  let list;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list
    .filter(s => s && typeof s.name === 'string' && s.name)
    .map(s => ({ name: s.name, summary: typeof s.summary === 'string' ? s.summary : '' }));
}

// Mirrors what finishStream leaves behind for a live run: failed runs keep their trail unless
// steps are hidden, finished ones only under "show all" + "keep trail".
function savedTrailVisible(state) {
  const progress = getToolProgress();
  if (progress === 'off') return false;
  if (state === 'error') return true;
  return progress === 'all' && getCleanupProgress() === 'off';
}

function syncSavedTrails() {
  document.querySelectorAll('.h-process-trail.h-process-saved').forEach(el => {
    el.hidden = !savedTrailVisible(el.dataset.state);
  });
}

// Rebuilds the trail of a message loaded from history. Still-running messages get their steps
// so far in a live trail that message_tool keeps extending.
function renderSavedTrail(host, m) {
  const steps = parseSavedToolSteps(m.tool_steps);
  if (!steps.length || !host) return;
  const running = m.state === 'streaming' || m.state === 'requesting';
  if (running && getToolProgress() === 'off') return;
  const trail = _ensureTrail(host);
  steps.forEach(s => trail.appendChild(buildToolStep(s.name, s.summary)));
  if (running) return;
  trail.classList.add('h-process-saved');
  trail.dataset.state = m.state;
  if (m.state === 'complete') {
    const done = document.createElement('div');
    done.className = 'h-process-done';
    done.textContent = 'done';
    trail.appendChild(done);
  }
  trail.hidden = !savedTrailVisible(m.state);
}
