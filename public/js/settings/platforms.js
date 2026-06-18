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

  // Type selector row
  const typeRow = document.createElement('div');
  typeRow.style.cssText = 'display:flex;align-items:center;gap:10px';
  const typeLbl = document.createElement('span');
  typeLbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);min-width:70px';
  typeLbl.textContent = 'type';
  const typeSel = document.createElement('select');
  typeSel.className = 's-server-input';
  typeSel.style.cssText = 'flex:1;cursor:pointer';
  [['custom', 'Custom Platform'], ['ollama', 'Ollama Cloud']].forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    if ((existing?.vendor || 'custom') === val) opt.selected = true;
    typeSel.appendChild(opt);
  });
  typeRow.append(typeLbl, typeSel);

  const nameF = mkField('name', 'text', existing?.name, 'e.g. Custom Platform');
  const urlF = mkField('base url', 'url', existing?.base_url, 'http://localhost:11434');

  const urlHint = document.createElement('div');
  urlHint.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:11px;color:var(--h-ink-mute);padding:0 0 0 80px;margin-top:-4px';
  urlHint.textContent = 'OpenAI-compatible base URL (e.g. local daemon, custom server)';

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

  function applyTypeMode() {
    const isOllama = typeSel.value === 'ollama';
    urlF.row.style.display = isOllama ? 'none' : '';
    urlHint.style.display = isOllama ? 'none' : '';
    if (isOllama && !nameF.inp.value) nameF.inp.value = 'Ollama Cloud';
    else if (!isOllama && nameF.inp.value === 'Ollama Cloud') nameF.inp.value = '';
    keyInp.placeholder = isOllama ? 'Ollama API key...' : 'sk-...';
  }
  typeSel.addEventListener('change', applyTypeMode);
  applyTypeMode();

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
    const vendor = typeSel.value;
    const base_url = vendor === 'ollama' ? '' : urlF.inp.value.trim();

    const pending = keyInp.value.trim();
    if (pending && !keyStore.includes(pending)) { keyStore.push(pending); keyInp.value = ''; refreshKeys(); }
    const api_keys = [...keyStore];
    if (!name) { showToast('Name is required', { error: true }); return; }
    if (vendor !== 'ollama' && !base_url) { showToast('Base URL is required', { error: true }); return; }
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

  form.append(typeRow, nameF.row, urlF.row, urlHint, keysRow, progressWrap, modelSection, btnRow);

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
      if (local) badges.insertAdjacentHTML('beforeend', '<span title="Local model" style="display:inline-flex"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/></svg></span>');
      if (vision) badges.insertAdjacentHTML('beforeend', '<span title="Vision" style="display:inline-flex"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></span>');
      if (tools) badges.insertAdjacentHTML('beforeend', '<span title="Tools" style="display:inline-flex"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>');
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

