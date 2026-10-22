// ── MCP tab: installed servers ───────────────────────────────────────────────
const MCP_STATUS_LABEL = { running: 'running', idle: 'idle', error: 'error', disabled: 'disabled' };

function mcpRenderInstalled(panel) {
  if (!mcpState.loaded && mcpState.loadError) {
    panel.appendChild(mcpEmpty('couldn’t load MCP servers', mcpState.loadError,
      mcpBtn('auto-small-btn', 'retry', () => sLoadMcpTab())));
    return;
  }
  if (!mcpState.servers.length) {
    panel.appendChild(mcpEmpty('no MCP servers yet',
      'install one from the catalog — Context7 needs no credentials and gives agents up-to-date library docs.',
      mcpBtn('auto-pill-btn', 'add an MCP server', () => mcpSetTab('add'))));
    return;
  }
  const list = mcpEl('div', 'mcp-cards');
  mcpState.servers.forEach(srv => list.appendChild(mcpMakeServerCard(srv)));
  panel.appendChild(list);
}

function mcpMakeServerCard(srv) {
  const card = mcpEl('div', 'mcp-card');
  card.dataset.serverId = srv.id;
  const status = srv.enabled ? (srv.status || 'idle') : 'disabled';

  const head = mcpEl('div', 'mcp-card-head');
  const dot = mcpEl('span', `mcp-dot mcp-dot-${status}`);
  dot.setAttribute('aria-hidden', 'true');
  const titles = mcpEl('div', 'mcp-card-titles');
  const nameRow = mcpEl('div', 'mcp-card-name-row');
  nameRow.append(mcpEl('span', 'mcp-card-name', srv.name), mcpEl('code', 'mcp-slug', `${srv.slug}__*`));
  const meta = mcpEl('div', 'mcp-card-meta');
  const statusEl = mcpEl('span', `mcp-status mcp-status-${status}`, MCP_STATUS_LABEL[status] || status);
  meta.append(statusEl,
    mcpEl('span', null, srv.transport === 'http' ? 'http' : 'stdio'),
    mcpEl('span', null, srv.tool_count == null ? 'tools not fetched yet' : `${srv.tool_count} tool${srv.tool_count === 1 ? '' : 's'}`),
    mcpEl('span', null, srv.default_access === 'all' ? 'all agents by default' : 'granted agents only'));
  if (srv.preset) meta.appendChild(mcpEl('span', null, `preset · ${srv.preset}`));
  titles.append(nameRow, meta);

  const enable = mcpSwitch(!!srv.enabled, srv.enabled ? `Disable ${srv.name}` : `Enable ${srv.name}`, async next => {
    const r = await mcpApi('PATCH', `/api/mcp/servers/${srv.id}`, { enabled: next });
    if (!r.ok) { showToast(`Couldn’t update ${srv.name}: ${r.error}`, { error: true }); return false; }
    Object.assign(srv, r.data?.server || { enabled: next, status: next ? 'idle' : 'disabled' });
    card.replaceWith(mcpMakeServerCard(srv));
    return true;
  });
  head.append(dot, titles, enable);
  card.appendChild(head);

  if (status === 'error' && srv.last_error) card.appendChild(mcpEl('div', 'mcp-card-error', srv.last_error));

  const tr = mcpState.testResults[srv.id];
  if (tr) {
    const line = mcpEl('div', tr.ok ? 'mcp-test-ok' : 'mcp-card-error',
      tr.ok ? `test passed · ${tr.tool_count} tool${tr.tool_count === 1 ? '' : 's'}${tr.tools?.length ? ': ' + tr.tools.slice(0, 6).join(', ') + (tr.tools.length > 6 ? '…' : '') : ''}`
            : `test failed · ${tr.error || 'unknown error'}`);
    line.setAttribute('role', 'status');
    card.appendChild(line);
  }

  const actions = mcpEl('div', 'mcp-card-actions');
  const expanded = mcpState.expanded.has(srv.id);
  const toolsBtn = mcpBtn('mcp-link-btn', expanded ? 'hide tools' : 'tools', () => mcpToggleTools(srv));
  toolsBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  actions.appendChild(toolsBtn);
  actions.appendChild(mcpEl('span', 'mcp-actions-spacer'));

  if (mcpState.confirmRemoveId === srv.id) {
    const q = mcpEl('span', 'mcp-confirm-text', `remove ${srv.name}? agents lose its tools right away.`);
    const yes = mcpBtn('mcp-danger-btn', 'remove', async () => {
      yes.disabled = true;
      const r = await mcpApi('DELETE', `/api/mcp/servers/${srv.id}`);
      if (!r.ok) { showToast(`Couldn’t remove ${srv.name}: ${r.error}`, { error: true }); yes.disabled = false; return; }
      mcpState.servers = mcpState.servers.filter(s => s.id !== srv.id);
      mcpState.confirmRemoveId = null;
      mcpState.expanded.delete(srv.id);
      delete mcpState.tools[srv.id];
      delete mcpState.testResults[srv.id];
      mcpState.access = null;
      mcpRender();
    });
    const no = mcpBtn('auto-small-btn', 'cancel', () => { mcpState.confirmRemoveId = null; card.replaceWith(mcpMakeServerCard(srv)); });
    actions.append(q, yes, no);
  } else {
    const testing = mcpState.testing.has(srv.id);
    const testBtn = mcpBtn('auto-small-btn', testing ? 'testing…' : 'test', () => mcpTestServer(srv));
    testBtn.disabled = testing || !srv.enabled;
    if (!srv.enabled) testBtn.title = 'Enable the server to test it';
    const editBtn = mcpBtn('s-icon-btn', null, () => mcpOpenEdit(srv), `Edit ${srv.name}`);
    editBtn.innerHTML = svgPencil(13);
    editBtn.setAttribute('aria-label', `Edit ${srv.name}`);
    const rmBtn = mcpBtn('s-icon-btn', null, () => { mcpState.confirmRemoveId = srv.id; card.replaceWith(mcpMakeServerCard(srv)); }, `Remove ${srv.name}`);
    rmBtn.innerHTML = autoSvgTrash(13);
    rmBtn.setAttribute('aria-label', `Remove ${srv.name}`);
    actions.append(testBtn, editBtn, rmBtn);
  }
  card.appendChild(actions);

  if (expanded) card.appendChild(mcpMakeToolList(srv));
  return card;
}

