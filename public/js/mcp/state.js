// ── MCP tab: state, API, shell ───────────────────────────────────────────────
const MCP_TABS = [
  { id: 'installed', label: 'installed' },
  { id: 'add', label: 'add' },
  { id: 'access', label: 'access' },
  { id: 'activity', label: 'activity' },
];
const MCP_SLUG_RE = /^[a-z][a-z0-9_]*$/;

let mcpState = {
  loaded: false,
  loadError: null,
  tab: 'installed',
  catalog: [],
  servers: [],
  tools: {},
  expanded: new Set(),
  testing: new Set(),
  testResults: {},
  oauthPending: new Set(),
  confirmRemoveId: null,
  form: null,
  addMode: 'catalog',
  access: null,
  calls: [],
  callsNext: null,
  callsLoaded: false,
  callsError: null,
  callsFilter: { server_id: '', actor_id: '' },
  openCallId: null,
  activityView: 'calls',
  approvals: null,
  approvalsFilter: '',
  oauthReturn: null,
};

async function mcpApi(method, url, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  let r;
  try { r = await fetch(url, opts); } catch { return { ok: false, error: 'Network error' }; }
  if (r.status === 401) { showLogin(); return { ok: false, error: 'unauthorized' }; }
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) return { ok: false, status: r.status, data, error: (data && data.error) || `${r.status} ${r.statusText}` };
  return { ok: true, data };
}

function mcpEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function mcpBtn(cls, text, onClick, title) {
  const b = mcpEl('button', cls, text);
  b.type = 'button';
  if (title) b.title = title;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function mcpSwitch(checked, label, onToggle) {
  const b = mcpEl('button', 'mcp-switch');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', checked ? 'true' : 'false');
  b.setAttribute('aria-label', label);
  b.title = label;
  b.appendChild(mcpEl('span', 'mcp-switch-knob'));
  b.addEventListener('click', async () => {
    if (b.disabled) return;
    const next = b.getAttribute('aria-checked') !== 'true';
    b.disabled = true;
    b.setAttribute('aria-checked', next ? 'true' : 'false');
    const ok = await onToggle(next);
    if (!ok) b.setAttribute('aria-checked', next ? 'false' : 'true');
    b.disabled = false;
  });
  return b;
}

function mcpEmpty(title, body, action) {
  const box = mcpEl('div', 'mcp-empty');
  box.appendChild(mcpEl('div', 'mcp-empty-title', title));
  if (body) box.appendChild(mcpEl('div', 'mcp-empty-body', body));
  if (action) box.appendChild(action);
  return box;
}

function mcpServerById(id) {
  return mcpState.servers.find(s => s.id === id) || null;
}

function mcpTsMs(ts) {
  if (!ts) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : ts.replace(' ', 'T') + 'Z');
}

function mcpLocalTime(ts) {
  if (!ts) return '';
  const d = new Date(mcpTsMs(ts));
  if (isNaN(d)) return ts;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function mcpLoadServers() {
  const r = await mcpApi('GET', '/api/mcp/servers');
  if (!r.ok) { mcpState.loadError = r.error; return false; }
  mcpState.loadError = null;
  mcpState.servers = Array.isArray(r.data?.servers) ? r.data.servers : [];
  return true;
}

async function mcpLoadCatalog() {
  const r = await mcpApi('GET', '/api/mcp/catalog');
  if (r.ok) mcpState.catalog = Array.isArray(r.data?.presets) ? r.data.presets : [];
}

async function sLoadMcpTab() {
  if (!mcpState.loaded) {
    const [ok] = await Promise.all([mcpLoadServers(), mcpLoadCatalog()]);
    mcpState.loaded = ok;
  }
  mcpRender();
  if (mcpState.loaded) mcpFlushOAuthReturn();
}

// The OAuth callback lands on /?mcp_oauth=connected|error&server_id=N[&reason=…] (in the tab opened by connect).
function mcpConsumeOAuthReturn() {
  const q = new URLSearchParams(location.search);
  const result = q.get('mcp_oauth');
  if (result !== 'connected' && result !== 'error') return false;
  const id = /^\d{1,15}$/.test(q.get('server_id') || '') ? Number(q.get('server_id')) : null;
  mcpState.oauthReturn = { ok: result === 'connected', serverId: id, reason: (q.get('reason') || '').slice(0, 200) };
  ['mcp_oauth', 'server_id', 'reason'].forEach(k => q.delete(k));
  history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : '') + location.hash);
  mcpState.tab = 'installed';
  openSettingsTab('mcp');
  return true;
}

