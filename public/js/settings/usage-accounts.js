// Settings — usage › Accounts & Limits: which Claude / Codex account each machine is signed in to,
// plus plan limit windows. Data comes from GET /api/usage/accounts; agents report it, the server only stores it.
const UA_SUB_KEY = 'stoa-usage-sub';
const UA_HARNESSES = [
  { id: 'claude', label: 'Claude', login: 'claude login' },
  { id: 'codex', label: 'Codex', login: 'codex login' },
];
const UA_PLATFORMS = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };
const UA_AUTH_METHODS = { 'claude.ai': 'Claude.ai sign-in', chatgpt: 'ChatGPT sign-in', api_key: 'API key', apikey: 'API key' };
const UA_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UA_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let usageSub = (() => { try { return localStorage.getItem(UA_SUB_KEY) === 'accounts' ? 'accounts' : 'overview'; } catch { return 'overview'; } })();

const uaState = {
  data: null,
  loading: false,
  error: null,
  refreshingAll: false,
  refreshing: new Set(),
  seq: 0,
  applied: 0,
  reloadTimer: null,
  pollTimer: null,
  tickTimer: null,
};

function uaEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function uaIsVisible() {
  return settingsOpen && usageSub === 'accounts' && document.getElementById('s-tab-usage')?.style.display !== 'none';
}

// ── Sub-tabs ─────────────────────────────────────────────────────────────────
function usageApplySubtab() {
  document.querySelectorAll('.usage-subtab[data-usage-sub]').forEach(b => {
    const on = b.dataset.usageSub === usageSub;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  });
  const overview = document.getElementById('usage-panel');
  const accounts = document.getElementById('usage-accounts-panel');
  if (overview) overview.hidden = usageSub !== 'overview';
  if (accounts) accounts.hidden = usageSub !== 'accounts';
}

function usageSetSub(sub) {
  if (sub !== 'overview' && sub !== 'accounts') return;
  usageSub = sub;
  try { localStorage.setItem(UA_SUB_KEY, sub); } catch {}
  sLoadUsageTab();
}

document.addEventListener('click', e => {
  const b = e.target.closest?.('.usage-subtab[data-usage-sub]');
  if (b) usageSetSub(b.dataset.usageSub);
});
document.addEventListener('keydown', e => {
  const b = e.target.closest?.('.usage-subtab[data-usage-sub]');
  if (!b || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  e.preventDefault();
  const next = b.dataset.usageSub === 'overview' ? 'accounts' : 'overview';
  usageSetSub(next);
  document.querySelector(`.usage-subtab[data-usage-sub="${next}"]`)?.focus();
});

// ── Data ─────────────────────────────────────────────────────────────────────
async function uaFetch(method, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const url = method === 'GET' ? '/api/usage/accounts' : '/api/usage/accounts/refresh';
  let r;
  try { r = await fetch(url, opts); } catch { return { ok: false, error: 'Network error' }; }
  if (r.status === 401) { showLogin(); return { ok: false, error: 'unauthorized' }; }
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) return { ok: false, error: (data && data.error) || `${r.status} ${r.statusText}` };
  if (!data || !Array.isArray(data.machines)) return { ok: false, error: 'Unexpected response' };
  return { ok: true, data };
}

// Responses can land out of order (a live-update GET racing a refresh POST); only the newest wins.
function uaApply(seq, data) {
  if (seq < uaState.applied) return false;
  uaState.applied = seq;
  uaState.data = data;
  uaState.error = null;
  uaSchedulePoll();
  return true;
}

// A probe the server started on its own (agent connect, periodic) ends in harness_accounts_updated, but one
// that times out sends nothing; while any machine shows refreshing, re-read until it clears.
function uaSchedulePoll() {
  clearTimeout(uaState.pollTimer);
  uaState.pollTimer = null;
  if (!uaState.data.machines.some(m => m.refreshing === true)) return;
  uaState.pollTimer = setTimeout(() => { if (uaIsVisible()) uaLoad(); }, 5000);
}

async function uaLoad() {
  const seq = ++uaState.seq;
  uaState.loading = !uaState.data;
  if (uaState.loading) uaRender();
  const res = await uaFetch('GET');
  uaState.loading = false;
  if (res.ok) uaApply(seq, res.data);
  else if (seq >= uaState.applied) uaState.error = res.error;
  if (uaIsVisible()) uaRender();
}

