// ── MCP tab: add from catalog / custom, edit ─────────────────────────────────
const MCP_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MCP_HEADER_KEY_RE = /^[A-Za-z0-9-]+$/;

function mcpSafeHref(url) {
  try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null; } catch { return null; }
}

function mcpSlugFrom(text) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_{2,}/g, '_').replace(/^[^a-z]+/, '');
  return s.slice(0, 32).replace(/_+$/, '');
}

// A second install of the same preset gets the next free slug (github_2, …) instead of a 409.
function mcpFreeSlug(base) {
  const taken = s => mcpState.servers.some(x => x.slug === s);
  if (!taken(base)) return base;
  for (let n = 2; n < 100; n++) {
    const s = `${base.slice(0, 32 - String(n).length - 1)}_${n}`;
    if (!taken(s)) return s;
  }
  return base;
}

function mcpNewForm(preset) {
  if (preset) {
    return {
      mode: 'new', preset, serverId: null, name: preset.name, slug: mcpFreeSlug(mcpSlugFrom(preset.id)), slugTouched: true, inDialog: true,
      transport: preset.transport, auth: preset.auth || 'none', command: '', args: '', url: '', allow_all: false, keep_alive: false, error: null, saving: false,
      env: (preset.env_fields || []).map(f => ({ key: f.key, value: '', label: f.label || f.key, help: f.help || '', secret: !!f.secret, required: !!f.required, fixed: true })),
    };
  }
  return {
    mode: 'new', preset: null, serverId: null, name: '', slug: '', slugTouched: false,
    transport: 'stdio', command: '', args: '', url: '', allow_all: false, keep_alive: false, error: null, saving: false, env: [],
  };
}

function mcpOpenEdit(srv) {
  const preset = srv.preset ? mcpState.catalog.find(p => p.id === srv.preset) || null : null;
  const fields = new Map((preset?.env_fields || []).map(f => [f.key, f]));
  const env = (srv.env_keys || []).map(k => {
    const f = fields.get(k.key);
    return { key: k.key, value: '', masked: k.masked || '••••', label: f?.label || k.key, help: f?.help || '', secret: f ? !!f.secret : true, required: false, fixed: true, existing: true, remove: false };
  });
  fields.forEach(f => {
    if (!env.some(e => e.key === f.key)) env.push({ key: f.key, value: '', label: f.label || f.key, help: f.help || '', secret: !!f.secret, required: false, fixed: true });
  });
  mcpOpenDialog({
    mode: 'edit', preset, presetId: srv.preset || null, serverId: srv.id, name: srv.name, slug: srv.slug, slugTouched: true, inDialog: true,
    icon: mcpIconForServer(srv), transport: srv.transport, auth: srv.auth || 'none', authInitial: srv.auth || 'none', command: srv.command || '', args: (srv.args || []).join('\n'), url: srv.url || '',
    allow_all: srv.default_access === 'all', keep_alive: !!srv.keep_alive, error: null, saving: false, env,
  }, `edit:${srv.id}`);
}

// ── Install / edit dialog (native <dialog>: focus trap, Esc and top layer come with showModal) ──
let mcpDialogReturn = null;

function mcpDialogEl() {
  let dlg = document.getElementById('mcp-dialog');
  if (dlg) return dlg;
  dlg = mcpEl('dialog', 'mcp-dialog');
  dlg.id = 'mcp-dialog';
  dlg.setAttribute('aria-labelledby', 'mcp-dialog-title');
  dlg.addEventListener('cancel', e => { if (mcpState.form?.saving) e.preventDefault(); });
  dlg.addEventListener('close', mcpOnDialogClose);
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', e => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', e => {
    if (e.target === dlg && downOnBackdrop && !mcpState.form?.saving) dlg.close();
  });
  document.body.appendChild(dlg);
  return dlg;
}

