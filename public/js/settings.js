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
  const humanList = document.getElementById('s-human-list');
  const aiList = document.getElementById('s-agents-list');
  if (humanList) humanList.innerHTML = '';
  if (aiList) aiList.innerHTML = '';
  const humans = settingsActors.filter(a => a.type === 'human');
  const agents = [...settingsActors.filter(a => a.type !== 'human')].sort((a, b) => b.id - a.id);
  for (const a of humans) {
    if (!sRowStates.has(a.id)) sRowStates.set(a.id, { state: 'default', draft: a.name });
    humanList?.appendChild(sMakeRow(a));
  }
  for (const a of agents) {
    if (!sRowStates.has(a.id)) sRowStates.set(a.id, { state: 'default', draft: a.name });
    aiList?.appendChild(sMakeRow(a));
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

function sEditGetCmd(backend, name, lang, os) {
  const base = sPublicUrl || `http://localhost:${sPort}`;
  const params = [`name=${encodeURIComponent(name || '')}`];
  if (lang && lang !== 'en') params.push(`lang=${lang}`);
  const q = '?' + params.join('&');
  const script = { unix: 'install.sh', ps: 'install.ps1', cmd: 'install.cmd' }[os];
  const url = `${base}/${script}${q}`;
  return { unix: `curl -fsSL "${url}" | bash`, ps: `irm "${url}" | iex`, cmd: `curl -fsSL "${url}" -o i.cmd && i.cmd && del i.cmd` }[os];
}

function sMakeEditAccordion(actor) {
  const cfg = (() => { try { return JSON.parse(actor.adapter_config || '{}'); } catch { return {}; } })();
  const backend = actor.adapter || 'claude';
  let editOs = sDetectOS();
  let updateCmd = () => {};

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
  beSel.className = 's-name-input'; beSel.style.cssText = 'width:auto;min-width:130px;opacity:0.6;cursor:not-allowed'; beSel.disabled = true;
  const o = document.createElement('option'); o.value = 'claude'; o.textContent = 'Claude Code CLI'; o.selected = true;
  beSel.appendChild(o);
  beGrp.append(mkFieldLbl('AI agent'), beSel);

  const langGrp = document.createElement('div');
  langGrp.className = 's-field-group'; langGrp.style.minWidth = 'auto';
  const langSel = document.createElement('select');
  langSel.className = 's-name-input'; langSel.style.cssText = 'width:auto;min-width:130px;cursor:pointer';
  Object.entries(STOA_LANGS).forEach(([code, lbl]) => {
    const o = document.createElement('option'); o.value = code; o.textContent = lbl;
    if (code === (cfg.lang || 'en')) o.selected = true;
    langSel.appendChild(o);
  });
  langSel.addEventListener('change', () => { updateCmd(); });
  langGrp.append(mkFieldLbl('language'), langSel);

  const nameGrp = document.createElement('div');
  nameGrp.className = 's-field-group';
  const nameInp = document.createElement('input');
  nameInp.className = 's-name-input'; nameInp.type = 'text'; nameInp.value = actor.name;
  nameInp.addEventListener('input', () => { updateCmd(); });
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
      updateCmd();
    });
    osPills.appendChild(p);
  });
  platGrp.append(mkFieldLbl('platform'), osPills);
  acc.appendChild(platGrp);

  // Command slip
  const slipWrap = document.createElement('div');
  const slipCaption = document.createElement('div');
  slipCaption.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-faint);margin-bottom:8px;letter-spacing:.02em';
  slipCaption.textContent = 'reinstall on the target machine';
  const slip = document.createElement('div');
  slip.className = 's-cmd-slip';
  const dollar = document.createElement('span'); dollar.className = 's-cmd-dollar'; dollar.textContent = '$';
  const cmdText = document.createElement('span'); cmdText.id = `s-eacc-cmd-${actor.id}`;
  const copyBtn = document.createElement('button');
  copyBtn.className = 's-cmd-copy'; copyBtn.title = 'Copy'; copyBtn.innerHTML = svgCopy();
  copyBtn.addEventListener('click', async () => {
    const text = document.getElementById(`s-eacc-cmd-${actor.id}`)?.textContent || '';
    if (await copyToClipboard(text)) {
      copyBtn.classList.add('copied'); copyBtn.innerHTML = svgCheck(14);
      setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.innerHTML = svgCopy(); }, 1000);
    }
  });
  slip.append(dollar, cmdText, copyBtn);
  slipWrap.append(slipCaption, slip);
  acc.appendChild(slipWrap);

  updateCmd = () => {
    const el = document.getElementById(`s-eacc-cmd-${actor.id}`);
    if (el) el.textContent = sEditGetCmd(backend, nameInp.value || actor.name, langSel.value, editOs);
  };
  updateCmd();

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
const sFinishedSlips = new Set();

