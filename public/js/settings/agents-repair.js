// Stale login session (env_unhealthy) banner and the Repair flow (`pm2 update` on the server's machine).

// actorId -> { reason } — only agents that report a stale login session. Fed by /api/actors, actor_status, agent_env_status.
const sEnvHealth = new Map();
// actorId -> { repairable, block } — every agent the server described, healthy or not (Repair is also a manual action).
const sRepairAvail = new Map();
// actorId -> { state: 'requested'|'running', wentOffline? } — fed by agent_repair_status and actor_status.repair_state
const sRepairState = new Map();
// actorId whose POST /repair is in flight: one request at a time, whichever button sent it.
let sRepairSending = null;
const S_REPAIR_ACTIVE = new Set(['requested', 'running']);
const S_ENV_REASON_MAX = 200;
const S_REPAIR_BLOCKS = new Set(['agent_offline', 'not_local', 'not_supervised']);
const S_REPAIR_BLOCK_HINTS = {
  agent_offline: 'The agent is offline — nothing to repair right now.',
  not_local: 'This agent is not on the Stoa server\'s machine. On its machine, run pm2 update from a fresh terminal.',
  not_supervised: 'This agent is not running under PM2, so Repair cannot restart it. Stop it and start it again from a fresh terminal on its machine.',
};
const S_REPAIR_BLOCK_FALLBACK = 'Repair is not available for this agent. Restart it from a fresh terminal on its machine.';
const S_REPAIR_BLOCK_TITLES = {
  agent_offline: 'Offline — nothing to repair',
  not_local: 'Repair unavailable — this agent runs on another machine (run pm2 update there)',
  not_supervised: 'Repair unavailable — not running under PM2',
};
const S_REPAIR_TITLE = 'Repair login session — runs pm2 update, which restarts every agent on this machine';
const S_REPAIR_ERRORS = {
  agent_offline: 'The agent is offline — nothing to repair right now',
  not_local: 'This agent runs on another machine — run pm2 update there',
  not_supervised: 'This agent is not running under PM2, so pm2 update cannot bring it back — restart it from a Terminal on its machine',
  repair_in_progress: 'A repair is already running or just finished — try again in a moment',
};

function _envReason(v) {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, S_ENV_REASON_MAX) : null;
}

// Re-renders seed from the actor rows, so the rows must never hold an older state than the maps.
function _patchActorRows(actorId, fields) {
  for (const list of [allActors, settingsActors]) {
    const a = list?.find(x => x.id === actorId);
    if (a) Object.assign(a, fields);
  }
}

function _repairBlock(v) {
  return S_REPAIR_BLOCKS.has(v) ? v : null;
}

// f: { online, env_unhealthy?, reason?, repairable?, repair_block? }. A missing key says nothing about that field.
// An offline agent has no session to repair (the server forgets env health on disconnect).
function _applyEnvFields(actorId, f) {
  if (!f.online) {
    sEnvHealth.delete(actorId);
    sRepairAvail.set(actorId, { repairable: false, block: 'agent_offline' });
  } else {
    if (typeof f.env_unhealthy === 'boolean') {
      if (f.env_unhealthy) sEnvHealth.set(actorId, { reason: _envReason(f.reason) });
      else sEnvHealth.delete(actorId);
    }
    if ('repairable' in f) sRepairAvail.set(actorId, { repairable: !!f.repairable, block: f.repairable ? null : _repairBlock(f.repair_block) });
  }
  const env = sEnvHealth.get(actorId);
  const avail = sRepairAvail.get(actorId);
  _patchActorRows(actorId, { env_unhealthy: !!env, env_unhealthy_reason: env?.reason ?? null, repairable: !!avail?.repairable, repair_block: avail?.block ?? null });
}

function _envFieldsFrom(src, online, reasonKey) {
  const f = { online };
  if ('env_unhealthy' in src) { f.env_unhealthy = src.env_unhealthy; f.reason = src[reasonKey]; }
  if ('repairable' in src) { f.repairable = src.repairable; f.repair_block = src.repair_block; }
  return f;
}

function _setRepairEntry(actorId, state) {
  if (S_REPAIR_ACTIVE.has(state)) {
    const prev = sRepairState.get(actorId);
    sRepairState.set(actorId, { state, wentOffline: !!prev?.wentOffline });
  } else {
    sRepairState.delete(actorId);
  }
  _patchActorRows(actorId, { repair_state: sRepairState.get(actorId)?.state ?? null });
}

function _repairBusyElsewhere(actorId) {
  if (sRepairSending !== null && sRepairSending !== actorId) return true;
  for (const id of sRepairState.keys()) if (id !== actorId) return true;
  return false;
}

// Single source for both Repair buttons (banner + detail header): same rules, same moment.
function _repairBtnState(actorId) {
  if (sRepairState.has(actorId)) return { disabled: true, active: true, title: 'Repairing the login session…' };
  if (sRepairSending === actorId) return { disabled: true, active: true, title: 'Requesting repair…' };
  const avail = sRepairAvail.get(actorId);
  if (!avail?.repairable) return { disabled: true, active: false, title: S_REPAIR_BLOCK_TITLES[avail?.block] || 'Repair is not available for this agent' };
  if (_repairBusyElsewhere(actorId)) return { disabled: true, active: false, title: 'Another repair is running' };
  return { disabled: false, active: false, title: S_REPAIR_TITLE };
}

