// ── Emoji picker ────────────────────────────────────────────────────────────
const EMOJIS = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
  '😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐',
  '🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒',
  '🤕','🤢','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟',
  '🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖',
  '😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡',
  '👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾',
  '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆',
  '🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖',
  '💘','💝','💟','☮️','✝️','☪️','🕉️','☯️','🆗','🆙','🆒','🆕','🆓','🔥','💯','✨',
  '⭐','🌟','💫','💥','❗','❓','💬','👁️‍🗨️','💭','💤','🎉','🎊','🎈','🎁','🏆','🥇',
];

const EMOJI_KW = {
  '😀':'grin happy','😃':'smile happy','😄':'laugh happy','😁':'grin beam','😆':'laughing squint','😅':'sweat smile nervous',
  '🤣':'rofl rolling laugh','😂':'joy laugh cry tears','🙂':'slight smile','🙃':'upside down','😉':'wink','😊':'blush happy shy',
  '😇':'angel halo innocent','🥰':'love hearts face','😍':'heart eyes love','🤩':'star struck wow amazing',
  '😘':'kiss blow','😗':'kiss','😚':'kiss blush','😙':'kiss smile','🥲':'smile tear sad happy',
  '😋':'yum delicious tasty food','😛':'tongue','😜':'tongue wink crazy','🤪':'zany crazy wild','😝':'tongue squint',
  '🤑':'money dollar rich','🤗':'hug hugging','🤭':'giggle oops cover','🤫':'shush quiet secret','🤔':'think thinking hmm','🤐':'zip mouth quiet shut',
  '🤨':'raised eyebrow sus suspicious','😐':'neutral','😑':'expressionless blank','😶':'no mouth silent','😏':'smirk','😒':'unamused meh bored',
  '🙄':'eye roll annoyed','😬':'grimace awkward','🤥':'lying pinocchio','😌':'relieved peaceful','😔':'sad pensive','😪':'sleepy tired',
  '🤤':'drool drooling','😴':'sleep zzz','😷':'mask sick','🤒':'thermometer sick fever','🤕':'bandage hurt injured',
  '🤢':'nauseous sick green','🤧':'sneeze sick','🥵':'hot overheated','🥶':'cold freezing','🥴':'woozy drunk dizzy',
  '😵':'dizzy shocked','🤯':'mind blown exploding head wow','🤠':'cowboy yeehaw','🥳':'party celebrate birthday',
  '🥸':'disguise glasses','😎':'cool sunglasses','🤓':'nerd glasses','🧐':'monocle curious','😕':'confused','😟':'worried',
  '🙁':'sad frown','☹️':'sad frown','😮':'open mouth surprised','😯':'hushed surprised','😲':'astonished shocked wow',
  '😳':'flushed embarrassed','🥺':'pleading puppy eyes please','😦':'frown open mouth','😧':'anguished','😨':'fearful scared',
  '😰':'anxious sweat nervous','😥':'sad relieved','😢':'cry crying sad','😭':'sob crying loud sad','😱':'scream scared horror',
  '😖':'confounded','😣':'persevere','😞':'disappointed sad','😓':'downcast sweat','😩':'weary tired','😫':'tired exhausted',
  '🥱':'yawn bored sleepy','😤':'angry huff steam','😡':'angry mad rage red','😠':'angry mad','🤬':'swear curse angry',
  '😈':'devil evil smiling','👿':'devil angry evil','💀':'skull dead death','☠️':'skull crossbones death poison','💩':'poop shit','🤡':'clown',
  '👹':'ogre monster','👺':'goblin tengu','👻':'ghost boo','👽':'alien ufo','👾':'space invader game','🤖':'robot bot',
  '😺':'cat smile','😸':'cat grin','😹':'cat joy laugh','😻':'cat heart eyes love','😼':'cat smirk','😽':'cat kiss',
  '🙀':'cat scared weary','😿':'cat cry sad','😾':'cat angry',
  '👋':'wave hello hi bye','🤚':'raised back hand stop','🖐️':'hand fingers','✋':'hand stop high five','🖖':'vulcan spock',
  '👌':'ok okay perfect','🤌':'pinch italian','🤏':'pinch small tiny','✌️':'peace victory','🤞':'crossed fingers luck hope',
  '🤟':'love you sign','🤘':'rock metal horns','🤙':'call shaka hang loose','👈':'point left','👉':'point right','👆':'point up',
  '🖕':'middle finger','👇':'point down','☝️':'point up','👍':'thumbs up yes good like','👎':'thumbs down no bad dislike',
  '✊':'fist raised','👊':'fist bump punch','🤛':'left fist bump','🤜':'right fist bump','👏':'clap applause bravo',
  '🙌':'raise hands celebrate hooray','👐':'open hands','🤲':'palms up','🤝':'handshake deal','🙏':'pray please thank you namaste',
  '❤️':'red heart love','🧡':'orange heart','💛':'yellow heart','💚':'green heart','💙':'blue heart','💜':'purple heart',
  '🖤':'black heart','🤍':'white heart','🤎':'brown heart','💔':'broken heart sad','❣️':'heart exclamation',
  '💕':'two hearts love','💞':'revolving hearts','💓':'heartbeat','💗':'growing heart','💖':'sparkling heart',
  '💘':'cupid arrow heart love','💝':'heart ribbon gift','💟':'heart decoration',
  '☮️':'peace','✝️':'cross christian','☪️':'crescent moon islam','🕉️':'om hindu','☯️':'yin yang balance',
  '🆗':'ok button','🆙':'up button','🆒':'cool button','🆕':'new button','🆓':'free button',
  '🔥':'fire hot lit flame','💯':'hundred perfect score','✨':'sparkle shine magic star',
  '⭐':'star yellow','🌟':'glowing star shine','💫':'dizzy star','💥':'boom explosion crash bang',
  '❗':'exclamation important','❓':'question','💬':'speech bubble chat talk comment','👁️‍🗨️':'eye speech witness',
  '💭':'thought bubble think','💤':'sleep zzz','🎉':'party tada congratulations celebrate','🎊':'confetti ball party',
  '🎈':'balloon party birthday','🎁':'gift present birthday','🏆':'trophy winner champion cup','🥇':'gold medal first winner',
};

let emojiPickerOpen = false;

function initEmojiPicker() {
  const btn = document.getElementById('emoji-btn');
  const picker = document.getElementById('emoji-picker');
  const grid = document.getElementById('emoji-grid');
  const search = document.getElementById('emoji-search');
  const input = document.getElementById('msg-input');

  function renderGrid(list) {
    grid.innerHTML = '';
    if (!list.length) {
      const noRes = document.createElement('div');
      noRes.id = 'emoji-no-result';
      noRes.textContent = 'No emoji found';
      grid.parentElement.appendChild(noRes);
      return;
    }
    const existing = document.getElementById('emoji-no-result');
    if (existing) existing.remove();
    list.forEach(em => {
      const b = document.createElement('button');
      b.className = 'h-emoji-btn';
      b.textContent = em;
      b.type = 'button';
      b.onclick = () => {
        input.focus();
        document.execCommand('insertText', false, em);
        closePicker();
      };
      grid.appendChild(b);
    });
  }

  function filterEmojis(query) {
    if (!query) return EMOJIS;
    const q = query.toLowerCase();
    return EMOJIS.filter(em => {
      const kw = EMOJI_KW[em];
      return kw && kw.includes(q);
    });
  }

  function openPicker() {
    picker.classList.add('open');
    search.value = '';
    renderGrid(EMOJIS);
    emojiPickerOpen = true;
    setTimeout(() => search.focus(), 50);
  }

  function closePicker() {
    picker.classList.remove('open');
    emojiPickerOpen = false;
    const existing = document.getElementById('emoji-no-result');
    if (existing) existing.remove();
  }

  search.addEventListener('input', () => {
    renderGrid(filterEmojis(search.value.trim()));
  });

  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = grid.querySelector('.h-emoji-btn');
      if (first) first.click();
    }
  });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    emojiPickerOpen ? closePicker() : openPicker();
  });

  document.addEventListener('click', e => {
    if (emojiPickerOpen && !picker.contains(e.target) && e.target !== btn) {
      closePicker();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && emojiPickerOpen) closePicker();
  });
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
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
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


// ── Chat header ────────────────────────────────────────────────────────────
function renderChatHeader(room, participants) {
  const header = document.getElementById('chat-header');
  header.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.id = 'mobile-back';
  backBtn.setAttribute('aria-label', 'back to rooms');
  backBtn.innerHTML = '&#8592;';
  backBtn.onclick = () => document.body.classList.remove('in-chat');
  header.appendChild(backBtn);

  if (document.body.classList.contains('sidebar-collapsed')) {
    const roomsToggle = document.createElement('button');
    roomsToggle.className = 'h-rooms-toggle';
    roomsToggle.title = 'Show room list';
    roomsToggle.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/></svg>`;
    roomsToggle.onclick = () => toggleSidebar();
    header.appendChild(roomsToggle);
  }

  const info = document.createElement('div');
  info.className = 'h-header-info';

  const name = document.createElement('div');
  name.className = 'h-room-name';
  name.textContent = room.title;
  name.title = 'Click to rename';
  name.onclick = () => {
    name.contentEditable = 'true';
    name.classList.add('editing');
    name.focus();
    const range = document.createRange();
    range.selectNodeContents(name);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  async function commitRename() {
    name.contentEditable = 'false';
    name.classList.remove('editing');
    const newTitle = name.textContent.trim();
    if (newTitle && newTitle !== room.title) {
      const oldTitle = room.title;
      room.title = newTitle;
      try {
        const r = await fetch(`/api/rooms/${room.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        });
        if (!r.ok) throw new Error('rename failed');
      } catch { showToast('Failed to rename room', { error: true }); room.title = oldTitle; name.textContent = oldTitle; }
    } else {
      name.textContent = room.title;
    }
  }
  name.addEventListener('blur', commitRename);
  name.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
    if (e.key === 'Escape') { name.textContent = room.title; name.blur(); }
  });
  info.appendChild(name);

  const tagline = document.createElement('div');
  tagline.className = 'h-room-tagline';
  const n = participants.length;
  tagline.textContent = n === 1 ? 'one voice.' : n === 2 ? 'two voices.' : n + ' voices.';
  const modelLabel = formatModelName(room.workdir_model);
  if (modelLabel) {
    const badge = document.createElement('span');
    badge.className = 'h-model-badge';
    badge.textContent = modelLabel;
    tagline.appendChild(badge);
  }
  info.appendChild(tagline);

  header.appendChild(info);

  const sealsWrap = document.createElement('div');
  sealsWrap.className = 'h-header-seals';
  for (const p of participants) {
    const wrap = document.createElement('div');
    wrap.className = 'h-header-seal';
    wrap.appendChild(makeAvatar(p.name, p.avatar_color, p.avatar_url, 26));
    sealsWrap.appendChild(wrap);
  }

  const addWrap = document.createElement('div');
  addWrap.style.cssText = 'position:relative;display:inline-flex';

  const addBtn = document.createElement('button');
  addBtn.className = 'h-add-participant';
  addBtn.textContent = '+';
  addBtn.title = 'Add participant';

  const dropdown = document.createElement('div');
  dropdown.className = 'h-add-dropdown';

  addBtn.onclick = (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains('open')) {
      dropdown.classList.remove('open');
      return;
    }
    dropdown.innerHTML = '';
    const currentIds = new Set(participants.map(p => p.actor_id));
    const available = allActors.filter(a => !currentIds.has(a.id));
    if (!available.length) {
      const empty = document.createElement('div');
      empty.className = 'h-add-dropdown-empty';
      empty.textContent = 'No participants to add';
      dropdown.appendChild(empty);
    } else {
      for (const actor of available) {
        const item = document.createElement('div');
        item.className = 'h-add-dropdown-item';
        item.appendChild(makeAvatar(actor.name, actor.avatar_color, actor.avatar_url, 20));
        const label = document.createElement('span');
        label.textContent = actor.name;
        item.appendChild(label);
        item.onclick = async (ev) => {
          ev.stopPropagation();
          dropdown.classList.remove('open');
          try {
            await fjson(`/api/rooms/${currentRoomId}/participants`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ actor_id: actor.id }),
            });
          } catch { showToast('Failed to add participant', { error: true }); }
        };
        dropdown.appendChild(item);
      }
    }
    dropdown.classList.add('open');
    setTimeout(() => {
      document.addEventListener('click', () => dropdown.classList.remove('open'), { once: true });
    }, 0);
  };

  addWrap.appendChild(addBtn);
  addWrap.appendChild(dropdown);
  sealsWrap.appendChild(addWrap);
  header.appendChild(sealsWrap);

  // Search button
  const searchBtn = document.createElement('button');
  searchBtn.className = 'h-header-action-btn';
  searchBtn.title = 'Search in room';
  searchBtn.style.marginLeft = '8px';
  searchBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  searchBtn.onclick = () => toggleRoomSearch();
  header.appendChild(searchBtn);

  // Export button
  const exportWrap = document.createElement('div');
  exportWrap.style.cssText = 'position:relative;display:inline-flex;margin-left:8px';
  const exportBtn = document.createElement('button');
  exportBtn.className = 'h-header-action-btn';
  exportBtn.title = 'Export conversation';
  exportBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v9M5 8l3 3 3-3"/><path d="M3 13h10"/></svg>`;
  const exportDrop = document.createElement('div');
  exportDrop.className = 'h-export-dropdown';
  exportDrop.innerHTML = `
    <button class="h-export-opt" data-fmt="json">JSON</button>
    <button class="h-export-opt" data-fmt="csv">CSV</button>`;
  exportBtn.onclick = (e) => {
    e.stopPropagation();
    exportDrop.classList.toggle('open');
    setTimeout(() => document.addEventListener('click', () => exportDrop.classList.remove('open'), { once: true }), 0);
  };
  exportDrop.querySelectorAll('.h-export-opt').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      exportDrop.classList.remove('open');
      const fmt = btn.dataset.fmt;
      const a = document.createElement('a');
      a.href = `/api/rooms/${room.id}/export?format=${fmt}`;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
  });
  exportWrap.appendChild(exportBtn);
  exportWrap.appendChild(exportDrop);
  header.appendChild(exportWrap);

  const wsToggle = document.createElement('button');
  wsToggle.className = 'h-ws-toggle' + (document.getElementById('workspace-panel').classList.contains('open') ? ' active' : '');
  wsToggle.title = 'Dev Workspace';
  wsToggle.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M14 4v16"/></svg>`;
  wsToggle.onclick = toggleWorkspacePanel;
  header.appendChild(wsToggle);
}

// ── Composer seal ──────────────────────────────────────────────────────────
function renderComposerSeal() {
  const el = document.getElementById('composer-seal');
  if (!el || !humanActor) return;
  el.innerHTML = '';
  el.appendChild(makeAvatar(humanActor.name, humanActor.avatar_color, humanActor.avatar_url, 24));
}

// ── Sidebar footer (human actor) ────────────────────────────────────────────
function renderSidebarFooter() {
  const footer = document.getElementById('sidebar-footer');
  if (!humanActor) return;
  footer.innerHTML = '';
  footer.appendChild(makeAvatar(humanActor.name, humanActor.avatar_color, humanActor.avatar_url, 22));
  const nameEl = document.createElement('span');
  nameEl.className = 'h-footer-name';
  nameEl.textContent = humanActor.name.toLowerCase();
  footer.appendChild(nameEl);
  const conn = document.createElement('span');
  conn.className = 'h-conn-status';
  conn.innerHTML = '<span class="h-conn-dot"></span><span class="h-conn-label">offline</span>';
  footer.appendChild(conn);
  const isDark = document.documentElement.classList.contains('dark');
  const themeBtn = document.createElement('button');
  themeBtn.id = 'theme-toggle';
  themeBtn.className = 'h-theme-btn';
  themeBtn.setAttribute('aria-label', 'toggle theme');
  themeBtn.title = isDark ? 'switch to light' : 'switch to dark';
  themeBtn.innerHTML = isDark ? SUN_SVG : MOON_SVG;
  themeBtn.onclick = toggleTheme;
  footer.appendChild(themeBtn);
}

// ── Room list ──────────────────────────────────────────────────────────────
let currentRoomTab = 'rooms';

function switchRoomTab(tab) {
  currentRoomTab = tab;
  document.getElementById('tab-rooms').classList.toggle('active', tab === 'rooms');
  document.getElementById('tab-archived').classList.toggle('active', tab === 'archived');
  document.getElementById('rooms-active-header').style.display = tab === 'rooms' ? '' : 'none';
  refreshRoomList();
}

