let wsEditorView = null;
let wsCmLoading = false;

async function wsLoadCodeMirror() {
  if (window._cm) return window._cm;
  if (wsCmLoading) return null;
  wsCmLoading = true;
  try {
    const cm = await import('/vendor/codemirror.bundle.js');
    const { EditorView, EditorState, HighlightStyle, syntaxHighlighting, tags } = cm;
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
      js: cm.javascript, jsx: () => cm.javascript({ jsx: true }), ts: () => cm.javascript({ typescript: true }),
      tsx: () => cm.javascript({ typescript: true, jsx: true }), py: cm.python, json: cm.json,
      md: cm.markdown, html: cm.html, css: cm.css,
    };
    window._cm = { EditorView, EditorState, basicSetup: cm.basicSetup, hearthTheme, hearthHighlight: syntaxHighlighting(hearthHighlight), langMap, keymap: cm.keymap };
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