// returnKey matches a data-mcp-return attribute; looked up after close because the opener may have been re-rendered.
function mcpOpenDialog(f, returnKey) {
  mcpState.form = f;
  mcpDialogReturn = returnKey;
  const dlg = mcpDialogEl();
  dlg.replaceChildren(mcpMakeForm(f));
  if (!dlg.open) dlg.showModal();
  const first = dlg.querySelector('.mcp-env input:not([disabled])')
    || dlg.querySelector('.mcp-access-choice input:checked')
    || dlg.querySelector('input:not([disabled])');
  first?.focus();
}

function mcpRenderDialog() {
  const dlg = document.getElementById('mcp-dialog');
  const f = mcpState.form;
  if (!dlg?.open || !f?.inDialog) return;
  const focusables = () => [...dlg.querySelectorAll('input, textarea, button, a[href], summary')];
  const idx = focusables().indexOf(document.activeElement);
  dlg.replaceChildren(mcpMakeForm(f));
  if (idx >= 0) focusables()[idx]?.focus();
}

function mcpCloseDialog() {
  const dlg = document.getElementById('mcp-dialog');
  if (dlg?.open) dlg.close();
}

function mcpOnDialogClose() {
  if (mcpState.form?.inDialog) mcpState.form = null;
  document.getElementById('mcp-dialog')?.replaceChildren();
  const key = mcpDialogReturn;
  mcpDialogReturn = null;
  const target = (key && document.querySelector(`[data-mcp-return="${CSS.escape(key)}"]`))
    || document.querySelector('.mcp-tabbtn[aria-selected="true"]');
  target?.focus();
}

function mcpRenderAdd(panel) {
  const f = mcpState.form && !mcpState.form.inDialog ? mcpState.form : null;

  const seg = mcpEl('div', 'mcp-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Source');
  [['catalog', 'catalog'], ['custom', 'custom']].forEach(([id, label]) => {
    const b = mcpBtn('mcp-seg-btn', label, () => {
      if (mcpState.addMode === id) return;
      mcpState.addMode = id;
      mcpState.form = id === 'custom' ? mcpNewForm(null) : null;
      mcpRender();
    });
    b.setAttribute('aria-pressed', mcpState.addMode === id ? 'true' : 'false');
    seg.appendChild(b);
  });
  panel.appendChild(seg);

  if (mcpState.addMode === 'custom') {
    panel.appendChild(mcpMakeForm(f || (mcpState.form = mcpNewForm(null))));
    return;
  }

  if (!mcpState.catalog.length) {
    panel.appendChild(mcpEmpty('catalog unavailable', 'the server returned no presets. you can still add a server under custom.'));
    return;
  }
  const grid = mcpEl('div', 'mcp-catalog');
  mcpState.catalog.forEach(p => {
    const installed = mcpState.servers.some(s => s.preset === p.id);
    const card = mcpEl('div', 'mcp-preset');
    const top = mcpEl('div', 'mcp-preset-top');
    top.append(mcpMakeIcon(p.icon, p.name, 'sm'), mcpEl('span', 'mcp-preset-name', p.name), mcpEl('span', 'mcp-chip', p.transport));
    if (p.auth === 'oauth') top.appendChild(mcpEl('span', 'mcp-chip', 'oauth'));
    if (p.playground) {
      const chip = mcpEl('span', 'mcp-chip', 'playground');
      chip.title = 'for trying the gateway out, no account needed';
      top.appendChild(chip);
    }
    if (installed) top.appendChild(mcpEl('span', 'mcp-chip mcp-chip-ok', 'installed'));
    card.append(top, mcpEl('span', 'mcp-preset-desc', p.description || ''));
    const needs = (p.env_fields || []).filter(x => x.required).length;
    const foot = mcpEl('div', 'mcp-preset-foot');
    foot.appendChild(mcpEl('span', 'mcp-preset-need', p.auth === 'oauth' ? `sign in with ${p.name} after install`
      : needs ? `needs ${needs} credential${needs > 1 ? 's' : ''}` : 'no credentials needed'));
    const install = mcpBtn(installed ? 'auto-small-btn' : 'mcp-install-btn', installed ? 'install another' : 'install',
      () => mcpOpenDialog(mcpNewForm(p), `preset:${p.id}`));
    install.dataset.mcpReturn = `preset:${p.id}`;
    install.setAttribute('aria-label', `${installed ? 'Install another' : 'Install'} ${p.name}`);
    foot.appendChild(install);
    card.appendChild(foot);
    grid.appendChild(card);
  });
  panel.appendChild(grid);
}