function renderRoomList(rooms) {
  const list = document.getElementById('room-list');
  list.innerHTML = '';
  const isArchived = currentRoomTab === 'archived';
  for (const room of rooms) {
    const row = document.createElement('div');
    row.className = 'h-room-row' + (room.id === currentRoomId ? ' active' : '');
    row.dataset.roomId = room.id;

    if (isArchived) {
      row.classList.add('h-room-row-archived');
      const restoreBtn = document.createElement('div');
      restoreBtn.className = 'h-room-restore-btn';
      restoreBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>';
      restoreBtn.onclick = e => { e.stopPropagation(); restoreRoom(room); };
      row.appendChild(restoreBtn);
      const destroyBtn = document.createElement('div');
      destroyBtn.className = 'h-room-destroy-btn';
      destroyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      destroyBtn.onclick = e => { e.stopPropagation(); deleteRoom(room); };
      row.appendChild(destroyBtn);
    } else {
      const archiveBtn = document.createElement('div');
      archiveBtn.className = 'h-room-delete-btn';
      archiveBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';
      archiveBtn.onclick = e => { e.stopPropagation(); archiveRoom(room); };
      row.appendChild(archiveBtn);
    }

    const content = document.createElement('div');
    content.className = 'h-room-content';

    const top = document.createElement('div');
    top.className = 'h-room-row-top';

    const title = document.createElement('span');
    title.className = 'h-room-title-text';
    title.textContent = room.title;
    top.appendChild(title);

    const hasDraft = !!localStorage.getItem('stoa-draft-' + room.id);
    const time = document.createElement('span');
    time.className = 'h-room-time';
    if (hasDraft) {
      time.textContent = 'draft';
      time.style.color = '#d39749';
      time.style.fontWeight = '600';
    } else {
      time.textContent = (room.last_activity || room.created_at) ? relativeTime(room.last_activity || room.created_at) : (room.message_count + ' msg');
    }
    top.appendChild(time);

    const actionBtn = document.createElement('button');
    actionBtn.className = 'h-room-action';
    if (isArchived) {
      actionBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      actionBtn.title = 'Delete';
      actionBtn.style.color = '#c44';
      actionBtn.onclick = e => { e.stopPropagation(); deleteRoom(room); };

      const restoreActionBtn = document.createElement('button');
      restoreActionBtn.className = 'h-room-action';
      restoreActionBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>';
      restoreActionBtn.title = 'Restore';
      restoreActionBtn.onclick = e => { e.stopPropagation(); restoreRoom(room); };
      top.appendChild(restoreActionBtn);
    } else {
      actionBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';
      actionBtn.title = 'Archive';
      actionBtn.onclick = e => { e.stopPropagation(); archiveRoom(room); };
    }
    top.appendChild(actionBtn);

    content.appendChild(top);

    if (room.last_message) {
      const preview = document.createElement('div');
      preview.className = 'h-room-preview';
      const plain = room.last_message.replace(/[#*_~`>\[\]()!]/g, '').replace(/\n+/g, ' ').trim();
      preview.textContent = room.last_message_actor
        ? `${room.last_message_actor}: ${plain}`
        : plain;
      content.appendChild(preview);
    }

    const dots = document.createElement('div');
    dots.className = 'h-room-dots';
    dots.id = 'room-dots-' + room.id;
    content.appendChild(dots);

    row.appendChild(content);

    const cached = roomParticipantsCache[room.id];
    if (cached) renderRoomDots(room.id, cached);

    content.onclick = () => { if (!row.classList.contains('swiped')) openRoom(room); };
    initRoomSwipe(row);
    list.appendChild(row);
  }

  if (isArchived && rooms.length) {
    const delAll = document.createElement('div');
    delAll.style.cssText = 'text-align:center;padding:12px 0 4px';
    const delBtn = document.createElement('button');
    delBtn.style.cssText = 'background:transparent;border:1px solid var(--h-hairline);border-radius:6px;padding:5px 14px;font-family:var(--h-sans);font-size:12px;color:#c44;cursor:pointer';
    delBtn.textContent = 'delete all archived';
    delBtn.onclick = async () => {
      if (!confirm(`Delete all ${rooms.length} archived rooms? This cannot be undone.`)) return;
      try {
        for (const r of rooms) {
          const res = await fetch(`/api/rooms/${r.id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('delete failed');
        }
      } catch { showToast('Failed to delete all archived rooms', { error: true }); }
      refreshRoomList();
    };
    delAll.appendChild(delBtn);
    list.appendChild(delAll);
  }
}

function initRoomSwipe(row) {
  let startX = 0, startY = 0, dragging = false;
  const onStart = e => {
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX; startY = pt.clientY; dragging = true;
  };
  const onMove = e => {
    if (!dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - startX;
    const dy = pt.clientY - startY;
    if (Math.abs(dy) > Math.abs(dx)) { dragging = false; return; }
    if (dx > 30) {
      dragging = false;
      closeAllSwipes();
      row.classList.add('swiped');
    } else if (dx < -20 && row.classList.contains('swiped')) {
      dragging = false;
      row.classList.remove('swiped');
    }
  };
  const onEnd = () => { dragging = false; };
  row.addEventListener('touchstart', onStart, { passive: true });
  row.addEventListener('touchmove', onMove, { passive: true });
  row.addEventListener('touchend', onEnd);
}

function closeAllSwipes() {
  document.querySelectorAll('.h-room-row.swiped').forEach(r => r.classList.remove('swiped'));
}
document.addEventListener('click', e => {
  if (!e.target.closest('.h-room-row')) closeAllSwipes();
});

// Long-press to show message actions on mobile
(function() {
  let timer = null;
  let activeRow = null;
  const inner = document.getElementById('messages-inner');
  if (!inner) return;
  inner.addEventListener('touchstart', e => {
    const row = e.target.closest('.h-msg-row');
    if (!row || e.target.closest('.h-msg-action-btn')) return;
    timer = setTimeout(() => {
      document.querySelectorAll('.h-msg-row.show-actions').forEach(r => r.classList.remove('show-actions'));
      row.classList.add('show-actions');
      activeRow = row;
    }, 500);
  }, { passive: true });
  inner.addEventListener('touchend', () => clearTimeout(timer));
  inner.addEventListener('touchmove', () => clearTimeout(timer));
  document.addEventListener('click', e => {
    if (activeRow && !e.target.closest('.h-msg-actions')) {
      activeRow.classList.remove('show-actions');
      activeRow = null;
    }
  });
})();

async function archiveRoom(room) {
  try {
    const res = await fetch(`/api/rooms/${room.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) });
    if (!res.ok) throw new Error('archive failed');
  } catch { showToast('Failed to archive room', { error: true }); return; }
  if (currentRoomId === room.id) {
    currentRoomId = null;
    document.getElementById('messages-inner').innerHTML = '';
    document.getElementById('chat-header').innerHTML = '';
  }
  refreshRoomList();
}

async function restoreRoom(room) {
  try {
    const res = await fetch(`/api/rooms/${room.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: false }) });
    if (!res.ok) throw new Error('restore failed');
  } catch { showToast('Failed to restore room', { error: true }); return; }
  refreshRoomList();
}

async function deleteRoom(room) {
  if (!confirm(`Delete "${room.title}"? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/rooms/${room.id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('delete failed');
  } catch { showToast('Failed to delete room', { error: true }); return; }
  if (currentRoomId === room.id) {
    currentRoomId = null;
    document.getElementById('messages-inner').innerHTML = '';
    document.getElementById('chat-header').innerHTML = '';
  }
  refreshRoomList();
}

function renderRoomDots(roomId, participants) {
  const container = document.getElementById('room-dots-' + roomId);
  if (!container) return;
  container.innerHTML = '';
  for (const p of participants) {
    const dot = document.createElement('span');
    dot.className = 'h-actor-dot';
    dot.style.background = p.avatar_color;
    dot.title = p.name;
    container.appendChild(dot);
  }
}

// ── Open room ──────────────────────────────────────────────────────────────
async function openRoom(room) {
  if (settingsOpen) {
    settingsOpen = false;
    sStopPolling();
    document.getElementById('settings-row').classList.remove('active');
    document.getElementById('settings-inner').classList.remove('visible');
  }
  closeRoomSearch();
  // Save draft from previous room
  saveDraft(currentRoomId);
  if (window.stopVoiceRecognition) window.stopVoiceRecognition();

  currentRoomId = room.id;
  currentRoomWorkdirId = room.workdir_id || null;
  clearComposerProcessing();

  document.querySelectorAll('.h-room-row').forEach(el => {
    el.classList.toggle('active', el.dataset.roomId == room.id);
  });

  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('chat-inner').classList.add('visible');
  document.body.classList.add('in-chat');

  // Restore draft for this room
  restoreDraft(room.id);

  document.getElementById('messages-inner').innerHTML = '';
  Object.keys(streaming).forEach(k => delete streaming[k]);

  let parts = [];
  try {
    parts = await fjson(`/api/rooms/${room.id}/participants`);
  } catch {
    setConnected(false);
    setTimeout(() => openRoom(room), 3000);
    return;
  }
  roomParticipantsCache[room.id] = parts;
  renderRoomDots(room.id, parts);
  renderChatHeader(room, parts);
  renderComposerSeal();
  fjson(`/api/rooms/${room.id}/skills`).then(s => { allSkills = s; }).catch(() => { allSkills = []; });

  connectWS(room.id);
}

// ── WebSocket ──────────────────────────────────────────────────────────────
function connectWS(roomId) {
  if (ws) { ws.onclose = null; ws.close(); }
  setConnected(false);

  ws = new WebSocket(`ws://${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join_room', room_id: roomId }));
    ws.send(JSON.stringify({ type: 'file_list' }));
    ws.send(JSON.stringify({ type: 'git_diff' }));
    setConnected(true);
  };

  ws.onmessage = e => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    handleWsMessage(msg);
  };

  ws.onclose = () => {
    setConnected(false);
    setTimeout(() => { if (currentRoomId === roomId) connectWS(roomId); }, 3000);
  };

  ws.onerror = e => console.warn('[ws] error', e);
}

function handleWsMessage(msg) {
  if (msg.type === 'history') {
    const inner = document.getElementById('messages-inner');
    inner.innerHTML = '';
    oldestMessageId = null;
    noMoreOlder = false;
    msg.messages.forEach(m => appendMessage(m));
    if (msg.messages.length > 0) oldestMessageId = msg.messages[0].id;
    noMoreOlder = msg.messages.length < 100;
    for (const m of msg.messages) {
      if (m.state === 'streaming' || m.state === 'requesting') {
        showThinking(m.id, m.actor_name, m.avatar_color, m.avatar_symbol, m.avatar_url);
        setComposerProcessing(m.id);
      }
    }
    scrollToBottom(true);
    return;
  }

  if (msg.type === 'message_new') {
    appendMessage(msg.message);
    scrollToBottom(true);
    return;
  }

  if (msg.type === 'system_event') {
    const dominated = ['requesting', 'idle'];
    if (dominated.includes(msg.status)) return;
    const inner = document.getElementById('messages-inner');
    if (!inner) return;
    const el = document.createElement('div');
    el.className = 'h-system-event';
    el.textContent = `${msg.actor_name || 'Agent'} · ${msg.status}`;
    inner.appendChild(el);
    scrollToBottom();
    return;
  }

  if (msg.type === 'message_deleted') {
    const row = document.getElementById('msg-' + msg.message_id);
    if (row) row.remove();
    return;
  }

  if (msg.type === 'message_state') {
    if ((msg.state === 'requesting' || msg.state === 'streaming') && msg.actor_name) {
      showThinking(msg.message_id, msg.actor_name, msg.avatar_color, msg.avatar_symbol, msg.avatar_url);
      setComposerProcessing(msg.message_id);
    }
    if (msg.state === 'error') {
      const el = document.getElementById('msg-' + msg.message_id);
      if (el) {
        const bubble = el.querySelector('.h-bubble, .h-thinking-bubble');
        if (bubble) { bubble.classList.remove('streaming'); bubble.textContent = '(error responding)'; }
      }
      clearComposerProcessing(msg.message_id);
    }
    return;
  }

  if (msg.type === 'message_token') {
    appendToken(msg.message_id, msg.token);
    return;
  }

  if (msg.type === 'message_complete') {
    finalizeMessage(msg.message_id, msg.content, msg.file_url, msg.file_name, msg.attachments);
    clearComposerProcessing(msg.message_id);
    refreshRoomList();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'file_list' }));
      ws.send(JSON.stringify({ type: 'git_diff' }));
    }
    if (document.visibilityState !== 'visible') {
      const el = document.getElementById('msg-' + msg.message_id);
      const actorName = el?.querySelector('.h-msg-name')?.textContent || 'Agent';
      showDesktopNotif(actorName, msg.content?.slice(0, 120), currentRoomId);
    }
    return;
  }

  if (msg.type === 'message_tool') {
    appendToolStep(msg.message_id, msg.tool);
    wsScheduleRefresh();
    return;
  }

  if (msg.type === 'model_update') {
    handleModelUpdate(msg);
    return;
  }

  if (msg.type === 'invite_suggestion') {
    showInviteCard(msg);
    return;
  }

  if (msg.type === 'skill_invoked') {
    const inner = document.getElementById('messages-inner');
    if (!inner) return;
    const notice = document.createElement('div');
    notice.className = 'h-skill-notice';
    const targets = msg.targets.map(n => n.toLowerCase()).join(', ');
    notice.textContent = `/${msg.skill_name} → ${targets}`;
    inner.appendChild(notice);
    scrollToBottom();
    return;
  }

  if (msg.type === 'system_notice') {
    const inner = document.getElementById('messages-inner');
    if (!inner) return;
    const notice = document.createElement('div');
    notice.className = 'h-skill-notice';
    notice.textContent = msg.text;
    inner.appendChild(notice);
    scrollToBottom();
    return;
  }

  if (msg.type === 'participant_joined') {
    const actor = allActors.find(a => a.id === msg.actor_id);
    const name = actor ? actor.name : 'Someone';
    const now = new Date();
    const ts = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const inner = document.getElementById('messages-inner');
    if (inner) {
      const notice = document.createElement('div');
      notice.className = 'h-system-event';
      notice.textContent = `${name} invited to this room · ${ts}`;
      inner.appendChild(notice);
      scrollToBottom();
    }
    if (currentRoomId) {
      fjson(`/api/rooms/${currentRoomId}/participants`).then(parts => {
        roomParticipantsCache[currentRoomId] = parts;
        renderRoomDots(currentRoomId, parts);
        const room = { id: currentRoomId, title: document.querySelector('.h-room-name')?.textContent || '' };
        renderChatHeader(room, parts);
      }).catch(() => {});
    }
    return;
  }

  if (msg.type === 'server_restart') {
    handleServerRestart(msg);
    return;
  }

  if (msg.type === 'file_list') {
    if (msg.error) { console.warn('[ws] file_list error:', msg.error); return; }
    wsFileTreeData = msg.tree || [];
    wsFileTreeRoot = msg.root || '';
    wsModifiedFiles = new Set(msg.modified || []);
    if (wsActiveView === 'files') wsRenderContent();
    return;
  }

  if (msg.type === 'file_read') {
    if (msg.error) { console.warn('[ws] file_read error:', msg.error); return; }
    const panel = document.getElementById('workspace-panel');
    if (!panel.classList.contains('open')) toggleWorkspacePanel();
    if (msg.base64) {
      const ext = wsGetExt(msg.path);
      const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', ico:'image/x-icon', bmp:'image/bmp' };
      const existing = wsOpenFiles.find(f => f.name === msg.path);
      if (existing) existing.base64 = msg.base64;
      else wsOpenFiles.push({ name: msg.path, content: '', base64: msg.base64, ext });
      wsActiveFile = msg.path;
      wsActiveView = 'file';
      wsRenderTabs();
      wsRenderContent();
    } else {
      wsOpenFile(msg.path, msg.content);
      if (msg.mtime) wsFileMtimes[msg.path] = msg.mtime;
    }
    return;
  }

  if (msg.type === 'git_diff') {
    if (msg.error) { console.warn('[ws] git_diff error:', msg.error); return; }
    wsGitDiffData = msg.files || [];
    const gitTab = document.querySelector('[data-ws-pin="git"]');
    if (gitTab) {
      let badge = gitTab.querySelector('.ws-git-badge');
      if (wsGitDiffData.length) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'ws-git-badge'; gitTab.appendChild(badge); }
        badge.textContent = wsGitDiffData.length;
      } else if (badge) { badge.remove(); }
    }
    if (wsActiveView === 'git') wsRenderContent();
    return;
  }

  if (msg.type === 'file_write_result') {
    if (msg.ok) {
      wsEditDirty = false;
      const f = wsOpenFiles.find(f => f.name === wsActiveFile);
      if (f) f.content = wsEditContent;
      if (msg.mtime) wsFileMtimes[msg.path] = msg.mtime;
      const key = 'stoa-draft-' + (currentRoomId || '') + '-' + msg.path;
      try { localStorage.removeItem(key); } catch {}
      wsRenderTabs();
      wsShowToast('File saved', 'success');
    } else if (msg.error === 'conflict') {
      if (msg.current_mtime) wsFileMtimes[msg.path] = msg.current_mtime;
      wsShowDialog('File changed', '<strong>' + wsEscHtml(msg.path?.split('/').pop()) + '</strong> was modified externally while you were editing. Overwrite the disk version with your edits, or reload?',
        [{ label: 'Cancel', cls: 'ghost' },
         { label: 'Overwrite', cls: 'danger', action: () => { delete wsFileMtimes[msg.path]; wsSaveFile(); } },
         { label: 'Reload', cls: 'primary', action: () => { wsEditMode = false; wsEditDirty = false; ws.send(JSON.stringify({ type: 'file_read', path: msg.path })); } }]);
    } else {
      wsShowToast('Save failed — ' + (msg.error || 'unknown error'), 'error');
    }
    wsEditSaving = false;
    wsRenderToolbarActions();
    return;
  }

  if (msg.type === 'file_create_result') {
    if (msg.ok) {
      wsShowToast('Created ' + msg.path, 'success');
      if (ws) ws.send(JSON.stringify({ type: 'file_list' }));
    } else { wsShowToast('Create failed — ' + (msg.error || 'unknown'), 'error'); }
    return;
  }

  if (msg.type === 'file_delete_result') {
    if (msg.ok) {
      wsCloseFile(msg.path);
      wsShowToast('Deleted', 'success');
      if (ws) ws.send(JSON.stringify({ type: 'file_list' }));
    } else { wsShowToast('Delete failed — ' + (msg.error || 'unknown'), 'error'); }
    return;
  }

  if (msg.type === 'file_rename_result') {
    if (msg.ok) {
      const f = wsOpenFiles.find(f => f.name === msg.path);
      if (f) { f.name = msg.new_path; if (wsActiveFile === msg.path) wsActiveFile = msg.new_path; }
      wsRenderTabs();
      wsShowToast('Renamed', 'success');
      if (ws) ws.send(JSON.stringify({ type: 'file_list' }));
    } else { wsShowToast('Rename failed — ' + (msg.error || 'unknown'), 'error'); }
    return;
  }
}

// ── Server restart notification ───────────────────────────────────────────
let pendingRestartUrl = null;
function handleServerRestart(msg) {
  pendingRestartUrl = msg.new_port;
  const newOrigin = location.protocol + '//' + location.hostname + ':' + msg.new_port;
  const banner = document.createElement('div');
  banner.className = 'h-restart-banner';
  banner.innerHTML = `Server berpindah ke port ${msg.new_port}. <a href="${newOrigin}${location.pathname}">Buka di tab baru</a> atau tunggu redirect otomatis...`;
  document.body.appendChild(banner);
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  if (globalWs) { globalWs.onclose = null; globalWs.close(); globalWs = null; }
  setTimeout(() => { location.href = newOrigin + location.pathname; }, 4000);
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

// ── Workspace panel ───────────────────────────────────────────────────────
const WS_FILE_COLORS = {
  js:   { tag: 'js',  c: '#c2876b' },
  jsx:  { tag: 'jsx', c: '#6f9f8c' },
  ts:   { tag: 'ts',  c: '#5b8fd4' },
  tsx:  { tag: 'tsx', c: '#5b8fd4' },
  md:   { tag: 'md',  c: '#5b8fd4' },
  json: { tag: '{}',  c: '#d39749' },
  css:  { tag: 'css', c: '#c08aa0' },
  html: { tag: 'htm', c: '#c2876b' },
  py:   { tag: 'py',  c: '#b59a5e' },
  sql:  { tag: 'sql', c: '#6f9f8c' },
};

function wsFileGlyph(ext, size = 15) {
  const m = WS_FILE_COLORS[ext] || { tag: '', c: 'var(--h-ink-faint)' };
  const el = document.createElement('span');
  el.className = 'ws-file-glyph ws-mono';
  el.style.cssText = `width:${size+3}px;height:${size+3}px;border:1px solid color-mix(in srgb,${m.c} 50%,transparent);background:color-mix(in srgb,${m.c} 14%,transparent);color:${m.c}`;
  el.textContent = m.tag;
  return el;
}

function wsGetExt(name) { return (name.match(/\.(\w+)$/) || [])[1] || ''; }

let wsActiveView = 'files';
let wsOpenFiles = [];
let wsActiveFile = null;
let wsFileTreeData = [];
let wsFileTreeRoot = '';
let wsGitDiffData = [];
let wsModifiedFiles = new Set();
let wsEditMode = false;
let wsEditDirty = false;
let wsEditContent = '';
let wsEditSaving = false;
let wsExpanded = false;
let wsCtxMenu = null;
const WS_EDITOR_CONTAINER_CSS = 'flex:1;min-height:0;display:flex;flex-direction:column;position:relative';
let wsFileMtimes = {};

function wsDownloadFile(relPath, fileName) {
  const fullPath = wsFileTreeRoot ? wsFileTreeRoot.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + relPath : relPath;
  const isAbs = /^\//.test(fullPath) || /^[A-Za-z]:/.test(fullPath);
  const imgExts = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp']);
  const ext = wsGetExt(fileName);
  const binary = imgExts.has(ext);

  const existing = wsOpenFiles.find(f => f.name === fullPath);
  if (existing && (existing.content || existing.base64)) {
    triggerDownload(fileName, existing.content, existing.base64, ext);
    return;
  }

  const handler = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type !== 'file_read' || (msg.path !== fullPath && msg.path !== relPath)) return;
    ws.removeEventListener('message', handler);
    if (msg.error) { showToast('Download failed: ' + msg.error, { error: true }); return; }
    triggerDownload(fileName, msg.content, msg.base64, ext);
  };
  ws.addEventListener('message', handler);
  setTimeout(() => ws.removeEventListener('message', handler), 15000);

  const req = { type: 'file_read', path: fullPath };
  if (binary) req.binary = true;
  if (isAbs) req.absolute = true;
  ws.send(JSON.stringify(req));
}

function triggerDownload(name, content, base64, ext) {
  let blob;
  if (base64) {
    const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', ico:'image/x-icon', bmp:'image/bmp', pdf:'application/pdf' };
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    blob = new Blob([arr], { type: mimeMap[ext] || 'application/octet-stream' });
  } else {
    blob = new Blob([content || ''], { type: 'text/plain;charset=utf-8' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

let wsRefreshTimer = null;
function wsScheduleRefresh() {
  if (wsRefreshTimer) clearTimeout(wsRefreshTimer);
  wsRefreshTimer = setTimeout(() => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'file_list' }));
      ws.send(JSON.stringify({ type: 'git_diff' }));
    }
    wsRefreshTimer = null;
  }, 5000);
}

function toggleWorkspacePanel() {
  const panel = document.getElementById('workspace-panel');
  const isOpen = panel.classList.toggle('open');
  document.querySelectorAll('.h-ws-toggle').forEach(b => b.classList.toggle('active', isOpen));
  if (isOpen) {
    const saved = localStorage.getItem('stoa-ws-panel-width');
    if (saved) panel.style.setProperty('--ws-panel-width', saved);
    if (ws && wsActiveView === 'files') ws.send(JSON.stringify({ type: 'file_list' }));
    if (ws && wsActiveView === 'git') ws.send(JSON.stringify({ type: 'git_diff' }));
    if (!window._cm && !wsCmLoading) wsLoadCodeMirror();
  }
}

// ── Editor functions ──────────────────────────────────────────────────────
function wsEnterEditMode() {
  if (wsEditMode) return;
  const file = wsOpenFiles.find(f => f.name === wsActiveFile);
  if (!file || !file.loaded) return;
  const IMG_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp']);
  if (IMG_EXTS.has(file.ext)) return;
  wsEditMode = true;
  wsEditContent = file.content || '';
  wsEditDirty = false;
  wsEditSaving = false;
  wsRenderContent();
  wsRenderTabs();
  wsCheckDraft();
}

function wsExitEditMode(force) {
  if (!wsEditMode) return;
  if (wsEditDirty && !force) {
    wsShowDialog('Discard changes?', 'You have unsaved changes to <strong>' + wsEscHtml(wsActiveFile?.split('/').pop()) + '</strong>. Close and discard them?',
      [{ label: 'Keep editing', cls: 'ghost' }, { label: 'Discard', cls: 'danger', action: () => wsExitEditMode(true) }]);
    return;
  }
  wsEditMode = false;
  wsEditContent = '';
  wsEditDirty = false;
  wsEditSaving = false;
  if (wsEditorView) { wsEditorView.destroy(); wsEditorView = null; }
  if (wsExpanded) wsToggleExpand();
  wsRenderContent();
  wsRenderTabs();
}

function wsSaveFile() {
  if (!wsEditMode || !wsActiveFile || wsEditSaving) return;
  if (!wsEditDirty) return;
  if (wsEditorView) wsEditContent = wsEditorView.state.doc.toString();
  wsEditSaving = true;
  wsRenderToolbarActions();
  const isAbs = /^\//.test(wsActiveFile) || /^[A-Za-z]:/.test(wsActiveFile);
  const req = { type: 'file_write', path: wsActiveFile, content: wsEditContent, absolute: isAbs };
  if (wsFileMtimes[wsActiveFile]) req.expected_mtime = wsFileMtimes[wsActiveFile];
  ws.send(JSON.stringify(req));
}

function wsToggleExpand() {
  wsExpanded = !wsExpanded;
  const panel = document.getElementById('workspace-panel');
  const chat = document.getElementById('chat-inner');
  panel.classList.toggle('ws-expanded', wsExpanded);
  if (chat) chat.style.display = wsExpanded ? 'none' : '';
  wsRenderToolbarActions();
}

function wsRenderToolbarActions() {
  const act = document.getElementById('ws-toolbar-actions');
  if (!act) return;
  act.innerHTML = '';
  if (wsActiveView === 'file' && wsActiveFile) {
    const file = wsOpenFiles.find(f => f.name === wsActiveFile);
    if (!file) return;
    const IMG_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp']);
    if (IMG_EXTS.has(file.ext)) return;
    if (wsEditMode) {
      const saveState = wsEditSaving ? 'saving' : wsEditDirty ? 'dirty' : 'clean';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'ws-edit-btn ' + (saveState === 'saving' ? 'accent-muted' : saveState === 'dirty' ? 'accent' : 'ghost');
      saveBtn.textContent = saveState === 'saving' ? 'Saving…' : 'Save';
      saveBtn.disabled = saveState === 'saving';
      saveBtn.onclick = wsSaveFile;
      act.appendChild(saveBtn);
      const expBtn = document.createElement('button');
      expBtn.className = 'ws-icon-btn';
      expBtn.title = wsExpanded ? 'Collapse' : 'Expand';
      expBtn.innerHTML = wsExpanded
        ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M9 4v5H4"/><path d="M10 10 4 4"/><path d="M15 20v-5h5"/><path d="M14 14l6 6"/></svg>'
        : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 9V4h5"/><path d="M4 4l6 6"/><path d="M20 15v5h-5"/><path d="M20 20l-6-6"/></svg>';
      expBtn.onclick = wsToggleExpand;
      act.appendChild(expBtn);
      const exitBtn = document.createElement('button');
      exitBtn.className = 'ws-icon-btn';
      exitBtn.title = 'Exit edit mode';
      exitBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      exitBtn.onclick = () => wsExitEditMode();
      act.appendChild(exitBtn);
    } else {
      const dlBtn = document.createElement('button');
      dlBtn.className = 'ws-icon-btn';
      dlBtn.title = 'Download';
      dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 4v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>';
      dlBtn.onclick = () => wsDownloadFile(wsActiveFile, wsActiveFile.split('/').pop());
      act.appendChild(dlBtn);
      const editBtn = document.createElement('button');
      editBtn.className = 'ws-edit-btn ghost';
      editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M16.5 4.5l3 3L8 19l-3.5.5L5 16z"/><path d="M14 7l3 3"/></svg> Edit';
      editBtn.onclick = wsEnterEditMode;
      act.appendChild(editBtn);
    }
  }
}

let wsEditorView = null;
let wsCmLoading = false;

async function wsLoadCodeMirror() {
  if (window._cm) return window._cm;
  if (wsCmLoading) return null;
  wsCmLoading = true;
  try {
    const cmMod = await import('https://esm.sh/codemirror');
    const viewMod = await import('https://esm.sh/@codemirror/view');
    const stateMod = await import('https://esm.sh/@codemirror/state');
    const langMod = await import('https://esm.sh/@codemirror/language');
    const lezerHL = await import('https://esm.sh/@lezer/highlight');
    const [jsLang, pyLang, jsonLang, mdLang, htmlLang, cssLang] = await Promise.all([
      import('https://esm.sh/@codemirror/lang-javascript'),
      import('https://esm.sh/@codemirror/lang-python'),
      import('https://esm.sh/@codemirror/lang-json'),
      import('https://esm.sh/@codemirror/lang-markdown'),
      import('https://esm.sh/@codemirror/lang-html'),
      import('https://esm.sh/@codemirror/lang-css'),
    ]);
    const { EditorView } = viewMod;
    const { EditorState } = stateMod;
    const { HighlightStyle, syntaxHighlighting } = langMod;
    const { tags } = lezerHL;
    const hearthTheme = EditorView.theme({
      '&': { backgroundColor: 'oklch(0.193 0.016 44)', color: '#d3c8b4', fontSize: '13px', height: '100%' },
      '.cm-content': { caretColor: 'oklch(0.78 0.085 78)', fontFamily: "'SF Mono','Cascadia Code','Fira Code','JetBrains Mono',ui-monospace,monospace", padding: '10px 0' },
      '.cm-cursor': { borderLeftColor: 'oklch(0.78 0.085 78)', borderLeftWidth: '2px' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, oklch(0.78 0.085 78) 32%, transparent) !important' },
      '.cm-gutters': { backgroundColor: 'oklch(0.193 0.016 44)', color: '#7a7060', borderRight: '1px solid rgba(255,255,255,.07)', minWidth: '40px' },
      '.cm-gutter': { fontFamily: "'SF Mono','Cascadia Code','Fira Code','JetBrains Mono',ui-monospace,monospace" },
      '.cm-activeLineGutter': { color: '#d3c8b4', backgroundColor: 'transparent' },
      '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.045)' },
      '.cm-matchingBracket': { backgroundColor: 'rgba(255,255,255,.12)', outline: 'none' },
      '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, oklch(0.78 0.085 78) 30%, transparent)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, oklch(0.78 0.085 78) 55%, transparent)' },
      '.cm-panels': { backgroundColor: 'oklch(0.17 0.012 44)', color: '#d3c8b4' },
      '.cm-panels input, .cm-panels button': { color: '#d3c8b4' },
      '.cm-scroller': { overflow: 'auto', lineHeight: '21px' },
      '&::-webkit-scrollbar, .cm-scroller::-webkit-scrollbar': { width: '8px', height: '8px' },
      '&::-webkit-scrollbar-thumb, .cm-scroller::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,.12)', borderRadius: '4px' },
    }, { dark: true });
    const hearthHighlight = HighlightStyle.define([
      { tag: tags.keyword, color: '#c2876b' },
      { tag: tags.string, color: '#b59a5e' },
      { tag: tags.comment, color: '#837868', fontStyle: 'italic' },
      { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#6f9f8c' },
      { tag: tags.number, color: '#c08aa0' },
      { tag: tags.variableName, color: '#d3c8b4' },
      { tag: tags.punctuation, color: '#9a8f7e' },
      { tag: tags.operator, color: '#9a8f7e' },
      { tag: tags.typeName, color: '#c2876b' },
      { tag: tags.bool, color: '#c2876b' },
      { tag: tags.null, color: '#c2876b' },
      { tag: tags.propertyName, color: '#d3c8b4' },
      { tag: tags.definition(tags.variableName), color: '#6f9f8c' },
    ]);
    const langMap = {
      js: jsLang.javascript, jsx: () => jsLang.javascript({ jsx: true }), ts: () => jsLang.javascript({ typescript: true }),
      tsx: () => jsLang.javascript({ typescript: true, jsx: true }), py: pyLang.python, json: jsonLang.json,
      md: mdLang.markdown, html: htmlLang.html, css: cssLang.css,
    };
    window._cm = { EditorView, EditorState, basicSetup: cmMod.basicSetup, hearthTheme, hearthHighlight: syntaxHighlighting(hearthHighlight), langMap, keymap: viewMod.keymap };
    wsCmLoading = false;
    return window._cm;
  } catch (e) {
    console.warn('[ws] CodeMirror load failed, using textarea:', e);
    fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'CM load FAILED: ' + e.message, source: e.stack }) }).catch(() => {});
    wsCmLoading = false;
    return null;
  }
}

function wsRenderEditor(container) {
  container.className = '';
  container.style.cssText = WS_EDITOR_CONTAINER_CSS;
  wsEditorView = null;
  if (window._cm) {
    wsRenderCMEditor(container);
  } else if (wsCmLoading) {
    const loading = document.createElement('div');
    loading.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;background:oklch(0.193 0.016 44);color:#7a7060;font-family:var(--h-sans);font-size:13px';
    loading.textContent = 'loading editor…';
    container.appendChild(loading);
    const check = setInterval(() => {
      if (window._cm) { clearInterval(check); if (wsEditMode) { const c = document.getElementById('ws-panel-content'); if (c) { c.innerHTML = ''; c.className = ''; c.style.cssText = WS_EDITOR_CONTAINER_CSS; wsRenderCMEditor(c); } } }
      if (!wsCmLoading && !window._cm) { clearInterval(check); if (wsEditMode) { const c = document.getElementById('ws-panel-content'); if (c) { c.innerHTML = ''; c.className = ''; c.style.cssText = WS_EDITOR_CONTAINER_CSS; wsRenderTextareaEditor(c); } } }
    }, 100);
    setTimeout(() => clearInterval(check), 30000);
  } else {
    wsLoadCodeMirror().then(cm => {
      if (cm && wsEditMode) {
        const c = document.getElementById('ws-panel-content');
        if (c) { c.innerHTML = ''; c.className = ''; c.style.cssText = WS_EDITOR_CONTAINER_CSS; wsRenderCMEditor(c); }
      } else if (!cm && wsEditMode) {
        const c = document.getElementById('ws-panel-content');
        if (c) { c.innerHTML = ''; c.className = ''; c.style.cssText = WS_EDITOR_CONTAINER_CSS; wsRenderTextareaEditor(c); }
      }
    }).catch(() => {});
  }
}

function wsRenderCMEditor(container) {
  try {
    const cm = window._cm;
    const ext = wsActiveFile ? wsGetExt(wsActiveFile) : '';
    const langFn = cm.langMap[ext];
    const extensions = [
      cm.basicSetup,
      cm.hearthTheme,
      cm.hearthHighlight,
      cm.EditorView.updateListener.of(update => {
        if (update.docChanged) {
          wsEditContent = update.state.doc.toString();
          if (!wsEditDirty) { wsEditDirty = true; wsRenderTabs(); wsRenderToolbarActions(); }
          wsAutoSaveDraft();
        }
      }),
      cm.keymap.of([
        { key: 'Mod-s', run: () => { wsSaveFile(); return true; } },
        { key: 'Ctrl-Shift-d', run: (view) => { const s = view.state, sel = s.selection.main, line = s.doc.lineAt(sel.head), text = s.doc.sliceString(line.from, line.to); view.dispatch({ changes: { from: line.to, insert: '\n' + text }, selection: { anchor: sel.head + text.length + 1 } }); return true; } },
        { key: 'Alt-Shift-ArrowDown', run: (view) => { const s = view.state, sel = s.selection.main, line = s.doc.lineAt(sel.head), text = s.doc.sliceString(line.from, line.to); view.dispatch({ changes: { from: line.to, insert: '\n' + text }, selection: { anchor: sel.head + text.length + 1 } }); return true; } },
        { key: 'Alt-Shift-ArrowUp', run: (view) => { const s = view.state, sel = s.selection.main, line = s.doc.lineAt(sel.head), text = s.doc.sliceString(line.from, line.to); view.dispatch({ changes: { from: line.from, insert: text + '\n' } }); return true; } },
      ]),
    ];
    if (langFn) extensions.push(typeof langFn === 'function' ? langFn() : langFn());
    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex:1;min-height:0;overflow:hidden';
    container.appendChild(wrap);
    wsEditorView = new cm.EditorView({
      state: cm.EditorState.create({ doc: wsEditContent, extensions }),
      parent: wrap,
    });
    wsEditorView.focus();
  } catch (e) {
    console.warn('[ws-editor] CodeMirror render failed, falling back to textarea:', e);
    fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'CM render FAILED: ' + e.message, source: e.stack }) }).catch(() => {});
    window._cm = null;
    container.innerHTML = '';
    wsRenderTextareaEditor(container);
  }
}

function wsRenderTextareaEditor(container) {
  const wrap = document.createElement('div');
  wrap.className = 'ws-editor-wrap';
  const lines = wsEditContent.split('\n');
  const gutW = String(Math.max(lines.length, 2)).length * 9 + 26;
  const gutter = document.createElement('div');
  gutter.className = 'ws-editor-gutter';
  gutter.style.width = gutW + 'px';
  gutter.textContent = lines.map((_, i) => i + 1).join('\n');
  const ta = document.createElement('textarea');
  ta.className = 'ws-editor-ta';
  ta.spellcheck = false;
  ta.value = wsEditContent;
  ta.addEventListener('input', () => {
    wsEditContent = ta.value;
    if (!wsEditDirty) { wsEditDirty = true; wsRenderTabs(); wsRenderToolbarActions(); wsAutoSaveDraft(); }
    else { wsAutoSaveDraft(); }
    const newLines = ta.value.split('\n');
    const newGutW = String(Math.max(newLines.length, 2)).length * 9 + 26;
    gutter.style.width = newGutW + 'px';
    gutter.textContent = newLines.map((_, i) => i + 1).join('\n');
  });
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); wsSaveFile(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      const nv = wsEditContent.slice(0, s) + '  ' + wsEditContent.slice(en);
      wsEditContent = nv; ta.value = nv;
      ta.selectionStart = ta.selectionEnd = s + 2;
      if (!wsEditDirty) { wsEditDirty = true; wsRenderTabs(); wsRenderToolbarActions(); }
      const nl = nv.split('\n');
      gutter.style.width = (String(Math.max(nl.length, 2)).length * 9 + 26) + 'px';
      gutter.textContent = nl.map((_, i) => i + 1).join('\n');
    }
  });
  wrap.appendChild(gutter);
  wrap.appendChild(ta);
  container.appendChild(wrap);
  ta.focus();
}

function wsShowToast(message, kind) {
  let stack = document.querySelector('.ws-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'ws-toast-stack';
    const panel = document.getElementById('ws-panel-body') || document.getElementById('workspace-panel');
    if (panel) { panel.style.position = 'relative'; panel.appendChild(stack); }
  }
  const toast = document.createElement('div');
  toast.className = 'ws-toast';
  const iconColor = kind === 'error' ? '#c08378' : '#7faa7c';
  const iconSvg = kind === 'error'
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 4.5l8.5 15H3.5z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.6" r=".7" fill="currentColor" stroke="none"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  toast.innerHTML = '<span style="color:' + iconColor + ';display:inline-flex;flex:0 0 auto">' + iconSvg + '</span><span style="flex:1;line-height:1.4">' + wsEscHtml(message) + '</span>';
  if (kind === 'error') {
    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'border:none;background:transparent;color:var(--h-ink-faint);cursor:pointer;padding:2px;display:inline-flex';
    closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    closeBtn.onclick = () => toast.remove();
    toast.appendChild(closeBtn);
  }
  stack.appendChild(toast);
  if (kind !== 'error') setTimeout(() => toast.remove(), 2500);
}

function wsShowDialog(title, bodyHtml, actions) {
  const panel = document.getElementById('ws-panel-body') || document.getElementById('workspace-panel');
  if (!panel) return;
  const existing = panel.querySelector('.ws-scrim');
  if (existing) existing.remove();
  const scrim = document.createElement('div');
  scrim.className = 'ws-scrim';
  const dialog = document.createElement('div');
  dialog.className = 'ws-dialog';
  dialog.style.width = '420px';
  dialog.innerHTML = '<div class="h-serif" style="font-size:20px;color:var(--h-ink);margin-bottom:13px">' + wsEscHtml(title) + '</div>'
    + '<div style="font-family:var(--h-sans);font-size:14px;line-height:1.62;color:var(--h-ink-mute);margin-bottom:22px">' + DOMPurify.sanitize(bodyHtml) + '</div>';
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:9px;justify-content:flex-end;flex-wrap:wrap';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'ws-edit-btn ' + (a.cls || 'ghost');
    btn.textContent = a.label;
    btn.onclick = () => { scrim.remove(); if (a.action) a.action(); };
    btns.appendChild(btn);
  });
  dialog.appendChild(btns);
  scrim.appendChild(dialog);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  panel.style.position = 'relative';
  panel.appendChild(scrim);
}

function wsEscHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

function wsShowCtxMenu(x, y, relPath, isDir) {
  wsCloseCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'ws-ctx-menu';
  const panelRect = document.getElementById('ws-panel-body')?.getBoundingClientRect();
  menu.style.left = (panelRect ? x - panelRect.left : x) + 'px';
  menu.style.top = (panelRect ? y - panelRect.top : y) + 'px';
  const items = [
    { label: 'New File', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 4h9l5 5v11H5z"/><path d="M14 4v5h5"/><path d="M12 12v5M9.5 14.5h5"/></svg>', action: () => wsPromptNewFile(isDir ? relPath : relPath.split('/').slice(0, -1).join('/')) },
    { label: 'New Folder', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/></svg>', action: () => wsPromptNewFolder(isDir ? relPath : relPath.split('/').slice(0, -1).join('/')) },
    { div: true },
    { label: 'Rename', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M16.5 4.5l3 3L8 19l-3.5.5L5 16z"/><path d="M14 7l3 3"/></svg>', action: () => wsPromptRename(relPath) },
    { div: true },
    { label: 'Delete', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4.5 7h15"/><path d="M9.5 7V5.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7l.9 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.5 7"/></svg>', danger: true, action: () => wsConfirmDelete(relPath) },
  ];
  items.forEach(it => {
    if (it.div) { const d = document.createElement('div'); d.style.cssText = 'height:1px;background:var(--h-hair-soft);margin:5px 7px'; menu.appendChild(d); return; }
    const item = document.createElement('div');
    item.className = 'ws-ctx-item' + (it.danger ? ' danger' : '');
    item.innerHTML = '<span style="display:inline-flex;color:' + (it.danger ? '#c08378' : 'var(--h-ink-mute)') + '">' + it.icon + '</span><span style="flex:1">' + it.label + '</span>';
    item.onclick = () => { wsCloseCtxMenu(); it.action(); };
    menu.appendChild(item);
  });
  const panel = document.getElementById('ws-panel-body');
  if (panel) { panel.style.position = 'relative'; panel.appendChild(menu); }
  setTimeout(() => document.addEventListener('click', wsCloseCtxMenu, { once: true }), 0);
}

function wsCloseCtxMenu() {
  document.querySelectorAll('.ws-ctx-menu').forEach(m => m.remove());
}

function wsShowPrompt(title, defaultValue, placeholder, callback) {
  const panel = document.getElementById('ws-panel-body') || document.getElementById('workspace-panel');
  if (!panel) return;
  const existing = panel.querySelector('.ws-scrim');
  if (existing) existing.remove();
  const scrim = document.createElement('div');
  scrim.className = 'ws-scrim';
  const dialog = document.createElement('div');
  dialog.className = 'ws-dialog';
  dialog.style.width = '380px';
  dialog.innerHTML = '<div class="h-serif" style="font-size:20px;color:var(--h-ink);margin-bottom:16px">' + wsEscHtml(title) + '</div>';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = defaultValue || '';
  input.placeholder = placeholder || '';
  input.spellcheck = false;
  input.style.cssText = 'width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--h-hair-soft);background:var(--h-bg);color:var(--h-ink);font-family:var(--h-sans);font-size:14px;outline:none;margin-bottom:18px;box-sizing:border-box';
  input.addEventListener('focus', () => { input.style.borderColor = 'oklch(0.78 0.085 78)'; input.style.boxShadow = '0 0 0 3px color-mix(in srgb, oklch(0.78 0.085 78) 22%, transparent)'; });
  input.addEventListener('blur', () => { input.style.borderColor = 'var(--h-hair-soft)'; input.style.boxShadow = 'none'; });
  dialog.appendChild(input);
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:9px;justify-content:flex-end';
  const submit = () => { const v = input.value.trim(); scrim.remove(); if (v) callback(v); };
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'ws-edit-btn ghost';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => scrim.remove();
  btns.appendChild(cancelBtn);
  const okBtn = document.createElement('button');
  okBtn.className = 'ws-edit-btn primary';
  okBtn.textContent = 'OK';
  okBtn.onclick = submit;
  btns.appendChild(okBtn);
  dialog.appendChild(btns);
  scrim.appendChild(dialog);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') scrim.remove(); });
  panel.style.position = 'relative';
  panel.appendChild(scrim);
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

function wsPromptNewFile(parentDir) {
  wsShowPrompt('New file', '', 'filename.js', (name) => {
    const filePath = parentDir ? parentDir + '/' + name : name;
    ws.send(JSON.stringify({ type: 'file_create', path: filePath, is_dir: false }));
  });
}

function wsPromptNewFolder(parentDir) {
  wsShowPrompt('New folder', '', 'folder-name', (name) => {
    const filePath = parentDir ? parentDir + '/' + name : name;
    ws.send(JSON.stringify({ type: 'file_create', path: filePath, is_dir: true }));
  });
}

function wsPromptRename(relPath) {
  const oldName = relPath.split('/').pop();
  wsShowPrompt('Rename', oldName, oldName, (newName) => {
    if (newName === oldName) return;
    const parentDir = relPath.split('/').slice(0, -1).join('/');
    const newPath = parentDir ? parentDir + '/' + newName : newName;
    ws.send(JSON.stringify({ type: 'file_rename', path: relPath, new_path: newPath }));
  });
}

function wsConfirmDelete(relPath) {
  const fileName = relPath.split('/').pop();
  wsShowDialog('Delete file?', 'Delete <strong>' + wsEscHtml(fileName) + '</strong>? This removes it from disk and can\'t be undone.',
    [{ label: 'Cancel', cls: 'ghost' }, { label: 'Delete', cls: 'danger', action: () => ws.send(JSON.stringify({ type: 'file_delete', path: relPath })) }]);
}

let wsDraftTimer = null;
function wsAutoSaveDraft() {
  if (!wsActiveFile || !wsEditMode) return;
  if (wsDraftTimer) return;
  wsDraftTimer = setTimeout(() => {
    wsDraftTimer = null;
    if (!wsActiveFile || !wsEditMode) return;
    const key = 'stoa-draft-' + (currentRoomId || '') + '-' + wsActiveFile;
    try { localStorage.setItem(key, JSON.stringify({ content: wsEditContent, ts: Date.now() })); } catch {}
  }, 3000);
}

function wsCheckDraft() {
  if (!wsActiveFile) return;
  const key = 'stoa-draft-' + (currentRoomId || '') + '-' + wsActiveFile;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const draft = JSON.parse(raw);
    const file = wsOpenFiles.find(f => f.name === wsActiveFile);
    if (!file || !file.loaded) return;
    if (draft.content === file.content) { localStorage.removeItem(key); return; }
    const ago = Math.round((Date.now() - draft.ts) / 60000);
    const agoText = ago < 1 ? 'just now' : ago + ' minute' + (ago > 1 ? 's' : '') + ' ago';
    wsShowDialog('Recover draft?', 'Found unsaved changes to <strong>' + wsEscHtml(wsActiveFile.split('/').pop()) + '</strong> from ' + agoText + '. Pick up where you left off?',
      [{ label: 'Discard', cls: 'ghost', action: () => localStorage.removeItem(key) },
       { label: 'Recover draft', cls: 'primary', action: () => { wsEditContent = draft.content; wsEditDirty = true; wsEnterEditMode(); localStorage.removeItem(key); } }]);
  } catch {}
}

function wsSetView(view) {
  wsActiveView = view;
  wsActiveFile = null;
  document.querySelectorAll('.ws-pin-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.wsPin === view);
  });
  if (view === 'files' && ws) ws.send(JSON.stringify({ type: 'file_list' }));
  if (view === 'git' && ws) ws.send(JSON.stringify({ type: 'git_diff' }));
  wsRenderContent();
}

function wsOpenFile(name, content) {
  const existing = wsOpenFiles.find(f => f.name === name);
  if (existing) {
    if (content != null) { existing.content = content; existing.loaded = true; }
  } else {
    wsOpenFiles.push({ name, content: content ?? '', ext: wsGetExt(name), loaded: content != null });
  }
  const imgExts = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp']);
  const fileExt = wsGetExt(name);
  const isAbs = /^\//.test(name) || /^[A-Za-z]:/.test(name);
  if (content == null && ws) {
    const req = { type: 'file_read', path: name };
    if (imgExts.has(fileExt)) req.binary = true;
    if (isAbs) req.absolute = true;
    ws.send(JSON.stringify(req));
  }
  wsActiveFile = name;
  wsActiveView = 'file';
  document.querySelectorAll('.ws-pin-tab').forEach(t => t.classList.remove('active'));
  wsRenderTabs();
  wsRenderContent();
}

function wsRenderFileTree(container, nodes, parentPath) {
  nodes.forEach(node => {
    const row = document.createElement('div');
    row.className = 'ws-tree-row';
    row.style.paddingLeft = (8 + node.depth * 16) + 'px';

    if (node.t === 'folder') {
      const chevron = document.createElement('span');
      chevron.className = 'ws-tree-chevron' + (node.open ? ' open' : '');
      chevron.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
      row.appendChild(chevron);
      const folderIcon = document.createElement('span');
      folderIcon.style.cssText = 'color:var(--h-ink-mute);display:inline-flex';
      folderIcon.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
      row.appendChild(folderIcon);
      const nameEl = document.createElement('span');
      nameEl.className = 'ws-tree-name folder';
      nameEl.textContent = node.name;
      row.appendChild(nameEl);

      const childContainer = document.createElement('div');
      childContainer.style.display = node.open ? '' : 'none';

      row.onclick = () => {
        node.open = !node.open;
        chevron.classList.toggle('open', node.open);
        childContainer.style.display = node.open ? '' : 'none';
      };
      const folderRelPath = parentPath ? parentPath + '/' + node.name : node.name;
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); wsShowCtxMenu(e.clientX, e.clientY, folderRelPath, true); });

      container.appendChild(row);
      if (node.children) {
        wsRenderFileTree(childContainer, node.children, parentPath ? parentPath + '/' + node.name : node.name);
      }
      container.appendChild(childContainer);
    } else {
      const spacer = document.createElement('span');
      spacer.style.cssText = 'width:12px;flex:0 0 auto';
      row.appendChild(spacer);
      row.appendChild(wsFileGlyph(node.t, 14));
      const nameEl = document.createElement('span');
      nameEl.className = 'ws-tree-name file';
      nameEl.textContent = node.name;
      row.appendChild(nameEl);

      const relPath = parentPath ? parentPath + '/' + node.name : node.name;
      const dlBtn = document.createElement('button');
      dlBtn.className = 'ws-dl';
      dlBtn.title = 'Download ' + node.name;
      dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>';
      dlBtn.onclick = (e) => { e.stopPropagation(); wsDownloadFile(relPath, node.name); };
      row.appendChild(dlBtn);
      if (wsModifiedFiles.has(relPath) || wsModifiedFiles.has(node.name)) {
        const dot = document.createElement('span');
        dot.className = 'ws-tree-modified';
        dot.title = 'modified';
        dot.style.background = '#d39749';
        row.appendChild(dot);
      }
      const fullPath = wsFileTreeRoot ? wsFileTreeRoot.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + relPath : relPath;
      row.onclick = () => {
        const panel = document.getElementById('workspace-panel');
        if (!panel.classList.contains('open')) toggleWorkspacePanel();
        wsOpenFile(fullPath);
      };
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); wsShowCtxMenu(e.clientX, e.clientY, relPath, false); });
      container.appendChild(row);
    }
  });
}

function wsCloseFile(name) {
  if (wsEditMode && wsActiveFile === name && wsEditDirty) {
    wsShowDialog('Discard changes?', 'You have unsaved changes to <strong>' + wsEscHtml(name.split('/').pop()) + '</strong>. Close and discard them?',
      [{ label: 'Keep editing', cls: 'ghost' }, { label: 'Discard', cls: 'danger', action: () => { wsEditMode = false; wsEditDirty = false; wsCloseFile(name); } }]);
    return;
  }
  if (wsActiveFile === name) { wsEditMode = false; wsEditDirty = false; wsEditContent = ''; if (wsEditorView) { wsEditorView.destroy(); wsEditorView = null; } if (wsExpanded) wsToggleExpand(); }
  const key = 'stoa-draft-' + (currentRoomId || '') + '-' + name;
  try { localStorage.removeItem(key); } catch {}
  wsOpenFiles = wsOpenFiles.filter(f => f.name !== name);
  if (wsActiveFile === name) {
    wsActiveFile = wsOpenFiles.length ? wsOpenFiles[wsOpenFiles.length - 1].name : null;
    if (!wsActiveFile) wsActiveView = 'files';
  }
  wsRenderTabs();
  wsRenderContent();
}

function wsRenderTabs() {
  const list = document.getElementById('ws-tab-list');
  if (!list) return;
  list.innerHTML = '';
  wsOpenFiles.forEach(f => {
    const tab = document.createElement('div');
    tab.className = 'ws-file-tab' + (f.name === wsActiveFile ? ' active' : '');
    const isUnsaved = wsEditMode && wsEditDirty && f.name === wsActiveFile;
    if (isUnsaved) {
      const dot = document.createElement('span');
      dot.className = 'ws-file-tab-unsaved';
      dot.title = 'unsaved changes';
      tab.appendChild(dot);
    } else {
      tab.appendChild(wsFileGlyph(f.ext, 13));
    }
    const nameEl = document.createElement('span');
    nameEl.className = 'ws-file-tab-name';
    nameEl.textContent = f.name.split('/').pop();
    tab.appendChild(nameEl);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ws-file-tab-close';
    closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    closeBtn.onclick = (e) => { e.stopPropagation(); wsCloseFile(f.name); };
    tab.appendChild(closeBtn);
    const indicator = document.createElement('span');
    indicator.className = 'ws-tab-indicator';
    tab.appendChild(indicator);
    tab.onclick = () => wsOpenFile(f.name, f.content);
    list.appendChild(tab);
  });
}

function wsSetToolbar(crumbs, actions) {
  const toolbar = document.getElementById('ws-toolbar');
  const bc = document.getElementById('ws-breadcrumb');
  const act = document.getElementById('ws-toolbar-actions');
  if (!crumbs || !crumbs.length) { toolbar.style.display = 'none'; return; }
  toolbar.style.display = '';
  bc.innerHTML = '';
  crumbs.forEach((c, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'ws-crumb-sep';
      sep.textContent = '/';
      bc.appendChild(sep);
    }
    const s = document.createElement('span');
    s.className = 'ws-crumb';
    s.textContent = c;
    bc.appendChild(s);
  });
  act.innerHTML = '';
  if (actions) act.appendChild(actions);
}

function wsRenderContent() {
  const content = document.getElementById('ws-panel-content');
  const banner = document.getElementById('ws-editing-banner');
  content.innerHTML = '';
  banner.innerHTML = '';

  if (wsActiveView === 'files') {
    wsSetToolbar(null);
    if (wsFileTreeData.length) {
      content.className = 'ws-tree ws-scroll';
      content.style.cssText = '';
      wsRenderFileTree(content, wsFileTreeData, '');
    } else {
      content.innerHTML = `<div class="ws-empty-state">
        <span class="ws-empty-icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h7M4 12h10M4 18h6"/><circle cx="18" cy="6" r="1.4" fill="currentColor" stroke="none"/></svg></span>
        <div class="ws-empty-title">nothing open yet</div>
        <div class="ws-empty-text">open a file, or click a file reference in the chat to read it here.</div>
      </div>`;
    }
    return;
  }

  if (wsActiveView === 'git') {
    if (wsGitDiffData.length) {
      wsSetToolbar(['working tree', wsGitDiffData.length + ' file' + (wsGitDiffData.length > 1 ? 's' : '') + ' changed']);
      wsGitDiffData.forEach(file => {
        const hdr = document.createElement('div');
        hdr.className = 'ws-diff-file-header';
        hdr.appendChild(wsFileGlyph(wsGetExt(file.name), 14));
        const fname = document.createElement('span');
        fname.className = 'ws-mono';
        fname.style.cssText = 'font-size:12.5px;color:var(--h-ink)';
        fname.textContent = file.name;
        hdr.appendChild(fname);
        hdr.appendChild(document.createElement('span')).style.flex = '1';
        const stat = document.createElement('span');
        stat.className = 'ws-diff-stat';
        stat.innerHTML = `<span class="ws-diff-add">+${file.add}</span><span class="ws-diff-del">−${file.del}</span>`;
        hdr.appendChild(stat);
        content.appendChild(hdr);
        const diffContainer = document.createElement('div');
        wsRenderDiff(diffContainer, file.hunks, 'unified');
        content.appendChild(diffContainer);
      });
    } else {
      wsSetToolbar(['working tree']);
      content.innerHTML = `<div class="ws-empty-state">
        <span class="ws-empty-icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="6" r="2.2"/><circle cx="6.5" cy="18" r="2.2"/><circle cx="17.5" cy="8" r="2.2"/><path d="M6.5 8.2v7.6M8.7 8c4 .2 6.5 1 8.6 .2M17.5 10.2c0 3.2-3 4.6-6.2 4.8"/></svg></span>
        <div class="ws-empty-title">no changes</div>
        <div class="ws-empty-text">working tree is clean.</div>
      </div>`;
    }
    return;
  }

  if (wsActiveView === 'file' && wsActiveFile) {
    const file = wsOpenFiles.find(f => f.name === wsActiveFile);
    if (!file) return;
    const ext = file.ext;
    const parts = file.name.split('/');
    wsSetToolbar(parts);
    wsRenderToolbarActions();

    const IMG_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp']);
    if (IMG_EXTS.has(ext)) {
      content.className = 'ws-scroll';
      content.style.cssText = 'flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,var(--h-ink) 4%,var(--h-bg))';
      const img = document.createElement('img');
      const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', ico:'image/x-icon', bmp:'image/bmp' };
      if (file.base64) {
        img.src = `data:${mimeMap[ext] || 'image/png'};base64,${file.base64}`;
      } else {
        img.src = `/api/workspace/file?room=${currentRoomId}&path=${encodeURIComponent(file.name)}`;
      }
      img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.12)';
      img.alt = file.name;
      content.appendChild(img);
      return;
    }

    if (wsEditMode) {
      wsRenderEditor(content);
      return;
    }

    if (ext === 'md' && file.loaded) {
      content.className = 'ws-scroll ws-md-view';
      content.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:26px 30px 40px';
      const inner = document.createElement('div');
      inner.className = 'ws-md-body';
      inner.innerHTML = file.content ? DOMPurify.sanitize(marked.parse(file.content), { ADD_ATTR: ['class'] }) : '<p style="color:var(--h-ink-faint);font-style:italic">empty file</p>';
      addCopyButtons(inner);
      content.appendChild(inner);
    } else if (file.loaded) {
      wsRenderCodeViewer(content, file.content || '', file.name);
    } else {
      content.innerHTML = `<div class="ws-empty-state">
        <div class="ws-empty-title">loading…</div>
        <div class="ws-empty-text">fetching file from agent.</div>
      </div>`;
    }
  }
}

function wsRenderCodeViewer(container, text, fileName) {
  const lines = text.split('\n');
  const gutW = String(lines.length).length * 9 + 22;
  container.className = 'ws-code ws-mono ws-code-viewer';
  container.style.cssText = '';
  const ext = fileName ? wsGetExt(fileName) : '';
  const langMap = { js:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript', py:'python', json:'json', html:'xml', css:'css', sql:'sql', sh:'bash', yml:'yaml', yaml:'yaml', xml:'xml', rb:'ruby', go:'go', rs:'rust', java:'java', c:'c', cpp:'cpp', ps1:'powershell' };
  const lang = langMap[ext] || null;
  let hlLines = null;
  try {
    const hlText = lang ? hljs.highlight(text, { language: lang }).value : hljs.highlightAuto(text).value;
    hlLines = hlText.split('\n');
  } catch {}
  const table = document.createElement('div');
  table.className = 'ws-code-table';
  lines.forEach((ln, i) => {
    const row = document.createElement('div');
    row.className = 'ws-code-line';
    const gutter = document.createElement('span');
    gutter.className = 'ws-code-gutter';
    gutter.style.cssText = `width:${gutW}px;min-width:${gutW}px`;
    gutter.textContent = i + 1;
    row.appendChild(gutter);
    const code = document.createElement('span');
    code.className = 'ws-code-text';
    if (hlLines && hlLines[i] != null) { code.innerHTML = hlLines[i] || "&nbsp;"; } else { code.textContent = ln || " "; }
    row.appendChild(code);
    table.appendChild(row);
  });
  container.appendChild(table);
}

function wsRenderDiff(container, diffData, mode) {
  const table = document.createElement('div');
  table.className = 'ws-code-table';
  diffData.forEach(r => {
    if (r.k === 'hunk') {
      const row = document.createElement('div');
      row.className = 'ws-diff-hunk';
      const cell = document.createElement('span');
      cell.className = 'ws-diff-hunk-text';
      cell.textContent = r.text;
      row.appendChild(cell);
      table.appendChild(row);
      return;
    }
    const row = document.createElement('div');
    row.className = 'ws-code-line' + (r.k === 'add' ? ' ws-diff-line-add' : r.k === 'del' ? ' ws-diff-line-del' : '');
    const g1 = document.createElement('span');
    g1.className = 'ws-code-gutter';
    g1.style.cssText = 'width:28px;min-width:28px;padding:0 4px';
    g1.textContent = r.n1 || '';
    row.appendChild(g1);
    const g2 = document.createElement('span');
    g2.className = 'ws-code-gutter';
    g2.style.cssText = 'width:28px;min-width:28px;padding:0 4px';
    g2.textContent = r.n2 || '';
    row.appendChild(g2);
    const sign = document.createElement('span');
    sign.style.cssText = 'display:table-cell;width:14px;min-width:14px;text-align:center;user-select:none;color:' + (r.k === 'add' ? '#7faa7c' : r.k === 'del' ? '#c08378' : '#7a7060');
    sign.textContent = r.k === 'add' ? '+' : r.k === 'del' ? '−' : '';
    row.appendChild(sign);
    const code = document.createElement('span');
    code.className = 'ws-code-text';
    code.style.padding = '0 16px 0 4px';
    code.textContent = r.text;
    row.appendChild(code);
    table.appendChild(row);
  });
  container.className = 'ws-code ws-mono ws-code-viewer';
  container.appendChild(table);
}

function wsShowEditingBanner(actorName, actorColor) {
  const banner = document.getElementById('ws-editing-banner');
  banner.innerHTML = '';
  if (!actorName) return;
  const el = document.createElement('div');
  el.className = 'ws-editing-banner';
  el.style.cssText = `background:color-mix(in srgb,${actorColor} 14%,var(--h-bg));border-bottom:1px solid color-mix(in srgb,${actorColor} 36%,var(--h-bg));color:${actorColor}`;
  el.innerHTML = `<span class="h-dot"></span><span class="h-dot"></span><span class="h-dot"></span><span style="font-style:italic">${wsEscHtml(actorName)} is editing this file…</span>`;
  banner.appendChild(el);
}

(function initWorkspacePanel() {
  const panel = document.getElementById('workspace-panel');
  const handle = document.getElementById('ws-drag-handle');
  const closeBtn = document.getElementById('ws-panel-close-btn');

  closeBtn.onclick = toggleWorkspacePanel;

  document.querySelectorAll('.ws-pin-tab').forEach(tab => {
    tab.onclick = () => wsSetView(tab.dataset.wsPin);
  });

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const diff = startX - e.clientX;
    const newWidth = Math.max(280, Math.min(startWidth + diff, window.innerWidth * 0.7));
    panel.style.setProperty('--ws-panel-width', newWidth + 'px');
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const w = panel.style.getPropertyValue('--ws-panel-width');
    if (w) localStorage.setItem('stoa-ws-panel-width', w);
  });

  handle.addEventListener('dblclick', () => {
    panel.style.removeProperty('--ws-panel-width');
    localStorage.removeItem('stoa-ws-panel-width');
  });

  handle.addEventListener('touchstart', e => {
    const touch = e.touches[0];
    dragging = true;
    startX = touch.clientX;
    startWidth = panel.offsetWidth;
    handle.classList.add('dragging');
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const touch = e.touches[0];
    const diff = startX - touch.clientX;
    const newWidth = Math.max(280, Math.min(startWidth + diff, window.innerWidth * 0.7));
    panel.style.setProperty('--ws-panel-width', newWidth + 'px');
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    const w = panel.style.getPropertyValue('--ws-panel-width');
    if (w) localStorage.setItem('stoa-ws-panel-width', w);
  });
})();

// ── Markdown rendering ─────────────────────────────────────────────────────
marked.use({
  breaks: true, gfm: true,
  renderer: {
    code(token) {
      const src = (typeof token === 'string' ? token : token.text) ?? '';
      const lang = typeof token === 'string' ? '' : (token.lang || '');
      if (!src) return `<pre><code>${''}</code></pre>`;
      let highlighted;
      const language = lang && hljs.getLanguage(lang) ? lang : null;
      try {
        highlighted = language
          ? hljs.highlight(src, { language }).value
          : hljs.highlightAuto(src).value;
      } catch { highlighted = src.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
      const langLabel = language
        ? `<span class="h-code-lang">${language}</span>`
        : '';
      return `<pre>${langLabel}<code class="hljs${language ? ' language-' + language : ''}">${highlighted}</code></pre>`;
    }
  }
});

function renderMarkdown(text) {
  if (!text) return '';
  return DOMPurify.sanitize(marked.parse(text), { ADD_ATTR: ['class'] });
}

async function copyToClipboard(text) {
  if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  return ok;
}

function showCopyFeedback(btn) {
  const row = btn.closest('.h-msg-row');
  if (row) row.classList.add('show-actions');
  const orig = btn.innerHTML;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5cb85c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  btn.classList.add('copied');
  setTimeout(() => {
    btn.innerHTML = orig;
    btn.classList.remove('copied');
    if (row) row.classList.remove('show-actions');
  }, 1500);
}

async function deleteMessage(msgId) {
  try { const res = await fetch(`/api/messages/${msgId}`, { method: 'DELETE' }); if (!res.ok) throw new Error(); } catch { showToast('Failed to delete message', { error: true }); }
}

function getAttachments(m) {
  let list = [];
  if (m.attachments) {
    try { list = typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments; } catch {}
  }
  if (!list.length) {
    if (m.image_url) list.push({ url: m.image_url, name: '', type: 'image' });
    if (m.file_url && m.file_name) {
      const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(m.file_name);
      list.push({ url: m.file_url, name: m.file_name, type: isImg ? 'image' : 'file' });
    }
  }
  return list;
}

function renderAttachments(bubble, m) {
  const attachments = getAttachments(m);
  if (!attachments.length) return;

  const images = attachments.filter(a => a.type === 'image');
  const files  = attachments.filter(a => a.type === 'file');

  if (images.length === 1) {
    const img = document.createElement('img');
    img.src = images[0].url;
    img.className = 'h-msg-img';
    img.loading = 'lazy';
    img.onclick = () => openLightbox(images, 0);
    bubble.appendChild(img);
  } else if (images.length > 1) {
    const wrap = document.createElement('div');
    wrap.className = 'h-gallery-wrap';
    const gallery = document.createElement('div');
    gallery.className = 'h-msg-gallery';
    const track = document.createElement('div');
    track.className = 'h-gallery-track';
    let tx = 0, maxScroll = 0;

    images.forEach((a, i) => {
      const img = document.createElement('img');
      img.src = a.url;
      img.loading = 'lazy';
      img.onclick = () => { if (!wasDragged) openLightbox(images, i); };
      img.style.pointerEvents = 'auto';
      img.style.cursor = 'pointer';
      track.appendChild(img);
    });
    gallery.appendChild(track);

    const counter = document.createElement('div');
    counter.className = 'h-gallery-counter';
    counter.textContent = images.length + ' images';

    function clamp(val) {
      maxScroll = Math.max(0, track.scrollWidth - gallery.offsetWidth);
      return Math.max(-maxScroll, Math.min(0, val));
    }
    function setPos(val, animate) {
      tx = clamp(val);
      if (animate) {
        track.classList.add('snapping');
        track.addEventListener('transitionend', () => track.classList.remove('snapping'), { once: true });
      } else {
        track.classList.remove('snapping');
      }
      track.style.transform = 'translateX(' + tx + 'px)';
    }

    let dragStartX = 0, dragOffset = 0, isDragging = false, wasDragged = false;

    function pointerDown(x) {
      isDragging = true;
      wasDragged = false;
      dragStartX = x;
      track.classList.remove('snapping');
      gallery.classList.add('dragging');
    }
    function pointerMove(x) {
      if (!isDragging) return;
      dragOffset = x - dragStartX;
      if (Math.abs(dragOffset) > 5) wasDragged = true;
      track.style.transform = 'translateX(' + clamp(tx + dragOffset) + 'px)';
    }
    function pointerUp() {
      if (!isDragging) return;
      isDragging = false;
      gallery.classList.remove('dragging');
      setPos(tx + dragOffset, true);
      dragOffset = 0;
    }

    gallery.addEventListener('touchstart', e => pointerDown(e.touches[0].clientX), { passive: true });
    gallery.addEventListener('touchmove', e => pointerMove(e.touches[0].clientX), { passive: true });
    gallery.addEventListener('touchend', pointerUp);

    gallery.addEventListener('mousedown', e => { e.preventDefault(); pointerDown(e.clientX); });
    document.addEventListener('mousemove', e => { if (isDragging) pointerMove(e.clientX); });
    document.addEventListener('mouseup', pointerUp);

    const scrollStep = 200;
    const btnL = document.createElement('button');
    btnL.className = 'h-gallery-nav left';
    btnL.innerHTML = '&#8249;';
    btnL.onclick = e => { e.stopPropagation(); setPos(tx + scrollStep, true); };
    const btnR = document.createElement('button');
    btnR.className = 'h-gallery-nav right';
    btnR.innerHTML = '&#8250;';
    btnR.onclick = e => { e.stopPropagation(); setPos(tx - scrollStep, true); };

    wrap.appendChild(gallery);
    wrap.appendChild(btnL);
    wrap.appendChild(btnR);
    wrap.appendChild(counter);
    bubble.appendChild(wrap);
  }

  files.forEach(a => {
    const link = document.createElement('a');
    link.href = a.url;
    link.target = '_blank';
    link.className = 'h-msg-file';
    link.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${escHtml(a.name)}`;
    bubble.appendChild(link);
  });
}

function openLightbox(images, startIdx) {
  const lb = document.getElementById('img-lightbox');
  const img = document.getElementById('img-lightbox-src');
  lb._images = images;
  lb._idx = startIdx;
  img.src = images[startIdx].url;
  lb.classList.toggle('has-nav', images.length > 1);
  lb.classList.add('visible');
}

function lbNav(dir) {
  const lb = document.getElementById('img-lightbox');
  if (!lb._images) return;
  lb._idx = (lb._idx + dir + lb._images.length) % lb._images.length;
  document.getElementById('img-lightbox-src').src = lb._images[lb._idx].url;
}

function addCopyButtons(el) {
  el.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.h-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'h-copy-btn';
    btn.textContent = 'copy';
    btn.onclick = async () => {
      const code = pre.querySelector('code');
      const text = code ? code.textContent : pre.textContent;
      if (await copyToClipboard(text)) {
        btn.textContent = 'copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('copied'); }, 2000);
      }
    };
    pre.appendChild(btn);
  });
}

function looksLikePath(text) {
  const t = text.trim();
  if (t.length < 3) return false;
  const hasSlash = t.includes('/') || t.includes('\\');
  if (!hasSlash) return false;
  if (/^https?:\/\//.test(t)) return false;
  if (/^[A-Za-z]:[\\\/]/.test(t)) return true;
  if (/^[~.]?[\\\/]/.test(t)) return true;
  if (/^\/[\w.\-]/.test(t)) return true;
  return false;
}

function linkifyFilePaths(el) {
  el.querySelectorAll('code').forEach(node => {
    if (node.closest('a') || node.classList.contains('h-file-link')) return;
    const text = node.textContent.trim();
    if (looksLikePath(text)) makeFileLink(node, text);
  });

  el.querySelectorAll('pre code').forEach(codeEl => {
    if (codeEl.closest('.h-file-link')) return;
    const text = codeEl.textContent.trim();
    if (looksLikePath(text) && text.split('\n').length <= 2) {
      const pre = codeEl.closest('pre');
      pre.style.cursor = 'pointer';
      pre.classList.add('h-file-link-block');
      pre.onclick = (e) => {
        if (e.target.closest('.h-copy-btn')) return;
        openFileFromPath(text.replace(/\n/g, ''));
      };
    }
  });
}

function makeFileLink(codeEl, filePath) {
  codeEl.classList.add('h-file-link');
  codeEl.style.cursor = 'pointer';
  codeEl.onclick = (e) => { e.preventDefault(); openFileFromPath(filePath); };
}

function openFileFromPath(absOrRelPath) {
  let filePath = absOrRelPath.replace(/\\/g, '/').replace(/\/+$/, '');
  let isAbsolute = /^\//.test(filePath) || /^[A-Za-z]:/.test(filePath);
  if (wsFileTreeRoot) {
    const root = wsFileTreeRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    if (filePath.startsWith(root + '/')) {
      filePath = filePath.slice(root.length + 1);
      isAbsolute = false;
    }
  }
  const panel = document.getElementById('workspace-panel');
  if (!panel.classList.contains('open')) toggleWorkspacePanel();
  const ext = wsGetExt(filePath);
  if (!ext) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(isAbsolute ? { type: 'file_list', abs_path: filePath } : { type: 'file_list' }));
    }
    wsActiveView = 'files';
    wsActiveFile = null;
    document.querySelectorAll('.ws-pin-tab').forEach(t => t.classList.toggle('active', t.dataset.wsPin === 'files'));
    wsRenderContent();
  } else {
    if (isAbsolute && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'file_read', path: filePath, absolute: true }));
    }
    wsOpenFile(filePath);
  }
}

