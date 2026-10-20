function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((b, i) => ([4,6,8,10].includes(i) ? '-' : '') + b.toString(16).padStart(2,'0')).join('');
}

function showToast(msg, { error = false, duration = 3000 } = {}) {
  const el = document.createElement('div');
  el.className = 'h-toast' + (error ? ' h-toast-error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, duration);
}

// ── State ──────────────────────────────────────────────────────────────────
let ws = null;
let currentRoomId = null;
let currentRoomData = null;
let currentRoomWorkdirId = null;
let allActors = [];
let humanActor = null;
let actorByName = {};
let roomParticipantsCache = {}; // roomId -> [participant]
let roomSubAgentsCache = {};   // roomId -> [{label, parent_name, avatar_color, avatar_url}]
let pendingAttachments = [];
const streaming = {}; // msgId -> accumulated text
const processingMessages = new Set(); // message IDs currently being processed by AI
let oldestMessageId   = null;
let loadingOlder      = false;
let noMoreOlder       = false;
let allSkills = [];  // [{name, description}]
let skillPopupIdx = -1; // active item index in popup
let mentionPopupIdx = -1;

// ── Auth ──────────────────────────────────────────────────────────────────
let authUser = null;

async function checkAuth() {
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) { authUser = await r.json(); return true; }
  } catch {}
  return false;
}

function showLogin() {
  document.getElementById('login-overlay').style.display = 'flex';
}

function hideLogin() {
  document.getElementById('login-overlay').style.display = 'none';
}

function loginRetryMessage(retryAfterSec) {
  const sec = Number(retryAfterSec);
  const mins = Number.isFinite(sec) && sec > 0 ? Math.ceil(sec / 60) : 15;
  return `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
}

async function doLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (r.ok) {
      authUser = await r.json();
      hideLogin();
      init();
    } else {
      const data = await r.json().catch(() => ({}));
      if (r.status === 429) errEl.textContent = loginRetryMessage(data.retry_after ?? r.headers.get('Retry-After'));
      else if (data.error === 'origin_not_allowed') errEl.textContent = 'Sign-in from this address is not allowed by the server.';
      else errEl.textContent = data.error || 'Login failed';
    }
  } catch {
    errEl.textContent = 'Network error';
  }
}

async function doLogout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) { console.error('Logout request failed:', e); }
  authUser = null;
  location.reload();
}

// Persistent warning while the account still uses the shipped default password.
function renderDefaultPasswordBanner() {
  const existing = document.getElementById('default-pw-banner');
  if (!authUser?.default_password) { existing?.remove(); return; }
  if (existing) return;
  const banner = document.createElement('div');
  banner.id = 'default-pw-banner';
  banner.className = 'h-default-pw-banner';
  banner.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = 'You are still using the default password. Change it now.';
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'h-default-pw-link';
  link.textContent = 'change password';
  link.addEventListener('click', () => {
    openSettingsTab('general');
    requestAnimationFrame(() => document.getElementById('s-auth-cur-pw')?.focus());
  });
  banner.append(text, link);
  document.body.appendChild(banner);
}

// ── Notifications ──────────────────────────────────────────────────────────
let notifEnabled = localStorage.getItem('stoa-notif') !== 'off';

function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showDesktopNotif(title, body, roomId) {
  if (!notifEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  // Don't notify if user is focused on the same room
  if (document.visibilityState === 'visible' && currentRoomId === roomId) return;
  const notif = new Notification(title, { body: body?.slice(0, 120), icon: '/stoa-icon.svg', tag: `stoa-${roomId}` });
  notif.onclick = () => { window.focus(); notif.close(); };
}

// ── Fetch helper ───────────────────────────────────────────────────────────
async function fjson(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 401) { showLogin(); throw new Error('unauthorized'); }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// ── Avatar helper ───────────────────────────────────────────────────────────
function makeAvatar(name, color, avatarUrl, size) {
  if (avatarUrl) {
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;display:inline-block`;
    img.alt = name || '';
    return img;
  }
  const el = document.createElement('span');
  el.className = 'h-seal';
  el.style.width  = size + 'px';
  el.style.height = size + 'px';
  el.style.background = color || '#888';
  el.style.fontSize = (size * 0.52) + 'px';
  el.textContent = name ? name[0] : '?';
  return el;
}
// ── Connection dot ─────────────────────────────────────────────────────────
function setConnected(on) {
  const dot = document.querySelector('.h-conn-dot');
  const label = document.querySelector('.h-conn-label');
  if (dot)   dot.classList.toggle('on', on);
  if (label) label.textContent = on ? 'connected' : 'offline';
}



