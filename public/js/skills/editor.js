// ── Skills tab: editor (create & edit share one component) ───────────────────
const SK_MAIN_FILE = 'SKILL.md';
const SK_TEXT_EXT = new Set(['md', 'markdown', 'txt', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'sh', 'bash', 'zsh', 'rb', 'go', 'rs', 'java', 'json', 'yaml', 'yml', 'toml', 'ini', 'csv', 'tsv', 'xml', 'html', 'htm', 'css', 'svg', 'sql', 'env', 'gitignore']);
const SK_IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const SK_LANG_BY_EXT = { js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx', py: 'py', json: 'json', md: 'md', markdown: 'md', html: 'html', htm: 'html', css: 'css' };
const SK_TEXT_PREVIEW_MAX = 512 * 1024;
const SK_SAVE_UPLOAD_MAX = 18 * 1024 * 1024;
const SK_FILE_MAX = 20 * 1024 * 1024;
const SK_DESC_MAX = 500;
const SK_TEMPLATE = `## When to use

Describe the situations where an agent should follow this skill.

## Steps

1. First step.
2. Second step.

## Files

List any supporting files in this folder and what each one is for.
`;

let skCmView = null;

function skExt(path) {
  const base = path.split('/').pop().toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : base.replace(/^\./, '');
}

function skFileKind(path) {
  const ext = skExt(path);
  if (SK_IMAGE_MIME[ext]) return 'image';
  if (SK_TEXT_EXT.has(ext) || !path.split('/').pop().includes('.')) return 'text';
  return 'binary';
}

function skUtf8ToB64(text) {
  return skBytesToB64(new TextEncoder().encode(text));
}

function skBytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function skPathProblem(path, ed, selfPath) {
  if (!path) return 'Enter a file name.';
  if (path.length > 200) return 'Paths are limited to 200 characters.';
  const segs = path.split('/');
  if (segs.length > 8) return 'Folders can nest at most 8 levels deep.';
  if (/[\u0000-\u001f\u007f\\]/.test(path) || /^[A-Za-z]:/.test(path)) return 'Paths can’t contain backslashes, control characters or a drive letter.';
  if (segs.some(s => !s || s === '.' || s === '..')) return 'Each part of the path needs a name; "." and ".." are not allowed.';
  if (path.toLowerCase() === SK_MAIN_FILE.toLowerCase()) return 'SKILL.md is the main file and already exists.';
  const lower = path.toLowerCase();
  for (const p of ed.files.keys()) {
    if (p === selfPath) continue;
    const pl = p.toLowerCase();
    if (pl === lower) return `${p} already exists.`;
    if (pl.startsWith(lower + '/')) return `${path} is a folder.`;
    if (lower.startsWith(pl + '/')) return `${p} is a file, not a folder.`;
  }
  return null;
}

function skNewEditor(skill) {
  const ed = {
    id: skill?.id || null,
    skill: skill || null,
    name: skill?.name || '',
    description: skill?.description || '',
    hint: skill?.argument_hint || '',
    body: skill ? (skill.body || '') : SK_TEMPLATE,
    files: new Map(),
    deleted: new Set(),
    folders: new Set(),
    selected: SK_MAIN_FILE,
    folder: '',
    tab: 'edit',
    note: '',
    saving: false,
    error: null,
    fieldErrors: {},
    adding: null,
    confirmDelete: null,
    confirmDiscard: false,
    treeOpen: false,
  };
  (skill?.files || []).forEach(f => {
    if (f.path === SK_MAIN_FILE) return;
    ed.files.set(f.path, { path: f.path, size: f.size, mode: f.mode || 0o644, sha256: f.sha256, origPath: f.path, state: 'clean', text: null, bytes: null, url: null, loading: false, loadError: null });
  });
  ed.origin = skSnapshot(ed);
  return ed;
}

function skSnapshot(ed) {
  return JSON.stringify([ed.name, ed.description, ed.hint, ed.body]);
}

function skIsDirty(ed) {
  if (!ed) return false;
  if (skSnapshot(ed) !== ed.origin || ed.deleted.size) return true;
  for (const f of ed.files.values()) if (f.state !== 'clean') return true;
  return false;
}

async function skillsOpenEditor(id) {
  skDisposeEditor();
  skillsState.view = 'editor';
  if (!id) {
    skillsState.editor = skNewEditor(null);
    skillsRenderEditor();
    document.querySelector('.sk-ed-name')?.focus();
    return;
  }
  skillsState.editor = { loading: true, id };
  skillsRenderEditor();
  const r = await skillsApi('GET', `/api/skills/${encodeURIComponent(id)}`);
  if (skillsState.editor?.id !== id || !skillsState.editor.loading) return;
  if (!r.ok) {
    skillsState.editor = null;
    skillsState.view = 'list';
    showToast(r.status === 404 ? 'That skill no longer exists' : `Couldn’t open skill: ${r.error}`, { error: true });
    skillsRender();
    return;
  }
  skillsState.editor = skNewEditor(r.data?.skill);
  skillsRenderEditor();
}

function skDisposeEditor() {
  skCmView?.destroy();
  skCmView = null;
  const ed = skillsState.editor;
  if (ed?.files) for (const f of ed.files.values()) if (f.url) URL.revokeObjectURL(f.url);
}

function skCloseEditor(force) {
  const ed = skillsState.editor;
  if (!force && skIsDirty(ed)) { ed.confirmDiscard = true; skillsRenderEditor(); return; }
  skDisposeEditor();
  skillsState.editor = null;
  skillsState.view = 'list';
  skillsRender();
}

function skillsRenderEditor() {
  const host = document.getElementById('s-tab-skills');
  const ed = skillsState.editor;
  if (!host || !ed) return;
  skCmView?.destroy();
  skCmView = null;
  const inner = skEl('div', 's-content-inner sk-root sk-editor');

  const top = skEl('div', 'sk-ed-top');
  const back = skBtn('mcp-link-btn sk-back', 'All skills', () => skCloseEditor(false));
  back.disabled = !!ed.saving;
  top.appendChild(back);
  if (!ed.loading) {
    const status = skEl('span', 'sk-ed-status');
    if (ed.skill) status.textContent = skSizeLine(ed.skill);
    else status.textContent = 'New skill';
    top.appendChild(status);
    if (ed.skill && !skIsMine(ed.skill)) {
      const by = skEl('span', 'sk-ed-by');
      by.appendChild(skEl('span', null, 'Created by'));
      by.appendChild(skCreatorEl(ed.skill));
      top.appendChild(by);
    }
  }
  inner.appendChild(top);

  if (ed.loading) {
    inner.appendChild(skEl('div', 'sk-muted', 'Loading skill…'));
    host.replaceChildren(inner);
    return;
  }

  skValidate(ed);
  inner.appendChild(skMakeMetaForm(ed));

  const panes = skEl('div', 'sk-panes' + (ed.treeOpen ? ' sk-tree-open' : ''));
  panes.appendChild(skMakeTree(ed));
  panes.appendChild(skMakeFilePane(ed));
  inner.appendChild(panes);

  inner.appendChild(skMakeFooter(ed));
  host.replaceChildren(inner);
  host.scrollTop = 0;
  skMountFileView(ed);
}

function skMakeMetaForm(ed) {
  const form = skEl('div', 'sk-meta');
  const nameField = skEl('label', 'sk-field sk-field-name');
  nameField.appendChild(skEl('span', 'sk-field-label', 'Name'));
  const nameRow = skEl('span', 'sk-name-row');
  nameRow.appendChild(skEl('span', 'sk-name-slash', '/'));
  const name = skEl('input', 'sk-input sk-ed-name');
  name.value = ed.name;
  name.placeholder = 'header-gen';
  name.maxLength = 48;
  name.spellcheck = false;
  name.autocomplete = 'off';
  nameRow.appendChild(name);
  nameField.appendChild(nameRow);
  const nameErr = skEl('span', 'sk-field-error');
  nameErr.id = 'sk-ed-name-error';
  nameErr.setAttribute('aria-live', 'polite');
  name.setAttribute('aria-describedby', nameErr.id);
  nameField.appendChild(nameErr);
  form.appendChild(nameField);

  const hintField = skEl('label', 'sk-field sk-field-hint');
  hintField.appendChild(skEl('span', 'sk-field-label', 'Argument hint'));
  const hint = skEl('input', 'sk-input');
  hint.value = ed.hint;
  hint.placeholder = '[topic] [tone]';
  hint.maxLength = 200;
  hintField.appendChild(hint);
  hintField.appendChild(skEl('span', 'sk-field-help', 'Optional. Shown in the composer after /name.'));
  form.appendChild(hintField);

  const descField = skEl('label', 'sk-field sk-field-desc');
  descField.appendChild(skEl('span', 'sk-field-label', 'Description'));
  const desc = skEl('input', 'sk-input');
  desc.value = ed.description;
  desc.placeholder = 'One line: what the skill does and when to use it';
  desc.maxLength = SK_DESC_MAX;
  descField.appendChild(desc);
  const descErr = skEl('span', 'sk-field-error');
  descErr.id = 'sk-ed-desc-error';
  desc.setAttribute('aria-describedby', descErr.id);
  descField.appendChild(descErr);
  form.appendChild(descField);

  const sync = () => {
    skValidate(ed);
    const fe = ed.fieldErrors;
    nameErr.textContent = fe.name || '';
    nameErr.hidden = !fe.name;
    name.setAttribute('aria-invalid', fe.name ? 'true' : 'false');
    descErr.textContent = fe.description || '';
    descErr.hidden = !fe.description;
    desc.setAttribute('aria-invalid', fe.description ? 'true' : 'false');
    skSyncFooter(ed);
  };
  name.addEventListener('input', () => { ed.name = name.value.trim().toLowerCase(); sync(); });
  desc.addEventListener('input', () => { ed.description = desc.value.replace(/[\r\n]+/g, ' '); sync(); });
  hint.addEventListener('input', () => { ed.hint = hint.value; sync(); });
  queueMicrotask(sync);
  return form;
}

function skValidate(ed) {
  const fe = {};
  const nameProblem = skNameProblem(ed.name, ed.id);
  if (nameProblem && (ed.name || ed.touched)) fe.name = nameProblem;
  else if (ed.serverNameError?.name === ed.name) fe.name = ed.serverNameError.error;
  if (!ed.description.trim() && ed.touched) fe.description = 'A description is required. Agents use it to decide when the skill applies.';
  const bodyBytes = new TextEncoder().encode(ed.body).length;
  if (bodyBytes > SKILL_BODY_MAX) fe.body = `SKILL.md is ${skFmtBytes(bodyBytes)}; the limit is ${skFmtBytes(SKILL_BODY_MAX)}. Move reference material into separate files.`;
  else if (/^---\s*\n/.test(ed.body)) fe.body = 'Remove the frontmatter block at the top. Name, description and argument hint come from the fields above.';
  else if (!ed.body.trim()) fe.body = 'SKILL.md needs instructions.';
  let pending = 0;
  for (const f of ed.files.values()) if (f.state !== 'clean' || f.path !== f.origPath) pending += f.bytes ? f.bytes.length : new TextEncoder().encode(f.text || '').length;
  if (pending > SK_SAVE_UPLOAD_MAX) fe.files = `This save uploads ${skFmtBytes(pending)}; save in batches of up to ${skFmtBytes(SK_SAVE_UPLOAD_MAX)}.`;
  ed.fieldErrors = fe;
  return !nameProblem && ed.description.trim() && !fe.body && !fe.files;
}

function skTreeEntries(ed) {
  const folders = new Set(ed.folders);
  for (const p of ed.files.keys()) {
    const segs = p.split('/');
    for (let i = 1; i < segs.length; i++) folders.add(segs.slice(0, i).join('/'));
  }
  const nodes = [...folders].map(p => ({ path: p, folder: true })).concat([...ed.files.keys()].map(p => ({ path: p, folder: false })));
  nodes.sort((a, b) => {
    const as = a.path.split('/'), bs = b.path.split('/');
    for (let i = 0; i < Math.min(as.length, bs.length); i++) {
      if (as[i] === bs[i]) continue;
      const aDir = i < as.length - 1 || a.folder, bDir = i < bs.length - 1 || b.folder;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return as[i].localeCompare(bs[i]);
    }
    return as.length - bs.length;
  });
  return nodes;
}

function skMakeTree(ed) {
  const aside = skEl('div', 'sk-tree');
  const head = skEl('div', 'sk-tree-head');
  const collapsible = window.matchMedia('(max-width: 760px)').matches;
  const toggle = collapsible
    ? skBtn('sk-tree-toggle', 'Files', () => { ed.treeOpen = !ed.treeOpen; skillsRenderEditor(); })
    : skEl('span', 'sk-tree-toggle', 'Files');
  if (collapsible) toggle.setAttribute('aria-expanded', ed.treeOpen ? 'true' : 'false');
  toggle.appendChild(skEl('span', 'sk-tree-count', String(ed.files.size + 1)));
  head.appendChild(toggle);
  const tools = skEl('div', 'sk-tree-tools');
  const inFolder = ed.folder ? ` in ${ed.folder}/` : '';
  tools.appendChild(skBtn('s-icon-btn sk-icon-btn', null, () => skStartAdd(ed, 'file'), `New file${inFolder}`)).appendChild(skIcon(['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M12 11v6', 'M9 14h6']));
  tools.appendChild(skBtn('s-icon-btn sk-icon-btn', null, () => skStartAdd(ed, 'folder'), `New folder${inFolder}`)).appendChild(skIcon(['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M12 11v5', 'M9.5 13.5h5']));
  tools.appendChild(skBtn('s-icon-btn sk-icon-btn', null, () => skUploadInto(ed), `Upload files${inFolder}`)).appendChild(skIcon(['M12 15V4', 'M7 9l5-5 5 5', 'M5 20h14']));
  head.appendChild(tools);
  aside.appendChild(head);

  const list = skEl('ul', 'sk-tree-list');
  list.setAttribute('aria-label', 'Skill files');
  list.appendChild(skMakeTreeRow(ed, { path: SK_MAIN_FILE, folder: false, pinned: true }));
  skTreeEntries(ed).forEach(n => list.appendChild(skMakeTreeRow(ed, n)));
  if (ed.adding) list.appendChild(skMakeAddRow(ed));
  aside.appendChild(list);
  if (ed.fieldErrors.files) aside.appendChild(skEl('div', 'sk-field-error', ed.fieldErrors.files));
  return aside;
}

function skMakeTreeRow(ed, node) {
  const depth = node.pinned ? 0 : node.path.split('/').length - 1;
  const li = skEl('li', 'sk-tree-row');
  li.style.setProperty('--sk-depth', depth);
  const f = node.folder || node.pinned ? null : ed.files.get(node.path);
  const label = node.path.split('/').pop();
  const selected = node.folder ? (ed.selected === null && ed.folder === node.path) : ed.selected === node.path;

  if (ed.confirmDelete === node.path) {
    li.classList.add('sk-tree-confirm');
    const count = node.folder ? [...ed.files.keys()].filter(p => p.startsWith(node.path + '/')).length : 0;
    li.appendChild(skEl('span', 'sk-confirm-text', node.folder ? `Delete ${label}/ and ${count} ${count === 1 ? 'file' : 'files'}?` : `Delete ${label}?`));
    li.appendChild(skBtn('mcp-danger-btn', 'Delete', () => skDeletePath(ed, node)));
    li.appendChild(skBtn('auto-small-btn', 'Cancel', () => { ed.confirmDelete = null; skillsRenderEditor(); }));
    return li;
  }
  if (ed.adding?.rename === node.path) return skMakeAddRow(ed);

  const btn = skBtn('sk-tree-item' + (selected ? ' active' : '') + (node.folder ? ' sk-tree-folder' : ''), null, () => {
    if (node.folder) { ed.folder = node.path; ed.selected = null; }
    else { ed.selected = node.path; ed.folder = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : ''; ed.tab = 'edit'; ed.treeOpen = false; }
    ed.adding = null;
    skillsRenderEditor();
  });
  if (selected) btn.setAttribute('aria-current', 'true');
  btn.appendChild(skIcon(node.folder ? ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'] : ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'], 14));
  btn.appendChild(skEl('span', 'sk-tree-name', node.folder ? label + '/' : label));
  if (f && f.state !== 'clean') btn.appendChild(skEl('span', 'sk-tree-dot', f.state === 'new' ? 'new' : 'edited'));
  if (node.pinned && skSnapshot(ed) !== ed.origin) btn.appendChild(skEl('span', 'sk-tree-dot', 'edited'));
  if (f) btn.appendChild(skEl('span', 'sk-tree-size', skFmtBytes(f.bytes ? f.bytes.length : f.text !== null ? new TextEncoder().encode(f.text).length : f.size)));
  li.appendChild(btn);

  if (!node.pinned) {
    const acts = skEl('span', 'sk-tree-acts');
    if (!node.folder) acts.appendChild(skBtn('s-icon-btn sk-icon-btn', null, () => { ed.adding = { kind: 'file', rename: node.path, value: node.path }; skillsRenderEditor(); }, `Rename ${label}`)).appendChild(skIcon(['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'], 13));
    acts.appendChild(skBtn('s-icon-btn sk-icon-btn', null, () => { ed.confirmDelete = node.path; skillsRenderEditor(); }, `Delete ${label}`)).appendChild(skIcon(['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6'], 13));
    li.appendChild(acts);
  }
  return li;
}