// ── Append message ─────────────────────────────────────────────────────────
function appendMessage(m, container) {
  const inner = container || document.getElementById('messages-inner');
  if (!inner) return;

  if (m.state === 'system_event') {
    const el = document.createElement('div');
    el.className = 'h-system-event';
    el.id = 'msg-' + m.id;
    el.textContent = m.content;
    inner.appendChild(el);
    return;
  }

  // Pesan yang masih streaming/requesting → tampilkan thinking bubble
  if (m.state === 'streaming' || m.state === 'requesting') {
    showThinking(m.id, m.actor_name, m.avatar_color, m.avatar_symbol, m.avatar_url);
    return;
  }

  const isHuman = m.actor_type === 'human';

  const row = document.createElement('div');
  row.className = 'h-msg-row ' + (isHuman ? 'human' : 'ai');
  row.id = 'msg-' + m.id;

  // Seal
  const sealWrap = document.createElement('div');
  sealWrap.className = 'h-msg-seal-wrap';
  sealWrap.appendChild(makeAvatar(m.actor_name, m.avatar_color, m.avatar_url, 40));
  row.appendChild(sealWrap);

  // Body
  const body = document.createElement('div');
  body.className = 'h-msg-body';

  // Meta: name + time
  const meta = document.createElement('div');
  meta.className = 'h-msg-meta';

  const nameEl = document.createElement('span');
  nameEl.className = 'h-msg-name';
  nameEl.style.color = m.avatar_color;
  nameEl.textContent = m.actor_name;
  meta.appendChild(nameEl);

  if (m.created_at) {
    const timeEl = document.createElement('span');
    timeEl.className = 'h-msg-time';
    const ts = m.created_at.endsWith('Z') ? m.created_at : m.created_at.replace(' ', 'T') + 'Z';
    timeEl.textContent = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(timeEl);
  }

  body.appendChild(meta);

  // Bubble
  const bubble = document.createElement('div');
  bubble.className = 'h-bubble';
  bubble.style.background = bubbleBg(m.avatar_color);
  bubble.style.borderColor  = bubbleBorder(m.avatar_color);

  if (m.reply_msg) {
    const quote = document.createElement('div');
    quote.className = 'h-reply-quote';
    const replyAttachments = getAttachments(m.reply_msg);
    let quoteText = escHtml((m.reply_msg.content || '').substring(0, 150));
    if (replyAttachments.length) {
      const urls = replyAttachments.map(a => `<div class="h-reply-quote-file">${escHtml(a.url)}</div>`).join('');
      quoteText = urls + quoteText;
    }
    quote.innerHTML = `<div class="h-reply-quote-name" style="color:${m.reply_msg.avatar_color || 'var(--h-ink)'}">${escHtml(m.reply_msg.actor_name)}</div><div class="h-reply-quote-text">${quoteText}</div>`;
    quote.onclick = () => { const el = document.getElementById('msg-' + m.reply_to); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.transition = 'background 0.3s'; el.style.background = 'color-mix(in srgb, #d39749 15%, transparent)'; setTimeout(() => { el.style.background = ''; }, 2000); } };
    bubble.appendChild(quote);
  }

  renderAttachments(bubble, m);

  if (m.content) {
    const textDiv = document.createElement('div');
    textDiv.innerHTML = highlightMentions(renderMarkdown(m.content));
    bubble.appendChild(textDiv);
  }

  const actions = document.createElement('div');
  actions.className = 'h-msg-actions';
  actions.innerHTML =
    `<button class="h-msg-action-btn" data-action="reply" title="Reply"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg></button>` +
    `<button class="h-msg-action-btn" data-action="copy" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>` +
    `<button class="h-msg-action-btn" data-action="delete" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
  actions.querySelector('[data-action="reply"]').onclick = () => startReply(m.id, m.actor_name, m.avatar_color, m.content, getAttachments(m));
  actions.querySelector('[data-action="copy"]').onclick = async function() {
    if (await copyToClipboard(m.content || '')) showCopyFeedback(this);
  };
  actions.querySelector('[data-action="delete"]').onclick = () => deleteMessage(m.id);

  body.appendChild(bubble);
  body.style.position = 'relative';
  body.appendChild(actions);
  row.appendChild(body);
  inner.appendChild(row);
  addCopyButtons(bubble);
  linkifyFilePaths(bubble);
}

// ── Thinking bubble (before tokens arrive) ─────────────────────────────────
function showThinking(msgId, actorName, color, symbol, avatarUrl) {
  if (document.getElementById('msg-' + msgId)) return; // already exists
  const inner = document.getElementById('messages-inner');
  if (!inner) return;

  const row = document.createElement('div');
  row.className = 'h-msg-row ai';
  row.id = 'msg-' + msgId;

  // Seal
  const sealWrap = document.createElement('div');
  sealWrap.className = 'h-msg-seal-wrap';
  sealWrap.appendChild(makeAvatar(actorName, color, avatarUrl, 40));
  row.appendChild(sealWrap);

  // Body
  const body = document.createElement('div');
  body.className = 'h-msg-body';

  const meta = document.createElement('div');
  meta.className = 'h-msg-meta';
  const nameEl = document.createElement('span');
  nameEl.className = 'h-msg-name';
  nameEl.style.color = color;
  nameEl.textContent = actorName;
  meta.appendChild(nameEl);
  body.appendChild(meta);

  // Thinking bubble
  const bubble = document.createElement('div');
  bubble.className = 'h-thinking-bubble';
  bubble.style.background = bubbleBg(color);
  bubble.style.borderColor  = bubbleBorder(color);
  bubble.style.color = color;
  bubble.innerHTML =
    '<span class="h-dot"></span>' +
    '<span class="h-dot"></span>' +
    '<span class="h-dot"></span>' +
    '<span class="h-status" style="font-family:var(--h-msg)">' +
      '<span class="a">thinking…</span>' +
      '<span class="b">writing…</span>' +
    '</span>';
  body.appendChild(bubble);
  row.appendChild(body);
  inner.appendChild(row);

  streaming[msgId] = '';
  scrollToBottom();
}

// ── Append streaming token ─────────────────────────────────────────────────
function appendToken(msgId, token) {
  const row = document.getElementById('msg-' + msgId);
  if (!row) return;

  streaming[msgId] = (streaming[msgId] || '') + token;

  // First token: replace thinking bubble with real bubble
  let bubble = row.querySelector('.h-bubble');
  if (!bubble) {
    const thinkBubble = row.querySelector('.h-thinking-bubble');
    if (thinkBubble) {
      const body = thinkBubble.parentElement;
      bubble = document.createElement('div');
      bubble.className = 'h-bubble streaming';
      // Copy colors from thinking bubble
      bubble.style.background = thinkBubble.style.background;
      bubble.style.borderColor  = thinkBubble.style.borderColor;
      bubble.style.letterSpacing = '';
      bubble.style.borderTopLeftRadius = '4px';
      body.replaceChild(bubble, thinkBubble);

      // Add stream caption
      const color = row.querySelector('.h-msg-name').style.color;
      const caption = document.createElement('div');
      caption.className = 'h-stream-caption';
      caption.style.color = color;
      caption.innerHTML =
        '<span class="h-dot"></span>' +
        '<span class="h-dot"></span>' +
        '<span class="h-dot"></span>' +
        '<span class="h-status">' +
          '<span class="a">thinking</span>' +
          '<span class="b">writing</span>' +
        '</span>';
      caption.id = 'caption-' + msgId;
      body.appendChild(caption);
    }
  }
  if (!bubble) return;

  const color = row.querySelector('.h-msg-name').style.color;
  bubble.innerHTML = '';
  bubble.appendChild(document.createTextNode(streaming[msgId]));
  const cursor = document.createElement('span');
  cursor.className = 'h-cursor';
  cursor.style.color = color;
  bubble.appendChild(cursor);

  scrollToBottom();
}

// ── Finalize streaming message ─────────────────────────────────────────────
function finalizeMessage(msgId, content, fileUrl, fileName, attachments) {
  const row = document.getElementById('msg-' + msgId);
  if (!row) return;

  const bubble = row.querySelector('.h-bubble, .h-thinking-bubble');
  if (bubble) {
    bubble.classList.remove('streaming');
    // If it was a thinking bubble, convert to regular bubble styling first
    if (bubble.classList.contains('h-thinking-bubble')) {
      bubble.classList.remove('h-thinking-bubble');
      bubble.classList.add('h-bubble');
      bubble.style.color = '';
      bubble.style.fontFamily = '';
      bubble.style.fontSize = '';
      bubble.style.lineHeight = '';
      bubble.style.borderTopLeftRadius = '4px';
    }

    bubble.innerHTML = '';
    if (attachments?.length || (fileUrl && fileName)) {
      renderAttachments(bubble, { file_url: fileUrl, file_name: fileName, attachments });
    }
    const textDiv = document.createElement('div');
    textDiv.innerHTML = highlightMentions(renderMarkdown(content || ''));
    bubble.appendChild(textDiv);
    addCopyButtons(bubble);
  linkifyFilePaths(bubble);
  }

  // Add message action buttons (reply + copy) if not already present
  const body = row.querySelector('.h-msg-body');
  if (body && !body.querySelector('.h-msg-actions')) {
    const actions = document.createElement('div');
    actions.className = 'h-msg-actions';
    actions.innerHTML =
      `<button class="h-msg-action-btn" data-action="reply" title="Reply"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg></button>` +
      `<button class="h-msg-action-btn" data-action="copy" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>` +
      `<button class="h-msg-action-btn" data-action="delete" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;
    const actorName = row.querySelector('.h-msg-name')?.textContent || '';
    const avatarColor = row.querySelector('.h-msg-name')?.style.color || '';
    const msgAttachments = attachments || (fileUrl ? [{ url: fileUrl, name: fileName || '', type: /\.(png|jpe?g|gif|webp|svg)$/i.test(fileName || '') ? 'image' : 'file' }] : []);
    actions.querySelector('[data-action="reply"]').onclick = () => startReply(msgId, actorName, avatarColor, content, msgAttachments);
    actions.querySelector('[data-action="copy"]').onclick = async function() {
      if (await copyToClipboard(content || '')) showCopyFeedback(this);
    };
    actions.querySelector('[data-action="delete"]').onclick = () => deleteMessage(msgId);
    body.style.position = 'relative';
    body.appendChild(actions);
  }

  // Add time to AI message meta
  const meta = row.querySelector('.h-msg-meta');
  if (meta && !meta.querySelector('.h-msg-time')) {
    const timeEl = document.createElement('span');
    timeEl.className = 'h-msg-time';
    timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(timeEl);
  }

  // Remove stream caption
  const caption = document.getElementById('caption-' + msgId);
  if (caption) caption.remove();

  // Add "done" indicator if there's a process trail
  const trail = row.querySelector('.h-process-trail');
  if (trail) {
    const done = document.createElement('div');
    done.className = 'h-process-done';
    done.textContent = 'done';
    trail.appendChild(done);
  }

  delete streaming[msgId];
}

