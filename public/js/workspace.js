// ── Workspace panel ───────────────────────────────────────────────────────
const WS_FILE_COLORS = {
  js:   { tag: 'js',  c: '#c2876b' },
  jsx:  { tag: 'jsx', c: '#6f9f8c' },
  ts:   { tag: 'ts',  c: '#5b8fd4' },
  tsx:  { tag: 'tsx', c: '#5b8fd4' },
  md:   { tag: 'md',  c: '#5b8fd4' },
  json: { tag: '{}',  c: '#d39749' },
  css:  { tag: 'css', c: '#c08aa0' },
  html: { tag: 'htm', c: '#c2876b' },
  py:   { tag: 'py',  c: '#b59a5e' },
  sql:  { tag: 'sql', c: '#6f9f8c' },
};

function wsFileGlyph(ext, size = 15) {
  const m = WS_FILE_COLORS[ext] || { tag: '', c: 'var(--h-ink-faint)' };
  const el = document.createElement('span');
  el.className = 'ws-file-glyph ws-mono';
  el.style.cssText = `width:${size+3}px;height:${size+3}px;border:1px solid color-mix(in srgb,${m.c} 50%,transparent);background:color-mix(in srgb,${m.c} 14%,transparent);color:${m.c}`;
  el.textContent = m.tag;
  return el;
}

function wsGetExt(name) { return (name.match(/\.(\w+)$/) || [])[1] || ''; }

let wsActiveView = 'files';
let wsOpenFiles = [];
let wsActiveFile = null;
let wsFileTreeData = [];
let wsFileTreeRoot = '';
let wsGitDiffData = [];
let wsModifiedFiles = new Set();
let wsEditMode = false;
let wsEditDirty = false;
let wsEditContent = '';
let wsEditSaving = false;
let wsExpanded = false;
let wsCtxMenu = null;
const WS_EDITOR_CONTAINER_CSS = 'flex:1;min-height:0;display:flex;flex-direction:column;position:relative';
let wsFileMtimes = {};

function wsDownloadFile(relPath, fileName) {
  const fullPath = wsFileTreeRoot ? wsFileTreeRoot.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + relPath : relPath;
  const isAbs = /^\//.test(fullPath) || /^[A-Za-z]:/.test(fullPath);
  const imgExts = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp']);
  const ext = wsGetExt(fileName);
  const binary = imgExts.has(ext);

  const existing = wsOpenFiles.find(f => f.name === fullPath);
  if (existing && (existing.content || existing.base64)) {
    triggerDownload(fileName, existing.content, existing.base64, ext);
    return;
  }

  const handler = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type !== 'file_read' || (msg.path !== fullPath && msg.path !== relPath)) return;
    ws.removeEventListener('message', handler);
    if (msg.error) { showToast('Download failed: ' + msg.error, { error: true }); return; }
    triggerDownload(fileName, msg.content, msg.base64, ext);
  };
  ws.addEventListener('message', handler);
  setTimeout(() => ws.removeEventListener('message', handler), 15000);

  const req = { type: 'file_read', path: fullPath };
  if (binary) req.binary = true;
  if (isAbs) req.absolute = true;
  ws.send(JSON.stringify(req));
}

function triggerDownload(name, content, base64, ext) {
  let blob;
  if (base64) {
    const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', ico:'image/x-icon', bmp:'image/bmp', pdf:'application/pdf' };
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    blob = new Blob([arr], { type: mimeMap[ext] || 'application/octet-stream' });
  } else {
    blob = new Blob([content || ''], { type: 'text/plain;charset=utf-8' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

let wsRefreshTimer = null;
function wsScheduleRefresh() {
  if (wsRefreshTimer) clearTimeout(wsRefreshTimer);
  wsRefreshTimer = setTimeout(() => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'file_list' }));
      ws.send(JSON.stringify({ type: 'git_diff' }));
    }
    wsRefreshTimer = null;
  }, 5000);
}

function toggleWorkspacePanel() {
  const panel = document.getElementById('workspace-panel');
  const isOpen = panel.classList.toggle('open');
  document.querySelectorAll('.h-ws-toggle').forEach(b => b.classList.toggle('active', isOpen));
  if (isOpen) {
    const saved = localStorage.getItem('stoa-ws-panel-width');
    if (saved) panel.style.setProperty('--ws-panel-width', saved);
    if (ws && wsActiveView === 'files') ws.send(JSON.stringify({ type: 'file_list' }));
    if (ws && wsActiveView === 'git') ws.send(JSON.stringify({ type: 'git_diff' }));
    if (!window._cm && !wsCmLoading) wsLoadCodeMirror();
  }
}

