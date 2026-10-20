// ── Settings ────────────────────────────────────────────────────────────────
let settingsOpen = false;
let settingsActors = [];
const sRowStates = new Map(); // id -> {state:'default'|'renaming'|'confirm-delete', draft:string}
let sAddPanel = { open: false, name: '', os: 'unix', phase: 'idle', baselineIds: new Set(), newActor: null, timer: null };
const agentSubCountCache = new Map(); // actorId -> count
let _settingsRoomsMap = null; // id -> name, populated on first harness change
async function _getRoomName(id) {
  if (!_settingsRoomsMap) {
    try {
      const rs = await fjson('/api/rooms');
      _settingsRoomsMap = new Map(rs.map(r => [r.id, r.name || `#${r.id}`]));
    } catch { _settingsRoomsMap = new Map(); }
  }
  return _settingsRoomsMap.get(id) || `#${id}`;
}

function _buildHarnessOptions(sel, actor) {
  const cur = actor.adapter || 'claude';
  const available = actor.harnesses_available || [];
  const statusMap = new Map((actor.harness_status || []).map(s => [s.id, s]));
  const toShow = available.length ? available : [cur];
  const multi = toShow.length > 1;
  sel.innerHTML = '';
  toShow.forEach(h => {
    const st = statusMap.get(h);
    const notLoggedIn = st?.installed && st.logged_in === false;
    const ver = st?.version ? ` ${st.version}` : '';
    const o = document.createElement('option');
    o.value = h;
    o.textContent = `${HARNESS_LABELS[h] || h}${ver}${notLoggedIn ? ' (not logged in)' : ''}`;
    o.disabled = notLoggedIn;
    if (h === cur) o.selected = true;
    sel.appendChild(o);
  });
  sel.disabled = !multi;
  sel.style.opacity = multi ? '' : '0.6';
  sel.style.cursor = multi ? 'pointer' : 'not-allowed';
}

function _harnessHint(actor) {
  if (!actor.online) return null;
  const cur = actor.adapter || 'claude';
  const available = actor.harnesses_available || [];
  const st = (actor.harness_status || []).find(s => s.id === cur);
  if (available.length && !available.includes(cur)) return `${HARNESS_LABELS[cur] || cur} not available on this agent`;
  if (st?.installed && st.logged_in === false) return `${HARNESS_LABELS[cur] || cur} is not logged in`;
  return null;
}

function _applyHarnessCheckResult(actor, data, sel, hintEl) {
  const prevAvailable = (actor.harnesses_available || []).slice();
  const prevStatus = actor.harness_status || [];
  actor.harnesses_available = data.harnesses_available || prevAvailable;
  actor.harness_status = data.harness_status || prevStatus;
  const patch = { harnesses_available: actor.harnesses_available, harness_status: actor.harness_status };
  const sIdx = settingsActors.findIndex(a => a.id === actor.id);
  if (sIdx >= 0) settingsActors[sIdx] = { ...settingsActors[sIdx], ...patch };
  const aIdx = allActors.findIndex(a => a.id === actor.id);
  if (aIdx >= 0) Object.assign(allActors[aIdx], patch);
  _buildHarnessOptions(sel, actor);
  const hint = _harnessHint(actor);
  if (hintEl) { hintEl.textContent = hint || ''; hintEl.style.display = hint ? '' : 'none'; }
  const newOnes = actor.harnesses_available.filter(h => !prevAvailable.includes(h));
  const curHarness = actor.adapter || 'claude';
  const curSt = actor.harness_status.find(s => s.id === curHarness);
  const prevSt = prevStatus.find(s => s.id === curHarness);
  const newModels = (curSt?.models || []).filter(m => !(prevSt?.models || []).some(p => p.id === m.id));
  const parts = (data.harness_status || []).filter(s => s.installed).map(s => {
    const lbl = HARNESS_LABELS[s.id] || s.id;
    return s.version ? `${lbl} ${s.version}` : lbl;
  });
  if (newOnes.length) {
    showToast(`New harness detected: ${newOnes.map(h => escHtml(HARNESS_LABELS[h] || h)).join(', ')}`);
  } else if (newModels.length && curHarness !== 'claude') {
    showToast(`${escHtml(HARNESS_LABELS[curHarness] || curHarness)}: ${newModels.length} new model${newModels.length > 1 ? 's' : ''}`);
  } else {
    showToast(parts.length ? `Harnesses: ${parts.map(p => escHtml(p)).join(', ')}` : 'No harnesses detected');
  }
  renderAgentSidebar();
  if (typeof refreshModelDropdownForActor === 'function') refreshModelDropdownForActor(actor.id);
}

function _makeCheckHarnessBtn(actor, sel, hintEl) {
  const btn = document.createElement('button');
  btn.className = 's-icon-btn';
  btn.title = actor.online ? 'Check installed harnesses' : 'Offline';
  btn.disabled = !actor.online;
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 7px;font-family:var(--h-sans);font-size:11.5px;height:auto';
  btn.innerHTML = svgRefresh(13) + '<span>Check</span>';
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.style.opacity = '0.4';
    try {
      const r = await fetch(`/api/actors/${actor.id}/harnesses/check`, { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(data.error || 'Failed to check harnesses', { error: true }); return; }
      _applyHarnessCheckResult(actor, data, sel, hintEl);
    } catch { showToast('Failed to check harnesses', { error: true }); }
    finally { btn.disabled = !actor.online; btn.style.opacity = ''; }
  });
  return btn;
}

// actorId -> { state: 'requested'|'restarting' } — fed by agent_restart_status
const sRestartState = new Map();
const S_RESTART_ACTIVE = new Set(['requested', 'restarting']);

function _restartBlockReason(actor) {
  if (!actor.online) return 'Offline';
  if (actor.supervisor !== 'pm2') return 'Not running under PM2 — a restart would stop this agent for good';
  return null;
}

function _syncRestartBtn(btn, actor) {
  const entry = sRestartState.get(actor.id);
  const reason = _restartBlockReason(actor);
  btn.disabled = !!entry || !!reason;
  btn.classList.toggle('is-active', !!entry);
  btn.title = entry ? 'Restarting…' : (reason || 'Restart agent');
  btn.setAttribute('aria-label', entry ? 'Restart agent: restarting…' : 'Restart agent');
}

function _setRestartEntry(actorId, state) {
  const a = allActors.find(x => x.id === actorId);
  if (S_RESTART_ACTIVE.has(state)) {
    sRestartState.set(actorId, { state });
    if (a) a.restart_state = state;
  } else {
    sRestartState.delete(actorId);
    if (a) a.restart_state = null;
  }
}

function _makeRestartBtn(actor, sz) {
  if (!sRestartState.has(actor.id) && S_RESTART_ACTIVE.has(actor.restart_state)) _setRestartEntry(actor.id, actor.restart_state);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 's-icon-btn s-restart-btn';
  btn.dataset.restartActor = actor.id;
  btn.innerHTML = svgPower(sz);
  _syncRestartBtn(btn, actor);

  btn.addEventListener('click', e => {
    e.stopPropagation();
    _showRestartConfirm(actor);
  });
  return btn;
}

function _showRestartConfirm(actor) {
  const el = document.getElementById('app-top-notice');
  if (!el) return;
  const name = actor.name || 'this agent';
  el.className = 'notice-confirm-delete';
  el.style.display = 'flex';
  el.innerHTML = '';
  const msg = document.createElement('span');
  msg.style.flex = '1';
  msg.textContent = `Restart ${name} now? All of ${name}'s running processes will stop immediately.`;
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px';
  const ok = document.createElement('button');
  ok.className = 'app-notice-btn-danger';
  ok.textContent = 'restart';
  ok.onclick = () => { hideAppNotice(); _requestRestart(actor.id); };
  const cancel = document.createElement('button');
  cancel.className = 'app-notice-btn-cancel';
  cancel.textContent = 'cancel';
  cancel.onclick = hideAppNotice;
  btns.append(ok, cancel);
  el.append(msg, btns);
  ok.focus();
}

async function _requestRestart(actorId) {
  const actor = allActors.find(a => a.id === actorId);
  // State may have moved while the notice was open (WS update, agent went offline).
  if (!actor || sRestartState.has(actorId) || _restartBlockReason(actor)) { _renderRestartUi(actorId, actor); return; }
  document.querySelectorAll(`.s-restart-btn[data-restart-actor="${actorId}"]`).forEach(b => { b.disabled = true; });
  try {
    const r = await fetch(`/api/actors/${actorId}/restart`, { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401) showLogin();
      showToast(data.message || data.error || 'Failed to request restart', { error: true });
      return;
    }
    // A WS update may land before this response; never overwrite a newer state with 'requested'.
    if (!sRestartState.has(actorId)) _setRestartEntry(actorId, S_RESTART_ACTIVE.has(data.state) ? data.state : 'requested');
  } catch { showToast('Failed to request restart', { error: true }); }
  finally { _renderRestartUi(actorId); }
}

function _renderRestartUi(actorId, actor = allActors.find(a => a.id === actorId)) {
  if (!actor) return;
  document.querySelectorAll(`.s-restart-btn[data-restart-actor="${actorId}"]`).forEach(btn => _syncRestartBtn(btn, actor));
}

function sHandleRestartStatus(msg) {
  const id = Number(msg.actor_id);
  if (!id || (msg.state !== 'done' && !S_RESTART_ACTIVE.has(msg.state))) return;
  _setRestartEntry(id, msg.state);
  if (msg.state === 'done') {
    const a = allActors.find(x => x.id === id);
    showToast(`${a?.name || 'Agent'} is back online`);
  }
  _renderRestartUi(id);
}

// `update` is the raw actor_status payload. Only the agent-connect broadcast carries
// restart_state, read live from the server; the merged allActors copy is never trusted for it.
// That lets a page that missed the 'done' event settle once the agent is back.
function sSyncRestartUi(actor, update = actor) {
  if (!actor) return;
  const had = sRestartState.get(actor.id);
  if (!actor.online && had) had.wentOffline = true;
  else if (actor.online && 'restart_state' in update) {
    if (S_RESTART_ACTIVE.has(update.restart_state)) _setRestartEntry(actor.id, update.restart_state);
    else if (had) {
      _setRestartEntry(actor.id, null);
      if (had.wentOffline || had.state === 'restarting') showToast(`${actor.name || 'Agent'} is back online`);
    }
  }
  _renderRestartUi(actor.id, actor);
}

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
function svgPower(sz=14) { return `<svg width="${sz}" height="${sz}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 2v6"/><path d="M4.6 4.4a5 5 0 1 0 6.8 0"/></svg>`; }
function svgCopy(sz=14) { return `<svg width="${sz}" height="${sz}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2H4A1.5 1.5 0 0 0 2.5 3.5V9A1.5 1.5 0 0 0 4 10.5h1"/></svg>`; }

function openSettings(tab) {
  if (typeof openSettingsTab === 'function') {
    openSettingsTab(tab || 'agents');
  } else {
    settingsOpen = true;
    currentRoomId = null;
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    setConnected(false);
    document.querySelectorAll('.h-room-row').forEach(el => el.classList.remove('active'));
    document.body.classList.add('settings-mode', 'in-chat');
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('chat-inner').classList.remove('visible');
    document.getElementById('settings-inner').classList.add('visible');
    sLoad();
  }
}

function closeSettingsToSidebar() {
  if (document.body.classList.contains('agents-mode') && window.innerWidth <= 680) {
    document.body.classList.remove('in-chat');
    return;
  }
  if (typeof closeSettingsToNav === 'function') {
    closeSettingsToNav();
  } else {
    document.body.classList.remove('in-chat', 'settings-mode');
  }
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
  const agents = [...settingsActors.filter(a => a.type !== 'human')].sort((a, b) => b.id - a.id);
  for (const a of agents) {
    if (!sRowStates.has(a.id)) sRowStates.set(a.id, { state: 'default', draft: a.name });
  }
  if (document.getElementById('agent-list')) renderAgentSidebar();
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
  avInput.type = 'file'; avInput.accept = 'image/*'; avInput.style.display = 'none'; avInput.name = 'actor-avatar-upload';
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
    inp.name = 'agent-rename';
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
    nameRow.addEventListener('click', () => isHuman ? sStartRename(actor.id) : sStartEdit(actor.id));
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
    }).catch(e => { console.error('Failed to load workdirs for actor', actor.id, e); });
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
    langSel.name = 'agent-lang';
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
    ren.className = 's-icon-btn'; ren.title = isHuman ? 'Rename' : 'Edit settings';
    ren.innerHTML = svgPencil();
    ren.addEventListener('click', e => { e.stopPropagation(); isHuman ? sStartRename(actor.id) : sStartEdit(actor.id); });

    if (!isHuman) {
      const refresh = document.createElement('button');
      refresh.className = 's-icon-btn'; refresh.title = actor.online ? 'Rescan workdirs, skills & harnesses' : 'Offline';
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
            }).catch(e => { console.error('[agents] failed to refresh workdir count for actor', actor.id, e); });
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
      acts.appendChild(_makeRestartBtn(actor, 14));
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
  lbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-red);white-space:nowrap';
  lbl.textContent = `remove ${actor.name}?`;
  const cancelBtn = document.createElement('button');
  cancelBtn.style.cssText = 'background:transparent;border:none;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12.5px;padding:4px 10px;border-radius:999px;cursor:pointer';
  cancelBtn.textContent = 'cancel';
  cancelBtn.addEventListener('click', () => sCancelDelete(actor.id));
  const removeBtn = document.createElement('button');
  removeBtn.style.cssText = 'background:var(--h-red-fill);border:none;color:var(--h-fill-ink);font-family:var(--h-sans);font-size:12.5px;padding:5px 12px;border-radius:999px;cursor:pointer;letter-spacing:.01em';
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

let sActiveEditId = null;

function sCloseEditAccordion() {
  if (sActiveEditId === null) return;
  const id = sActiveEditId;
  sActiveEditId = null;
  const acc = document.getElementById('s-edit-acc-' + id);
  if (!acc) return;
  acc.classList.remove('open');
  setTimeout(() => acc.remove(), 220);
}