// Seeds from a full actor row (/api/actors or the connect broadcast). A payload without the key says nothing.
function sSeedEnvFromActor(actor) {
  if (!actor || !Number.isInteger(actor.id)) return;
  if ('env_unhealthy' in actor || 'repairable' in actor) _applyEnvFields(actor.id, _envFieldsFrom(actor, actor.online !== false, 'env_unhealthy_reason'));
  if ('repair_state' in actor && !sRepairState.has(actor.id) && S_REPAIR_ACTIVE.has(actor.repair_state)) _setRepairEntry(actor.id, actor.repair_state);
}

function _syncRepairBtn(btn, actorId) {
  const st = _repairBtnState(actorId);
  btn.disabled = st.disabled;
  btn.classList.toggle('is-active', st.active);
  btn.title = st.title;
  btn.setAttribute('aria-label', st.active ? 'Repair login session: in progress' : 'Repair login session');
}

// Detail-header icon, next to restart. Always present: disabled with the reason when Repair cannot run.
function makeRepairHeaderBtn(actor, sz) {
  sSeedEnvFromActor(actor);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 's-icon-btn s-repair-btn';
  btn.dataset.repairActor = actor.id;
  btn.innerHTML = svgRepair(sz);
  _syncRepairBtn(btn, actor.id);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    _showRepairConfirm(actor.id);
  });
  return btn;
}

function buildEnvBanner(actor) {
  sSeedEnvFromActor(actor);
  const el = document.createElement('div');
  el.className = 's-env-banner';
  el.dataset.envActor = actor.id;
  _fillEnvBanner(el, actor);
  return el;
}

function _fillEnvBanner(el, actor) {
  const env = sEnvHealth.get(actor.id);
  const repair = sRepairState.get(actor.id);
  el.replaceChildren();
  el.hidden = !env && !repair;
  if (el.hidden) return;
  el.setAttribute('role', 'status');

  const title = document.createElement('div');
  title.className = 's-env-banner-title';
  title.textContent = repair ? 'Repairing the login session' : 'Login session is stale';

  const body = document.createElement('p');
  body.className = 's-env-banner-text';
  body.textContent = repair
    ? (repair.state === 'requested'
      ? 'Repair requested — starting pm2 update on this machine…'
      : 'pm2 update is running — every agent on this machine is restarting. This page updates once the agent is back.')
    : `${actor.name || 'This agent'} is still attached to a login session that no longer exists (for example after the macOS login window restarted), so anything that looks up the current user fails.`;
  el.append(title, body);

  if (!repair && env.reason) {
    const reason = document.createElement('p');
    reason.className = 's-env-banner-reason';
    const lbl = document.createElement('span');
    lbl.textContent = 'Reported: ';
    const code = document.createElement('code');
    code.textContent = env.reason;
    reason.append(lbl, code);
    el.appendChild(reason);
  }
  if (repair) return;

  const foot = document.createElement('div');
  foot.className = 's-env-banner-foot';
  const avail = sRepairAvail.get(actor.id);
  if (avail?.repairable) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 's-env-repair-btn';
    btn.dataset.repairActor = actor.id;
    btn.textContent = 'Repair';
    const st = _repairBtnState(actor.id);
    btn.disabled = st.disabled;
    if (st.disabled) btn.title = st.title;
    btn.addEventListener('click', () => _showRepairConfirm(actor.id));
    const hint = document.createElement('span');
    hint.className = 's-env-banner-hint';
    hint.textContent = 'Runs pm2 update on this machine, which restarts every agent on it.';
    foot.append(btn, hint);
  } else {
    const hint = document.createElement('span');
    hint.className = 's-env-banner-hint';
    hint.textContent = S_REPAIR_BLOCK_HINTS[avail?.block] || S_REPAIR_BLOCK_FALLBACK;
    foot.appendChild(hint);
  }
  el.appendChild(foot);
}

function _renderEnvUi(actorId) {
  const actor = allActors.find(a => a.id === actorId) || settingsActors.find(a => a.id === actorId) || { id: actorId };
  document.querySelectorAll(`.s-env-banner[data-env-actor="${actorId}"]`).forEach(el => _fillEnvBanner(el, actor));
}

// Repair is global on the server, so every banner and header button has to follow any state change.
function _renderAllEnvUi() {
  document.querySelectorAll('.s-env-banner[data-env-actor]').forEach(el => _renderEnvUi(Number(el.dataset.envActor)));
  document.querySelectorAll('.s-repair-btn[data-repair-actor]').forEach(btn => _syncRepairBtn(btn, Number(btn.dataset.repairActor)));
}