// ── Bubble colors ──────────────────────────────────────────────────────────
function bubbleBg(color)     { return `color-mix(in srgb, ${color} 22%, var(--h-surface))`; }
function bubbleBorder(color) { return `color-mix(in srgb, ${color} 46%, var(--h-surface))`; }
function saBubbleBg(color)     { return `color-mix(in srgb, ${color} 12%, var(--h-surface))`; }
function saBubbleBorder(color) { return `color-mix(in srgb, ${color} 30%, var(--h-surface))`; }

// ── Automation avatar helpers ─────────────────────────────────────────────
const _AUTOMATION_LOGOS = {
  slack: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 122.8 122.8" aria-hidden="true"><path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9z" fill="#E01E5A"/><path d="M32.3 77.6c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A"/><path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2z" fill="#36C5F0"/><path d="M45.2 32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36C5F0"/><path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2z" fill="#2EB67D"/><path d="M90.5 45.2c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D"/><path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9z" fill="#ECB22E"/><path d="M77.6 90.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ECB22E"/></svg>',
  whatsapp: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>',
  gmail: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.907 1.528-1.147C21.69 2.28 24 3.434 24 5.457z" fill="#EA4335"/><path d="M0 5.457v13.909c0 .904.732 1.636 1.636 1.636h3.819V11.73L12 16.64V9.548L5.455 4.64 3.927 3.493C2.309 2.28 0 3.434 0 5.457z" fill="#C5221F"/><path d="M24 5.457c0-2.023-2.309-3.178-3.927-1.964L18.545 4.64 12 9.548v7.091l6.545-4.91V20.999h3.819A1.636 1.636 0 0 0 24 19.366V5.457z" fill="#FBBC04"/><path d="M12 9.548 5.455 4.64l-1.528-1.147L12 9.548z" fill="#34A853"/><path d="m12 9.548 6.545-4.907-6.545 4.907z" fill="#4285F4"/></svg>',
  email: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>',
};
const _BOT_LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M12 11V7"/><circle cx="12" cy="5" r="2"/><path d="M8 15h.01M16 15h.01"/></svg>';

function makeAutomationAvatarEl(provider, size) {
  const wrap = document.createElement('div');
  wrap.className = 'h-automation-avatar';
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';
  const svg = _AUTOMATION_LOGOS[provider] || _BOT_LOGO;
  wrap.innerHTML = svg;
  const svgEl = wrap.querySelector('svg');
  if (svgEl) { svgEl.style.width = size + 'px'; svgEl.style.height = size + 'px'; }
  return wrap;
}

function makeAgentViaConnAvatarEl(m, size) {
  const wrap = document.createElement('div');
  wrap.className = 'h-sa-avatar-wrap';
  wrap.appendChild(makeAvatarEl(m.actor_name, m.avatar_color, m.avatar_url, size, m.sub_agent_label, m.sub_agent_avatar_color, m.sub_agent_avatar_symbol, m.sub_agent_avatar_url));
  const badge = document.createElement('span');
  badge.className = 'h-conn-badge';
  const _providerLabels = { gmail: 'Gmail', email: 'Email', slack: 'Slack', whatsapp: 'WhatsApp' };
  badge.title = 'via ' + (_providerLabels[m.automation.provider] || m.automation.provider);
  badge.setAttribute('aria-label', badge.title);
  const svg = _AUTOMATION_LOGOS[m.automation.provider] || '';
  badge.innerHTML = svg;
  const svgEl = badge.querySelector('svg');
  if (svgEl) { svgEl.style.width = '11px'; svgEl.style.height = '11px'; }
  wrap.appendChild(badge);
  return wrap;
}

function makeSubAgentRoleEl(subAgentLabel, role) {
  if (!subAgentLabel || !role) return null;
  const el = document.createElement('div');
  el.className = 'sa-role';
  el.textContent = role;
  el.title = role;
  return el;
}