function sStartEdit(actorId) {
  if (sActiveEditId === actorId) { sCloseEditAccordion(); return; }
  sCloseEditAccordion();
  const actor = settingsActors.find(a => a.id === actorId);
  if (!actor) return;
  sActiveEditId = actorId;
  const acc = sMakeEditAccordion(actor);
  const row = document.getElementById('s-row-' + actorId);
  if (row) row.insertAdjacentElement('afterend', acc);
  requestAnimationFrame(() => acc.classList.add('open'));
}

const S_INSTALL_SCRIPTS = { unix: 'install.sh', ps: 'install.ps1', cmd: 'install.cmd' };

function sInstallCmd(token, os) {
  const base = sPublicUrl || `http://localhost:${sPort}`;
  const url = `${base}/${S_INSTALL_SCRIPTS[os]}?token=${encodeURIComponent(token)}`;
  return { unix: `curl -fsSL "${url}" | bash`, ps: `irm "${url}" | iex`, cmd: `curl -fsSL "${url}" -o i.cmd && i.cmd && del i.cmd` }[os];
}

async function sMintInstallToken(name, lang) {
  const r = await fetch('/api/agent/install-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || undefined, lang: lang || 'en' }),
  });
  if (r.status === 401) { showLogin(); throw new Error('Session expired. Sign in again.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || typeof data.token !== 'string') throw new Error(data.error || `Failed to generate install command (${r.status})`);
  return data;
}

// Install command slip backed by a single-use, 10-minute token. The token carries name + lang,
// so changing either invalidates the shown command; switching OS reuses the same token.
function sMakeInstallSlip(captionText, getParams, os) {
  const st = { token: null, expiresAt: 0, os, seq: 0, timer: null, stale: '' };
  const wrap = document.createElement('div');
  const caption = document.createElement('div');
  caption.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-faint);margin-bottom:8px;letter-spacing:.02em';
  caption.textContent = captionText;
  const slip = document.createElement('div'); slip.className = 's-cmd-slip';
  const dollar = document.createElement('span'); dollar.className = 's-cmd-dollar'; dollar.textContent = '$';
  const cmdText = document.createElement('span');
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button'; copyBtn.className = 's-cmd-copy'; copyBtn.title = 'Copy'; copyBtn.setAttribute('aria-label', 'Copy install command');
  copyBtn.innerHTML = svgCopy();
  copyBtn.addEventListener('click', async () => {
    if (!st.token) return;
    if (await copyToClipboard(cmdText.textContent)) {
      copyBtn.classList.add('copied'); copyBtn.innerHTML = svgCheck(14);
      setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.innerHTML = svgCopy(); }, 1000);
    }
  });
  slip.append(dollar, cmdText, copyBtn);

  const foot = document.createElement('div'); foot.className = 's-install-foot';
  const note = document.createElement('span'); note.className = 's-field-hint';
  const genBtn = document.createElement('button'); genBtn.type = 'button'; genBtn.className = 's-install-gen';
  const err = document.createElement('span'); err.className = 's-install-err'; err.setAttribute('role', 'alert');
  foot.append(note, genBtn);
  wrap.append(caption, slip, foot, err);

  function render() {
    const live = st.token && Date.now() < st.expiresAt;
    if (st.token && !live) { st.token = null; st.stale = 'command expired — generate a new one'; }
    slip.classList.toggle('s-cmd-slip-empty', !live);
    copyBtn.style.display = live ? '' : 'none';
    cmdText.textContent = live ? sInstallCmd(st.token, st.os) : 'generate a command to install the agent';
    note.textContent = live ? 'valid for 10 minutes · single use' : st.stale;
    genBtn.textContent = live ? 'regenerate' : 'generate command';
  }

  async function generate() {
    const seq = ++st.seq;
    genBtn.disabled = true; err.textContent = '';
    try {
      const { name, lang } = getParams();
      const data = await sMintInstallToken(name, lang);
      if (seq !== st.seq) return;
      const ttl = Number(data.expires_in) > 0 ? Number(data.expires_in) : 600;
      st.token = data.token; st.expiresAt = Date.now() + ttl * 1000; st.stale = '';
      clearTimeout(st.timer);
      st.timer = setTimeout(render, ttl * 1000);
      render();
    } catch (e) {
      if (seq === st.seq) err.textContent = e.message || 'Failed to generate install command';
    } finally {
      if (seq === st.seq) genBtn.disabled = false;
    }
  }
  genBtn.addEventListener('click', generate);
  render();

  return {
    el: wrap,
    setOs(next) { st.os = next; render(); },
    invalidate() {
      if (!st.token) return;
      st.seq++; st.token = null; clearTimeout(st.timer);
      genBtn.disabled = false;
      st.stale = 'name or language changed — generate a new command';
      render();
    },
  };
}

// ── Sub-agent design primitives (port of subagents.jsx) ──────────────────────
// Ported from the claude.ai/design spec: SET tokens → --h-* CSS vars, JSX → DOM.
const SA_TIERS_META = [
  { id: 'quick',    bars: 1, note: 'short lookups — cheapest model' },
  { id: 'standard', bars: 2, note: 'most work — balanced' },
  { id: 'deep',     bars: 3, note: 'long reasoning — costliest' },
];
function _saMakeDescInput(existing) {
  const inp = document.createElement('textarea');
  inp.name = 'subagent-description';
  inp.maxLength = 500;
  inp.rows = 2;
  inp.placeholder = 'Purpose of this sub-agent — e.g. backend implementation for Stoa';
  inp.value = existing?.description || '';
  inp.style.cssText = 'padding:9px 12px;border-radius:8px;box-sizing:border-box;resize:vertical;background:var(--h-surface);border:1px solid var(--h-hair-soft);font-family:var(--h-sans);font-size:13px;line-height:1.5;color:var(--h-ink);outline:none;width:100%';
  return inp;
}

function _saMakeRoleInput(existing) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.name = 'subagent-role';
  inp.maxLength = 40;
  inp.placeholder = 'e.g. Tech Lead';
  inp.value = existing?.role || '';
  inp.style.cssText = 'padding:9px 12px;border-radius:8px;box-sizing:border-box;background:var(--h-surface);border:1px solid var(--h-hair-soft);font-family:var(--h-sans);font-size:13px;color:var(--h-ink);outline:none;width:100%';
  return inp;
}

function _saMakeRoleChip(sa) {
  if (!sa.role) return null;
  const r = document.createElement('span');
  r.style.cssText = 'font-family:var(--h-sans);font-size:12px;color:var(--h-ink-mute);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  r.textContent = sa.role;
  r.title = sa.role;
  return r;
}

function _saMakeDescLine(sa) {
  if (!sa.description) return null;
  const d = document.createElement('span');
  d.style.cssText = 'font-family:var(--h-sans);font-size:12px;color:var(--h-ink-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  d.textContent = sa.description;
  d.title = sa.description;
  return d;
}

function _saAnthropicModels() {
  return getAvailableModels().filter(m => m.platform === 'anthropic');
}
const SA_DANGER = 'var(--h-red)';
const HARNESS_LABELS = { claude: 'Claude CLI', codex: 'Codex CLI' };

function _saPopulateModelSel(modelSel, harness, actor, currentVal) {
  modelSel.innerHTML = '';
  const useTierOpt = document.createElement('option');
  useTierOpt.value = ''; useTierOpt.textContent = 'use tier';
  modelSel.appendChild(useTierOpt);
  if (!harness || harness === 'claude') {
    const anthropicModels = _saAnthropicModels();
    for (const m of anthropicModels) {
      const o = document.createElement('option'); o.value = m.value; o.textContent = (m.label || m.value) + (m.custom ? ' · custom' : ''); modelSel.appendChild(o);
    }
    if (currentVal && !anthropicModels.some(m => m.value === currentVal)) {
      const o = document.createElement('option'); o.value = currentVal; o.textContent = currentVal; modelSel.appendChild(o);
    }
  } else {
    const models = (_agentHarnessModels(actor?.harness_status, harness) || getModelsForHarness(harness) || []);
    for (const m of models) {
      const o = document.createElement('option'); o.value = m.value;
      o.textContent = m.label || m.value; modelSel.appendChild(o);
    }
  }
  const valid = Array.from(modelSel.options).map(o => o.value);
  modelSel.value = valid.includes(currentVal) ? currentVal : '';
}

// Sub-agent seal shade: --sa-sub-* tokens live per scheme in css/base.css.
function saSubShade(color) {
  return `oklch(from ${color} calc(l + var(--sa-sub-dl)) calc(c * var(--sa-sub-cf)) h)`;
}

// Build avatar editor for an existing sub-agent (color, symbol, image upload/remove).
function _saBuildAvatarEditor(sa, saShade, onUpdate) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';

  const previewColor = sa.avatar_color || saShade;
  const previewSymbol = sa.avatar_symbol || sa.label[0];

  const previewDisc = document.createElement('span');
  const updatePreview = () => {
    const c = colorInp.value || saShade;
    const s = symInp.value.trim() || sa.label[0];
    previewDisc.innerHTML = '';
    if (sa.avatar_url) {
      previewDisc.style.cssText = 'width:28px;height:28px;border-radius:50%;overflow:hidden;display:inline-flex;flex:0 0 auto';
      const img = document.createElement('img');
      img.src = sa.avatar_url;
      img.style.cssText = 'width:28px;height:28px;border-radius:50%;object-fit:cover';
      previewDisc.appendChild(img);
    } else {
      previewDisc.style.cssText = `width:28px;height:28px;border-radius:50%;background:${c};display:inline-flex;align-items:center;justify-content:center;font-family:var(--h-serif);font-size:14px;color:#fff;flex:0 0 auto`;
      previewDisc.textContent = s;
    }
  };

  const colorInp = document.createElement('input');
  colorInp.type = 'color'; colorInp.value = sa.avatar_color || '#888888';
  colorInp.style.cssText = 'width:32px;height:32px;border-radius:6px;border:1px solid var(--h-border);cursor:pointer;padding:2px;flex:0 0 auto';
  colorInp.title = 'avatar color';
  colorInp.oninput = updatePreview;

  const symInp = document.createElement('input');
  symInp.value = sa.avatar_symbol || ''; symInp.placeholder = 'symbol'; symInp.maxLength = 4;
  symInp.style.cssText = 'padding:6px 8px;width:72px;border-radius:6px;border:1px solid var(--h-border);background:var(--h-surface);color:var(--h-ink);font-family:var(--h-sans);font-size:13px;outline:none';
  symInp.oninput = updatePreview;

  const applyBtn = document.createElement('button');
  applyBtn.textContent = 'apply'; applyBtn.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:4px 12px;cursor:pointer';
  applyBtn.onclick = async () => {
    const color = colorInp.value || null;
    const symbol = symInp.value.trim().slice(0, 4) || null;
    applyBtn.disabled = true;
    try {
      const r = await fetch(`/api/sub-agents/${sa.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar_color: color, avatar_symbol: symbol }) });
      if (r.ok) { sa.avatar_color = color; sa.avatar_symbol = symbol; showToast('avatar saved'); onUpdate(sa); }
      else { const e = await r.json().catch(() => ({})); showToast(e.error || 'failed to save', { error: true }); }
    } catch { showToast('failed to save', { error: true }); }
    applyBtn.disabled = false;
  };

  const imgInp = document.createElement('input');
  imgInp.type = 'file'; imgInp.accept = 'image/*'; imgInp.style.display = 'none';
  imgInp.onchange = () => {
    const file = imgInp.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('Image must be under 2 MB.'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = async () => {
        const maxSize = 256; let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) { if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; } else { w = Math.round(w * maxSize / h); h = maxSize; } }
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL(file.type === 'image/gif' ? 'image/png' : file.type);
        try {
          const res = await fetch(`/api/sub-agents/${sa.id}/avatar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_url: dataUrl }) });
          if (!res.ok) throw new Error();
          const data = await res.json(); if (data.avatar_url) { sa.avatar_url = data.avatar_url; updatePreview(); onUpdate(sa); removeBtn.style.display = ''; showToast('image uploaded'); }
        } catch { showToast('upload failed', { error: true }); }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const uploadBtn = document.createElement('button');
  uploadBtn.textContent = 'upload image'; uploadBtn.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:4px 12px;cursor:pointer';
  uploadBtn.onclick = () => imgInp.click();

  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'remove image'; removeBtn.style.cssText = 'display:' + (sa.avatar_url ? 'inline-block' : 'none') + ';background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-red);font-family:var(--h-sans);font-size:12px;padding:4px 12px;cursor:pointer';
  removeBtn.onclick = async () => {
    removeBtn.disabled = true;
    try {
      const r = await fetch(`/api/sub-agents/${sa.id}/avatar`, { method: 'DELETE' });
      if (r.ok) { sa.avatar_url = null; updatePreview(); onUpdate(sa); removeBtn.style.display = 'none'; showToast('image removed'); }
      else showToast('failed to remove', { error: true });
    } catch { showToast('failed to remove', { error: true }); }
    removeBtn.disabled = false;
  };

  updatePreview();
  wrap.append(previewDisc, colorInp, symInp, applyBtn, uploadBtn, removeBtn, imgInp);
  return wrap;
}

