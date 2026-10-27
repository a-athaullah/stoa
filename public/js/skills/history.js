// ── Skills editor: revision history, diff vs the active revision, restore, export ──────────────
const SK_DIFF_MAX_CELLS = 4_000_000;
const SK_DIFF_CONTEXT = 3;
const SK_ICON_DOWNLOAD = ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'];

const skExporting = new Set();

function skHistState(ed) {
  if (!ed.hist) ed.hist = { list: null, loading: false, error: null, sel: null, revs: new Map(), view: 'diff', confirm: null, restoring: false };
  return ed.hist;
}

async function skHistLoad(ed) {
  const h = skHistState(ed);
  h.loading = true;
  h.error = null;
  skRenderHistory(ed);
  const r = await skillsApi('GET', `/api/skills/${ed.id}/revisions`);
  if (skillsState.editor !== ed) return;
  h.loading = false;
  if (!r.ok) { h.error = r.error; skRenderHistory(ed); return; }
  h.list = Array.isArray(r.data?.revisions) ? r.data.revisions : [];
  h.revs.clear();
  if (!h.list.some(x => x.version === h.sel)) h.sel = (h.list.find(x => !x.current) || h.list[0])?.version ?? null;
  skRenderHistory(ed);
}

// Re-renders only the history pane, so picking a revision keeps the scroll position.
function skRenderHistory(ed) {
  const old = document.getElementById('sk-hist');
  if (!old || skillsState.editor !== ed || ed.mode !== 'history') { skillsRenderEditor(); return; }
  old.replaceWith(skMakeHistory(ed));
}

function skSyncExportBtns() {
  document.querySelectorAll('[data-export-key]').forEach(b => { b.disabled = skExporting.has(b.dataset.exportKey); });
}

function skHistActive(h) {
  return h.list?.find(x => x.current) || null;
}

async function skHistFetchRev(ed, version) {
  const h = skHistState(ed);
  if (h.revs.has(version)) return;
  h.revs.set(version, { loading: true });
  const r = await skillsApi('GET', `/api/skills/${ed.id}/revisions/${version}`);
  if (skillsState.editor !== ed || ed.hist !== h) return;
  h.revs.set(version, r.ok ? { data: r.data?.revision } : { error: r.error });
  skRenderHistory(ed);
}

function skSetEditorMode(ed, mode) {
  ed.mode = mode;
  if (mode === 'history' && !skHistState(ed).list && !ed.hist.loading) { skHistLoad(ed); return; }
  skillsRenderEditor();
}

function skAuthorEl(rev) {
  return skCreatorEl({
    created_by_actor_id: rev.author_actor_id, created_by_sub_agent_id: rev.author_sub_agent_id,
    creator_name: rev.author_sub_agent_label || rev.author_name,
  });
}

function skMakeHistory(ed) {
  const h = skHistState(ed);
  const wrap = skEl('div', 'sk-panes sk-hist');
  wrap.id = 'sk-hist';
  if (h.loading && !h.list) { wrap.appendChild(skEl('div', 'sk-muted sk-hist-msg', 'Loading history…')); return wrap; }
  if (h.error) {
    const box = skEl('div', 'sk-hist-msg');
    box.appendChild(skEl('div', 'mcp-card-error', `Couldn’t load history: ${h.error}`));
    box.appendChild(skBtn('auto-small-btn', 'Try again', () => skHistLoad(ed)));
    wrap.appendChild(box);
    return wrap;
  }
  const list = skEl('ul', 'sk-hist-list');
  list.setAttribute('aria-label', 'Revisions');
  (h.list || []).forEach(rev => list.appendChild(skMakeHistRow(ed, rev)));
  wrap.appendChild(list);
  wrap.appendChild(skMakeHistDetail(ed));
  return wrap;
}

