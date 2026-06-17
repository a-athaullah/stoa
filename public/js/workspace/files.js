let wsDraftTimer = null;
function wsAutoSaveDraft() {
  if (!wsActiveFile || !wsEditMode) return;
  if (wsDraftTimer) return;
  wsDraftTimer = setTimeout(() => {
    wsDraftTimer = null;
    if (!wsActiveFile || !wsEditMode) return;
    const key = 'stoa-draft-' + (currentRoomId || '') + '-' + wsActiveFile;
    try { localStorage.setItem(key, JSON.stringify({ content: wsEditContent, ts: Date.now() })); } catch {}
  }, 3000);
}

function wsCheckDraft() {
  if (!wsActiveFile) return;
  const key = 'stoa-draft-' + (currentRoomId || '') + '-' + wsActiveFile;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const draft = JSON.parse(raw);
    const file = wsOpenFiles.find(f => f.name === wsActiveFile);
    if (!file || !file.loaded) return;
    if (draft.content === file.content) { localStorage.removeItem(key); return; }
    const ago = Math.round((Date.now() - draft.ts) / 60000);
    const agoText = ago < 1 ? 'just now' : ago + ' minute' + (ago > 1 ? 's' : '') + ' ago';
    wsShowDialog('Recover draft?', 'Found unsaved changes to <strong>' + wsEscHtml(wsActiveFile.split('/').pop()) + '</strong> from ' + agoText + '. Pick up where you left off?',
      [{ label: 'Discard', cls: 'ghost', action: () => localStorage.removeItem(key) },
       { label: 'Recover draft', cls: 'primary', action: () => { wsEditContent = draft.content; wsEditDirty = true; wsEnterEditMode(); localStorage.removeItem(key); } }]);
  } catch {}
}

function wsSetView(view) {
  wsActiveView = view;
  wsActiveFile = null;
  document.querySelectorAll('.ws-pin-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.wsPin === view);
  });
  if (view === 'files' && ws) ws.send(JSON.stringify({ type: 'file_list' }));
  if (view === 'git' && ws) ws.send(JSON.stringify({ type: 'git_diff' }));
  wsRenderContent();
}

function wsOpenFile(name, content) {
  const existing = wsOpenFiles.find(f => f.name === name);
  if (existing) {
    if (content != null) { existing.content = content; existing.loaded = true; existing.error = null; }
  } else {
    wsOpenFiles.push({ name, content: content ?? '', ext: wsGetExt(name), loaded: content != null });
  }
  const imgExts = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp']);
  const fileExt = wsGetExt(name);
  const isAbs = /^\//.test(name) || /^[A-Za-z]:/.test(name);
  if (content == null && ws) {
    const req = { type: 'file_read', path: name };
    if (imgExts.has(fileExt)) req.binary = true;
    if (isAbs) req.absolute = true;
    ws.send(JSON.stringify(req));
  }
  wsActiveFile = name;
  wsActiveView = 'file';
  document.querySelectorAll('.ws-pin-tab').forEach(t => t.classList.remove('active'));
  wsRenderTabs();
  wsRenderContent();
}

function wsRenderFileTree(container, nodes, parentPath) {
  nodes.forEach(node => {
    const row = document.createElement('div');
    row.className = 'ws-tree-row';
    row.style.paddingLeft = (8 + node.depth * 16) + 'px';

    if (node.t === 'folder') {
      const chevron = document.createElement('span');
      chevron.className = 'ws-tree-chevron' + (node.open ? ' open' : '');
      chevron.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
      row.appendChild(chevron);
      const folderIcon = document.createElement('span');
      folderIcon.style.cssText = 'color:var(--h-ink-mute);display:inline-flex';
      folderIcon.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
      row.appendChild(folderIcon);
      const nameEl = document.createElement('span');
      nameEl.className = 'ws-tree-name folder';
      nameEl.textContent = node.name;
      row.appendChild(nameEl);

      const childContainer = document.createElement('div');
      childContainer.style.display = node.open ? '' : 'none';

      row.onclick = () => {
        node.open = !node.open;
        chevron.classList.toggle('open', node.open);
        childContainer.style.display = node.open ? '' : 'none';
      };
      const folderRelPath = parentPath ? parentPath + '/' + node.name : node.name;
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); wsShowCtxMenu(e.clientX, e.clientY, folderRelPath, true); });

      container.appendChild(row);
      if (node.children) {
        wsRenderFileTree(childContainer, node.children, parentPath ? parentPath + '/' + node.name : node.name);
      }
      container.appendChild(childContainer);
    } else {
      const spacer = document.createElement('span');
      spacer.style.cssText = 'width:12px;flex:0 0 auto';
      row.appendChild(spacer);
      row.appendChild(wsFileGlyph(node.t, 14));
      const nameEl = document.createElement('span');
      nameEl.className = 'ws-tree-name file';
      nameEl.textContent = node.name;
      row.appendChild(nameEl);

      const relPath = parentPath ? parentPath + '/' + node.name : node.name;
      const dlBtn = document.createElement('button');
      dlBtn.className = 'ws-dl';
      dlBtn.title = 'Download ' + node.name;
      dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>';
      dlBtn.onclick = (e) => { e.stopPropagation(); wsDownloadFile(relPath, node.name); };
      row.appendChild(dlBtn);
      if (wsModifiedFiles.has(relPath) || wsModifiedFiles.has(node.name)) {
        const dot = document.createElement('span');
        dot.className = 'ws-tree-modified';
        dot.title = 'modified';
        dot.style.background = '#d39749';
        row.appendChild(dot);
      }
      const fullPath = wsFileTreeRoot ? wsFileTreeRoot.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + relPath : relPath;
      row.onclick = () => {
        const panel = document.getElementById('workspace-panel');
        if (!panel.classList.contains('open')) toggleWorkspacePanel();
        wsOpenFile(fullPath);
      };
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); wsShowCtxMenu(e.clientX, e.clientY, relPath, false); });
      container.appendChild(row);
    }
  });
}

