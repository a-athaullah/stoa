// ── Skills tab: state, API, shared cache ─────────────────────────────────────
const SKILL_NAME_RE = /^[a-z][a-z0-9-]{1,47}$/;
// Same list as RESERVED_NAMES in lib/skill-bundle.js.
const SKILL_RESERVED = new Set([
  'compact', 'clear', 'help', 'model', 'models', 'skills', 'skill', 'reauth', 'logout', 'login',
  'status', 'stop', 'cost', 'config', 'init', 'memory', 'resume', 'review', 'exit', 'quit', 'new', 'reset',
]);
const SKILL_BODY_MAX = 64 * 1024;
const SKILL_UPLOAD_MAX = 25 * 1024 * 1024;
const SKILL_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'agents', label: 'By agents' },
  { id: 'disabled', label: 'Disabled' },
];

let skillsState = {
  loaded: false,
  loadError: null,
  skills: [],
  query: '',
  filter: 'all',
  view: 'list',
  editor: null,
  confirmDeleteId: null,
  busy: new Set(),
  pendingOpenId: null,
};
let skillsCacheReq = null;

async function skillsApi(method, url, body) {
  const opts = { method };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  let r;
  try { r = await fetch(url, opts); } catch { return { ok: false, error: 'Network error' }; }
  if (r.status === 401) { showLogin(); return { ok: false, error: 'unauthorized' }; }
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) return { ok: false, status: r.status, code: data?.code || null, error: (data && data.error) || `${r.status} ${r.statusText}` };
  return { ok: true, data };
}

function skEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function skBtn(cls, text, onClick, title) {
  const b = skEl('button', cls, text);
  b.type = 'button';
  if (title) { b.title = title; b.setAttribute('aria-label', title); }
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function skIcon(paths, size = 15) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  paths.forEach(d => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  });
  return svg;
}

function skFmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(v < 10 * 1024 ? 1 : 0)} KB`;
  return `${(v / 1048576).toFixed(1)} MB`;
}

function skSizeLine(s) {
  const files = Number(s.file_count) || 0;
  return `v${s.version || 1} · ${files} ${files === 1 ? 'file' : 'files'} · ${skFmtBytes(s.total_bytes)}`;
}

// Client-side mirror of the server rules, for live feedback only; the server stays the authority.
function skNameProblem(name, selfId) {
  if (!name) return 'Name is required.';
  if (!SKILL_NAME_RE.test(name)) return 'Use 2–48 characters: lowercase letters, digits and hyphens, starting with a letter.';
  if (SKILL_RESERVED.has(name)) return `/${name} is reserved.`;
  if (skillsState.skills.some(s => s.name === name && s.id !== selfId)) return `/${name} already exists.`;
  return null;
}

function skIsMine(s) {
  return !s.created_by_actor_id && !s.created_by_sub_agent_id;
}

function skCreatorEl(s) {
  const wrap = skEl('span', 'sk-creator');
  if (skIsMine(s)) {
    wrap.appendChild(skEl('span', 'sk-creator-name', 'You'));
    return wrap;
  }
  const actor = allActors.find(a => a.id === s.created_by_actor_id);
  if (actor) wrap.appendChild(makeAvatar(actor.name, actor.avatar_color, actor.avatar_url, 16));
  wrap.appendChild(skEl('span', 'sk-creator-name', s.creator_name || actor?.name || 'Agent'));
  return wrap;
}

function skSetSkills(list) {
  skillsState.skills = Array.isArray(list) ? list : [];
  allSkills = skillsState.skills.filter(s => s.enabled);
}

async function skillsLoad() {
  const r = await skillsApi('GET', '/api/skills');
  if (!r.ok) { skillsState.loadError = r.error; return false; }
  skillsState.loadError = null;
  skSetSkills(r.data?.skills);
  skillsState.loaded = true;
  return true;
}

// Composer popup cache; plain fetch so a background refresh never pops the login overlay.
function skillsRefreshCache() {
  if (skillsCacheReq) return skillsCacheReq;
  skillsCacheReq = fetch('/api/skills').then(r => (r.ok ? r.json() : null)).catch(() => null).then(data => {
    skillsCacheReq = null;
    if (!Array.isArray(data?.skills)) return;
    skSetSkills(data.skills);
    skillsState.loaded = true;
    if (skillsIsVisible() && skillsState.view === 'list') skillsRender();
  });
  return skillsCacheReq;
}

function skillsHandleChanged() {
  skillsRefreshCache();
}

function skillsIsVisible() {
  return settingsOpen && document.getElementById('s-tab-skills')?.style.display !== 'none';
}

async function sLoadSkillsTab() {
  if (!skillsState.loaded) await skillsLoad();
  const openId = skillsState.pendingOpenId;
  skillsState.pendingOpenId = null;
  const ed = skillsState.view === 'editor' ? skillsState.editor : null;
  if (openId && ed?.id !== openId && skIsDirty(ed)) {
    showToast(`Save or discard your changes to ${ed.name ? '/' + ed.name : 'the new skill'} first`, { error: true, duration: 5000 });
  } else if (openId && ed?.id !== openId) {
    skillsOpenEditor(openId);
    return;
  }
  if (skillsState.view === 'editor' && skillsState.editor) skillsRenderEditor();
  else skillsRender();
}

// Entry point for feed chips: jump to a skill in the Skills tab.
function skillsOpenById(id) {
  skillsState.pendingOpenId = id;
  openSettingsTab('skills');
}

function skillsFiltered() {
  const q = skillsState.query.trim().toLowerCase();
  return skillsState.skills.filter(s => {
    if (skillsState.filter === 'mine' && !skIsMine(s)) return false;
    if (skillsState.filter === 'agents' && skIsMine(s)) return false;
    if (skillsState.filter === 'disabled' && s.enabled) return false;
    if (!q) return true;
    return s.name.includes(q) || (s.description || '').toLowerCase().includes(q) || (s.creator_name || '').toLowerCase().includes(q);
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function skillsToggleEnabled(s, next) {
  const r = await skillsApi('PATCH', `/api/skills/${s.id}`, { enabled: next });
  if (!r.ok) { showToast(`Couldn’t update /${s.name}: ${r.error}`, { error: true }); return false; }
  s.enabled = next;
  skSetSkills(skillsState.skills);
  return true;
}

async function skillsDelete(s) {
  skillsState.busy.add(s.id);
  skillsRender();
  const r = await skillsApi('DELETE', `/api/skills/${s.id}`);
  skillsState.busy.delete(s.id);
  skillsState.confirmDeleteId = null;
  if (!r.ok) {
    showToast(`Couldn’t delete /${s.name}: ${r.error}`, { error: true });
  } else {
    skSetSkills(skillsState.skills.filter(x => x.id !== s.id));
    showToast(`/${s.name} deleted`);
  }
  skillsRender();
}