function skStartAdd(ed, kind) {
  ed.adding = { kind, rename: null, value: ed.folder ? ed.folder + '/' : '' };
  ed.treeOpen = true;
  skillsRenderEditor();
}

function skMakeAddRow(ed) {
  const a = ed.adding;
  const li = skEl('li', 'sk-tree-row sk-tree-add');
  const form = skEl('form', 'sk-add-form');
  const input = skEl('input', 'sk-input sk-add-input');
  input.value = a.value;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', a.rename ? 'New path' : a.kind === 'folder' ? 'Folder path' : 'File path');
  input.placeholder = a.kind === 'folder' ? 'scripts' : 'scripts/run.sh';
  const err = skEl('span', 'sk-field-error');
  err.hidden = true;
  const submit = () => {
    const path = input.value.trim().replace(/^\/+|\/+$/g, '');
    const problem = a.kind === 'folder'
      ? (path && [...skTreeEntries(ed)].some(n => n.path.toLowerCase() === path.toLowerCase()) ? `${path} already exists.` : skPathProblem(path, ed, null))
      : skPathProblem(path, ed, a.rename);
    if (problem) { err.textContent = problem; err.hidden = false; input.setAttribute('aria-invalid', 'true'); return; }
    if (a.kind === 'folder') {
      ed.folders.add(path);
      ed.folder = path;
      ed.selected = null;
    } else if (a.rename) {
      const f = ed.files.get(a.rename);
      ed.files.delete(a.rename);
      f.path = path;
      ed.files.set(path, f);
      if (ed.selected === a.rename) ed.selected = path;
    } else {
      ed.files.set(path, { path, size: 0, mode: 0o644, sha256: null, origPath: null, state: 'new', text: '', bytes: null, url: null, loading: false, loadError: null });
      ed.selected = path;
      ed.tab = 'edit';
    }
    ed.adding = null;
    skillsRenderEditor();
  };
  form.addEventListener('submit', e => { e.preventDefault(); submit(); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ed.adding = null; skillsRenderEditor(); } });
  form.appendChild(input);
  const ok = skEl('button', 'auto-small-btn', a.rename ? 'Rename' : 'Add');
  ok.type = 'submit';
  form.appendChild(ok);
  form.appendChild(skBtn('auto-small-btn', 'Cancel', () => { ed.adding = null; skillsRenderEditor(); }));
  li.append(form, err);
  queueMicrotask(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
  return li;
}