async function mcpTestServer(srv) {
  mcpState.testing.add(srv.id);
  delete mcpState.testResults[srv.id];
  mcpRerenderCard(srv);
  const r = await mcpApi('POST', `/api/mcp/servers/${srv.id}/test`);
  mcpState.testing.delete(srv.id);
  mcpState.testResults[srv.id] = r.ok ? r.data : { ok: false, error: r.error };
  if (r.ok && r.data?.ok) {
    srv.tool_count = r.data.tool_count;
    delete mcpState.tools[srv.id];
  }
  mcpRerenderCard(srv);
}

function mcpRerenderCard(srv) {
  const card = document.querySelector(`.mcp-card[data-server-id="${srv.id}"]`);
  if (card) card.replaceWith(mcpMakeServerCard(srv));
}

async function mcpToggleTools(srv) {
  if (mcpState.expanded.has(srv.id)) {
    mcpState.expanded.delete(srv.id);
  } else {
    mcpState.expanded.add(srv.id);
    if (!mcpState.tools[srv.id]) {
      mcpState.tools[srv.id] = { loading: true, list: [] };
      mcpRerenderCard(srv);
      const r = await mcpApi('GET', `/api/mcp/servers/${srv.id}/tools`);
      mcpState.tools[srv.id] = r.ok ? { list: Array.isArray(r.data?.tools) ? r.data.tools : [] } : { error: r.error, list: [] };
    }
  }
  mcpRerenderCard(srv);
}

function mcpMakeToolList(srv) {
  const wrap = mcpEl('div', 'mcp-tools');
  const t = mcpState.tools[srv.id];
  if (!t || t.loading) { wrap.appendChild(mcpEl('div', 'mcp-muted', 'loading tools…')); return wrap; }
  if (t.error) {
    wrap.appendChild(mcpEl('div', 'mcp-card-error', `couldn’t list tools · ${t.error}`));
    wrap.appendChild(mcpBtn('auto-small-btn', 'retry', () => { delete mcpState.tools[srv.id]; mcpState.expanded.delete(srv.id); mcpToggleTools(srv); }));
    return wrap;
  }
  if (!t.list.length) {
    wrap.appendChild(mcpEl('div', 'mcp-muted', srv.enabled ? 'no tools reported yet — run test to start the server and fetch them.' : 'enable and test the server to fetch its tools.'));
    return wrap;
  }
  const head = mcpEl('div', 'mcp-tool-row mcp-tool-head');
  head.append(mcpEl('span', null, 'tool'), mcpEl('span', null, 'on'), mcpEl('span', null, 'approval'));
  head.setAttribute('aria-hidden', 'true');
  wrap.appendChild(head);
  t.list.forEach(tool => {
    const row = mcpEl('div', 'mcp-tool-row');
    const info = mcpEl('div', 'mcp-tool-info');
    const nameLine = mcpEl('div', 'mcp-tool-name-line');
    nameLine.appendChild(mcpEl('code', 'mcp-tool-name', tool.name));
    if (tool.write_hint) {
      const badge = mcpEl('span', 'mcp-badge-write', 'write');
      badge.title = 'Looks like this tool changes data (send / create / update / delete)';
      nameLine.appendChild(badge);
    }
    info.appendChild(nameLine);
    if (tool.description) {
      const d = mcpEl('div', 'mcp-tool-desc', tool.description);
      d.title = tool.description;
      info.appendChild(d);
    }
    const setTool = field => async next => {
      const r = await mcpApi('PUT', `/api/mcp/servers/${srv.id}/tools/${encodeURIComponent(tool.name)}`, { [field]: next });
      if (!r.ok) { showToast(`Couldn’t update ${tool.name}: ${r.error}`, { error: true }); return false; }
      tool[field] = next;
      return true;
    };
    const on = mcpSwitch(tool.enabled !== false, `${tool.name} enabled`, setTool('enabled'));
    const appr = mcpSwitch(!!tool.requires_approval, `${tool.name} requires approval`, setTool('requires_approval'));
    appr.title = 'Requires approval — saved now, approval prompts arrive in a later update';
    row.append(info, on, appr);
    wrap.appendChild(row);
  });
  return wrap;
}