async function uaRefresh(machineId) {
  if (uaState.refreshingAll || (machineId && uaState.refreshing.has(machineId))) return;
  if (machineId) uaState.refreshing.add(machineId);
  else uaState.refreshingAll = true;
  uaRender();
  const res = await uaFetch('POST', machineId ? { machine_id: machineId } : {});
  if (machineId) uaState.refreshing.delete(machineId);
  else uaState.refreshingAll = false;
  if (res.ok) uaApply(++uaState.seq, res.data);
  else if (res.error !== 'unauthorized') showToast(`Couldn’t refresh: ${res.error}`, { error: true });
  if (uaIsVisible()) uaRender();
}

function uaScheduleReload() {
  clearTimeout(uaState.reloadTimer);
  uaState.reloadTimer = setTimeout(() => { if (uaIsVisible()) uaLoad(); }, 250);
}

// WS: a machine reported a fresh snapshot. Off-screen, the next open of the tab refetches anyway.
function uaHandleUpdated() {
  if (uaIsVisible()) uaScheduleReload();
}

function uaHandleActorStatus(actor) {
  if (!actor || !uaIsVisible() || !uaState.data) return;
  const known = uaState.data.machines.some(m => (m.agents || []).some(a => a.actor_id === actor.id));
  if (known) uaScheduleReload();
}

// ── Formatting ───────────────────────────────────────────────────────────────
function uaDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

function uaClock(d) { return _pad(d.getHours()) + ':' + _pad(d.getMinutes()); }

function uaSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function uaAgo(iso) {
  const d = uaDate(iso);
  if (!d) return 'never';
  const mins = Math.floor((Date.now() - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} d ago`;
  return `${d.getDate()} ${UA_MONTHS[d.getMonth()]}`;
}

function uaWhen(d) {
  const now = new Date();
  if (uaSameDay(d, now)) return uaClock(d);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (uaSameDay(d, tomorrow)) return 'tomorrow ' + uaClock(d);
  return `${UA_DAYS[d.getDay()]} ${d.getDate()} ${UA_MONTHS[d.getMonth()]} ${uaClock(d)}`;
}

function uaResets(iso) {
  const d = uaDate(iso);
  if (!d) return 'Reset time unknown';
  const mins = Math.round((d - Date.now()) / 60000);
  if (mins <= 0) return `Reset at ${uaWhen(d)} · refresh for current`;
  const days = Math.floor(mins / 1440), hrs = Math.floor((mins % 1440) / 60), m = mins % 60;
  const span = days ? `${days}d ${hrs}h` : hrs ? `${hrs}h ${m}m` : `${m}m`;
  return `Resets in ${span} · ${uaWhen(d)}`;
}

function uaRetryNote(iso) {
  const d = uaDate(iso);
  return d && d > Date.now() ? `Usage endpoint rate-limited · next check after ${uaWhen(d)}` : '';
}

function uaRelText(kind, iso) {
  return kind === 'resets' ? uaResets(iso) : kind === 'retry' ? uaRetryNote(iso) : uaAgo(iso);
}

function uaPct(n) {
  const v = Math.max(0, Math.min(100, Number(n) || 0));
  return v < 10 && v % 1 ? v.toFixed(1) : String(Math.round(v));
}

function uaTone(pct) { return pct >= 90 ? 'crit' : pct >= 70 ? 'warm' : 'calm'; }

function uaPlan(plan) {
  const s = String(plan || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function uaPlural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

// Relative labels re-render in place every 30s while the tab is open.
function uaRel(cls, kind, iso) {
  const el = uaEl('span', cls, uaRelText(kind, iso));
  el.dataset.uaRel = kind;
  el.dataset.uaTs = iso || '';
  return el;
}

function uaTick() {
  if (!uaIsVisible()) { clearInterval(uaState.tickTimer); uaState.tickTimer = null; return; }
  document.querySelectorAll('#usage-accounts-panel [data-ua-rel]').forEach(el => {
    const iso = el.dataset.uaTs || null;
    const prefix = el.dataset.uaPrefix || '';
    const text = uaRelText(el.dataset.uaRel, iso);
    el.textContent = text ? prefix + text : '';
    el.hidden = !text;
  });
}

// ── Derived views ────────────────────────────────────────────────────────────
function uaHarness(machine, id) {
  return machine.harnesses ? machine.harnesses[id] : null;
}

function uaTightest(machines) {
  let best = null;
  machines.forEach(m => UA_HARNESSES.forEach(h => {
    const acc = uaHarness(m, h.id);
    if (!acc || acc.limits_status !== 'ok' || !Array.isArray(acc.limits)) return;
    acc.limits.forEach(l => {
      const pct = Number(l.used_pct);
      if (!isFinite(pct)) return;
      if (!best || pct > best.pct) best = { pct, harness: h.label, label: l.label || l.key, resets_at: l.resets_at, host: m.hostname };
    });
  }));
  return best;
}

function uaLatestProbe(machines) {
  let latest = null;
  machines.forEach(m => {
    const d = uaDate(m.probed_at);
    if (d && (!latest || d > uaDate(latest))) latest = m.probed_at;
  });
  return latest;
}

function uaAccountsByEmail(machines, id) {
  const map = new Map();
  machines.forEach(m => {
    const acc = uaHarness(m, id);
    const email = acc && acc.logged_in !== false ? acc.account?.email : null;
    if (!email) return;
    const key = email.toLowerCase();
    if (!map.has(key)) map.set(key, { email, hosts: [] });
    map.get(key).hosts.push(m.hostname || m.machine_id);
  });
  return map;
}

// ── Render ───────────────────────────────────────────────────────────────────
function uaRender() {
  const host = document.getElementById('usage-accounts-panel');
  if (!host) return;
  const frag = document.createDocumentFragment();
  const d = uaState.data;
  if (!d) {
    if (uaState.error) frag.appendChild(uaRenderError());
    else frag.appendChild(uaEl('div', 'ua-muted', 'Loading accounts…'));
    host.replaceChildren(frag);
    return;
  }
  const machines = [...d.machines].sort((a, b) =>
    (b.online ? 1 : 0) - (a.online ? 1 : 0) || String(a.hostname || '').localeCompare(String(b.hostname || '')));
  frag.appendChild(uaRenderHeader(d, machines));
  if (uaState.error) frag.appendChild(uaEl('p', 'ua-inline-error', `Couldn’t reload: ${uaState.error}. Showing the last result.`));
  if (!machines.length) {
    frag.appendChild(uaRenderEmpty());
  } else {
    const notice = uaRenderMismatch(d, machines);
    if (notice) frag.appendChild(notice);
    const list = uaEl('div', 'ua-machines');
    machines.forEach(m => list.appendChild(uaRenderMachine(m)));
    frag.appendChild(list);
  }
  host.replaceChildren(frag);
  if (!uaState.tickTimer) uaState.tickTimer = setInterval(uaTick, 30000);
}

function uaRenderError() {
  const box = uaEl('div', 'ua-empty');
  box.appendChild(uaEl('div', 'ua-empty-title', 'Couldn’t load accounts'));
  box.appendChild(uaEl('p', 'ua-empty-body', uaState.error));
  const retry = uaEl('button', 'h-btn-secondary', 'Try again');
  retry.type = 'button';
  retry.addEventListener('click', () => { uaState.error = null; uaLoad(); });
  box.appendChild(retry);
  return box;
}

function uaRefreshIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ua-refresh-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'].forEach(d => {
    const n = document.createElementNS(NS, 'path');
    n.setAttribute('d', d);
    svg.appendChild(n);
  });
  return svg;
}

function uaRefreshButton(label, busy, disabled, onClick, ariaLabel) {
  const b = uaEl('button', 'ua-refresh');
  b.type = 'button';
  b.appendChild(uaRefreshIcon());
  if (label) b.appendChild(uaEl('span', 'ua-refresh-label', busy ? 'Checking…' : label));
  if (ariaLabel) b.setAttribute('aria-label', busy ? 'Checking…' : ariaLabel);
  b.classList.toggle('is-busy', busy);
  b.setAttribute('aria-busy', busy ? 'true' : 'false');
  b.disabled = busy || disabled;
  b.addEventListener('click', onClick);
  return b;
}

function uaRenderHeader(d, machines) {
  const head = uaEl('header', 'ua-head');
  const text = uaEl('div', 'ua-head-text');
  const accounts = d.accounts || {};
  const parts = [uaPlural(machines.length, 'machine', 'machines')];
  UA_HARNESSES.forEach(h => {
    const n = Array.isArray(accounts[h.id]) ? accounts[h.id].length : 0;
    if (n) parts.push(`${h.label}: ${uaPlural(n, 'account', 'accounts')}`);
  });
  text.appendChild(uaEl('h2', 'ua-title', machines.length ? parts.join(' · ') : 'No machines yet'));

  const tight = uaTightest(machines);
  if (tight) {
    const line = uaEl('p', 'ua-tightest');
    line.appendChild(uaEl('span', 'ua-tightest-kicker', 'Tightest limit'));
    const where = machines.length > 1 && tight.host ? ` on ${tight.host}` : '';
    const what = uaEl('span', 'ua-tightest-what', `${tight.harness} · ${tight.label}${where}`);
    line.appendChild(what);
    line.appendChild(uaEl('span', `ua-tightest-pct ua-tone-${uaTone(tight.pct)}`, uaPct(tight.pct) + '%'));
    const resets = uaRel('ua-tightest-reset', 'resets', tight.resets_at);
    line.appendChild(resets);
    text.appendChild(line);
  }
  head.appendChild(text);

  const side = uaEl('div', 'ua-head-side');
  const latest = uaLatestProbe(machines);
  if (latest) {
    const checked = uaRel('ua-checked', 'ago', latest);
    checked.dataset.uaPrefix = 'Last checked ';
    checked.textContent = 'Last checked ' + checked.textContent;
    side.appendChild(checked);
  }
  const anyOnline = machines.some(m => m.online);
  const btn = uaRefreshButton('Refresh all', uaState.refreshingAll, machines.length > 0 && !anyOnline, () => uaRefresh());
  if (machines.length && !anyOnline) btn.title = 'No agent is online to check';
  side.appendChild(btn);
  head.appendChild(side);
  return head;
}

function uaRenderEmpty() {
  const box = uaEl('div', 'ua-empty');
  box.appendChild(uaEl('div', 'ua-empty-title', 'No accounts reported yet'));
  box.appendChild(uaEl('p', 'ua-empty-body',
    'Each machine reports which Claude and Codex accounts it is signed in to, and how much of the plan limits is used, when one of its agents connects. Nothing here yet means no agent with an up-to-date Stoa client has checked in.'));
  return box;
}

function uaRenderMismatch(d, machines) {
  const flagged = UA_HARNESSES.filter(h => d.mismatch && d.mismatch[h.id]);
  if (!flagged.length) return null;
  const box = uaEl('section', 'ua-notice');
  box.setAttribute('role', 'note');
  box.appendChild(uaEl('div', 'ua-notice-title', 'Machines are signed in to different accounts'));
  box.appendChild(uaEl('p', 'ua-notice-body', 'Limits are tracked per account, so agents on these machines draw from separate quotas.'));
  flagged.forEach(h => {
    const group = uaEl('div', 'ua-notice-group');
    group.appendChild(uaEl('div', 'ua-notice-harness', h.label));
    const list = uaEl('ul', 'ua-notice-list');
    uaAccountsByEmail(machines, h.id).forEach(({ email, hosts }) => {
      const li = uaEl('li');
      li.appendChild(uaEl('span', 'ua-notice-email', email));
      li.appendChild(uaEl('span', 'ua-notice-hosts', hosts.join(', ')));
      list.appendChild(li);
    });
    group.appendChild(list);
    box.appendChild(group);
  });
  return box;
}

function uaRenderMachine(m) {
  const busy = m.refreshing === true || uaState.refreshing.has(m.machine_id) || (uaState.refreshingAll && m.online);
  const card = uaEl('article', 'ua-machine' + (m.online ? '' : ' is-offline') + (busy ? ' is-busy' : ''));
  card.dataset.machineId = m.machine_id;
  const host = m.hostname || 'Unknown machine';
  card.setAttribute('aria-label', host);

  const head = uaEl('header', 'ua-machine-head');
  const ident = uaEl('div', 'ua-machine-ident');
  ident.appendChild(uaEl('h3', 'ua-machine-name', host));
  const meta = uaEl('div', 'ua-machine-meta');
  const platform = UA_PLATFORMS[m.platform] || m.platform;
  if (platform) meta.appendChild(uaEl('span', 'ua-machine-platform', platform));
  const status = uaEl('span', 'ua-status' + (m.online ? ' is-online' : ''));
  status.appendChild(uaEl('span', 'ua-dot'));
  status.appendChild(uaEl('span', null, m.online ? 'Online' : 'Offline'));
  meta.appendChild(status);
  if (busy) {
    meta.appendChild(uaEl('span', 'ua-machine-checked', 'Checking…'));
  } else if (m.probed_at) {
    const checked = uaRel('ua-machine-checked', 'ago', m.probed_at);
    checked.dataset.uaPrefix = m.online ? 'checked ' : 'last report ';
    checked.textContent = checked.dataset.uaPrefix + checked.textContent;
    meta.appendChild(checked);
  }
  ident.appendChild(meta);
  head.appendChild(ident);
  const btn = uaRefreshButton(null, busy, !m.online, () => uaRefresh(m.machine_id), `Refresh ${host}`);
  btn.classList.add('ua-refresh--icon');
  btn.title = m.online ? `Check ${host} now` : 'No agent is online on this machine';
  head.appendChild(btn);
  card.appendChild(head);

  const grid = uaEl('div', 'ua-harnesses');
  UA_HARNESSES.forEach(h => grid.appendChild(uaRenderHarness(h, uaHarness(m, h.id), m.probed_at)));
  card.appendChild(grid);

  const agents = Array.isArray(m.agents) ? m.agents : [];
  if (agents.length) card.appendChild(uaRenderAgents(agents));
  return card;
}

// Limits checked before the snapshot itself = the server kept the last good numbers through a failed check.
function uaLimitsCarried(acc, probedAt) {
  const checked = uaDate(acc.limits_checked_at), probed = uaDate(probedAt);
  return !!(checked && probed && probed - checked > 60000);
}

function uaRenderHarness(h, acc, probedAt) {
  const panel = uaEl('section', 'ua-harness');
  panel.setAttribute('aria-label', h.label);
  const top = uaEl('div', 'ua-harness-top');
  top.appendChild(uaEl('span', 'ua-harness-name', h.label));
  if (acc && acc.installed !== false && acc.version) top.appendChild(uaEl('span', 'ua-harness-version', 'v' + String(acc.version).replace(/^v/, '')));
  const plan = acc && acc.logged_in ? uaPlan(acc.account?.plan) : '';
  if (plan) top.appendChild(uaEl('span', 'ua-plan', plan));
  panel.appendChild(top);

  if (!acc || acc.installed === false) {
    panel.classList.add('is-quiet');
    panel.appendChild(uaEl('p', 'ua-state', 'Not installed'));
    return panel;
  }
  if (!acc.logged_in) {
    panel.classList.add('is-quiet');
    panel.appendChild(uaEl('p', 'ua-state', 'Not logged in'));
    const hint = uaEl('p', 'ua-hint');
    hint.appendChild(document.createTextNode('Run '));
    hint.appendChild(uaEl('code', null, h.login));
    hint.appendChild(document.createTextNode(' on this machine.'));
    panel.appendChild(hint);
    return panel;
  }

  const a = acc.account || {};
  const who = uaEl('div', 'ua-account');
  who.appendChild(uaEl('div', 'ua-email', a.email || 'Signed in'));
  const sub = [a.org_name, UA_AUTH_METHODS[a.auth_method] || a.auth_method].filter(Boolean);
  if (sub.length) who.appendChild(uaEl('div', 'ua-account-sub', sub.join(' · ')));
  panel.appendChild(who);

  const limits = Array.isArray(acc.limits) ? acc.limits : [];
  const status = acc.limits_status;
  if (status === 'not_applicable') {
    panel.appendChild(uaEl('p', 'ua-state', 'API key login — no plan limits'));
  } else if (status === 'token_expired') {
    const note = uaEl('p', 'ua-hint ua-hint--warn', 'Token expired — run any task on an agent here, or type /reauth in its room.');
    panel.appendChild(note);
  } else if (status !== 'ok') {
    panel.appendChild(uaEl('p', 'ua-state', 'Limits unavailable'));
    if (acc.error) panel.appendChild(uaEl('p', 'ua-hint', acc.error));
  } else if (!limits.length) {
    panel.appendChild(uaEl('p', 'ua-state', 'No limit windows reported'));
  }
  const carried = status === 'ok' && uaLimitsCarried(acc, probedAt);
  if (limits.length && status === 'ok') {
    const list = uaEl('div', 'ua-meters' + (carried ? ' is-stale' : ''));
    limits.forEach(l => list.appendChild(uaRenderMeter(l)));
    panel.appendChild(list);
  }
  if (carried) {
    const asOf = uaRel('ua-asof', 'ago', acc.limits_checked_at);
    asOf.dataset.uaPrefix = 'Last known values · as of ';
    asOf.textContent = asOf.dataset.uaPrefix + asOf.textContent;
    if (acc.error) asOf.title = acc.error;
    panel.appendChild(asOf);
  }
  const retry = uaRel('ua-asof', 'retry', acc.retry_at);
  if (retry.textContent) panel.appendChild(retry);
  const balance = acc.credits && acc.credits.enabled ? acc.credits.balance : null;
  if (balance !== null && balance !== undefined && balance !== '') {
    const credits = uaEl('div', 'ua-credits');
    credits.appendChild(uaEl('span', 'ua-credits-label', 'Credits'));
    credits.appendChild(uaEl('span', 'ua-credits-value', String(balance)));
    panel.appendChild(credits);
  }
  return panel;
}

function uaRenderMeter(l) {
  const pct = Math.max(0, Math.min(100, Number(l.used_pct) || 0));
  const label = l.label || l.key || 'Limit';
  const row = uaEl('div', `ua-meter ua-tone-${uaTone(pct)}`);
  const line = uaEl('div', 'ua-meter-line');
  line.appendChild(uaEl('span', 'ua-meter-label', label));
  line.appendChild(uaEl('span', 'ua-meter-pct', uaPct(pct) + '%'));
  row.appendChild(line);
  const track = uaEl('div', 'ua-meter-track');
  track.setAttribute('role', 'meter');
  track.setAttribute('aria-label', `${label} used`);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', String(Math.round(pct)));
  const fill = uaEl('div', 'ua-meter-fill');
  fill.style.width = pct + '%';
  track.appendChild(fill);
  row.appendChild(track);
  row.appendChild(uaRel('ua-meter-reset', 'resets', l.resets_at));
  return row;
}

function uaRenderAgents(agents) {
  const wrap = uaEl('div', 'ua-agents');
  const cap = uaEl('div', 'ua-agents-cap');
  cap.appendChild(uaEl('span', null, 'Agents on this machine'));
  cap.appendChild(uaEl('span', 'ua-agents-cols', 'tokens 7d · turns 7d'));
  wrap.appendChild(cap);
  const list = uaEl('ul', 'ua-agent-list');
  [...agents].sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || (b.tokens_7d || 0) - (a.tokens_7d || 0)).forEach(a => {
    const li = uaEl('li', 'ua-agent' + (a.online ? ' is-online' : ''));
    const av = makeAvatar(a.name, a.avatar_color, a.avatar_url, 20);
    if (!a.avatar_url && a.avatar_symbol) av.textContent = a.avatar_symbol;
    av.classList.add('ua-agent-avatar');
    li.appendChild(av);
    const name = uaEl('span', 'ua-agent-name', a.name || 'Agent');
    li.appendChild(name);
    const dot = uaEl('span', 'ua-dot');
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', a.online ? 'online' : 'offline');
    li.appendChild(dot);
    li.appendChild(uaEl('span', 'ua-agent-num', _usageFmt(a.tokens_7d || 0)));
    li.appendChild(uaEl('span', 'ua-agent-num ua-agent-turns', _usageFmt(a.turns_7d || 0)));
    list.appendChild(li);
  });
  wrap.appendChild(list);
  return wrap;
}
