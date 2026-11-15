// ── Platforms tab ────────────────────────────────────────────────────────────
const VENICE_BASE_URL = 'https://api.venice.ai/api/v1';
const VENICE_DEFAULT_EXTRA_BODY = { venice_parameters: { include_venice_system_prompt: false, enable_web_search: 'off' } };

function sParseServerTime(v) {
  if (!v) return null;
  const s = typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v) ? v.replace(' ', 'T') + 'Z' : v;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function sFormatBalance(n, digits) {
  return typeof n === 'number' && isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits }) : '—';
}

function sPlatformBalanceText(p) {
  const checked = sParseServerTime(p.balances_checked_at);
  if (!p.balances || !checked) return 'Balance not checked yet';
  const when = checked.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `USD ${sFormatBalance(p.balances.usd, 2)} · DIEM ${sFormatBalance(p.balances.diem, 4)} · checked ${when}`;
}

async function sTestPlatformKey(id) {
  let data;
  try {
    const resp = await fetch(`/api/ai/platforms/${encodeURIComponent(id)}/health`, { method: 'POST' });
    data = await resp.json().catch(() => null);
    if (!data) throw new Error('http ' + resp.status);
    if (!resp.ok && !data.status) data = { status: 'error', message: data.error || 'Key test failed' };
  } catch { data = { status: 'error', message: 'Key test failed' }; }
  const ok = data.status === 'ok';
  showToast(data.message || (ok ? 'API key OK' : 'Key test failed'), ok ? undefined : { error: true });
  if (data.balances) {
    const el = document.getElementById('s-platform-balance-' + id);
    if (el) el.textContent = sPlatformBalanceText({ balances: data.balances, balances_checked_at: data.balances_checked_at || new Date().toISOString() });
  }
  return data;
}

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
    const formatInfo = p.vendor !== 'ollama' && p.api_format === 'openai_chat' ? ' · OpenAI Chat' : '';
    urlEl.textContent = (p.base_url || '—') + formatInfo + (keyCount > 1 ? ` · ${keyCount} keys` : '') + modelInfo;

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
    if (p.vendor === 'venice') {
      const balRow = document.createElement('div');
      balRow.className = 's-plat-balance-row';
      const bal = document.createElement('span');
      bal.className = 's-plat-balance';
      bal.id = 's-platform-balance-' + p.id;
      bal.textContent = sPlatformBalanceText(p);
      const testBtn = document.createElement('button');
      testBtn.className = 's-plat-link-btn';
      testBtn.type = 'button';
      testBtn.textContent = 'test key';
      testBtn.title = 'Test the API key and refresh the balance';
      testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        await sTestPlatformKey(p.id);
        testBtn.disabled = false;
      });
      balRow.append(bal, testBtn);
      card.appendChild(balRow);
    }
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
    lbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);width:80px;flex-shrink:0;white-space:nowrap';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.className = 's-server-input'; inp.type = type; inp.name = 'platform-' + label.toLowerCase().replace(/\s+/g, '-'); inp.value = value || ''; inp.placeholder = placeholder || '';
    inp.autocomplete = 'off'; inp.setAttribute('data-1p-ignore', ''); inp.setAttribute('data-lpignore', 'true');
    inp.style.cssText = 'flex:1;min-width:0';
    row.append(lbl, inp);
    return { row, inp };
  };

  // Type selector row
  const typeRow = document.createElement('div');
  typeRow.style.cssText = 'display:flex;align-items:center;gap:10px';
  const typeLbl = document.createElement('span');
  typeLbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);width:80px;flex-shrink:0;white-space:nowrap';
  typeLbl.textContent = 'type';
  const typeSel = document.createElement('select');
  typeSel.className = 's-server-input';
  typeSel.name = 'platform-type';
  typeSel.style.cssText = 'flex:1;cursor:pointer';
  [['custom', 'Custom Platform'], ['ollama', 'Ollama Cloud'], ['venice', 'Venice.ai']].forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    if ((existing?.vendor || 'custom') === val) opt.selected = true;
    typeSel.appendChild(opt);
  });
  typeRow.append(typeLbl, typeSel);

  const nameF = mkField('name', 'text', existing?.name, 'e.g. Custom Platform');
  const urlF = mkField('base url', 'text', existing?.base_url, 'http://localhost:11434');

  const urlHint = document.createElement('div');
  urlHint.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:11px;color:var(--h-ink-mute);padding:0 0 0 90px;margin-top:-4px';
  urlHint.textContent = 'Platform base URL (e.g. local daemon, custom server)';

  const fmtRow = document.createElement('div');
  fmtRow.style.cssText = 'display:flex;align-items:center;gap:10px';
  const fmtLbl = document.createElement('span');
  fmtLbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);width:80px;flex-shrink:0;white-space:nowrap';
  fmtLbl.textContent = 'api format';
  const fmtSel = document.createElement('select');
  fmtSel.className = 's-server-input';
  fmtSel.name = 'platform-api-format';
  fmtSel.setAttribute('aria-label', 'API format');
  fmtSel.style.cssText = 'flex:1;min-width:0;cursor:pointer';
  [['anthropic', 'Anthropic Messages (default)'], ['openai_chat', 'OpenAI Chat Completions']].forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    if ((existing?.api_format === 'openai_chat' ? 'openai_chat' : 'anthropic') === val) opt.selected = true;
    fmtSel.appendChild(opt);
  });
  fmtRow.append(fmtLbl, fmtSel);

  const fmtHint = document.createElement('div');
  fmtHint.style.cssText = urlHint.style.cssText;
  const applyFormatHint = () => {
    fmtHint.textContent = fmtSel.value === 'openai_chat'
      ? 'Base URL must serve /chat/completions (with or without /v1). Stoa translates Anthropic requests to OpenAI format.'
      : 'Base URL must serve the Anthropic Messages API (/v1/messages).';
  };
  fmtSel.addEventListener('change', () => { applyFormatHint(); applyExtraVisibility(); });
  applyFormatHint();
  const formatBody = vendor => (vendor === 'ollama' ? {} : { api_format: fmtSel.value, ...extraBodyField() });
  // The server owns the Venice URL (it may differ from the locked field, e.g. a test override), so it is never sent.
  const urlBody = vendor => (vendor === 'venice' ? {} : { base_url: vendor === 'ollama' ? '' : urlF.inp.value.trim() });

  const extraRow = document.createElement('div');
  extraRow.style.cssText = 'display:flex;align-items:flex-start;gap:10px';
  const extraLbl = document.createElement('span');
  extraLbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);width:80px;flex-shrink:0;white-space:nowrap;padding-top:7px';
  extraLbl.textContent = 'extra body';
  const extraWrap = document.createElement('div');
  extraWrap.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:4px';
  const extraInp = document.createElement('textarea');
  extraInp.className = 's-server-input s-plat-extra';
  extraInp.name = 'platform-extra-body';
  extraInp.rows = 6;
  extraInp.spellcheck = false;
  extraInp.setAttribute('wrap', 'off');
  extraInp.placeholder = '{ "temperature": 0.7 }';
  extraInp.setAttribute('aria-label', 'Extra request body (JSON)');
  extraInp.setAttribute('aria-describedby', 's-plat-extra-hint');
  extraInp.value = existing?.extra_body && typeof existing.extra_body === 'object' ? JSON.stringify(existing.extra_body, null, 2) : '';
  const extraHint = document.createElement('div');
  extraHint.id = 's-plat-extra-hint';
  extraHint.className = 's-plat-hint';
  extraHint.textContent = 'JSON object merged into every /chat/completions request. Leave empty for none.';
  const extraErr = document.createElement('div');
  extraErr.className = 's-plat-hint s-plat-error';
  extraErr.setAttribute('role', 'alert');
  extraErr.style.display = 'none';
  extraWrap.append(extraInp, extraHint, extraErr);
  extraRow.append(extraLbl, extraWrap);
  const setExtraError = msg => {
    extraErr.textContent = msg || '';
    extraErr.style.display = msg ? 'block' : 'none';
    extraInp.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  extraInp.addEventListener('input', () => setExtraError(''));
  const usesExtraBody = () => typeSel.value === 'venice' || (typeSel.value !== 'ollama' && fmtSel.value === 'openai_chat');
  const extraBodyField = () => {
    if (!usesExtraBody()) return {};
    const raw = extraInp.value.trim();
    if (!raw) return { extra_body: null };
    return { extra_body: JSON.parse(raw) };
  };
  const checkExtraBody = () => {
    if (!usesExtraBody() || !extraInp.value.trim()) { setExtraError(''); return true; }
    let v;
    try { v = JSON.parse(extraInp.value); } catch (e) { setExtraError('Extra body is not valid JSON: ' + e.message); return false; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { setExtraError('Extra body must be a JSON object, e.g. { "key": "value" }'); return false; }
    setExtraError('');
    return true;
  };

  const keysRow = document.createElement('div');
  keysRow.style.cssText = 'display:flex;align-items:flex-start;gap:10px';
  const keysLbl = document.createElement('span');
  keysLbl.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute);width:80px;flex-shrink:0;white-space:nowrap;padding-top:6px';
  keysLbl.textContent = 'api keys';
  const keysWrap = document.createElement('div');
  keysWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:6px';
  const keysList = document.createElement('div');
  keysList.style.cssText = 'display:flex;flex-direction:column;gap:4px';
  const keyStore = [];
  const existingKeys = existing?.api_keys || (existing?.api_key ? [existing.api_key] : []);

  function renderKeyPill(key, idx) {
    const pill = document.createElement('div');
    pill.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;background:var(--h-surface-hi);font-family:ui-monospace,monospace;font-size:11.5px;color:var(--h-ink-faint)';
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
  keyInp.className = 's-server-input'; keyInp.type = 'text'; keyInp.name = 'platform-api-key'; keyInp.placeholder = 'sk-...';
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

  const veniceHint = document.createElement('div');
  veniceHint.className = 's-plat-hint s-plat-hint-indent';
  veniceHint.textContent = 'Use an "Inference Only" API key from venice.ai/settings/api and set a daily spend limit on it, so an agent cannot drain the balance.';
  const presetNames = { ollama: 'Ollama Cloud', venice: 'Venice.ai' };
  const defaultExtraText = JSON.stringify(VENICE_DEFAULT_EXTRA_BODY, null, 2);
  let customUrl = existing?.vendor === 'venice' ? '' : (existing?.base_url || '');
  let customFormat = fmtSel.value;
  let prevType = typeSel.value;

  function applyExtraVisibility() {
    extraRow.style.display = usesExtraBody() ? 'flex' : 'none';
    if (!usesExtraBody()) setExtraError('');
  }

  function applyTypeMode() {
    const type = typeSel.value;
    const isOllama = type === 'ollama';
    const isVenice = type === 'venice';
    if (prevType !== 'venice') { customUrl = urlF.inp.value; customFormat = fmtSel.value; }
    if (isVenice) {
      urlF.inp.value = VENICE_BASE_URL;
      fmtSel.value = 'openai_chat';
      // Opening a saved Venice platform shows exactly what is stored (null = empty); the default only fills a switch to Venice.
      if (prevType !== 'venice' && !extraInp.value.trim()) extraInp.value = defaultExtraText;
    } else if (prevType === 'venice') {
      urlF.inp.value = customUrl;
      fmtSel.value = customFormat;
      if (extraInp.value.trim() === defaultExtraText) extraInp.value = '';
    }
    urlF.inp.readOnly = isVenice;
    urlF.inp.classList?.toggle('is-locked', isVenice);
    fmtSel.disabled = isVenice;
    urlF.row.style.display = isOllama ? 'none' : 'flex';
    urlHint.style.display = isOllama || isVenice ? 'none' : 'block';
    fmtRow.style.display = isOllama ? 'none' : 'flex';
    fmtHint.style.display = isOllama || isVenice ? 'none' : 'block';
    veniceHint.style.display = isVenice ? 'block' : 'none';
    applyFormatHint();
    applyExtraVisibility();
    if (!existing && presetNames[type] && (!nameF.inp.value || Object.values(presetNames).includes(nameF.inp.value))) nameF.inp.value = presetNames[type];
    else if (!existing && !presetNames[type] && Object.values(presetNames).includes(nameF.inp.value)) nameF.inp.value = '';
    keyInp.placeholder = isOllama ? 'Ollama API key...' : isVenice ? 'Venice API key...' : 'sk-...';
    prevType = type;
  }
  typeSel.addEventListener('change', applyTypeMode);
  applyTypeMode();

  keysWrap.append(keysList, addRow);
  keysRow.append(keysLbl, keysWrap);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;padding-top:4px';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 's-server-save'; cancelBtn.textContent = 'cancel';
  cancelBtn.style.cssText = 'background:transparent;color:var(--h-ink-faint)';
  cancelBtn.addEventListener('click', () => form.remove());

  const healthBtn = document.createElement('button');
  healthBtn.className = 's-server-save'; healthBtn.textContent = existing ? 'discover models' : 'add & discover';
  healthBtn.style.cssText = 'background:transparent;color:var(--h-ink-faint)';

  const saveBtn = document.createElement('button');
  saveBtn.className = 's-server-save'; saveBtn.textContent = existing ? 'update' : 'add';
  saveBtn.addEventListener('click', async () => {
    const name = nameF.inp.value.trim();
    const vendor = typeSel.value;

    const pending = keyInp.value.trim();
    if (pending && !keyStore.includes(pending)) { keyStore.push(pending); keyInp.value = ''; refreshKeys(); }
    const api_keys = [...keyStore];
    if (!name) { showToast('Name is required', { error: true }); return; }
    if (vendor !== 'ollama' && !urlF.inp.value.trim()) { showToast('Base URL is required', { error: true }); return; }
    if (!checkExtraBody()) { extraInp.focus(); return; }
    try {
      let platformId;
      if (existing) {
        const resp = await fetch(`/api/ai/platforms/${encodeURIComponent(existing.id)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, api_keys, vendor, ...urlBody(vendor), ...formatBody(vendor) }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          showToast(err.error || 'Failed to update platform', { error: true }); return;
        }
        platformId = existing.id;
      } else {
        const resp = await fetch('/api/ai/platforms', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, api_keys, vendor, ...urlBody(vendor), ...formatBody(vendor) }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          showToast(err.error || 'Failed to add platform', { error: true }); return;
        }
        const created = await resp.json();
        platformId = created.id;
      }
      const cbs = modelSection.querySelectorAll('.s-model-cb');
      if (cbs.length) {
        const selected = [...cbs].filter(c => c.checked).map(c => c.value);
        await fetch(`/api/ai/platforms/${encodeURIComponent(platformId)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled_models: selected.length === cbs.length ? null : selected }), // [] (none selected) is valid — platform won't appear in model selector
        }).then(r => { if (!r.ok) showToast('Failed to save model selection', { error: true }); })
          .catch(() => showToast('Failed to save model selection', { error: true }));
      }
      if (vendor === 'venice' && !(await imageModels.save(platformId))) return;
      if (vendor === 'venice' && !(await videoSettings.save(platformId))) return;
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
    let id = existing?.id;
    const name = nameF.inp.value.trim();
    const vendor = typeSel.value;
    const pending = keyInp.value.trim();
    if (pending && !keyStore.includes(pending)) { keyStore.push(pending); keyInp.value = ''; refreshKeys(); }
    const api_keys = [...keyStore];
    if (!name) { showToast('Name is required', { error: true }); return; }
    if (vendor !== 'ollama' && !urlF.inp.value.trim()) { showToast('Base URL is required', { error: true }); return; }
    if (!checkExtraBody()) { extraInp.focus(); return; }
    healthBtn.disabled = true;
    if (!id) {
      // new platform — create first, then discover
      try {
        const resp = await fetch('/api/ai/platforms', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, api_keys, vendor, ...urlBody(vendor), ...formatBody(vendor) }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          showToast(err.error || 'Failed to save platform', { error: true }); healthBtn.disabled = false; return;
        }
        const created = await resp.json();
        id = created.id;
        existing = created;
        applyTestKeyVisibility();
        saveBtn.textContent = 'update';
        healthBtn.textContent = 'discover models';
      } catch { showToast('Failed to save platform', { error: true }); healthBtn.disabled = false; return; }
    } else {
      // existing platform — PATCH current form state before discover.
      // discover-models reads from DB, not request body, so unsaved edits (e.g. a new api_key)
      // must be persisted first or discovery would silently use stale values.
      try {
        const resp = await fetch(`/api/ai/platforms/${encodeURIComponent(id)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, api_keys, vendor, ...urlBody(vendor), ...formatBody(vendor) }),
        });
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); showToast(err.error || 'Failed to save platform', { error: true }); healthBtn.disabled = false; return; }
      } catch { showToast('Failed to save platform', { error: true }); healthBtn.disabled = false; return; }
    }
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
            const prevEnabled = existing?.enabled_models ?? null;
            if (prevEnabled) {
              const newNames = new Set(ev.usable.map(m => typeof m === 'string' ? m : m.model));
              const pruned = prevEnabled.filter(n => newNames.has(n));
              sRenderModelChecklist(modelSection, ev.usable, pruned);
            } else {
              sRenderModelChecklist(modelSection, ev.usable, null);
            }
          } else if (ev.type === 'error') {
            throw new Error(ev.message || 'discovery failed');
          }
        }
      }
      let tail = null;
      try { tail = buf.trim() ? JSON.parse(buf) : null; } catch {}
      if (tail?.status === 'error') throw new Error(tail.message || 'discovery failed');
      if (vendor === 'venice') { await imageModels.refresh(id); await videoSettings.refresh(id); }
      fetchPlatformModels();
    } catch (e) {
      progressLabel.textContent = 'discovery failed';
      showToast(e.message || 'Discovery failed', { error: true });
    }
    setTimeout(() => { progressWrap.style.display = 'none'; }, 1800);
    healthBtn.textContent = 'discover models'; healthBtn.disabled = false;
  });

  const testKeyBtn = document.createElement('button');
  testKeyBtn.className = 's-server-save'; testKeyBtn.type = 'button'; testKeyBtn.textContent = 'test key';
  testKeyBtn.title = 'Test the API key and refresh the balance';
  testKeyBtn.style.cssText = 'background:transparent;color:var(--h-ink-faint)';
  const applyTestKeyVisibility = () => { testKeyBtn.style.display = typeSel.value === 'venice' && existing?.id ? '' : 'none'; };
  typeSel.addEventListener('change', applyTestKeyVisibility);
  applyTestKeyVisibility();
  testKeyBtn.addEventListener('click', async () => {
    const id = existing?.id;
    const name = nameF.inp.value.trim();
    const vendor = typeSel.value;
    const pending = keyInp.value.trim();
    if (pending && !keyStore.includes(pending)) { keyStore.push(pending); keyInp.value = ''; refreshKeys(); }
    if (!name) { showToast('Name is required', { error: true }); return; }
    if (!checkExtraBody()) { extraInp.focus(); return; }
    testKeyBtn.disabled = true;
    try {
      const resp = await fetch(`/api/ai/platforms/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, api_keys: [...keyStore], vendor, ...urlBody(vendor), ...formatBody(vendor) }),
      });
      if (!resp.ok) { const err = await resp.json().catch(() => ({})); showToast(err.error || 'Failed to save platform', { error: true }); return; }
      await sTestPlatformKey(id);
    } catch { showToast('Failed to save platform', { error: true }); } finally { testKeyBtn.disabled = false; }
  });

  btnRow.append(cancelBtn, testKeyBtn, healthBtn, saveBtn);

  const modelSection = document.createElement('div');
  modelSection.id = 's-model-checklist-wrap';
  if (existing?.cached_models?.length) {
    sRenderModelChecklist(modelSection, existing.cached_models, existing.enabled_models ?? null);
  }

  const imageSection = document.createElement('div');
  imageSection.className = 's-plat-img';
  const imageModels = sImageModelsSection(imageSection, existing);
  const applyImageVisibility = () => { imageSection.style.display = typeSel.value === 'venice' ? '' : 'none'; };
  typeSel.addEventListener('change', applyImageVisibility);
  applyImageVisibility();

  const videoSection = document.createElement('div');
  videoSection.className = 's-plat-img s-plat-video';
  const videoSettings = sVideoSettingsSection(videoSection, existing);
  let videoJobsLoaded = false;
  const applyVideoVisibility = () => {
    const show = typeSel.value === 'venice';
    videoSection.style.display = show ? '' : 'none';
    if (show && existing?.id && !videoJobsLoaded) { videoJobsLoaded = true; videoSettings.loadJobs(); }
  };
  typeSel.addEventListener('change', applyVideoVisibility);
  applyVideoVisibility();

  form.append(typeRow, nameF.row, urlF.row, urlHint, fmtRow, fmtHint, veniceHint, keysRow, extraRow, progressWrap, modelSection, imageSection, videoSection, btnRow);

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