// Build memory editor for an existing sub-agent.
function _saBuildMemoryEditor(sa) {
  const SA_MEM_BUDGET = 2200;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';

  const loading = document.createElement('span');
  loading.style.cssText = 'font-size:12.5px;color:var(--h-ink-faint)'; loading.textContent = 'loading…';
  wrap.appendChild(loading);

  (async () => {
    try {
      const r = await fetch(`/api/sub-agents/${sa.id}/memory`);
      wrap.removeChild(loading);
      if (!r.ok) { const err = document.createElement('span'); err.style.cssText = 'font-size:12.5px;color:var(--h-ink-faint)'; err.textContent = 'failed to load'; wrap.appendChild(err); return; }
      const data = await r.json();
      const ta = document.createElement('textarea');
      ta.value = data.content || ''; ta.placeholder = 'Notes this sub-agent can update after tasks…'; ta.maxLength = SA_MEM_BUDGET;
      ta.style.cssText = 'width:100%;box-sizing:border-box;min-height:80px;resize:vertical;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;padding:8px 10px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);outline:none';
      const footer = document.createElement('div'); footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
      const counter = document.createElement('span'); counter.style.cssText = 'font-size:11.5px;color:var(--h-ink-faint);font-variant-numeric:tabular-nums';
      const updateCounter = () => { const used = ta.value.length; const pct = used / SA_MEM_BUDGET; counter.textContent = `${used} / ${SA_MEM_BUDGET}`; counter.style.color = pct > .9 ? 'var(--h-red)' : pct > .75 ? 'var(--h-amber)' : 'var(--h-ink-faint)'; };
      updateCounter(); ta.addEventListener('input', updateCounter);
      const saveBtn = document.createElement('button'); saveBtn.textContent = 'save'; saveBtn.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:4px 14px;cursor:pointer';
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try {
          const r2 = await fetch(`/api/sub-agents/${sa.id}/memory`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: ta.value }) });
          if (r2.ok) showToast('memory saved'); else { const e = await r2.json().catch(() => ({})); showToast(e.error || 'failed to save', { error: true }); }
        } catch { showToast('failed to save', { error: true }); }
        saveBtn.disabled = false;
      };
      footer.append(counter, saveBtn); wrap.append(ta, footer);
    } catch { wrap.removeChild(loading); const err = document.createElement('span'); err.style.cssText = 'font-size:12.5px;color:var(--h-ink-faint)'; err.textContent = 'failed to load'; wrap.appendChild(err); }
  })();
  return wrap;
}

// Wax-seal mark. `badge` adds the corner notch that marks a sub-agent.
function saMakeSeal({ letter, color, avatarUrl, avatarSymbol, size = 26, badge = false, ink = '#fff' }) {
  const wrap = document.createElement('span');
  wrap.style.cssText = 'position:relative;display:inline-flex;flex:0 0 auto';
  let disc;
  if (avatarUrl) {
    disc = document.createElement('img');
    disc.src = avatarUrl;
    disc.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;display:block;box-shadow:0 1px 2px rgba(0,0,0,.06)`;
  } else {
    disc = document.createElement('span');
    disc.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};color:${ink};` +
      `display:inline-flex;align-items:center;justify-content:center;font-family:var(--h-serif);` +
      `font-size:${size * 0.5}px;font-style:italic;line-height:1;` +
      'box-shadow:inset 0 -1px 0 rgba(0,0,0,.16), 0 1px 2px rgba(0,0,0,.06)';
    disc.textContent = avatarSymbol || letter || '?';
  }
  wrap.appendChild(disc);
  if (badge) {
    const notch = document.createElement('span');
    const b = Math.max(7, size * 0.28);
    notch.style.cssText = `position:absolute;right:-1px;bottom:-1px;width:${b}px;height:${b}px;` +
      `border-radius:50%;background:var(--h-surface);border:1.5px solid ${color};box-sizing:border-box`;
    wrap.appendChild(notch);
  }
  return wrap;
}

// Tier chip — hairline pill with a 1/2/3-bar depth meter.
function saMakeTierChip(tier, dim = false) {
  const t = SA_TIERS_META.find(x => x.id === tier) || SA_TIERS_META[0];
  const chip = document.createElement('span');
  chip.title = t.note;
  chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;' +
    'padding:3px 9px 3px 7px;border-radius:999px;border:1px solid var(--h-hair-soft);' +
    'background:color-mix(in srgb, var(--h-bg) 34%, var(--h-surface));' +
    `font-family:var(--h-sans);font-size:11.5px;letter-spacing:.02em;color:var(--h-ink-${dim ? 'faint' : 'mute'})`;
  const meter = document.createElement('span');
  meter.style.cssText = 'display:inline-flex;align-items:flex-end;gap:1.5px;height:9px';
  for (let i = 0; i < 3; i++) {
    const bar = document.createElement('span');
    const on = i < t.bars;
    bar.style.cssText = `width:2px;height:${3 + i * 3}px;border-radius:1px;` +
      `background:${on ? 'currentColor' : 'var(--h-hairline)'};opacity:${on ? .85 : .5}`;
    meter.appendChild(bar);
  }
  chip.append(meter, document.createTextNode(t.id));
  return chip;
}

// Tier picker — 3 clickable cards. onPick(id) fires; keeps its own selection.
function saMakeTierPicker(current, onPick) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:8px';
  let selected = current || 'quick';
  const cards = {};
  function paint() {
    for (const t of SA_TIERS_META) {
      const on = t.id === selected;
      const c = cards[t.id];
      c.card.style.border = `1px solid ${on ? 'var(--h-ink)' : 'var(--h-hair-soft)'}`;
      c.card.style.background = on ? 'var(--h-surface-hi)' : 'transparent';
      c.name.style.color = on ? 'var(--h-ink)' : 'var(--h-ink-mute)';
    }
  }
  for (const t of SA_TIERS_META) {
    const card = document.createElement('div');
    card.style.cssText = 'flex:1;padding:9px 12px 10px;border-radius:10px;cursor:pointer;' +
      'display:flex;flex-direction:column;gap:3px';
    const name = document.createElement('span');
    name.style.cssText = 'font-family:var(--h-sans);font-size:13.5px';
    name.textContent = t.id;
    const note = document.createElement('span');
    note.style.cssText = 'font-family:var(--h-sans);font-size:11.5px;color:var(--h-ink-faint)';
    note.textContent = t.note;
    card.append(name, note);
    card.addEventListener('click', () => { selected = t.id; paint(); onPick(t.id); });
    cards[t.id] = { card, name };
    wrap.appendChild(card);
  }
  paint();
  return wrap;
}

// ConnField — lowercase label, control, optional hint underneath.
function saMakeField(labelText, controlEl, hintText) {
  const field = document.createElement('div');
  field.style.cssText = 'display:flex;flex-direction:column;gap:6px;min-width:0';
  const lbl = document.createElement('span');
  lbl.style.cssText = 'font-family:var(--h-sans);font-size:11.5px;color:var(--h-ink-mute);letter-spacing:.04em';
  lbl.textContent = labelText;
  field.append(lbl, controlEl);
  if (hintText) {
    const hint = document.createElement('span');
    hint.className = 's-sa-hint';
    hint.style.cssText = 'font-family:var(--h-sans);font-size:11.5px;color:var(--h-ink-faint);line-height:1.4';
    hint.textContent = hintText;
    field.appendChild(hint);
  }
  return field;
}