function sOpenAddPanel() {
  sAddPanel = { open: true, name: '', os: sDetectOS(), lang: 'en', phase: 'waiting',
    baselineIds: new Set(settingsActors.map(a => String(a.id))), newActor: null, timer: null };
  sFinishedSlips.clear();
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
  sub.textContent = 'run the install command on the target machine';
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

  fieldRow.appendChild(langGrp); fieldRow.appendChild(nameGrp); fieldRow.appendChild(osGrp);
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
  if (sFinishedSlips.has(actorId)) return;
  sFinishedSlips.add(actorId);
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
        try { const wds = await fjson(`/api/actors/${newAI.id}/workdirs`); if (wds.length) sFinishSetupSlip(newAI.id); } catch (e) { console.error('Failed to load workdirs after connect', e); }
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
  ['agents', 'server', 'general', 'docs', 'platforms', 'automation'].forEach(t => {
    const el = document.getElementById('s-tab-' + t);
    if (el) el.style.display = t === name ? '' : 'none';
  });
  if (name === 'server')     sLoadServerTab();
  if (name === 'general')    sLoadGeneralTab();
  if (name === 'docs')       sLoadDocsTab();
  if (name === 'platforms')   sLoadPlatformsTab();
  if (name === 'automation') sLoadAutomationTab();
}

// ── Docs tab ─────────────────────────────────────────────────────────────────
let docsLang    = localStorage.getItem('stoa-docs-lang') || 'en';
let docsCatalog = [];   // [{ slug, title, langs }]
let docsActiveSlug = null;

async function sLoadDocsTab() {
  try {
    docsCatalog = await fjson('/api/docs');
    sRenderDocsLangRow();
    sRenderDocsSidebar();
  } catch { showToast('Failed to load docs', { error: true }); }
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

// ── Platforms tab ────────────────────────────────────────────────────────────
async function sLoadPlatformsTab() {
  const container = document.getElementById('s-platforms-list');
  if (!container) return;
  container.innerHTML = '';
  const addPanel = document.getElementById('s-add-platform-panel');
  if (addPanel) addPanel.innerHTML = '';
  let platforms;
  try { platforms = await fjson('/api/ai/platforms'); } catch { showToast('Failed to load platforms', { error: true }); return; }

  if (!platforms.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:16px 18px;font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)';
    empty.textContent = 'No external platforms configured. Claude models are available by default.';
    container.appendChild(empty);
  }

  for (const p of platforms) {
    const card = document.createElement('div');
    card.className = 's-server-field';
    card.style.cssText = 'flex-wrap:wrap;gap:8px;padding:12px 18px;border-bottom:1px solid var(--h-hair-soft)';
    card.id = 's-platform-' + p.id;

    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'font-family:var(--h-serif);font-size:14px;color:var(--h-ink);min-width:100px';
    nameEl.textContent = p.name;

    const urlEl = document.createElement('span');
    urlEl.style.cssText = 'font-family:ui-monospace,monospace;font-size:12px;color:var(--h-ink-faint);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const keyCount = p.api_keys?.length || (p.api_key ? 1 : 0);
    const totalModels = p.cached_models?.length || 0;
    const enabledCount = Array.isArray(p.enabled_models) ? p.enabled_models.length : totalModels;
    const modelInfo = totalModels ? ` · ${enabledCount === totalModels ? totalModels + ' models' : enabledCount + '/' + totalModels + ' enabled'}` : '';
    urlEl.textContent = (p.base_url || '—') + (keyCount > 1 ? ` · ${keyCount} keys` : '') + modelInfo;

    const btnWrap = document.createElement('span');
    btnWrap.style.cssText = 'display:flex;gap:6px;align-items:center';

    const editBtn = document.createElement('button');
    editBtn.className = 's-icon-btn'; editBtn.title = 'Edit'; editBtn.innerHTML = svgPencil(13);
    editBtn.addEventListener('click', () => sEditPlatform(p));
    const delBtn = document.createElement('button');
    delBtn.className = 's-icon-btn'; delBtn.title = 'Delete'; delBtn.innerHTML = svgX(13);
    delBtn.addEventListener('click', () => sDeletePlatform(p.id));
    btnWrap.append(editBtn, delBtn);

    card.append(nameEl, urlEl, btnWrap);
    container.appendChild(card);
  }

  const addPlatBtn = document.getElementById('s-add-platform-btn');
  if (addPlatBtn) addPlatBtn.onclick = () => sShowPlatformForm();
}