function mcpField(label, control, hint) {
  const wrap = mcpEl(/^(INPUT|TEXTAREA|SELECT)$/.test(control.tagName) ? 'label' : 'div', 'mcp-field');
  wrap.appendChild(mcpEl('span', 'mcp-field-label', label));
  wrap.appendChild(control);
  if (hint) wrap.appendChild(hint instanceof Node ? hint : mcpEl('span', 'mcp-field-hint', hint));
  return wrap;
}

function mcpInput(value, onInput, opts = {}) {
  const i = mcpEl('input', 'auto-field-input mcp-input');
  i.type = opts.type || 'text';
  i.value = value || '';
  if (opts.placeholder) i.placeholder = opts.placeholder;
  if (opts.mono) i.classList.add('mcp-mono');
  if (opts.disabled) i.disabled = true;
  i.autocomplete = opts.type === 'password' ? 'new-password' : 'off';
  i.spellcheck = false;
  i.addEventListener('input', () => onInput(i.value));
  return i;
}

function mcpMakeForm(f) {
  const isEdit = f.mode === 'edit';
  const isCustom = !f.preset && !f.presetId;
  const box = mcpEl('form', 'mcp-form');
  box.noValidate = true;

  const head = mcpEl('div', 'mcp-form-head');
  if (f.inDialog) head.appendChild(mcpMakeIcon(f.preset?.icon || f.icon || null, f.name, 'md'));
  const title = mcpEl('span', 'mcp-form-title', isEdit ? `edit ${f.name}` : isCustom ? 'custom MCP server' : `install ${f.preset.name}`);
  if (f.inDialog) title.id = 'mcp-dialog-title';
  head.appendChild(title);
  const docs = f.preset?.docs_url && mcpSafeHref(f.preset.docs_url);
  if (docs) {
    const a = mcpEl('a', 'mcp-docs-link', (f.preset.env_fields || []).length ? 'how to get credentials ↗' : 'docs ↗');
    a.href = docs; a.target = '_blank'; a.rel = 'noopener noreferrer';
    head.appendChild(a);
  }
  if (f.inDialog) {
    const x = mcpBtn('s-icon-btn mcp-dialog-x', null, mcpCloseDialog, 'Close');
    x.innerHTML = svgX(14);
    x.setAttribute('aria-label', 'Close');
    x.disabled = f.saving;
    head.appendChild(x);
  }
  box.appendChild(head);
  if (f.inDialog && !isEdit && f.preset?.description) box.appendChild(mcpEl('p', 'mcp-form-desc', f.preset.description));

  if (isCustom && f.transport === 'stdio') {
    const warn = mcpEl('div', 'mcp-warn');
    warn.setAttribute('role', 'note');
    warn.append(mcpEl('strong', null, 'this command runs on the Stoa server. '),
      document.createTextNode('it starts without a shell, with only PATH, HOME and the variables below. only add commands you trust — allowed binaries: npx, uvx, node, docker, or an absolute path.'));
    box.appendChild(warn);
  }

  const grid = mcpEl('div', 'mcp-form-grid');
  grid.appendChild(mcpField('name', mcpInput(f.name, v => {
    f.name = v;
    if (isCustom && !isEdit && !f.slugTouched) {
      f.slug = mcpSlugFrom(v);
      const s = box.querySelector('.mcp-slug-input');
      if (s) s.value = f.slug;
    }
  }, { placeholder: 'e.g. Context7' })));
  const slugIn = mcpInput(f.slug, v => {
    f.slug = v; f.slugTouched = true;
    const h = box.querySelector('.mcp-ident-slug');
    if (h) h.textContent = ` · tools appear as ${v}__tool`;
  }, { placeholder: 'context7', mono: true, disabled: isEdit });
  slugIn.classList.add('mcp-slug-input');
  grid.appendChild(mcpField('slug', slugIn, isEdit ? 'fixed after install — it prefixes every tool name' : 'lowercase, starts with a letter. tools appear as slug__tool'));
  if (!isEdit && !isCustom) {
    const more = mcpEl('details', 'mcp-ident');
    more.open = !!f.identityOpen;
    more.addEventListener('toggle', () => { f.identityOpen = more.open; });
    const sum = mcpEl('summary', null, 'name & slug');
    sum.appendChild(mcpEl('span', 'mcp-field-hint mcp-ident-slug', ` · tools appear as ${f.slug}__tool`));
    more.append(sum, grid);
    box.appendChild(more);
  } else {
    box.appendChild(grid);
  }

  if (isCustom) {
    const tseg = mcpEl('div', 'mcp-seg mcp-seg-small');
    tseg.setAttribute('role', 'group');
    tseg.setAttribute('aria-label', 'Transport');
    [['stdio', 'stdio command'], ['http', 'http url']].forEach(([id, label]) => {
      const b = mcpBtn('mcp-seg-btn', label, () => {
        if (f.transport === id || isEdit) return;
        f.transport = id;
        f.env = f.env.filter(e => e.value || e.existing);
        mcpRender();
      });
      b.setAttribute('aria-pressed', f.transport === id ? 'true' : 'false');
      if (isEdit) b.disabled = true;
      tseg.appendChild(b);
    });
    box.appendChild(mcpField('transport', tseg));

    if (f.transport === 'stdio') {
      box.appendChild(mcpField('command', mcpInput(f.command, v => { f.command = v; }, { placeholder: 'npx', mono: true }),
        'binary only — put flags and packages in arguments'));
      const ta = mcpEl('textarea', 'auto-field-input mcp-input mcp-mono mcp-args');
      ta.rows = 3; ta.value = f.args; ta.placeholder = '-y\n@upstash/context7-mcp'; ta.spellcheck = false;
      ta.addEventListener('input', () => { f.args = ta.value; });
      box.appendChild(mcpField('arguments', ta, 'one per line, passed as-is — quotes and $VARS are not expanded'));
    } else {
      box.appendChild(mcpField('url', mcpInput(f.url, v => { f.url = v; }, { placeholder: 'https://example.com/mcp', mono: true })));
      const aseg = mcpEl('div', 'mcp-seg mcp-seg-small');
      aseg.setAttribute('role', 'group');
      aseg.setAttribute('aria-label', 'Sign-in');
      [['headers', 'header token or none'], ['oauth', 'oauth sign-in']].forEach(([id, label]) => {
        const b = mcpBtn('mcp-seg-btn', label, () => {
          if ((f.auth === 'oauth') === (id === 'oauth')) return;
          f.auth = id;
          mcpRender();
        });
        b.setAttribute('aria-pressed', (f.auth === 'oauth') === (id === 'oauth') ? 'true' : 'false');
        aseg.appendChild(b);
      });
      box.appendChild(mcpField('sign-in', aseg, f.auth === 'oauth'
        ? `after ${isEdit ? 'saving' : 'install'}, use connect on the server card to sign in with the provider`
        : 'put a token in headers below, e.g. Authorization'));
    }
  }

  if (isCustom || f.env.length || f.auth === 'oauth') box.appendChild(mcpMakeEnvEditor(f, isCustom));

  if (f.transport === 'stdio') box.appendChild(mcpMakeKeepAlive(f));

  if (!isEdit) box.appendChild(mcpMakeAccessChoice(f));

  const err = mcpEl('div', 'auto-field-err', f.error || '');
  err.setAttribute('role', 'alert');
  box.appendChild(err);

  const btns = mcpEl('div', 'mcp-form-btns');
  const cancel = mcpBtn('auto-cancel-btn', 'cancel', () => {
    if (f.inDialog) { mcpCloseDialog(); return; }
    mcpState.form = null;
    if (isEdit) { mcpState.addMode = 'catalog'; mcpSetTab('installed'); }
    else { mcpState.addMode = 'catalog'; mcpRender(); }
  });
  const save = mcpEl('button', 'auto-save-btn', f.saving ? 'saving…' : isEdit ? 'save' : 'install');
  save.type = 'submit';
  save.disabled = f.saving;
  cancel.disabled = f.inDialog && f.saving;
  btns.append(cancel, save);
  box.appendChild(btns);

  box.addEventListener('submit', e => { e.preventDefault(); mcpSubmitForm(f, err, save); });
  return box;
}