function skMakeHistRow(ed, rev) {
  const h = ed.hist;
  const li = skEl('li', 'sk-hist-row');
  const main = skBtn('sk-hist-item' + (rev.version === h.sel ? ' active' : ''), null, () => {
    h.sel = rev.version;
    h.confirm = null;
    skRenderHistory(ed);
  });
  main.setAttribute('aria-pressed', rev.version === h.sel ? 'true' : 'false');
  const top = skEl('span', 'sk-hist-top');
  top.appendChild(skEl('span', 'sk-hist-ver', `v${rev.version}`));
  if (rev.current) top.appendChild(skEl('span', 'sk-badge', 'Active'));
  const when = skEl('span', 'sk-hist-when', _relativeTime(rev.created_at));
  when.title = mcpLocalTime(rev.created_at);
  top.appendChild(when);
  main.appendChild(top);
  main.appendChild(skEl('span', 'sk-hist-note' + (rev.note ? '' : ' sk-hist-note-empty'), rev.note || rev.source_url || 'No note'));
  const meta = skEl('span', 'sk-hist-meta');
  meta.appendChild(skAuthorEl(rev));
  const files = Number(rev.file_count) || 0;
  meta.appendChild(skEl('span', null, `${files} ${files === 1 ? 'file' : 'files'} · ${skFmtBytes(rev.total_bytes)}`));
  main.appendChild(meta);
  li.appendChild(main);
  const dl = skBtn('s-icon-btn sk-hist-export', null, () => skExport(ed.skill, rev.version), `Export v${rev.version} as .zip`);
  dl.appendChild(skIcon(SK_ICON_DOWNLOAD, 14));
  dl.dataset.exportKey = `${ed.id}:${rev.version}`;
  dl.disabled = skExporting.has(dl.dataset.exportKey);
  li.appendChild(dl);
  return li;
}