// ── Editor functions ──────────────────────────────────────────────────────
function wsEnterEditMode() {
  if (wsEditMode) return;
  const file = wsOpenFiles.find(f => f.name === wsActiveFile);
  if (!file || !file.loaded) return;
  const IMG_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp']);
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
    const IMG_EXTS = new Set(['png','jpg','jpeg','gif','webp','svg','ico','bmp']);
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

let wsEditorView = null;
let wsCmLoading = false;

async function wsLoadCodeMirror() {
  if (window._cm) return window._cm;
  if (wsCmLoading) return null;
  wsCmLoading = true;
  try {
    const cmMod = await import('https://esm.sh/codemirror');
    const viewMod = await import('https://esm.sh/@codemirror/view');
    const stateMod = await import('https://esm.sh/@codemirror/state');
    const langMod = await import('https://esm.sh/@codemirror/language');
    const lezerHL = await import('https://esm.sh/@lezer/highlight');
    const [jsLang, pyLang, jsonLang, mdLang, htmlLang, cssLang] = await Promise.all([
      import('https://esm.sh/@codemirror/lang-javascript'),
      import('https://esm.sh/@codemirror/lang-python'),
      import('https://esm.sh/@codemirror/lang-json'),
      import('https://esm.sh/@codemirror/lang-markdown'),
      import('https://esm.sh/@codemirror/lang-html'),
      import('https://esm.sh/@codemirror/lang-css'),
    ]);
    const { EditorView } = viewMod;
    const { EditorState } = stateMod;
    const { HighlightStyle, syntaxHighlighting } = langMod;
    const { tags } = lezerHL;
    const hearthTheme = EditorView.theme({
      '&': { backgroundColor: 'oklch(0.193 0.016 44)', color: '#d3c8b4', fontSize: '13px', height: '100%' },
      '.cm-content': { caretColor: 'oklch(0.78 0.085 78)', fontFamily: "'SF Mono','Cascadia Code','Fira Code','JetBrains Mono',ui-monospace,monospace", padding: '10px 0' },
      '.cm-cursor': { borderLeftColor: 'oklch(0.78 0.085 78)', borderLeftWidth: '2px' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, oklch(0.78 0.085 78) 32%, transparent) !important' },
      '.cm-gutters': { backgroundColor: 'oklch(0.193 0.016 44)', color: '#7a7060', borderRight: '1px solid rgba(255,255,255,.07)', minWidth: '40px' },
      '.cm-gutter': { fontFamily: "'SF Mono','Cascadia Code','Fira Code','JetBrains Mono',ui-monospace,monospace" },
      '.cm-activeLineGutter': { color: '#d3c8b4', backgroundColor: 'transparent' },
      '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.045)' },
      '.cm-matchingBracket': { backgroundColor: 'rgba(255,255,255,.12)', outline: 'none' },
      '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, oklch(0.78 0.085 78) 30%, transparent)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, oklch(0.78 0.085 78) 55%, transparent)' },
      '.cm-panels': { backgroundColor: 'oklch(0.17 0.012 44)', color: '#d3c8b4' },
      '.cm-panels input, .cm-panels button': { color: '#d3c8b4' },
      '.cm-scroller': { overflow: 'auto', lineHeight: '21px' },
      '&::-webkit-scrollbar, .cm-scroller::-webkit-scrollbar': { width: '8px', height: '8px' },
      '&::-webkit-scrollbar-thumb, .cm-scroller::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,.12)', borderRadius: '4px' },
    }, { dark: true });
    const hearthHighlight = HighlightStyle.define([
      { tag: tags.keyword, color: '#c2876b' },
      { tag: tags.string, color: '#b59a5e' },
      { tag: tags.comment, color: '#837868', fontStyle: 'italic' },
      { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#6f9f8c' },
      { tag: tags.number, color: '#c08aa0' },
      { tag: tags.variableName, color: '#d3c8b4' },
      { tag: tags.punctuation, color: '#9a8f7e' },
      { tag: tags.operator, color: '#9a8f7e' },
      { tag: tags.typeName, color: '#c2876b' },
      { tag: tags.bool, color: '#c2876b' },
      { tag: tags.null, color: '#c2876b' },
      { tag: tags.propertyName, color: '#d3c8b4' },
      { tag: tags.definition(tags.variableName), color: '#6f9f8c' },
    ]);
    const langMap = {
      js: jsLang.javascript, jsx: () => jsLang.javascript({ jsx: true }), ts: () => jsLang.javascript({ typescript: true }),
      tsx: () => jsLang.javascript({ typescript: true, jsx: true }), py: pyLang.python, json: jsonLang.json,
      md: mdLang.markdown, html: htmlLang.html, css: cssLang.css,
    };
    window._cm = { EditorView, EditorState, basicSetup: cmMod.basicSetup, hearthTheme, hearthHighlight: syntaxHighlighting(hearthHighlight), langMap, keymap: viewMod.keymap };
    wsCmLoading = false;
    return window._cm;
  } catch (e) {
    console.warn('[ws] CodeMirror load failed, using textarea:', e);
    fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'CM load FAILED: ' + e.message, source: e.stack }) }).catch(() => {});
    wsCmLoading = false;
    return null;
  }
}

