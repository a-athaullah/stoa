// ── Room knowledge ──────────────────────────────────────────────────────────
// "Knowledge" section of the room's System Prompt popover (opt-in toggle + counts) and the
// "Manage knowledge" dialog with three tabs: Documents, Nodes, Usage history. Endpoints are
// session-only (lib/knowledge-admin.js). Every server string goes through textContent.

const KN_PAGE = 50;
const KN_LOCK_TEXT = {
  excluded: 'This room is on the private list (KNOWLEDGE_EXCLUDED_ROOM_IDS). Nothing from it is ever added to knowledge.',
  archived: 'This room is archived. Restore it before including it in knowledge.',
};
// A locked room can still be on (it was included before it was archived or made private): it can
// only be turned off, and nothing new is extracted while the lock holds.
const KN_LOCK_TEXT_ON = {
  excluded: 'This room is on the private list (KNOWLEDGE_EXCLUDED_ROOM_IDS), so nothing new is extracted from it. It is still marked as included: you can turn it off, but not back on.',
  archived: 'This room is archived, so nothing new is extracted from it while it stays archived. It is still included: you can turn it off, but turning it back on needs the room restored first.',
};

let _knSection = null;   // { roomId, el, seq }
let _knModal = null;     // manager dialog state

function knEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function knDate(s) {
  if (typeof s !== 'string' || !s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? null : d;
}

function knWhen(s) {
  const d = knDate(s);
  return d ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

function knBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function knPlural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

async function knFetch(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(body.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
  return body;
}

// Delete buttons confirm on a second click. The ghost ::after (data-ghost) keeps the width of the
// longer label so the row never shifts.
function knConfirmButton(label, confirmLabel, onConfirm) {
  const b = knEl('button', 'kn-btn kn-btn-danger', label);
  b.type = 'button';
  b.dataset.ghost = confirmLabel.length > label.length ? confirmLabel : label;
  let armed = false, timer = null;
  const disarm = () => { armed = false; b.textContent = label; b.classList.remove('kn-armed'); clearTimeout(timer); };
  b.addEventListener('click', async () => {
    if (!armed) {
      armed = true; b.textContent = confirmLabel; b.classList.add('kn-armed');
      timer = setTimeout(disarm, 4000);
      return;
    }
    clearTimeout(timer);
    b.disabled = true;
    try { await onConfirm(); } finally { if (b.isConnected) { b.disabled = false; disarm(); } }
  });
  b.addEventListener('blur', () => { if (armed && !b.disabled) disarm(); });
  return b;
}

// ── Section in the room settings popover ────────────────────────────────────

function knBuildRoomSection(room) {
  const el = knEl('div', 'kn-section');
  el.appendChild(knEl('div', 'kn-section-label', 'Knowledge'));
  const body = knEl('div', 'kn-section-body');
  body.appendChild(knEl('div', 'kn-muted', 'loading…'));
  el.appendChild(body);
  _knSection = { roomId: room.id, room, el, body, seq: 0 };
  knLoadSection();
  return el;
}

async function knLoadSection() {
  const s = _knSection;
  if (!s) return;
  const seq = ++s.seq;
  try {
    const data = await knFetch(`/api/rooms/${s.roomId}/knowledge`);
    if (s !== _knSection || seq !== s.seq) return;
    knRenderSection(data);
  } catch {
    if (s !== _knSection || seq !== s.seq) return;
    s.body.replaceChildren(knEl('div', 'kn-error', 'Failed to load knowledge settings'));
  }
}

function knRenderSection(data) {
  const s = _knSection;
  const enabled = !!data.enabled;
  const locked = !!data.locked;

  const row = knEl('div', 'kn-toggle-row');
  const sw = knEl('button', 'kn-switch');
  sw.type = 'button';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(enabled));
  sw.id = `kn-switch-${s.roomId}`;
  sw.disabled = locked && !enabled;
  sw.appendChild(knEl('span', 'kn-switch-knob'));
  const lbl = knEl('label', 'kn-toggle-label', 'Include in Knowledge');
  lbl.htmlFor = sw.id;
  row.append(sw, lbl);

  const desc = knEl('div', 'kn-desc');
  if (locked) {
    desc.textContent = (enabled ? KN_LOCK_TEXT_ON : KN_LOCK_TEXT)[data.lock_reason] || 'Knowledge is locked for this room.';
    desc.classList.add('kn-locked');
  } else {
    desc.textContent = enabled
      ? 'Conversations here are summarized into knowledge that every agent can search. Turning this off stops new extraction; existing nodes stay until you delete them.'
      : 'Off: nothing from this room is added to knowledge. Turning it on also extracts the history this room already has.';
  }

  const docs = Number(data.documents) || 0, nodes = Number(data.nodes) || 0, stale = Number(data.stale_nodes) || 0;
  const stats = knEl('div', 'kn-stats');
  for (const [n, label] of [[docs, docs === 1 ? 'document' : 'documents'], [nodes, nodes === 1 ? 'node' : 'nodes'], [stale, 'stale']]) {
    const st = knEl('span', 'kn-stat');
    st.append(knEl('span', 'kn-stat-n', String(n)), knEl('span', 'kn-stat-l', label));
    stats.appendChild(st);
  }

  const manage = knEl('button', 'kn-btn', 'Manage knowledge');
  manage.type = 'button';
  manage.addEventListener('click', () => {
    const room = s.room;
    // The popover closes under the dialog, so focus returns to the strip button that opened it.
    const anchor = typeof _rsbActiveBtn !== 'undefined' ? _rsbActiveBtn : null;
    if (typeof closeRsbPopover === 'function') closeRsbPopover();
    knOpenManager(room, anchor);
  });

  sw.addEventListener('click', async () => {
    const next = sw.getAttribute('aria-checked') !== 'true';
    if (next && !confirm('Include this room in Knowledge?\n\nThe history this room already has will also be summarized into knowledge, and every agent will be able to search it.')) return;
    sw.disabled = true;
    try {
      const fresh = await knFetch(`/api/rooms/${s.roomId}/knowledge`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next }) });
      if (s !== _knSection) return;
      s.seq++;
      knRenderSection(fresh);
      showToast(next ? 'Room included in knowledge' : 'Room excluded from knowledge');
    } catch (e) {
      showToast(e.message || 'Failed to save', { error: true });
      knLoadSection();
    }
  });

  s.body.replaceChildren(row, desc, stats, manage);
}