// ── Process trail (tool steps below bubble) ────────────────────────────────
function toolSummary(name, input) {
  if (!input) return '';
  const keyMap = { Bash: 'command', Read: 'file_path', Write: 'file_path', Edit: 'file_path',
    Glob: 'pattern', Grep: 'pattern', WebFetch: 'url', WebSearch: 'query',
    NotebookEdit: 'notebook_path', mcp__ide__executeCode: 'code' };
  const key = keyMap[name];
  let val = (key && input[key]) ? String(input[key]) : (Object.values(input).find(v => typeof v === 'string') || '');
  if (val.length > 64) val = val.slice(0, 61) + '…';
  return val;
}

function appendToolStep(msgId, tool) {
  const row = document.getElementById('msg-' + msgId);
  if (!row) return;

  const body = row.querySelector('.h-msg-body');
  if (!body) return;

  let trail = body.querySelector('.h-process-trail');
  if (!trail) {
    trail = document.createElement('div');
    trail.className = 'h-process-trail';
    body.appendChild(trail);
  }

  const step = document.createElement('div');
  step.className = 'h-process-step';

  const toolEl = document.createElement('span');
  toolEl.className = 'h-process-tool';
  toolEl.textContent = tool.name;

  const inputEl = document.createElement('span');
  inputEl.className = 'h-process-input';
  inputEl.textContent = toolSummary(tool.name, tool.input);

  step.appendChild(toolEl);
  step.appendChild(inputEl);
  trail.appendChild(step);
  scrollToBottom();
}

// ── Invite card ────────────────────────────────────────────────────────────
function showInviteCard(msg) {
  const inner = document.getElementById('messages-inner');
  if (!inner) return;

  const suggested = msg.suggested_actor;
  // Try to find the proposer from actorByName if server sends actor_name
  const proposer = msg.actor_name ? actorByName[msg.actor_name] : null;

  const card = document.createElement('div');
  card.className = 'h-invite-card';

  const label = document.createElement('div');
  label.className = 'h-invite-label';
  label.textContent = 'a suggestion from the room';
  card.appendChild(label);

  const title = document.createElement('div');
  title.className = 'h-invite-title';
  if (proposer) {
    title.innerHTML =
      `<span style="color:${proposer.avatar_color};font-style:italic">${escHtml(proposer.name)}</span>` +
      ` would like to invite ` +
      `<span style="color:${suggested.avatar_color};font-style:italic">${escHtml(suggested.name)}</span>.`;
  } else {
    title.innerHTML =
      `an invitation for ` +
      `<span style="color:${suggested.avatar_color};font-style:italic">${escHtml(suggested.name)}</span>` +
      ` to join this room.`;
  }
  card.appendChild(title);

  if (msg.reason) {
    const reason = document.createElement('div');
    reason.className = 'h-invite-reason';
    reason.textContent = msg.reason;
    card.appendChild(reason);
  }

  const actions = document.createElement('div');
  actions.className = 'h-invite-actions';

  const approveBtn = document.createElement('button');
  approveBtn.className = 'h-btn-primary';
  approveBtn.textContent = 'invite';
  approveBtn.onclick = () => resolveInvite(msg.invite_id, true, [approveBtn, rejectBtn]);

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'h-btn-secondary';
  rejectBtn.textContent = 'not now';
  rejectBtn.onclick = () => resolveInvite(msg.invite_id, false, [approveBtn, rejectBtn]);

  actions.appendChild(approveBtn);
  actions.appendChild(rejectBtn);
  card.appendChild(actions);

  inner.appendChild(card);
  scrollToBottom();
}

async function resolveInvite(inviteId, approved, btns) {
  btns.forEach(b => b.disabled = true);
  try {
    const invRes = await fetch(`/api/invites/${inviteId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved }),
    });
    if (!invRes.ok) throw new Error('resolve failed');
    if (approved && currentRoomId) {
      const parts = await fjson(`/api/rooms/${currentRoomId}/participants`);
      roomParticipantsCache[currentRoomId] = parts;
      renderRoomDots(currentRoomId, parts);
      const room = { id: currentRoomId, title: document.querySelector('.h-room-name')?.textContent || '' };
      renderChatHeader(room, parts);
    }
  } catch (err) {
    console.error('Failed to resolve invite:', err);
    btns.forEach(b => b.disabled = false);
  }
}

// ── Upload with progress ──────────────────────────────────────────────────
function uploadWithProgress(file) {
  return new Promise((resolve, reject) => {
    const prog = document.getElementById('upload-progress');
    const fill = document.getElementById('upload-progress-fill');
    const text = document.getElementById('upload-progress-text');
    prog.classList.add('visible');
    prog.classList.remove('processing');
    fill.style.width = '0%';
    text.textContent = 'Uploading...';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload/raw');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'file'));
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        fill.style.width = pct + '%';
        const kb = Math.round(e.loaded / 1024);
        const totalKb = Math.round(e.total / 1024);
        if (pct < 100) {
          text.textContent = `Uploading... ${pct}% (${kb}/${totalKb} KB)`;
        } else {
          prog.classList.add('processing');
          text.textContent = 'Processing...';
        }
      }
    };
    xhr.onload = () => {
      prog.classList.remove('visible', 'processing');
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('Invalid response')); }
      } else {
        reject(new Error('Upload failed: ' + xhr.status));
      }
    };
    xhr.onerror = () => { prog.classList.remove('visible', 'processing'); reject(new Error('Network error')); };
    xhr.send(file);
  });
}

// ── Image paste ────────────────────────────────────────────────────────────
async function handleImagePaste(e) {
  const items = [...(e.clipboardData?.items || [])];
  const imageItem = items.find(i => i.type.startsWith('image/'));
  if (!imageItem) return;
  e.preventDefault();
  const file = imageItem.getAsFile();
  try {
    const { url, name } = await uploadWithProgress(file);
    addPendingAttachment(url, name || file.name, 'image');
  } catch (err) {
    showUploadError(err.message || 'Upload failed');
  }
}

function addPendingAttachment(url, name, type) {
  pendingAttachments.push({ url, name, type });
  renderAttachPreview();
}

function removePendingAttachment(idx) {
  pendingAttachments.splice(idx, 1);
  renderAttachPreview();
}

function clearAttachments() {
  pendingAttachments = [];
  renderAttachPreview();
}

function renderAttachPreview() {
  const el = document.getElementById('attach-preview');
  if (!pendingAttachments.length) { el.classList.remove('visible'); el.innerHTML = ''; return; }
  el.classList.add('visible');
  el.innerHTML = pendingAttachments.map((a, i) => {
    if (a.type === 'image') {
      return `<div class="attach-thumb"><img src="${a.url}" alt="${escHtml(a.name)}"><button class="attach-thumb-x" data-idx="${i}">&times;</button></div>`;
    }
    const ext = (a.name || '').split('.').pop()?.toUpperCase() || 'FILE';
    return `<div class="attach-thumb-file"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>${escHtml(a.name)}</span><button class="attach-thumb-x" data-idx="${i}">&times;</button></div>`;
  }).join('');
  el.querySelectorAll('.attach-thumb-x').forEach(btn => {
    btn.onclick = () => removePendingAttachment(parseInt(btn.dataset.idx));
  });
}

// ── HTML → Markdown ─────────────────────────────────────────────────────────
function htmlToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/​/g, '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = node.tagName.toLowerCase();
  const inner = () => Array.from(node.childNodes).map(htmlToMarkdown).join('');

  switch (tag) {
    case 'strong': case 'b': {
      const c = inner();
      return c ? `**${c}**` : '';
    }
    case 'em': case 'i': {
      const c = inner();
      return c ? `*${c}*` : '';
    }
    case 's': case 'del': case 'strike': {
      const c = inner();
      return c ? `~~${c}~~` : '';
    }
    case 'code':
      return node.closest('pre') ? inner() : `\`${inner()}\``;
    case 'pre': {
      const c = inner().replace(/\n$/, '');
      const prev = node.previousElementSibling;
      const next = node.nextElementSibling;
      const prevIsPre = prev?.tagName?.toLowerCase() === 'pre';
      const nextIsPre = next?.tagName?.toLowerCase() === 'pre';
      if (prevIsPre && nextIsPre) return c + '\n';
      if (prevIsPre) return c + '\n```\n\n';
      if (nextIsPre) return '\n```\n' + c + '\n';
      return '\n```\n' + c + '\n```\n\n';
    }
    case 'a': {
      const href = node.getAttribute('href') || '';
      const text = inner();
      if (!text || text === href) return href;
      return `[${text}](${href})`;
    }
    case 'blockquote': {
      const lines = inner().replace(/\n$/, '').split('\n');
      return lines.map(l => `> ${l}`).join('\n') + '\n\n';
    }
    case 'ol': case 'ul': {
      const c = inner();
      return c.endsWith('\n') ? c + '\n' : c + '\n\n';
    }
    case 'li': {
      const parent = node.parentElement?.tagName?.toLowerCase();
      const idx = Array.from(node.parentElement?.children || []).indexOf(node) + 1;
      const prefix = parent === 'ol' ? `${idx}. ` : '- ';
      return prefix + inner().replace(/\n$/, '').replace(/\n/g, '\n  ') + '\n';
    }
    case 'br':
      return '\n';
    case 'div': case 'p': {
      const c = inner();
      if (!c) return '\n';
      return c + (c.endsWith('\n') ? '' : '\n');
    }
    default: return inner();
  }
}

// ── Drafts per room ─────────────────────────────────────────────────────────
function saveDraft(roomId) {
  if (!roomId) return;
  const input = document.getElementById('msg-input');
  const html = input.innerHTML.trim();
  if (html && html !== '<br>') {
    localStorage.setItem('stoa-draft-' + roomId, html);
  } else {
    localStorage.removeItem('stoa-draft-' + roomId);
  }
}

function restoreDraft(roomId) {
  const input = document.getElementById('msg-input');
  const draft = localStorage.getItem('stoa-draft-' + roomId);
  input.innerHTML = draft || '';
}

function clearDraft(roomId) {
  if (roomId) localStorage.removeItem('stoa-draft-' + roomId);
}

// ── Composer processing state ───────────────────────────────────────────────
function setComposerProcessing(messageId) {
  processingMessages.add(messageId);
  document.querySelector('.h-composer-box')?.classList.add('ai-processing');
  document.getElementById('stop-btn')?.classList.add('visible');
  document.getElementById('msg-input')?.blur();
}

function clearComposerProcessing(messageId) {
  if (messageId) processingMessages.delete(messageId);
  else processingMessages.clear();
  if (processingMessages.size === 0) {
    document.querySelector('.h-composer-box')?.classList.remove('ai-processing');
    document.getElementById('stop-btn')?.classList.remove('visible');
    document.getElementById('msg-input')?.focus();
  }
}

function stopGeneration() {
  if (processingMessages.size === 0 || !ws || ws.readyState !== WebSocket.OPEN) return;
  for (const mid of processingMessages) {
    ws.send(JSON.stringify({ type: 'stop_generation', room_id: currentRoomId, message_id: mid }));
  }
  clearComposerProcessing();
}

// ── Reply ───────────────────────────────────────────────────────────────────
let pendingReplyTo = null;

function startReply(msgId, actorName, avatarColor, content, attachments) {
  pendingReplyTo = msgId;
  document.getElementById('reply-bar-name').textContent = actorName;
  document.getElementById('reply-bar-name').style.color = avatarColor || 'var(--h-ink)';
  let preview = (content || '').substring(0, 150);
  if (attachments && attachments.length) {
    const urls = attachments.map(a => a.url).join('\n');
    preview = preview ? preview + '\n' + urls : urls;
  }
  document.getElementById('reply-bar-text').textContent = preview;
  document.getElementById('reply-bar').classList.add('visible');
  document.getElementById('msg-input').focus();
}

function clearReply() {
  pendingReplyTo = null;
  document.getElementById('reply-bar').classList.remove('visible');
}

document.getElementById('reply-bar-close').onclick = clearReply;

// ── Send ────────────────────────────────────────────────────────────────────
function sendMessage() {
  const input = document.getElementById('msg-input');
  const content = htmlToMarkdown(input).replace(/​/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if ((!content && !pendingAttachments.length) || !ws || ws.readyState !== WebSocket.OPEN) return;
  input.innerHTML = '';
  const attachments = pendingAttachments.length ? [...pendingAttachments] : undefined;
  const replyTo = pendingReplyTo;
  clearAttachments();
  clearReply();
  ws.send(JSON.stringify({ type: 'send_message', room_id: currentRoomId, content, attachments, reply_to: replyTo }));
  clearDraft(currentRoomId);
}


// ── Create room modal ───────────────────────────────────────────────────────
async function loadWorkdirsForActor(actorId) {
  const section = document.getElementById('new-room-workdir-section');
  const sel = document.getElementById('new-room-workdir');
  const newWdRow = document.getElementById('new-room-new-workdir-row');
  if (!actorId) { section.style.display = 'none'; return; }

  const actor = allActors.find(a => a.id === parseInt(actorId));
  const isGemini = actor?.adapter === 'gemini';

  let workdirs;
  try { workdirs = await fjson(`/api/actors/${actorId}/workdirs`); } catch { workdirs = []; }
  sel.innerHTML = '';
  section.style.display = 'block';
  newWdRow.style.display = 'none';
  workdirs.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.id;
    const modelTag = formatModelName(w.model);
    opt.textContent = (w.label || w.path) + (modelTag ? ` [${modelTag}]` : '') + (w.is_default ? ' (default)' : '');
    if (w.is_default) opt.selected = true;
    sel.appendChild(opt);
  });

  if (isGemini) {
    sel.disabled = true;
    if (workdirs.length === 0) { section.style.display = 'none'; }
  } else {
    sel.disabled = false;
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ new folder…';
    sel.appendChild(newOpt);
    if (workdirs.length === 0) {
      newOpt.selected = true;
      newWdRow.style.display = 'flex';
    }
  }

  // Remove old listener by cloning
  const newSel = sel.cloneNode(true);
  sel.parentNode.replaceChild(newSel, sel);
  newSel.addEventListener('change', () => {
    newWdRow.style.display = newSel.value === '__new__' ? 'flex' : 'none';
  });
}

