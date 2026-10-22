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
  const seg = mcpEl('div', 'mcp-seg');
  [['calls', 'tool calls'], ['approvals', 'approvals']].forEach(([id, label]) => {
    const b = mcpBtn('mcp-seg-btn', label, () => { if (mcpState.activityView !== id) { mcpState.activityView = id; mcpRender(); } });
    b.setAttribute('aria-pressed', mcpState.activityView === id ? 'true' : 'false');
    seg.appendChild(b);
  });
  panel.appendChild(seg);
  if (mcpState.activityView === 'approvals') { mcpRenderApprovalLog(panel); return; }

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

async function mcpLoadApprovalLog() {
  const q = new URLSearchParams();
  if (mcpState.approvalsFilter) q.set('status', mcpState.approvalsFilter);
  const r = await mcpApi('GET', `/api/mcp/approvals${q.size ? `?${q}` : ''}`);
  mcpState.approvals = r.ok ? { list: Array.isArray(r.data?.approvals) ? r.data.approvals : [] } : { error: r.error, list: [] };
}

function mcpReloadApprovalLog() {
  mcpState.approvals = null;
  mcpRender();
}

function mcpRenderApprovalLog(panel) {
  const bar = mcpEl('div', 'mcp-filters');
  const sel = mcpEl('select', 'auto-sel');
  sel.setAttribute('aria-label', 'Filter approvals by status');
  [['', 'all statuses'], ['pending', 'pending'], ['approved', 'approved'], ['denied', 'denied'], ['expired', 'expired']].forEach(([v, t]) => {
    const o = mcpEl('option', null, t);
    o.value = v;
    sel.appendChild(o);
  });
  sel.value = mcpState.approvalsFilter;
  sel.addEventListener('change', () => { mcpState.approvalsFilter = sel.value; mcpReloadApprovalLog(); });
  bar.append(sel, mcpEl('span', 'mcp-actions-spacer'), mcpBtn('auto-small-btn', 'refresh', mcpReloadApprovalLog));
  panel.appendChild(bar);

  if (!mcpState.approvals) {
    panel.appendChild(mcpEl('div', 'mcp-muted', 'loading approvals…'));
    mcpLoadApprovalLog().then(() => { if (mcpIsVisible() && mcpState.tab === 'activity' && mcpState.activityView === 'approvals') mcpRender(); });
    return;
  }
  const { list, error } = mcpState.approvals;
  if (error) {
    panel.appendChild(mcpEmpty('couldn’t load approvals', error, mcpBtn('auto-small-btn', 'retry', mcpReloadApprovalLog)));
    return;
  }
  if (!list.length) {
    panel.appendChild(mcpEmpty(mcpState.approvalsFilter ? `no ${mcpState.approvalsFilter} approvals` : 'no approval requests yet',
      mcpState.approvalsFilter ? null : 'turn on approval for a tool under installed → tools; each call then waits for you in its room or thread.'));
    return;
  }
  const rows = mcpEl('div', 'mcp-calls');
  rows.setAttribute('role', 'list');
  list.forEach(a => rows.appendChild(mcpMakeApprovalLogRow(a)));
  panel.appendChild(rows);
}

function mcpMakeApprovalLogRow(a) {
  const row = mcpEl('div', 'mcp-call mcp-appr-log');
  row.setAttribute('role', 'listitem');
  const main = mcpEl('div', 'mcp-call-main mcp-appr-log-main');
  const time = mcpEl('span', 'mcp-call-time', mcpLocalTime(a.created_at));
  time.title = a.created_at ? `${a.created_at} UTC` : '';
  main.append(time, mcpEl('code', 'mcp-call-tool', mcpApprToolName(a)), mcpEl('span', 'mcp-call-who', mcpApprWho(a)),
    mcpEl('span', `mcp-call-status mcp-call-${a.status}`, a.status));
  if (a.args_preview) main.title = a.args_preview;
  row.appendChild(main);

  const side = mcpEl('div', 'mcp-call-side');
  if (a.status === 'pending') {
    const actions = mcpEl('span', 'mcp-appr-actions');
    actions.append(
      mcpBtn('mcp-appr-approve', 'approve', async () => mcpApprLogSync(a, await mcpDecide(a, 'approve', actions))),
      mcpBtn('mcp-appr-deny', 'deny', async () => mcpApprLogSync(a, await mcpDecide(a, 'deny', actions))));
    side.appendChild(actions);
  }
  if (a.room_id) side.appendChild(mcpBtn('mcp-link-btn', a.thread_id ? 'open thread' : 'open room', () => goToMessage(a.room_id, null, a.thread_id || null)));
  row.appendChild(side);
  return row;
}

function mcpApprLogSync(a, out) {
  if (!out) return;
  a.status = out.status;
  a.decided_at = out.decided_at;
  if (mcpIsVisible() && mcpState.tab === 'activity' && mcpState.activityView === 'approvals') mcpRender();
}

// Live update of a loaded approvals log: a new request is prepended once, a resolution updates its row.
function mcpApprLogEvent(ev) {
  const list = mcpState.approvals?.list;
  if (!ev || !list) return;
  const cur = list.find(x => x.id === ev.id);
  if (ev.args_preview !== undefined) {
    if (cur || (mcpState.approvalsFilter && mcpState.approvalsFilter !== ev.status)) return;
    list.unshift({ ...ev });
  } else {
    if (!cur || cur.status === ev.status) return;
    cur.status = ev.status;
    cur.decided_at = ev.decided_at || null;
  }
  if (mcpIsVisible() && mcpState.tab === 'activity' && mcpState.activityView === 'approvals') mcpRender();
}