// room_knowledge_changed (another tab) and room_archived/room_restored re-read the section; a deleted
// room takes its open manager dialog with it.
function knHandleRoomChanged(roomId, deleted) {
  if (_knModal && _knModal.room.id === roomId && deleted) knCloseManager();
  if (_knSection && _knSection.roomId === roomId && _knSection.el.isConnected) knLoadSection();
}

function knResync() {
  if (_knSection && _knSection.el.isConnected) knLoadSection();
  if (_knModal) knModalReloadActive();
}

// A new use shows up at the top of Usage history, unless the user is reading older pages.
function knHandleUsed() {
  if (!_knModal) return;
  _knModal.usageDirty = true;
  if (_knModal.tab === 'usage' && _knModal.usage.items.length <= KN_PAGE) knLoadUsage(true);
}

// ── Manager dialog ──────────────────────────────────────────────────────────

const KN_TABS = [
  { key: 'documents', label: 'Documents' },
  { key: 'nodes', label: 'Nodes' },
  { key: 'usage', label: 'Usage history' },
];

function knOpenManager(room, returnFocus) {
  knCloseManager();
  const opener = returnFocus || document.activeElement;
  const overlay = knEl('div', 'kn-overlay');
  const dlg = knEl('div', 'kn-dialog');
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-labelledby', 'kn-dialog-title');

  const head = knEl('div', 'kn-head');
  const titles = knEl('div', 'kn-titles');
  const title = knEl('div', 'kn-title', 'Knowledge');
  title.id = 'kn-dialog-title';
  const sub = knEl('div', 'kn-subtitle', room.title || `Room ${room.id}`);
  titles.append(title, sub);
  const close = knEl('button', 'kn-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
  close.addEventListener('click', knCloseManager);
  head.append(titles, close);

  const tabs = knEl('div', 'kn-tabs');
  tabs.setAttribute('role', 'tablist');
  const panes = {};
  const tabBtns = {};
  for (const t of KN_TABS) {
    const b = knEl('button', 'kn-tab', t.label);
    b.type = 'button';
    b.id = `kn-tab-${t.key}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', `kn-pane-${t.key}`);
    b.addEventListener('click', () => knSwitchTab(t.key));
    tabBtns[t.key] = b;
    tabs.appendChild(b);
    const p = knEl('div', 'kn-pane');
    p.id = `kn-pane-${t.key}`;
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', b.id);
    p.hidden = true;
    panes[t.key] = p;
  }
  tabs.addEventListener('keydown', (e) => {
    const i = KN_TABS.findIndex(t => t.key === _knModal.tab);
    const n = KN_TABS.length;
    const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    const next = KN_TABS[to].key;
    knSwitchTab(next);
    tabBtns[next].focus();
    e.preventDefault();
  });

  const status = knEl('div', 'kn-status');
  status.setAttribute('role', 'status');
  status.hidden = true;

  const body = knEl('div', 'kn-body');
  body.append(...Object.values(panes));
  dlg.append(head, tabs, status, body);
  overlay.appendChild(dlg);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) knCloseManager(); });

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); knCloseManager(); return; }
    if (e.key === 'Tab') {
      const f = [...dlg.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);

  _knModal = {
    room, overlay, dlg, status, panes, tabBtns, onKey, opener, tab: null,
    docs: { seq: 0, list: [] },
    nodes: { seq: 0, items: [], total: 0, q: '', documentId: '', built: false },
    usage: { seq: 0, items: [], before: null, nodeId: null, nodeTitle: '', built: false },
    usageDirty: true, nodesDirty: true, docsDirty: true,
  };
  document.body.appendChild(overlay);
  knSwitchTab('documents');
  tabBtns.documents.focus({ preventScroll: true });
}

function knCloseManager() {
  const m = _knModal;
  if (!m) return;
  _knModal = null;
  document.removeEventListener('keydown', m.onKey, true);
  m.overlay.remove();
  // The room strip can re-render while the dialog is open: fall back to its current Memory button.
  const target = m.opener && m.opener.isConnected ? m.opener : document.querySelector('#room-sidebar .h-rsb-btn[data-tooltip="Memory"]');
  if (target) target.focus({ preventScroll: true });
}

function knSetStatus(text, isError) {
  const m = _knModal;
  if (!m) return;
  m.status.hidden = !text;
  m.status.textContent = text || '';
  m.status.classList.toggle('kn-error', !!isError);
}

function knSwitchTab(key) {
  const m = _knModal;
  if (!m) return;
  m.tab = key;
  knSetStatus('');
  for (const t of KN_TABS) {
    const on = t.key === key;
    m.tabBtns[t.key].setAttribute('aria-selected', String(on));
    m.tabBtns[t.key].tabIndex = on ? 0 : -1;
    m.panes[t.key].hidden = !on;
  }
  if (key === 'documents' && m.docsDirty) knLoadDocs();
  if (key === 'nodes' && m.nodesDirty) knLoadNodes(true);
  if (key === 'usage' && m.usageDirty) knLoadUsage(true);
}

function knModalReloadActive() {
  const m = _knModal;
  m.docsDirty = m.nodesDirty = m.usageDirty = true;
  knSwitchTab(m.tab);
}

// Anything deleted changes the counts in the popover section and the other tabs.
function knAfterDelete(except) {
  const m = _knModal;
  if (m) {
    if (except !== 'documents') m.docsDirty = true;
    if (except !== 'nodes') m.nodesDirty = true;
    if (except !== 'usage') m.usageDirty = true;
  }
  if (_knSection && _knSection.el.isConnected) knLoadSection();
}

function knEmpty(text) { return knEl('div', 'kn-empty', text); }

// ── Documents tab

async function knLoadDocs() {
  const m = _knModal;
  const pane = m.panes.documents;
  const seq = ++m.docs.seq;
  m.docsDirty = false;
  if (!pane.firstChild) pane.appendChild(knEl('div', 'kn-muted', 'loading…'));
  try {
    const data = await knFetch(`/api/rooms/${m.room.id}/knowledge/documents`);
    if (m !== _knModal || seq !== m.docs.seq) return;
    m.docs.list = Array.isArray(data.documents) ? data.documents : [];
    knRenderDocs(!!data.truncated);
    knSyncDocFilter();
  } catch (e) {
    if (m !== _knModal || seq !== m.docs.seq) return;
    m.docsDirty = true;
    pane.replaceChildren(knEl('div', 'kn-error', e.message || 'Failed to load documents'));
  }
}

function knRenderDocs(truncated) {
  const m = _knModal;
  const pane = m.panes.documents;
  const list = m.docs.list;
  if (!list.length) {
    pane.replaceChildren(knEmpty('No documents in this room. Agents add .md documents with knowledge_add.'));
    return;
  }
  const ul = knEl('ul', 'kn-list');
  for (const d of list) {
    const li = knEl('li', 'kn-item');
    const main = knEl('div', 'kn-item-main');
    main.appendChild(knEl('div', 'kn-item-title', d.name || `Document ${d.id}`));
    const meta = knEl('div', 'kn-meta');
    meta.appendChild(knEl('span', null, knBytes(d.bytes)));
    meta.appendChild(knEl('span', null, knPlural(Number(d.sections) || 0, 'section', 'sections')));
    meta.appendChild(knEl('span', null, `added by ${d.added_by || 'unknown'} · ${knWhen(d.created_at)}`));
    if (d.updated_at && d.updated_at !== d.created_at) meta.appendChild(knEl('span', null, `updated${d.updated_by ? ` by ${d.updated_by}` : ''} · ${knWhen(d.updated_at)}`));
    main.appendChild(meta);
    const actions = knEl('div', 'kn-item-actions');
    const nodesBtn = knEl('button', 'kn-btn kn-btn-quiet', 'Nodes');
    nodesBtn.type = 'button';
    nodesBtn.addEventListener('click', () => { m.nodes.documentId = String(d.id); m.nodes.built = false; m.nodesDirty = true; knSwitchTab('nodes'); });
    actions.append(nodesBtn, knConfirmButton('Delete', 'Confirm delete', async () => {
      try {
        await knFetch(`/api/rooms/${m.room.id}/knowledge/documents/${d.id}`, { method: 'DELETE' });
        if (m !== _knModal) return;
        m.docs.list = m.docs.list.filter(x => x.id !== d.id);
        knRenderDocs(truncated);
        knSyncDocFilter();
        knSetStatus(`Deleted "${d.name}" and the nodes that came only from it.`);
        knAfterDelete('documents');
      } catch (e) { knSetStatus(e.message || 'Failed to delete document', true); }
    }));
    li.append(main, actions);
    ul.appendChild(li);
  }
  const nodes = [ul];
  if (truncated) nodes.push(knEl('div', 'kn-muted kn-foot', 'Showing the first documents only.'));
  pane.replaceChildren(...nodes);
}

// ── Nodes tab

function knBuildNodesPane() {
  const m = _knModal;
  const pane = m.panes.nodes;
  const bar = knEl('div', 'kn-filters');
  const sel = knEl('select', 'kn-input');
  sel.setAttribute('aria-label', 'Filter by document');
  sel.addEventListener('change', () => { m.nodes.documentId = sel.value; knLoadNodes(true); });
  const search = knEl('input', 'kn-input kn-search');
  search.type = 'search';
  search.maxLength = 200;
  search.placeholder = 'Search titles';
  search.setAttribute('aria-label', 'Search node titles');
  search.value = m.nodes.q;
  let t = null;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { m.nodes.q = search.value.trim(); knLoadNodes(true); }, 250); });
  bar.append(sel, search);
  const count = knEl('div', 'kn-count');
  const list = knEl('ul', 'kn-list');
  const more = knEl('button', 'kn-btn kn-more', 'Load more');
  more.type = 'button';
  more.hidden = true;
  more.addEventListener('click', () => knLoadNodes(false));
  pane.replaceChildren(bar, count, list, more);
  m.nodes.refs = { sel, count, list, more };
  m.nodes.built = true;
  knSyncDocFilter();
}

// The document filter mirrors m.docs.list. A filtered document that is gone (deleted here, or in
// another tab) drops the filter back to "All sources" and marks the node list for a reload.
function knSyncDocFilter() {
  const m = _knModal;
  if (!m || !m.nodes.built) return;
  const sel = m.nodes.refs.sel;
  const all = knEl('option', null, 'All sources');
  all.value = '';
  const opts = [all];
  for (const d of m.docs.list) {
    const o = knEl('option', null, d.name || `Document ${d.id}`);
    o.value = String(d.id);
    opts.push(o);
  }
  sel.replaceChildren(...opts);
  if (m.nodes.documentId && !opts.some(o => o.value === m.nodes.documentId)) {
    m.nodes.documentId = '';
    m.nodesDirty = true;
  }
  sel.value = m.nodes.documentId;
}

async function knLoadNodes(reset) {
  const m = _knModal;
  if (!m) return;
  // The document filter lists the room's documents: read them first when the Nodes tab opens first.
  if (!m.nodes.built) {
    if (m.docsDirty) { m.panes.nodes.replaceChildren(knEl('div', 'kn-muted', 'loading…')); await knLoadDocs(); if (m !== _knModal) return; }
    knBuildNodesPane();
  }
  const st = m.nodes;
  const seq = ++st.seq;
  m.nodesDirty = false;
  const params = new URLSearchParams({ limit: String(KN_PAGE), offset: String(reset ? 0 : st.items.length) });
  if (st.documentId) params.set('document_id', st.documentId);
  if (st.q) params.set('q', st.q);
  st.refs.more.disabled = true;
  if (reset) st.refs.count.textContent = 'loading…';
  try {
    const data = await knFetch(`/api/rooms/${m.room.id}/knowledge/nodes?${params}`);
    if (m !== _knModal || seq !== st.seq) return;
    const items = Array.isArray(data.nodes) ? data.nodes : [];
    st.items = reset ? items : st.items.concat(items);
    st.total = Number(data.total) || 0;
    knRenderNodes(reset);
  } catch (e) {
    if (m !== _knModal || seq !== st.seq) return;
    m.nodesDirty = true;
    st.refs.count.textContent = '';
    if (reset) {
      st.items = [];
      st.total = 0;
      st.refs.more.hidden = true;
      st.refs.list.replaceChildren(knEl('li', 'kn-error kn-load-error', e.message || 'Failed to load nodes'));
    } else knSetStatus(e.message || 'Failed to load more nodes', true);
    // A 404 under a document filter means the document is gone: re-read the documents (the filter
    // drops it and falls back to all sources), then load the nodes again.
    if (e.status === 404 && st.documentId) {
      m.docsDirty = true;
      knLoadDocs().then(() => { if (m === _knModal && m.tab === 'nodes' && m.nodesDirty && !st.documentId) knLoadNodes(true); });
    }
  } finally {
    if (m === _knModal && seq === st.seq) st.refs.more.disabled = false;
  }
}

function knNodeRow(n) {
  const m = _knModal;
  const li = knEl('li', 'kn-item');
  li.dataset.nodeId = String(n.id);
  const main = knEl('div', 'kn-item-main');
  const top = knEl('div', 'kn-item-top');
  top.appendChild(knEl('span', 'kn-item-title', n.title || `Node ${n.id}`));
  if (n.category) top.appendChild(knEl('span', 'kn-chip', n.category));
  if (n.status === 'stale') top.appendChild(knEl('span', 'kn-chip kn-chip-stale', 'stale'));
  main.appendChild(top);
  if (n.summary_preview) main.appendChild(knEl('div', 'kn-summary', n.summary_preview));
  const meta = knEl('div', 'kn-meta');
  const src = n.sources || {};
  const parts = [];
  if (src.messages) parts.push(knPlural(src.messages, 'message', 'messages'));
  if (src.documents) parts.push(knPlural(src.documents, 'document section', 'document sections'));
  meta.appendChild(knEl('span', null, parts.length ? `from ${parts.join(' + ')}` : 'no remaining source here'));
  if (n.other_rooms) meta.appendChild(knEl('span', null, `also from ${knPlural(n.other_rooms, 'other room', 'other rooms')}`));
  const uses = Number(n.uses) || 0;
  if (uses) {
    const u = knEl('button', 'kn-link', `used ${uses}× · last ${knWhen(n.last_used_at)}`);
    u.type = 'button';
    u.addEventListener('click', () => { m.usage.nodeId = n.id; m.usage.nodeTitle = n.title || `Node ${n.id}`; m.usage.built = false; m.usageDirty = true; knSwitchTab('usage'); });
    meta.appendChild(u);
  } else {
    meta.appendChild(knEl('span', null, 'never used'));
  }
  meta.appendChild(knEl('span', null, `updated ${knWhen(n.updated_at)}`));
  main.appendChild(meta);
  const actions = knEl('div', 'kn-item-actions');
  actions.appendChild(knConfirmButton('Delete', 'Confirm delete', async () => {
    try {
      await knFetch(`/api/knowledge/nodes/${n.id}?room_id=${m.room.id}`, { method: 'DELETE' });
      if (m !== _knModal) return;
      m.nodes.items = m.nodes.items.filter(x => x.id !== n.id);
      m.nodes.total = Math.max(0, m.nodes.total - 1);
      li.remove();
      knRenderNodesCount();
      knSetStatus(uses
        ? `Deleted "${n.title}". Its usage history is kept under Usage history until you forget the trace.`
        : `Deleted "${n.title}".`);
      knAfterDelete('nodes');
    } catch (e) { knSetStatus(e.message || 'Failed to delete node', true); }
  }));
  li.append(main, actions);
  return li;
}

function knRenderNodesCount() {
  const st = _knModal.nodes;
  st.refs.count.textContent = st.total
    ? `${st.items.length} of ${knPlural(st.total, 'node', 'nodes')}`
    : '';
  st.refs.more.hidden = st.items.length >= st.total;
  if (!st.items.length && !st.refs.list.querySelector('.kn-empty')) {
    st.refs.list.replaceChildren(knEmpty(st.q || st.documentId ? 'No nodes match.' : 'No knowledge from this room yet.'));
  }
}

function knRenderNodes(reset) {
  const st = _knModal.nodes;
  const rows = (reset ? st.items : st.items.slice(st.refs.list.querySelectorAll('.kn-item').length)).map(knNodeRow);
  if (reset) st.refs.list.replaceChildren(...rows); else st.refs.list.append(...rows);
  knRenderNodesCount();
}

// ── Usage tab

function knBuildUsagePane() {
  const m = _knModal;
  const pane = m.panes.usage;
  const filter = knEl('div', 'kn-filters');
  if (m.usage.nodeId) {
    filter.appendChild(knEl('span', 'kn-filter-label', `Node: ${m.usage.nodeTitle}`));
    const clear = knEl('button', 'kn-btn kn-btn-quiet', 'Show all');
    clear.type = 'button';
    clear.addEventListener('click', () => { m.usage.nodeId = null; m.usage.built = false; knLoadUsage(true); });
    filter.appendChild(clear);
  }
  const note = knEl('div', 'kn-muted kn-note', 'Which agent read knowledge from this room, and where. Entries of deleted nodes stay until you forget the trace.');
  const list = knEl('ul', 'kn-list');
  const more = knEl('button', 'kn-btn kn-more', 'Load more');
  more.type = 'button';
  more.hidden = true;
  more.addEventListener('click', () => knLoadUsage(false));
  pane.replaceChildren(...(m.usage.nodeId ? [filter] : []), note, list, more);
  m.usage.refs = { list, more };
  m.usage.built = true;
}

async function knLoadUsage(reset) {
  const m = _knModal;
  if (!m) return;
  if (!m.usage.built) knBuildUsagePane();
  const st = m.usage;
  const seq = ++st.seq;
  m.usageDirty = false;
  const params = new URLSearchParams({ limit: String(KN_PAGE) });
  if (st.nodeId) params.set('node_id', String(st.nodeId));
  if (!reset && st.before) params.set('before_id', String(st.before));
  st.refs.more.disabled = true;
  try {
    const data = await knFetch(`/api/rooms/${m.room.id}/knowledge/usage?${params}`);
    if (m !== _knModal || seq !== st.seq) return;
    const items = Array.isArray(data.items) ? data.items : [];
    st.items = reset ? items : st.items.concat(items);
    st.before = data.next_before_id ?? null;
    const rows = items.map(knUsageRow);
    if (reset) st.refs.list.replaceChildren(...rows); else st.refs.list.append(...rows);
    if (!st.items.length) st.refs.list.replaceChildren(knEmpty('No agent has used knowledge from this room yet.'));
    st.refs.more.hidden = st.before == null;
  } catch (e) {
    if (m !== _knModal || seq !== st.seq) return;
    m.usageDirty = true;
    knSetStatus(e.message || 'Failed to load usage history', true);
  } finally {
    if (m === _knModal && seq === st.seq) st.refs.more.disabled = false;
  }
}

function knUsageRow(it) {
  const m = _knModal;
  const li = knEl('li', 'kn-item kn-usage' + (it.deleted ? ' kn-usage-deleted' : ''));
  const main = knEl('div', 'kn-item-main');
  const top = knEl('div', 'kn-item-top');
  top.appendChild(knEl('span', 'kn-item-title', it.node_title || `Node ${it.node_id}`));
  if (it.deleted) top.appendChild(knEl('span', 'kn-chip kn-chip-deleted', `deleted ${knWhen(it.deleted_at)}`));
  main.appendChild(top);
  const meta = knEl('div', 'kn-meta');
  const who = it.actor?.name || 'removed agent';
  meta.appendChild(knEl('span', 'kn-who', it.sub_agent ? `${who} · sub-agent ${it.sub_agent.label || ''}`.trim() : who));
  meta.appendChild(knEl('span', null, `in ${it.room?.title || 'a removed room'}`));
  const when = knEl('time', null, knWhen(it.used_at));
  const d = knDate(it.used_at);
  if (d) when.dateTime = d.toISOString();
  meta.appendChild(when);
  main.appendChild(meta);
  li.appendChild(main);
  const traceId = it.deleted ? (it.deleted_id ?? it.id) : null;
  if (traceId != null) {
    const actions = knEl('div', 'kn-item-actions');
    actions.appendChild(knConfirmButton('Forget trace', 'Confirm forget', async () => {
      try {
        await knFetch(`/api/rooms/${m.room.id}/knowledge/deleted/${traceId}`, { method: 'DELETE' });
        if (m !== _knModal) return;
        knSetStatus(`Forgot the trace of "${it.node_title}".`);
        knLoadUsage(true);
      } catch (e) { knSetStatus(e.message || 'Failed to forget the trace', true); }
    }));
    li.appendChild(actions);
  }
  return li;
}