async function openNewRoomModal() {
  try {
    const freshActors = await fjson('/api/actors');
    allActors = freshActors;
    actorByName = {};
    allActors.forEach(a => actorByName[a.name] = a);
  } catch { showToast('Failed to load agents', { error: true }); }
  if (!allActors.some(a => a.type === 'ai')) { openSettings(); return; }
  const modal = document.getElementById('new-room-modal');
  const nameInput = document.getElementById('new-room-name');
  const actorsEl = document.getElementById('new-room-actors');

  actorsEl.innerHTML = '';
  const aiActors = allActors.filter(a => a.type === 'ai');
  aiActors.forEach((actor, i) => {
    const label = document.createElement('label');
    label.className = 'h-actor-check';

    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'new-room-actor';
    rb.value = actor.id;
    if (i === 0) rb.checked = true;
    label.appendChild(rb);
    label.appendChild(makeAvatar(actor.name, actor.avatar_color, actor.avatar_url, 22));

    const name = document.createElement('span');
    name.className = 'h-actor-check-name';
    name.textContent = actor.name.toLowerCase();
    label.appendChild(name);

    actorsEl.appendChild(label);
  });

  nameInput.value = '';
  modal.style.display = 'flex';
  nameInput.focus();

  // Load workdirs for selected actor
  const firstAI = aiActors[0];
  if (firstAI) await loadWorkdirsForActor(firstAI.id);
  // Change listener on actor radio buttons
  document.querySelectorAll('#new-room-actors input[type=radio]').forEach(rb => {
    rb.addEventListener('change', () => loadWorkdirsForActor(rb.value));
  });
}

async function submitNewRoom() {
  const title = document.getElementById('new-room-name').value.trim();
  if (!title) return;

  const selected = document.querySelector('#new-room-actors input[type=radio]:checked');
  const participant_ids = selected ? [parseInt(selected.value)] : [];

  const wdSel = document.getElementById('new-room-workdir');
  const newWdInput = document.getElementById('new-room-new-workdir-input');
  let workdir_id = null;

  if (wdSel && wdSel.value === '__new__' && newWdInput?.value.trim()) {
    // Create new workdir on agent
    const selectedActor = document.querySelector('#new-room-actors input[type=radio]:checked');
    if (selectedActor) {
      try {
        const res = await fetch(`/api/actors/${selectedActor.value}/workdirs`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: newWdInput.value.trim() })
        });
        if (!res.ok) throw new Error('workdir creation failed');
        const wd = await res.json();
        workdir_id = wd.id;
      } catch { alert('Failed to create working directory'); return; }
    }
  } else if (wdSel && wdSel.value && wdSel.value !== '__new__') {
    workdir_id = parseInt(wdSel.value);
  }

  if (!workdir_id) { alert('Please select a working directory'); return; }
  document.getElementById('new-room-modal').style.display = 'none';

  try {
    const room = await fjson('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, participant_ids, workdir_id }),
    });
    const rooms = await fjson('/api/rooms');
    renderRoomList(rooms);
    openRoom(room);
  } catch { showToast('Failed to create room', { error: true }); }
}

// ── Scroll ──────────────────────────────────────────────────────────────────
function scrollToBottom(force) {
  const el = document.getElementById('messages');
  if (!el) return;
  if (force || el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
    el.scrollTop = el.scrollHeight;
  }
}

// ── Load older messages on scroll to top ───────────────────────────────────
async function loadOlderMessages() {
  if (loadingOlder || noMoreOlder || !oldestMessageId || !currentRoomId) return;
  loadingOlder = true;

  const container = document.getElementById('messages');
  const inner     = document.getElementById('messages-inner');

  const spinner = document.createElement('div');
  spinner.style.cssText = 'text-align:center;padding:12px;color:var(--h-ink-mute);font-size:13px;font-family:var(--h-sans)';
  spinner.textContent = 'loading…';
  inner.prepend(spinner);

  try {
    const msgs = await fjson(`/api/rooms/${currentRoomId}/messages?before=${oldestMessageId}&limit=50`);

    spinner.remove();

    if (!msgs.length) { noMoreOlder = true; loadingOlder = false; return; }

    // Build rows into a fragment using appendMessage's container param
    const frag = document.createDocumentFragment();
    msgs.forEach(m => {
      if (!document.getElementById('msg-' + m.id)) appendMessage(m, frag);
    });

    // Snapshot scroll anchor, then prepend, then restore
    const prevHeight = inner.scrollHeight;
    const prevTop    = container.scrollTop;
    inner.prepend(frag);
    container.scrollTop = prevTop + (inner.scrollHeight - prevHeight);

    oldestMessageId = msgs[0].id;
    if (msgs.length < 50) noMoreOlder = true;
  } catch {
    spinner.remove();
    showToast('Failed to load older messages', { error: true });
  }
  loadingOlder = false;
}

function initScrollLoader() {
  const container = document.getElementById('messages');
  container.addEventListener('scroll', () => {
    if (container.scrollTop < 120) loadOlderMessages();
  });
}

// ── Search ──────────────────────────────────────────────────────────────────
{
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const searchClear = document.getElementById('search-clear');
  const roomList = document.getElementById('room-list');
  const roomsRow = document.querySelector('.h-rooms-row');
  let searchTimer = null;

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    searchClear.style.display = q ? 'block' : 'none';
    clearTimeout(searchTimer);
    if (!q) { hideSearchResults(); return; }
    searchTimer = setTimeout(() => doSearch(q), 250);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { searchInput.value = ''; searchClear.style.display = 'none'; hideSearchResults(); searchInput.blur(); }
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    hideSearchResults();
    searchInput.focus();
  });

  async function doSearch(q) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=30`);
      if (!res.ok) { showToast('Search failed', { error: true }); return; }
      const rows = await res.json();
      showSearchResults(rows);
    } catch { showToast('Search failed', { error: true }); }
  }

  function showSearchResults(rows) {
    roomList.style.display = 'none';
    roomsRow.style.display = 'none';
    searchResults.style.display = 'block';
    if (!rows.length) {
      searchResults.innerHTML = '<div class="h-search-empty">No results found</div>';
      return;
    }
    searchResults.innerHTML = '';
    for (const r of rows) {
      const item = document.createElement('div');
      item.className = 'h-search-result';
      const ts = r.created_at.endsWith('Z') ? r.created_at : r.created_at.replace(' ', 'T') + 'Z';
      const time = new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
                   new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const archivedBadge = r.archived_at ? '<span class="h-archived-badge">archived</span>' : '';
      item.innerHTML =
        `<div class="h-search-room">${escHtml(r.room_title)}${archivedBadge}</div>` +
        `<div class="h-search-meta">` +
          `<span class="h-search-actor" style="color:${r.avatar_color || 'var(--h-ink)'}">${escHtml(r.actor_name)}</span>` +
          `<span class="h-search-time">${time}</span>` +
        `</div>` +
        `<div class="h-search-snippet">${escHtml(r.snippet).replace(/&lt;mark&gt;/g,'<mark>').replace(/&lt;\/mark&gt;/g,'</mark>')}</div>`;
      item.onclick = () => {
        searchInput.value = '';
        searchClear.style.display = 'none';
        hideSearchResults();
        navigateToMessage(r.room_id, r.id, r.room_title);
      };
      searchResults.appendChild(item);
    }
  }

  function hideSearchResults() {
    searchResults.style.display = 'none';
    roomList.style.display = '';
    roomsRow.style.display = '';
  }

  function navigateToMessage(roomId, msgId, roomTitle) {
    if (currentRoomId !== roomId) {
      openRoom({ id: roomId, title: roomTitle || 'Room' });
      setTimeout(() => scrollToMessage(msgId), 800);
    } else {
      scrollToMessage(msgId);
    }
  }
}

// ── In-room search ─────────────────────────────────────────────────────────
let roomSearchResults = [];
let roomSearchIdx = -1;

function toggleRoomSearch() {
  const bar = document.getElementById('room-search-bar');
  const input = document.getElementById('room-search-input');
  const btn = document.querySelector('#chat-header .h-header-action-btn[title="Search in room"]');
  if (bar.classList.contains('visible')) {
    closeRoomSearch();
  } else {
    bar.classList.add('visible');
    if (btn) btn.classList.add('active');
    input.value = '';
    input.focus();
  }
}

function closeRoomSearch() {
  const bar = document.getElementById('room-search-bar');
  bar.classList.remove('visible');
  const results = document.getElementById('room-search-results');
  results.classList.remove('visible');
  results.innerHTML = '';
  const btn = document.querySelector('#chat-header .h-header-action-btn[title="Search in room"]');
  if (btn) btn.classList.remove('active');
  document.getElementById('room-search-count').textContent = '';
}

async function doRoomSearch(query) {
  const resultsEl = document.getElementById('room-search-results');
  const countEl = document.getElementById('room-search-count');
  resultsEl.innerHTML = '';
  if (!query.trim() || !currentRoomId) {
    resultsEl.classList.remove('visible');
    countEl.textContent = '';
    return;
  }
  let rows;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&room_id=${currentRoomId}&limit=50`);
    if (!res.ok) throw new Error();
    rows = await res.json();
  } catch { countEl.textContent = 'search failed'; return; }
  countEl.textContent = rows.length ? `${rows.length} found` : 'no results';
  if (!rows.length) { resultsEl.classList.remove('visible'); return; }
  resultsEl.classList.add('visible');
  for (const r of rows) {
    const item = document.createElement('div');
    item.className = 'h-room-search-result-item';
    const meta = document.createElement('div');
    meta.className = 'h-room-search-result-meta';
    const actor = document.createElement('span');
    actor.className = 'h-room-search-result-actor';
    actor.textContent = r.actor_name;
    if (r.avatar_color) actor.style.color = r.avatar_color;
    const time = document.createElement('span');
    time.className = 'h-room-search-result-time';
    time.textContent = relativeTime(r.created_at);
    meta.appendChild(actor);
    meta.appendChild(time);
    const snippet = document.createElement('div');
    snippet.className = 'h-room-search-result-snippet';
    snippet.innerHTML = DOMPurify.sanitize(r.snippet);
    item.appendChild(meta);
    item.appendChild(snippet);
    item.onclick = () => {
      resultsEl.classList.remove('visible');
      scrollToMessage(r.id);
    };
    resultsEl.appendChild(item);
  }
}

async function scrollToMessage(msgId) {
  let el = document.getElementById('msg-' + msgId);
  if (!el && currentRoomId && oldestMessageId && msgId < oldestMessageId) {
    for (let i = 0; i < 20 && !el && !noMoreOlder; i++) {
      loadingOlder = false;
      await loadOlderMessages();
      el = document.getElementById('msg-' + msgId);
    }
  }
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'background 0.3s';
    el.style.background = 'color-mix(in srgb, #d39749 15%, transparent)';
    setTimeout(() => { el.style.background = ''; }, 2000);
  }
}

(function() {
  const input = document.getElementById('room-search-input');
  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => doRoomSearch(input.value), 300);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeRoomSearch();
  });
  document.getElementById('room-search-close').onclick = closeRoomSearch;
})();

// ── Utility ─────────────────────────────────────────────────────────────────
function relativeTime(ts) {
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 60)   return 'now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 86400)return Math.floor(diff / 3600) + 'h';
  return Math.floor(diff / 86400) + 'd';
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function formatModelName(model) {
  if (!model) return null;
  return model
    .replace(/^claude-/, '')
    .replace(/^gemini-/, 'gemini ')
    .replace(/-(\d)/, ' $1')
    .replace(/-preview$/, '');
}

function handleModelUpdate(msg) {
  if (currentRoomWorkdirId !== msg.workdir_id) return;
  const badge = document.querySelector('.h-model-badge');
  const label = formatModelName(msg.model);
  if (badge && label) badge.textContent = label;
  else if (badge && !label) badge.remove();
  else if (!badge && label) {
    const tagline = document.querySelector('.h-room-tagline');
    if (tagline) {
      const b = document.createElement('span');
      b.className = 'h-model-badge';
      b.textContent = label;
      tagline.appendChild(b);
    }
  }
}

// ── Skill autocomplete ─────────────────────────────────────────────────────
const SKILL_COLORS = ['#5b8fd4','#d39749','#8a7660','#6b9e6b','#c25d5d','#9b6bc2','#4a9e9e'];

function showSkillPopup(query) {
  const popup = document.getElementById('skill-popup');
  const matches = allSkills.filter(s => s.name.startsWith(query)).slice(0, 7);
  if (!matches.length) { hideSkillPopup(); return; }

  popup.innerHTML = '';
  skillPopupIdx = 0;
  matches.forEach((skill, i) => {
    const color = SKILL_COLORS[i % SKILL_COLORS.length];
    const item = document.createElement('div');
    item.className = 'h-skill-item';
    item.dataset.idx = i;
    const agentTag = skill.actor_name
      ? `<span class="h-skill-agent">${escHtml(skill.actor_name)}</span>` : '';
    item.innerHTML =
      `<span class="h-skill-name" style="--skill-color:${color}">/${escHtml(skill.name)}</span>` +
      `<span class="h-skill-desc">${escHtml(skill.description || '')}</span>` +
      agentTag;
    item.onmousedown = e => {
      e.preventDefault();
      applySkill(skill.name);
    };
    if (i === 0) item.classList.add('active');
    popup.appendChild(item);
  });
  popup.style.display = 'block';
}

function hideSkillPopup() {
  document.getElementById('skill-popup').style.display = 'none';
  skillPopupIdx = -1;
}

function skillColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return SKILL_COLORS[Math.abs(h) % SKILL_COLORS.length];
}

function applySkill(name) {
  const input = document.getElementById('msg-input');
  const sel = window.getSelection();
  if (!sel.rangeCount) { hideSkillPopup(); return; }
  const node = sel.anchorNode;
  const color = skillColor(name);

  if (node.nodeType === 3 && input.contains(node)) {
    const text = node.textContent;
    const cursor = sel.anchorOffset;
    const before = text.slice(0, cursor);
    const match = before.match(/(^|\s)\/([a-z0-9-]*)$/);
    if (match) {
      const start = match.index + match[1].length;
      const beforeText = text.slice(0, start);
      const afterText = text.slice(cursor);
      const parent = node.parentElement;
      const frag = document.createDocumentFragment();
      if (beforeText) frag.appendChild(document.createTextNode(beforeText));
      const span = document.createElement('span');
      span.className = 'h-skill-tag';
      span.style.color = color;
      span.contentEditable = 'false';
      span.textContent = '/' + name;
      frag.appendChild(span);
      const after = document.createTextNode(' ' + afterText);
      frag.appendChild(after);
      parent.replaceChild(frag, node);
      const range = document.createRange();
      range.setStart(after, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      hideSkillPopup();
      return;
    }
  }
  input.focus();
  const span = document.createElement('span');
  span.className = 'h-skill-tag';
  span.style.color = color;
  span.contentEditable = 'false';
  span.textContent = '/' + name;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(span);
  const after = document.createTextNode(' ');
  span.parentNode.insertBefore(after, span.nextSibling);
  range.setStart(after, 1);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  hideSkillPopup();
}

function skillPopupNavigate(dir) {
  const popup = document.getElementById('skill-popup');
  if (popup.style.display === 'none') return false;
  const items = popup.querySelectorAll('.h-skill-item');
  if (!items.length) return false;
  items[skillPopupIdx]?.classList.remove('active');
  skillPopupIdx = (skillPopupIdx + dir + items.length) % items.length;
  items[skillPopupIdx].classList.add('active');
  return true;
}

function onComposerInput() {
  const input = document.getElementById('msg-input');
  saveDraft(currentRoomId);
  const sel = window.getSelection();
  if (sel.rangeCount && input.contains(sel.anchorNode)) {
    const node = sel.anchorNode;
    const text = node.nodeType === 3 ? node.textContent.slice(0, sel.anchorOffset) : '';
    const skillMatch = text.match(/(^|\s)\/([a-z0-9-]*)$/);
    const mentionMatch = text.match(/(^|\s)@([^\s]*)$/);
    if (skillMatch) {
      showSkillPopup(skillMatch[2]);
      hideMentionPopup();
    } else if (mentionMatch) {
      showMentionPopup(mentionMatch[2]);
      hideSkillPopup();
    } else {
      hideSkillPopup();
      hideMentionPopup();
    }
  } else {
    hideSkillPopup();
    hideMentionPopup();
  }
  handleInlineMarkdown();
}

function handleInlineMarkdown() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== 3) return;
  const input = document.getElementById('msg-input');
  if (!input.contains(node)) return;
  const parent = node.parentElement;
  if (parent.nodeName === 'CODE' || parent.nodeName === 'PRE') return;

  const text = node.textContent;
  const cursor = sel.anchorOffset;
  const before = text.slice(0, cursor);

  const patterns = [
    { re: /`([^`]+)`$/, tag: 'code' },
    { re: /\*([^\*]+)\*$/, tag: 'strong' },
    { re: /(?:^|[^a-zA-Z0-9])_([^_]+)_$/, tag: 'em', lookbehind: true },
    { re: /~([^~]+)~$/, tag: 's' },
  ];

  for (const { re, tag, lookbehind } of patterns) {
    const match = before.match(re);
    if (!match) continue;
    const innerText = match[1];
    const fullMatch = lookbehind ? match[0].slice(match[0].length - match[1].length - 2) : match[0];
    const start = cursor - fullMatch.length;
    const beforeText = text.slice(0, start);
    const afterText = text.slice(cursor);
    const frag = document.createDocumentFragment();
    if (beforeText) frag.appendChild(document.createTextNode(beforeText));
    const el = document.createElement(tag);
    el.textContent = innerText;
    frag.appendChild(el);
    const afterNode = document.createTextNode(afterText || '​');
    frag.appendChild(afterNode);
    parent.replaceChild(frag, node);
    const range = document.createRange();
    range.setStart(afterNode, afterText ? 0 : 1);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
}

// ── Mention highlighting in bubbles ───────────────────────────────────────
function highlightMentions(html) {
  const names = (roomParticipantsCache[currentRoomId] || []).map(p => p.name);
  if (!names.length) return html;
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(${escaped.join('|')})(?=\\s|[.,!?;:]|$)`, 'g');
  return html.replace(re, (match, name) => '<span class="h-mention-inline">@' + wsEscHtml(name) + '</span>');
}

// ── Mention autocomplete ──────────────────────────────────────────────────
function showMentionPopup(query) {
  const popup = document.getElementById('mention-popup');
  const parts = roomParticipantsCache[currentRoomId] || [];
  const q = query.toLowerCase();
  const matches = parts.filter(p => p.actor_id !== humanActor?.id && p.name.toLowerCase().startsWith(q)).slice(0, 7);
  if (!matches.length) { hideMentionPopup(); return; }

  popup.innerHTML = '';
  mentionPopupIdx = 0;
  matches.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'h-mention-item';
    item.dataset.idx = i;
    item.appendChild(makeAvatar(p.name, p.avatar_color, p.avatar_url, 22));
    const name = document.createElement('span');
    name.className = 'h-mention-name';
    name.textContent = p.name;
    item.appendChild(name);
    item.onmousedown = e => {
      e.preventDefault();
      applyMention(p.name);
    };
    if (i === 0) item.classList.add('active');
    popup.appendChild(item);
  });
  popup.style.display = 'block';
}

function hideMentionPopup() {
  document.getElementById('mention-popup').style.display = 'none';
  mentionPopupIdx = -1;
}

