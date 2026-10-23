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

const MCP_ICON_HEX_RE = /^[0-9a-f]{6}$/i;
const MCP_ICON_PATH_RE = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]{1,20000}$/;

// Relative luminance of a #rrggbb brand colour; near-black marks (GitHub, Notion) switch to the theme ink.
function mcpHexLuminance(hex) {
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mcpInitialsOf(name) {
  const words = String(name || '').trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const text = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2);
  return text.toUpperCase();
}

// icon: catalog contract from lib/mcp-icons.js — {kind:'svg', hex, path, title} | {kind:'initials', hex, text, title} | null.
// Anything missing or malformed falls back to neutral initials of the name.
function mcpMakeIcon(icon, name, size = 'md') {
  const tile = mcpEl('span', `mcp-icon mcp-icon-${size}`);
  tile.setAttribute('aria-hidden', 'true');
  const hex = icon && MCP_ICON_HEX_RE.test(icon.hex || '') ? icon.hex : null;
  if (hex) tile.style.setProperty('--mcp-brand', `#${hex}`);
  if (icon?.kind === 'svg' && hex && MCP_ICON_PATH_RE.test(icon.path || '')) {
    tile.classList.add('mcp-icon-brand');
    if (mcpHexLuminance(hex) < 0.05) tile.classList.add('mcp-icon-ink');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', icon.path);
    svg.appendChild(path);
    tile.appendChild(svg);
    return tile;
  }
  const custom = icon?.kind === 'initials' && typeof icon.text === 'string' && icon.text.trim();
  tile.classList.add(hex ? 'mcp-icon-initials' : 'mcp-icon-plain');
  tile.textContent = custom ? icon.text.trim().slice(0, 2).toUpperCase() : mcpInitialsOf(name);
  return tile;
}

function mcpIconForServer(srv) {
  return srv.preset ? mcpState.catalog.find(p => p.id === srv.preset)?.icon || null : null;
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

// Chat tool steps name the gateway server, often before the MCP tab was ever opened; kept apart from
// mcpState.servers so a background fetch never desyncs a rendered MCP tab.
const mcpChatNames = new Map();
const mcpChatSlugMisses = new Set();
let mcpChatNamesReq = null;

function mcpViaText(name) {
  return `via ${name} (Stoa)`;
}

function mcpServerNameBySlug(slug) {
  const s = mcpState.servers.find(x => x.slug === slug);
  if (s) return s.name || slug;
  if (mcpChatNames.has(slug)) return mcpChatNames.get(slug);
  if (!mcpChatSlugMisses.has(slug)) {
    mcpChatSlugMisses.add(slug);
    mcpRefreshChatNames();
  }
  return slug;
}

function mcpRefreshChatNames() {
  if (mcpChatNamesReq) return;
  // Plain fetch, not mcpApi: a passive label must never pop the login overlay on a 401.
  mcpChatNamesReq = fetch('/api/mcp/servers').then(r => (r.ok ? r.json() : null)).catch(() => null).then(data => {
    mcpChatNamesReq = null;
    if (!Array.isArray(data?.servers)) return;
    for (const s of data.servers) if (s?.slug && s.name) mcpChatNames.set(s.slug, s.name);
    document.querySelectorAll('.h-process-via[data-mcp-slug]').forEach(el => {
      const name = mcpChatNames.get(el.dataset.mcpSlug);
      if (name) el.textContent = mcpViaText(name);
    });
  });
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
  mcpRenderDialog();
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
