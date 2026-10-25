// ── Server update (Settings → server) ────────────────────────────────────────
let sUpdateStatus = null;
let sUpdateChecking = false;
let sUpdateLoadFailed = false;

const S_UPDATE_SEEN_KEY = 'stoa-update-seen-result';
const S_UPDATE_STEPS = [
  ['fetch', 'fetch'],
  ['merge', 'apply commits'],
  ['install', 'install dependencies'],
  ['smoke', 'test boot'],
  ['restart', 'restart'],
];
const S_UPDATE_UNSUPPORTED_TEXT = {
  not_git: 'this install is not a git checkout, so it has to be updated by hand.',
  docker: 'running in docker. pull the new image instead.',
  no_process_manager: 'no process manager (launchd, pm2, systemd, supervisord) to bring the server back after the update.',
};
const S_UPDATE_BLOCKER_TEXT = {
  not_default_branch: 'the checkout is on another branch. switch back to the default branch to update.',
  dirty_tree: 'the working tree has uncommitted changes.',
  diverged: 'there are local commits that are not on origin, so it cannot fast-forward.',
  up_to_date: 'already up to date.',
};

function sUpdateEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function sUpdateVersionLabel(v) {
  if (!v) return '—';
  return [v.version ? 'v' + v.version : null, v.sha].filter(Boolean).join(' · ');
}