function skDeletePath(ed, node) {
  const targets = node.folder ? [...ed.files.keys()].filter(p => p.startsWith(node.path + '/')) : [node.path];
  targets.forEach(p => {
    const f = ed.files.get(p);
    if (f?.origPath) ed.deleted.add(f.origPath);
    if (f?.url) URL.revokeObjectURL(f.url);
    ed.files.delete(p);
  });
  if (node.folder) {
    [...ed.folders].forEach(d => { if (d === node.path || d.startsWith(node.path + '/')) ed.folders.delete(d); });
    if (ed.folder === node.path || ed.folder.startsWith(node.path + '/')) ed.folder = '';
  }
  if (!ed.selected || !ed.files.has(ed.selected)) ed.selected = SK_MAIN_FILE;
  ed.confirmDelete = null;
  skillsRenderEditor();
}

function skUploadInto(ed) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.addEventListener('change', async () => {
    const files = [...(input.files || [])];
    const problems = [];
    for (const file of files) {
      const path = ed.folder ? `${ed.folder}/${file.name}` : file.name;
      const existing = ed.files.get(path);
      const problem = file.size > SK_FILE_MAX ? `${file.name} is larger than ${skFmtBytes(SK_FILE_MAX)}.` : existing ? null : skPathProblem(path, ed, null);
      if (problem) { problems.push(problem); continue; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (existing?.url) URL.revokeObjectURL(existing.url);
      ed.files.set(path, {
        path, size: bytes.length, mode: existing?.mode || 0o644, sha256: null, origPath: existing?.origPath || null,
        state: existing?.origPath ? 'modified' : 'new', text: null, bytes, url: null, loading: false, loadError: null,
      });
      ed.selected = path;
    }
    if (problems.length) showToast(problems.join(' '), { error: true, duration: 6000 });
    skillsRenderEditor();
  });
  input.click();
}