function applyMention(name) {
  const input = document.getElementById('msg-input');
  const sel = window.getSelection();
  if (!sel.rangeCount) { hideMentionPopup(); return; }
  const node = sel.anchorNode;

  if (node.nodeType === 3 && input.contains(node)) {
    const text = node.textContent;
    const cursor = sel.anchorOffset;
    const before = text.slice(0, cursor);
    const match = before.match(/(^|\s)@([^\s]*)$/);
    if (match) {
      const start = match.index + match[1].length;
      const beforeText = text.slice(0, start);
      const afterText = text.slice(cursor);
      const parent = node.parentElement;
      const frag = document.createDocumentFragment();
      if (beforeText) frag.appendChild(document.createTextNode(beforeText));
      const span = document.createElement('span');
      span.className = 'h-mention-tag';
      span.contentEditable = 'false';
      span.textContent = '@' + name;
      frag.appendChild(span);
      const after = document.createTextNode(' ' + afterText);
      frag.appendChild(after);
      parent.replaceChild(frag, node);
      const range = document.createRange();
      range.setStart(after, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      hideMentionPopup();
      return;
    }
  }
  hideMentionPopup();
}

function mentionPopupNavigate(dir) {
  const popup = document.getElementById('mention-popup');
  if (popup.style.display === 'none') return false;
  const items = popup.querySelectorAll('.h-mention-item');
  if (!items.length) return false;
  items[mentionPopupIdx]?.classList.remove('active');
  mentionPopupIdx = (mentionPopupIdx + dir + items.length) % items.length;
  items[mentionPopupIdx].classList.add('active');
  return true;
}

function syncNewRoomBtn() {
  const hasAI = allActors.some(a => a.type === 'ai');
  document.getElementById('new-room-btn').classList.toggle('no-agents', !hasAI);
  document.getElementById('s-no-agent-banner')?.classList.toggle('visible', !hasAI);
}

// ── First-run setup ───────────────────────────────────────────────────────────
async function checkSetup() {
  let needsSetup;
  try { ({ needsSetup } = await fjson('/api/setup/status')); } catch { return; }
  if (!needsSetup) return;

  const overlay = document.getElementById('setup-overlay');
  const input   = document.getElementById('setup-name-input');
  const btn     = document.getElementById('setup-submit-btn');
  overlay.style.display = 'flex';
  setTimeout(() => input.focus(), 50);

  async function submit() {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    btn.disabled = true;
    try {
      await fjson('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      overlay.style.display = 'none';
    } catch (e) {
      console.error('Setup failed:', e);
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const saved = localStorage.getItem('stoa-theme');
  applyTheme(saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches));
  // Restore reading comfort preferences
  ['scale', 'leading', 'width'].forEach(k => {
    const v = localStorage.getItem('stoa-msg-' + k);
    if (v) {
      const cssVar = '--stoa-msg-' + k;
      document.documentElement.style.setProperty(cssVar, k === 'width' ? v + 'px' : v);
    }
  });
  document.getElementById('sidebar-collapse-btn').onclick = toggleSidebar;
  document.getElementById('empty-rooms-toggle').onclick = toggleSidebar;
  // Auth check — show login if not authenticated
  const isAuthed = await checkAuth();
  if (!isAuthed) { showLogin(); return; }
  hideLogin();
  requestNotifPermission();
  await checkSetup();
  try {
    allActors = await fjson('/api/actors');
  } catch (e) {
    console.error('Failed to load actors:', e);
    allActors = [];
  }
  allActors.forEach(a => actorByName[a.name] = a);
  humanActor = allActors.find(a => a.type === 'human');
  syncNewRoomBtn();
  renderSidebarFooter();
  renderComposerSeal();

  let rooms = [];
  try { rooms = await fjson('/api/rooms'); } catch (e) { console.error('Failed to load rooms:', e); }
  renderRoomList(rooms);

  await Promise.allSettled(rooms.map(async room => {
    const parts = await fjson(`/api/rooms/${room.id}/participants`);
    roomParticipantsCache[room.id] = parts;
    renderRoomDots(room.id, parts);
  }));

  // Keep messages scrolled when composer grows or virtual keyboard appears
  const composerEl = document.getElementById('composer');
  let lastComposerH = composerEl.offsetHeight;
  new ResizeObserver(() => {
    const h = composerEl.offsetHeight;
    if (h !== lastComposerH) {
      const msgEl = document.getElementById('messages');
      if (msgEl) msgEl.scrollTop += h - lastComposerH;
      lastComposerH = h;
    }
  }).observe(composerEl);

  if (window.visualViewport) {
    let lastVpH = window.visualViewport.height;
    window.visualViewport.addEventListener('resize', () => {
      const vpH = window.visualViewport.height;
      if (vpH < lastVpH) {
        const msgEl = document.getElementById('messages');
        if (msgEl) msgEl.scrollTop += lastVpH - vpH;
      }
      lastVpH = vpH;
    });
  }

  // Textarea — auto-resize + skill autocomplete
  const input = document.getElementById('msg-input');
  input.addEventListener('input', onComposerInput);
  input.addEventListener('keydown', e => {
    const popup = document.getElementById('skill-popup');
    const popupOpen = popup.style.display !== 'none';
    const mPopup = document.getElementById('mention-popup');
    const mOpen = mPopup.style.display !== 'none';

    if (popupOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      skillPopupNavigate(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (mOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      mentionPopupNavigate(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (popupOpen && e.key === 'Tab') {
      e.preventDefault();
      const active = popup.querySelector('.h-skill-item.active') || popup.querySelector('.h-skill-item');
      if (active) applySkill(active.querySelector('.h-skill-name').textContent.slice(1));
      return;
    }
    if (mOpen && e.key === 'Tab') {
      e.preventDefault();
      const active = mPopup.querySelector('.h-mention-item.active') || mPopup.querySelector('.h-mention-item');
      if (active) applyMention(active.querySelector('.h-mention-name').textContent);
      return;
    }
    if (popupOpen && e.key === 'Escape') {
      e.preventDefault(); hideSkillPopup(); return;
    }
    if (mOpen && e.key === 'Escape') {
      e.preventDefault(); hideMentionPopup(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'X') {
      e.preventDefault(); document.execCommand('strikeThrough', false, null); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
      e.preventDefault(); applyFormat('code'); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault(); applyFormat('link'); return;
    }

    // Tab indent/outdent in lists (Slack behavior)
    if (e.key === 'Tab') {
      const sel = window.getSelection();
      const li = sel.rangeCount && findAncestorTag(sel.anchorNode, 'LI');
      if (li) {
        e.preventDefault();
        document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, null);
        return;
      }
    }

    // Enter inside code block → newline (unless "Enter to send" is on without Shift)
    if (e.key === 'Enter') {
      const sel0 = window.getSelection();
      const pre0 = sel0.rangeCount && findAncestorTag(sel0.anchorNode, 'PRE');
      if (pre0 && (e.shiftKey || !document.getElementById('enter-send-toggle').classList.contains('active'))) {
        e.preventDefault();
        // Exit code block: Enter on empty line exits (Slack behavior)
        const preText = pre0.textContent;
        if (!preText || preText === '\n') {
          const div = document.createElement('div');
          div.innerHTML = '<br>';
          pre0.parentNode.insertBefore(div, pre0.nextSibling);
          pre0.remove();
          const r = document.createRange();
          r.setStart(div, 0);
          r.collapse(true);
          sel0.removeAllRanges(); sel0.addRange(r);
          return;
        }
        const range = sel0.getRangeAt(0);
        // Split: text after cursor goes to new <pre>
        const afterRange = document.createRange();
        afterRange.setStart(range.endContainer, range.endOffset);
        afterRange.setEnd(pre0, pre0.childNodes.length);
        const afterContent = afterRange.extractContents();
        const newPre = document.createElement('pre');
        if (afterContent.textContent || afterContent.querySelector('br')) {
          newPre.appendChild(afterContent);
        } else {
          newPre.innerHTML = '<br>';
        }
        pre0.parentNode.insertBefore(newPre, pre0.nextSibling);
        // If current pre is now empty, add <br> placeholder
        if (!pre0.textContent && !pre0.querySelector('br')) {
          pre0.innerHTML = '<br>';
        }
        const r = document.createRange();
        r.setStart(newPre, 0);
        r.collapse(true);
        sel0.removeAllRanges(); sel0.addRange(r);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (popupOpen && skillPopupIdx >= 0) {
        e.preventDefault();
        const active = popup.querySelector('.h-skill-item.active');
        if (active) applySkill(active.querySelector('.h-skill-name').textContent.slice(1));
        return;
      }
      if (mOpen && mentionPopupIdx >= 0) {
        e.preventDefault();
        const active = mPopup.querySelector('.h-mention-item.active');
        if (active) applyMention(active.querySelector('.h-mention-name').textContent);
        return;
      }
      // List continuation: Enter on empty list item exits list (Slack behavior)
      const sel = window.getSelection();
      const li = sel.rangeCount && findAncestorTag(sel.anchorNode, 'LI');
      if (li) {
        if (li.textContent === '' || li.textContent === '​') {
          e.preventDefault();
          const list = li.closest('ol, ul');
          li.remove();
          if (list && list.children.length === 0) list.remove();
          document.execCommand('insertParagraph', false, null);
          document.execCommand('outdent', false, null);
        }
        return; // let default Enter create next li
      }
      // "Enter to send" toggle — when off, Enter = newline
      if (!document.getElementById('enter-send-toggle').classList.contains('active')) return;
      e.preventDefault(); sendMessage();
    }
  });

  // Markdown shortcuts (Slack behavior): *bold*, _italic_, ~strike~, `code`, ```codeblock
  let mdProcessing = false;
  input.addEventListener('input', () => {
    if (mdProcessing) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const node = sel.anchorNode;
    if (!node) return;
    const tNode = node.nodeType === 3 ? node : null;
    if (!tNode) return;
    if (tNode.parentElement && tNode.parentElement.closest('pre')) return;
    const text = tNode.textContent;
    const cursor = sel.anchorOffset;
    const before = text.substring(0, cursor);

    // ``` — triple backtick instantly creates empty code block (Slack behavior)
    if (before.endsWith('```')) {
      mdProcessing = true;
      const start = cursor - 3;
      const range = document.createRange();
      range.setStart(tNode, start);
      range.setEnd(tNode, cursor);
      range.deleteContents();
      const pre = document.createElement('pre');
      pre.innerHTML = '<br>';
      if (tNode.textContent === '') {
        tNode.parentElement.replaceChild(pre, tNode);
      } else {
        range.insertNode(pre);
      }
      const r2 = document.createRange();
      r2.setStart(pre, 0);
      r2.collapse(true);
      sel.removeAllRanges(); sel.addRange(r2);
      mdProcessing = false;
      return;
    }

    // `code` — single backtick inline (but not ```)
    const codeMatch = before.match(/(?<!`)`([^`]+?)`$/);
    if (codeMatch) {
      mdProcessing = true;
      const start = cursor - codeMatch[0].length;
      const content = codeMatch[1];
      const range = document.createRange();
      range.setStart(tNode, start);
      range.setEnd(tNode, cursor);
      range.deleteContents();
      const code = document.createElement('code');
      code.textContent = content;
      range.insertNode(code);
      const r2 = document.createRange();
      r2.setStartAfter(code);
      r2.collapse(true);
      sel.removeAllRanges(); sel.addRange(r2);
      document.execCommand('insertText', false, '​');
      mdProcessing = false;
      return;
    }

    // Inline patterns: *bold*, _italic_, ~strike~
    const patterns = [
      { re: /\*([^\*]+?)\*$/, tag: 'strong' },
      { re: /_([^_]+?)_$/, tag: 'em' },
      { re: /~([^~]+?)~$/, tag: 's' },
    ];
    for (const p of patterns) {
      const m = before.match(p.re);
      if (m) {
        mdProcessing = true;
        const start = cursor - m[0].length;
        const content = m[1];
        const range = document.createRange();
        range.setStart(tNode, start);
        range.setEnd(tNode, cursor);
        range.deleteContents();
        const el = document.createElement(p.tag);
        el.textContent = content;
        range.insertNode(el);
        const r2 = document.createRange();
        r2.setStartAfter(el);
        r2.collapse(true);
        sel.removeAllRanges(); sel.addRange(r2);
        document.execCommand('insertText', false, '​');
        mdProcessing = false;
        return;
      }
    }
  });

  input.addEventListener('paste', e => {
    const items = [...(e.clipboardData?.items || [])];
    if (items.find(i => i.type.startsWith('image/'))) { handleImagePaste(e); return; }
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const urlRe = /^https?:\/\/\S+$/;
    const sel = window.getSelection();
    if (urlRe.test(text.trim()) && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      const selectedText = sel.toString();
      const a = document.createElement('a');
      a.href = text.trim();
      if (selectedText) {
        a.textContent = selectedText;
        range.deleteContents();
      } else {
        a.textContent = text.trim();
      }
      range.insertNode(a);
      range.setStartAfter(a);
      range.collapse(true);
      sel.removeAllRanges(); sel.addRange(range);
    } else {
      document.execCommand('insertText', false, text);
    }
  });

  // ── Formatting toolbar ──────────────────────────────────────────────────────
  function findAncestorTag(node, tag) {
    while (node && node !== input) {
      if (node.nodeName === tag) return node;
      node = node.parentElement;
    }
    return null;
  }

  function applyFormat(fmt) {
    input.focus();
    if (fmt === 'bold')   { document.execCommand('bold',          false, null); return; }
    if (fmt === 'italic') { document.execCommand('italic',        false, null); return; }
    if (fmt === 'strike') { document.execCommand('strikeThrough', false, null); return; }
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    if (fmt === 'code') {
      const existing = findAncestorTag(sel.anchorNode, 'CODE');
      if (existing && !existing.closest('pre')) {
        const parent = existing.parentElement;
        while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
        parent.removeChild(existing);
        return;
      }
    }
    if (fmt === 'codeblock') {
      const existing = findAncestorTag(sel.anchorNode, 'PRE');
      if (existing) {
        // Simply unwrap this <pre> into a <div> — each line is its own <pre>
        const div = document.createElement('div');
        div.innerHTML = existing.textContent || '<br>';
        existing.parentElement.replaceChild(div, existing);
        const r = document.createRange();
        r.selectNodeContents(div);
        r.collapse(false);
        sel.removeAllRanges(); sel.addRange(r);
        return;
      }
    }
    if (fmt === 'ol' || fmt === 'ul') {
      document.execCommand(fmt === 'ol' ? 'insertOrderedList' : 'insertUnorderedList', false, null);
      return;
    }
    if (fmt === 'blockquote') {
      const existing = findAncestorTag(sel.anchorNode, 'BLOCKQUOTE');
      if (existing) {
        document.execCommand('outdent', false, null);
      } else {
        document.execCommand('formatBlock', false, 'blockquote');
      }
      return;
    }
    if (fmt === 'link') {
      const text = sel.toString();
      wsShowPrompt('Insert link', '', 'https://...', (url) => {
        if (!url) return;
        const s = window.getSelection();
        if (text && s.rangeCount) {
          document.execCommand('createLink', false, url);
        } else if (s.rangeCount) {
          const a = document.createElement('a');
          a.href = url; a.textContent = url;
          const r = s.getRangeAt(0);
          r.insertNode(a);
          r.setStartAfter(a);
          r.collapse(true);
          s.removeAllRanges();
          s.addRange(r);
        }
      });
      return;
    }

    const text = sel.toString();
    const el = fmt === 'codeblock'
      ? Object.assign(document.createElement('pre'),  { textContent: text || '​' })
      : Object.assign(document.createElement('code'), { textContent: text || '​' });
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(el);
    range.setStartAfter(el);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  document.querySelectorAll('.h-fmt-btn').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      applyFormat(btn.dataset.fmt);
    });
  });

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel.rangeCount || !input.contains(sel.anchorNode)) return;
    document.querySelector('[data-fmt="bold"]')?.classList.toggle('active', document.queryCommandState('bold'));
    document.querySelector('[data-fmt="italic"]')?.classList.toggle('active', document.queryCommandState('italic'));
    document.querySelector('[data-fmt="strike"]')?.classList.toggle('active', document.queryCommandState('strikeThrough'));
    const inCode = !!findAncestorTag(sel.anchorNode, 'CODE') && !findAncestorTag(sel.anchorNode, 'PRE');
    const inPre = !!findAncestorTag(sel.anchorNode, 'PRE');
    document.querySelector('[data-fmt="code"]')?.classList.toggle('active', inCode);
    document.querySelector('[data-fmt="codeblock"]')?.classList.toggle('active', inPre);
    document.querySelector('[data-fmt="blockquote"]')?.classList.toggle('active', !!findAncestorTag(sel.anchorNode, 'BLOCKQUOTE'));
    document.querySelector('[data-fmt="ol"]')?.classList.toggle('active', !!findAncestorTag(sel.anchorNode, 'OL'));
    document.querySelector('[data-fmt="ul"]')?.classList.toggle('active', !!findAncestorTag(sel.anchorNode, 'UL'));
    document.querySelector('[data-fmt="link"]')?.classList.toggle('active', !!findAncestorTag(sel.anchorNode, 'A'));
  });

  // "Enter to send" toggle — default ON desktop, OFF mobile
  const enterToggle = document.getElementById('enter-send-toggle');
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
  const savedPref = localStorage.getItem('stoa-enter-send');
  const enterSendOn = savedPref !== null ? savedPref === 'true' : !isMobile;
  if (enterSendOn) enterToggle.classList.add('active');
  enterToggle.addEventListener('click', () => {
    enterToggle.classList.toggle('active');
    localStorage.setItem('stoa-enter-send', enterToggle.classList.contains('active'));
  });

  document.getElementById('send-btn').addEventListener('click', sendMessage);
  document.getElementById('stop-btn').addEventListener('click', stopGeneration);
  document.getElementById('new-room-btn').addEventListener('click', openNewRoomModal);
  initEmojiPicker();
  initScrollLoader();
  document.getElementById('new-room-create').addEventListener('click', submitNewRoom);
  document.getElementById('new-room-cancel').addEventListener('click', () => {
    document.getElementById('new-room-modal').style.display = 'none';
  });
  document.getElementById('new-room-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitNewRoom();
    if (e.key === 'Escape') document.getElementById('new-room-modal').style.display = 'none';
  });
  document.getElementById('new-room-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('new-room-modal')) {
      document.getElementById('new-room-modal').style.display = 'none';
    }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && wsEditMode) {
      e.preventDefault();
      wsSaveFile();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && currentRoomId) {
      e.preventDefault();
      toggleRoomSearch();
    }
    if (e.key === 'Escape') {
      if (wsExpanded) { wsToggleExpand(); return; }
      if (wsEditMode && !wsEditDirty) { wsExitEditMode(true); return; }
      const scrim = document.querySelector('.ws-scrim');
      if (scrim) { scrim.remove(); return; }
      const ctxMenu = document.querySelector('.ws-ctx-menu');
      if (ctxMenu) { ctxMenu.remove(); return; }
      const bar = document.getElementById('room-search-bar');
      if (bar.classList.contains('visible')) { closeRoomSearch(); return; }
      if (processingMessages.size > 0) { stopGeneration(); return; }
      hideSkillPopup();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (wsEditMode && wsEditDirty) { e.preventDefault(); e.returnValue = ''; }
  });
  window.onerror = (msg, src, line, col, err) => {
    fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, source: `${src}:${line}:${col}`, stack: err?.stack }) }).catch(() => {});
  };
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message || String(e.reason);
    fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Unhandled rejection: ' + msg, source: e.reason?.stack }) }).catch(() => {});
  });

  // Attach menu
  const attachMenu = document.getElementById('attach-menu');
  document.getElementById('attach-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    attachMenu.classList.toggle('visible');
  });
  document.addEventListener('click', () => attachMenu.classList.remove('visible'));

  function showUploadError(msg) {
    const el = document.getElementById('upload-error');
    document.getElementById('upload-error-text').textContent = msg;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 5000);
  }

  async function compressImage(file, maxDim, quality = 0.8) {
    if (!maxDim) maxDim = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 1280 : 1920;
    let bmp;
    if (typeof createImageBitmap === 'function') {
      bmp = await createImageBitmap(file);
    } else {
      bmp = await new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
        img.src = url;
      });
    }
    let { width, height } = bmp;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, width, height);
    if (bmp.close) bmp.close();
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('Compression failed'));
        const baseName = file.name.replace(/\.[^.]+$/, '') + '.webp';
        resolve(new File([blob], baseName, { type: 'image/webp' }));
      }, 'image/webp', quality);
    });
  }

  async function handleFileUpload(file, isImage) {
    try {
      let toUpload = file;
      if (isImage && file.size > 200 * 1024) {
        try {
          toUpload = await compressImage(file);
        } catch {
          try { toUpload = await compressImage(file, 800, 0.7); } catch { /* upload original */ }
        }
      }
      const { url, name } = await uploadWithProgress(toUpload);
      addPendingAttachment(url, name || file.name, isImage ? 'image' : 'file');
    } catch (err) {
      showUploadError(err.message || 'Upload failed');
    }
  }

  document.getElementById('attach-photo').addEventListener('click', () => {
    attachMenu.classList.remove('visible');
    const fi = document.createElement('input');
    fi.type = 'file';
    fi.accept = 'image/*';
    fi.multiple = true;
    fi.onchange = () => { for (const f of fi.files) handleFileUpload(f, true); };
    fi.click();
  });

  document.getElementById('attach-file').addEventListener('click', () => {
    attachMenu.classList.remove('visible');
    const fi = document.createElement('input');
    fi.type = 'file';
    fi.multiple = true;
    fi.onchange = () => { for (const f of fi.files) handleFileUpload(f, f.type.startsWith('image/')); };
    fi.click();
  });

  // Drag & drop file upload on composer
  const composer = document.getElementById('composer');
  composer.addEventListener('dragover', e => {
    e.preventDefault();
    composer.classList.add('drag-over');
  });
  composer.addEventListener('dragleave', e => {
    if (!composer.contains(e.relatedTarget)) composer.classList.remove('drag-over');
  });
  composer.addEventListener('drop', e => {
    e.preventDefault();
    composer.classList.remove('drag-over');
    for (const file of e.dataTransfer.files) {
      handleFileUpload(file, file.type.startsWith('image/'));
    }
  });

  initSettings();
  initGlobalWs();
}

// ── Settings ────────────────────────────────────────────────────────────────
let settingsOpen = false;
let settingsActors = [];
const sRowStates = new Map(); // id -> {state:'default'|'renaming'|'confirm-delete', draft:string}
let sAddPanel = { open: false, name: '', os: 'unix', phase: 'idle', baselineIds: new Set(), newActor: null, timer: null };

function sDetectOS() {
  return /Windows/.test(navigator.userAgent) ? 'ps' : 'unix';
}

function sFormatJoined(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 60) return 'just now';
  const d = new Date(ts);
  return d.getDate() + ' ' + d.toLocaleString('default', { month: 'short' });
}

function sIsAutoName(n) { return /^stoa-[0-9a-f]{6}$/i.test(n); }

const STOA_LANGS = { en: 'English', id: 'Bahasa Indonesia', ja: '日本語', ko: '한국어', zh: '中文' };

// SVG helpers
function svgPencil(sz=14) { return `<svg width="${sz}" height="${sz}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 2.5l2 2L5 13l-2.5.5L3 11z"/><path d="M10 4l2 2"/></svg>`; }
function svgX(sz=14) { return `<svg width="${sz}" height="${sz}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>`; }
function svgCheck(sz=14) { return `<svg width="${sz}" height="${sz}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>`; }
function svgSpinner(sz=16) { return `<svg width="${sz}" height="${sz}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M14 8a6 6 0 1 1-6-6"/></svg>`; }
function svgSpinnerTiny() { return `<svg class="s-spinner" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M14 8a6 6 0 1 1-6-6"/></svg>`; }
function svgUpdate(sz=14) { return `<svg width="${sz}" height="${sz}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v9M5 8l3 3 3-3"/><path d="M3 13h10"/></svg>`; }
function svgRefresh(sz=14) { return `<svg width="${sz}" height="${sz}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.1-3.3"/><path d="M14 2.5v3h-3"/></svg>`; }
function svgCopy(sz=14) { return `<svg width="${sz}" height="${sz}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2H4A1.5 1.5 0 0 0 2.5 3.5V9A1.5 1.5 0 0 0 4 10.5h1"/></svg>`; }

function openSettings() {
  settingsOpen = true;
  currentRoomId = null;
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  setConnected(false);
  document.querySelectorAll('.h-room-row').forEach(el => el.classList.remove('active'));
  document.getElementById('settings-row').classList.add('active');
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('chat-inner').classList.remove('visible');
  document.getElementById('settings-inner').classList.add('visible');
  document.body.classList.add('in-chat');
  sLoad();
}

function closeSettingsToSidebar() {
  document.body.classList.remove('in-chat');
}

async function sLoad() {
  let actors, cfg;
  try {
    [actors, cfg] = await Promise.all([fjson('/api/actors'), fjson('/api/settings')]);
  } catch { showToast('Failed to load settings', { error: true }); return; }
  settingsActors = actors;
  sPublicUrl = cfg.public_url || '';
  sPort = cfg.port || 3000;
  sRenderList();
}

function sRenderList() {
  const list = document.getElementById('s-agents-list');
  if (!list) return;
  list.innerHTML = '';
  for (const a of settingsActors) {
    if (!sRowStates.has(a.id)) sRowStates.set(a.id, { state: 'default', draft: a.name });
    list.appendChild(sMakeRow(a));
  }
}

function sMakeRow(actor, flash) {
  const rs = sRowStates.get(actor.id) || { state: 'default', draft: actor.name };
  const isHuman = actor.type === 'human';
  const color = actor.avatar_color || '#888';

  const row = document.createElement('div');
  row.className = 's-agent-row' + (flash ? ' s-just-connected' : '');
  row.id = 's-row-' + actor.id;

  // Avatar
  const av = document.createElement('div');
  av.style.cssText = 'flex-shrink:0;position:relative;cursor:pointer;';
  av.title = 'Change avatar';
  if (sIsAutoName(actor.name)) {
    const badge = document.createElement('span');
    badge.style.cssText = `width:32px;height:32px;border-radius:50%;border:1.5px dashed ${color};background:color-mix(in srgb,${color} 10%,var(--h-surface));color:${color};font-size:16px;display:inline-flex;align-items:center;justify-content:center;font-family:var(--h-serif);flex-shrink:0`;
    badge.textContent = actor.avatar_symbol || '◇';
    av.appendChild(badge);
  } else {
    av.appendChild(makeAvatar(actor.name, color, actor.avatar_url, 32));
  }
  // Camera overlay on hover
  const camOverlay = document.createElement('div');
  camOverlay.style.cssText = 'position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s;pointer-events:none;';
  camOverlay.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="14" height="10" rx="2"/><circle cx="8" cy="9" r="2.5"/><path d="M5 4l1.5-2h3L11 4"/></svg>`;
  av.appendChild(camOverlay);
  av.addEventListener('mouseenter', () => camOverlay.style.opacity = '1');
  av.addEventListener('mouseleave', () => camOverlay.style.opacity = '0');
  // File input for upload
  const avInput = document.createElement('input');
  avInput.type = 'file'; avInput.accept = 'image/*'; avInput.style.display = 'none';
  avInput.addEventListener('change', () => {
    if (avInput.files[0]) sResizeAndUploadActorAvatar(actor.id, avInput.files[0], av);
  });
  av.appendChild(avInput);
  av.addEventListener('click', () => avInput.click());
  row.appendChild(av);

  // Info column
  const info = document.createElement('div');
  info.className = 's-agent-info';

  if (rs.state === 'renaming') {
    const inp = document.createElement('input');
    inp.className = 's-rename-input';
    inp.style.borderColor = color;
    inp.value = rs.draft;
    inp.type = 'text';
    inp.spellcheck = false;
    inp.addEventListener('input', () => { const s = sRowStates.get(actor.id); if (s) s.draft = inp.value; });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); sCommitRename(actor.id); }
      if (e.key === 'Escape') { e.preventDefault(); sCancelRename(actor.id); }
    });
    inp.addEventListener('blur', () => setTimeout(() => {
      const s = sRowStates.get(actor.id);
      if (s && s.state === 'renaming') sCommitRename(actor.id);
    }, 150));
    info.appendChild(inp);
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  } else {
    const nameRow = document.createElement('div');
    nameRow.className = 's-agent-name-row';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = actor.name;
    nameRow.appendChild(nameSpan);
    nameRow.style.cursor = 'pointer';
    nameRow.addEventListener('click', () => sStartRename(actor.id));
    info.appendChild(nameRow);
  }

  const sub = document.createElement('div');
  sub.className = 's-agent-sub';
  const subParts = [isHuman ? 'you' : `actor #${actor.id}`];
  if (!isHuman && actor.adapter) subParts.push(actor.adapter);
  if (!isHuman && actor.client_version) subParts.push(`v${actor.client_version}`);
  subParts.push('joined ' + sFormatJoined(actor.created_at));
  sub.textContent = subParts.join(' · ');
  if (!isHuman) {
    fjson(`/api/actors/${actor.id}/workdirs`).then(wds => {
      if (wds.length > 0) {
        sub.textContent += ` · ${wds.length} workdir${wds.length > 1 ? 's' : ''}`;
      }
    }).catch(() => {});
  }
  info.appendChild(sub);

  if (!isHuman) {
    const actorLang = (() => { try { return JSON.parse(actor.adapter_config || '{}').lang || 'en'; } catch { return 'en'; } })();
    const langRow = document.createElement('div');
    langRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:2px';
    const langLabel = document.createElement('span');
    langLabel.style.cssText = 'font-size:11px;color:var(--h-ink-faint);font-family:var(--h-serif);font-style:italic';
    langLabel.textContent = 'lang';
    const langSel = document.createElement('select');
    langSel.style.cssText = 'font-size:11px;padding:1px 4px;border:1px solid var(--h-hair-soft);border-radius:4px;background:var(--h-surface);color:var(--h-ink-mute);cursor:pointer;font-family:var(--h-sans)';
    Object.entries(STOA_LANGS).forEach(([code, label]) => {
      const opt = document.createElement('option');
      opt.value = code; opt.textContent = label;
      if (code === actorLang) opt.selected = true;
      langSel.appendChild(opt);
    });
    langSel.addEventListener('change', async () => {
      try {
        const r = await fetch(`/api/actors/${actor.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: actor.name, lang: langSel.value }),
        });
        if (!r.ok) throw new Error();
      } catch { showToast('Failed to save language', { error: true }); }
    });
    langRow.appendChild(langLabel); langRow.appendChild(langSel);
    info.appendChild(langRow);
  }
  row.appendChild(info);

  // Status
  const stat = document.createElement('div');
  stat.className = 's-agent-status';
  stat.id = 's-stat-' + actor.id;
  const dot = document.createElement('span');
  dot.className = actor.online ? 's-dot-on' : 's-dot-off';
  dot.id = 's-dot-' + actor.id;
  const word = document.createElement('span');
  word.id = 's-word-' + actor.id;
  word.textContent = actor.online ? 'online' : 'offline';
  stat.appendChild(dot); stat.appendChild(word);
  row.appendChild(stat);

  // Actions
  const acts = document.createElement('div');
  acts.className = 's-row-actions' + (rs.state !== 'default' ? ' show' : '');

  if (rs.state === 'renaming') {
    const ok = document.createElement('button');
    ok.className = 's-icon-btn s-ok'; ok.title = 'Save';
    ok.innerHTML = svgCheck();
    ok.addEventListener('click', () => sCommitRename(actor.id));
    const cancel = document.createElement('button');
    cancel.className = 's-icon-btn'; cancel.title = 'Cancel';
    cancel.innerHTML = svgX();
    cancel.addEventListener('click', () => sCancelRename(actor.id));
    acts.appendChild(ok); acts.appendChild(cancel);

  } else if (rs.state === 'confirm-delete') {
    acts.appendChild(sMakeConfirmPill(actor));

  } else {
    const ren = document.createElement('button');
    ren.className = 's-icon-btn'; ren.title = 'Rename';
    ren.innerHTML = svgPencil();
    ren.addEventListener('click', e => { e.stopPropagation(); sStartRename(actor.id); });

    if (!isHuman) {
      const refresh = document.createElement('button');
      refresh.className = 's-icon-btn'; refresh.title = actor.online ? 'Rescan workdirs & skills' : 'Offline';
      refresh.disabled = !actor.online;
      refresh.innerHTML = svgRefresh();
      refresh.addEventListener('click', async e => {
        e.stopPropagation();
        refresh.disabled = true;
        refresh.style.opacity = '0.4';
        try {
          const rr = await fetch(`/api/actors/${actor.id}/rescan`, { method: 'POST' });
          if (!rr.ok) throw new Error();
          setTimeout(() => {
            fjson(`/api/actors/${actor.id}/workdirs`).then(wds => {
              const sub = document.querySelector(`#s-row-${actor.id} .s-agent-sub`);
              if (sub) {
                const base = `actor #${actor.id} · joined ${sFormatJoined(actor.created_at)}`;
                sub.textContent = wds.length > 0 ? `${base} · ${wds.length} workdir${wds.length > 1 ? 's' : ''}` : base;
              }
            }).catch(() => {});
            refresh.disabled = !actor.online;
            refresh.style.opacity = '';
          }, 1200);
        } catch { refresh.disabled = !actor.online; refresh.style.opacity = ''; showToast('Failed to refresh agent', { error: true }); }
      });
      acts.appendChild(refresh);

      const upd = document.createElement('button');
      upd.className = 's-icon-btn'; upd.title = actor.online ? 'Force update agent code' : 'Offline';
      upd.disabled = !actor.online;
      upd.innerHTML = svgUpdate();
      upd.addEventListener('click', async e => {
        e.stopPropagation();
        upd.disabled = true;
        upd.style.opacity = '0.4';
        try { const fu = await fetch(`/api/actors/${actor.id}/force-update`, { method: 'POST' }); if (!fu.ok) throw new Error(); } catch { showToast('Failed to send update command', { error: true }); }
        setTimeout(() => { upd.disabled = !actor.online; upd.style.opacity = ''; }, 3000);
      });
      acts.appendChild(upd);
    }

    const del = document.createElement('button');
    del.className = 's-icon-btn';
    del.title = isHuman ? "You can't remove yourself" : 'Remove';
    del.disabled = isHuman;
    del.innerHTML = svgX(15);
    if (!isHuman) del.addEventListener('click', e => { e.stopPropagation(); sStartDelete(actor.id); });
    acts.appendChild(ren); acts.appendChild(del);
  }

  row.appendChild(acts);
  return row;
}