function sMakeEditAccordion(actor) {
  const cfg = (() => { try { return JSON.parse(actor.adapter_config || '{}'); } catch { return {}; } })();
  let editOs = sDetectOS();
  let invalidateCmd = () => {};

  const acc = document.createElement('div');
  acc.className = 's-add-panel';
  acc.id = 's-edit-acc-' + actor.id;

  // Header
  const hdr = document.createElement('div');
  hdr.className = 's-panel-header';
  const titleEl = document.createElement('span');
  titleEl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:17px;color:var(--h-ink)';
  titleEl.textContent = 'Edit AI Agent';
  const statusEl = document.createElement('span');
  statusEl.style.cssText = 'display:flex;align-items:center;gap:6px';
  const dot = document.createElement('span'); dot.className = actor.online ? 's-dot-on' : 's-dot-off';
  const word = document.createElement('span');
  word.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-faint)';
  word.textContent = actor.online ? 'connected' : 'offline';
  statusEl.append(dot, word);
  const spacer = document.createElement('span'); spacer.style.flex = '1';
  const closeBtn = document.createElement('button');
  closeBtn.className = 's-icon-btn'; closeBtn.title = 'Close'; closeBtn.innerHTML = svgX(15);
  closeBtn.addEventListener('click', sCloseEditAccordion);
  hdr.append(titleEl, statusEl, spacer, closeBtn);
  acc.appendChild(hdr);

  // Server
  const hostRow = document.createElement('div');
  hostRow.className = 's-host-row';
  const hostLbl = document.createElement('span'); hostLbl.className = 's-host-label'; hostLbl.textContent = 'server';
  const hostVal = document.createElement('span'); hostVal.className = 's-host-value'; hostVal.textContent = sPublicUrl || location.origin;
  hostRow.append(hostLbl, hostVal);
  acc.appendChild(hostRow);

  // Field row: AI agent (disabled), language, name
  const mkFieldLbl = t => { const l = document.createElement('span'); l.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);letter-spacing:.04em'; l.textContent = t; return l; };

  const fieldRow = document.createElement('div');
  fieldRow.className = 's-field-group-row';

  const beGrp = document.createElement('div');
  beGrp.className = 's-field-group'; beGrp.style.minWidth = 'auto';
  const beSel = document.createElement('select');
  beSel.className = 's-name-input'; beSel.name = 'agent-harness'; beSel.style.cssText = 'width:auto;min-width:130px';
  _buildHarnessOptions(beSel, actor);
  beSel.addEventListener('change', async () => {
    try {
      const r = await fetch(`/api/actors/${actor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapter: beSel.value }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); showToast(e.error || 'Failed to change harness', { error: true }); beSel.value = actor.adapter || 'claude'; return; }
      actor.adapter = beSel.value;
      showToast('Harness updated');
    } catch { showToast('Failed to change harness', { error: true }); beSel.value = actor.adapter || 'claude'; }
  });
  const _accHint = document.createElement('span');
  _accHint.style.cssText = 'font-size:11px;color:var(--h-red);display:none';
  const _accInitHint = _harnessHint(actor);
  if (_accInitHint) { _accHint.textContent = _accInitHint; _accHint.style.display = ''; }
  const _accCheckBtn = _makeCheckHarnessBtn(actor, beSel, _accHint);
  const _accSelRow = document.createElement('div');
  _accSelRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap';
  _accSelRow.append(beSel, _accCheckBtn);
  beGrp.append(mkFieldLbl('harness'), _accSelRow, _accHint);

  const langGrp = document.createElement('div');
  langGrp.className = 's-field-group'; langGrp.style.minWidth = 'auto';
  const langSel = document.createElement('select');
  langSel.className = 's-name-input'; langSel.name = 'agent-lang'; langSel.style.cssText = 'width:auto;min-width:130px;cursor:pointer';
  Object.entries(STOA_LANGS).forEach(([code, lbl]) => {
    const o = document.createElement('option'); o.value = code; o.textContent = lbl;
    if (code === (cfg.lang || 'en')) o.selected = true;
    langSel.appendChild(o);
  });
  langSel.addEventListener('change', () => { invalidateCmd(); });
  langGrp.append(mkFieldLbl('language'), langSel);

  const nameGrp = document.createElement('div');
  nameGrp.className = 's-field-group';
  const nameInp = document.createElement('input');
  nameInp.className = 's-name-input'; nameInp.type = 'text'; nameInp.name = 'agent-name'; nameInp.value = actor.name;
  nameInp.addEventListener('input', () => { invalidateCmd(); });
  nameInp.addEventListener('keydown', e => { if (e.key === 'Escape') sCloseEditAccordion(); });
  const nameHint = document.createElement('span');
  nameHint.className = 's-field-hint'; nameHint.textContent = 'name shown in all rooms';
  nameGrp.append(mkFieldLbl('name'), nameInp, nameHint);

  fieldRow.append(beGrp, langGrp, nameGrp);
  acc.appendChild(fieldRow);

  // Platform pills
  const platGrp = document.createElement('div');
  platGrp.className = 's-field-group'; platGrp.style.minWidth = 'auto';
  const osPills = document.createElement('div');
  osPills.className = 's-os-pills'; osPills.id = `s-eacc-pills-${actor.id}`;
  [['unix','Linux / macOS'],['ps','Windows · PS'],['cmd','Windows · CMD']].forEach(([id,lbl]) => {
    const p = document.createElement('button');
    p.type = 'button'; p.className = 's-os-pill' + (editOs === id ? ' active' : '');
    p.textContent = lbl; p.dataset.os = id;
    p.addEventListener('click', () => {
      editOs = id;
      document.querySelectorAll(`#s-eacc-pills-${actor.id} .s-os-pill`).forEach(x => x.classList.toggle('active', x.dataset.os === id));
      installSlip.setOs(id);
    });
    osPills.appendChild(p);
  });
  platGrp.append(mkFieldLbl('platform'), osPills);
  acc.appendChild(platGrp);

  const installSlip = sMakeInstallSlip('reinstall on the target machine',
    () => ({ name: nameInp.value.trim() || actor.name, lang: langSel.value }), editOs);
  acc.appendChild(installSlip.el);
  invalidateCmd = () => installSlip.invalidate();

  // ── Sub-agents section (card — ported from subagents.jsx) ──
  const saParentColor = actor.avatar_color || '#4f8f9c';
  const saShade = saSubShade(saParentColor);

  const saSection = document.createElement('section');
  saSection.style.cssText = 'border:1px solid var(--h-hairline);border-radius:12px;background:var(--h-surface);overflow:hidden';

  const saHeader = document.createElement('header');
  saHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;' +
    'padding:13px 16px;border-bottom:1px solid var(--h-hair-soft);' +
    'background:color-mix(in srgb, var(--h-bg) 38%, var(--h-surface))';
  const saHeadL = document.createElement('div');
  saHeadL.style.cssText = 'display:flex;align-items:baseline;gap:10px;min-width:0';
  const saTitle = document.createElement('span');
  saTitle.style.cssText = 'font-family:var(--h-serif);font-size:16px;color:var(--h-ink)';
  saTitle.textContent = 'sub-agents';
  const saHint = document.createElement('span');
  saHint.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-faint)';
  saHint.textContent = `specialized workers ${actor.name} can spawn`;
  saHeadL.append(saTitle, saHint);
  const saAddBtn = document.createElement('button');
  saAddBtn.className = 's-sa-add-pill';
  saAddBtn.style.cssText = 'display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex:0 0 auto;' +
    'font-family:var(--h-sans);font-size:12.5px;line-height:1;padding:6px 13px;border-radius:999px;' +
    'border:1px solid var(--h-hairline);background:transparent;color:var(--h-ink-mute);cursor:pointer';
  saAddBtn.innerHTML = '<span style="font-size:14px;line-height:1">+</span> add sub-agent';
  saHeader.append(saHeadL, saAddBtn);
  saSection.appendChild(saHeader);

  const saForm = document.createElement('div');
  saForm.id = `s-sa-form-${actor.id}`;
  saForm.style.display = 'none';
  saSection.appendChild(saForm);

  const saList = document.createElement('div');
  saList.id = `s-sub-agents-${actor.id}`;
  saSection.appendChild(saList);

  function saShowForm(show) {
    saForm.style.display = show ? 'flex' : 'none';
    saAddBtn.style.display = show ? 'none' : 'inline-flex';
  }

  function saMakeFormFields(existing) {
    saForm.style.cssText = 'border-top:1px solid var(--h-hair-soft);' +
      'background:color-mix(in srgb, var(--h-bg) 30%, var(--h-surface));' +
      'padding:18px 20px 20px;display:flex;flex-direction:column;gap:16px';
    saForm.innerHTML = '';
    let selectedTier = existing?.tier || 'quick';

    // Form header
    const fh = document.createElement('div');
    fh.style.cssText = 'display:flex;align-items:center;gap:12px';
    const fhTitle = document.createElement('span');
    fhTitle.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:17px;color:var(--h-ink)';
    fhTitle.textContent = existing ? `edit ${existing.label}` : 'define a sub-agent';
    const fhHint = document.createElement('span');
    fhHint.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-faint)';
    fhHint.textContent = 'defined once — add it to any room afterwards';
    const fhSpacer = document.createElement('span'); fhSpacer.style.flex = '1';
    const fhClose = document.createElement('button');
    fhClose.className = 's-icon-btn'; fhClose.title = 'Close'; fhClose.innerHTML = svgX(15);
    fhClose.addEventListener('click', () => saShowForm(false));
    fh.append(fhTitle, fhHint, fhSpacer, fhClose);

    // label + model override (2-col grid)
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px';
    const labelInp = document.createElement('input');
    labelInp.name = 'subagent-label'; labelInp.placeholder = 'probe'; labelInp.value = existing?.label || '';
    labelInp.style.cssText = 'padding:8px 12px;border-radius:8px;height:36px;box-sizing:border-box;' +
      'background:color-mix(in srgb, var(--h-bg) 30%, var(--h-surface));border:1px solid var(--h-hair-soft);' +
      'font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--h-ink);outline:none;width:100%';
    const labelField = saMakeField('label', labelInp, 'unique, used for @mention — cannot match an agent name');
    const labelErr = document.createElement('span');
    labelErr.style.cssText = 'display:none;align-items:center;gap:6px;font-family:var(--h-sans);font-size:12px;color:' + SA_DANGER;
    labelField.appendChild(labelErr);

    const modelSel = document.createElement('select');
    modelSel.name = 'subagent-model';
    modelSel.style.cssText = 'padding:8px 12px;border-radius:8px;height:36px;box-sizing:border-box;' +
      'background:var(--h-surface);border:1px solid var(--h-hair-soft);' +
      'font-family:var(--h-sans);font-size:13px;color:var(--h-ink);outline:none;width:100%;cursor:pointer';
    const parentHarness = actor.adapter || 'claude';
    _saPopulateModelSel(modelSel, existing?.harness || parentHarness, actor, existing?.model || '');
    const modelField = saMakeField('model override', modelSel, 'leave on “use tier” unless this worker needs a specific model');
    grid.append(labelField, modelField);

    // tier picker
    const tierField = saMakeField('tier', saMakeTierPicker(selectedTier, id => { selectedTier = id; }));

    // system prompt (slip)
    const spInp = document.createElement('textarea');
    spInp.name = 'subagent-system-prompt';
    spInp.placeholder = 'You verify claims against the actual source before answering…';
    spInp.value = existing?.system_prompt || '';
    spInp.style.cssText = 'padding:11px 13px;border-radius:8px;min-height:96px;box-sizing:border-box;resize:vertical;' +
      'background:var(--h-slip);border:1px solid var(--h-hairline);' +
      'font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;color:var(--h-ink);outline:none;width:100%';
    const spField = saMakeField('system prompt', spInp, 'context injected on every trigger');
    const roleInp = _saMakeRoleInput(existing);
    const roleField = saMakeField('role', roleInp, 'optional — shown under the name in chat');
    const descInp = _saMakeDescInput(existing);
    const descField = saMakeField('description', descInp, 'why this sub-agent exists — shown in lists and to the parent agent');

    // harness override
    let selectedHarness = existing?.harness || null;
    const harnSel = document.createElement('select'); harnSel.name = 'subagent-harness'; harnSel.style.cssText = 'padding:8px 12px;border-radius:8px;height:36px;box-sizing:border-box;background:var(--h-surface);border:1px solid var(--h-hair-soft);font-family:var(--h-sans);font-size:13px;color:var(--h-ink);outline:none;width:100%;cursor:pointer';
    const inheritOptA = document.createElement('option'); inheritOptA.value = ''; inheritOptA.textContent = `inherit from parent (${HARNESS_LABELS[parentHarness] || parentHarness})`; harnSel.appendChild(inheritOptA);
    (actor.harnesses_available || [parentHarness]).forEach(h => { const o = document.createElement('option'); o.value = h; o.textContent = HARNESS_LABELS[h] || h; if (h === selectedHarness) o.selected = true; harnSel.appendChild(o); });
    if (!selectedHarness) inheritOptA.selected = true;
    harnSel.addEventListener('change', () => {
      selectedHarness = harnSel.value || null;
      _saPopulateModelSel(modelSel, selectedHarness || parentHarness, actor, modelSel.value);
    });
    const harnField = saMakeField('harness', harnSel, 'override parent harness for this worker');

    // buttons
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;align-items:center;gap:10px;padding-top:2px';
    const saveF = document.createElement('button');
    saveF.style.cssText = 'background:var(--h-ink);color:var(--h-bg);border:none;padding:8px 20px;border-radius:999px;' +
      'font-family:var(--h-sans);font-size:13px;cursor:pointer';
    saveF.textContent = existing ? 'save' : 'create sub-agent';
    const cancelF = document.createElement('button');
    cancelF.style.cssText = 'background:transparent;border:1px solid var(--h-hairline);color:var(--h-ink-mute);' +
      'font-family:var(--h-sans);font-size:13px;padding:7px 16px;border-radius:999px;cursor:pointer';
    cancelF.textContent = 'cancel';
    cancelF.addEventListener('click', () => saShowForm(false));
    btns.append(saveF, cancelF);

    function clearErr() {
      labelErr.style.display = 'none';
      labelInp.style.border = '1px solid var(--h-hair-soft)';
      labelInp.style.boxShadow = 'none';
    }
    function showErr(msg) {
      labelErr.textContent = msg; labelErr.style.display = 'inline-flex';
      labelInp.style.border = '1px solid ' + SA_DANGER;
      labelInp.style.boxShadow = `0 0 0 3px color-mix(in srgb, ${SA_DANGER} 14%, transparent)`;
    }
    labelInp.addEventListener('input', clearErr);

    saveF.addEventListener('click', async () => {
      const label = labelInp.value.trim();
      if (!label) { showErr('label required'); labelInp.focus(); return; }
      saveF.disabled = true;
      try {
        const body = { label, tier: selectedTier, model: modelSel.value || null, system_prompt: spInp.value.trim() || null, role: roleInp.value.trim() || null, description: descInp.value.trim() || null, harness: selectedHarness };
        const r = existing
          ? await fetch(`/api/sub-agents/${existing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          : await fetch(`/api/actors/${actor.id}/sub-agents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          const msg = e.error || 'failed to save';
          if (/already exists/i.test(msg)) showErr(`”${label}” already exists on ${actor.name}`);
          else if (/actor name|conflicts/i.test(msg)) showErr(`”${label}” is an agent name — pick something else`);
          else showToast(msg, { error: true });
          saveF.disabled = false; return;
        }
        saShowForm(false); saLoadList();
      } catch { showToast('Failed to save sub-agent', { error: true }); saveF.disabled = false; }
    });

    const appendItems = [fh, grid, tierField, roleField, descField, spField, harnField];
    if (existing) {
      appendItems.push(saMakeField('avatar', _saBuildAvatarEditor(existing, saShade, upd => { existing.avatar_color = upd.avatar_color; existing.avatar_symbol = upd.avatar_symbol; existing.avatar_url = upd.avatar_url; }), 'color, symbol, or image'));
      appendItems.push(saMakeField('memory', _saBuildMemoryEditor(existing), 'notes this sub-agent updates after tasks'));
    }
    appendItems.push(btns);
    saForm.append(...appendItems);
    setTimeout(() => labelInp.focus(), 0);
    saShowForm(true);
  }

  async function saLoadList() {
    try {
      const r = await fetch(`/api/actors/${actor.id}/sub-agents`);
      if (!r.ok) return;
      const subs = await r.json();
      saList.innerHTML = '';
      saHint.textContent = (subs.length ? `${subs.length} defined · ` : '') + `specialized workers ${actor.name} can spawn`;
      if (!subs.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:26px 22px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center';
        const et = document.createElement('span');
        et.style.cssText = 'font-family:var(--h-serif);font-size:17px;color:var(--h-ink)';
        et.textContent = 'no sub-agents yet';
        const ed = document.createElement('span');
        ed.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:14px;color:var(--h-ink-mute);line-height:1.5;max-width:420px';
        ed.textContent = `a sub-agent is a smaller worker ${actor.name} can hand a narrow job to — a quick file probe, a careful reviewer. define one here, then add it to any room.`;
        empty.append(et, ed);
        saList.appendChild(empty);
        return;
      }
      subs.forEach((sa, i) => {
        const last = i === subs.length - 1;
        const dim = !sa.enabled;
        const row = document.createElement('div');
        row.className = 's-sa-row';
        row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:13px 16px;' +
          (last ? '' : 'border-bottom:1px solid var(--h-hair-soft);') + `opacity:${dim ? .62 : 1}`;
        row.appendChild(saMakeSeal({ letter: sa.label[0], color: sa.avatar_color || saShade, avatarUrl: sa.avatar_url || null, avatarSymbol: sa.avatar_symbol || null, size: 26, badge: true, ink: 'var(--sa-sub-ink)' }));
        const mid = document.createElement('div');
        mid.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:4px';
        const line1 = document.createElement('div');
        line1.style.cssText = 'display:flex;align-items:center;gap:9px;flex-wrap:wrap';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:14px;color:var(--h-ink)';
        lbl.textContent = sa.label;
        line1.append(lbl, saMakeTierChip(sa.tier, dim));
        if (sa.model) {
          const mp = document.createElement('span');
          mp.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--h-ink-faint);' +
            'padding:2px 7px;border-radius:6px;background:color-mix(in srgb, var(--h-ink) 7%, var(--h-surface))';
          mp.textContent = sa.model;
          line1.appendChild(mp);
        }
        if (sa.harness) {
          const hp = document.createElement('span');
          hp.style.cssText = 'font-family:var(--h-sans);font-size:11px;color:var(--h-ink-faint);padding:2px 6px;border-radius:6px;border:1px solid var(--h-hair-soft)';
          hp.textContent = HARNESS_LABELS[sa.harness] || sa.harness;
          line1.appendChild(hp);
        }
        const roleChip = _saMakeRoleChip(sa);
        if (roleChip) line1.appendChild(roleChip);
        mid.append(line1);
        const descLine = _saMakeDescLine(sa);
        if (descLine) mid.appendChild(descLine);
        row.appendChild(mid);
        // enabled toggle
        const tog = document.createElement('button');
        tog.className = 's-notif-toggle' + (sa.enabled ? ' on' : '');
        tog.title = sa.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable';
        tog.style.flex = '0 0 auto';
        tog.addEventListener('click', async () => {
          try {
            const rr = await fetch(`/api/sub-agents/${sa.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !sa.enabled }) });
            if (rr.ok) saLoadList();
          } catch { showToast('Failed to update', { error: true }); }
        });
        row.appendChild(tog);
        const acts = document.createElement('div');
        acts.style.cssText = 'display:flex;gap:2px;margin-left:4px';
        const editB = document.createElement('button');
        editB.className = 's-icon-btn'; editB.innerHTML = svgPencil(13); editB.title = 'Edit sub-agent';
        editB.addEventListener('click', () => saMakeFormFields(sa));
        const delB = document.createElement('button');
        delB.className = 's-icon-btn'; delB.innerHTML = svgX(13); delB.title = 'Delete sub-agent';
        delB.style.color = SA_DANGER;
        delB.addEventListener('click', async () => {
          try { const rr = await fetch(`/api/sub-agents/${sa.id}`, { method: 'DELETE' }); if (rr.ok) saLoadList(); }
          catch { showToast('Failed to delete', { error: true }); }
        });
        acts.append(editB, delB);
        row.appendChild(acts);
        saList.appendChild(row);
      });
    } catch {}
  }

  saAddBtn.addEventListener('click', () => saMakeFormFields(null));
  saLoadList();
  acc.appendChild(saSection);

  // ── Memory section ──
  const memSection = document.createElement('section');
  memSection.style.cssText = 'border:1px solid var(--h-hair-soft);border-radius:12px;overflow:hidden;margin-top:18px';
  const memHdr = document.createElement('div');
  memHdr.style.cssText = 'padding:14px 18px 10px;border-bottom:1px solid var(--h-hair-soft)';
  const memTitle = document.createElement('div');
  memTitle.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:15px;color:var(--h-ink)';
  memTitle.textContent = 'Memory';
  const memSubtitle = document.createElement('div');
  memSubtitle.style.cssText = 'font-size:12px;color:var(--h-ink-faint);margin-top:3px';
  memSubtitle.textContent = 'injected into every session this agent starts';
  memHdr.append(memTitle, memSubtitle);
  memSection.appendChild(memHdr);

  const MEM_FILES = [
    { file: 'MEMORY.md', budget: 2200, hint: 'facts about this agent — roles, preferences, recurring instructions' },
    { file: 'USER.md',   budget: 1375, hint: 'context about the user and how to work with them' },
  ];

  function makeMemFileCard(file, budget, hint, initial) {
    const card = document.createElement('div');
    card.style.cssText = 'padding:14px 18px;border-bottom:1px solid var(--h-hair-soft)';
    const fileHdr = document.createElement('div');
    fileHdr.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px';
    const fileLbl = document.createElement('span');
    fileLbl.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--h-ink)';
    fileLbl.textContent = file;
    const fileHint = document.createElement('span');
    fileHint.style.cssText = 'font-size:11.5px;color:var(--h-ink-faint)';
    fileHint.textContent = hint;
    fileHdr.append(fileLbl, fileHint);

    const ta = document.createElement('textarea');
    ta.name = 'agent-memory-' + file.replace('.', '-').toLowerCase();
    ta.value = initial;
    ta.placeholder = `Write ${file} content here…`;
    ta.maxLength = budget;
    ta.style.cssText = 'width:100%;box-sizing:border-box;min-height:80px;resize:vertical;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;padding:8px 10px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);outline:none';

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:6px';
    const counter = document.createElement('span');
    counter.style.cssText = 'font-size:11.5px;color:var(--h-ink-faint);font-variant-numeric:tabular-nums';
    const updateCounter = () => {
      const used = ta.value.length;
      const pct = used / budget;
      counter.textContent = `${used} / ${budget}`;
      counter.style.color = pct > .9 ? 'var(--h-red)' : pct > .75 ? 'var(--h-amber)' : 'var(--h-ink-faint)';
    };
    updateCounter();
    ta.addEventListener('input', updateCounter);

    const saveBtn = document.createElement('button');
    saveBtn.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:4px 14px;cursor:pointer';
    saveBtn.textContent = 'save';
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        const r = await fetch(`/api/actors/${actor.id}/memory/${encodeURIComponent(file)}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: ta.value }),
        });
        if (r.ok) showToast(`${file} saved`);
        else { const e = await r.json().catch(() => ({})); showToast(e.error || 'Failed to save', { error: true }); }
      } catch { showToast('Failed to save', { error: true }); }
      saveBtn.disabled = false;
    };
    footer.append(counter, saveBtn);
    card.append(fileHdr, ta, footer);
    return card;
  }

  const memLoading = document.createElement('div');
  memLoading.style.cssText = 'padding:14px 18px;font-size:12.5px;color:var(--h-ink-mute)';
  memLoading.textContent = 'loading…';
  memSection.appendChild(memLoading);

  (async () => {
    try {
      const r = await fetch(`/api/actors/${actor.id}/memory`);
      memSection.removeChild(memLoading);
      if (!r.ok) {
        const err = document.createElement('div');
        err.style.cssText = 'padding:14px 18px;font-size:12.5px;color:var(--h-ink-mute)';
        err.textContent = 'failed to load memory';
        memSection.appendChild(err);
        return;
      }
      const data = await r.json();
      const byFile = {};
      (data.files || []).forEach(f => { byFile[f.file] = f.content || ''; });
      MEM_FILES.forEach(({ file, budget, hint }) => {
        memSection.appendChild(makeMemFileCard(file, budget, hint, byFile[file] || ''));
      });
      const lastCard = memSection.lastElementChild;
      if (lastCard) lastCard.style.borderBottom = 'none';
    } catch {
      memSection.removeChild(memLoading);
      const err = document.createElement('div');
      err.style.cssText = 'padding:14px 18px;font-size:12.5px;color:var(--h-ink-mute)';
      err.textContent = 'failed to load memory';
      memSection.appendChild(err);
    }
  })();

  acc.appendChild(memSection);

  // Save / Cancel
  const actionsRow = document.createElement('div');
  actionsRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding-top:4px';
  const cancelBtn = document.createElement('button');
  cancelBtn.style.cssText = 'background:transparent;border:none;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:13px;padding:7px 14px;border-radius:999px;cursor:pointer';
  cancelBtn.textContent = 'cancel';
  cancelBtn.addEventListener('click', sCloseEditAccordion);
  const saveBtn = document.createElement('button');
  saveBtn.className = 'h-btn-primary'; saveBtn.style.cssText = 'padding:7px 18px;font-size:13px';
  saveBtn.textContent = 'save';
  saveBtn.addEventListener('click', async () => {
    const newName = nameInp.value.trim();
    if (!newName) { showToast('Name cannot be empty', { error: true }); return; }
    const body = { name: newName, lang: langSel.value };
    try {
      const r = await fetch(`/api/actors/${actor.id}/config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error();
      const updated = await r.json();
      const idx = settingsActors.findIndex(a => a.id === actor.id);
      if (idx >= 0) settingsActors[idx] = { ...settingsActors[idx], ...updated };
      const allIdx = allActors.findIndex(a => a.id === actor.id);
      if (allIdx >= 0) allActors[allIdx] = { ...allActors[allIdx], ...updated };
      sCloseEditAccordion();
      sRefreshRow(actor.id);
    } catch { showToast('Failed to save agent settings', { error: true }); }
  });
  actionsRow.append(cancelBtn, saveBtn);
  acc.appendChild(actionsRow);

  return acc;
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
  if (agentsSelectedId === id) renderAgentDetail(id);
}

async function sCommitDelete(id) {
  settingsActors = settingsActors.filter(a => a.id !== id);
  sRowStates.delete(id);
  if (agentsSelectedId === id) {
    agentsSelectedId = null;
    localStorage.removeItem('stoa-agents-selected');
    showAgentEmptyState();
  }
  renderAgentSidebar();
  try {
    const r = await fetch(`/api/actors/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('delete failed');
    const idx = allActors.findIndex(a => a.id === id);
    if (idx >= 0) allActors.splice(idx, 1);
    syncNewRoomBtn();
  } catch {
    showToast('Failed to delete agent', { error: true });
    settingsActors = allActors.filter(a => a.type !== 'human' || a.id === humanActor?.id);
    renderAgentSidebar();
  }
}


// ── 2-panel agents page ──────────────────────────────────────────────────────
let agentsSelectedId = (() => {
  const v = localStorage.getItem('stoa-agents-selected');
  return v ? parseInt(v) : null;
})();

function renderAgentSidebar() {
  const list = document.getElementById('agent-list');
  const countLabel = document.getElementById('agents-count-label');
  if (!list) return;

  const agents = [...settingsActors.filter(a => a.type !== 'human')].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return b.id - a.id;
  });
  const query = (document.getElementById('agent-search-input')?.value || '').toLowerCase().trim();
  const filtered = query ? agents.filter(a => a.name.toLowerCase().includes(query)) : agents;

  if (countLabel) countLabel.textContent = `${agents.length} agent${agents.length !== 1 ? 's' : ''}`;

  list.innerHTML = '';

  const online = filtered.filter(a => a.online);
  const offline = filtered.filter(a => !a.online);

  function addGroup(label, items) {
    if (!items.length) return;
    const ghdr = document.createElement('div');
    ghdr.className = 'h-room-group-header';
    const gl = document.createElement('span'); gl.className = 'h-room-group-label'; gl.textContent = label;
    ghdr.appendChild(gl);
    list.appendChild(ghdr);
    for (const a of items) list.appendChild(makeAgentSidebarRow(a));
  }

  addGroup('online', online);
  addGroup('offline', offline);

  if (!filtered.length) {
    const em = document.createElement('div');
    em.style.cssText = 'padding:40px 20px;text-align:center;font-family:var(--h-serif);font-style:italic;font-size:14px;color:var(--h-ink-faint)';
    em.textContent = agents.length ? 'no agents match your search' : 'no agents connected';
    list.appendChild(em);
  }

  // Wire search (debounced to avoid N+1 per keystroke)
  const searchInp = document.getElementById('agent-search-input');
  if (searchInp && !searchInp._agentSearchWired) {
    searchInp._agentSearchWired = true;
    let _searchTimer = null;
    searchInp.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => renderAgentSidebar(), 200);
    });
    const clearBtn = document.getElementById('agent-search-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => { searchInp.value = ''; renderAgentSidebar(); searchInp.focus(); });
  }

  if (sAddPanel?.open) return;
  if (agentsSelectedId && settingsActors.find(a => a.id === agentsSelectedId)) {
    renderAgentDetail(agentsSelectedId);
  } else {
    agentsSelectedId = null;
    showAgentEmptyState();
  }
}