function sUpdateTimeLabel(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return 'never';
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// First blocker other than up_to_date wins; up_to_date only matters when nothing else is wrong.
function sUpdateBlockReason(s) {
  if (!s) return null;
  if (!s.supported) return S_UPDATE_UNSUPPORTED_TEXT[s.reason] || s.reason || 'updates are not supported here.';
  const blockers = Array.isArray(s.blockers) ? s.blockers : [];
  const code = blockers.find(b => b !== 'up_to_date') || blockers[0];
  if (code) return S_UPDATE_BLOCKER_TEXT[code] || code;
  if (!(s.behind > 0)) return S_UPDATE_BLOCKER_TEXT.up_to_date;
  return null;
}

function sUpdateIsBusy(s) {
  const st = s?.update?.state;
  return st === 'running' || st === 'restarting';
}

function sUpdateRenderBadge() {
  const nav = document.getElementById('nav-server');
  if (!nav) return;
  const has = sUpdateStatus?.behind > 0;
  nav.classList.toggle('has-update', !!has);
  const label = has ? 'Server, update available' : 'Server';
  nav.title = label;
  nav.setAttribute('aria-label', label);
}

async function sUpdateFetchStatus() {
  try {
    const r = await fetch('/api/server/update/status');
    if (!r.ok) throw new Error(String(r.status));
    sUpdateLoadFailed = false;
    sUpdateApply(await r.json());
  } catch {
    sUpdateLoadFailed = true;
    if (!sUpdateStatus) sRenderUpdateCard();
  }
}

function sUpdateApply(status) {
  sUpdateStatus = status;
  sUpdateRenderBadge();
  sRenderUpdateCard();
  sUpdateNotifyLastResult();
}

// last_result is persisted server-side across restarts; remember its timestamp so the outcome is announced once.
function sUpdateNotifyLastResult() {
  const res = sUpdateStatus?.update?.last_result;
  if (!res?.at) return;
  let seen = null;
  try { seen = localStorage.getItem(S_UPDATE_SEEN_KEY); } catch {}
  if (seen === res.at) return;
  try { localStorage.setItem(S_UPDATE_SEEN_KEY, res.at); } catch {}
  if (res.rolled_back) {
    showToast(`update rolled back to ${res.from || 'the previous version'}${res.error ? ': ' + res.error : ''}`, { error: true, duration: 10000 });
  } else if (res.ok) {
    showToast(`stoa updated to ${sUpdateVersionLabel(sUpdateStatus.current)}`);
  }
}

function sUpdateRow(label, value) {
  const row = sUpdateEl('div', 's-server-field');
  row.appendChild(sUpdateEl('span', 's-server-field-label', label));
  if (value instanceof Node) row.appendChild(value);
  else row.appendChild(sUpdateEl('span', 's-update-value', value));
  return row;
}

function sUpdateMakeProgress(u) {
  const list = sUpdateEl('ol', 's-update-steps');
  list.setAttribute('aria-label', 'update progress');
  const idx = S_UPDATE_STEPS.findIndex(([k]) => k === u.step);
  S_UPDATE_STEPS.forEach(([key, label], i) => {
    const li = sUpdateEl('li', 's-update-step', label);
    if (idx >= 0 && i < idx) li.classList.add('is-done');
    if (i === idx) {
      li.classList.add(u.state === 'failed' ? 'is-failed' : 'is-current');
      li.setAttribute('aria-current', 'step');
    }
    list.appendChild(li);
  });
  return list;
}

function sRenderUpdateCard() {
  const body = document.getElementById('s-update-body');
  if (!body) return;
  const s = sUpdateStatus;
  body.replaceChildren();
  if (!s) {
    body.appendChild(sUpdateEl('div', 's-update-note', sUpdateLoadFailed ? 'update status unavailable.' : 'loading…'));
    return;
  }
  const u = s.update || {};
  const busy = sUpdateIsBusy(s);

  body.appendChild(sUpdateRow('installed', sUpdateVersionLabel(s.current)));

  const latest = sUpdateEl('span', 's-update-value', sUpdateVersionLabel(s.latest));
  if (s.behind > 0) {
    latest.appendChild(sUpdateEl('span', 's-update-behind', `${s.behind} new commit${s.behind === 1 ? '' : 's'}`));
  }
  body.appendChild(sUpdateRow('latest', latest));

  const checked = sUpdateEl('span', 's-update-value', sUpdateTimeLabel(s.checked_at));
  const checkBtn = sUpdateEl('button', 's-update-btn', sUpdateChecking ? 'checking…' : 'check now');
  checkBtn.type = 'button';
  checkBtn.disabled = sUpdateChecking || busy;
  checkBtn.onclick = sUpdateCheckNow;
  const checkedRow = sUpdateRow('last checked', checked);
  checkedRow.appendChild(checkBtn);
  body.appendChild(checkedRow);
  if (s.check_error) body.appendChild(sUpdateEl('div', 's-update-note is-error', `last check failed: ${s.check_error}`));

  if (u.state === 'running' || u.state === 'restarting' || (u.state === 'failed' && u.step)) {
    body.appendChild(sUpdateMakeProgress(u));
  }
  if (u.state === 'failed' && u.error) {
    body.appendChild(sUpdateEl('div', 's-update-note is-error', u.error));
  }
  const last = u.last_result;
  if (last && !last.ok && u.state !== 'failed') {
    const when = sUpdateTimeLabel(last.at);
    const what = last.rolled_back ? `last update rolled back (${when})` : `last update failed (${when})`;
    body.appendChild(sUpdateEl('div', 's-update-note is-warn', last.error ? `${what}: ${last.error}` : what));
  }

  const action = sUpdateEl('div', 's-server-field s-update-action');
  const reason = busy
    ? (u.state === 'restarting' ? 'restarting the server…' : 'updating…')
    : sUpdateBlockReason(s);
  const reasonEl = sUpdateEl('span', 's-update-reason', reason || 'the server will restart after the update.');
  reasonEl.id = 's-update-reason';
  action.appendChild(reasonEl);
  const updBtn = sUpdateEl('button', 's-server-save', 'update…');
  updBtn.type = 'button';
  updBtn.disabled = busy || !!reason;
  updBtn.setAttribute('aria-describedby', 's-update-reason');
  updBtn.onclick = sUpdateOpenConfirm;
  action.appendChild(updBtn);
  body.appendChild(action);
}

async function sUpdateCheckNow() {
  if (sUpdateChecking) return;
  sUpdateChecking = true;
  sRenderUpdateCard();
  try {
    const r = await fetch('/api/server/update/check', { method: 'POST' });
    const data = await r.json().catch(() => null);
    if (!r.ok) showToast(data?.error || 'update check failed', { error: true });
    else if (data) sUpdateStatus = data;
  } catch {
    showToast('update check failed', { error: true });
  }
  sUpdateChecking = false;
  sUpdateRenderBadge();
  sRenderUpdateCard();
}

// ── Confirm dialog (native <dialog>: focus trap + Esc come with showModal) ──
function sUpdateDialogEl() {
  let dlg = document.getElementById('s-update-dialog');
  if (dlg) return dlg;
  dlg = sUpdateEl('dialog', 's-update-dialog');
  dlg.id = 's-update-dialog';
  dlg.setAttribute('aria-labelledby', 's-update-dialog-title');
  dlg.addEventListener('cancel', e => { if (dlg.dataset.sending) e.preventDefault(); });
  dlg.addEventListener('close', () => dlg.replaceChildren());
  document.body.appendChild(dlg);
  return dlg;
}

function sUpdateDialogFrame(title, lead) {
  const dlg = sUpdateDialogEl();
  const wrap = sUpdateEl('div', 's-update-dlg');
  const h = sUpdateEl('h2', 's-update-dlg-title', title);
  h.id = 's-update-dialog-title';
  wrap.appendChild(h);
  if (lead) wrap.appendChild(sUpdateEl('p', 's-update-dlg-lead', lead));
  dlg.replaceChildren(wrap);
  return { dlg, wrap };
}

function sUpdateDialogActions(wrap, confirmLabel, onConfirm) {
  const err = sUpdateEl('p', 's-update-note is-error');
  err.hidden = true;
  err.setAttribute('role', 'alert');
  const row = sUpdateEl('div', 's-update-dlg-actions');
  const cancel = sUpdateEl('button', 's-update-btn', 'cancel');
  cancel.type = 'button';
  cancel.onclick = () => sUpdateDialogEl().close();
  const ok = sUpdateEl('button', 's-server-save', confirmLabel);
  ok.type = 'button';
  ok.onclick = () => onConfirm(ok, err);
  row.append(cancel, ok);
  wrap.append(err, row);
  return ok;
}

function sUpdateOpenConfirm() {
  const s = sUpdateStatus;
  if (!s) return;
  const n = s.behind || 0;
  const { dlg, wrap } = sUpdateDialogFrame(
    `update to ${sUpdateVersionLabel(s.latest)}?`,
    `${n} new commit${n === 1 ? '' : 's'} on ${s.branch || 'the default branch'}.`
  );
  const commits = Array.isArray(s.commits) ? s.commits : [];
  if (commits.length) {
    const list = sUpdateEl('ul', 's-update-commits');
    for (const c of commits) {
      const li = sUpdateEl('li', 's-update-commit');
      li.append(sUpdateEl('code', 's-update-commit-sha', String(c.sha || '').slice(0, 7)),
                sUpdateEl('span', 's-update-commit-subject', String(c.subject || '')));
      list.appendChild(li);
    }
    wrap.appendChild(list);
    if (n > commits.length) wrap.appendChild(sUpdateEl('p', 's-update-dlg-more', `and ${n - commits.length} more`));
  }
  wrap.appendChild(sUpdateEl('p', 's-update-dlg-warn',
    'the new version gets a test boot first; if anything fails it rolls back and the server keeps running. if it passes, the server restarts and every agent connection drops and reconnects.'));
  const ok = sUpdateDialogActions(wrap, 'update and restart', (btn, err) => sUpdateStart(false, btn, err));
  if (!dlg.open) dlg.showModal();
  ok.focus();
}

function sUpdateOpenForce(activeRuns) {
  const n = Number(activeRuns) || 0;
  const { dlg, wrap } = sUpdateDialogFrame(
    `${n} agent${n === 1 ? ' is' : 's are'} still running`,
    'updating restarts the server, which interrupts those runs. update anyway?'
  );
  const ok = sUpdateDialogActions(wrap, 'update anyway', (btn, err) => sUpdateStart(true, btn, err));
  if (!dlg.open) dlg.showModal();
  ok.focus();
}

async function sUpdateStart(force, btn, errEl) {
  const dlg = sUpdateDialogEl();
  btn.disabled = true;
  errEl.hidden = true;
  dlg.dataset.sending = '1';
  let r, data;
  try {
    r = await fetch('/api/server/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: !!force }),
    });
    data = await r.json().catch(() => null);
  } catch {
    data = { error: 'could not reach the server' };
  }
  delete dlg.dataset.sending;
  if (r?.status === 202 || (r?.ok && data?.ok)) {
    dlg.close();
    if (sUpdateStatus) {
      sUpdateStatus.update = { ...(sUpdateStatus.update || {}), state: 'running', step: null, error: null };
      sRenderUpdateCard();
    }
    return;
  }
  if (r?.status === 409 && data?.code === 'active_runs' && !force) {
    sUpdateOpenForce(data.active_runs);
    return;
  }
  btn.disabled = false;
  errEl.textContent = data?.error || `update failed (${r?.status || 'network error'})`;
  errEl.hidden = false;
  if (r?.status === 409 || r?.status === 400) sUpdateFetchStatus();
}

// ── WebSocket events (global socket) ──
function sHandleUpdateAvailable(msg) {
  sUpdateStatus = { ...(sUpdateStatus || {}), latest: msg.latest, behind: msg.behind };
  sUpdateRenderBadge();
  if (sUpdateStatus.supported !== undefined) sRenderUpdateCard();
  else sUpdateFetchStatus();
}

function sHandleUpdateProgress(msg) {
  if (!sUpdateStatus) { sUpdateFetchStatus(); return; }
  sUpdateStatus.update = {
    ...(sUpdateStatus.update || {}),
    state: msg.state, step: msg.step ?? null, error: msg.error ?? null,
  };
  sRenderUpdateCard();
  if (msg.state === 'failed') sUpdateFetchStatus();
}
