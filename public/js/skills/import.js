// ── Skills tab: import (file, folder, GitHub URL, drag-drop) with dry-run preview ──
const SK_ARCHIVE_RE = /\.(md|zip|skill|tar|tgz|tar\.gz)$/i;
const SK_GITHUB_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/.*)?$/;
const SK_FOLDER_MAX_FILES = 300;

let skImport = null;

function skPickFiles(folder) {
  const input = document.createElement('input');
  input.type = 'file';
  if (folder) input.webkitdirectory = true;
  else input.accept = '.md,.zip,.skill,.tar,.tgz,.gz';
  input.addEventListener('change', () => {
    const files = [...(input.files || [])];
    if (!files.length) return;
    if (folder) skStartImport({ kind: 'folder', entries: files.map(f => ({ file: f, path: f.webkitRelativePath || f.name })) });
    else skStartImport({ kind: 'file', file: files[0] });
  });
  input.click();
}

function skBindDropZone(host) {
  if (host.dataset.skDrop) return;
  host.dataset.skDrop = '1';
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  host.addEventListener('dragenter', e => {
    if (!hasFiles(e) || skillsState.view !== 'list') return;
    e.preventDefault();
    depth++;
    host.classList.add('sk-dropping');
  });
  host.addEventListener('dragover', e => {
    if (!hasFiles(e) || skillsState.view !== 'list') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  host.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) host.classList.remove('sk-dropping');
  });
  host.addEventListener('drop', async e => {
    if (!hasFiles(e) || skillsState.view !== 'list') return;
    e.preventDefault();
    depth = 0;
    host.classList.remove('sk-dropping');
    const src = await skReadDrop(e.dataTransfer);
    if (src) skStartImport(src);
  });
}

async function skReadDrop(dt) {
  const entries = [...(dt.items || [])].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length === 1 && entries[0].isFile) {
    const file = dt.files[0];
    return file ? { kind: 'file', file } : null;
  }
  if (!entries.length) {
    const file = dt.files?.[0];
    return file ? { kind: 'file', file } : null;
  }
  const out = [];
  try {
    for (const entry of entries) await skWalkEntry(entry, '', out);
  } catch (err) {
    showToast(err.message, { error: true });
    return null;
  }
  return out.length ? { kind: 'folder', entries: out } : null;
}

async function skWalkEntry(entry, prefix, out) {
  if (out.length > SK_FOLDER_MAX_FILES) throw new Error(`Too many files: a skill can hold at most ${SK_FOLDER_MAX_FILES}.`);
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ file, path });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    for (const child of batch) await skWalkEntry(child, path, out);
  }
}

function skSourceProblem(src) {
  if (src.kind === 'url') {
    const url = (src.url || '').trim();
    if (!url) return 'Paste a GitHub URL.';
    if (!SK_GITHUB_RE.test(url)) return 'Use a https://github.com/owner/repo URL, optionally with /tree/<ref>/<path>.';
    return null;
  }
  if (src.kind === 'file') {
    if (!SK_ARCHIVE_RE.test(src.file.name)) return 'Choose a .md, .zip, .skill, .tar, .tgz or .tar.gz file.';
    if (src.file.size > SKILL_UPLOAD_MAX) return `${src.file.name} is ${skFmtBytes(src.file.size)}; the limit is ${skFmtBytes(SKILL_UPLOAD_MAX)}.`;
    return null;
  }
  const files = src.entries.filter(e => !skIgnoredPath(e.path));
  if (!files.length) return 'That folder is empty.';
  if (files.length > SK_FOLDER_MAX_FILES) return `Too many files: a skill can hold at most ${SK_FOLDER_MAX_FILES}.`;
  const total = files.reduce((n, e) => n + e.file.size, 0);
  if (total > SKILL_UPLOAD_MAX) return `The folder is ${skFmtBytes(total)}; the limit is ${skFmtBytes(SKILL_UPLOAD_MAX)}.`;
  return null;
}

function skIgnoredPath(path) {
  return path.split('/').some(seg => seg === '.DS_Store' || seg === '__MACOSX');
}

function skSourceLabel(src) {
  if (src.kind === 'url') return src.url;
  if (src.kind === 'file') return src.file.name;
  return src.entries[0]?.path.split('/')[0] || 'folder';
}

function skImportBody(src, name, description) {
  if (src.kind === 'url') {
    const body = { url: src.url.trim() };
    if (name) body.name = name;
    if (description) body.description = description;
    return body;
  }
  const fd = new FormData();
  if (src.kind === 'file') {
    fd.append('file', src.file, src.file.name);
  } else {
    src.entries.filter(e => !skIgnoredPath(e.path)).forEach(e => {
      fd.append('files', e.file, e.file.name);
      fd.append('paths', e.path);
    });
  }
  if (name) fd.append('name', name);
  if (description) fd.append('description', description);
  return fd;
}