function makeAgentSidebarRow(actor) {
  const color = actor.avatar_color || '#888';
  const row = document.createElement('div');
  row.className = 'h-room-row h-agent-row' + (actor.id === agentsSelectedId ? ' active' : '');
  row.dataset.actorId = actor.id;
  row.setAttribute('tabindex', '0');
  row.setAttribute('role', 'button');

  const avWrap = document.createElement('div');
  avWrap.style.flexShrink = '0';
  if (sIsAutoName(actor.name)) {
    const badge = document.createElement('span');
    badge.style.cssText = `width:28px;height:28px;border-radius:50%;border:1.5px dashed ${color};background:color-mix(in srgb,${color} 10%,var(--h-surface));color:${color};font-size:14px;display:inline-flex;align-items:center;justify-content:center;font-family:var(--h-serif);flex-shrink:0`;
    badge.textContent = actor.avatar_symbol || '◇';
    avWrap.appendChild(badge);
  } else {
    avWrap.appendChild(makeAvatar(actor.name, color, actor.avatar_url, 28));
  }

  const mid = document.createElement('div');
  mid.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:2px';

  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'display:flex;align-items:center;gap:6px';
  const dot = document.createElement('span');
  dot.id = `s-sidebar-dot-${actor.id}`;
  dot.className = actor.online ? 's-dot-on' : 's-dot-off';
  dot.style.flexShrink = '0';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'h-room-title-text';
  nameSpan.textContent = actor.name;
  const harnessChip = document.createElement('span');
  harnessChip.style.cssText = 'font-family:var(--h-sans);font-size:11px;color:var(--h-ink-faint);padding:2px 6px;border-radius:6px;border:1px solid var(--h-hair-soft);flex-shrink:0';
  harnessChip.textContent = HARNESS_LABELS[actor.adapter] || actor.adapter || 'Claude CLI';
  nameRow.append(dot, nameSpan, harnessChip);

  const sub = document.createElement('div');
  sub.className = 'h-room-preview';
  const cachedCount = agentSubCountCache.get(actor.id);
  const base = actor.adapter || 'agent';
  sub.textContent = cachedCount > 0 ? `${base} · ${cachedCount} sub-agent${cachedCount > 1 ? 's' : ''}` : base;
  if (cachedCount === undefined) {
    fjson(`/api/actors/${actor.id}/sub-agents`).then(subs => {
      const cnt = subs.length;
      agentSubCountCache.set(actor.id, cnt);
      sub.textContent = cnt > 0 ? `${base} · ${cnt} sub-agent${cnt > 1 ? 's' : ''}` : base;
    }).catch(() => { agentSubCountCache.set(actor.id, 0); });
  }

  mid.append(nameRow, sub);

  const statusWord = document.createElement('div');
  statusWord.id = `s-sidebar-word-${actor.id}`;
  statusWord.className = 'h-room-time';
  statusWord.textContent = actor.online ? 'online' : '';

  row.append(avWrap, mid, statusWord);
  row.addEventListener('click', () => selectAgent(actor.id));
  row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAgent(actor.id); } });

  return row;
}

function selectAgent(id) {
  agentsSelectedId = id;
  localStorage.setItem('stoa-agents-selected', String(id));
  document.querySelectorAll('#agent-list .h-agent-row').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.actorId) === id);
  });
  if (window.innerWidth <= 680) document.body.classList.add('in-chat');
  renderAgentDetail(id);
}

function showAgentEmptyState() {
  const empty = document.getElementById('s-agent-empty-state');
  const detail = document.getElementById('s-agent-detail');
  const addPanel = document.getElementById('s-add-panel');
  if (empty) empty.style.display = '';
  if (detail) detail.style.display = 'none';
  if (addPanel && !sAddPanel?.open) addPanel.classList.remove('open');
}

function renderAgentDetail(id) {
  const actor = settingsActors.find(a => a.id === id);
  if (!actor) { showAgentEmptyState(); return; }

  const empty = document.getElementById('s-agent-empty-state');
  const detail = document.getElementById('s-agent-detail');
  const addPanel = document.getElementById('s-add-panel');
  if (empty) empty.style.display = 'none';
  if (addPanel && !sAddPanel?.open) addPanel.classList.remove('open');
  if (detail) detail.style.display = '';

  const headerEl = document.getElementById('s-agent-detail-header');
  if (headerEl) {
    headerEl.innerHTML = '';
    renderAgentDetailHeader(headerEl, actor);
  }

  const bodyEl = document.getElementById('s-agent-detail-body');
  if (!bodyEl) return;
  bodyEl.innerHTML = '';
  bodyEl.appendChild(buildAgentSettingsCard(actor));
  bodyEl.appendChild(buildAgentSystemPromptSection(actor));
  bodyEl.appendChild(buildSubAgentsSection(actor));
  bodyEl.appendChild(buildAgentWorkdirsCard(actor));
  bodyEl.appendChild(buildAgentMemorySection(actor));
}