const S_IMAGE_SLOTS = [
  ['generate', 'generate', 'generate', false],
  ['generate_uncensored', 'generate (uncensored)', 'generate', true],
  ['edit', 'edit', 'edit', false],
  ['edit_uncensored', 'edit (uncensored)', 'edit', true],
];

// Image model slots for a Venice platform. Options come from cached_image_models (filled by discover);
// standard slots never offer uncensored models. The server re-validates every slot on save.
function sImageModelsSection(container, platform) {
  let stored = {};
  let selects = {};
  let errEl = null;

  function render(cached, saved, keep) {
    stored = saved && typeof saved === 'object' ? saved : {};
    selects = {};
    container.innerHTML = '';
    const title = document.createElement('div');
    title.className = 's-plat-img-title';
    title.textContent = 'image models';
    container.appendChild(title);
    const models = Array.isArray(cached) ? cached.filter(m => m && typeof m.model === 'string') : [];
    if (!models.length) {
      const hint = document.createElement('div');
      hint.className = 's-plat-hint';
      hint.textContent = 'No image models yet. Run "discover models" first, then pick the models agents use for image tools.';
      container.appendChild(hint);
      errEl = null;
      return;
    }
    for (const [slot, label, kind, allowUncensored] of S_IMAGE_SLOTS) {
      const row = document.createElement('div');
      row.className = 's-plat-img-row';
      const lbl = document.createElement('label');
      lbl.className = 's-plat-img-label';
      lbl.htmlFor = 's-plat-img-' + slot;
      lbl.textContent = label;
      const sel = document.createElement('select');
      sel.className = 's-server-input s-plat-img-select';
      sel.id = 's-plat-img-' + slot;
      sel.name = 'platform-image-' + slot;
      const addOpt = (value, text) => {
        const opt = document.createElement('option');
        opt.value = value; opt.textContent = text;
        sel.appendChild(opt);
      };
      addOpt('', '(none)');
      const offered = models.filter(m => m.kind === kind && (allowUncensored || m.uncensored !== true));
      for (const m of offered) addOpt(m.model, allowUncensored && m.uncensored === true ? m.model + ' · uncensored' : m.model);
      const current = keep && slot in keep ? keep[slot] : (typeof stored[slot] === 'string' ? stored[slot] : '');
      if (current && !offered.some(m => m.model === current)) addOpt(current, current + ' (not available)');
      sel.value = current || '';
      sel.addEventListener('change', () => setError(''));
      row.append(lbl, sel);
      container.appendChild(row);
      selects[slot] = sel;
    }
    errEl = document.createElement('div');
    errEl.className = 's-plat-hint s-plat-error';
    errEl.setAttribute('role', 'alert');
    errEl.style.display = 'none';
    container.appendChild(errEl);
  }

  function setError(msg) {
    if (!errEl) return;
    errEl.textContent = msg || '';
    errEl.style.display = msg ? 'block' : 'none';
    if (msg) errEl.scrollIntoView?.({ block: 'nearest' });
  }

  const values = () => Object.fromEntries(Object.entries(selects).map(([slot, sel]) => [slot, sel.value || null]));
  const dirtySlots = () => Object.fromEntries(Object.entries(values()).filter(([slot, v]) => v !== (stored[slot] || null)));

  render(platform?.cached_image_models, platform?.image_models, null);

  return {
    async save(id) {
      if (!Object.keys(dirtySlots()).length) return true;
      const image_models = values();
      try {
        const resp = await fetch(`/api/ai/platforms/${encodeURIComponent(id)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_models }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setError(err.error || 'Failed to save image models');
          return false;
        }
        stored = image_models;
        return true;
      } catch { setError('Failed to save image models'); return false; }
    },
    async refresh(id) {
      const keep = dirtySlots();
      let fresh;
      try { fresh = (await fjson('/api/ai/platforms')).find(p => p.id === id); } catch { return; }
      if (!fresh) return;
      if (platform) { platform.cached_image_models = fresh.cached_image_models; platform.image_models = fresh.image_models; }
      render(fresh.cached_image_models, fresh.image_models, keep);
    },
  };
}

const S_VIDEO_JOB_STATUSES = new Set(['queued', 'processing', 'completed', 'failed', 'timeout']);
const S_VIDEO_KIND_LABELS = { t2v: 'text-to-video', i2v: 'image-to-video' };
const S_VIDEO_SLOTS = [
  ['model', 'text-to-video', 't2v', false],
  ['model_uncensored', 'text-to-video (uncensored)', 't2v', true],
  ['model_i2v', 'image-to-video', 'i2v', false],
  ['model_i2v_uncensored', 'image-to-video (uncensored)', 'i2v', true],
];
let sVideoJobListener = null;

// Owner-only `video_job_update` from the global socket; only the open Venice form listens.
function sVideoJobUpdate(msg) {
  if (sVideoJobListener) sVideoJobListener(msg);
}

function sVideoNum(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

function sVideoUsd(n) {
  return n === null ? '—' : '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

// Only same-origin /uploads/ results become links; anything else from the payload is ignored.
function sVideoResultHref(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const u = new URL(raw, location.origin);
    return u.origin === location.origin && u.pathname.startsWith('/uploads/') ? u.pathname : null;
  } catch { return null; }
}

// Video settings for a Venice platform: default text-to-video and image-to-video model per mode (standard
// slots never offer uncensored models), default duration/resolution, the per-job price cap and per-room concurrency cap,
// plus the recent job list (live via video_job_update). The server re-validates everything on save.
function sVideoSettingsSection(container, platform) {
  let stored = {};
  let fields = null;
  let errEl = null;
  let jobsWrap = null;
  let jobs = [];
  let jobsSeq = 0;
  const platformId = () => platform?.id ?? null;

  const strOrEmpty = v => (typeof v === 'string' ? v : '');
  const numText = v => (sVideoNum(v) === null ? '' : String(v));

  function addRow(labelText, control, slot) {
    const row = document.createElement('div');
    row.className = 's-plat-img-row';
    const lbl = document.createElement('label');
    lbl.className = 's-plat-img-label';
    lbl.htmlFor = 's-plat-video-' + slot;
    lbl.textContent = labelText;
    control.id = 's-plat-video-' + slot;
    control.name = 'platform-video-' + slot;
    control.addEventListener('input', () => setError(''));
    control.addEventListener('change', () => setError(''));
    row.append(lbl, control);
    container.appendChild(row);
  }

  function makeSelect() {
    const sel = document.createElement('select');
    sel.className = 's-server-input s-plat-img-select';
    return sel;
  }

  function fillSelect(sel, options, current, noneLabel) {
    sel.innerHTML = '';
    const add = (value, text) => {
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = text;
      sel.appendChild(opt);
    };
    if (noneLabel) add('', noneLabel);
    for (const [value, text] of options) add(value, text);
    if (current && !options.some(([v]) => v === current)) add(current, current + ' (not available)');
    sel.value = current || '';
  }

  function makeNumber(min, step) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 's-server-input s-plat-video-num';
    inp.min = String(min);
    inp.step = step;
    inp.inputMode = step === '1' ? 'numeric' : 'decimal';
    return inp;
  }

  function render(cached, saved, keep) {
    stored = saved && typeof saved === 'object' ? saved : {};
    fields = null;
    errEl = null;
    container.innerHTML = '';
    const title = document.createElement('div');
    title.className = 's-plat-img-title';
    title.textContent = 'video';
    container.appendChild(title);

    const models = Array.isArray(cached)
      ? cached.filter(m => m && typeof m.model === 'string' && (m.kind === 't2v' || m.kind === 'i2v'))
      : [];
    if (!models.length) {
      const hint = document.createElement('div');
      hint.className = 's-plat-hint';
      hint.textContent = 'No video models yet. Run "discover models" first, then pick the models agents use for video.';
      container.appendChild(hint);
    } else {
      const pick = key => (keep && key in keep ? keep[key] : stored[key]);
      const slotSels = {};
      for (const [slot, , kind, allowUncensored] of S_VIDEO_SLOTS) {
        const sel = makeSelect();
        const offered = models.filter(m => m.kind === kind && (allowUncensored || m.uncensored !== true));
        fillSelect(sel, offered.map(m => [m.model, allowUncensored && m.uncensored === true ? m.model + ' · uncensored' : m.model]), strOrEmpty(pick(slot)), '(none)');
        slotSels[slot] = sel;
      }
      const durSel = makeSelect();
      const resSel = makeSelect();
      const usdInp = makeNumber(0, '0.01');
      const concInp = makeNumber(1, '1');
      usdInp.value = numText(pick('max_usd_per_job'));
      concInp.value = numText(pick('max_concurrent_per_room'));
      fields = { slotSels, durSel, resSel, usdInp, concInp };

      // Duration/resolution are the default and the cap agents may ask for; options follow the chosen models.
      const constraintOptions = key => {
        const chosen = Object.values(slotSels).map(sel => models.find(m => m.model === sel.value)).filter(Boolean);
        const seen = new Set();
        for (const m of chosen) {
          const list = m.constraints && Array.isArray(m.constraints[key]) ? m.constraints[key] : [];
          for (const v of list) if (typeof v === 'string' && v) seen.add(v);
        }
        return [...seen].sort((a, b) => (parseFloat(a) - parseFloat(b)) || a.localeCompare(b)).map(v => [v, v]);
      };
      const refreshConstraints = () => {
        fillSelect(durSel, constraintOptions('durations'), durSel.value || strOrEmpty(pick('duration')), null);
        fillSelect(resSel, constraintOptions('resolutions'), resSel.value || strOrEmpty(pick('resolution')), null);
      };
      refreshConstraints();
      for (const [slot, label] of S_VIDEO_SLOTS) {
        slotSels[slot].addEventListener('change', refreshConstraints);
        addRow(label, slotSels[slot], slot);
      }
      addRow('duration', durSel, 'duration');
      addRow('resolution', resSel, 'resolution');
      addRow('max USD per job', usdInp, 'max_usd_per_job');
      addRow('max jobs per room', concInp, 'max_concurrent_per_room');

      errEl = document.createElement('div');
      errEl.className = 's-plat-hint s-plat-error';
      errEl.setAttribute('role', 'alert');
      errEl.style.display = 'none';
      container.appendChild(errEl);
    }

    const jobsTitle = document.createElement('div');
    jobsTitle.className = 's-plat-img-title s-plat-video-jobs-title';
    jobsTitle.textContent = 'recent video jobs';
    jobsWrap = document.createElement('div');
    jobsWrap.className = 's-plat-video-jobs';
    jobsWrap.setAttribute('aria-live', 'polite');
    container.append(jobsTitle, jobsWrap);
    renderJobs();
  }

  function setError(msg) {
    if (!errEl) return;
    errEl.textContent = msg || '';
    errEl.style.display = msg ? 'block' : 'none';
    if (msg) errEl.scrollIntoView?.({ block: 'nearest' });
  }

  function values() {
    if (!fields) return null;
    const { slotSels, durSel, resSel, usdInp, concInp } = fields;
    return {
      ...Object.fromEntries(S_VIDEO_SLOTS.map(([slot]) => [slot, slotSels[slot].value || null])),
      duration: durSel.value || null,
      resolution: resSel.value || null,
      max_usd_per_job: usdInp.value.trim() === '' ? null : Number(usdInp.value),
      max_concurrent_per_room: concInp.value.trim() === '' ? null : Number(concInp.value),
    };
  }

  function dirtyKeys() {
    const v = values();
    if (!v) return {};
    return Object.fromEntries(Object.entries(v).filter(([k, val]) => val !== (stored[k] ?? null)));
  }

  function jobRow(job) {
    const row = document.createElement('div');
    row.className = 's-plat-video-job';
    row.setAttribute('data-job-id', String(job.id));

    const status = S_VIDEO_JOB_STATUSES.has(job.status) ? job.status : 'unknown';
    const pill = document.createElement('span');
    pill.className = 's-plat-tag s-plat-video-status';
    pill.setAttribute('data-status', status);
    pill.textContent = status;

    const model = document.createElement('span');
    model.className = 's-plat-video-model';
    model.textContent = typeof job.model === 'string' && job.model ? job.model : '—';
    model.title = model.textContent;

    const meta = document.createElement('span');
    meta.className = 's-plat-video-meta';
    const parts = [];
    if (Object.hasOwn(S_VIDEO_KIND_LABELS, job.kind ?? '')) parts.push(S_VIDEO_KIND_LABELS[job.kind]);
    if (job.mode === 'uncensored') parts.push('uncensored');
    for (const k of ['duration', 'resolution']) if (typeof job[k] === 'string' && job[k]) parts.push(job[k]);
    parts.push(sVideoUsd(sVideoNum(job.quote_usd)));
    const when = sParseServerTime(job.created_at);
    if (when) parts.push(when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
    meta.textContent = parts.join(' · ');

    row.append(pill, model, meta);

    const href = status === 'completed' ? sVideoResultHref(job.upload_url) : null;
    if (href) {
      const link = document.createElement('a');
      link.className = 's-plat-link-btn s-plat-video-open';
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'open video';
      row.appendChild(link);
    }
    if (typeof job.error === 'string' && job.error) {
      const err = document.createElement('div');
      err.className = 's-plat-hint s-plat-error s-plat-video-error';
      err.textContent = job.error;
      row.appendChild(err);
    }
    return row;
  }

  function renderJobs(note) {
    if (!jobsWrap) return;
    jobsWrap.innerHTML = '';
    if (note || !jobs.length) {
      const hint = document.createElement('div');
      hint.className = 's-plat-hint';
      hint.textContent = note || 'No video jobs yet.';
      jobsWrap.appendChild(hint);
      return;
    }
    for (const job of jobs) jobsWrap.appendChild(jobRow(job));
  }

  async function loadJobs() {
    const id = platformId();
    if (!id) { renderJobs('Save the platform first.'); return; }
    const seq = ++jobsSeq;
    renderJobs('Loading…');
    try {
      const list = await fjson(`/api/ai/platforms/${encodeURIComponent(id)}/video-jobs?limit=20`);
      if (seq !== jobsSeq) return;
      jobs = Array.isArray(list) ? list.filter(j => j && j.id != null) : [];
      renderJobs();
    } catch {
      if (seq === jobsSeq) renderJobs('Could not load video jobs.');
    }
  }

  function onJobUpdate(msg) {
    const job = msg && typeof msg.job === 'object' ? msg.job : null;
    if (!job || job.id == null || !container.isConnected) return;
    if (msg.platform_id != null && msg.platform_id !== platformId()) return;
    jobsSeq++;
    const idx = jobs.findIndex(j => j.id === job.id);
    if (idx === -1) jobs = [job, ...jobs].slice(0, 20);
    else jobs[idx] = { ...jobs[idx], ...job };
    renderJobs();
  }

  render(platform?.cached_video_models, platform?.video_settings, null);
  sVideoJobListener = onJobUpdate;

  return {
    loadJobs,
    async save(id) {
      if (!Object.keys(dirtyKeys()).length) return true;
      const video_settings = values();
      for (const [k, label] of [['max_usd_per_job', 'Max USD per job'], ['max_concurrent_per_room', 'Max jobs per room']]) {
        const n = video_settings[k];
        if (n === null || !isFinite(n) || n < 0 || (k === 'max_concurrent_per_room' && (!Number.isInteger(n) || n < 1))) {
          setError(`${label} must be ${k === 'max_concurrent_per_room' ? 'a whole number of at least 1' : 'a number of 0 or more'}`);
          return false;
        }
      }
      try {
        const resp = await fetch(`/api/ai/platforms/${encodeURIComponent(id)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_settings }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setError(err.error || 'Failed to save video settings');
          return false;
        }
        stored = video_settings;
        return true;
      } catch { setError('Failed to save video settings'); return false; }
    },
    async refresh(id) {
      const keep = dirtyKeys();
      let fresh;
      try { fresh = (await fjson('/api/ai/platforms')).find(p => p.id === id); } catch { return; }
      if (!fresh) return;
      if (platform) { platform.cached_video_models = fresh.cached_video_models; platform.video_settings = fresh.video_settings; }
      else platform = fresh;
      render(fresh.cached_video_models, fresh.video_settings, keep);
    },
  };
}

function sRenderModelChecklist(container, cachedModels, enabledModels) {
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
    cb.name = 'platform-model';
    cb.value = modelName;
    cb.checked = enabledSet ? enabledSet.has(modelName) : true;
    cb.className = 's-model-cb';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-family:ui-monospace,monospace;font-size:11.5px;color:var(--h-ink-faint);flex:1;min-width:0;overflow-wrap:anywhere';
    lbl.textContent = modelName;
    row.append(cb, lbl);
    const tags = typeof m === 'object' && m ? ['uncensored', 'reasoning'].filter(k => m[k] === true) : [];
    if (tags.length) {
      const tagWrap = document.createElement('span');
      tagWrap.className = 's-plat-tags';
      for (const k of tags) {
        const tag = document.createElement('span');
        tag.className = 's-plat-tag';
        tag.textContent = k;
        tagWrap.appendChild(tag);
      }
      row.appendChild(tagWrap);
    }
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

  wrap.append(header, list);
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