// In edit mode the switch saves on its own: a PATCH carrying only keep_alive leaves the process running,
// while the form's save reconfigures (restarts) it, which would cut off e.g. a meeting bot mid-call.
function mcpMakeKeepAlive(f) {
  const isEdit = f.mode === 'edit';
  const wrap = mcpEl('div', 'mcp-keepalive');
  const row = mcpEl('div', 'mcp-keepalive-row');
  const txt = mcpEl('div', 'mcp-keepalive-text');
  const titleId = `mcp-keepalive-title-${f.serverId || 'new'}`;
  const title = mcpEl('span', 'mcp-check-title', 'keep running');
  title.id = titleId;
  txt.append(title, mcpEl('span', 'mcp-field-hint', 'Start with Stoa and never stop it when idle. For MCP servers that send events into rooms (e.g. a meeting bot).'));
  if (isEdit) txt.appendChild(mcpEl('span', 'mcp-field-hint', 'saved right away, without restarting the server.'));
  const err = mcpEl('div', 'auto-field-err');
  err.setAttribute('role', 'alert');
  const sw = mcpSwitch(!!f.keep_alive, 'Keep running', async next => {
    if (!isEdit) { f.keep_alive = next; return true; }
    err.textContent = '';
    const r = await mcpApi('PATCH', `/api/mcp/servers/${f.serverId}`, { keep_alive: next });
    if (!r.ok) { err.textContent = r.error; return false; }
    f.keep_alive = next;
    const srv = mcpServerById(f.serverId);
    if (srv) {
      Object.assign(srv, r.data?.server || { keep_alive: next });
      if (mcpIsVisible() && mcpState.tab === 'installed') mcpRerenderCard(srv);
    }
    return true;
  });
  sw.classList.add('mcp-keepalive-switch');
  sw.removeAttribute('aria-label');
  sw.setAttribute('aria-labelledby', titleId);
  row.append(txt, sw);
  wrap.append(row, err);
  return wrap;
}

