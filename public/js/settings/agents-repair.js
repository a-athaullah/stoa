// Stale login session (env_unhealthy) banner and the Repair flow (`pm2 update` on the server's machine).

// actorId -> { reason, repairable } — only unhealthy agents are kept. Fed by /api/actors, actor_status, agent_env_status.
const sEnvHealth = new Map();
// actorId -> { state: 'requested'|'running', wentOffline? } — fed by agent_repair_status and actor_status.repair_state
const sRepairState = new Map();
const S_REPAIR_ACTIVE = new Set(['requested', 'running']);
const S_ENV_REASON_MAX = 200;
const S_REPAIR_ERRORS = {
  agent_offline: 'The agent is offline — nothing to repair right now',
  not_unhealthy: 'The agent no longer reports a stale login session',
  not_local: 'This agent runs on another machine — run pm2 update there',
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

function _setEnvHealth(actorId, unhealthy, reason, repairable) {
  if (unhealthy) sEnvHealth.set(actorId, { reason: _envReason(reason), repairable: !!repairable });
  else sEnvHealth.delete(actorId);
  const env = sEnvHealth.get(actorId);
  _patchActorRows(actorId, { env_unhealthy: !!env, env_unhealthy_reason: env?.reason ?? null, repairable: !!env?.repairable });
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
  for (const id of sRepairState.keys()) if (id !== actorId) return true;
  return false;
}

// Seeds from a full actor row (/api/actors or the connect broadcast). A payload without the key says nothing.
function sSeedEnvFromActor(actor) {
  if (!actor || !Number.isInteger(actor.id)) return;
  if ('env_unhealthy' in actor) _setEnvHealth(actor.id, actor.online !== false && actor.env_unhealthy, actor.env_unhealthy_reason, actor.repairable);
  if ('repair_state' in actor && !sRepairState.has(actor.id) && S_REPAIR_ACTIVE.has(actor.repair_state)) _setRepairEntry(actor.id, actor.repair_state);
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
  if (env.repairable) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 's-env-repair-btn';
    btn.dataset.repairActor = actor.id;
    btn.textContent = 'Repair';
    const busy = _repairBusyElsewhere(actor.id);
    btn.disabled = busy;
    if (busy) btn.title = 'Another repair is running';
    btn.addEventListener('click', () => _showRepairConfirm(actor.id));
    const hint = document.createElement('span');
    hint.className = 's-env-banner-hint';
    hint.textContent = 'Runs pm2 update on this machine, which restarts every agent on it.';
    foot.append(btn, hint);
  } else {
    const hint = document.createElement('span');
    hint.className = 's-env-banner-hint';
    hint.textContent = 'This agent is not on the Stoa server\'s machine. On its machine, run pm2 update from a fresh terminal.';
    foot.appendChild(hint);
  }
  el.appendChild(foot);
}

function _renderEnvUi(actorId) {
  const actor = allActors.find(a => a.id === actorId) || settingsActors.find(a => a.id === actorId) || { id: actorId };
  document.querySelectorAll(`.s-env-banner[data-env-actor="${actorId}"]`).forEach(el => _fillEnvBanner(el, actor));
}

// Repair is global on the server, so every banner's button has to follow any state change.
function _renderAllEnvUi() {
  document.querySelectorAll('.s-env-banner[data-env-actor]').forEach(el => _renderEnvUi(Number(el.dataset.envActor)));
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
  const env = sEnvHealth.get(actorId);
  // State may have moved while the notice was open (WS update, agent went offline or healed).
  if (!env?.repairable || sRepairState.size) { _renderAllEnvUi(); return; }
  document.querySelectorAll(`.s-env-repair-btn[data-repair-actor="${actorId}"]`).forEach(b => { b.disabled = true; });
  try {
    const r = await fetch(`/api/actors/${actorId}/repair`, { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401) showLogin();
      if (data.error === 'not_unhealthy' || data.error === 'agent_offline') _setEnvHealth(actorId, false);
      showToast(data.message || S_REPAIR_ERRORS[data.error] || data.error || 'Failed to request repair', { error: true });
      return;
    }
    // A WS update may land before this response; never overwrite a newer state with 'requested'.
    if (!sRepairState.has(actorId)) _setRepairEntry(actorId, S_REPAIR_ACTIVE.has(data.repair_state) ? data.repair_state : 'requested');
  } catch { showToast('Failed to request repair', { error: true }); }
  finally { _renderAllEnvUi(); }
}

function sHandleEnvStatus(msg) {
  const id = Number(msg.actor_id);
  if (!Number.isInteger(id) || id <= 0 || typeof msg.env_unhealthy !== 'boolean') return;
  _setEnvHealth(id, msg.env_unhealthy, msg.reason, msg.repairable);
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
    _setEnvHealth(id, false);
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
    _setEnvHealth(actor.id, false);
    if (had) had.wentOffline = true;
  } else {
    if ('env_unhealthy' in update) _setEnvHealth(actor.id, update.env_unhealthy, update.env_unhealthy_reason, update.repairable);
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
    if ('env_unhealthy' in a) _setEnvHealth(a.id, a.online !== false && a.env_unhealthy, a.env_unhealthy_reason, a.repairable);
    if (!('repair_state' in a)) continue;
    const had = sRepairState.get(a.id);
    _setRepairEntry(a.id, a.repair_state);
    if (had && !sRepairState.has(a.id) && a.online) showToast(`Repair finished — ${a.name || 'Agent'} is back online`);
  }
  _renderAllEnvUi();
}