function sShowPlatformForm(existing) {
  const container = document.getElementById('s-platforms-list');
  if (!container) return;
  if (document.getElementById('s-platform-form')) document.getElementById('s-platform-form').remove();

  const form = document.createElement('div');
  form.id = 's-platform-form';
  form.style.cssText = 'padding:14px 18px;border-bottom:1px solid var(--h-hair-soft);display:flex;flex-direction:column;gap:10px';

  const mkField = (label, type, value, placeholder) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);min-width:70px';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.className = 's-server-input'; inp.type = type; inp.value = value || ''; inp.placeholder = placeholder || '';
    inp.autocomplete = 'off'; inp.setAttribute('data-1p-ignore', ''); inp.setAttribute('data-lpignore', 'true');
    inp.style.flex = '1';
    row.append(lbl, inp);
    return { row, inp };
  };

  const vendor = 'ollama';

  const nameF = mkField('name', 'text', existing?.name, 'e.g. Ollama Cloud');
  const urlF = mkField('base url', 'url', existing?.base_url, 'http://localhost:11434');

  const urlHint = document.createElement('div');
  urlHint.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:11px;color:var(--h-ink-mute);padding:0 0 0 80px;margin-top:-4px';
  urlHint.textContent = 'local Ollama daemon — handles routing to cloud models';

  const keysRow = document.createElement('div');
  keysRow.style.cssText = 'display:flex;align-items:flex-start;gap:10px';
  const keysLbl = document.createElement('span');
  keysLbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);min-width:70px;padding-top:6px';
  keysLbl.textContent = 'api keys';
  const keysWrap = document.createElement('div');
  keysWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:6px';
  const keysList = document.createElement('div');
  keysList.style.cssText = 'display:flex;flex-direction:column;gap:4px';
  const keyStore = [];
  const existingKeys = existing?.api_keys || (existing?.api_key ? [existing.api_key] : []);

  function renderKeyPill(key, idx) {
    const pill = document.createElement('div');
    pill.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;background:var(--h-surface-raised,rgba(255,255,255,.06));font-family:ui-monospace,monospace;font-size:11.5px;color:var(--h-ink-faint)';
    const label = document.createElement('span');
    label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    label.textContent = (idx === 0 ? '① ' : idx === 1 ? '② ' : '③ ') + key;
    const rmBtn = document.createElement('button');
    rmBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--h-ink-mute);padding:0;line-height:1';
    rmBtn.innerHTML = svgX(11);
    rmBtn.title = 'Remove';
    rmBtn.addEventListener('click', () => {
      const i = keyStore.indexOf(key);
      if (i !== -1) keyStore.splice(i, 1);
      refreshKeys();
    });
    pill.append(label, rmBtn);
    return pill;
  }

  function refreshKeys() {
    keysList.innerHTML = '';
    keyStore.forEach((k, i) => keysList.appendChild(renderKeyPill(k, i)));
  }

  existingKeys.forEach(k => keyStore.push(k));
  refreshKeys();

  const addRow = document.createElement('div');
  addRow.style.cssText = 'display:flex;gap:6px';
  const keyInp = document.createElement('input');
  keyInp.className = 's-server-input'; keyInp.type = 'text'; keyInp.placeholder = 'sk-...';
  keyInp.autocomplete = 'off'; keyInp.setAttribute('data-1p-ignore', ''); keyInp.setAttribute('data-lpignore', 'true');
  keyInp.style.cssText = 'flex:1;font-family:ui-monospace,monospace;font-size:12px';
  const addKeyBtn = document.createElement('button');
  addKeyBtn.className = 's-icon-btn'; addKeyBtn.title = 'Add key';
  addKeyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>';
  addKeyBtn.style.cssText = 'flex-shrink:0';
  addKeyBtn.addEventListener('click', () => {
    const v = keyInp.value.trim();
    if (!v) return;
    keyStore.push(v);
    keyInp.value = '';
    refreshKeys();
  });
  keyInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addKeyBtn.click(); } });
  addRow.append(keyInp, addKeyBtn);

  keysWrap.append(keysList, addRow);
  keysRow.append(keysLbl, keysWrap);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding-top:4px';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 's-server-save'; cancelBtn.textContent = 'cancel';
  cancelBtn.style.cssText = 'background:transparent;color:var(--h-ink-faint)';
  cancelBtn.addEventListener('click', () => form.remove());

  const healthBtn = document.createElement('button');
  healthBtn.className = 's-server-save'; healthBtn.textContent = 'discover models';
  healthBtn.style.cssText = 'background:transparent;color:var(--h-ink-faint)';

  const saveBtn = document.createElement('button');
  saveBtn.className = 's-server-save'; saveBtn.textContent = existing ? 'update' : 'add';
  saveBtn.addEventListener('click', async () => {
    const name = nameF.inp.value.trim();
    const base_url = urlF.inp.value.trim();

    const pending = keyInp.value.trim();
    if (pending && !keyStore.includes(pending)) { keyStore.push(pending); keyInp.value = ''; refreshKeys(); }
    const api_keys = [...keyStore];
    if (!name) { showToast('Name is required', { error: true }); return; }
    if (!base_url) { showToast('Base URL is required', { error: true }); return; }
    try {
      if (existing) {
        const resp = await fetch(`/api/ai/platforms/${encodeURIComponent(existing.id)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, base_url, api_keys, vendor }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          showToast(err.error || 'Failed to update platform', { error: true }); return;
        }
      } else {
        const resp = await fetch('/api/ai/platforms', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, base_url, api_keys, vendor }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          showToast(err.error || 'Failed to add platform', { error: true }); return;
        }
      }
      sLoadPlatformsTab();
      fetchPlatformModels();
    } catch { showToast('Failed to save platform', { error: true }); }
  });

  const progressWrap = document.createElement('div');
  progressWrap.style.cssText = 'display:none;flex-direction:column;gap:4px;padding:6px 0';
  const progressLabel = document.createElement('div');
  progressLabel.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:11px;color:var(--h-ink-mute)';
  const progressTrack = document.createElement('div');
  progressTrack.style.cssText = 'height:6px;background:var(--h-rule, rgba(0,0,0,0.1));border-radius:3px;overflow:hidden';
  const progressBar = document.createElement('div');
  progressBar.style.cssText = 'height:100%;width:0%;background:var(--h-ink, #333);transition:width 120ms ease';
  progressTrack.appendChild(progressBar);
  progressWrap.append(progressLabel, progressTrack);

  healthBtn.addEventListener('click', async () => {
    const id = existing?.id;
    if (!id) { showToast('Save the platform first, then discover', { error: true }); return; }
    healthBtn.disabled = true;
    healthBtn.textContent = 'discovering...';
    progressWrap.style.display = 'flex';
    progressLabel.textContent = 'fetching model list...';
    progressBar.style.width = '0%';
    let usable = 0, tested = 0;
    try {
      const resp = await fetch(`/api/ai/platforms/${encodeURIComponent(id)}/discover-models`, { method: 'POST' });
      if (!resp.ok || !resp.body) throw new Error('http ' + resp.status);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'start') {
            tested = ev.total;
            progressLabel.textContent = `probing 0 / ${tested} models...`;
          } else if (ev.type === 'progress') {
            if (ev.ok) usable++;
            const pct = Math.round((ev.done / ev.total) * 100);
            progressBar.style.width = pct + '%';
            progressLabel.textContent = `probing ${ev.done} / ${ev.total} — ${usable} usable so far`;
          } else if (ev.type === 'done') {
            progressBar.style.width = '100%';
            progressLabel.textContent = `done — ${ev.usable.length} of ${ev.tested} usable`;
            showToast(`Discovered ${ev.usable.length} of ${ev.tested} usable models`);
            const wrap = document.getElementById('s-model-checklist-wrap');
            const prevEnabled = existing?.enabled_models ?? null;
            if (prevEnabled) {
              const newNames = new Set(ev.usable.map(m => typeof m === 'string' ? m : m.model));
              const pruned = prevEnabled.filter(n => newNames.has(n));
              if (wrap) sRenderModelChecklist(wrap, ev.usable, pruned.length ? pruned : null, id);
            } else {
              if (wrap) sRenderModelChecklist(wrap, ev.usable, null, id);
            }
          } else if (ev.type === 'error') {
            throw new Error(ev.message || 'discovery failed');
          }
        }
      }
      fetchPlatformModels();
    } catch (e) {
      progressLabel.textContent = 'discovery failed';
      showToast(e.message || 'Discovery failed', { error: true });
    }
    setTimeout(() => { progressWrap.style.display = 'none'; }, 1800);
    healthBtn.textContent = 'discover models'; healthBtn.disabled = false;
  });

  btnRow.append(cancelBtn, healthBtn, saveBtn);

  const modelSection = document.createElement('div');
  modelSection.id = 's-model-checklist-wrap';
  if (existing?.cached_models?.length) {
    sRenderModelChecklist(modelSection, existing.cached_models, existing.enabled_models ?? null, existing.id);
  }

  form.append(nameF.row, urlF.row, urlHint, keysRow, progressWrap, modelSection, btnRow);

  if (existing) {
    const card = document.getElementById('s-platform-' + existing.id);
    if (card) { card.style.display = 'none'; card.after(form); }
    else container.appendChild(form);
    cancelBtn.addEventListener('click', () => { if (card) card.style.display = ''; });
  } else {
    const addPanel = document.getElementById('s-add-platform-panel');
    if (addPanel) addPanel.appendChild(form);
    else container.appendChild(form);
  }
}

function sEditPlatform(platform) {
  if (document.getElementById('s-platform-form')) {
    const prev = document.getElementById('s-platform-form');
    const hiddenCard = prev.previousElementSibling;
    if (hiddenCard?.style.display === 'none') hiddenCard.style.display = '';
    prev.remove();
  }
  sShowPlatformForm(platform);
}

function sRenderModelChecklist(container, cachedModels, enabledModels, platformId) {
  container.innerHTML = '';
  if (!cachedModels?.length) return;

  const enabledSet = Array.isArray(enabledModels) ? new Set(enabledModels) : null;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'border-top:1px solid var(--h-hair-soft);padding:10px 0 4px;width:100%;box-sizing:border-box';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;padding-right:2px';

  const title = document.createElement('span');
  title.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);flex:1;min-width:80px';
  title.textContent = 'enabled models';

  const selectAllBtn = document.createElement('button');
  selectAllBtn.className = 's-icon-btn';
  selectAllBtn.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:11px;padding:2px 8px;width:auto;height:auto;white-space:nowrap;flex-shrink:0';
  header.append(title, selectAllBtn);

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:1px;max-height:200px;overflow-y:auto;padding-right:4px';

  const checkboxes = [];

  for (const m of cachedModels) {
    const modelName = typeof m === 'string' ? m : m.model;
    const vision = typeof m === 'object' && m.vision;
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 2px;cursor:pointer;border-radius:3px';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = modelName;
    cb.checked = enabledSet ? enabledSet.has(modelName) : true;
    cb.className = 's-model-cb';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-family:ui-monospace,monospace;font-size:11.5px;color:var(--h-ink-faint);flex:1';
    lbl.textContent = modelName;
    row.append(cb, lbl);
    const tools = typeof m === 'object' && m.tools;
    const local = typeof m === 'object' && m.local;
    if (local || vision || tools) {
      const badges = document.createElement('span');
      badges.style.cssText = 'display:inline-flex;gap:3px;opacity:0.45;flex-shrink:0';
      if (local) badges.insertAdjacentHTML('beforeend', '<svg title="Local" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/></svg>');
      if (vision) badges.insertAdjacentHTML('beforeend', '<svg title="Vision" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>');
      if (tools) badges.insertAdjacentHTML('beforeend', '<svg title="Tools" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>');
      row.appendChild(badges);
    }
    list.appendChild(row);
    checkboxes.push(cb);
    cb.addEventListener('change', updateSelectAllLabel);
  }

  function updateSelectAllLabel() {
    const all = checkboxes.every(c => c.checked);
    const none = checkboxes.every(c => !c.checked);
    selectAllBtn.textContent = all ? 'deselect all' : 'select all';
  }
  updateSelectAllLabel();

  selectAllBtn.addEventListener('click', () => {
    const all = checkboxes.every(c => c.checked);
    checkboxes.forEach(c => { c.checked = !all; });
    updateSelectAllLabel();
  });

  const saveRow = document.createElement('div');
  saveRow.style.cssText = 'display:flex;justify-content:flex-end;margin-top:8px';
  const saveBtn = document.createElement('button');
  saveBtn.className = 's-save-btn';
  saveBtn.textContent = 'save selection';
  saveBtn.addEventListener('click', async () => {
    const selected = checkboxes.filter(c => c.checked).map(c => c.value);
    saveBtn.disabled = true; saveBtn.textContent = 'saving...';
    try {
      await fetch(`/api/ai/platforms/${encodeURIComponent(platformId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled_models: selected.length === cachedModels.length ? null : selected }),
      });
      showToast(`Saved — ${selected.length} of ${cachedModels.length} models enabled`);
      fetchPlatformModels();
    } catch { showToast('Failed to save', { error: true }); }
    saveBtn.disabled = false; saveBtn.textContent = 'save selection';
  });
  saveRow.appendChild(saveBtn);

  wrap.append(header, list, saveRow);
  container.appendChild(wrap);
}