function skMakeHistDetail(ed) {
  const h = ed.hist;
  const pane = skEl('div', 'sk-file sk-hist-detail');
  const active = skHistActive(h);
  const sel = h.list?.find(x => x.version === h.sel);
  if (!sel || !active) { pane.appendChild(skEl('div', 'sk-muted sk-hist-msg', 'No revisions yet.')); return pane; }
  const isActive = sel.version === active.version;

  const head = skEl('div', 'sk-file-head');
  head.appendChild(skEl('span', 'sk-file-path', isActive ? `v${sel.version} · active version` : `v${sel.version} compared with v${active.version} (active)`));
  const tabs = skEl('div', 'mcp-seg sk-file-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'View');
  [['diff', 'Changes'], ['full', 'SKILL.md']].forEach(([id, label]) => {
    const b = skBtn('mcp-seg-btn', label, () => { h.view = id; skRenderHistory(ed); });
    b.setAttribute('aria-pressed', (isActive ? 'full' : h.view) === id ? 'true' : 'false');
    b.disabled = id === 'diff' && isActive;
    tabs.appendChild(b);
  });
  head.appendChild(tabs);
  pane.appendChild(head);

  const acts = skEl('div', 'sk-hist-acts');
  if (h.confirm === sel.version) {
    const msg = skIsDirty(ed) ? `Restore v${sel.version} as a new version? Your unsaved edits will be discarded.` : `Restore v${sel.version} as a new version?`;
    acts.appendChild(skEl('span', 'sk-confirm-text', msg));
    const yes = skBtn('auto-save-btn', h.restoring ? 'Restoring…' : 'Restore', () => skRestore(ed, sel.version));
    queueMicrotask(() => { if (!h.restoring) yes.focus(); });
    yes.disabled = h.restoring;
    acts.appendChild(yes);
    const no = skBtn('auto-cancel-btn', 'Cancel', () => { h.confirm = null; skRenderHistory(ed); });
    no.disabled = h.restoring;
    acts.appendChild(no);
  } else {
    const exp = skBtn('auto-small-btn', `Export v${sel.version}`, () => skExport(ed.skill, sel.version), `Download v${sel.version} as .zip`);
    exp.dataset.exportKey = `${ed.id}:${sel.version}`;
    exp.disabled = skExporting.has(exp.dataset.exportKey);
    acts.appendChild(exp);
    if (!isActive) acts.appendChild(skBtn('auto-small-btn', `Restore v${sel.version}`, () => { h.confirm = sel.version; skRenderHistory(ed); }));
  }
  pane.appendChild(acts);

  const body = skEl('div', 'sk-hist-body');
  pane.appendChild(body);
  const want = isActive || h.view === 'full' ? [sel.version] : [sel.version, active.version];
  const revs = want.map(v => h.revs.get(v));
  want.forEach((v, i) => { if (!revs[i]) skHistFetchRev(ed, v); });
  const failed = revs.find(x => x?.error);
  if (failed) { body.appendChild(skEl('div', 'mcp-card-error', `Couldn’t load revision: ${failed.error}`)); return pane; }
  if (revs.some(x => !x?.data)) { body.appendChild(skEl('div', 'sk-muted', 'Loading revision…')); return pane; }

  if (isActive || h.view === 'full') {
    body.appendChild(skEl('pre', 'sk-hist-full', revs[0].data.body || ''));
    return pane;
  }
  body.appendChild(skMakeFileSummary(revs[0].data, revs[1].data));
  body.appendChild(skMakeBodyDiff(revs[1].data.body || '', revs[0].data.body || '', sel.version, active.version));
  return pane;
}

function skMakeFileSummary(sel, active) {
  const box = skEl('div', 'sk-hist-files');
  const a = new Map((active.files || []).filter(f => f.path !== SK_MAIN_FILE).map(f => [f.path, f]));
  const s = new Map((sel.files || []).filter(f => f.path !== SK_MAIN_FILE).map(f => [f.path, f]));
  const rows = [];
  for (const [p, f] of s) {
    const cur = a.get(p);
    if (!cur) rows.push([p, `only in v${sel.version}`, f.size]);
    else if (cur.sha256 !== f.sha256) rows.push([p, 'differs', f.size]);
    else if (cur.mode !== f.mode) rows.push([p, 'mode differs', f.size]);
  }
  for (const [p, f] of a) if (!s.has(p)) rows.push([p, 'only in active', f.size]);
  box.appendChild(skEl('div', 'sk-field-label', 'Other files'));
  if (!rows.length) { box.appendChild(skEl('div', 'sk-hist-same', 'No other files differ.')); return box; }
  const ul = skEl('ul', 'sk-preview-files');
  rows.sort((x, y) => x[0].localeCompare(y[0])).forEach(([p, kind, size]) => {
    const li = skEl('li', 'sk-preview-file');
    li.appendChild(skEl('span', 'sk-preview-path', p));
    li.appendChild(skEl('span', 'sk-badge', kind));
    li.appendChild(skEl('span', 'sk-preview-size', skFmtBytes(size)));
    ul.appendChild(li);
  });
  box.appendChild(ul);
  return box;
}

// Line diff from `a` (active) to `b` (selected): common prefix/suffix trimmed, LCS on the rest.
function skLineDiff(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  let pre = 0;
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
  let suf = 0;
  while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
  const xs = x.slice(pre, x.length - suf);
  const ys = y.slice(pre, y.length - suf);
  const n = xs.length;
  const m = ys.length;
  if ((n + 1) * (m + 1) > SK_DIFF_MAX_CELLS) return null;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = xs[i] === ys[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const ops = x.slice(0, pre).map(t => ({ op: ' ', t }));
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && xs[i] === ys[j]) { ops.push({ op: ' ', t: xs[i] }); i++; j++; }
    else if (i < n && (j === m || dp[(i + 1) * w + j] >= dp[i * w + j + 1])) { ops.push({ op: '-', t: xs[i] }); i++; }
    else { ops.push({ op: '+', t: ys[j] }); j++; }
  }
  x.slice(x.length - suf).forEach(t => ops.push({ op: ' ', t }));
  return ops;
}