function renderAgentDetailHeader(container, actor) {
  const color = actor.avatar_color || '#888';

  const avWrap = document.createElement('div');
  avWrap.style.cssText = 'flex-shrink:0;position:relative;cursor:pointer';
  avWrap.title = 'Change avatar';
  if (sIsAutoName(actor.name)) {
    const badge = document.createElement('span');
    badge.style.cssText = `width:36px;height:36px;border-radius:50%;border:1.5px dashed ${color};background:color-mix(in srgb,${color} 10%,var(--h-surface));color:${color};font-size:18px;display:inline-flex;align-items:center;justify-content:center;font-family:var(--h-serif);flex-shrink:0`;
    badge.textContent = actor.avatar_symbol || '◇';
    avWrap.appendChild(badge);
  } else {
    avWrap.appendChild(makeAvatar(actor.name, color, actor.avatar_url, 36));
  }
  const camOverlay = document.createElement('div');
  camOverlay.style.cssText = 'position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s;pointer-events:none';
  camOverlay.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="14" height="10" rx="2"/><circle cx="8" cy="9" r="2.5"/><path d="M5 4l1.5-2h3L11 4"/></svg>`;
  avWrap.appendChild(camOverlay);
  avWrap.addEventListener('mouseenter', () => camOverlay.style.opacity = '1');
  avWrap.addEventListener('mouseleave', () => camOverlay.style.opacity = '0');
  const avInput = document.createElement('input');
  avInput.type = 'file'; avInput.accept = 'image/*'; avInput.style.display = 'none'; avInput.name = 'actor-avatar-upload';
  avInput.addEventListener('change', () => { if (avInput.files[0]) sResizeAndUploadActorAvatar(actor.id, avInput.files[0], avWrap); });
  avWrap.appendChild(avInput);
  avWrap.addEventListener('click', () => avInput.click());

  const nameStat = document.createElement('div');
  nameStat.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:4px';

  const nameSpan = document.createElement('span');
  nameSpan.id = `s-detail-name-${actor.id}`;
  nameSpan.style.cssText = 'font-family:var(--h-serif);font-size:18px;color:var(--h-ink);cursor:pointer;display:inline-block';
  nameSpan.textContent = actor.name;
  nameSpan.title = 'Click to rename';
  nameSpan.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.className = 's-rename-input';
    inp.name = 'agent-rename';
    inp.style.fontSize = '18px';
    inp.value = actor.name;
    nameSpan.replaceWith(inp);
    inp.focus(); inp.select();
    const commit = async () => {
      const newName = inp.value.trim() || actor.name;
      inp.replaceWith(nameSpan);
      nameSpan.textContent = newName;
      if (newName === actor.name) return;
      const prevName = actor.name;
      actor.name = newName;
      try {
        const r = await fetch(`/api/actors/${actor.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }) });
        if (!r.ok) throw new Error();
        const ga = allActors.find(a => a.id === actor.id);
        if (ga) { if (actorByName[ga.name]) delete actorByName[ga.name]; ga.name = newName; actorByName[newName] = ga; }
        const sidebarName = document.querySelector(`#agent-list .h-agent-row[data-actor-id="${actor.id}"] .h-room-title-text`);
        if (sidebarName) sidebarName.textContent = newName;
      } catch {
        actor.name = prevName; nameSpan.textContent = prevName;
        showToast('Failed to rename', { error: true });
      }
    };
    inp.addEventListener('blur', () => setTimeout(commit, 150));
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { inp.replaceWith(nameSpan); }
    });
  });

  const statWrap = document.createElement('div');
  statWrap.style.cssText = 'display:flex;align-items:center;gap:8px';
  const dot = document.createElement('span');
  dot.id = `s-dot-${actor.id}`;
  dot.className = actor.online ? 's-dot-on' : 's-dot-off';
  const word = document.createElement('span');
  word.id = `s-word-${actor.id}`;
  word.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-faint)';
  word.textContent = actor.online ? 'online' : 'offline';
  statWrap.append(dot, word);

  const subInfo = document.createElement('div');
  subInfo.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-faint)';
  const parts = [`actor #${actor.id}`, actor.adapter || 'agent'];
  if (actor.client_version) parts.push(`v${actor.client_version}`);
  parts.push('joined ' + sFormatJoined(actor.created_at));
  subInfo.textContent = parts.join(' · ');
  fjson(`/api/actors/${actor.id}/workdirs`).then(wds => {
    if (wds.length) subInfo.textContent += ` · ${wds.length} workdir${wds.length > 1 ? 's' : ''}`;
  }).catch(() => {});

  nameStat.append(nameSpan, statWrap, subInfo);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0';

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 's-icon-btn'; refreshBtn.title = actor.online ? 'Rescan workdirs, skills & harnesses' : 'Offline';
  refreshBtn.disabled = !actor.online; refreshBtn.innerHTML = svgRefresh(16);
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true; refreshBtn.style.opacity = '0.4';
    try {
      const rr = await fetch(`/api/actors/${actor.id}/rescan`, { method: 'POST' });
      if (!rr.ok) throw new Error();
    } catch { showToast('Failed to rescan', { error: true }); }
    setTimeout(() => { refreshBtn.disabled = !actor.online; refreshBtn.style.opacity = ''; }, 1200);
  });

  const updBtn = document.createElement('button');
  updBtn.className = 's-icon-btn'; updBtn.title = actor.online ? 'Force update agent code' : 'Offline';
  updBtn.disabled = !actor.online; updBtn.innerHTML = svgUpdate(16);
  updBtn.addEventListener('click', async () => {
    updBtn.disabled = true; updBtn.style.opacity = '0.4';
    try { await fetch(`/api/actors/${actor.id}/force-update`, { method: 'POST' }); } catch {}
    setTimeout(() => { updBtn.disabled = !actor.online; updBtn.style.opacity = ''; }, 3000);
  });

  const delBtn = document.createElement('button');
  delBtn.className = 's-icon-btn'; delBtn.title = 'Remove agent'; delBtn.innerHTML = svgX(16);
  delBtn.style.color = 'var(--h-red)';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    sRowStates.set(actor.id, { state: 'confirm-delete', draft: '' });
    const pill = sMakeConfirmPill(actor);
    delBtn.replaceWith(pill);
  });

  actions.append(refreshBtn, updBtn, _makeRestartBtn(actor, 16), delBtn);
  container.append(avWrap, nameStat, actions);
}