async function sDeletePlatform(id) {
  if (!confirm('Remove this platform?')) return;
  try {
    await fetch(`/api/ai/platforms/${encodeURIComponent(id)}`, { method: 'DELETE' });
    sLoadPlatformsTab();
    fetchPlatformModels();
  } catch { showToast('Failed to delete platform', { error: true }); }
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
  let data;
  try { data = await fjson('/api/settings'); }
  catch { showToast('Failed to load server settings', { error: true }); return; }
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
  document.getElementById('s-compact-threshold-input').value = data.auto_compact_threshold_kb || 500;
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
  let reconnectDelay = 3000;
  function connect() {
    globalWs = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);
    globalWs.onopen = () => { reconnectDelay = 3000; globalWs.send(JSON.stringify({ type: 'subscribe_global' })); };
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
      if (msg.type === 'room_restored' || msg.type === 'room_pinned' || msg.type === 'room_unpinned') {
        refreshRoomList();
      }
      if (msg.type === 'model_update') handleModelUpdate(msg);
      if (msg.type === 'room_created' || msg.type === 'room_activity' || msg.type === 'room_updated') {
        if (msg.type === 'room_activity' && msg.room_id !== currentRoomId) {
          const roomEl = document.querySelector(`.h-room-row[data-room-id="${msg.room_id}"]`);
          const roomTitle = roomEl?.querySelector('.h-room-title-text')?.textContent || 'Room';
          showDesktopNotif(`New message in ${roomTitle}`, '', msg.room_id);
        }
        refreshRoomList();
      }
    };
    globalWs.onclose = () => { setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 1.5, 30000); };
    globalWs.onerror = e => console.warn('[globalWs] error', e);
  }
  connect();
}

async function refreshRoomList() {
  try {
    const isArchived = currentRoomTab === 'archived';
    const rooms = await fjson(`/api/rooms${isArchived ? '?archived=1' : ''}`);
    renderRoomList(rooms);
    if (rooms.length) {
      const ids = rooms.map(r => r.id).join(',');
      const grouped = await fjson(`/api/rooms/participants?ids=${ids}`);
      for (const room of rooms) {
        const parts = grouped[room.id] || [];
        roomParticipantsCache[room.id] = parts;
        renderRoomDots(room.id, parts);
      }
    }
    return true;
  } catch (e) { console.error('refreshRoomList failed:', e); return false; }
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
      fjson(`/api/actors/${actor.id}/workdirs`).then(wds => { if (wds.length) sFinishSetupSlip(actor.id); }).catch(e => { console.error('Failed to load workdirs in handleActorStatus', e); });
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
  document.getElementById('s-compact-threshold-save')?.addEventListener('click', () => {
    const val = parseInt(document.getElementById('s-compact-threshold-input').value);
    if (!val || val < 100 || val > 5000) return;
    sSaveSetting('auto_compact_threshold_kb', val, 's-compact-threshold-saved');
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