function sMakeConfirmPill(actor) {
  const pill = document.createElement('div');
  pill.className = 's-confirm-pill';
  const lbl = document.createElement('span');
  lbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:13px;color:#b35a4b;white-space:nowrap';
  lbl.textContent = `remove ${actor.name}?`;
  const cancelBtn = document.createElement('button');
  cancelBtn.style.cssText = 'background:transparent;border:none;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12.5px;padding:4px 10px;border-radius:999px;cursor:pointer';
  cancelBtn.textContent = 'cancel';
  cancelBtn.addEventListener('click', () => sCancelDelete(actor.id));
  const removeBtn = document.createElement('button');
  removeBtn.style.cssText = 'background:#b35a4b;border:none;color:#fff5ef;font-family:var(--h-sans);font-size:12.5px;padding:5px 12px;border-radius:999px;cursor:pointer;letter-spacing:.01em';
  removeBtn.textContent = 'remove';
  removeBtn.addEventListener('click', () => sCommitDelete(actor.id));
  pill.appendChild(lbl); pill.appendChild(cancelBtn); pill.appendChild(removeBtn);
  return pill;
}

function sRefreshRow(id) {
  const actor = settingsActors.find(a => a.id === id);
  const el = document.getElementById('s-row-' + id);
  if (actor && el) el.replaceWith(sMakeRow(actor));
}

function sStartRename(id) {
  const a = settingsActors.find(a => a.id === id);
  sRowStates.set(id, { state: 'renaming', draft: a ? a.name : '' });
  sRefreshRow(id);
}

function sCancelRename(id) {
  sRowStates.set(id, { state: 'default', draft: '' });
  sRefreshRow(id);
}

async function sCommitRename(id) {
  const rs = sRowStates.get(id); if (!rs || rs.state !== 'renaming') return;
  const newName = rs.draft.trim();
  if (!newName) { sCancelRename(id); return; }
  const actor = settingsActors.find(a => a.id === id);
  const oldName = actor?.name;
  if (actor) actor.name = newName;
  sRowStates.set(id, { state: 'default', draft: '' });
  sRefreshRow(id);
  try {
    const r = await fetch(`/api/actors/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }) });
    if (!r.ok) throw new Error('rename failed');
    const ga = allActors.find(a => a.id === id);
    if (ga) { if (actorByName[ga.name]) delete actorByName[ga.name]; ga.name = newName; actorByName[newName] = ga; }
  } catch {
    if (actor) actor.name = oldName;
    sRefreshRow(id);
    showToast('Failed to rename', { error: true });
  }
}

function sStartDelete(id) {
  sRowStates.set(id, { state: 'confirm-delete', draft: '' });
  sRefreshRow(id);
}

function sCancelDelete(id) {
  sRowStates.set(id, { state: 'default', draft: '' });
  sRefreshRow(id);
}

async function sCommitDelete(id) {
  const row = document.getElementById('s-row-' + id);
  if (row) {
    row.style.transition = 'opacity .2s, max-height .2s ease-out, padding .2s';
    row.style.overflow = 'hidden';
    row.style.maxHeight = row.offsetHeight + 'px';
    row.style.opacity = '0';
    setTimeout(() => { row.style.maxHeight = '0'; row.style.padding = '0'; }, 10);
    setTimeout(() => row.remove(), 220);
  }
  settingsActors = settingsActors.filter(a => a.id !== id);
  sRowStates.delete(id);
  try {
    const r = await fetch(`/api/actors/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('delete failed');
    const idx = allActors.findIndex(a => a.id === id);
    if (idx >= 0) allActors.splice(idx, 1);
    syncNewRoomBtn();
  } catch { sRefreshRow(id); showToast('Failed to delete agent', { error: true }); }
}

// ── Add-agent panel ─────────────────────────────────────────────────────────
function sOpenAddPanel() {
  sAddPanel = { open: true, name: '', os: sDetectOS(), backend: 'claude', lang: 'en', phase: 'waiting',
    baselineIds: new Set(settingsActors.map(a => String(a.id))), newActor: null, timer: null };
  document.getElementById('s-add-agent-btn').style.display = 'none';
  sRenderAddPanel();
  const panel = document.getElementById('s-add-panel');
  requestAnimationFrame(() => panel.classList.add('open'));
  sStartPolling();
}

function sCloseAddPanel() {
  sStopPolling();
  sAddPanel.open = false;
  document.getElementById('s-add-panel').classList.remove('open');
  document.getElementById('s-add-agent-btn').style.display = '';
  setTimeout(() => {
    if (!sAddPanel.open) document.getElementById('s-add-panel').innerHTML = '';
  }, 250);
}

let sPublicUrl = '';   // cached from /api/settings
let sPort = 3000;      // cached from /api/settings

function sGetCmd() {
  const base = sPublicUrl || `http://localhost:${sPort}`;
  const params = [];
  if (sAddPanel.name) params.push(`name=${encodeURIComponent(sAddPanel.name)}`);
  if (sAddPanel.backend === 'gemini') params.push('backend=gemini');
  if (sAddPanel.lang && sAddPanel.lang !== 'en') params.push(`lang=${sAddPanel.lang}`);
  const q = params.length ? '?' + params.join('&') : '';
  const url = `${base}/${({unix:'install.sh',ps:'install.ps1',cmd:'install.cmd'})[sAddPanel.os]}${q}`;
  return {
    unix: `curl -fsSL "${url}" | bash`,
    ps:   `irm "${url}" | iex`,
    cmd:  `curl -fsSL "${url}" -o i.cmd && i.cmd && del i.cmd`,
  }[sAddPanel.os];
}

function sRenderAddPanel() {
  const panel = document.getElementById('s-add-panel');
  panel.innerHTML = '';

  // Header row
  const hdr = document.createElement('div');
  hdr.className = 's-panel-header';
  const title = document.createElement('span');
  title.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:17px;color:var(--h-ink)';
  title.textContent = 'invite a new AI agent';
  const sub = document.createElement('span');
  sub.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-faint)';
  sub.textContent = 'choose a backend and run the command on the target machine';
  const spacer = document.createElement('span'); spacer.style.flex = '1';
  const closeBtn = document.createElement('button');
  closeBtn.className = 's-icon-btn'; closeBtn.title = 'Close'; closeBtn.innerHTML = svgX(15);
  closeBtn.addEventListener('click', sCloseAddPanel);
  hdr.appendChild(title); hdr.appendChild(sub); hdr.appendChild(spacer); hdr.appendChild(closeBtn);
  panel.appendChild(hdr);

  // Server host row
  const hostRow = document.createElement('div');
  hostRow.className = 's-host-row';
  const hostLbl = document.createElement('span');
  hostLbl.className = 's-host-label'; hostLbl.textContent = 'server';
  const hostVal = document.createElement('span');
  hostVal.className = 's-host-value'; hostVal.textContent = sPublicUrl || location.origin;
  hostRow.appendChild(hostLbl); hostRow.appendChild(hostVal);
  panel.appendChild(hostRow);

  // Field row
  const fieldRow = document.createElement('div');
  fieldRow.className = 's-field-group-row';

  // Name group
  const nameGrp = document.createElement('div');
  nameGrp.className = 's-field-group';
  const nameLbl = document.createElement('span');
  nameLbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);letter-spacing:.04em';
  nameLbl.textContent = 'name';
  const nameInp = document.createElement('input');
  nameInp.className = 's-name-input'; nameInp.type = 'text'; nameInp.placeholder = 'e.g. Aria'; nameInp.value = sAddPanel.name;
  nameInp.addEventListener('input', () => { sAddPanel.name = nameInp.value; sUpdateCmd(); });
  const nameHint = document.createElement('span');
  nameHint.className = 's-field-hint'; nameHint.textContent = 'leave blank → auto-assigned (stoa-XXXXXX)';
  nameGrp.appendChild(nameLbl); nameGrp.appendChild(nameInp); nameGrp.appendChild(nameHint);

  // OS group
  const osGrp = document.createElement('div');
  osGrp.className = 's-field-group'; osGrp.style.minWidth = 'auto';
  const osLbl = document.createElement('span');
  osLbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);letter-spacing:.04em';
  osLbl.textContent = 'platform';
  const osPills = document.createElement('div');
  osPills.className = 's-os-pills'; osPills.id = 's-os-pills';
  [['unix','Linux / macOS'],['ps','Windows · PS'],['cmd','Windows · CMD']].forEach(([id,lbl]) => {
    const p = document.createElement('button');
    p.type = 'button'; p.className = 's-os-pill' + (sAddPanel.os === id ? ' active' : '');
    p.textContent = lbl; p.dataset.os = id;
    p.addEventListener('click', () => {
      sAddPanel.os = id;
      document.querySelectorAll('#s-os-pills .s-os-pill').forEach(x => x.classList.toggle('active', x.dataset.os === id));
      sUpdateCmd();
    });
    osPills.appendChild(p);
  });
  osGrp.appendChild(osLbl); osGrp.appendChild(osPills);

  // AI Agent dropdown (backend selector)
  const beGrp = document.createElement('div');
  beGrp.className = 's-field-group'; beGrp.style.minWidth = 'auto';
  const beLbl = document.createElement('span');
  beLbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);letter-spacing:.04em';
  beLbl.textContent = 'AI agent';
  const beSelect = document.createElement('select');
  beSelect.className = 's-name-input'; beSelect.style.cssText = 'width:auto;min-width:120px;cursor:pointer';
  [['claude','Claude Code CLI'],['gemini','Gemini CLI']].forEach(([id,lbl]) => {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = lbl;
    if (sAddPanel.backend === id) opt.selected = true;
    beSelect.appendChild(opt);
  });
  beSelect.addEventListener('change', () => { sAddPanel.backend = beSelect.value; sUpdateCmd(); });
  beGrp.appendChild(beLbl); beGrp.appendChild(beSelect);

  // Language group
  const langGrp = document.createElement('div');
  langGrp.className = 's-field-group'; langGrp.style.minWidth = 'auto';
  const langLbl = document.createElement('span');
  langLbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);letter-spacing:.04em';
  langLbl.textContent = 'language';
  const langSelect = document.createElement('select');
  langSelect.className = 's-name-input'; langSelect.style.cssText = 'width:auto;min-width:120px;cursor:pointer';
  Object.entries(STOA_LANGS).forEach(([id,lbl]) => {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = lbl;
    if (sAddPanel.lang === id) opt.selected = true;
    langSelect.appendChild(opt);
  });
  langSelect.addEventListener('change', () => { sAddPanel.lang = langSelect.value; sUpdateCmd(); });
  langGrp.appendChild(langLbl); langGrp.appendChild(langSelect);

  fieldRow.appendChild(beGrp); fieldRow.appendChild(langGrp); fieldRow.appendChild(nameGrp); fieldRow.appendChild(osGrp);
  panel.appendChild(fieldRow);

  // Command slip
  const slipWrap = document.createElement('div');
  const slipCaption = document.createElement('div');
  slipCaption.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-faint);margin-bottom:8px;letter-spacing:.02em';
  slipCaption.textContent = 'run this on the target machine';
  const slip = document.createElement('div');
  slip.className = 's-cmd-slip'; slip.id = 's-cmd-slip';
  const dollar = document.createElement('span'); dollar.className = 's-cmd-dollar'; dollar.textContent = '$';
  const cmdText = document.createElement('span'); cmdText.id = 's-cmd-text'; cmdText.textContent = sGetCmd();
  const copyBtn = document.createElement('button');
  copyBtn.className = 's-cmd-copy'; copyBtn.title = 'Copy'; copyBtn.innerHTML = svgCopy();
  copyBtn.addEventListener('click', async () => {
    const text = document.getElementById('s-cmd-text')?.textContent || '';
    if (await copyToClipboard(text)) {
      copyBtn.classList.add('copied'); copyBtn.innerHTML = svgCheck(14);
      setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.innerHTML = svgCopy(); }, 1000);
    }
  });
  slip.appendChild(dollar); slip.appendChild(cmdText); slip.appendChild(copyBtn);
  slipWrap.appendChild(slipCaption); slipWrap.appendChild(slip);
  panel.appendChild(slipWrap);

  // Status area
  panel.appendChild(sMakeWaitingPill());

  setTimeout(() => nameInp.focus(), 50);
}

function sUpdateCmd() {
  const el = document.getElementById('s-cmd-text');
  if (el) el.textContent = sGetCmd();
}

function sMakeWaitingPill() {
  const w = document.createElement('div');
  w.className = 's-waiting-pill'; w.id = 's-waiting-pill';
  w.innerHTML = `<svg class="s-spinner" viewBox="0 0 16 16" fill="none" stroke="var(--h-ink-mute)" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M14 8a6 6 0 1 1-6-6"/></svg>
    <span style="font-family:var(--h-serif);font-style:italic;font-size:14px;color:var(--h-ink-mute)">waiting for agent to connect…</span>
    <span style="flex:1"></span>
    <span style="font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-faint)">usually under 30 seconds</span>`;
  return w;
}

function sMakeConnectedSlip(actor) {
  const slip = document.createElement('div');
  slip.className = 's-connected-slip';
  slip.id = 's-setup-slip-' + actor.id;

  const top = document.createElement('div'); top.className = 's-connected-slip-top';
  const spinner = document.createElement('span');
  spinner.className = 's-spinner'; spinner.id = 's-setup-spinner-' + actor.id;
  spinner.innerHTML = svgSpinner(20);
  const col = document.createElement('div'); col.style.cssText = 'display:flex;flex-direction:column;gap:2px';
  const l1 = document.createElement('div'); l1.style.cssText = 'font-family:var(--h-serif);font-size:16px;color:var(--h-ink)';
  l1.innerHTML = `<span style="font-family:ui-monospace,'Cascadia Code',Menlo,monospace;font-size:14px">${escHtml(actor.name)}</span> <span style="font-style:italic;color:var(--h-ink-mute)">setting up...</span>`;
  l1.id = 's-setup-title-' + actor.id;
  col.appendChild(l1);
  const spacer = document.createElement('span'); spacer.style.flex = '1';
  const doneBtn = document.createElement('button');
  doneBtn.className = 'h-btn-primary'; doneBtn.style.cssText = 'padding:7px 16px;font-size:13px;opacity:0.4;pointer-events:none';
  doneBtn.textContent = 'done';
  doneBtn.id = 's-setup-done-' + actor.id;
  doneBtn.addEventListener('click', sCloseAddPanel);
  top.appendChild(spinner); top.appendChild(col); top.appendChild(spacer); top.appendChild(doneBtn);

  const progress = document.createElement('div'); progress.className = 's-setup-progress';
  const bar = document.createElement('div'); bar.className = 's-progress-bar';
  const fill = document.createElement('div'); fill.className = 's-progress-fill'; fill.id = 's-setup-fill-' + actor.id;
  fill.style.width = '50%';
  bar.appendChild(fill);

  const steps = document.createElement('div'); steps.className = 's-progress-steps';
  steps.innerHTML = `
    <div class="s-progress-step done"><span class="s-step-icon">${svgCheck(13)}</span> Connected as actor #${actor.id}</div>
    <div class="s-progress-step active" id="s-setup-step2-${actor.id}"><span class="s-step-icon">${svgSpinnerTiny()}</span> Scanning skills &amp; workdirs...</div>
  `;
  progress.appendChild(bar); progress.appendChild(steps);
  slip.appendChild(top); slip.appendChild(progress);
  return slip;
}

function sFinishSetupSlip(actorId) {
  const fill = document.getElementById('s-setup-fill-' + actorId);
  if (fill) fill.style.width = '100%';
  const step2 = document.getElementById('s-setup-step2-' + actorId);
  if (step2) { step2.className = 's-progress-step done'; step2.innerHTML = `<span class="s-step-icon">${svgCheck(13)}</span> Skills &amp; workdirs ready`; }
  const spinner = document.getElementById('s-setup-spinner-' + actorId);
  if (spinner) { spinner.className = 's-connected-check'; spinner.innerHTML = svgCheck(16); }
  const title = document.getElementById('s-setup-title-' + actorId);
  if (title) {
    const name = title.querySelector('span')?.textContent || '';
    title.innerHTML = `<span style="font-family:ui-monospace,'Cascadia Code',Menlo,monospace;font-size:14px">${escHtml(name)}</span> <span style="font-style:italic;color:var(--h-ink-mute)">ready</span>`;
  }
  const l2 = document.createElement('div'); l2.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-faint)';
  l2.textContent = "rename them above, or leave the auto-name — they'll appear in your rooms.";
  title?.parentElement?.appendChild(l2);
  const doneBtn = document.getElementById('s-setup-done-' + actorId);
  if (doneBtn) { doneBtn.style.opacity = '1'; doneBtn.style.pointerEvents = 'auto'; }
}

function sStartPolling() {
  sStopPolling();
  sAddPanel.timer = setInterval(async () => {
    if (!sAddPanel.open || sAddPanel.phase === 'connected') { sStopPolling(); return; }
    try {
      const actors = await fjson('/api/actors');
      settingsActors = actors;
      // Update status dots for existing rows
      actors.forEach(a => {
        const dot = document.getElementById('s-dot-' + a.id);
        const word = document.getElementById('s-word-' + a.id);
        if (dot)  dot.className = a.online ? 's-dot-on' : 's-dot-off';
        if (word) word.textContent = a.online ? 'online' : 'offline';
      });
      // Detect new AI actor
      const newAI = actors.find(a => a.type === 'ai' && !sAddPanel.baselineIds.has(String(a.id)));
      if (newAI) {
        sAddPanel.phase = 'connected'; sAddPanel.newActor = newAI;
        allActors.push(newAI); syncNewRoomBtn();
        sStopPolling();
        if (!sRowStates.has(newAI.id)) sRowStates.set(newAI.id, { state: 'default', draft: newAI.name });
        const list = document.getElementById('s-agents-list');
        if (list) list.prepend(sMakeRow(newAI, true));
        const waiting = document.getElementById('s-waiting-pill');
        const panel = document.getElementById('s-add-panel');
        if (waiting) waiting.replaceWith(sMakeConnectedSlip(newAI));
        else if (panel) panel.appendChild(sMakeConnectedSlip(newAI));
        try { const wds = await fjson(`/api/actors/${newAI.id}/workdirs`); if (wds.length) sFinishSetupSlip(newAI.id); } catch {}
      }
    } catch {}
  }, 2000);
}

function sStopPolling() {
  if (sAddPanel.timer) { clearInterval(sAddPanel.timer); sAddPanel.timer = null; }
}

// ── Settings tab switching ────────────────────────────────────────────────────
function sActivateTab(name) {
  document.querySelectorAll('.s-tab[data-tab]').forEach(el => {
    const isActive = el.dataset.tab === name;
    el.classList.toggle('active', isActive);
  });
  ['agents', 'server', 'general', 'docs'].forEach(t => {
    const el = document.getElementById('s-tab-' + t);
    if (el) el.style.display = t === name ? '' : 'none';
  });
  if (name === 'server')  sLoadServerTab();
  if (name === 'general') sLoadGeneralTab();
  if (name === 'docs')    sLoadDocsTab();
}

// ── Docs tab ─────────────────────────────────────────────────────────────────
let docsLang    = localStorage.getItem('stoa-docs-lang') || 'en';
let docsCatalog = [];   // [{ slug, title, langs }]
let docsActiveSlug = null;

async function sLoadDocsTab() {
  docsCatalog = await fjson('/api/docs');
  sRenderDocsLangRow();
  sRenderDocsSidebar();
}

function sRenderDocsLangRow() {
  const allLangs = [...new Set(docsCatalog.flatMap(d => d.langs))].sort();
  const sel = document.getElementById('s-docs-lang-select');
  sel.innerHTML = '';
  for (const lang of allLangs) {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = STOA_LANGS[lang] || lang.toUpperCase();
    if (lang === docsLang) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = () => {
    docsLang = sel.value;
    localStorage.setItem('stoa-docs-lang', docsLang);
    sRenderDocsSidebar();
    if (docsActiveSlug) sOpenDoc(docsActiveSlug);
  };
}

function sRenderDocsSidebar() {
  const sidebar = document.getElementById('s-docs-sidebar');
  sidebar.innerHTML = '';
  for (const doc of docsCatalog) {
    const a = document.createElement('a');
    a.className = 's-docs-file' + (doc.slug === docsActiveSlug ? ' active' : '');
    a.textContent = doc.title;
    a.href = '#';
    a.dataset.slug = doc.slug;
    a.addEventListener('click', e => { e.preventDefault(); sOpenDoc(doc.slug); });
    sidebar.appendChild(a);
  }
}

async function sOpenDoc(slug) {
  docsActiveSlug = slug;
  document.querySelectorAll('.s-docs-file').forEach(el =>
    el.classList.toggle('active', el.dataset.slug === slug));
  const body = document.getElementById('s-docs-body');
  body.innerHTML = '<p class="s-docs-empty">loading…</p>';

  try {
    const doc = docsCatalog.find(d => d.slug === slug);
    const lang = doc?.langs.includes(docsLang) ? docsLang : 'en';
    const filename = `${slug}.${lang}.md`;
    const res = await fetch(`/api/docs/${encodeURIComponent(filename)}`);
    if (!res.ok) { body.innerHTML = '<p class="s-docs-empty">document not found.</p>'; return; }
    const md = await res.text();
    body.innerHTML = DOMPurify.sanitize(marked.parse(md), { ADD_ATTR: ['class'] });
    addCopyButtons(body);
    if (lang !== docsLang) {
      const note = document.createElement('p');
      note.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12px;color:var(--h-ink-faint);margin-bottom:16px';
      note.textContent = `Translation not available — showing English version.`;
      body.insertBefore(note, body.firstChild);
    }
  } catch { body.innerHTML = '<p class="s-docs-empty">failed to load document.</p>'; }
}

// ── Reading comfort controls ──────────────────────────────────────────────
const MSG_SIZES = [
  { label: 'Tiny', v: 0.72, icon: 13 },
  { label: 'Small', v: 0.82, icon: 15 },
  { label: 'Compact', v: 0.9, icon: 17 },
  { label: 'Default', v: 1.0, icon: 20 },
];
const MSG_LEADS = [
  { label: 'Tight', v: 0.9, gap: 2 },
  { label: 'Normal', v: 1.0, gap: 4 },
  { label: 'Relaxed', v: 1.15, gap: 6 },
];
const MSG_WIDTHS = [
  { label: 'Narrow', v: 460, w: 14 },
  { label: 'Standard', v: 560, w: 20 },
  { label: 'Wide', v: 680, w: 26 },
];

function sGetMsgPref(key, def) {
  const v = localStorage.getItem('stoa-msg-' + key);
  return v !== null ? parseFloat(v) : def;
}

function sApplyMsgVar(cssVar, val, storeKey) {
  document.documentElement.style.setProperty(cssVar, typeof val === 'number' && val > 100 ? val + 'px' : String(val));
  localStorage.setItem('stoa-msg-' + storeKey, val);
}

function sRenderReadingControls() {
  const el = document.getElementById('s-reading-controls');
  if (!el) return;

  let scale = sGetMsgPref('scale', 1);
  let lead = sGetMsgPref('leading', 1);
  let width = sGetMsgPref('width', 560);

  function nearest(arr, val) { return arr.reduce((b, o) => Math.abs(o.v - val) < Math.abs(b.v - val) ? o : b); }

  function render() {
    const aSize = nearest(MSG_SIZES, scale);
    const aLead = nearest(MSG_LEADS, lead);
    const aWid = nearest(MSG_WIDTHS, width);

    el.innerHTML = '';

    // Text size
    const sizeLabel = document.createElement('div');
    sizeLabel.className = 's-msg-sublabel';
    sizeLabel.textContent = 'text size';
    el.appendChild(sizeLabel);

    const sizeRow = document.createElement('div');
    sizeRow.className = 's-msg-row';
    MSG_SIZES.forEach(o => {
      const btn = document.createElement('button');
      btn.className = 's-seg-btn' + (o.label === aSize.label ? ' active' : '');
      btn.innerHTML = `<span class="s-seg-icon" style="font-size:${o.icon}px">A</span><span class="s-seg-label">${o.label}</span>`;
      btn.onclick = () => { scale = o.v; sApplyMsgVar('--stoa-msg-scale', o.v, 'scale'); render(); };
      sizeRow.appendChild(btn);
    });
    el.appendChild(sizeRow);

    // Line spacing + width row
    const wrapRow = document.createElement('div');
    wrapRow.className = 's-msg-row-wrap';

    // Line spacing
    const leadCol = document.createElement('div');
    leadCol.className = 's-msg-col';
    const leadLabel = document.createElement('div');
    leadLabel.className = 's-msg-sublabel';
    leadLabel.textContent = 'line spacing';
    leadCol.appendChild(leadLabel);
    const leadRow = document.createElement('div');
    leadRow.className = 's-msg-row';
    MSG_LEADS.forEach(o => {
      const btn = document.createElement('button');
      btn.className = 's-seg-btn' + (o.label === aLead.label ? ' active' : '');
      const bars = `<span class="s-seg-bars" style="gap:${o.gap}px"><span class="s-seg-bar"></span><span class="s-seg-bar"></span><span class="s-seg-bar"></span></span>`;
      btn.innerHTML = `${bars}<span class="s-seg-label">${o.label}</span>`;
      btn.onclick = () => { lead = o.v; sApplyMsgVar('--stoa-msg-leading', o.v, 'leading'); render(); };
      leadRow.appendChild(btn);
    });
    leadCol.appendChild(leadRow);
    wrapRow.appendChild(leadCol);

    // Width
    const widCol = document.createElement('div');
    widCol.className = 's-msg-col';
    const widLabel = document.createElement('div');
    widLabel.className = 's-msg-sublabel';
    widLabel.textContent = 'width';
    widCol.appendChild(widLabel);
    const widRow = document.createElement('div');
    widRow.className = 's-msg-row';
    MSG_WIDTHS.forEach(o => {
      const btn = document.createElement('button');
      btn.className = 's-seg-btn' + (o.label === aWid.label ? ' active' : '');
      const bars = `<span class="s-seg-bars" style="gap:3px"><span class="s-seg-bar" style="width:${o.w}px"></span><span class="s-seg-bar" style="width:${o.w}px"></span></span>`;
      btn.innerHTML = `${bars}<span class="s-seg-label">${o.label}</span>`;
      btn.onclick = () => { width = o.v; sApplyMsgVar('--stoa-msg-width', o.v, 'width'); render(); };
      widRow.appendChild(btn);
    });
    widCol.appendChild(widRow);
    wrapRow.appendChild(widCol);
    el.appendChild(wrapRow);

    // Live preview
    const preview = document.createElement('div');
    preview.className = 's-msg-preview';

    const aiRow = document.createElement('div');
    aiRow.className = 's-msg-preview-row';
    const aiBubble = document.createElement('div');
    aiBubble.className = 's-msg-preview-bubble';
    aiBubble.style.cssText = `max-width:min(var(--stoa-msg-width,560px),78%);font-size:calc(var(--stoa-msg-scale,1)*16px);line-height:calc(1.6*var(--stoa-msg-leading,1));border-top-left-radius:4px;background:color-mix(in srgb,#6f9f8c 16%,var(--h-surface));border-color:color-mix(in srgb,#6f9f8c 36%,var(--h-surface))`;
    aiBubble.innerHTML = 'The client replays from the last <em>message_state</em> event — not from the last token, so a reconnect never loses the thread.';
    aiRow.appendChild(aiBubble);
    preview.appendChild(aiRow);

    const humanRow = document.createElement('div');
    humanRow.className = 's-msg-preview-row human';
    const humanBubble = document.createElement('div');
    humanBubble.className = 's-msg-preview-bubble';
    humanBubble.style.cssText = `max-width:min(var(--stoa-msg-width,560px),78%);font-size:calc(var(--stoa-msg-scale,1)*16px);line-height:calc(1.6*var(--stoa-msg-leading,1));border-top-right-radius:4px;background:var(--h-slip);border-color:var(--h-hair-soft)`;
    humanBubble.textContent = 'Got it — that reads much better at this size.';
    humanRow.appendChild(humanBubble);
    preview.appendChild(humanRow);

    el.appendChild(preview);
  }

  render();
}

async function sLoadGeneralTab() {
  sRenderReadingControls();
  try {
    const user = await fjson('/api/auth/me');
    document.getElementById('s-auth-email-input').value = user.email || '';
  } catch {}
  // Notification toggle
  const toggle = document.getElementById('s-notif-toggle');
  const hint = document.getElementById('s-notif-hint');
  toggle.className = 's-notif-toggle' + (notifEnabled ? ' on' : '');
  if (!('Notification' in window)) {
    hint.textContent = 'Your browser does not support notifications.';
  } else if (Notification.permission === 'denied') {
    hint.textContent = 'Notifications blocked by browser. Allow in browser settings.';
  } else {
    hint.textContent = notifEnabled ? 'You will be notified when agents respond in other rooms.' : 'Notifications are off.';
  }
}

async function sLoadServerTab() {
  const data = await fjson('/api/settings');
  const port = data.port || 3000;
  document.getElementById('s-human-name-input').value = data.human_name || '';
  const storedUrl = data.public_url || '';
  try { const u = new URL(storedUrl); document.getElementById('s-public-url-input').value = u.protocol + '//' + u.hostname; }
  catch { document.getElementById('s-public-url-input').value = storedUrl; }
  document.getElementById('s-public-url-input').placeholder = 'http://localhost';
  document.getElementById('s-port-input').value = port;
  document.getElementById('s-max-ai-turns-input').value = data.max_ai_turns || 15;
  document.getElementById('s-max-concurrent-input').value = data.max_concurrent || 1;
  document.getElementById('s-session-idle-ttl-input').value = data.session_idle_ttl || 5;
  document.getElementById('s-cleanup-hour-input').value = data.cleanup_cron_hour ?? 10;
  document.getElementById('s-cleanup-age-input').value = data.cleanup_max_age_hours || 24;
  sPublicUrl = data.public_url || '';
  sPort = port;
  // Populate avatar preview from current humanActor
  const human = humanActor || allActors.find(a => a.type === 'human');
  sUpdateAvatarPreview(human?.avatar_url || null);
}

async function sSaveSetting(key, value, savedId) {
  const body = {};
  body[key] = value;
  try { const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) { showToast('Failed to save setting', { error: true }); return; } } catch { showToast('Failed to save setting', { error: true }); return; }
  const el = document.getElementById(savedId);
  if (el) { el.classList.add('visible'); setTimeout(() => el.classList.remove('visible'), 2000); }
  if (key === 'human_name') {
    const actor = allActors.find(a => a.type === 'human');
    if (actor) { actor.name = value; renderSidebarFooter(); }
  }
}

