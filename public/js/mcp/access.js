// ── MCP tab: access matrix ───────────────────────────────────────────────────
const MCP_CELL_NEXT = { inherit: 'allow', allow: 'deny', deny: 'inherit' };

function mcpGrantKey(serverId, type, id) { return `${serverId}:${type}:${id}`; }

async function mcpLoadAccess() {
  const r = await mcpApi('GET', '/api/mcp/access');
  if (!r.ok) { mcpState.access = { error: r.error }; return; }
  const grants = new Map();
  (r.data?.grants || []).forEach(g => grants.set(mcpGrantKey(g.server_id, g.subject_type, g.subject_id), !!g.allow));
  mcpState.access = { servers: r.data?.servers || [], subjects: r.data?.subjects || [], grants };
}

function mcpCellState(serverId, type, id) {
  const g = mcpState.access.grants.get(mcpGrantKey(serverId, type, id));
  return g === undefined ? 'inherit' : g ? 'allow' : 'deny';
}

function mcpInheritedAllow(serverId, subject) {
  if (subject.type === 'sub_agent' && subject.parent_agent_id != null) {
    const parent = mcpState.access.grants.get(mcpGrantKey(serverId, 'agent', subject.parent_agent_id));
    if (parent !== undefined) return { allow: parent, from: 'agent' };
  }
  return { allow: mcpServerById(serverId)?.default_access === 'all', from: 'default' };
}