function skImportProblem(st) {
  const nameProblem = skNameProblem(st.name, null);
  if (nameProblem) return nameProblem;
  if (!st.preview?.description && !st.description.trim()) return 'A description is required.';
  return null;
}

function skStartImport(src) {
  if (src.kind !== 'url') {
    const problem = skSourceProblem(src);
    if (problem) { showToast(problem, { error: true, duration: 6000 }); return; }
  }
  skOpenImportDialog(src);
}

function skOpenImportDialog(src) {
  skImport = { src, phase: src.kind === 'url' && !src.url ? 'input' : 'loading', preview: null, error: null, name: '', description: '', saving: false };
  const dlg = skDialogEl();
  skRenderImport();
  if (!dlg.open) dlg.showModal();
  if (skImport.phase === 'loading') skRunDryRun();
  else dlg.querySelector('input')?.focus();
}

function skDialogEl() {
  let dlg = document.getElementById('sk-dialog');
  if (dlg) return dlg;
  dlg = skEl('dialog', 'mcp-dialog sk-dialog');
  dlg.id = 'sk-dialog';
  dlg.setAttribute('aria-labelledby', 'sk-dialog-title');
  dlg.addEventListener('cancel', e => { if (skImport?.saving) e.preventDefault(); });
  dlg.addEventListener('close', () => { skImport = null; dlg.replaceChildren(); });
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', e => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', e => { if (e.target === dlg && downOnBackdrop && !skImport?.saving) dlg.close(); });
  document.body.appendChild(dlg);
  return dlg;
}

async function skRunDryRun() {
  const st = skImport;
  const problem = skSourceProblem(st.src);
  if (problem) { st.phase = st.src.kind === 'url' ? 'input' : 'error'; st.error = problem; skRenderImport(); return; }
  st.phase = 'loading';
  st.error = null;
  skRenderImport();
  const r = await skillsApi('POST', '/api/skills/import?dry_run=1', skImportBody(st.src, st.name || null));
  if (skImport !== st) return;
  if (!r.ok) {
    st.phase = st.src.kind === 'url' ? 'input' : 'error';
    st.error = r.error;
  } else {
    st.phase = 'preview';
    st.preview = r.data?.preview || null;
    if (!st.name) st.name = st.preview?.name || '';
  }
  skRenderImport();
  document.querySelector('#sk-dialog .sk-import-name')?.focus();
}

async function skConfirmImport() {
  const st = skImport;
  const problem = skImportProblem(st);
  if (problem) { st.error = problem; skRenderImport(); return; }
  st.saving = true;
  st.error = null;
  skRenderImport();
  const r = await skillsApi('POST', '/api/skills/import', skImportBody(st.src, st.name, st.preview?.description ? null : st.description.trim()));
  if (skImport !== st) return;
  st.saving = false;
  if (!r.ok) { st.error = r.error; skRenderImport(); return; }
  const skill = r.data?.skill;
  document.getElementById('sk-dialog')?.close();
  showToast(`/${skill?.name || st.name} imported`);
  await skillsLoad();
  if (skill?.id) skillsOpenEditor(skill.id);
  else skillsRender();
}

function skRenderImport() {
  const dlg = document.getElementById('sk-dialog');
  const st = skImport;
  if (!dlg || !st) return;
  const form = skEl('form', 'mcp-form sk-import');
  form.noValidate = true;
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (st.saving || st.phase === 'loading') return;
    if (st.phase === 'input') { st.src.url = form.querySelector('.sk-import-url')?.value || ''; skRunDryRun(); }
    else if (st.phase === 'preview') skConfirmImport();
  });

  const head = skEl('div', 'mcp-form-head');
  const title = skEl('h2', 'mcp-form-title', st.src.kind === 'url' ? 'Import from GitHub' : 'Import skill');
  title.id = 'sk-dialog-title';
  head.appendChild(title);
  head.appendChild(skEl('span', 'mcp-actions-spacer'));
  const x = skBtn('s-icon-btn mcp-dialog-x', null, () => dlg.close(), 'Close');
  x.appendChild(skIcon(['M18 6L6 18', 'M6 6l12 12']));
  x.disabled = st.saving;
  head.appendChild(x);
  form.appendChild(head);

  if (st.src.kind === 'url' && st.phase === 'input') {
    const label = skEl('label', 'sk-field');
    label.appendChild(skEl('span', 'sk-field-label', 'Repository or folder URL'));
    const input = skEl('input', 'sk-input sk-import-url');
    input.type = 'url';
    input.placeholder = 'https://github.com/owner/repo/tree/main/skills/my-skill';
    input.value = st.src.url || '';
    input.spellcheck = false;
    label.appendChild(input);
    label.appendChild(skEl('span', 'sk-field-help', 'Public repositories only. Point at the folder that holds SKILL.md.'));
    form.appendChild(label);
  } else {
    form.appendChild(skEl('div', 'sk-import-source', skSourceLabel(st.src)));
  }

  if (st.phase === 'loading') form.appendChild(skEl('div', 'sk-muted', 'Reading the skill…'));

  if (st.phase === 'preview' && st.preview) form.appendChild(skMakePreview(st));

  if (st.error) {
    const err = skEl('div', 'mcp-card-error', st.error);
    err.setAttribute('role', 'alert');
    form.appendChild(err);
  }

  const foot = skEl('div', 'sk-dialog-foot');
  const cancel = skBtn('auto-cancel-btn', 'Cancel', () => dlg.close());
  cancel.disabled = st.saving;
  foot.appendChild(cancel);
  if (st.phase === 'input') {
    const next = skEl('button', 'auto-save-btn', 'Preview');
    next.type = 'submit';
    foot.appendChild(next);
  } else if (st.phase === 'preview') {
    const ok = skEl('button', 'auto-save-btn', st.saving ? 'Importing…' : 'Import');
    ok.type = 'submit';
    ok.disabled = st.saving || !!skImportProblem(st);
    foot.appendChild(ok);
  } else if (st.phase === 'error' && st.src.kind !== 'url') {
    foot.appendChild(skBtn('auto-save-btn', 'Choose another', () => { dlg.close(); skPickFiles(st.src.kind === 'folder'); }));
  }
  form.appendChild(foot);

  dlg.replaceChildren(form);
}