function skMakeBodyDiff(activeBody, selBody, selV, activeV) {
  const box = skEl('div', 'sk-hist-diffbox');
  const head = skEl('div', 'sk-hist-diffhead');
  head.appendChild(skEl('span', 'sk-field-label', 'SKILL.md'));
  if (activeBody !== selBody) {
    head.appendChild(skEl('span', 'sk-hist-legend sk-diff-del', `− v${activeV} (active)`));
    head.appendChild(skEl('span', 'sk-hist-legend sk-diff-add', `+ v${selV}`));
  }
  box.appendChild(head);
  if (activeBody === selBody) { box.appendChild(skEl('div', 'sk-hist-same', 'SKILL.md is identical.')); return box; }
  const ops = skLineDiff(activeBody, selBody);
  if (!ops) { box.appendChild(skEl('div', 'sk-hist-same', 'Too many changes for a line diff. Open the SKILL.md view to read this version.')); return box; }
  const keep = new Uint8Array(ops.length);
  ops.forEach((o, k) => {
    if (o.op === ' ') return;
    for (let c = Math.max(0, k - SK_DIFF_CONTEXT); c <= Math.min(ops.length - 1, k + SK_DIFF_CONTEXT); c++) keep[c] = 1;
  });
  const pre = skEl('div', 'sk-diff');
  pre.setAttribute('role', 'table');
  pre.setAttribute('aria-label', `SKILL.md changes, v${activeV} to v${selV}`);
  let skipped = 0;
  const flush = () => {
    if (!skipped) return;
    pre.appendChild(skEl('div', 'sk-diff-gap', `${skipped} unchanged ${skipped === 1 ? 'line' : 'lines'}`));
    skipped = 0;
  };
  ops.forEach((o, k) => {
    if (!keep[k]) { skipped++; return; }
    flush();
    const row = skEl('div', 'sk-diff-line' + (o.op === '+' ? ' sk-diff-add' : o.op === '-' ? ' sk-diff-del' : ''));
    row.setAttribute('role', 'row');
    const sign = skEl('span', 'sk-diff-sign', o.op === ' ' ? '' : o.op === '+' ? '+' : '−');
    sign.setAttribute('aria-label', o.op === '+' ? 'added' : o.op === '-' ? 'removed' : 'unchanged');
    row.appendChild(sign);
    row.appendChild(skEl('span', 'sk-diff-text', o.t));
    pre.appendChild(row);
  });
  flush();
  box.appendChild(pre);
  return box;
}

async function skRestore(ed, version) {
  const h = ed.hist;
  h.restoring = true;
  skRenderHistory(ed);
  const r = await skillsApi('POST', `/api/skills/${ed.id}/revisions/${version}/restore`);
  if (skillsState.editor !== ed) return;
  h.restoring = false;
  if (!r.ok) {
    h.confirm = null;
    showToast(`Couldn’t restore v${version}: ${r.error}`, { error: true });
    skRenderHistory(ed);
    return;
  }
  const skill = r.data?.skill;
  skDisposeEditor();
  const next = skNewEditor(skill);
  next.mode = 'history';
  skillsState.editor = next;
  showToast(skill?.version > ed.skill.version ? `Restored v${version} as v${skill.version}` : `v${version} already matches the active version`);
  skillsRenderEditor();
  skillsLoad();
  skHistLoad(next);
}

// Always pinned to a version, so the editor's Export matches what it shows even if a newer one landed.
// Per-revision exports get the version in the name, so several of them don't overwrite each other.
async function skExport(skill, version, plainName) {
  const key = `${skill.id}:${plainName ? '' : version}`;
  if (skExporting.has(key)) return;
  skExporting.add(key);
  skSyncExportBtns();
  try {
    const res = await fetch(`/api/skills/${skill.id}/export?version=${version}`);
    if (res.status === 401) { showLogin(); return; }
    if (!res.ok) {
      let err = `${res.status} ${res.statusText}`;
      try { err = (await res.json()).error || err; } catch {}
      showToast(`Couldn’t export /${skill.name}: ${err}`, { error: true });
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = plainName ? `${skill.name}.zip` : `${skill.name}-v${version}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    showToast(`Couldn’t export /${skill.name}: network error`, { error: true });
  } finally {
    skExporting.delete(key);
    skSyncExportBtns();
  }
}
