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