function wsCloseFile(name) {
  if (wsEditMode && wsActiveFile === name && wsEditDirty) {
    wsShowDialog('Discard changes?', 'You have unsaved changes to <strong>' + wsEscHtml(name.split('/').pop()) + '</strong>. Close and discard them?',
      [{ label: 'Keep editing', cls: 'ghost' }, { label: 'Discard', cls: 'danger', action: () => { wsEditMode = false; wsEditDirty = false; wsCloseFile(name); } }]);
    return;
  }
  if (wsActiveFile === name) { wsEditMode = false; wsEditDirty = false; wsEditContent = ''; if (wsEditorView) { wsEditorView.destroy(); wsEditorView = null; } if (wsExpanded) wsToggleExpand(); }
  const key = 'stoa-draft-' + (currentRoomId || '') + '-' + name;
  try { localStorage.removeItem(key); } catch {}
  wsOpenFiles = wsOpenFiles.filter(f => f.name !== name);
  if (wsActiveFile === name) {
    wsActiveFile = wsOpenFiles.length ? wsOpenFiles[wsOpenFiles.length - 1].name : null;
    if (!wsActiveFile) wsActiveView = 'files';
  }
  wsRenderTabs();
  wsRenderContent();
}

function wsRenderTabs() {
  const list = document.getElementById('ws-tab-list');
  if (!list) return;
  list.innerHTML = '';
  wsOpenFiles.forEach(f => {
    const tab = document.createElement('div');
    tab.className = 'ws-file-tab' + (f.name === wsActiveFile ? ' active' : '');
    const isUnsaved = wsEditMode && wsEditDirty && f.name === wsActiveFile;
    if (isUnsaved) {
      const dot = document.createElement('span');
      dot.className = 'ws-file-tab-unsaved';
      dot.title = 'unsaved changes';
      tab.appendChild(dot);
    } else {
      tab.appendChild(wsFileGlyph(f.ext, 13));
    }
    const nameEl = document.createElement('span');
    nameEl.className = 'ws-file-tab-name';
    nameEl.textContent = f.name.split('/').pop();
    tab.appendChild(nameEl);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ws-file-tab-close';
    closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    closeBtn.onclick = (e) => { e.stopPropagation(); wsCloseFile(f.name); };
    tab.appendChild(closeBtn);
    const indicator = document.createElement('span');
    indicator.className = 'ws-tab-indicator';
    tab.appendChild(indicator);
    tab.onclick = () => wsOpenFile(f.name, f.loaded ? f.content : null);
    list.appendChild(tab);
  });
}

function wsSetToolbar(crumbs, actions) {
  const toolbar = document.getElementById('ws-toolbar');
  const bc = document.getElementById('ws-breadcrumb');
  const act = document.getElementById('ws-toolbar-actions');
  if (!crumbs || !crumbs.length) { toolbar.style.display = 'none'; return; }
  toolbar.style.display = '';
  bc.innerHTML = '';
  crumbs.forEach((c, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'ws-crumb-sep';
      sep.textContent = '/';
      bc.appendChild(sep);
    }
    const s = document.createElement('span');
    s.className = 'ws-crumb';
    s.textContent = c;
    bc.appendChild(s);
  });
  act.innerHTML = '';
  if (actions) act.appendChild(actions);
}

