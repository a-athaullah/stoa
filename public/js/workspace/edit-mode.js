// ── Editor functions ──────────────────────────────────────────────────────
function wsEnterEditMode() {
  if (wsEditMode) return;
  const file = wsOpenFiles.find(f => f.name === wsActiveFile);
  if (!file || !file.loaded) return;
  const IMG_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp','pdf']);
  if (IMG_EXTS.has(file.ext)) return;
  wsEditMode = true;
  wsEditContent = file.content || '';
  wsEditDirty = false;
  wsEditSaving = false;
  wsRenderContent();
  wsRenderTabs();
  wsCheckDraft();
}

function wsExitEditMode(force) {
  if (!wsEditMode) return;
  if (wsEditDirty && !force) {
    wsShowDialog('Discard changes?', 'You have unsaved changes to <strong>' + wsEscHtml(wsActiveFile?.split('/').pop()) + '</strong>. Close and discard them?',
      [{ label: 'Keep editing', cls: 'ghost' }, { label: 'Discard', cls: 'danger', action: () => wsExitEditMode(true) }]);
    return;
  }
  wsEditMode = false;
  wsEditContent = '';
  wsEditDirty = false;
  wsEditSaving = false;
  if (wsEditorView) { wsEditorView.destroy(); wsEditorView = null; }
  if (wsExpanded) wsToggleExpand();
  wsRenderContent();
  wsRenderTabs();
}

function wsSaveFile() {
  if (!wsEditMode || !wsActiveFile || wsEditSaving) return;
  if (!wsEditDirty) return;
  if (wsEditorView) wsEditContent = wsEditorView.state.doc.toString();
  wsEditSaving = true;
  wsRenderToolbarActions();
  const isAbs = /^\//.test(wsActiveFile) || /^[A-Za-z]:/.test(wsActiveFile);
  const req = { type: 'file_write', path: wsActiveFile, content: wsEditContent, absolute: isAbs };
  if (wsFileMtimes[wsActiveFile]) req.expected_mtime = wsFileMtimes[wsActiveFile];
  ws.send(JSON.stringify(req));
}

function wsToggleExpand() {
  wsExpanded = !wsExpanded;
  const panel = document.getElementById('workspace-panel');
  const chat = document.getElementById('chat-inner');
  panel.classList.toggle('ws-expanded', wsExpanded);
  if (chat) chat.style.display = wsExpanded ? 'none' : '';
  wsRenderToolbarActions();
}

function wsRenderToolbarActions() {
  const act = document.getElementById('ws-toolbar-actions');
  if (!act) return;
  act.innerHTML = '';
  if (wsActiveView === 'file' && wsActiveFile) {
    const file = wsOpenFiles.find(f => f.name === wsActiveFile);
    if (!file) return;
    const IMG_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp','pdf']);
    if (IMG_EXTS.has(file.ext)) return;
    if (wsEditMode) {
      const saveState = wsEditSaving ? 'saving' : wsEditDirty ? 'dirty' : 'clean';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'ws-edit-btn ' + (saveState === 'saving' ? 'accent-muted' : saveState === 'dirty' ? 'accent' : 'ghost');
      saveBtn.textContent = saveState === 'saving' ? 'Saving…' : 'Save';
      saveBtn.disabled = saveState === 'saving';
      saveBtn.onclick = wsSaveFile;
      act.appendChild(saveBtn);
      const expBtn = document.createElement('button');
      expBtn.className = 'ws-icon-btn';
      expBtn.title = wsExpanded ? 'Collapse' : 'Expand';
      expBtn.innerHTML = wsExpanded
        ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M9 4v5H4"/><path d="M10 10 4 4"/><path d="M15 20v-5h5"/><path d="M14 14l6 6"/></svg>'
        : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 9V4h5"/><path d="M4 4l6 6"/><path d="M20 15v5h-5"/><path d="M20 20l-6-6"/></svg>';
      expBtn.onclick = wsToggleExpand;
      act.appendChild(expBtn);
      const exitBtn = document.createElement('button');
      exitBtn.className = 'ws-icon-btn';
      exitBtn.title = 'Exit edit mode';
      exitBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      exitBtn.onclick = () => wsExitEditMode();
      act.appendChild(exitBtn);
    } else {
      const dlBtn = document.createElement('button');
      dlBtn.className = 'ws-icon-btn';
      dlBtn.title = 'Download';
      dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 4v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>';
      dlBtn.onclick = () => wsDownloadFile(wsActiveFile, wsActiveFile.split('/').pop());
      act.appendChild(dlBtn);
      const editBtn = document.createElement('button');
      editBtn.className = 'ws-edit-btn ghost';
      editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M16.5 4.5l3 3L8 19l-3.5.5L5 16z"/><path d="M14 7l3 3"/></svg> Edit';
      editBtn.onclick = wsEnterEditMode;
      act.appendChild(editBtn);
    }
  }
}