function buildAgentSettingsCard(actor) {
  const cfg = (() => { try { return JSON.parse(actor.adapter_config || '{}'); } catch { return {}; } })();
  let editOs = sDetectOS();
  let invalidateCmd = () => {};

  const card = document.createElement('div');
  card.className = 's-agents-card';

  const hdr = document.createElement('div');
  hdr.className = 's-agents-header';
  const hdrL = document.createElement('div'); hdrL.className = 's-agents-header-left';
  const hdrTitle = document.createElement('span');
  hdrTitle.style.cssText = 'font-family:var(--h-serif);font-size:16px;color:var(--h-ink);letter-spacing:.01em';
  hdrTitle.textContent = 'agent';
  hdrL.appendChild(hdrTitle);
  hdr.appendChild(hdrL);
  card.appendChild(hdr);

  const body = document.createElement('div');
  body.style.cssText = 'padding:18px 20px;display:flex;flex-direction:column;gap:18px';

  const hostRow = document.createElement('div');
  hostRow.className = 's-host-row';
  const hostLbl = document.createElement('span'); hostLbl.className = 's-host-label'; hostLbl.textContent = 'server';
  const hostVal = document.createElement('span'); hostVal.className = 's-host-value'; hostVal.textContent = sPublicUrl || location.origin;
  hostRow.append(hostLbl, hostVal);
  body.appendChild(hostRow);

  const mkFieldLbl = t => { const l = document.createElement('span'); l.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);letter-spacing:.04em'; l.textContent = t; return l; };
  const fieldRow = document.createElement('div'); fieldRow.className = 's-field-group-row';

  const beGrp = document.createElement('div'); beGrp.className = 's-field-group'; beGrp.style.minWidth = 'auto';
  const beSel = document.createElement('select');
  beSel.className = 's-name-input'; beSel.name = 'agent-harness'; beSel.style.cssText = 'width:auto;min-width:130px';
  _buildHarnessOptions(beSel, actor);
  let rebuildDefaultModelSel = null;
  beSel.addEventListener('change', async () => {
    const notice = document.getElementById(`s-harness-notice-${actor.id}`);
    try {
      const r = await fetch(`/api/actors/${actor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapter: beSel.value }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        showToast(data.error || 'Failed to change harness', { error: true });
        beSel.value = actor.adapter || 'claude';
        return;
      }
      actor.adapter = beSel.value;
      const idx = settingsActors.findIndex(a => a.id === actor.id);
      if (idx >= 0) settingsActors[idx] = { ...settingsActors[idx], adapter: beSel.value };
      if (data.default_model_reset) {
        actor.default_model = null;
        const sIdx2 = settingsActors.findIndex(a => a.id === actor.id);
        if (sIdx2 >= 0) settingsActors[sIdx2] = { ...settingsActors[sIdx2], default_model: null };
        const aIdx2 = allActors.findIndex(a => a.id === actor.id);
        if (aIdx2 >= 0) allActors[aIdx2] = { ...allActors[aIdx2], default_model: null };
      }
      if (data.harness_default_model !== undefined) actor.harness_default_model = data.harness_default_model;
      if (data.effective_default_model !== undefined) actor.effective_default_model = data.effective_default_model;
      if (data.effective_default_source !== undefined) actor.effective_default_source = data.effective_default_source;
      if (typeof rebuildDefaultModelSel === 'function') rebuildDefaultModelSel();
      if (notice) {
        const fmt = m => m || 'default';
        const fallbackLines = [];
        const roomNames = await Promise.all((data.fallback_rooms || []).map(r => _getRoomName(r.room_id)));
        (data.fallback_rooms || []).forEach((r, i) => {
          fallbackLines.push(`${roomNames[i]}: ${fmt(r.old_model)} → ${fmt(r.new_model)}`);
        });
        (data.fallback_sub_agents || []).forEach(s => {
          fallbackLines.push(`sub-agent ${s.label || s.sub_agent_id}: ${fmt(s.old_model)} → ${fmt(s.new_model)}`);
        });
        if (fallbackLines.length) {
          notice.textContent = 'Model reset to default: ' + fallbackLines.join('; ');
          notice.style.display = '';
        } else { notice.style.display = 'none'; }
      }
      const toastParts = [`${actor.name} switched to ${HARNESS_LABELS[beSel.value] || beSel.value}`];
      if (data.fallback_agent_rooms?.length) {
        const firstRoom = data.fallback_agent_rooms[0];
        toastParts.push(`room model kept in ${data.fallback_agent_rooms.length} mixed room${data.fallback_agent_rooms.length > 1 ? 's' : ''} (${actor.name} uses ${firstRoom.agent_model || 'harness default'})`);
      }
      if (data.default_model_reset) {
        toastParts.push(`default model reset (${data.default_model_reset.old_model})`);
      }
      if (!data.fallback_agent_rooms?.length && !data.default_model_reset && !(data.fallback_rooms?.length)) {
        showToast('Harness updated');
      } else {
        showToast(toastParts.join('. '));
      }
    } catch { showToast('Failed to change harness', { error: true }); beSel.value = actor.adapter || 'claude'; }
  });
  const beHint = document.createElement('span');
  beHint.style.cssText = 'font-size:11px;color:var(--h-red);display:none';
  const _initHint = _harnessHint(actor);
  if (_initHint) { beHint.textContent = _initHint; beHint.style.display = ''; }
  const beCheckBtn = _makeCheckHarnessBtn(actor, beSel, beHint);
  const beSelRow = document.createElement('div');
  beSelRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap';
  beSelRow.append(beSel, beCheckBtn);
  const beNotice = document.createElement('span');
  beNotice.id = `s-harness-notice-${actor.id}`;
  beNotice.style.cssText = 'font-size:11.5px;color:var(--h-amber);margin-top:2px;display:none';
  beGrp.append(mkFieldLbl('harness'), beSelRow, beHint, beNotice);

  const langGrp = document.createElement('div'); langGrp.className = 's-field-group'; langGrp.style.minWidth = 'auto';
  const langSel = document.createElement('select');
  langSel.className = 's-name-input'; langSel.name = 'agent-lang'; langSel.style.cssText = 'width:auto;min-width:130px;cursor:pointer';
  Object.entries(STOA_LANGS).forEach(([code, lbl]) => {
    const o = document.createElement('option'); o.value = code; o.textContent = lbl;
    if (code === (cfg.lang || 'en')) o.selected = true;
    langSel.appendChild(o);
  });
  langSel.addEventListener('change', () => invalidateCmd());
  langGrp.append(mkFieldLbl('language'), langSel);

  const nameGrp = document.createElement('div'); nameGrp.className = 's-field-group';
  const nameInp = document.createElement('input');
  nameInp.className = 's-name-input'; nameInp.type = 'text'; nameInp.name = 'agent-name'; nameInp.value = actor.name;
  nameInp.addEventListener('input', () => invalidateCmd());
  const nameHint = document.createElement('span'); nameHint.className = 's-field-hint'; nameHint.textContent = 'name shown in all rooms';
  nameGrp.append(mkFieldLbl('name'), nameInp, nameHint);

  fieldRow.append(beGrp, langGrp, nameGrp);
  body.appendChild(fieldRow);

  // ── Default model field ──────────────────────────────────────────────────
  const dmGrp = document.createElement('div'); dmGrp.className = 's-field-group'; dmGrp.style.minWidth = 'auto';
  const dmSel = document.createElement('select');
  dmSel.className = 's-name-input'; dmSel.name = 'agent-default-model';
  dmSel.style.cssText = 'width:auto;min-width:190px;cursor:pointer';

  rebuildDefaultModelSel = () => {
    const harness = actor.adapter || 'claude';
    const harnessDefault = actor.harness_default_model;
    dmSel.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = harnessDefault ? `follow harness default — ${harnessDefault}` : 'follow harness default';
    dmSel.appendChild(noneOpt);
    if (!harness || harness === 'claude') {
      const anthropicModels = _saAnthropicModels();
      for (const m of anthropicModels) {
        const o = document.createElement('option'); o.value = m.value; o.textContent = m.label || m.value; dmSel.appendChild(o);
      }
      if (actor.default_model && !anthropicModels.some(m => m.value === actor.default_model)) {
        const o = document.createElement('option'); o.value = actor.default_model; o.textContent = actor.default_model; dmSel.appendChild(o);
      }
    } else {
      const models = (_agentHarnessModels(actor.harness_status, harness) || getModelsForHarness(harness) || []);
      for (const m of models) {
        const o = document.createElement('option'); o.value = m.value; o.textContent = m.label || m.value; dmSel.appendChild(o);
      }
    }
    const valid = Array.from(dmSel.options).map(o => o.value);
    dmSel.value = valid.includes(actor.default_model) ? (actor.default_model || '') : '';
  };
  rebuildDefaultModelSel();

  dmSel.addEventListener('change', async () => {
    const val = dmSel.value || null;
    try {
      const r = await fetch(`/api/actors/${actor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_model: val }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        showToast(data.error || 'Failed to save default model', { error: true });
        rebuildDefaultModelSel();
        return;
      }
      const saved = data.default_model !== undefined ? data.default_model : val;
      if (data.harness_default_model !== undefined) actor.harness_default_model = data.harness_default_model;
      if (data.effective_default_model !== undefined) actor.effective_default_model = data.effective_default_model;
      actor.default_model = saved;
      const sIdx = settingsActors.findIndex(a => a.id === actor.id);
      if (sIdx >= 0) settingsActors[sIdx] = { ...settingsActors[sIdx], default_model: saved };
      const aIdx = allActors.findIndex(a => a.id === actor.id);
      if (aIdx >= 0) allActors[aIdx] = { ...allActors[aIdx], default_model: saved };
      rebuildDefaultModelSel();
      if (typeof _refreshModelResolution === 'function') _refreshModelResolution();
    } catch { showToast('Failed to save default model', { error: true }); rebuildDefaultModelSel(); }
  });

  const dmHint = document.createElement('span'); dmHint.className = 's-field-hint';
  dmHint.textContent = "used when this agent's harness can't run the room model";
  dmGrp.append(mkFieldLbl('default model'), dmSel, dmHint);
  body.appendChild(dmGrp);

  const platGrp = document.createElement('div'); platGrp.className = 's-field-group'; platGrp.style.minWidth = 'auto';
  const osPills = document.createElement('div'); osPills.className = 's-os-pills'; osPills.id = `s-detail-pills-${actor.id}`;
  [['unix','Linux / macOS'],['ps','Windows · PS'],['cmd','Windows · CMD']].forEach(([id,lbl]) => {
    const p = document.createElement('button');
    p.type = 'button'; p.className = 's-os-pill' + (editOs === id ? ' active' : '');
    p.textContent = lbl; p.dataset.os = id;
    p.addEventListener('click', () => {
      editOs = id;
      document.querySelectorAll(`#s-detail-pills-${actor.id} .s-os-pill`).forEach(x => x.classList.toggle('active', x.dataset.os === id));
      installSlip.setOs(id);
    });
    osPills.appendChild(p);
  });
  platGrp.append(mkFieldLbl('platform'), osPills);
  body.appendChild(platGrp);

  const installSlip = sMakeInstallSlip('reinstall on the target machine',
    () => ({ name: nameInp.value.trim() || actor.name, lang: langSel.value }), editOs);
  body.appendChild(installSlip.el);
  invalidateCmd = () => installSlip.invalidate();

  const actionsRow = document.createElement('div');
  actionsRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding-top:4px';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'h-btn-primary'; saveBtn.style.cssText = 'padding:7px 18px;font-size:13px';
  saveBtn.textContent = 'save';
  saveBtn.addEventListener('click', async () => {
    const newName = nameInp.value.trim();
    if (!newName) { showToast('Name cannot be empty', { error: true }); return; }
    try {
      const r = await fetch(`/api/actors/${actor.id}/config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, lang: langSel.value }),
      });
      if (!r.ok) throw new Error();
      const updated = await r.json();
      const idx = settingsActors.findIndex(a => a.id === actor.id);
      if (idx >= 0) settingsActors[idx] = { ...settingsActors[idx], ...updated };
      const allIdx = allActors.findIndex(a => a.id === actor.id);
      if (allIdx >= 0) allActors[allIdx] = { ...allActors[allIdx], ...updated };
      showToast('Saved');
      const sidebarName = document.querySelector(`#agent-list .h-agent-row[data-actor-id="${actor.id}"] .h-room-title-text`);
      if (sidebarName) sidebarName.textContent = newName;
      const detailName = document.getElementById(`s-detail-name-${actor.id}`);
      if (detailName) detailName.textContent = newName;
    } catch { showToast('Failed to save agent settings', { error: true }); }
  });
  actionsRow.appendChild(saveBtn);
  body.appendChild(actionsRow);
  card.appendChild(body);
  return card;
}

function buildSubAgentsSection(actor) {
  const saParentColor = actor.avatar_color || '#4f8f9c';
  const saShade = saSubShade(saParentColor);

  const saSection = document.createElement('section');
  saSection.style.cssText = 'border:1px solid var(--h-hairline);border-radius:12px;background:var(--h-surface);overflow:hidden';

  const saHeader = document.createElement('header');
  saHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px;border-bottom:1px solid var(--h-hair-soft);background:color-mix(in srgb, var(--h-bg) 38%, var(--h-surface))';
  const saHeadL = document.createElement('div'); saHeadL.style.cssText = 'display:flex;align-items:baseline;gap:10px;min-width:0';
  const saTitle = document.createElement('span'); saTitle.style.cssText = 'font-family:var(--h-serif);font-size:16px;color:var(--h-ink)'; saTitle.textContent = 'sub-agents';
  const saHint = document.createElement('span'); saHint.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-faint)'; saHint.textContent = `specialized workers ${actor.name} can spawn`;
  saHeadL.append(saTitle, saHint);
  const saAddBtn = document.createElement('button');
  saAddBtn.className = 's-sa-add-pill';
  saAddBtn.style.cssText = 'display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex:0 0 auto;font-family:var(--h-sans);font-size:12.5px;line-height:1;padding:6px 13px;border-radius:999px;border:1px solid var(--h-hairline);background:transparent;color:var(--h-ink-mute);cursor:pointer';
  saAddBtn.innerHTML = '<span style="font-size:14px;line-height:1">+</span> add sub-agent';
  saHeader.append(saHeadL, saAddBtn);
  saSection.appendChild(saHeader);

  const saForm = document.createElement('div'); saForm.id = `s-sa-form-${actor.id}`; saForm.style.display = 'none';
  saSection.appendChild(saForm);
  const saList = document.createElement('div'); saList.id = `s-sub-agents-${actor.id}`;
  saSection.appendChild(saList);

  function saShowForm(show) { saForm.style.display = show ? 'flex' : 'none'; saAddBtn.style.display = show ? 'none' : 'inline-flex'; }

  function saMakeFormFields(existing) {
    saForm.style.cssText = 'border-top:1px solid var(--h-hair-soft);background:color-mix(in srgb, var(--h-bg) 30%, var(--h-surface));padding:18px 20px 20px;display:flex;flex-direction:column;gap:16px';
    saForm.innerHTML = '';
    let selectedTier = existing?.tier || 'quick';
    const fh = document.createElement('div'); fh.style.cssText = 'display:flex;align-items:center;gap:12px';
    const fhTitle = document.createElement('span'); fhTitle.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:17px;color:var(--h-ink)'; fhTitle.textContent = existing ? `edit ${existing.label}` : 'define a sub-agent';
    const fhHint = document.createElement('span'); fhHint.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-faint)'; fhHint.textContent = 'defined once — add it to any room afterwards';
    const fhSpacer = document.createElement('span'); fhSpacer.style.flex = '1';
    const fhClose = document.createElement('button'); fhClose.className = 's-icon-btn'; fhClose.title = 'Close'; fhClose.innerHTML = svgX(15); fhClose.addEventListener('click', () => saShowForm(false));
    fh.append(fhTitle, fhHint, fhSpacer, fhClose);
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px';
    const labelInp = document.createElement('input'); labelInp.name = 'subagent-label'; labelInp.placeholder = 'probe'; labelInp.value = existing?.label || ''; labelInp.style.cssText = 'padding:8px 12px;border-radius:8px;height:36px;box-sizing:border-box;background:color-mix(in srgb, var(--h-bg) 30%, var(--h-surface));border:1px solid var(--h-hair-soft);font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--h-ink);outline:none;width:100%';
    const labelField = saMakeField('label', labelInp, 'unique, used for @mention — cannot match an agent name');
    const labelErr = document.createElement('span'); labelErr.style.cssText = 'display:none;align-items:center;gap:6px;font-family:var(--h-sans);font-size:12px;color:' + SA_DANGER; labelField.appendChild(labelErr);
    const modelSel = document.createElement('select'); modelSel.name = 'subagent-model'; modelSel.style.cssText = 'padding:8px 12px;border-radius:8px;height:36px;box-sizing:border-box;background:var(--h-surface);border:1px solid var(--h-hair-soft);font-family:var(--h-sans);font-size:13px;color:var(--h-ink);outline:none;width:100%;cursor:pointer';
    const parentHarness = actor.adapter || 'claude';
    _saPopulateModelSel(modelSel, existing?.harness || parentHarness, actor, existing?.model || '');
    const modelField = saMakeField('model override', modelSel, 'leave on "use tier" unless this worker needs a specific model');
    grid.append(labelField, modelField);
    const tierField = saMakeField('tier', saMakeTierPicker(selectedTier, id => { selectedTier = id; }));
    const spInp = document.createElement('textarea'); spInp.name = 'subagent-system-prompt'; spInp.placeholder = 'You verify claims against the actual source before answering…'; spInp.value = existing?.system_prompt || ''; spInp.style.cssText = 'padding:11px 13px;border-radius:8px;min-height:96px;box-sizing:border-box;resize:vertical;background:var(--h-slip);border:1px solid var(--h-hairline);font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;color:var(--h-ink);outline:none;width:100%';
    const spField = saMakeField('system prompt', spInp, 'context injected on every trigger');
    const roleInp = _saMakeRoleInput(existing);
    const roleField = saMakeField('role', roleInp, 'optional — shown under the name in chat');
    const descInp = _saMakeDescInput(existing);
    const descField = saMakeField('description', descInp, 'why this sub-agent exists — shown in lists and to the parent agent');
    // Harness field
    let selectedHarness = existing?.harness || null;
    const harnSel = document.createElement('select'); harnSel.name = 'subagent-harness'; harnSel.style.cssText = 'padding:8px 12px;border-radius:8px;height:36px;box-sizing:border-box;background:var(--h-surface);border:1px solid var(--h-hair-soft);font-family:var(--h-sans);font-size:13px;color:var(--h-ink);outline:none;width:100%;cursor:pointer';
    const inheritOpt = document.createElement('option'); inheritOpt.value = ''; inheritOpt.textContent = `inherit from parent (${HARNESS_LABELS[parentHarness] || parentHarness})`; harnSel.appendChild(inheritOpt);
    const availH = actor.harnesses_available || [parentHarness];
    availH.forEach(h => { const o = document.createElement('option'); o.value = h; o.textContent = HARNESS_LABELS[h] || h; if (h === selectedHarness) o.selected = true; harnSel.appendChild(o); });
    if (!selectedHarness) inheritOpt.selected = true;
    harnSel.addEventListener('change', () => {
      selectedHarness = harnSel.value || null;
      _saPopulateModelSel(modelSel, selectedHarness || parentHarness, actor, modelSel.value);
    });
    const harnField = saMakeField('harness', harnSel, 'override parent harness for this worker');
    const btns = document.createElement('div'); btns.style.cssText = 'display:flex;align-items:center;gap:10px;padding-top:2px';
    const saveF = document.createElement('button'); saveF.style.cssText = 'background:var(--h-ink);color:var(--h-bg);border:none;padding:8px 20px;border-radius:999px;font-family:var(--h-sans);font-size:13px;cursor:pointer'; saveF.textContent = existing ? 'save' : 'create sub-agent';
    const cancelF = document.createElement('button'); cancelF.style.cssText = 'background:transparent;border:1px solid var(--h-hairline);color:var(--h-ink-mute);font-family:var(--h-sans);font-size:13px;padding:7px 16px;border-radius:999px;cursor:pointer'; cancelF.textContent = 'cancel'; cancelF.addEventListener('click', () => saShowForm(false));
    btns.append(saveF, cancelF);
    function clearErr() { labelErr.style.display = 'none'; labelInp.style.border = '1px solid var(--h-hair-soft)'; labelInp.style.boxShadow = 'none'; }
    function showErr(msg) { labelErr.textContent = msg; labelErr.style.display = 'inline-flex'; labelInp.style.border = '1px solid ' + SA_DANGER; labelInp.style.boxShadow = `0 0 0 3px color-mix(in srgb, ${SA_DANGER} 14%, transparent)`; }
    labelInp.addEventListener('input', clearErr);
    saveF.addEventListener('click', async () => {
      const label = labelInp.value.trim();
      if (!label) { showErr('label required'); labelInp.focus(); return; }
      saveF.disabled = true;
      try {
        const body = { label, tier: selectedTier, model: modelSel.value || null, system_prompt: spInp.value.trim() || null, role: roleInp.value.trim() || null, description: descInp.value.trim() || null, harness: selectedHarness };
        const r = existing
          ? await fetch(`/api/sub-agents/${existing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          : await fetch(`/api/actors/${actor.id}/sub-agents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          const msg = e.error || 'failed to save';
          if (/already exists/i.test(msg)) showErr(`"${label}" already exists on ${actor.name}`);
          else if (/actor name|conflicts/i.test(msg)) showErr(`"${label}" is an agent name — pick something else`);
          else showToast(msg, { error: true });
          saveF.disabled = false; return;
        }
        saShowForm(false); saLoadListWithCache();
      } catch { showToast('Failed to save sub-agent', { error: true }); saveF.disabled = false; }
    });
    const appendItems2 = [fh, grid, tierField, roleField, descField, spField, harnField];
    if (existing) {
      appendItems2.push(saMakeField('avatar', _saBuildAvatarEditor(existing, saShade, upd => { existing.avatar_color = upd.avatar_color; existing.avatar_symbol = upd.avatar_symbol; existing.avatar_url = upd.avatar_url; }), 'color, symbol, or image'));
      appendItems2.push(saMakeField('memory', _saBuildMemoryEditor(existing), 'notes this sub-agent updates after tasks'));
    }
    appendItems2.push(btns);
    saForm.append(...appendItems2);
    setTimeout(() => labelInp.focus(), 0);
    saShowForm(true);
  }

  saAddBtn.addEventListener('click', () => saMakeFormFields(null));

  async function saLoadListWithCache() {
    const r = await fetch(`/api/actors/${actor.id}/sub-agents`).catch(() => null);
    if (!r || !r.ok) return;
    const subs = await r.json();
    agentSubCountCache.set(actor.id, subs.length);
    saList.innerHTML = '';
    saHint.textContent = (subs.length ? `${subs.length} defined · ` : '') + `specialized workers ${actor.name} can spawn`;
    if (!subs.length) {
      const empty = document.createElement('div'); empty.style.cssText = 'padding:26px 22px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center';
      const et = document.createElement('span'); et.style.cssText = 'font-family:var(--h-serif);font-size:17px;color:var(--h-ink)'; et.textContent = 'no sub-agents yet';
      const ed = document.createElement('span'); ed.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:14px;color:var(--h-ink-mute);line-height:1.5;max-width:420px'; ed.textContent = `a sub-agent is a smaller worker ${actor.name} can hand a narrow job to — a quick file probe, a careful reviewer. define one here, then add it to any room.`;
      empty.append(et, ed); saList.appendChild(empty); return;
    }
    subs.forEach((sa, i) => {
      const last = i === subs.length - 1;
      const dim = !sa.enabled;
      const row = document.createElement('div');
      row.className = 's-sa-row';
      row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:13px 16px;' + (last ? '' : 'border-bottom:1px solid var(--h-hair-soft);') + `opacity:${dim ? .62 : 1}`;
      row.appendChild(saMakeSeal({ letter: sa.label[0], color: sa.avatar_color || saShade, avatarUrl: sa.avatar_url || null, avatarSymbol: sa.avatar_symbol || null, size: 26, badge: true, ink: 'var(--sa-sub-ink)' }));
      const mid = document.createElement('div'); mid.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:4px';
      const line1 = document.createElement('div'); line1.style.cssText = 'display:flex;align-items:center;gap:9px;flex-wrap:wrap';
      const lbl = document.createElement('span'); lbl.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:14px;color:var(--h-ink)'; lbl.textContent = sa.label;
      line1.append(lbl, saMakeTierChip(sa.tier, dim));
      if (sa.model) { const mp = document.createElement('span'); mp.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--h-ink-faint);padding:2px 7px;border-radius:6px;background:color-mix(in srgb, var(--h-ink) 7%, var(--h-surface))'; mp.textContent = sa.model; line1.appendChild(mp); }
      if (sa.harness) { const hp = document.createElement('span'); hp.style.cssText = 'font-family:var(--h-sans);font-size:11px;color:var(--h-ink-faint);padding:2px 6px;border-radius:6px;border:1px solid var(--h-hair-soft)'; hp.textContent = HARNESS_LABELS[sa.harness] || sa.harness; line1.appendChild(hp); }
      const roleChip = _saMakeRoleChip(sa); if (roleChip) line1.appendChild(roleChip);
      mid.append(line1); const descLine = _saMakeDescLine(sa); if (descLine) mid.appendChild(descLine); row.appendChild(mid);
      const tog = document.createElement('button'); tog.className = 's-notif-toggle' + (sa.enabled ? ' on' : ''); tog.title = sa.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'; tog.style.flex = '0 0 auto';
      tog.addEventListener('click', async () => { try { const rr = await fetch(`/api/sub-agents/${sa.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !sa.enabled }) }); if (rr.ok) saLoadListWithCache(); } catch { showToast('Failed to update', { error: true }); } });
      row.appendChild(tog);
      const acts = document.createElement('div'); acts.style.cssText = 'display:flex;gap:2px;margin-left:4px';
      const editB = document.createElement('button'); editB.className = 's-icon-btn'; editB.innerHTML = svgPencil(13); editB.title = 'Edit sub-agent'; editB.addEventListener('click', () => saMakeFormFields(sa));
      const delB = document.createElement('button'); delB.className = 's-icon-btn'; delB.innerHTML = svgX(13); delB.title = 'Delete sub-agent'; delB.style.color = SA_DANGER;
      delB.addEventListener('click', async () => { try { const rr = await fetch(`/api/sub-agents/${sa.id}`, { method: 'DELETE' }); if (rr.ok) saLoadListWithCache(); } catch { showToast('Failed to delete', { error: true }); } });
      acts.append(editB, delB); row.appendChild(acts); saList.appendChild(row);
    });
  }

  saLoadListWithCache();
  return saSection;
}

function buildAgentWorkdirsCard(actor) {
  const card = document.createElement('section');
  card.style.cssText = 'border:1px solid var(--h-hairline);border-radius:12px;background:var(--h-surface);overflow:hidden';

  const hdr = document.createElement('header');
  hdr.style.cssText = 'padding:13px 16px;border-bottom:1px solid var(--h-hair-soft);background:color-mix(in srgb, var(--h-bg) 38%, var(--h-surface));display:flex;align-items:baseline;gap:10px';
  const title = document.createElement('span'); title.style.cssText = 'font-family:var(--h-serif);font-size:16px;color:var(--h-ink)'; title.textContent = 'workdirs';
  const hint = document.createElement('span'); hint.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-faint)'; hint.textContent = 'registered working directories';
  hdr.append(title, hint);
  card.appendChild(hdr);

  const body = document.createElement('div');
  body.style.cssText = 'padding:14px 18px;min-height:48px';
  const loading = document.createElement('span'); loading.style.cssText = 'font-size:12.5px;color:var(--h-ink-faint)'; loading.textContent = 'loading…';
  body.appendChild(loading);

  fjson(`/api/actors/${actor.id}/workdirs`).then(wds => {
    body.innerHTML = '';
    if (!wds.length) {
      const em = document.createElement('span'); em.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-faint)'; em.textContent = 'no workdirs registered yet';
      body.appendChild(em); return;
    }
    const chips = document.createElement('div'); chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
    wds.forEach(wd => {
      const chip = document.createElement('span');
      chip.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:var(--h-ink-mute);padding:4px 10px;border-radius:8px;background:var(--h-slip);border:1px solid var(--h-hairline)';
      chip.textContent = wd.path || wd;
      chips.appendChild(chip);
    });
    body.appendChild(chips);
  }).catch(() => { body.innerHTML = ''; const em = document.createElement('span'); em.style.cssText = 'font-size:12.5px;color:var(--h-ink-faint)'; em.textContent = 'failed to load'; body.appendChild(em); });

  card.appendChild(body);
  return card;
}

function buildAgentMemorySection(actor) {
  const memSection = document.createElement('section');
  memSection.style.cssText = 'border:1px solid var(--h-hair-soft);border-radius:12px;overflow:hidden';

  const memHdr = document.createElement('div'); memHdr.style.cssText = 'padding:14px 18px 10px;border-bottom:1px solid var(--h-hair-soft)';
  const memTitle = document.createElement('div'); memTitle.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:15px;color:var(--h-ink)'; memTitle.textContent = 'Memory';
  const memSubtitle = document.createElement('div'); memSubtitle.style.cssText = 'font-size:12px;color:var(--h-ink-faint);margin-top:3px'; memSubtitle.textContent = 'injected into every session this agent starts';
  memHdr.append(memTitle, memSubtitle);
  memSection.appendChild(memHdr);

  const MEM_FILES = [
    { file: 'MEMORY.md', budget: 2200, hint: 'facts about this agent — roles, preferences, recurring instructions' },
    { file: 'USER.md',   budget: 1375, hint: 'context about the user and how to work with them' },
  ];

  function makeMemFileCard(file, budget, hint, initial) {
    const card = document.createElement('div'); card.style.cssText = 'padding:14px 18px;border-bottom:1px solid var(--h-hair-soft)';
    const fileHdr = document.createElement('div'); fileHdr.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px';
    const fileLbl = document.createElement('span'); fileLbl.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--h-ink)'; fileLbl.textContent = file;
    const fileHint = document.createElement('span'); fileHint.style.cssText = 'font-size:11.5px;color:var(--h-ink-faint)'; fileHint.textContent = hint;
    fileHdr.append(fileLbl, fileHint);
    const ta = document.createElement('textarea'); ta.name = 'agent-memory-' + file.replace('.', '-').toLowerCase(); ta.value = initial; ta.placeholder = `Write ${file} content here…`; ta.maxLength = budget; ta.style.cssText = 'width:100%;box-sizing:border-box;min-height:80px;resize:vertical;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;padding:8px 10px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);outline:none';
    const footer = document.createElement('div'); footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:6px';
    const counter = document.createElement('span'); counter.style.cssText = 'font-size:11.5px;color:var(--h-ink-faint);font-variant-numeric:tabular-nums';
    const updateCounter = () => { const used = ta.value.length; const pct = used / budget; counter.textContent = `${used} / ${budget}`; counter.style.color = pct > .9 ? 'var(--h-red)' : pct > .75 ? 'var(--h-amber)' : 'var(--h-ink-faint)'; };
    updateCounter(); ta.addEventListener('input', updateCounter);
    const saveBtn = document.createElement('button'); saveBtn.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:4px 14px;cursor:pointer'; saveBtn.textContent = 'save';
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        const r = await fetch(`/api/actors/${actor.id}/memory/${encodeURIComponent(file)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: ta.value }) });
        if (r.ok) showToast(`${file} saved`);
        else { const e = await r.json().catch(() => ({})); showToast(e.error || 'Failed to save', { error: true }); }
      } catch { showToast('Failed to save', { error: true }); }
      saveBtn.disabled = false;
    };
    footer.append(counter, saveBtn);
    card.append(fileHdr, ta, footer);
    return card;
  }

  const memLoading = document.createElement('div'); memLoading.style.cssText = 'padding:14px 18px;font-size:12.5px;color:var(--h-ink-mute)'; memLoading.textContent = 'loading…';
  memSection.appendChild(memLoading);

  (async () => {
    try {
      const r = await fetch(`/api/actors/${actor.id}/memory`);
      memSection.removeChild(memLoading);
      if (!r.ok) { const err = document.createElement('div'); err.style.cssText = 'padding:14px 18px;font-size:12.5px;color:var(--h-ink-mute)'; err.textContent = 'failed to load memory'; memSection.appendChild(err); return; }
      const data = await r.json();
      const byFile = {}; (data.files || []).forEach(f => { byFile[f.file] = f.content || ''; });
      MEM_FILES.forEach(({ file, budget, hint }) => { memSection.appendChild(makeMemFileCard(file, budget, hint, byFile[file] || '')); });
      const lastCard = memSection.lastElementChild;
      if (lastCard) lastCard.style.borderBottom = 'none';
    } catch { memSection.removeChild(memLoading); const err = document.createElement('div'); err.style.cssText = 'padding:14px 18px;font-size:12.5px;color:var(--h-ink-mute)'; err.textContent = 'failed to load memory'; memSection.appendChild(err); }
  })();

  return memSection;
}

