// ── Skills tab: git source (check for updates, update, detach) ───────────────
function skShortSha(sha) {
  return sha ? String(sha).slice(0, 7) : '';
}

function skGitLabel(url, ref, path) {
  return [url, ref ? `@ ${ref}` : '', path ? `/ ${path}` : ''].filter(Boolean).join(' ');
}

function skSourceState(ed) {
  if (!ed.src) ed.src = { busy: null, confirm: null, error: null };
  return ed.src;
}

// The list rows read the same source object, so the badge follows a check or detach without a reload.
function skStoreSource(ed, source) {
  ed.skill.source = source;
  const row = skillsState.skills.find(s => s.id === ed.id);
  if (row) row.source = source ? { ...source } : null;
}

function skMakeSource(ed) {
  const source = ed.skill?.source;
  const st = skSourceState(ed);
  const box = skEl('section', 'sk-source');
  box.id = 'sk-source';
  box.setAttribute('aria-label', 'Source');

  const head = skEl('div', 'sk-source-head');
  head.appendChild(skEl('span', 'sk-field-label', 'Source'));
  if (source.update_available) head.appendChild(skEl('span', 'sk-badge sk-badge-update', 'Update available'));
  box.appendChild(head);

  box.appendChild(skEl('div', 'sk-source-url', source.url));
  const meta = skEl('div', 'sk-source-meta');
  meta.appendChild(skEl('span', null, source.ref ? `Ref ${source.ref}` : 'Default branch'));
  if (source.path) meta.appendChild(skEl('span', null, `Folder ${source.path}`));
  if (source.commit) {
    const c = skEl('span', 'sk-source-sha', `Commit ${skShortSha(source.commit)}`);
    c.title = source.commit;
    meta.appendChild(c);
  }
  if (source.update_available && source.checked_commit) {
    const c = skEl('span', 'sk-source-sha', `Latest ${skShortSha(source.checked_commit)}`);
    c.title = source.checked_commit;
    meta.appendChild(c);
  }
  if (source.local_changes) meta.appendChild(skEl('span', null, 'Edited since the last import'));
  const when = skEl('span', null, source.checked_at ? `Checked ${_relativeTime(source.checked_at)}` : 'Not checked yet');
  if (source.checked_at) when.title = mcpLocalTime(source.checked_at);
  meta.appendChild(when);
  box.appendChild(meta);

  const acts = skEl('div', 'sk-source-acts');
  const busy = !!st.busy || ed.saving;
  if (st.confirm === 'detach') {
    acts.appendChild(skEl('span', 'sk-confirm-text', 'Stop tracking this repository? The skill and its history stay.'));
    const yes = skBtn('mcp-danger-btn', st.busy === 'detach' ? 'Detaching…' : 'Detach', () => skDetachSource(ed));
    yes.disabled = busy;
    const no = skBtn('auto-small-btn', 'Cancel', () => { st.confirm = null; skSyncSource(ed); });
    no.disabled = busy;
    acts.append(yes, no);
  } else if (st.confirm === 'local') {
    acts.appendChild(skEl('span', 'sk-confirm-text', 'This skill was edited after the last git import. Updating replaces those edits with the repository version; they stay in History.'));
    const yes = skBtn('auto-save-btn', st.busy === 'update' ? 'Updating…' : 'Update anyway', () => skUpdateSource(ed, true));
    yes.disabled = busy;
    const no = skBtn('auto-small-btn', 'Cancel', () => { st.confirm = null; skSyncSource(ed); });
    no.disabled = busy;
    acts.append(yes, no);
  } else {
    const check = skBtn('auto-small-btn', st.busy === 'check' ? 'Checking…' : 'Check for updates', () => skCheckSource(ed));
    check.disabled = busy;
    acts.appendChild(check);
    const dirty = skIsDirty(ed);
    const update = skBtn(source.update_available ? 'auto-save-btn' : 'auto-small-btn', st.busy === 'update' ? 'Updating…' : 'Update', () => skUpdateSource(ed, false));
    update.id = 'sk-source-update';
    update.disabled = busy || dirty;
    if (dirty) update.title = 'Save or discard your edits first';
    acts.appendChild(update);
    const detach = skBtn('mcp-link-btn sk-source-detach', 'Detach', () => { st.confirm = 'detach'; st.error = null; skSyncSource(ed); });
    detach.disabled = busy;
    acts.appendChild(detach);
  }
  box.appendChild(acts);

  if (st.error) {
    const err = skEl('div', 'mcp-card-error', st.error);
    err.setAttribute('role', 'alert');
    box.appendChild(err);
  }
  return box;
}