function mcpRenderAccess(panel) {
  if (!mcpState.access) {
    panel.appendChild(mcpEl('div', 'mcp-muted', 'loading access…'));
    mcpLoadAccess().then(() => { if (mcpIsVisible() && mcpState.tab === 'access') mcpRender(); });
    return;
  }
  if (mcpState.access.error) {
    panel.appendChild(mcpEmpty('couldn’t load access', mcpState.access.error,
      mcpBtn('auto-small-btn', 'retry', () => { mcpState.access = null; mcpRender(); })));
    return;
  }
  const { servers, subjects } = mcpState.access;
  if (!servers.length) {
    panel.appendChild(mcpEmpty('nothing to grant yet', 'install an MCP server first, then decide who can use it here.',
      mcpBtn('auto-pill-btn', 'add an MCP server', () => mcpSetTab('add'))));
    return;
  }

  const legend = mcpEl('div', 'mcp-legend');
  legend.append(
    mcpEl('span', 'mcp-cell-allow mcp-legend-chip', '✓ allow'),
    mcpEl('span', 'mcp-cell-deny mcp-legend-chip', '✕ deny'),
    mcpEl('span', 'mcp-cell-inherit mcp-legend-chip', 'inherit'),
    mcpEl('span', 'mcp-field-hint', 'click a cell to cycle. unset cells inherit: sub-agent → agent → room → server default.'));
  panel.appendChild(legend);

  const scroller = mcpEl('div', 'mcp-matrix-scroll');
  const table = mcpEl('table', 'mcp-matrix');
  const thead = mcpEl('thead');
  const hr = mcpEl('tr');
  const corner = mcpEl('th', 'mcp-matrix-corner', 'who');
  corner.scope = 'col';
  hr.appendChild(corner);
  servers.forEach(s => {
    const th = mcpEl('th', 'mcp-matrix-col');
    th.scope = 'col';
    th.appendChild(mcpEl('div', 'mcp-col-name', s.name));
    th.appendChild(mcpEl('code', 'mcp-slug', s.slug));
    const full = mcpServerById(s.id);
    if (full) {
      const def = mcpEl('div', 'mcp-col-default');
      def.appendChild(mcpSwitch(full.default_access === 'all', `${s.name}: allow all agents by default`, async next => {
        const r = await mcpApi('PATCH', `/api/mcp/servers/${s.id}`, { default_access: next ? 'all' : 'none' });
        if (!r.ok) { showToast(`Couldn’t update ${s.name}: ${r.error}`, { error: true }); return false; }
        if (r.data?.server) Object.assign(full, r.data.server); else full.default_access = next ? 'all' : 'none';
        mcpRender();
        return true;
      }));
      def.appendChild(mcpEl('span', null, 'all'));
      th.appendChild(def);
    }
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = mcpEl('tbody');
  const agents = subjects.filter(x => x.type === 'agent');
  const subs = subjects.filter(x => x.type === 'sub_agent');
  const rooms = subjects.filter(x => x.type === 'room');
  const agentIds = new Set(agents.map(a => a.id));

  const group = label => {
    const tr = mcpEl('tr', 'mcp-matrix-group');
    const td = mcpEl('th', null, label);
    td.colSpan = servers.length + 1;
    td.scope = 'colgroup';
    tr.appendChild(td);
    tbody.appendChild(tr);
  };
  const row = (subject, indent) => {
    const tr = mcpEl('tr');
    const th = mcpEl('th', indent ? 'mcp-matrix-subject mcp-matrix-sub' : 'mcp-matrix-subject');
    th.scope = 'row';
    th.appendChild(mcpEl('span', 'mcp-subject-name', subject.name));
    if (subject.type === 'sub_agent') th.appendChild(mcpEl('span', 'mcp-subject-kind', 'sub-agent'));
    tr.appendChild(th);
    servers.forEach(s => tr.appendChild(mcpMakeCell(s, subject)));
    tbody.appendChild(tr);
  };

  if (agents.length || subs.length) {
    group('agents');
    agents.forEach(a => {
      row(a, false);
      subs.filter(x => x.parent_agent_id === a.id).forEach(x => row(x, true));
    });
    const orphans = subs.filter(x => !agentIds.has(x.parent_agent_id));
    orphans.forEach(x => row(x, true));
  }
  if (rooms.length) {
    group('rooms');
    rooms.forEach(r => row(r, false));
  }
  table.appendChild(tbody);
  scroller.appendChild(table);
  panel.appendChild(scroller);
}

function mcpMakeCell(server, subject) {
  const td = mcpEl('td', 'mcp-matrix-cell');
  const st = mcpCellState(server.id, subject.type, subject.id);
  const b = mcpEl('button', `mcp-cell mcp-cell-${st}`);
  b.type = 'button';
  if (st === 'allow') b.textContent = '✓';
  else if (st === 'deny') b.textContent = '✕';
  else {
    const inh = subject.type === 'room' ? { allow: false, from: 'none' } : mcpInheritedAllow(server.id, subject);
    b.textContent = subject.type === 'room' ? '–' : inh.allow ? '(✓)' : '–';
    b.title = subject.type === 'room' ? 'inherit — no room-wide grant'
      : `inherit — currently ${inh.allow ? 'allowed' : 'not allowed'} by ${inh.from === 'agent' ? 'the parent agent' : 'the server default'}`;
  }
  b.setAttribute('aria-label', `${subject.name} · ${server.name}: ${st}. Activate to change to ${MCP_CELL_NEXT[st]}`);
  b.addEventListener('click', async () => {
    const next = MCP_CELL_NEXT[st];
    b.disabled = true;
    const allow = next === 'inherit' ? null : next === 'allow';
    const r = await mcpApi('PUT', '/api/mcp/access', { server_id: server.id, subject_type: subject.type, subject_id: subject.id, allow });
    if (!r.ok) { showToast(`Couldn’t change access: ${r.error}`, { error: true }); b.disabled = false; return; }
    const key = mcpGrantKey(server.id, subject.type, subject.id);
    if (allow === null) mcpState.access.grants.delete(key); else mcpState.access.grants.set(key, allow);
    const focusLabel = `${subject.type}:${subject.id}:${server.id}`;
    mcpRender();
    document.querySelector(`.mcp-cell[data-focus-key="${focusLabel}"]`)?.focus();
  });
  b.dataset.focusKey = `${subject.type}:${subject.id}:${server.id}`;
  td.appendChild(b);
  return td;
}

// Read-only summary for the sub-agent edit form; policy is edited only in the access tab.
function mcpBuildSubAgentSummary(sa, parentAgentId) {
  const box = mcpEl('div', 'mcp-sa-summary');
  box.appendChild(mcpEl('span', 'mcp-field-hint', 'loading…'));
  (async () => {
    const [acc, srv] = await Promise.all([mcpApi('GET', '/api/mcp/access'), mcpApi('GET', '/api/mcp/servers')]);
    box.replaceChildren();
    if (!acc.ok || !srv.ok) { box.appendChild(mcpEl('span', 'mcp-field-hint', `couldn’t load MCP access · ${acc.error || srv.error}`)); return; }
    const servers = Array.isArray(srv.data?.servers) ? srv.data.servers : [];
    const grants = new Map();
    (acc.data?.grants || []).forEach(g => grants.set(mcpGrantKey(g.server_id, g.subject_type, g.subject_id), !!g.allow));
    if (!servers.length) box.appendChild(mcpEl('span', 'mcp-field-hint', 'no MCP servers installed.'));
    servers.forEach(s => {
      const own = grants.get(mcpGrantKey(s.id, 'sub_agent', sa.id));
      const parent = grants.get(mcpGrantKey(s.id, 'agent', parentAgentId));
      let allow, from;
      if (own !== undefined) { allow = own; from = 'set on this sub-agent'; }
      else if (parent !== undefined) { allow = parent; from = 'from parent agent'; }
      else { allow = s.default_access === 'all'; from = 'server default'; }
      if (!s.enabled) { allow = false; from = 'server disabled'; }
      const line = mcpEl('div', 'mcp-sa-line');
      line.append(mcpEl('span', 'mcp-sa-name', s.name),
        mcpEl('span', allow ? 'mcp-sa-allowed' : 'mcp-sa-denied', allow ? 'allowed' : 'not allowed'),
        mcpEl('span', 'mcp-field-hint', from));
      box.appendChild(line);
    });
    box.appendChild(mcpBtn('mcp-link-btn', 'manage in MCP → access', () => mcpOpenAccess()));
  })();
  return box;
}
