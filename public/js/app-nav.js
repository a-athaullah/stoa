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
      el.blur();
    });
  });
  const restartBtn = document.getElementById('nav-restart-btn');
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      restartBtn.blur();
      showAppNotice('confirm');
    });
  }
}

function showAppNotice(stage) {
  const el = document.getElementById('app-top-notice');
  if (!el) return;
  el.className = 'notice-' + stage;
  el.style.display = 'flex';
  el.innerHTML = '';
  const msg = document.createElement('span');
  msg.style.flex = '1';
  if (stage === 'confirm') {
    msg.textContent = 'restart the server? every agent connection will drop and reconnect.';
    el.appendChild(msg);
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px';
    const ok = document.createElement('button');
    ok.className = 'app-notice-btn-confirm';
    ok.textContent = 'restart';
    ok.onclick = () => {
      showAppNotice('running');
      if (typeof sRestartServer === 'function') sRestartServer();
    };
    const cancel = document.createElement('button');
    cancel.className = 'app-notice-btn-cancel';
    cancel.textContent = 'cancel';
    cancel.onclick = hideAppNotice;
    btns.appendChild(ok);
    btns.appendChild(cancel);
    el.appendChild(btns);
  } else if (stage === 'running') {
    msg.textContent = 'restarting server…';
    el.appendChild(msg);
  } else if (stage === 'done') {
    msg.textContent = 'server restarted.';
    el.appendChild(msg);
    setTimeout(hideAppNotice, 2000);
  }
}

function hideAppNotice() {
  const el = document.getElementById('app-top-notice');
  if (!el) return;
  el.style.display = 'none';
  el.className = '';
  el.innerHTML = '';
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
  const nameEl = document.getElementById('app-nav-user-name');
  if (!el || !humanActor) return;
  el.innerHTML = '';
  el.appendChild(makeAvatar(humanActor.name, humanActor.avatar_color, humanActor.avatar_url, 28));
  if (nameEl) nameEl.textContent = humanActor.name.toLowerCase();
}
