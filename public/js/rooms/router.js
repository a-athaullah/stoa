// ── Router: permalinks for room / thread / message ─────────────────────────
// /r/<room>, /r/<room>/t/<thread>, plus optional ?m=<message>. Legacy ?thread=<id> is still read.
const ROUTE_PATH_RE = /^\/r\/(\d+)(?:\/t\/(\d+))?\/?$/;
const LINK_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

// Route still to be finished (thread / message focus) once the room's history arrives over WS.
let pendingRoute = null;

function _routeId(v) {
  if (typeof v !== 'string' || !/^\d{1,15}$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

function parseRoute(loc = location) {
  const m = loc.pathname.match(ROUTE_PATH_RE);
  const q = new URLSearchParams(loc.search);
  return {
    roomId: m ? _routeId(m[1]) : null,
    threadId: m && m[2] ? _routeId(m[2]) : _routeId(q.get('thread')),
    msgId: _routeId(q.get('m')),
  };
}

function routePath(roomId, threadId, msgId) {
  if (!roomId) return '/';
  let p = '/r/' + roomId;
  if (threadId) p += '/t/' + threadId;
  if (msgId) p += '?m=' + msgId;
  return p;
}

// mode: 'push' (user navigation), 'replace' (same entry, e.g. auto-open), 'none' (URL already right)
function routeWrite(roomId, threadId, mode = 'push', msgId = null) {
  if (mode === 'none') return;
  const path = routePath(roomId, threadId, msgId);
  if (location.pathname + location.search === path) return;
  if (mode === 'replace') history.replaceState(null, '', path);
  else history.pushState(null, '', path);
}

function messagePermalink(msgId, threadId, roomId) {
  return location.origin + routePath(roomId || currentRoomId, threadId, msgId);
}

function addMessageLinkAction(actions, msgId, threadId, roomId) {
  if (!actions || !msgId) return;
  const btn = document.createElement('button');
  btn.className = 'h-msg-action-btn';
  btn.dataset.action = 'link';
  btn.title = 'Copy link';
  btn.setAttribute('aria-label', 'Copy link to message');
  btn.innerHTML = LINK_ICON_SVG;
  btn.onclick = async function(e) {
    e.stopPropagation();
    if (await copyToClipboard(messagePermalink(msgId, threadId, roomId))) {
      showCopyFeedback(this);
      showToast('Link copied');
    } else {
      showToast('Failed to copy link', { error: true });
    }
  };
  actions.insertBefore(btn, actions.querySelector('[data-action="delete"]'));
}

// ── Not-found state (reuses #empty-state copy) ─────────────────────────────
function showRouteNotFound(title, sub) {
  const box = document.getElementById('empty-state');
  if (!box) return;
  const logo = box.querySelector('.h-empty-logo');
  const subEl = box.querySelector('.h-empty-sub');
  if (!box.classList.contains('route-not-found')) {
    if (logo) logo.dataset.defaultText = logo.textContent;
    if (subEl) subEl.dataset.defaultText = subEl.textContent;
  }
  box.classList.add('route-not-found');
  if (logo) logo.textContent = title;
  if (subEl) subEl.textContent = sub;
}

function clearRouteNotFound() {
  const box = document.getElementById('empty-state');
  if (!box || !box.classList.contains('route-not-found')) return;
  box.classList.remove('route-not-found');
  box.querySelectorAll('[data-default-text]').forEach(el => {
    el.textContent = el.dataset.defaultText;
    delete el.dataset.defaultText;
  });
}

function showHome() {
  if (typeof closeThread === 'function') closeThread({ history: 'none' });
  if (currentRoomId) saveDraft(currentRoomId);
  currentRoomId = null;
  currentRoomData = null;
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  setConnected(false);
  document.querySelectorAll('.h-room-row').forEach(el => el.classList.remove('active'));
  document.getElementById('chat-inner').classList.remove('visible');
  document.getElementById('empty-state').style.display = '';
  document.body.classList.remove('in-chat');
}

// ── Resolve & apply ────────────────────────────────────────────────────────
async function _findRoom(roomId, knownRooms) {
  const hit = (knownRooms || []).find(r => r.id === roomId);
  if (hit) return hit;
  for (const q of knownRooms?.length ? ['?archived=1'] : ['', '?archived=1']) {
    const rooms = await fjson('/api/rooms' + q);
    const room = rooms.find(r => r.id === roomId);
    if (room) return room;
  }
  return null;
}

// The message row is the source of truth for which room/thread a ?m= link lives in.
async function _resolveRoute(route) {
  const probeId = route.msgId || (!route.roomId ? route.threadId : null);
  if (!probeId) return { ...route, msgMissing: false };
  const r = await fetch('/api/messages/' + probeId);
  if (r.status === 404) return { ...route, msgMissing: true };
  if (!r.ok) throw new Error('message lookup failed: ' + r.status);
  const msg = await r.json();
  if (!route.msgId) return { roomId: msg.room_id, threadId: msg.id, msgId: null, msgMissing: false };
  const threadId = msg.thread_id || (route.threadId === msg.id ? msg.id : null);
  return { roomId: msg.room_id, threadId, msgId: msg.id, msgMissing: false };
}

async function navigateToRoute(route, mode = 'push', knownRooms = null) {
  let target;
  let room = null;
  try {
    target = await _resolveRoute(route);
    if (target.roomId) room = await _findRoom(target.roomId, knownRooms);
  } catch (e) {
    console.error('[router] failed to resolve link', e);
    showToast('Could not open this link', { error: true });
    return false;
  }
  if (!room) {
    if (currentRoomId) showHome();
    showRouteNotFound('this room isn’t here.', 'the link points to a room that was deleted or that you can’t open.');
    routeWrite(null, null, mode === 'none' ? 'none' : 'replace');
    return false;
  }
  if (target.msgMissing) {
    showToast('Message not found — it may have been deleted', { error: true });
    target = { roomId: room.id, threadId: target.threadId, msgId: null };
  }
  if (currentRoomId === room.id && !settingsOpen) {
    routeWrite(room.id, target.threadId, mode, target.msgId);
    return focusRouteInRoom(target);
  }
  pendingRoute = { roomId: room.id, threadId: target.threadId, msgId: target.msgId };
  routeWrite(room.id, target.threadId, mode, target.msgId);
  await openRoom(room, { history: 'none' });
  return true;
}

async function focusRouteInRoom(route) {
  if (route.threadId) {
    await openThread(route.threadId, route.msgId, { history: 'none' });
    return true;
  }
  if (route.msgId && !(await scrollToMessage(route.msgId))) {
    showToast('Message not found in this room', { error: true });
    return false;
  }
  return true;
}

function goToMessage(roomId, msgId, threadId) {
  return navigateToRoute({ roomId, threadId: threadId || null, msgId }, 'push');
}

// Called by init() once the room list is loaded.
function applyInitialRoute(knownRooms) {
  const route = parseRoute();
  if (!route.roomId && !route.threadId && !route.msgId) return;
  navigateToRoute(route, 'replace', knownRooms);
}

// Called by the WS 'history' handler, after the feed is rendered.
function routerOnHistory() {
  const route = pendingRoute && pendingRoute.roomId === currentRoomId ? pendingRoute : null;
  pendingRoute = null;
  if (route) { focusRouteInRoom(route); return; }
  // Reconnect / re-join: reopen the thread the URL points at
  const { roomId, threadId } = parseRoute();
  if (threadId && roomId === currentRoomId) openThread(threadId, null, { history: 'none' });
}

window.addEventListener('popstate', () => {
  if (typeof authUser !== 'undefined' && !authUser) return;
  const route = parseRoute();
  if (!route.roomId) { if (currentRoomId) showHome(); return; }
  if (route.roomId !== currentRoomId || settingsOpen) { navigateToRoute(route, 'none'); return; }
  if (route.threadId) {
    if (route.threadId !== activeThreadId || route.msgId) openThread(route.threadId, route.msgId, { history: 'none' });
  } else if (isThreadOpen()) {
    closeThread({ history: 'none' });
  } else if (route.msgId) {
    scrollToMessage(route.msgId);
  }
});