function wsRenderContent() {
  const content = document.getElementById('ws-panel-content');
  const banner = document.getElementById('ws-editing-banner');
  content.innerHTML = '';
  banner.innerHTML = '';

  if (wsActiveView === 'files') {
    wsSetToolbar(null);
    if (wsFileTreeData.length) {
      content.className = 'ws-tree ws-scroll';
      content.style.cssText = '';
      wsRenderFileTree(content, wsFileTreeData, '');
    } else {
      content.innerHTML = `<div class="ws-empty-state">
        <span class="ws-empty-icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h7M4 12h10M4 18h6"/><circle cx="18" cy="6" r="1.4" fill="currentColor" stroke="none"/></svg></span>
        <div class="ws-empty-title">nothing open yet</div>
        <div class="ws-empty-text">open a file, or click a file reference in the chat to read it here.</div>
      </div>`;
    }
    return;
  }

  if (wsActiveView === 'git') {
    if (wsGitDiffData.length) {
      wsSetToolbar(['working tree', wsGitDiffData.length + ' file' + (wsGitDiffData.length > 1 ? 's' : '') + ' changed']);
      wsGitDiffData.forEach(file => {
        const hdr = document.createElement('div');
        hdr.className = 'ws-diff-file-header';
        hdr.appendChild(wsFileGlyph(wsGetExt(file.name), 14));
        const fname = document.createElement('span');
        fname.className = 'ws-mono';
        fname.style.cssText = 'font-size:12.5px;color:var(--h-ink)';
        fname.textContent = file.name;
        hdr.appendChild(fname);
        hdr.appendChild(document.createElement('span')).style.flex = '1';
        const stat = document.createElement('span');
        stat.className = 'ws-diff-stat';
        stat.innerHTML = `<span class="ws-diff-add">+${file.add}</span><span class="ws-diff-del">−${file.del}</span>`;
        hdr.appendChild(stat);
        content.appendChild(hdr);
        const diffContainer = document.createElement('div');
        wsRenderDiff(diffContainer, file.hunks, 'unified');
        content.appendChild(diffContainer);
      });
    } else {
      wsSetToolbar(['working tree']);
      content.innerHTML = `<div class="ws-empty-state">
        <span class="ws-empty-icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="6" r="2.2"/><circle cx="6.5" cy="18" r="2.2"/><circle cx="17.5" cy="8" r="2.2"/><path d="M6.5 8.2v7.6M8.7 8c4 .2 6.5 1 8.6 .2M17.5 10.2c0 3.2-3 4.6-6.2 4.8"/></svg></span>
        <div class="ws-empty-title">no changes</div>
        <div class="ws-empty-text">working tree is clean.</div>
      </div>`;
    }
    return;
  }

  if (wsActiveView === 'file' && wsActiveFile) {
    const file = wsOpenFiles.find(f => f.name === wsActiveFile);
    if (!file) return;
    const ext = file.ext;
    const parts = file.name.split('/');
    wsSetToolbar(parts);
    wsRenderToolbarActions();

    const IMG_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp']);
    if (IMG_EXTS.has(ext)) {
      content.className = 'ws-scroll';
      content.style.cssText = 'flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,var(--h-ink) 4%,var(--h-bg))';
      const img = document.createElement('img');
      const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', ico:'image/x-icon', bmp:'image/bmp' };
      if (file.base64) {
        img.src = `data:${mimeMap[ext] || 'image/png'};base64,${file.base64}`;
      } else {
        img.src = `/api/workspace/file?room=${currentRoomId}&path=${encodeURIComponent(file.name)}`;
      }
      imgFallback(img);
      img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.12)';
      img.alt = file.name;
      content.appendChild(img);
      return;
    }

    if (wsEditMode) {
      wsRenderEditor(content);
      return;
    }

    if (ext === 'md' && file.loaded) {
      content.className = 'ws-scroll';
      content.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:26px 30px 40px';
      const inner = document.createElement('div');
      inner.className = 'ws-md-body';
      inner.innerHTML = file.content ? DOMPurify.sanitize(marked.parse(file.content), { ADD_ATTR: ['class'] }) : '<p style="color:var(--h-ink-faint);font-style:italic">empty file</p>';
      addCopyButtons(inner);
      content.appendChild(inner);
    } else if (file.loaded) {
      wsRenderCodeViewer(content, file.content || '', file.name);
    } else if (file.error) {
      content.innerHTML = `<div class="ws-empty-state">
        <div class="ws-empty-title">could not open file</div>
        <div class="ws-empty-text">${wsEscHtml(file.error)}</div>
      </div>`;
    } else {
      content.innerHTML = `<div class="ws-empty-state">
        <div class="ws-empty-title">loading…</div>
        <div class="ws-empty-text">fetching file from agent.</div>
      </div>`;
    }
  }
}