function skMakeFilePane(ed) {
  const pane = skEl('div', 'sk-file');
  const path = ed.selected;
  const head = skEl('div', 'sk-file-head');
  if (!path) {
    head.appendChild(skEl('span', 'sk-file-path', ed.folder + '/'));
    pane.appendChild(head);
    pane.appendChild(skEl('div', 'sk-muted', 'Empty folders are not saved. Add or upload a file here.'));
    return pane;
  }
  head.appendChild(skEl('span', 'sk-file-path', path));
  const isMd = skExt(path) === 'md';
  const f = path === SK_MAIN_FILE ? null : ed.files.get(path);
  const kind = path === SK_MAIN_FILE ? 'text' : skFileKind(path);
  if (isMd && (path === SK_MAIN_FILE || f?.text !== null)) {
    const tabs = skEl('div', 'mcp-seg sk-file-tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'View');
    [['edit', 'Edit'], ['preview', 'Preview']].forEach(([id, label]) => {
      const b = skBtn('mcp-seg-btn', label, () => { ed.tab = id; skillsRenderEditor(); });
      b.setAttribute('aria-pressed', ed.tab === id ? 'true' : 'false');
      tabs.appendChild(b);
    });
    head.appendChild(tabs);
  }
  if (f && (kind !== 'text' || (f.text === null && f.bytes))) {
    head.appendChild(skBtn('auto-small-btn', 'Download', () => skDownload(f)));
  }
  pane.appendChild(head);
  if (path === SK_MAIN_FILE && ed.fieldErrors.body) {
    const err = skEl('div', 'mcp-card-error', ed.fieldErrors.body);
    err.id = 'sk-body-error';
    pane.appendChild(err);
  }
  const body = skEl('div', 'sk-file-body');
  body.id = 'sk-file-body';
  pane.appendChild(body);
  return pane;
}

async function skLoadFile(f) {
  if (f.loading || f.bytes || f.text !== null || !f.sha256) return;
  f.loading = true;
  try {
    const r = await fetch(`/api/skill-blobs/${encodeURIComponent(f.sha256)}`);
    if (r.status === 401) { showLogin(); throw new Error('unauthorized'); }
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    f.bytes = new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    f.loadError = e.message;
  }
  f.loading = false;
}

function skDecodeText(bytes) {
  if (bytes.length > SK_TEXT_PREVIEW_MAX || bytes.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

async function skMountFileView(ed) {
  const body = document.getElementById('sk-file-body');
  if (!body || !ed.selected) return;
  const path = ed.selected;
  if (path === SK_MAIN_FILE) {
    if (ed.tab === 'preview') skRenderPreview(body, ed.body);
    else skMountEditor(body, path, ed.body, text => { ed.body = text; skValidate(ed); skSyncFooter(ed); skSyncBodyError(ed); });
    return;
  }
  const f = ed.files.get(path);
  if (!f) return;
  const kind = skFileKind(path);
  if (f.text === null && !f.bytes) {
    body.appendChild(skEl('div', 'sk-muted', 'Loading file…'));
    await skLoadFile(f);
    if (skillsState.editor !== ed || ed.selected !== path) return;
    if (f.loadError) { body.replaceChildren(skEl('div', 'mcp-card-error', `Couldn’t load ${path}: ${f.loadError}`)); return; }
  }
  if (kind === 'text' && f.text === null && f.bytes) {
    const text = skDecodeText(f.bytes);
    if (text !== null) { f.text = text; if (f.state === 'clean') f.bytes = null; }
  }
  body.replaceChildren();
  if (kind === 'image' && f.bytes) {
    if (!f.url) f.url = URL.createObjectURL(new Blob([f.bytes], { type: SK_IMAGE_MIME[skExt(path)] }));
    const img = skEl('img', 'sk-file-image');
    img.src = f.url;
    img.alt = path;
    body.appendChild(img);
    return;
  }
  if (f.text !== null) {
    if (ed.tab === 'preview' && skExt(path) === 'md') { skRenderPreview(body, f.text); return; }
    skMountEditor(body, path, f.text, text => {
      f.text = text;
      f.bytes = null;
      if (f.state === 'clean') f.state = 'modified';
      skValidate(ed);
      skSyncFooter(ed);
    });
    return;
  }
  const info = skEl('div', 'sk-file-binary');
  info.appendChild(skEl('p', null, `${path} · ${skFmtBytes(f.bytes ? f.bytes.length : f.size)}`));
  info.appendChild(skEl('p', 'sk-muted', 'This file can’t be shown here. Download it to inspect, or upload a replacement into the same folder.'));
  body.appendChild(info);
}

function skRenderPreview(body, text) {
  const div = skEl('div', 'sk-md-preview t-content');
  div.innerHTML = renderMarkdown(text || '');
  body.appendChild(div);
  if (typeof externalLinksNewTab === 'function') externalLinksNewTab(div);
}

async function skMountEditor(body, path, text, onChange) {
  const cm = window._cm || await wsLoadCodeMirror();
  const ed = skillsState.editor;
  if (!ed || ed.selected !== path || !body.isConnected) return;
  body.replaceChildren();
  if (!cm) {
    const ta = skEl('textarea', 'sk-textarea');
    ta.value = text;
    ta.spellcheck = false;
    ta.setAttribute('aria-label', `Contents of ${path}`);
    ta.addEventListener('input', () => onChange(ta.value));
    body.appendChild(ta);
    return;
  }
  const lang = cm.langMap[SK_LANG_BY_EXT[skExt(path)]];
  const extensions = [
    cm.basicSetup, cm.hearthTheme, cm.hearthHighlight, cm.EditorView.lineWrapping,
    cm.EditorView.updateListener.of(u => { if (u.docChanged) onChange(u.state.doc.toString()); }),
    cm.EditorView.contentAttributes.of({ 'aria-label': `Contents of ${path}` }),
  ];
  if (lang) extensions.push(lang());
  skCmView?.destroy();
  skCmView = new cm.EditorView({ state: cm.EditorState.create({ doc: text, extensions }), parent: body });
}

function skDownload(f) {
  const blob = new Blob([f.bytes || new TextEncoder().encode(f.text || '')], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.path.split('/').pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function skSyncBodyError(ed) {
  const existing = document.getElementById('sk-body-error');
  const msg = ed.fieldErrors.body;
  if (!msg) { existing?.remove(); return; }
  if (existing) { existing.textContent = msg; return; }
  const err = skEl('div', 'mcp-card-error', msg);
  err.id = 'sk-body-error';
  document.getElementById('sk-file-body')?.before(err);
}

function skMakeFooter(ed) {
  const foot = skEl('div', 'sk-ed-foot');
  foot.id = 'sk-ed-foot';
  const note = skEl('input', 'sk-input sk-note');
  note.placeholder = ed.id ? 'What changed? (optional)' : 'Note (optional)';
  note.setAttribute('aria-label', 'Revision note');
  note.maxLength = 200;
  note.value = ed.note;
  note.addEventListener('input', () => { ed.note = note.value; });
  foot.appendChild(note);
  const state = skEl('span', 'sk-ed-state');
  state.id = 'sk-ed-state';
  state.setAttribute('aria-live', 'polite');
  foot.appendChild(state);
  if (ed.confirmDiscard) {
    foot.appendChild(skEl('span', 'sk-confirm-text', 'Discard unsaved changes?'));
    foot.appendChild(skBtn('mcp-danger-btn', 'Discard', () => skCloseEditor(true)));
    foot.appendChild(skBtn('auto-small-btn', 'Keep editing', () => { ed.confirmDiscard = false; skillsRenderEditor(); }));
  } else {
    const cancel = skBtn('auto-cancel-btn', 'Cancel', () => skCloseEditor(false));
    cancel.disabled = ed.saving;
    foot.appendChild(cancel);
    const save = skBtn('auto-save-btn sk-save', ed.saving ? 'Saving…' : ed.id ? 'Save' : 'Create skill', () => skSave(ed));
    save.id = 'sk-save';
    foot.appendChild(save);
  }
  if (ed.error) {
    const err = skEl('div', 'mcp-card-error sk-ed-error', ed.error);
    err.setAttribute('role', 'alert');
    foot.appendChild(err);
  }
  queueMicrotask(() => skSyncFooter(ed));
  return foot;
}

function skSyncFooter(ed) {
  const state = document.getElementById('sk-ed-state');
  const save = document.getElementById('sk-save');
  const dirty = skIsDirty(ed);
  if (state) state.textContent = ed.saving ? '' : !ed.id ? '' : dirty ? 'Unsaved changes' : 'All changes saved';
  if (save) save.disabled = ed.saving || (!!ed.id && !dirty);
}

async function skSave(ed) {
  ed.touched = true;
  if (!skValidate(ed)) {
    skillsRenderEditor();
    document.querySelector('.sk-input[aria-invalid="true"]')?.focus();
    return;
  }
  const changed = [...ed.files.values()].filter(f => f.state !== 'clean' || f.path !== f.origPath);
  const toB64 = f => (f.text !== null ? skUtf8ToB64(f.text) : skBytesToB64(f.bytes));
  for (const f of changed) {
    if (f.text === null && !f.bytes) await skLoadFile(f);
    if (f.text === null && !f.bytes) { ed.error = `Couldn’t read ${f.path}: ${f.loadError || 'not loaded'}`; skillsRenderEditor(); return; }
  }
  const files = changed.map(f => ({ path: f.path, content_base64: toB64(f), mode: f.mode }));
  let r;
  ed.saving = true;
  ed.error = null;
  skillsRenderEditor();
  if (!ed.id) {
    const payload = { name: ed.name, description: ed.description.trim(), body: ed.body, files };
    if (ed.hint.trim()) payload.argument_hint = ed.hint.trim();
    if (ed.note.trim()) payload.note = ed.note.trim();
    r = await skillsApi('POST', '/api/skills', payload);
  } else {
    const s = ed.skill;
    const payload = {};
    if (ed.name !== s.name) payload.name = ed.name;
    if (ed.description.trim() !== (s.description || '')) payload.description = ed.description.trim();
    if (ed.hint.trim() !== (s.argument_hint || '')) payload.argument_hint = ed.hint.trim() || null;
    if (ed.body !== (s.body || '')) payload.body = ed.body;
    if (files.length) payload.upsert_files = files;
    const moved = changed.filter(f => f.origPath && f.origPath !== f.path).map(f => f.origPath);
    const del = [...new Set([...ed.deleted, ...moved])].filter(p => !ed.files.has(p));
    if (del.length) payload.delete_files = del;
    if (ed.note.trim()) payload.note = ed.note.trim();
    r = await skillsApi('PATCH', `/api/skills/${ed.id}`, payload);
  }
  if (skillsState.editor !== ed) return;
  ed.saving = false;
  if (!r.ok) {
    const nameError = /^name_/.test(r.code || '');
    ed.error = nameError ? null : r.error;
    if (nameError) ed.serverNameError = { name: ed.name, error: r.error };
    skillsRenderEditor();
    if (nameError) document.querySelector('.sk-ed-name')?.focus();
    return;
  }
  const skill = r.data?.skill;
  showToast(ed.id ? `/${skill?.name || ed.name} saved` : `/${skill?.name || ed.name} created`);
  const selected = ed.selected;
  skDisposeEditor();
  skillsState.editor = skNewEditor(skill);
  if (selected && (selected === SK_MAIN_FILE || skillsState.editor.files.has(selected))) skillsState.editor.selected = selected;
  skillsLoad();
  skillsRenderEditor();
}
