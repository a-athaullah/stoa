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
let currentRoomWorkdirId = null;
let allActors = [];
let humanActor = null;
let actorByName = {};
let roomParticipantsCache = {}; // roomId -> [participant]
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

