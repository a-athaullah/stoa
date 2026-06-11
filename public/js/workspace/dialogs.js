function wsShowToast(message, kind) {
  let stack = document.querySelector('.ws-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'ws-toast-stack';
    const panel = document.getElementById('ws-panel-body') || document.getElementById('workspace-panel');
    if (panel) { panel.style.position = 'relative'; panel.appendChild(stack); }
  }
  const toast = document.createElement('div');
  toast.className = 'ws-toast';
  const iconColor = kind === 'error' ? '#c08378' : '#7faa7c';
  const iconSvg = kind === 'error'
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 4.5l8.5 15H3.5z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.6" r=".7" fill="currentColor" stroke="none"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  toast.innerHTML = '<span style="color:' + iconColor + ';display:inline-flex;flex:0 0 auto">' + iconSvg + '</span><span style="flex:1;line-height:1.4">' + wsEscHtml(message) + '</span>';
  if (kind === 'error') {
    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'border:none;background:transparent;color:var(--h-ink-faint);cursor:pointer;padding:2px;display:inline-flex';
    closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    closeBtn.onclick = () => toast.remove();
    toast.appendChild(closeBtn);
  }
  stack.appendChild(toast);
  if (kind !== 'error') setTimeout(() => toast.remove(), 2500);
}

function wsShowDialog(title, bodyHtml, actions) {
  const panel = document.getElementById('ws-panel-body') || document.getElementById('workspace-panel');
  if (!panel) return;
  const existing = panel.querySelector('.ws-scrim');
  if (existing) existing.remove();
  const scrim = document.createElement('div');
  scrim.className = 'ws-scrim';
  const dialog = document.createElement('div');
  dialog.className = 'ws-dialog';
  dialog.style.width = '420px';
  dialog.innerHTML = '<div class="h-serif" style="font-size:20px;color:var(--h-ink);margin-bottom:13px">' + wsEscHtml(title) + '</div>'
    + '<div style="font-family:var(--h-sans);font-size:14px;line-height:1.62;color:var(--h-ink-mute);margin-bottom:22px">' + DOMPurify.sanitize(bodyHtml) + '</div>';
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:9px;justify-content:flex-end;flex-wrap:wrap';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'ws-edit-btn ' + (a.cls || 'ghost');
    btn.textContent = a.label;
    btn.onclick = () => { scrim.remove(); if (a.action) a.action(); };
    btns.appendChild(btn);
  });
  dialog.appendChild(btns);
  scrim.appendChild(dialog);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  panel.style.position = 'relative';
  panel.appendChild(scrim);
}

function wsEscHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

