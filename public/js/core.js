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
      errEl.textContent = data.error || 'Login failed';
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

// ── Sub-agent avatar helper ───────────────────────────────────────────────
function makeAvatarEl(name, color, url, size, subAgentLabel) {
  if (!subAgentLabel) return makeAvatar(name, color, url, size);
  const wrap = document.createElement('div');
  wrap.className = 'h-sa-avatar-wrap';
  wrap.appendChild(makeAvatar(name, color, url, size));
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
const MOON_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.7 6.7 0 0 0 10 10z"/></svg>`;
const SUN_SVG  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6"/></svg>`;

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('stoa-theme', dark ? 'dark' : 'light');
  const btn = document.getElementById('theme-toggle');
  if (btn) { btn.innerHTML = dark ? SUN_SVG : MOON_SVG; btn.title = dark ? 'switch to light' : 'switch to dark'; }
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

function toggleTheme() {
  applyTheme(!document.documentElement.classList.contains('dark'));
}