// Replaced in place so CodeMirror keeps focus while a check runs in the background.
function skSyncSource(ed) {
  if (skillsState.editor !== ed) return;
  const old = document.getElementById('sk-source');
  if (!ed.skill?.source) { old?.remove(); return; }
  const box = skMakeSource(ed);
  if (old) { old.replaceWith(box); return; }
  const anchor = document.querySelector('.sk-editor #sk-conflict') || document.querySelector('.sk-editor .sk-ed-modes');
  if (anchor) anchor.after(box);
  else skillsRenderEditor();
}

async function skSourceCall(ed, kind, method, suffix, body) {
  const st = skSourceState(ed);
  st.busy = kind;
  st.error = null;
  skSyncSource(ed);
  const r = await skillsApi(method, `/api/skills/${ed.id}/source${suffix}`, body);
  st.busy = null;
  return r;
}

async function skCheckSource(ed) {
  const r = await skSourceCall(ed, 'check', 'POST', '/check');
  if (skillsState.editor !== ed) return;
  const st = skSourceState(ed);
  if (!r.ok) { st.error = r.error; skSyncSource(ed); return; }
  const d = r.data || {};
  if (ed.skill.source) {
    skStoreSource(ed, {
      ...ed.skill.source,
      commit: d.commit || ed.skill.source.commit,
      checked_commit: d.remote_commit || null,
      checked_at: new Date().toISOString(),
      update_available: !!d.update_available,
    });
  }
  skSyncSource(ed);
  showToast(d.update_available ? `Update available: ${skShortSha(d.remote_commit)}` : `/${ed.skill.name} is up to date`);
}

// Edits made after the last git import are replaced by the update, so they need a yes first.
async function skUpdateSource(ed, confirmed) {
  if (skIsDirty(ed)) return;
  if (!confirmed && ed.skill.source?.local_changes) {
    const st = skSourceState(ed);
    st.confirm = 'local';
    st.error = null;
    skSyncSource(ed);
    return;
  }
  const r = await skSourceCall(ed, 'update', 'POST', '/update');
  const st = skSourceState(ed);
  const name = ed.skill.name;
  st.confirm = null;
  if (!r.ok) {
    if (skillsState.editor !== ed) { showToast(`Couldn’t update /${name}: ${r.error}`, { error: true }); return; }
    st.error = r.error;
    skSyncSource(ed);
    return;
  }
  const d = r.data || {};
  const sha = skShortSha(d.skill?.source?.commit || d.commit);
  if (!d.updated) showToast(`/${name} already matches the repository`);
  else if (d.local_changes && !confirmed) showToast(`/${name} updated${sha ? ` to ${sha}` : ''}; your earlier edits are still in History`, { duration: 6000 });
  else showToast(`/${name} updated${sha ? ` to ${sha}` : ''}`);
  if (skillsState.editor !== ed) return;
  skReloadEditor(ed, d.skill || null);
}

async function skDetachSource(ed) {
  const r = await skSourceCall(ed, 'detach', 'DELETE', '');
  if (skillsState.editor !== ed) return;
  const st = skSourceState(ed);
  if (!r.ok) { st.error = r.error; skSyncSource(ed); return; }
  st.confirm = null;
  skStoreSource(ed, null);
  skSyncSource(ed);
  showToast(`/${ed.skill.name} no longer tracks its repository`);
}