function wsRenderEditor(container) {
  container.className = '';
  container.style.cssText = WS_EDITOR_CONTAINER_CSS;
  wsEditorView = null;
  if (window._cm) {
    wsRenderCMEditor(container);
  } else if (wsCmLoading) {
    const loading = document.createElement('div');
    loading.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;background:oklch(0.193 0.016 44);color:#7a7060;font-family:var(--h-sans);font-size:13px';
    loading.textContent = 'loading editor…';
    container.appendChild(loading);
    const check = setInterval(() => {
      if (window._cm) { clearInterval(check); if (wsEditMode) { const c = document.getElementById('ws-panel-content'); if (c) { c.innerHTML = ''; c.className = ''; c.style.cssText = WS_EDITOR_CONTAINER_CSS; wsRenderCMEditor(c); } } }
      if (!wsCmLoading && !window._cm) { clearInterval(check); if (wsEditMode) { const c = document.getElementById('ws-panel-content'); if (c) { c.innerHTML = ''; c.className = ''; c.style.cssText = WS_EDITOR_CONTAINER_CSS; wsRenderTextareaEditor(c); } } }
    }, 100);
    setTimeout(() => clearInterval(check), 30000);
  } else {
    wsLoadCodeMirror().then(cm => {
      if (cm && wsEditMode) {
        const c = document.getElementById('ws-panel-content');
        if (c) { c.innerHTML = ''; c.className = ''; c.style.cssText = WS_EDITOR_CONTAINER_CSS; wsRenderCMEditor(c); }
      } else if (!cm && wsEditMode) {
        const c = document.getElementById('ws-panel-content');
        if (c) { c.innerHTML = ''; c.className = ''; c.style.cssText = WS_EDITOR_CONTAINER_CSS; wsRenderTextareaEditor(c); }
      }
    }).catch(() => {});
  }
}

function wsRenderCMEditor(container) {
  try {
    const cm = window._cm;
    const ext = wsActiveFile ? wsGetExt(wsActiveFile) : '';
    const langFn = cm.langMap[ext];
    const extensions = [
      cm.basicSetup,
      cm.hearthTheme,
      cm.hearthHighlight,
      cm.EditorView.updateListener.of(update => {
        if (update.docChanged) {
          wsEditContent = update.state.doc.toString();
          if (!wsEditDirty) { wsEditDirty = true; wsRenderTabs(); wsRenderToolbarActions(); }
          wsAutoSaveDraft();
        }
      }),
      cm.keymap.of([
        { key: 'Mod-s', run: () => { wsSaveFile(); return true; } },
        { key: 'Ctrl-Shift-d', run: (view) => { const s = view.state, sel = s.selection.main, line = s.doc.lineAt(sel.head), text = s.doc.sliceString(line.from, line.to); view.dispatch({ changes: { from: line.to, insert: '\n' + text }, selection: { anchor: sel.head + text.length + 1 } }); return true; } },
        { key: 'Alt-Shift-ArrowDown', run: (view) => { const s = view.state, sel = s.selection.main, line = s.doc.lineAt(sel.head), text = s.doc.sliceString(line.from, line.to); view.dispatch({ changes: { from: line.to, insert: '\n' + text }, selection: { anchor: sel.head + text.length + 1 } }); return true; } },
        { key: 'Alt-Shift-ArrowUp', run: (view) => { const s = view.state, sel = s.selection.main, line = s.doc.lineAt(sel.head), text = s.doc.sliceString(line.from, line.to); view.dispatch({ changes: { from: line.from, insert: text + '\n' } }); return true; } },
      ]),
    ];
    if (langFn) extensions.push(typeof langFn === 'function' ? langFn() : langFn());
    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex:1;min-height:0;overflow:hidden';
    container.appendChild(wrap);
    wsEditorView = new cm.EditorView({
      state: cm.EditorState.create({ doc: wsEditContent, extensions }),
      parent: wrap,
    });
    wsEditorView.focus();
  } catch (e) {
    console.warn('[ws-editor] CodeMirror render failed, falling back to textarea:', e);
    fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'CM render FAILED: ' + e.message, source: e.stack }) }).catch(() => {});
    window._cm = null;
    container.innerHTML = '';
    wsRenderTextareaEditor(container);
  }
}