function buildAgentSystemPromptSection(actor) {
  const section = document.createElement('section');
  section.style.cssText = 'border:1px solid var(--h-hair-soft);border-radius:12px;overflow:hidden';

  const hdr = document.createElement('div');
  hdr.style.cssText = 'padding:13px 16px;border-bottom:1px solid var(--h-hair-soft);background:color-mix(in srgb, var(--h-bg) 38%, var(--h-surface));display:flex;align-items:baseline;gap:10px';
  const title = document.createElement('span');
  title.style.cssText = 'font-family:var(--h-serif);font-size:16px;color:var(--h-ink)';
  title.textContent = 'System Prompt';
  const hint = document.createElement('span');
  hint.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-faint)';
  hint.textContent = 'identity and instructions injected into every session';
  hdr.append(title, hint);
  section.appendChild(hdr);

  const body = document.createElement('div');
  body.style.cssText = 'padding:14px 18px';
  const loading = document.createElement('div');
  loading.style.cssText = 'font-size:12.5px;color:var(--h-ink-faint)';
  loading.textContent = 'loading…';
  body.appendChild(loading);
  section.appendChild(body);

  (async () => {
    try {
      const r = await fetch(`/api/actors/${actor.id}/system-prompt`);
      body.removeChild(loading);
      let currentValue = '';
      if (r.ok) { const d = await r.json(); currentValue = d.system_prompt || ''; }

      const ta = document.createElement('textarea');
      ta.name = 'agent-system-prompt';
      ta.value = currentValue;
      ta.placeholder = 'You are a senior backend developer…';
      ta.maxLength = 65536;
      ta.style.cssText = 'width:100%;box-sizing:border-box;min-height:140px;resize:vertical;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;padding:10px 12px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);outline:none';

      const footer = document.createElement('div');
      footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:8px';
      const counter = document.createElement('span');
      counter.style.cssText = 'font-size:11.5px;color:var(--h-ink-faint);font-variant-numeric:tabular-nums';
      const updateCounter = () => {
        const used = ta.value.length; const pct = used / 65536;
        counter.textContent = `${used} / 65536`;
        counter.style.color = pct > .9 ? 'var(--h-red)' : pct > .75 ? 'var(--h-amber)' : 'var(--h-ink-faint)';
      };
      updateCounter(); ta.addEventListener('input', updateCounter);

      const saveBtn = document.createElement('button');
      saveBtn.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:4px 14px;cursor:pointer';
      saveBtn.textContent = 'save';
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try {
          const res = await fetch(`/api/actors/${actor.id}/system-prompt`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ system_prompt: ta.value.trim() || null }),
          });
          if (res.ok) showToast('System prompt saved');
          else { const e = await res.json().catch(() => ({})); showToast(e.error || 'Failed to save', { error: true }); }
        } catch { showToast('Failed to save', { error: true }); }
        saveBtn.disabled = false;
      };

      footer.append(counter, saveBtn);
      body.append(ta, footer);
    } catch {
      body.innerHTML = '';
      const err = document.createElement('div'); err.style.cssText = 'font-size:12.5px;color:var(--h-ink-faint)'; err.textContent = 'failed to load system prompt';
      body.appendChild(err);
    }
  })();

  return section;
}