function mcpMakeAccessChoice(f) {
  const set = mcpEl('fieldset', 'mcp-access-choice');
  set.appendChild(mcpEl('legend', 'mcp-field-label', 'who can use it'));
  [[false, 'only agents I grant', 'nobody can call its tools until you grant access in the access tab.'],
    [true, 'allow all agents', 'every agent can call its tools. you can still block one in the access tab.']].forEach(([all, label, hint]) => {
    const opt = mcpEl('label', 'mcp-access-opt');
    const rb = mcpEl('input');
    rb.type = 'radio'; rb.name = 'mcp-access'; rb.checked = !!f.allow_all === all;
    rb.addEventListener('change', () => { if (rb.checked) f.allow_all = all; });
    const txt = mcpEl('span');
    txt.append(mcpEl('span', 'mcp-check-title', label), mcpEl('span', 'mcp-field-hint', hint));
    opt.append(rb, txt);
    set.appendChild(opt);
  });
  return set;
}

function mcpMakeEnvEditor(f, isCustom) {
  const isHttp = f.transport === 'http';
  const section = mcpEl('div', 'mcp-env');
  const title = mcpEl('div', 'mcp-env-head');
  title.appendChild(mcpEl('span', 'mcp-field-label', !isCustom ? 'credentials' : isHttp ? 'headers' : 'environment variables'));
  title.appendChild(mcpEl('span', 'mcp-field-hint', 'encrypted at rest, never sent back to the browser'));
  section.appendChild(title);

  if (!f.env.length && !isCustom) {
    section.appendChild(mcpEl('div', 'mcp-muted',
      `none to paste: after ${f.mode === 'edit' ? 'saving' : 'install'}, use connect on the server card to sign in with ${f.name}. tokens are stored encrypted on this server.`));
    return section;
  }

  f.env.forEach((row, idx) => {
    const line = mcpEl('div', 'mcp-env-row');
    if (row.fixed) {
      const lab = mcpEl('div', 'mcp-env-key');
      lab.append(mcpEl('span', null, row.label + (row.required ? ' *' : '')));
      if (row.label !== row.key) lab.appendChild(mcpEl('code', 'mcp-env-keyname', row.key));
      line.appendChild(lab);
    } else {
      const k = mcpInput(row.key, v => { row.key = v.trim(); }, { placeholder: isHttp ? 'Authorization' : 'API_KEY', mono: true });
      k.setAttribute('aria-label', isHttp ? 'Header name' : 'Variable name');
      line.appendChild(k);
    }
    const placeholder = row.existing ? (row.remove ? 'will be removed' : `${row.masked} — leave empty to keep`) : (row.secret ? 'paste value' : 'value');
    const v = mcpInput(row.value, val => { row.value = val; }, { type: row.secret ? 'password' : 'text', placeholder, mono: true, disabled: row.remove });
    v.setAttribute('aria-label', `${row.label || row.key || 'value'}`);
    line.appendChild(v);
    if (row.existing) {
      const rm = mcpBtn('mcp-link-btn', row.remove ? 'keep' : 'remove', () => { row.remove = !row.remove; row.value = ''; mcpRender(); });
      rm.setAttribute('aria-pressed', row.remove ? 'true' : 'false');
      line.appendChild(rm);
    } else if (!row.fixed) {
      const rm = mcpBtn('s-icon-btn', null, () => { f.env.splice(idx, 1); mcpRender(); }, 'Remove row');
      rm.innerHTML = svgX(12);
      rm.setAttribute('aria-label', 'Remove row');
      line.appendChild(rm);
    } else {
      line.appendChild(mcpEl('span'));
    }
    section.appendChild(line);
    if (row.help) section.appendChild(mcpEl('div', 'mcp-field-hint mcp-env-help', row.help));
  });

  if (isCustom) {
    section.appendChild(mcpBtn('mcp-link-btn', isHttp ? '+ add header' : '+ add variable', () => {
      f.env.push({ key: '', value: '', label: '', secret: true, required: false, fixed: false });
      mcpRender();
      const rows = document.querySelectorAll('.mcp-env-row input');
      rows[rows.length - 2]?.focus();
    }));
  }
  return section;
}