function skMakePreview(st) {
  const p = st.preview;
  const box = skEl('div', 'sk-preview');

  const nameField = skEl('label', 'sk-field');
  nameField.appendChild(skEl('span', 'sk-field-label', 'Name'));
  const nameRow = skEl('span', 'sk-name-row');
  nameRow.appendChild(skEl('span', 'sk-name-slash', '/'));
  const name = skEl('input', 'sk-input sk-import-name');
  name.value = st.name;
  name.spellcheck = false;
  name.autocomplete = 'off';
  name.maxLength = 48;
  nameRow.appendChild(name);
  nameField.appendChild(nameRow);
  const help = skEl('span', 'sk-field-error');
  help.id = 'sk-import-name-error';
  help.setAttribute('aria-live', 'polite');
  name.setAttribute('aria-describedby', help.id);
  nameField.appendChild(help);
  const sync = () => {
    const problem = skNameProblem(st.name, null);
    help.textContent = problem || '';
    help.hidden = !problem;
    name.setAttribute('aria-invalid', problem ? 'true' : 'false');
    const submit = name.form?.querySelector('button[type="submit"]');
    if (submit) submit.disabled = st.saving || !!skImportProblem(st);
  };
  name.addEventListener('input', () => { st.name = name.value.trim().toLowerCase(); sync(); });
  queueMicrotask(sync);
  box.appendChild(nameField);

  const desc = skEl('div', 'sk-preview-desc');
  desc.appendChild(skEl('span', 'sk-field-label', 'Description'));
  if (p.description) {
    desc.appendChild(skEl('p', 'sk-preview-text', p.description));
  } else {
    const input = skEl('input', 'sk-input sk-import-desc');
    input.value = st.description;
    input.maxLength = 500;
    input.placeholder = 'SKILL.md has no description. Write one line here.';
    input.setAttribute('aria-label', 'Description');
    input.addEventListener('input', () => {
      st.description = input.value.replace(/[\r\n]+/g, ' ');
      const submit = input.form?.querySelector('button[type="submit"]');
      if (submit) submit.disabled = st.saving || !!skImportProblem(st);
    });
    desc.appendChild(input);
  }
  if (p.argument_hint) desc.appendChild(skEl('p', 'sk-preview-hint', `Arguments: ${p.argument_hint}`));
  box.appendChild(desc);

  const files = Array.isArray(p.files) ? p.files : [];
  const fileHead = skEl('div', 'sk-preview-files-head');
  fileHead.appendChild(skEl('span', 'sk-field-label', 'Files'));
  fileHead.appendChild(skEl('span', 'sk-preview-total', `${files.length} ${files.length === 1 ? 'file' : 'files'} · ${skFmtBytes(p.total_bytes)}`));
  box.appendChild(fileHead);
  const list = skEl('ul', 'sk-preview-files');
  files.forEach(f => {
    const li = skEl('li', 'sk-preview-file');
    li.appendChild(skEl('span', 'sk-preview-path', f.path));
    if ((f.mode & 0o111) !== 0) li.appendChild(skEl('span', 'sk-badge', 'exec'));
    li.appendChild(skEl('span', 'sk-preview-size', skFmtBytes(f.size)));
    list.appendChild(li);
  });
  box.appendChild(list);

  const warnings = Array.isArray(p.warnings) ? p.warnings : [];
  if (warnings.length) {
    const w = skEl('ul', 'sk-warnings');
    w.setAttribute('aria-label', 'Warnings');
    warnings.forEach(text => w.appendChild(skEl('li', null, String(text))));
    box.appendChild(w);
  }
  return box;
}