function wsRenderTextareaEditor(container) {
  const wrap = document.createElement('div');
  wrap.className = 'ws-editor-wrap';
  const lines = wsEditContent.split('\n');
  const gutW = String(Math.max(lines.length, 2)).length * 9 + 26;
  const gutter = document.createElement('div');
  gutter.className = 'ws-editor-gutter';
  gutter.style.width = gutW + 'px';
  gutter.textContent = lines.map((_, i) => i + 1).join('\n');
  const ta = document.createElement('textarea');
  ta.className = 'ws-editor-ta';
  ta.spellcheck = false;
  ta.value = wsEditContent;
  ta.addEventListener('input', () => {
    wsEditContent = ta.value;
    if (!wsEditDirty) { wsEditDirty = true; wsRenderTabs(); wsRenderToolbarActions(); wsAutoSaveDraft(); }
    else { wsAutoSaveDraft(); }
    const newLines = ta.value.split('\n');
    const newGutW = String(Math.max(newLines.length, 2)).length * 9 + 26;
    gutter.style.width = newGutW + 'px';
    gutter.textContent = newLines.map((_, i) => i + 1).join('\n');
  });
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); wsSaveFile(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      const nv = wsEditContent.slice(0, s) + '  ' + wsEditContent.slice(en);
      wsEditContent = nv; ta.value = nv;
      ta.selectionStart = ta.selectionEnd = s + 2;
      if (!wsEditDirty) { wsEditDirty = true; wsRenderTabs(); wsRenderToolbarActions(); }
      const nl = nv.split('\n');
      gutter.style.width = (String(Math.max(nl.length, 2)).length * 9 + 26) + 'px';
      gutter.textContent = nl.map((_, i) => i + 1).join('\n');
    }
  });
  wrap.appendChild(gutter);
  wrap.appendChild(ta);
  container.appendChild(wrap);
  ta.focus();
}

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
    if (content != null) { existing.content = content; existing.loaded = true; }
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
    tab.onclick = () => wsOpenFile(f.name, f.content);
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
      content.className = 'ws-scroll ws-md-view';
      content.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:26px 30px 40px';
      const inner = document.createElement('div');
      inner.className = 'ws-md-body';
      inner.innerHTML = file.content ? DOMPurify.sanitize(marked.parse(file.content), { ADD_ATTR: ['class'] }) : '<p style="color:var(--h-ink-faint);font-style:italic">empty file</p>';
      addCopyButtons(inner);
      content.appendChild(inner);
    } else if (file.loaded) {
      wsRenderCodeViewer(content, file.content || '', file.name);
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

function wsShowEditingBanner(actorName, actorColor) {
  const banner = document.getElementById('ws-editing-banner');
  banner.innerHTML = '';
  if (!actorName) return;
  const el = document.createElement('div');
  el.className = 'ws-editing-banner';
  el.style.cssText = `background:color-mix(in srgb,${actorColor} 14%,var(--h-bg));border-bottom:1px solid color-mix(in srgb,${actorColor} 36%,var(--h-bg));color:${actorColor}`;
  el.innerHTML = `<span class="h-dot"></span><span class="h-dot"></span><span class="h-dot"></span><span style="font-style:italic">${wsEscHtml(actorName)} is editing this file…</span>`;
  banner.appendChild(el);
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

