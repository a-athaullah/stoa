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

// ── Sub-agent design primitives (port of subagents.jsx) ──────────────────────
// Ported from the claude.ai/design spec: SET tokens → --h-* CSS vars, JSX → DOM.
const SA_TIERS_META = [
  { id: 'quick',    bars: 1, note: 'short lookups — cheapest model' },
  { id: 'standard', bars: 2, note: 'most work — balanced' },
  { id: 'deep',     bars: 3, note: 'long reasoning — costliest' },
];
const SA_MODELS = [
  'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1',
  'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
  'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5',
];
const SA_DANGER = '#b35a4b';

// One-time token injection: the sub-agent seal shade vars. Relative oklch keeps
// the parent HUE and just lightens/desaturates, so Ara's teal stays teal.
function saInjectTokens() {
  if (document.getElementById('sa-tokens')) return;
  const el = document.createElement('style');
  el.id = 'sa-tokens';
  el.textContent =
    ':root{--sa-sub-dl:0.16;--sa-sub-cf:0.55;--sa-sub-ink:oklch(0.28 0.020 50)}' +
    'html.dark{--sa-sub-dl:0.15;--sa-sub-cf:0.62;--sa-sub-ink:oklch(0.30 0.020 50)}';
  document.head.appendChild(el);
}
function saSubShade(color) {
  return `oklch(from ${color} calc(l + var(--sa-sub-dl)) calc(c * var(--sa-sub-cf)) h)`;
}

// Wax-seal mark. `badge` adds the corner notch that marks a sub-agent.
function saMakeSeal({ letter, color, size = 26, badge = false, ink = '#fff' }) {
  const wrap = document.createElement('span');
  wrap.style.cssText = 'position:relative;display:inline-flex;flex:0 0 auto';
  const disc = document.createElement('span');
  disc.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};color:${ink};` +
    `display:inline-flex;align-items:center;justify-content:center;font-family:var(--h-serif);` +
    `font-size:${size * 0.5}px;font-style:italic;line-height:1;` +
    'box-shadow:inset 0 -1px 0 rgba(0,0,0,.16), 0 1px 2px rgba(0,0,0,.06)';
  disc.textContent = letter || '?';
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

  // ── Sub-agents section (card — ported from subagents.jsx) ──
  saInjectTokens();
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
    labelInp.placeholder = 'probe'; labelInp.value = existing?.label || '';
    labelInp.style.cssText = 'padding:8px 12px;border-radius:8px;height:36px;box-sizing:border-box;' +
      'background:color-mix(in srgb, var(--h-bg) 30%, var(--h-surface));border:1px solid var(--h-hair-soft);' +
      'font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--h-ink);outline:none;width:100%';
    const labelField = saMakeField('label', labelInp, 'unique, used for @mention — cannot match an agent name');
    const labelErr = document.createElement('span');
    labelErr.style.cssText = 'display:none;align-items:center;gap:6px;font-family:var(--h-sans);font-size:12px;color:' + SA_DANGER;
    labelField.appendChild(labelErr);

    const modelSel = document.createElement('select');
    modelSel.style.cssText = 'padding:8px 12px;border-radius:8px;height:36px;box-sizing:border-box;' +
      'background:var(--h-surface);border:1px solid var(--h-hair-soft);' +
      'font-family:var(--h-sans);font-size:13px;color:var(--h-ink);outline:none;width:100%;cursor:pointer';
    const useTierOpt = document.createElement('option'); useTierOpt.value = ''; useTierOpt.textContent = 'use tier';
    modelSel.appendChild(useTierOpt);
    for (const m of SA_MODELS) {
      const o = document.createElement('option'); o.value = m; o.textContent = m;
      if ((existing?.model || '') === m) o.selected = true;
      modelSel.appendChild(o);
    }
    // Preserve a pinned model set via API that isn't in the preset list.
    if (existing?.model && !SA_MODELS.includes(existing.model)) {
      const o = document.createElement('option'); o.value = existing.model; o.textContent = existing.model; o.selected = true;
      modelSel.appendChild(o);
    }
    const modelField = saMakeField('model override', modelSel, 'leave on “use tier” unless this worker needs a specific model');
    grid.append(labelField, modelField);

    // tier picker
    const tierField = saMakeField('tier', saMakeTierPicker(selectedTier, id => { selectedTier = id; }));

    // system prompt (slip)
    const spInp = document.createElement('textarea');
    spInp.placeholder = 'You verify claims against the actual source before answering…';
    spInp.value = existing?.system_prompt || '';
    spInp.style.cssText = 'padding:11px 13px;border-radius:8px;min-height:96px;box-sizing:border-box;resize:vertical;' +
      'background:var(--h-slip);border:1px solid var(--h-hairline);' +
      'font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;color:var(--h-ink);outline:none;width:100%';
    const spField = saMakeField('system prompt', spInp, 'context injected on every trigger');

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
        const body = { label, tier: selectedTier, model: modelSel.value || null, system_prompt: spInp.value.trim() || null };
        const r = existing
          ? await fetch(`/api/sub-agents/${existing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          : await fetch(`/api/actors/${actor.id}/sub-agents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          const msg = e.error || 'failed to save';
          if (/already exists/i.test(msg)) showErr(`“${label}” already exists on ${actor.name}`);
          else if (/actor name|conflicts/i.test(msg)) showErr(`“${label}” is an agent name — pick something else`);
          else showToast(msg, { error: true });
          saveF.disabled = false; return;
        }
        saShowForm(false); saLoadList();
      } catch { showToast('Failed to save sub-agent', { error: true }); saveF.disabled = false; }
    });

    saForm.append(fh, grid, tierField, spField, btns);
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
        row.appendChild(saMakeSeal({ letter: sa.label[0], color: saShade, size: 26, badge: true, ink: 'var(--sa-sub-ink)' }));
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
        const line2 = document.createElement('span');
        line2.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--h-ink-faint);' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        line2.textContent = sa.workdir || `inherits ${actor.name}'s workdir`;
        mid.append(line1, line2);
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