function _showRepairConfirm(actorId) {
  const el = document.getElementById('app-top-notice');
  const actor = allActors.find(a => a.id === actorId);
  if (!el || !actor) return;
  const name = actor.name || 'this agent';
  el.className = 'notice-confirm-delete';
  el.style.display = 'flex';
  el.replaceChildren();
  const msg = document.createElement('span');
  msg.style.flex = '1';
  msg.textContent = `Repair ${name}'s login session? This runs pm2 update on this machine: ALL agent processes on it restart, and any work they are running stops.`;
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px';
  const ok = document.createElement('button');
  ok.className = 'app-notice-btn-danger';
  ok.textContent = 'repair';
  ok.onclick = () => { hideAppNotice(); _requestRepair(actorId); };
  const cancel = document.createElement('button');
  cancel.className = 'app-notice-btn-cancel';
  cancel.textContent = 'cancel';
  cancel.onclick = hideAppNotice;
  btns.append(ok, cancel);
  el.append(msg, btns);
  ok.focus();
}

async function _requestRepair(actorId) {
  // State may have moved while the notice was open (WS update, agent went offline, another repair started).
  if (_repairBtnState(actorId).disabled) { _renderAllEnvUi(); return; }
  sRepairSending = actorId;
  _renderAllEnvUi();
  try {
    const r = await fetch(`/api/actors/${actorId}/repair`, { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401) showLogin();
      if (data.error === 'agent_offline') _applyEnvFields(actorId, { online: false });
      else if (S_REPAIR_BLOCKS.has(data.error)) _applyEnvFields(actorId, { online: true, repairable: false, repair_block: data.error });
      showToast(data.message || S_REPAIR_ERRORS[data.error] || data.error || 'Failed to request repair', { error: true });
      return;
    }
    // A WS update may land before this response; never overwrite a newer state with 'requested'.
    if (!sRepairState.has(actorId)) _setRepairEntry(actorId, S_REPAIR_ACTIVE.has(data.repair_state) ? data.repair_state : 'requested');
  } catch { showToast('Failed to request repair', { error: true }); }
  finally {
    sRepairSending = null;
    _renderAllEnvUi();
  }
}

function sHandleEnvStatus(msg) {
  const id = Number(msg.actor_id);
  if (!Number.isInteger(id) || id <= 0 || typeof msg.env_unhealthy !== 'boolean') return;
  _applyEnvFields(id, _envFieldsFrom(msg, true, 'reason'));
  // A finished repair is announced by agent_repair_status; here only a live state is taken.
  if (S_REPAIR_ACTIVE.has(msg.repair_state)) _setRepairEntry(id, msg.repair_state);
  _renderAllEnvUi();
}

function sHandleRepairStatus(msg) {
  const id = Number(msg.actor_id);
  const state = msg.repair_state;
  if (!Number.isInteger(id) || id <= 0 || (state !== 'done' && state !== 'failed' && !S_REPAIR_ACTIVE.has(state))) return;
  const had = sRepairState.has(id);
  _setRepairEntry(id, state);
  const name = allActors.find(x => x.id === id)?.name || 'Agent';
  if (state === 'done') {
    _applyEnvFields(id, { online: true, env_unhealthy: false });
    // The reconnect broadcast may have settled this repair already (and toasted).
    if (had) showToast(`Repair finished — ${name} is back online`);
  } else if (state === 'failed') {
    const err = typeof msg.error === 'string' && msg.error.trim() ? `: ${msg.error.trim().slice(0, 200)}` : '';
    showToast(`Repair of ${name} failed${err}`, { error: true, duration: 6000 });
  }
  _renderAllEnvUi();
}

// Mirrors sSyncRestartUi: `update` is the raw actor_status payload, `actor` the merged view.
// The server forgets env health on disconnect, so an offline agent has no stale session to show.
function sSyncEnvUi(actor, update = actor) {
  if (!actor) return;
  const had = sRepairState.get(actor.id);
  if (!actor.online) {
    _applyEnvFields(actor.id, { online: false });
    if (had) had.wentOffline = true;
  } else {
    _applyEnvFields(actor.id, _envFieldsFrom(update, true, 'env_unhealthy_reason'));
    if ('repair_state' in update) {
      if (S_REPAIR_ACTIVE.has(update.repair_state)) _setRepairEntry(actor.id, update.repair_state);
      else if (had) {
        // The 'done' event was missed (page reconnected mid-repair); the agent is back, so settle here.
        _setRepairEntry(actor.id, null);
        if (had.wentOffline) showToast(`Repair finished — ${actor.name || 'Agent'} is back online`);
      }
    }
  }
  _renderAllEnvUi();
}

// After a global WS reconnect: events may have been missed, so /api/actors is the source of truth.
function sResyncEnvHealth(actors) {
  if (!Array.isArray(actors)) return;
  for (const a of actors) {
    if (!a || !Number.isInteger(a.id)) continue;
    if ('env_unhealthy' in a || 'repairable' in a) _applyEnvFields(a.id, _envFieldsFrom(a, a.online !== false, 'env_unhealthy_reason'));
    if (!('repair_state' in a)) continue;
    const had = sRepairState.get(a.id);
    _setRepairEntry(a.id, a.repair_state);
    if (had && !sRepairState.has(a.id) && a.online) showToast(`Repair finished — ${a.name || 'Agent'} is back online`);
  }
  _renderAllEnvUi();
}
