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