function mcpValidateForm(f) {
  const isEdit = f.mode === 'edit';
  const isCustom = !f.preset && !f.presetId;
  if (!f.name.trim()) return 'Name is required';
  if (!isEdit && (!MCP_SLUG_RE.test(f.slug) || f.slug.length > 32 || f.slug.includes('__'))) return 'Slug must start with a letter, use a-z 0-9 _ (max 32), and not contain "__"';
  if (!isEdit && mcpState.servers.some(s => s.slug === f.slug)) return `Slug "${f.slug}" is already used`;
  if (isCustom && f.transport === 'stdio' && !f.command.trim()) return 'Command is required';
  if (isCustom && f.transport === 'stdio' && /\s/.test(f.command.trim())) return 'Command must be a single binary — move flags to arguments';
  if (isCustom && f.transport === 'http' && !mcpSafeHref(f.url.trim())) return 'URL must start with http:// or https://';
  const keyRe = f.transport === 'http' ? MCP_HEADER_KEY_RE : MCP_ENV_KEY_RE;
  const seen = new Set();
  for (const row of f.env) {
    if (!row.fixed && !row.key && !row.value) continue;
    if (!row.fixed && !keyRe.test(row.key)) return `"${row.key || '(empty)'}" is not a valid ${f.transport === 'http' ? 'header' : 'variable'} name`;
    if (seen.has(row.key)) return `"${row.key}" is listed twice`;
    seen.add(row.key);
    if (!isEdit && row.required && !row.value.trim()) return `${row.label || row.key} is required`;
    if (!row.fixed && !row.value && !row.existing) return `${row.key} needs a value`;
  }
  return null;
}