function wsRenderCodeViewer(container, text, fileName) {
  const lines = text.split('\n');
  const gutW = String(lines.length).length * 9 + 22;
  container.className = 'ws-code ws-mono ws-code-viewer';
  container.style.cssText = '';
  const ext = fileName ? wsGetExt(fileName) : '';
  const langMap = { js:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript', py:'python', json:'json', html:'xml', css:'css', sql:'sql', sh:'bash', yml:'yaml', yaml:'yaml', xml:'xml', rb:'ruby', go:'go', rs:'rust', java:'java', c:'c', cpp:'cpp', ps1:'powershell' };
  const lang = langMap[ext] || null;
  let hlLines = null;
  try {
    const hlText = lang ? hljs.highlight(text, { language: lang }).value : hljs.highlightAuto(text).value;
    hlLines = hlText.split('\n');
  } catch {}
  const table = document.createElement('div');
  table.className = 'ws-code-table';
  lines.forEach((ln, i) => {
    const row = document.createElement('div');
    row.className = 'ws-code-line';
    const gutter = document.createElement('span');
    gutter.className = 'ws-code-gutter';
    gutter.style.cssText = `width:${gutW}px;min-width:${gutW}px`;
    gutter.textContent = i + 1;
    row.appendChild(gutter);
    const code = document.createElement('span');
    code.className = 'ws-code-text';
    if (hlLines && hlLines[i] != null) { code.innerHTML = hlLines[i] || "&nbsp;"; } else { code.textContent = ln || " "; }
    row.appendChild(code);
    table.appendChild(row);
  });
  container.appendChild(table);
}

function wsRenderDiff(container, diffData, mode) {
  const table = document.createElement('div');
  table.className = 'ws-code-table';
  diffData.forEach(r => {
    if (r.k === 'hunk') {
      const row = document.createElement('div');
      row.className = 'ws-diff-hunk';
      const cell = document.createElement('span');
      cell.className = 'ws-diff-hunk-text';
      cell.textContent = r.text;
      row.appendChild(cell);
      table.appendChild(row);
      return;
    }
    const row = document.createElement('div');
    row.className = 'ws-code-line' + (r.k === 'add' ? ' ws-diff-line-add' : r.k === 'del' ? ' ws-diff-line-del' : '');
    const g1 = document.createElement('span');
    g1.className = 'ws-code-gutter';
    g1.style.cssText = 'width:28px;min-width:28px;padding:0 4px';
    g1.textContent = r.n1 || '';
    row.appendChild(g1);
    const g2 = document.createElement('span');
    g2.className = 'ws-code-gutter';
    g2.style.cssText = 'width:28px;min-width:28px;padding:0 4px';
    g2.textContent = r.n2 || '';
    row.appendChild(g2);
    const sign = document.createElement('span');
    sign.style.cssText = 'display:table-cell;width:14px;min-width:14px;text-align:center;user-select:none;color:' + (r.k === 'add' ? '#7faa7c' : r.k === 'del' ? '#c08378' : '#7a7060');
    sign.textContent = r.k === 'add' ? '+' : r.k === 'del' ? '−' : '';
    row.appendChild(sign);
    const code = document.createElement('span');
    code.className = 'ws-code-text';
    code.style.padding = '0 16px 0 4px';
    code.textContent = r.text;
    row.appendChild(code);
    table.appendChild(row);
  });
  container.className = 'ws-code ws-mono ws-code-viewer';
  container.appendChild(table);
}

(function initWorkspacePanel() {
  const panel = document.getElementById('workspace-panel');
  const handle = document.getElementById('ws-drag-handle');
  const closeBtn = document.getElementById('ws-panel-close-btn');

  closeBtn.onclick = toggleWorkspacePanel;

  document.querySelectorAll('.ws-pin-tab').forEach(tab => {
    tab.onclick = () => wsSetView(tab.dataset.wsPin);
  });

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const diff = startX - e.clientX;
    const newWidth = Math.max(280, Math.min(startWidth + diff, window.innerWidth * 0.7));
    panel.style.setProperty('--ws-panel-width', newWidth + 'px');
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const w = panel.style.getPropertyValue('--ws-panel-width');
    if (w) localStorage.setItem('stoa-ws-panel-width', w);
  });

  handle.addEventListener('dblclick', () => {
    panel.style.removeProperty('--ws-panel-width');
    localStorage.removeItem('stoa-ws-panel-width');
  });

  handle.addEventListener('touchstart', e => {
    const touch = e.touches[0];
    dragging = true;
    startX = touch.clientX;
    startWidth = panel.offsetWidth;
    handle.classList.add('dragging');
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const touch = e.touches[0];
    const diff = startX - touch.clientX;
    const newWidth = Math.max(280, Math.min(startWidth + diff, window.innerWidth * 0.7));
    panel.style.setProperty('--ws-panel-width', newWidth + 'px');
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    const w = panel.style.getPropertyValue('--ws-panel-width');
    if (w) localStorage.setItem('stoa-ws-panel-width', w);
  });
})();

