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
  el.style.cssText = `width:${size+3}px;height:${size+3}px;border:1px solid color-mix(in srgb,${m.c} 50%,transparent);background:color-mix(in srgb,${m.c} 14%,transparent);color:color-mix(in srgb,${m.c} 65%,var(--h-ink))`;
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

// The file tree and git diff are fetched only while the panel is open: a large workdir is
// megabytes of JSON and tens of thousands of rows, too heavy for every room switch or reply.
let wsTreeRoomId = null;
let wsTreeLoaded = false;
let wsRootWaiters = [];
const WS_ROOT_WAIT_MS = 3000;

function wsPanelIsOpen() {
  return !!document.getElementById('workspace-panel')?.classList.contains('open');
}

function wsRequestWorkspace() {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'file_list' }));
  ws.send(JSON.stringify({ type: 'git_diff' }));
}

function wsRenderGitBadge() {
  const gitTab = document.querySelector('[data-ws-pin="git"]');
  if (!gitTab) return;
  let badge = gitTab.querySelector('.ws-git-badge');
  if (wsGitDiffData.length) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'ws-git-badge'; gitTab.appendChild(badge); }
    badge.textContent = wsGitDiffData.length;
  } else if (badge) { badge.remove(); }
}

function wsResetForRoom(roomId) {
  if (wsTreeRoomId === roomId) return;
  wsTreeRoomId = roomId;
  wsTreeLoaded = false;
  wsRootWaiters = [];
  wsFileTreeData = [];
  wsFileTreeRoot = '';
  wsModifiedFiles = new Set();
  wsGitDiffData = [];
  wsRenderGitBadge();
  if (wsPanelIsOpen() && (wsActiveView === 'files' || wsActiveView === 'git')) wsRenderContent();
}

function wsTreeArrived() {
  wsTreeLoaded = true;
  const waiters = wsRootWaiters;
  wsRootWaiters = [];
  waiters.forEach(fn => fn());
}

// Runs fn once the workdir root of the current room is known (paths are made relative to it),
// or right away when no answer can come.
function wsWhenRootKnown(fn) {
  if (wsTreeLoaded || !ws || ws.readyState !== 1) { fn(); return; }
  const roomId = wsTreeRoomId;
  let done = false;
  const run = () => { if (done || wsTreeRoomId !== roomId) return; done = true; fn(); };
  wsRootWaiters.push(run);
  setTimeout(run, WS_ROOT_WAIT_MS);
}

let wsRefreshTimer = null;
function wsScheduleRefresh() {
  if (wsRefreshTimer) clearTimeout(wsRefreshTimer);
  wsRefreshTimer = setTimeout(() => {
    if (wsPanelIsOpen()) wsRequestWorkspace();
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
    wsRequestWorkspace();
    if (wsActiveView === 'files' || wsActiveView === 'git') wsRenderContent();
    if (!window._cm && !wsCmLoading) wsLoadCodeMirror();
  }
}