// ── Sub-agent avatar helper ───────────────────────────────────────────────
function makeAvatarEl(name, color, url, size, subAgentLabel, saAvatarColor, saAvatarSymbol, saAvatarUrl) {
  if (!subAgentLabel) return makeAvatar(name, color, url, size);
  const wrap = document.createElement('div');
  wrap.className = 'h-sa-avatar-wrap';
  if (saAvatarUrl) {
    const img = document.createElement('img');
    img.src = saAvatarUrl;
    img.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;display:inline-block`;
    img.alt = subAgentLabel;
    wrap.appendChild(img);
  } else if (saAvatarColor || saAvatarSymbol) {
    const seal = document.createElement('span');
    seal.className = 'h-seal';
    seal.style.width = size + 'px'; seal.style.height = size + 'px';
    seal.style.background = saAvatarColor || '#888';
    seal.style.fontSize = (size * 0.52) + 'px';
    seal.textContent = saAvatarSymbol || subAgentLabel[0].toUpperCase();
    wrap.appendChild(seal);
  } else {
    wrap.appendChild(makeAvatar(name, color, url, size));
  }
  const badge = document.createElement('span');
  badge.className = 'h-sa-badge';
  badge.style.background = color || '#888';
  badge.textContent = subAgentLabel[0].toUpperCase();
  wrap.appendChild(badge);
  return wrap;
}

function applyBubbleColor(el, color, subAgentLabel) {
  el.style.background  = subAgentLabel ? saBubbleBg(color) : bubbleBg(color);
  el.style.borderColor = subAgentLabel ? saBubbleBorder(color) : bubbleBorder(color);
}

// ── Theme ──────────────────────────────────────────────────────────────────
// Palettes are [data-theme] token blocks in css/base.css; this list is the
// source of truth for which ids exist (.claude/tools/theme-contrast.js reads it).
// The inline boot script in index.html applies the stored id before first paint.
const THEMES = [
  { id: 'warm-paper', label: 'Warm Paper', scheme: 'light' },
  { id: 'hoth', label: 'Hoth', scheme: 'light' },
  { id: 'mood-indigo', label: 'Mood Indigo', scheme: 'light' },
  { id: 'banana', label: 'Banana', scheme: 'light' },
  { id: 'sweet-treat', label: 'Sweet Treat', scheme: 'light' },
  { id: 'dark', label: 'Dark', scheme: 'dark' },
  { id: 'aubergine', label: 'Aubergine', scheme: 'dark' },
  { id: 'ochin', label: 'Ochin', scheme: 'dark' },
  { id: 'haberdashery', label: 'Haberdashery', scheme: 'dark' },
  { id: 'choco-mint', label: 'Choco Mint', scheme: 'dark' },
  { id: 'nocturne', label: 'Nocturne', scheme: 'dark' },
];
const DEFAULT_THEME = 'warm-paper';

// Resolves the stored preference, migrating the pre-themes values
// ('light' → warm-paper, 'dark' stays dark) and falling back to the OS scheme.
function resolveStoredTheme() {
  const saved = localStorage.getItem('stoa-theme');
  if (saved === 'light') return { id: DEFAULT_THEME, migrated: true };
  if (saved && THEMES.some(t => t.id === saved)) return { id: saved, migrated: false };
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return { id: prefersDark ? 'dark' : DEFAULT_THEME, migrated: saved !== null };
}

function currentTheme() {
  return document.documentElement.dataset.theme || DEFAULT_THEME;
}

function setTheme(id, { persist = true } = {}) {
  const theme = THEMES.find(t => t.id === id) || THEMES.find(t => t.id === DEFAULT_THEME);
  document.documentElement.dataset.theme = theme.id;
  if (persist) localStorage.setItem('stoa-theme', theme.id);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeColorAsRgb(getComputedStyle(document.body).backgroundColor));
}

// Resolves any CSS color (the dark palette is oklch) to rgb() for the
// theme-color meta, which older mobile browsers only parse as hex/rgb.
function themeColorAsRgb(color) {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return color;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

function toggleSidebar() {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  const emptyBtn = document.getElementById('empty-rooms-toggle');
  if (emptyBtn) emptyBtn.style.display = collapsed ? '' : 'none';
  if (currentRoomId) {
    const parts = roomParticipantsCache[currentRoomId] || [];
    const room = { id: currentRoomId, title: document.querySelector('.h-room-name')?.textContent || '' };
    renderChatHeader(room, parts);
  }
}