function wsShowCtxMenu(x, y, relPath, isDir) {
  wsCloseCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'ws-ctx-menu';
  const panelRect = document.getElementById('ws-panel-body')?.getBoundingClientRect();
  menu.style.left = (panelRect ? x - panelRect.left : x) + 'px';
  menu.style.top = (panelRect ? y - panelRect.top : y) + 'px';
  const items = [
    { label: 'New File', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 4h9l5 5v11H5z"/><path d="M14 4v5h5"/><path d="M12 12v5M9.5 14.5h5"/></svg>', action: () => wsPromptNewFile(isDir ? relPath : relPath.split('/').slice(0, -1).join('/')) },
    { label: 'New Folder', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/></svg>', action: () => wsPromptNewFolder(isDir ? relPath : relPath.split('/').slice(0, -1).join('/')) },
    { div: true },
    { label: 'Rename', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M16.5 4.5l3 3L8 19l-3.5.5L5 16z"/><path d="M14 7l3 3"/></svg>', action: () => wsPromptRename(relPath) },
    { div: true },
    { label: 'Delete', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4.5 7h15"/><path d="M9.5 7V5.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7l.9 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.5 7"/></svg>', danger: true, action: () => wsConfirmDelete(relPath) },
  ];
  items.forEach(it => {
    if (it.div) { const d = document.createElement('div'); d.style.cssText = 'height:1px;background:var(--h-hair-soft);margin:5px 7px'; menu.appendChild(d); return; }
    const item = document.createElement('div');
    item.className = 'ws-ctx-item' + (it.danger ? ' danger' : '');
    item.innerHTML = '<span style="display:inline-flex;color:' + (it.danger ? '#c08378' : 'var(--h-ink-mute)') + '">' + it.icon + '</span><span style="flex:1">' + it.label + '</span>';
    item.onclick = () => { wsCloseCtxMenu(); it.action(); };
    menu.appendChild(item);
  });
  const panel = document.getElementById('ws-panel-body');
  if (panel) { panel.style.position = 'relative'; panel.appendChild(menu); }
  setTimeout(() => document.addEventListener('click', wsCloseCtxMenu, { once: true }), 0);
}

function wsCloseCtxMenu() {
  document.querySelectorAll('.ws-ctx-menu').forEach(m => m.remove());
}

function wsShowPrompt(title, defaultValue, placeholder, callback) {
  const panel = document.getElementById('ws-panel-body') || document.getElementById('workspace-panel');
  if (!panel) return;
  const existing = panel.querySelector('.ws-scrim');
  if (existing) existing.remove();
  const scrim = document.createElement('div');
  scrim.className = 'ws-scrim';
  const dialog = document.createElement('div');
  dialog.className = 'ws-dialog';
  dialog.style.width = '380px';
  dialog.innerHTML = '<div class="h-serif" style="font-size:20px;color:var(--h-ink);margin-bottom:16px">' + wsEscHtml(title) + '</div>';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = defaultValue || '';
  input.placeholder = placeholder || '';
  input.spellcheck = false;
  input.style.cssText = 'width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--h-hair-soft);background:var(--h-bg);color:var(--h-ink);font-family:var(--h-sans);font-size:14px;outline:none;margin-bottom:18px;box-sizing:border-box';
  input.addEventListener('focus', () => { input.style.borderColor = 'oklch(0.78 0.085 78)'; input.style.boxShadow = '0 0 0 3px color-mix(in srgb, oklch(0.78 0.085 78) 22%, transparent)'; });
  input.addEventListener('blur', () => { input.style.borderColor = 'var(--h-hair-soft)'; input.style.boxShadow = 'none'; });
  dialog.appendChild(input);
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:9px;justify-content:flex-end';
  const submit = () => { const v = input.value.trim(); scrim.remove(); if (v) callback(v); };
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'ws-edit-btn ghost';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => scrim.remove();
  btns.appendChild(cancelBtn);
  const okBtn = document.createElement('button');
  okBtn.className = 'ws-edit-btn primary';
  okBtn.textContent = 'OK';
  okBtn.onclick = submit;
  btns.appendChild(okBtn);
  dialog.appendChild(btns);
  scrim.appendChild(dialog);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') scrim.remove(); });
  panel.style.position = 'relative';
  panel.appendChild(scrim);
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

function wsPromptNewFile(parentDir) {
  wsShowPrompt('New file', '', 'filename.js', (name) => {
    const filePath = parentDir ? parentDir + '/' + name : name;
    ws.send(JSON.stringify({ type: 'file_create', path: filePath, is_dir: false }));
  });
}

function wsPromptNewFolder(parentDir) {
  wsShowPrompt('New folder', '', 'folder-name', (name) => {
    const filePath = parentDir ? parentDir + '/' + name : name;
    ws.send(JSON.stringify({ type: 'file_create', path: filePath, is_dir: true }));
  });
}

function wsPromptRename(relPath) {
  const oldName = relPath.split('/').pop();
  wsShowPrompt('Rename', oldName, oldName, (newName) => {
    if (newName === oldName) return;
    const parentDir = relPath.split('/').slice(0, -1).join('/');
    const newPath = parentDir ? parentDir + '/' + newName : newName;
    ws.send(JSON.stringify({ type: 'file_rename', path: relPath, new_path: newPath }));
  });
}

function wsConfirmDelete(relPath) {
  const fileName = relPath.split('/').pop();
  wsShowDialog('Delete file?', 'Delete <strong>' + wsEscHtml(fileName) + '</strong>? This removes it from disk and can\'t be undone.',
    [{ label: 'Cancel', cls: 'ghost' }, { label: 'Delete', cls: 'danger', action: () => ws.send(JSON.stringify({ type: 'file_delete', path: relPath })) }]);
}