function mcpFlushOAuthReturn() {
  const ret = mcpState.oauthReturn;
  if (!ret) return;
  mcpState.oauthReturn = null;
  const name = mcpServerById(ret.serverId)?.name || 'MCP server';
  if (ret.ok) showToast(`${name} connected`);
  else showToast(`Couldn’t connect ${name}: ${ret.reason || 'sign-in failed'}`, { error: true, duration: 8000 });
  document.querySelector(`.mcp-card[data-server-id="${ret.serverId}"]`)?.scrollIntoView({ block: 'center' });
}

function mcpSetTab(tab) {
  mcpState.tab = tab;
  mcpRender();
}

function mcpRender() {
  const host = document.getElementById('s-tab-mcp');
  if (!host) return;
  const scrollY = host.scrollTop;
  const inner = mcpEl('div', 's-content-inner mcp-root');

  const intro = mcpEl('p', 'mcp-intro', 'MCP servers give agents hands: tools they can call through one Stoa gateway. Credentials stay on this server, and every call is logged.');
  inner.appendChild(intro);

  const bar = mcpEl('div', 'mcp-tabbar');
  bar.setAttribute('role', 'tablist');
  MCP_TABS.forEach(t => {
    const b = mcpBtn('mcp-tabbtn', t.label, () => mcpSetTab(t.id));
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', mcpState.tab === t.id ? 'true' : 'false');
    if (t.id === 'installed' && mcpState.servers.length) b.appendChild(mcpEl('span', 'mcp-tabcount', String(mcpState.servers.length)));
    bar.appendChild(b);
  });
  inner.appendChild(bar);

  const panel = mcpEl('div', 'mcp-panel');
  panel.setAttribute('role', 'tabpanel');
  if (mcpState.tab === 'installed') mcpRenderInstalled(panel);
  else if (mcpState.tab === 'add') mcpRenderAdd(panel);
  else if (mcpState.tab === 'access') mcpRenderAccess(panel);
  else if (mcpState.tab === 'activity') mcpRenderActivity(panel);
  inner.appendChild(panel);

  host.replaceChildren(inner);
  host.scrollTop = scrollY;
}

function mcpIsVisible() {
  return settingsOpen && document.getElementById('s-tab-mcp')?.style.display !== 'none';
}

function mcpHandleStatus(msg) {
  const srv = mcpServerById(msg.server_id);
  if (!srv) {
    if (mcpState.loaded && mcpIsVisible()) mcpLoadServers().then(ok => { if (ok) mcpRender(); });
    return;
  }
  srv.status = msg.status;
  srv.last_error = msg.last_error || null;
  if (msg.status !== 'needs_auth') mcpState.oauthPending.delete(srv.id);
  if (!mcpIsVisible() || mcpState.tab !== 'installed') return;
  const card = document.querySelector(`.mcp-card[data-server-id="${srv.id}"]`);
  if (card) card.replaceWith(mcpMakeServerCard(srv));
}

function mcpInvalidate() {
  mcpState.loaded = false;
  mcpState.access = null;
  mcpState.callsLoaded = false;
  mcpState.approvals = null;
  if (mcpIsVisible()) sLoadMcpTab();
}

function mcpOpenAccess() {
  mcpState.tab = 'access';
  mcpState.access = null;
  openSettingsTab('mcp');
}