// ── Avatar upload helpers ───────────────────────────────────────────────────
function sUpdateAvatarPreview(avatarUrl) {
  const preview = document.getElementById('s-avatar-preview');
  const removeBtn = document.getElementById('s-avatar-remove');
  if (!preview) return;
  preview.innerHTML = '';
  if (avatarUrl) {
    const img = document.createElement('img');
    img.src = avatarUrl;
    preview.appendChild(img);
    if (removeBtn) removeBtn.classList.add('visible');
  } else {
    const human = humanActor || allActors.find(a => a.type === 'human');
    if (human) preview.appendChild(makeAvatar(human.name, human.avatar_color, null, 52));
    if (removeBtn) removeBtn.classList.remove('visible');
  }
}

async function sResizeAndUploadAvatar(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > 2 * 1024 * 1024) { alert('Image must be under 2 MB.'); return; }
  const human = humanActor || allActors.find(a => a.type === 'human');
  if (!human) return;

  const reader = new FileReader();
  reader.onload = e => {
    const origDataUrl = e.target.result;
    const img = new Image();
    img.onload = async () => {
      const maxSize = 256;
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else       { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL(file.type === 'image/gif' ? 'image/png' : file.type);
      try {
        const res = await fetch(`/api/actors/${human.id}/avatar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data_url: dataUrl }),
        });
        if (!res.ok) throw new Error('avatar upload failed');
        const data = await res.json();
        if (data.avatar_url) {
          human.avatar_url = data.avatar_url;
          sUpdateAvatarPreview(data.avatar_url);
          renderSidebarFooter();
          renderComposerSeal();
        }
      } catch (err) { console.error('avatar upload failed', err); showToast('Failed to upload avatar', { error: true }); }
    };
    img.onerror = () => { console.error('Failed to load image for avatar'); showToast('Invalid image file', { error: true }); };
    img.src = origDataUrl;
  };
  reader.onerror = () => console.error('Failed to read file for avatar');
  reader.readAsDataURL(file);
}

async function sRemoveAvatar() {
  const human = humanActor || allActors.find(a => a.type === 'human');
  if (!human) return;
  try {
    const delRes = await fetch(`/api/actors/${human.id}/avatar`, { method: 'DELETE' });
    if (!delRes.ok) throw new Error('avatar delete failed');
    human.avatar_url = null;
    sUpdateAvatarPreview(null);
    renderSidebarFooter();
    renderComposerSeal();
  } catch (err) { console.error('avatar remove failed', err); showToast('Failed to remove avatar', { error: true }); }
}

async function sResizeAndUploadActorAvatar(actorId, file, avEl) {
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > 2 * 1024 * 1024) { alert('Image must be under 2 MB.'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = async () => {
      const maxSize = 256;
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else       { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL(file.type === 'image/gif' ? 'image/png' : file.type);
      try {
        const res = await fetch(`/api/actors/${actorId}/avatar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data_url: dataUrl }),
        });
        if (!res.ok) throw new Error('avatar upload failed');
        const data = await res.json();
        if (data.avatar_url) {
          const actor = allActors.find(a => a.id === actorId);
          if (actor) actor.avatar_url = data.avatar_url;
          // Replace avatar element in row
          const imgEl = document.createElement('img');
          imgEl.src = data.avatar_url;
          imgEl.style.cssText = 'width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;display:block;';
          const existing = avEl.querySelector('img, .h-seal');
          if (existing) avEl.replaceChild(imgEl, existing);
          else avEl.prepend(imgEl);
        }
      } catch (err) { console.error('actor avatar upload failed', err); showToast('Failed to upload avatar', { error: true }); }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

let globalWs = null;
function initGlobalWs() {
  function connect() {
    globalWs = new WebSocket(`ws://${location.host}`);
    globalWs.onopen = () => globalWs.send(JSON.stringify({ type: 'subscribe_global' }));
    globalWs.onmessage = async e => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'actor_status') handleActorStatus(msg.actor);
      if (msg.type === 'agent_scan_complete') sFinishSetupSlip(msg.actor_id);
      if (msg.type === 'actor_removed') handleActorRemoved(msg.actor_id, msg.affected_rooms);
      if (msg.type === 'server_restart') handleServerRestart(msg);
      if (msg.type === 'room_deleted' || msg.type === 'room_archived') {
        if (currentRoomId === msg.room_id) {
          currentRoomId = null;
          document.getElementById('messages-inner').innerHTML = '';
          document.getElementById('chat-header').innerHTML = '';
        }
        refreshRoomList();
      }
      if (msg.type === 'room_restored') {
        refreshRoomList();
      }
      if (msg.type === 'model_update') handleModelUpdate(msg);
      if (msg.type === 'room_created' || msg.type === 'room_activity' || msg.type === 'room_updated') {
        // Notify for activity in rooms user is not currently viewing
        if (msg.type === 'room_activity' && msg.room_id !== currentRoomId) {
          const roomEl = document.querySelector(`.h-room-row[data-room-id="${msg.room_id}"]`);
          const roomTitle = roomEl?.querySelector('.h-room-title-text')?.textContent || 'Room';
          showDesktopNotif(`New message in ${roomTitle}`, '', msg.room_id);
        }
        refreshRoomList();
      }
    };
    globalWs.onclose = () => setTimeout(connect, 3000);
    globalWs.onerror = e => console.warn('[globalWs] error', e);
  }
  connect();
}

async function refreshRoomList() {
  try {
    const isArchived = currentRoomTab === 'archived';
    const rooms = await fjson(`/api/rooms${isArchived ? '?archived=1' : ''}`);
    renderRoomList(rooms);
    rooms.forEach(async room => {
      try {
        const parts = await fjson(`/api/rooms/${room.id}/participants`);
        roomParticipantsCache[room.id] = parts;
        renderRoomDots(room.id, parts);
      } catch {}
    });
  } catch {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshRoomList();
});

function handleActorStatus(actor) {
  if (!actor) return;
  const existing = allActors.find(a => a.id === actor.id);
  if (actor.online) {
    if (existing) {
      Object.assign(existing, actor);
    } else {
      allActors.push(actor);
      actorByName[actor.name] = actor;
      syncNewRoomBtn();
    }
    // Update settings list row
    const existingRow = document.getElementById('s-row-' + actor.id);
    if (!existingRow) {
      // New actor — add to settings list
      if (!sRowStates.has(actor.id)) sRowStates.set(actor.id, { state: 'default', draft: actor.name });
      const list = document.getElementById('s-agents-list');
      if (list) list.prepend(sMakeRow({ ...actor }, true));
      settingsActors = allActors.filter(a => a.type !== 'human' || a.id === humanActor?.id);
    }
    // Update add panel if open and waiting
    if (sAddPanel?.phase === 'waiting' && actor.type === 'ai' && !sAddPanel.baselineIds?.has(String(actor.id))) {
      sAddPanel.phase = 'connected'; sAddPanel.newActor = actor;
      sStopPolling();
      const waiting = document.getElementById('s-waiting-pill');
      const panel = document.getElementById('s-add-panel');
      if (waiting) waiting.replaceWith(sMakeConnectedSlip(actor));
      else if (panel) panel.appendChild(sMakeConnectedSlip(actor));
      fjson(`/api/actors/${actor.id}/workdirs`).then(wds => { if (wds.length) sFinishSetupSlip(actor.id); }).catch(() => {});
    }
  }
  // Always update status dot and word
  const dot = document.getElementById('s-dot-' + actor.id);
  const word = document.getElementById('s-word-' + actor.id);
  if (dot) dot.className = actor.online ? 's-dot-on' : 's-dot-off';
  if (word) word.textContent = actor.online ? 'online' : 'offline';
  // Update version in sub text when agent reconnects with new version
  if (actor.client_version && actor.online) {
    const sub = document.querySelector(`#s-row-${actor.id} .s-agent-sub`);
    if (sub) {
      const text = sub.textContent;
      const vMatch = text.match(/· v[\d.]+/);
      if (vMatch) sub.textContent = text.replace(/· v[\d.]+/, `· v${actor.client_version}`);
      else sub.textContent = text.replace(/· joined/, `· v${actor.client_version} · joined`);
    }
  }
  // Update refresh/update button disabled state
  const row = document.getElementById('s-row-' + actor.id);
  if (row) {
    row.querySelectorAll('.s-icon-btn').forEach(btn => {
      if (btn.title === 'Rescan workdirs & skills' || btn.title === 'Force update agent code' ||
          btn.title === 'Offline') {
        btn.disabled = !actor.online;
        btn.title = actor.online
          ? (btn.title === 'Offline' ? 'Rescan workdirs & skills' : btn.title)
          : 'Offline';
      }
    });
  }
}

function handleActorRemoved(actorId, affectedRooms) {
  const actor = allActors.find(a => a.id === actorId);
  if (actor && actorByName[actor.name]) delete actorByName[actor.name];
  const idx = allActors.findIndex(a => a.id === actorId);
  if (idx >= 0) allActors.splice(idx, 1);
  settingsActors = settingsActors?.filter(a => a.id !== actorId);
  const sRow = document.getElementById('s-row-' + actorId);
  if (sRow) { sRow.style.maxHeight = '0'; sRow.style.padding = '0'; setTimeout(() => sRow.remove(), 220); }
  sRowStates.delete(actorId);
  syncNewRoomBtn();
  if (affectedRooms?.includes(currentRoomId)) {
    const cached = roomParticipantsCache[currentRoomId];
    if (cached) {
      roomParticipantsCache[currentRoomId] = cached.filter(p => p.actor_id !== actorId);
      const room = { id: currentRoomId, title: document.querySelector('.h-room-name')?.textContent || '' };
      renderChatHeader(room, roomParticipantsCache[currentRoomId] || []);
    }
  }
  refreshRoomList();
}

function initSettings() {
  document.getElementById('s-add-agent-btn').addEventListener('click', sOpenAddPanel);
  document.getElementById('s-mobile-back').addEventListener('click', closeSettingsToSidebar);

  // Tab clicks
  document.querySelectorAll('.s-tab[data-tab]').forEach(el => {
    el.addEventListener('click', () => sActivateTab(el.dataset.tab));
  });

  // Docs links inside other tabs — data-doc is the slug (without lang/ext)
  document.addEventListener('click', e => {
    const link = e.target.closest('.s-docs-link[data-doc]');
    if (!link) return;
    e.preventDefault();
    sActivateTab('docs');
    // strip possible extension, treat as slug
    const slug = link.dataset.doc.replace(/\.[a-z]{2}\.md$/, '').replace(/\.md$/, '');
    sOpenDoc(slug);
  });

  // Server tab saves
  document.getElementById('s-human-name-save').addEventListener('click', () => {
    const val = document.getElementById('s-human-name-input').value.trim();
    sSaveSetting('human_name', val || 'Human', 's-human-name-saved');
  });
  document.getElementById('s-public-url-save').addEventListener('click', () => {
    let val = document.getElementById('s-public-url-input').value.trim();
    try { const u = new URL(val); val = u.protocol + '//' + u.hostname; } catch {}
    document.getElementById('s-public-url-input').value = val;
    sSaveSetting('public_url', val, 's-public-url-saved');
  });
  document.getElementById('s-port-save').addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-port-input').value);
    if (!val || val < 1 || val > 65535 || val === sPort) return;
    if (!confirm(`Port akan diubah ke ${val}. Server akan restart dan browser akan redirect otomatis. Lanjutkan?`)) return;
    sSaveSetting('port', val, 's-port-saved');
  });
  document.getElementById('s-max-ai-turns-save').addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-max-ai-turns-input').value);
    if (!val || val < 1 || val > 100) return;
    sSaveSetting('max_ai_turns', val, 's-max-ai-turns-saved');
  });
  document.getElementById('s-max-concurrent-save').addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-max-concurrent-input').value);
    if (!val || val < 1 || val > 10) return;
    sSaveSetting('max_concurrent', val, 's-max-concurrent-saved');
  });
  document.getElementById('s-session-idle-ttl-save').addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-session-idle-ttl-input').value);
    if (!val || val < 1 || val > 60) return;
    sSaveSetting('session_idle_ttl', val, 's-session-idle-ttl-saved');
  });
  document.getElementById('s-cleanup-hour-save').addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-cleanup-hour-input').value);
    if (isNaN(val) || val < 0 || val > 23) return;
    sSaveSetting('cleanup_cron_hour', val, 's-cleanup-hour-saved');
  });
  document.getElementById('s-cleanup-age-save').addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-cleanup-age-input').value);
    if (!val || val < 1 || val > 720) return;
    sSaveSetting('cleanup_max_age_hours', val, 's-cleanup-age-saved');
  });
  ['s-human-name-input', 's-public-url-input', 's-port-input', 's-max-ai-turns-input', 's-max-concurrent-input', 's-session-idle-ttl-input', 's-cleanup-hour-input', 's-cleanup-age-input'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') e.target.closest('.s-server-field').querySelector('.s-server-save').click();
    });
  });
  document.addEventListener('keydown', e => {
    if (!settingsOpen) return;
    if (e.key === 'Escape') {
      if (sAddPanel.open) { sCloseAddPanel(); e.preventDefault(); return; }
      for (const [id, rs] of sRowStates) {
        if (rs.state === 'renaming')       { sCancelRename(id); e.preventDefault(); return; }
        if (rs.state === 'confirm-delete') { sCancelDelete(id); e.preventDefault(); return; }
      }
    }
  });
  document.addEventListener('click', e => {
    if (!settingsOpen) return;
    for (const [id, rs] of sRowStates) {
      if (rs.state === 'confirm-delete') {
        const row = document.getElementById('s-row-' + id);
        if (row && !row.contains(e.target)) sCancelDelete(id);
      }
    }
  });

  // Avatar upload wiring
  const avatarDrop  = document.getElementById('s-avatar-drop');
  const avatarFile  = document.getElementById('s-avatar-file');
  const avatarRemove = document.getElementById('s-avatar-remove');
  if (avatarDrop && avatarFile) {
    avatarDrop.addEventListener('click', () => avatarFile.click());
    avatarDrop.addEventListener('dragover', e => { e.preventDefault(); avatarDrop.classList.add('drag-over'); });
    avatarDrop.addEventListener('dragleave', () => avatarDrop.classList.remove('drag-over'));
    avatarDrop.addEventListener('drop', e => {
      e.preventDefault();
      avatarDrop.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) sResizeAndUploadAvatar(file);
    });
    avatarFile.addEventListener('change', () => {
      const file = avatarFile.files[0];
      if (file) { sResizeAndUploadAvatar(file); avatarFile.value = ''; }
    });
  }
  if (avatarRemove) {
    avatarRemove.addEventListener('click', sRemoveAvatar);
  }

  // General tab: auth
  document.getElementById('s-auth-email-save').addEventListener('click', async () => {
    const email = document.getElementById('s-auth-email-input').value.trim();
    const errEl = document.getElementById('s-auth-error');
    errEl.textContent = '';
    try {
      const r = await fetch('/api/auth/email', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (r.ok) {
        const saved = document.getElementById('s-auth-email-saved');
        saved.classList.add('visible');
        setTimeout(() => saved.classList.remove('visible'), 2000);
      } else {
        errEl.textContent = await r.text();
      }
    } catch { errEl.textContent = 'Network error'; }
  });

  document.getElementById('s-auth-pw-save').addEventListener('click', async () => {
    const cur = document.getElementById('s-auth-cur-pw').value;
    const newPw = document.getElementById('s-auth-new-pw').value;
    const errEl = document.getElementById('s-auth-error');
    errEl.textContent = '';
    if (!cur || !newPw) { errEl.textContent = 'Fill both fields'; return; }
    if (newPw.length < 6) { errEl.textContent = 'New password must be at least 6 characters'; return; }
    try {
      const r = await fetch('/api/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: cur, new_password: newPw }),
      });
      if (r.ok) {
        document.getElementById('s-auth-cur-pw').value = '';
        document.getElementById('s-auth-new-pw').value = '';
        const saved = document.getElementById('s-auth-pw-saved');
        saved.classList.add('visible');
        setTimeout(() => saved.classList.remove('visible'), 2000);
      } else {
        errEl.textContent = await r.text();
      }
    } catch { errEl.textContent = 'Network error'; }
  });

  // Notification toggle
  document.getElementById('s-notif-toggle').addEventListener('click', () => {
    const toggle = document.getElementById('s-notif-toggle');
    notifEnabled = !notifEnabled;
    localStorage.setItem('stoa-notif', notifEnabled ? 'on' : 'off');
    toggle.classList.toggle('on', notifEnabled);
    if (notifEnabled) requestNotifPermission();
    const hint = document.getElementById('s-notif-hint');
    hint.textContent = notifEnabled ? 'You will be notified when agents respond in other rooms.' : 'Notifications are off.';
  });

  // Logout
  document.getElementById('s-logout-btn').addEventListener('click', doLogout);
}

init();

// ── PWA Install Banner (mobile only) ─────────────────────────────────────
(function() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  let deferredPrompt = null;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!isMobile || isStandalone) return;
  if (localStorage.getItem('stoa-install-dismissed')) return;

  const banner = document.createElement('div');
  banner.className = 'h-install-banner';
  banner.innerHTML = `
    <div class="h-install-banner-row">
      <img class="h-install-banner-icon" src="/stoa-icon.svg" alt="Stoa">
      <div class="h-install-banner-text">
        <div class="h-install-banner-title">Install Stoa</div>
        <div class="h-install-banner-sub">Add to home screen for quick access</div>
      </div>
    </div>
    <div class="h-install-banner-actions">
      <button class="h-install-btn-dismiss">Not now</button>
      <button class="h-install-btn-add">Install</button>
    </div>`;
  document.body.appendChild(banner);

  banner.querySelector('.h-install-btn-dismiss').addEventListener('click', () => {
    banner.classList.remove('visible');
    localStorage.setItem('stoa-install-dismissed', '1');
  });

  banner.querySelector('.h-install-btn-add').addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') localStorage.setItem('stoa-install-dismissed', '1');
      deferredPrompt = null;
    }
    banner.classList.remove('visible');
  });

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    banner.classList.add('visible');
  });

  // On HTTP (non-localhost), beforeinstallprompt won't fire — show manual instructions
  setTimeout(() => {
    if (!deferredPrompt && !banner.classList.contains('visible')) {
      const isAndroid = /Android/i.test(navigator.userAgent);
      banner.querySelector('.h-install-btn-add').textContent = 'OK';
      banner.querySelector('.h-install-banner-sub').textContent = isAndroid
        ? 'Tap menu (⋮) → Add to Home Screen'
        : 'Tap Share → Add to Home Screen';
      banner.classList.add('visible');
    }
  }, 3000);
})();

// ── Speech-to-text (Web Speech API) ────────────────────────────────────────
(function() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voiceBtn = document.getElementById('voice-btn');
  const langBtn = document.getElementById('voice-lang-btn');
  if (!SpeechRecognition || !voiceBtn) {
    if (voiceBtn) voiceBtn.title = 'Speech not supported in this browser';
    if (langBtn) langBtn.style.display = 'none';
    return;
  }

  const langs = [
    { code: 'en-US', label: 'EN', send: /send\s*(it\s*)?now/i, stop: /stop\s*listening/i, clear: /clear\s*all/i },
    { code: 'id-ID', label: 'ID', send: /kirim(kan)?\s*(sekarang|sekarang juga|dulu)/i, stop: /matikan\s*mic/i, clear: /hapus\s*semua/i },
    { code: 'ja-JP', label: 'JA', send: /送信(して)?/i, stop: /マイク(を)?止め/i, clear: /全部消(して|す)/i },
    { code: 'ko-KR', label: 'KO', send: /지금\s*보내/i, stop: /마이크\s*끄/i, clear: /전부\s*지우/i },
    { code: 'zh-CN', label: 'ZH', send: /现在发送/i, stop: /关闭麦克风/i, clear: /全部清除/i },
  ];
  let langIdx = parseInt(localStorage.getItem('stoa-voice-lang') || '0', 10);
  if (langIdx >= langs.length) langIdx = 0;
  langBtn.textContent = langs[langIdx].label;

  langBtn.addEventListener('click', () => {
    langIdx = (langIdx + 1) % langs.length;
    localStorage.setItem('stoa-voice-lang', langIdx);
    langBtn.textContent = langs[langIdx].label;
    if (isRecording) { stopRecognition(); startRecognition(); }
  });

  let recognition = null;
  let isRecording = false;

  const isAndroid = /Android/i.test(navigator.userAgent);

  function startRecognition() {
    const lang = langs[langIdx];
    recognition = new SpeechRecognition();
    recognition.lang = lang.code;
    recognition.continuous = true;
    recognition.interimResults = true;

    const input = document.getElementById('msg-input');
    const existingText = input.textContent.replace(/​/g, '').trim();
    let baseText = existingText ? existingText + ' ' : '';
    let finalResults = [];
    let skipUntilRestart = false;

    recognition.onresult = (event) => {
      if (skipUntilRestart) return;
      if (processingMessages.size > 0) return;
      let full;
      if (isAndroid) {
        const last = event.results[event.results.length - 1];
        full = (baseText + last[0].transcript).trim();
      } else {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalResults[i] = t;
          } else {
            interim += t;
          }
        }
        const finalTranscript = baseText + finalResults.filter(Boolean).join('');
        full = (finalTranscript + interim).trim();
      }
      if (lang.stop.test(full)) {
        input.textContent = '';
        stopRecognition();
        return;
      }
      if (lang.clear.test(full)) {
        baseText = '';
        finalResults = [];
        input.textContent = '';
        skipUntilRestart = true;
        try { recognition.stop(); } catch {}
        return;
      }
      if (lang.send.test(full)) {
        const cleaned = full.replace(lang.send, '').trim();
        input.textContent = cleaned;
        if (cleaned) sendMessage();
        baseText = '';
        finalResults = [];
        input.textContent = '';
        skipUntilRestart = true;
        try { recognition.stop(); } catch {}
        return;
      }
      input.textContent = full;
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.warn('Speech recognition error:', event.error);
      stopRecognition();
    };

    recognition.onend = () => {
      if (isRecording) {
        if (isAndroid) {
          stopRecognition();
        } else {
          skipUntilRestart = false;
          const currentText = input.textContent.replace(/​/g, '').trim();
          baseText = currentText ? currentText + ' ' : '';
          finalResults = [];
          try { recognition.start(); } catch {}
        }
      }
    };

    recognition.start();
    isRecording = true;
    voiceBtn.classList.add('recording');
    voiceBtn.title = 'Stop recording';
  }

  function stopRecognition() {
    isRecording = false;
    voiceBtn.classList.remove('recording');
    voiceBtn.title = 'Speech to text';
    if (recognition) {
      try { recognition.stop(); } catch {}
      recognition = null;
    }
  }

  voiceBtn.addEventListener('click', () => {
    if (isRecording) {
      stopRecognition();
    } else {
      startRecognition();
    }
  });

  window.stopVoiceRecognition = stopRecognition;

  // Auto-stop mic when tab becomes hidden
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isRecording) stopRecognition();
  });
})();
