// ── App-level navigation sidebar ─────────────────────────────────────────────
const APP_NAV_SETTINGS_TABS = ['agents', 'server', 'general', 'docs', 'platforms', 'automation', 'usage', 'doctor'];

function setAppNavActive(key) {
  document.querySelectorAll('.app-nav-item[data-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === key);
  });
}

function initAppNav() {
  document.querySelectorAll('.app-nav-item[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const nav = el.dataset.nav;
      if (nav === 'inbox') {
        closeSettingsToNav();
      } else if (APP_NAV_SETTINGS_TABS.includes(nav)) {
        openSettingsTab(nav);
      }
    });
  });
}

function closeSettingsToNav() {
  settingsOpen = false;
  sStopPolling();
  document.body.classList.remove('settings-mode');
  document.getElementById('settings-inner').classList.remove('visible');
  setAppNavActive('inbox');
  if (!currentRoomId) {
    document.getElementById('empty-state').style.display = '';
    document.body.classList.remove('in-chat');
  }
}

function openSettingsTab(tab) {
  settingsOpen = true;
  currentRoomId = null;
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  setConnected(false);
  document.querySelectorAll('.h-room-row').forEach(el => el.classList.remove('active'));
  document.body.classList.add('settings-mode', 'in-chat');
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('chat-inner').classList.remove('visible');
  document.getElementById('settings-inner').classList.add('visible');
  setAppNavActive(tab);
  sActivateTab(tab);
  sLoad();
}

function updateAppNavAvatar() {
  const el = document.getElementById('app-nav-avatar');
  if (!el || !humanActor) return;
  el.innerHTML = '';
  el.appendChild(makeAvatar(humanActor.name, humanActor.avatar_color, humanActor.avatar_url, 28));
}