async function mcpSubmitForm(f, errEl, saveBtn) {
  const problem = mcpValidateForm(f);
  if (problem) { mcpShowFormError(f, errEl, problem); return; }
  f.error = null; errEl.textContent = '';
  const isEdit = f.mode === 'edit';
  const isCustom = !f.preset && !f.presetId;
  const env = {};
  f.env.forEach(row => { if (row.key && row.value && !row.remove) env[row.key] = row.value; });

  let body;
  if (isEdit) {
    body = { name: f.name.trim() };
    if (isCustom && f.transport === 'stdio') { body.command = f.command.trim(); body.args = f.args.split('\n').map(a => a.trim()).filter(Boolean); }
    if (isCustom && f.transport === 'http') {
      body.url = f.url.trim();
      const auth = mcpFormHttpAuth(f, env);
      if (auth !== f.authInitial) body.auth = auth;
    }
    if (Object.keys(env).length) body.env = env;
    const removed = f.env.filter(r => r.existing && r.remove).map(r => r.key);
    if (removed.length) body.env_remove = removed;
  } else {
    body = { slug: f.slug, name: f.name.trim(), transport: f.transport, env, allow_all: !!f.allow_all };
    if (f.transport === 'stdio' && f.keep_alive) body.keep_alive = true;
    if (f.preset) body.preset = f.preset.id;
    else if (f.transport === 'stdio') { body.command = f.command.trim(); body.args = f.args.split('\n').map(a => a.trim()).filter(Boolean); }
    else { body.url = f.url.trim(); body.auth = mcpFormHttpAuth(f, env); }
  }

  f.saving = true; saveBtn.disabled = true; saveBtn.textContent = 'saving…';
  if (f.inDialog) errEl.closest('form')?.querySelectorAll('.auto-cancel-btn, .mcp-dialog-x').forEach(b => { b.disabled = true; });
  const r = isEdit
    ? await mcpApi('PATCH', `/api/mcp/servers/${f.serverId}`, body)
    : await mcpApi('POST', '/api/mcp/servers', body);
  f.saving = false;
  if (!r.ok) {
    if (errEl.isConnected) {
      saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'save' : 'install';
      errEl.closest('form')?.querySelectorAll('.auto-cancel-btn, .mcp-dialog-x').forEach(b => { b.disabled = false; });
      mcpShowFormError(f, errEl, r.error);
    } else if (mcpState.form === f) {
      f.error = r.error;
      if (f.inDialog) mcpRenderDialog(); else mcpRender();
    } else {
      showToast(`Couldn’t ${isEdit ? 'save' : 'install'} ${body.name}: ${r.error}`, { error: true });
    }
    return;
  }
  const srv = r.data?.server;
  if (srv) {
    const i = mcpState.servers.findIndex(s => s.id === srv.id);
    if (i >= 0) mcpState.servers[i] = srv; else mcpState.servers.push(srv);
    delete mcpState.tools[srv.id];
    delete mcpState.testResults[srv.id];
  } else {
    await mcpLoadServers();
  }
  mcpState.access = null;
  if (mcpState.form === f) mcpState.form = null;
  mcpState.addMode = 'catalog';
  showToast(isEdit ? `${body.name} saved` : `${body.name} installed — run test to fetch its tools`);
  mcpSetTab('installed');
  if (f.inDialog) {
    if (srv) mcpDialogReturn = `edit:${srv.id}`;
    mcpCloseDialog();
  }
}

function mcpShowFormError(f, errEl, msg) {
  f.error = msg;
  errEl.textContent = msg;
  if (/^(name|slug)\b/i.test(msg)) {
    const more = errEl.closest('form')?.querySelector('.mcp-ident');
    if (more) more.open = true;
  }
}

function mcpFormHttpAuth(f, env) {
  if (f.auth === 'oauth') return 'oauth';
  return Object.keys(env).length || f.env.some(r => r.existing && !r.remove) ? 'headers' : 'none';
}
