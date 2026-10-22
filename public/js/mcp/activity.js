// ── MCP tab: activity log ────────────────────────────────────────────────────
const MCP_CALLS_PAGE = 50;

async function mcpLoadCalls(more) {
  const q = new URLSearchParams({ limit: String(MCP_CALLS_PAGE) });
  if (mcpState.callsFilter.server_id) q.set('server_id', mcpState.callsFilter.server_id);
  if (mcpState.callsFilter.actor_id) q.set('actor_id', mcpState.callsFilter.actor_id);
  if (more && mcpState.callsNext) q.set('before_id', String(mcpState.callsNext));
  const r = await mcpApi('GET', `/api/mcp/calls?${q}`);
  if (!r.ok) { mcpState.callsError = r.error; mcpState.callsLoaded = true; return; }
  mcpState.callsError = null;
  const page = Array.isArray(r.data?.calls) ? r.data.calls : [];
  mcpState.calls = more ? mcpState.calls.concat(page) : page;
  mcpState.callsNext = r.data?.next_before_id || null;
  mcpState.callsLoaded = true;
}

function mcpReloadCalls() {
  mcpState.callsLoaded = false;
  mcpState.calls = [];
  mcpState.callsNext = null;
  mcpRender();
}

function mcpRenderActivity(panel) {
  const bar = mcpEl('div', 'mcp-filters');
  const mkSelect = (label, value, options, onChange) => {
    const sel = mcpEl('select', 'auto-sel');
    sel.setAttribute('aria-label', label);
    options.forEach(([v, t]) => {
      const o = mcpEl('option', null, t);
      o.value = v;
      sel.appendChild(o);
    });
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  };
  bar.appendChild(mkSelect('Filter by MCP server', mcpState.callsFilter.server_id,
    [['', 'all servers'], ...mcpState.servers.map(s => [String(s.id), s.name])],
    v => { mcpState.callsFilter.server_id = v; mcpReloadCalls(); }));
  const agents = (typeof allActors !== 'undefined' ? allActors : []).filter(a => a.type === 'ai');
  bar.appendChild(mkSelect('Filter by agent', mcpState.callsFilter.actor_id,
    [['', 'all agents'], ...agents.map(a => [String(a.id), a.name])],
    v => { mcpState.callsFilter.actor_id = v; mcpReloadCalls(); }));
  bar.appendChild(mcpEl('span', 'mcp-actions-spacer'));
  bar.appendChild(mcpBtn('auto-small-btn', 'refresh', mcpReloadCalls));
  panel.appendChild(bar);

  if (!mcpState.callsLoaded) {
    panel.appendChild(mcpEl('div', 'mcp-muted', 'loading activity…'));
    mcpLoadCalls(false).then(() => { if (mcpIsVisible() && mcpState.tab === 'activity') mcpRender(); });
    return;
  }
  if (mcpState.callsError && !mcpState.calls.length) {
    panel.appendChild(mcpEmpty('couldn’t load activity', mcpState.callsError, mcpBtn('auto-small-btn', 'retry', mcpReloadCalls)));
    return;
  }
  if (!mcpState.calls.length) {
    const filtered = mcpState.callsFilter.server_id || mcpState.callsFilter.actor_id;
    panel.appendChild(mcpEmpty(filtered ? 'no calls match these filters' : 'no tool calls yet',
      filtered ? null : 'every call an agent makes through the gateway shows up here — handy for “why did that fail?”.'));
    return;
  }

  const list = mcpEl('div', 'mcp-calls');
  list.setAttribute('role', 'list');
  mcpState.calls.forEach(c => list.appendChild(mcpMakeCallRow(c)));
  panel.appendChild(list);

  if (mcpState.callsNext) {
    const more = mcpBtn('auto-small-btn mcp-more', 'load more', async () => {
      more.disabled = true; more.textContent = 'loading…';
      await mcpLoadCalls(true);
      mcpRender();
    });
    panel.appendChild(more);
  }
  if (mcpState.callsError) panel.appendChild(mcpEl('div', 'mcp-card-error', mcpState.callsError));
}

function mcpMakeCallRow(c) {
  const row = mcpEl('div', 'mcp-call');
  row.setAttribute('role', 'listitem');
  const open = mcpState.openCallId === c.id;

  const main = mcpEl('button', 'mcp-call-main');
  main.type = 'button';
  main.setAttribute('aria-expanded', open ? 'true' : 'false');
  const time = mcpEl('span', 'mcp-call-time', mcpLocalTime(c.created_at));
  time.title = c.created_at ? `${c.created_at} UTC` : '';
  const tool = mcpEl('code', 'mcp-call-tool', c.server_slug ? `${c.server_slug}__${c.tool}` : c.tool);
  const who = mcpEl('span', 'mcp-call-who', [c.actor_name, c.sub_agent_label].filter(Boolean).join(' · ') || '—');
  const status = mcpEl('span', `mcp-call-status mcp-call-${c.status}`, c.status);
  const dur = mcpEl('span', 'mcp-call-dur', c.duration_ms != null ? `${c.duration_ms} ms` : '');
  main.append(time, tool, who, status, dur);
  main.addEventListener('click', () => {
    mcpState.openCallId = open ? null : c.id;
    row.replaceWith(mcpMakeCallRow(c));
  });
  row.appendChild(main);

  const side = mcpEl('div', 'mcp-call-side');
  if (c.room_id) {
    const go = mcpBtn('mcp-link-btn', c.thread_id ? 'open thread' : 'open room', () => goToMessage(c.room_id, null, c.thread_id || null));
    go.title = c.thread_id ? `Room ${c.room_id}, thread ${c.thread_id}` : `Room ${c.room_id}`;
    side.appendChild(go);
  }
  row.appendChild(side);

  if (open) {
    const det = mcpEl('div', 'mcp-call-detail');
    if (c.error) det.appendChild(mcpEl('div', 'mcp-card-error', c.error));
    const meta = mcpEl('div', 'mcp-card-meta');
    if (c.result_bytes != null) meta.appendChild(mcpEl('span', null, `${c.result_bytes} bytes returned`));
    if (c.room_id) meta.appendChild(mcpEl('span', null, `room ${c.room_id}${c.thread_id ? ` · thread ${c.thread_id}` : ''}`));
    if (meta.childNodes.length) det.appendChild(meta);
    det.appendChild(mcpEl('div', 'mcp-field-label', 'arguments (redacted preview)'));
    det.appendChild(mcpEl('pre', 'mcp-args-preview', c.args_preview || '—'));
    row.appendChild(det);
  }
  return row;
}
