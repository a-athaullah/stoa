// Non-image attachments render as a card with Download (original name via ?download=1&name=)
// and, for a fixed allowlist of passive types, an in-app Preview. HTML/SVG/JS and anything
// else are download-only: previewing them would run untrusted markup on the Stoa origin.
const FILE_PREVIEW_KINDS = {
  pdf: 'pdf',
  md: 'markdown', markdown: 'markdown',
  csv: 'csv', tsv: 'tsv',
  txt: 'text', log: 'text', yaml: 'text', yml: 'text',
  json: 'json',
};
const FILE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const FILE_PREVIEW_MAX_ROWS = 500;
const FILE_SERVED_PREFIXES = ['/uploads/', '/connector-media/'];
let filePreviewToken = 0;

const FILE_ICONS = {
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  text: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
  table: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><rect x="7.5" y="11.5" width="9" height="7" rx="0.5"/><line x1="7.5" y1="15" x2="16.5" y2="15"/><line x1="12" y1="11.5" x2="12" y2="18.5"/>',
  code: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="10 12.5 8 15 10 17.5"/><polyline points="14 12.5 16 15 14 17.5"/>',
  archive: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="10" y1="6" x2="10" y2="7"/><line x1="10" y1="10" x2="10" y2="11"/><rect x="8.5" y="14" width="3" height="4" rx="0.5"/>',
  media: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polygon points="10 12 15 15 10 18 10 12"/>',
};
const FILE_ICON_BY_EXT = {
  pdf: 'text', md: 'text', markdown: 'text', txt: 'text', log: 'text', doc: 'text', docx: 'text', rtf: 'text',
  csv: 'table', tsv: 'table', xls: 'table', xlsx: 'table',
  json: 'code', yaml: 'code', yml: 'code', html: 'code', htm: 'code', js: 'code', ts: 'code', py: 'code', svg: 'code', xml: 'code',
  zip: 'archive', gz: 'archive', tgz: 'archive', tar: 'archive', rar: 'archive', '7z': 'archive',
  mp4: 'media', mov: 'media', webm: 'media', mp3: 'media', ogg: 'media', wav: 'media', m4a: 'media',
};

function fileIconSvg(ext, size) {
  const body = FILE_ICONS[FILE_ICON_BY_EXT[ext] || 'doc'];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function fileExtOf(name) {
  const m = /\.([a-z0-9]{1,10})$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

function fileResolveUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const u = new URL(raw, location.origin);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch { return null; }
}

function fileIsServed(u) {
  return u.origin === location.origin && FILE_SERVED_PREFIXES.some(p => u.pathname.startsWith(p));
}

function fileDownloadHref(u, name) {
  if (!fileIsServed(u)) return u.href;
  const d = new URL(u.href);
  d.searchParams.set('download', '1');
  if (name) d.searchParams.set('name', name);
  return d.href;
}

function fileDisplayName(a, u) {
  if (a.name) return String(a.name);
  const base = u ? u.pathname.split('/').pop() : '';
  try { return decodeURIComponent(base) || 'file'; } catch { return base || 'file'; }
}

// The served Content-Type follows the on-disk extension, so the preview kind does too:
// a message claiming "report.pdf" for /uploads/x.html must not get a PDF iframe.
function filePreviewKind(u) {
  if (!u || !fileIsServed(u)) return null;
  return FILE_PREVIEW_KINDS[fileExtOf(u.pathname)] || null;
}

// Label and icon describe the file that will actually download, so served files use the on-disk extension too.
function fileCardExt(u, name) {
  if (u && fileIsServed(u)) return fileExtOf(u.pathname) || fileExtOf(name);
  return fileExtOf(name) || (u ? fileExtOf(u.pathname) : '');
}

function renderFileCard(a) {
  const u = fileResolveUrl(a.url);
  const name = fileDisplayName(a, u);
  const ext = fileCardExt(u, name);
  const kind = filePreviewKind(u);

  const card = document.createElement('div');
  card.className = 'h-file-card';

  const icon = document.createElement('span');
  icon.className = 'h-file-card-icon';
  icon.innerHTML = fileIconSvg(ext, 20);
  card.appendChild(icon);

  const meta = document.createElement('div');
  meta.className = 'h-file-card-meta';
  const nameEl = document.createElement('span');
  nameEl.className = 'h-file-card-name';
  nameEl.textContent = name;
  nameEl.title = name;
  const kindEl = document.createElement('span');
  kindEl.className = 'h-file-card-kind';
  kindEl.textContent = ext ? ext.toUpperCase() : 'File';
  meta.append(nameEl, kindEl);
  card.appendChild(meta);

  if (!u) return card;

  const actions = document.createElement('div');
  actions.className = 'h-file-card-actions';
  if (kind) {
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'h-file-card-btn';
    prev.textContent = 'Preview';
    prev.setAttribute('aria-label', `Preview ${name}`);
    prev.onclick = () => openFilePreview({ url: u, name, ext, kind });
    actions.appendChild(prev);
  }
  actions.appendChild(fileDownloadLink(u, name, 'h-file-card-btn'));
  card.appendChild(actions);
  return card;
}

function fileDownloadLink(u, name, className) {
  const dl = document.createElement('a');
  dl.className = className;
  dl.href = fileDownloadHref(u, name);
  dl.textContent = 'Download';
  dl.setAttribute('aria-label', `Download ${name}`);
  if (fileIsServed(u)) dl.setAttribute('download', '');
  else { dl.target = '_blank'; dl.rel = 'noopener noreferrer'; }
  return dl;
}

function filePreviewDialog() {
  let dlg = document.getElementById('file-preview');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'file-preview';
  dlg.className = 'fp-dialog';
  dlg.setAttribute('aria-labelledby', 'file-preview-name');

  const head = document.createElement('div');
  head.className = 'fp-head';
  const icon = document.createElement('span');
  icon.className = 'fp-icon';
  const title = document.createElement('div');
  title.className = 'fp-title';
  const nameEl = document.createElement('span');
  nameEl.className = 'fp-name';
  nameEl.id = 'file-preview-name';
  const sub = document.createElement('span');
  sub.className = 'fp-sub';
  title.append(nameEl, sub);
  const actions = document.createElement('div');
  actions.className = 'fp-actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'fp-close';
  close.setAttribute('aria-label', 'Close preview');
  close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
  close.onclick = () => dlg.close();
  head.append(icon, title, actions, close);

  const body = document.createElement('div');
  body.className = 'fp-body';
  dlg.append(head, body);

  // A drag across the backdrop edge (e.g. a text selection) still fires click on the dialog,
  // so close only when the press and the release both landed on the backdrop.
  let pressedBackdrop = false;
  let releasedBackdrop = false;
  dlg.addEventListener('pointerdown', e => { pressedBackdrop = e.target === dlg; });
  dlg.addEventListener('pointerup', e => { releasedBackdrop = e.target === dlg; });
  dlg.addEventListener('click', e => {
    if (e.target === dlg && pressedBackdrop && releasedBackdrop) dlg.close();
    pressedBackdrop = releasedBackdrop = false;
  });
  // Esc closes the dialog natively; keep it from reaching the global handler (stop generation, etc.)
  dlg.addEventListener('keydown', e => { if (e.key === 'Escape') e.stopPropagation(); });
  dlg.addEventListener('close', () => {
    filePreviewToken++;
    body.replaceChildren();
  });
  document.body.appendChild(dlg);
  return dlg;
}

function openFilePreview(file) {
  const dlg = filePreviewDialog();
  const token = ++filePreviewToken;
  dlg.querySelector('.fp-icon').innerHTML = fileIconSvg(file.ext, 18);
  dlg.querySelector('.fp-name').textContent = file.name;
  dlg.querySelector('.fp-name').title = file.name;
  dlg.querySelector('.fp-sub').textContent = file.ext ? file.ext.toUpperCase() : 'File';
  dlg.querySelector('.fp-actions').replaceChildren(fileDownloadLink(file.url, file.name, 'fp-btn'));
  dlg.classList.toggle('is-pdf', file.kind === 'pdf');
  const body = dlg.querySelector('.fp-body');
  body.replaceChildren();
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('.fp-close').focus();

  if (file.kind === 'pdf') {
    const frame = document.createElement('iframe');
    frame.className = 'fp-frame';
    frame.src = file.url.href;
    frame.title = file.name;
    body.appendChild(frame);
    return;
  }

  body.appendChild(filePreviewNote('Loading preview…'));
  filePreviewFetchText(file.url)
    .then(text => {
      if (token !== filePreviewToken) return;
      body.replaceChildren(filePreviewRender(file.kind, text));
      body.scrollTop = 0;
    })
    .catch(err => {
      if (token !== filePreviewToken) return;
      body.replaceChildren(filePreviewError(err, file));
    });
}

async function filePreviewFetchText(u) {
  let res;
  try {
    res = await fetch(u.href, { credentials: 'same-origin' });
  } catch {
    throw { reason: 'network' };
  }
  if (!res.ok) throw { reason: 'http', status: res.status };
  const len = Number(res.headers.get('content-length'));
  if (len > FILE_PREVIEW_MAX_BYTES) {
    res.body?.cancel().catch(() => {});
    throw { reason: 'large', size: len };
  }
  const blob = await res.blob();
  if (blob.size > FILE_PREVIEW_MAX_BYTES) throw { reason: 'large', size: blob.size };
  return blob.text();
}

function filePreviewNote(text) {
  const p = document.createElement('p');
  p.className = 'fp-note';
  p.textContent = text;
  return p;
}

// Both sizes share one unit (KB near the limit). The size rounds up and the limit down to 0.1,
// so a file even one byte over never shows the same number as the limit.
function fileSizePair(bytes, limit) {
  const [div, unit] = bytes < 10 * 1048576 ? [1024, 'KB'] : [1048576, 'MB'];
  const fmt = (n, round) => `${(round(n / div * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}`;
  return [fmt(bytes, Math.ceil), fmt(limit, Math.floor)];
}

function filePreviewError(err, file) {
  const box = document.createElement('div');
  box.className = 'fp-empty';
  let msg;
  if (err?.reason === 'large') {
    const [size, limit] = fileSizePair(err.size, FILE_PREVIEW_MAX_BYTES);
    msg = `This file is too large to preview (${size}, limit ${limit}). Download it to view.`;
  } else if (err?.reason === 'http' && (err.status === 404 || err.status === 410)) {
    msg = 'This file is no longer available. It may have been removed by cleanup.';
  } else if (err?.reason === 'http') {
    msg = `Couldn't load the preview (HTTP ${err.status}).`;
  } else if (err?.reason === 'network') {
    msg = "Couldn't load the preview. Check your connection and try again.";
  } else {
    msg = "Couldn't load the preview.";
  }
  box.appendChild(filePreviewNote(msg));
  if (err?.reason === 'large') box.appendChild(fileDownloadLink(file.url, file.name, 'fp-btn'));
  return box;
}

function filePreviewRender(kind, text) {
  if (!text.trim()) return filePreviewNote('This file is empty.');
  if (kind === 'markdown') {
    const md = document.createElement('div');
    md.className = 'ws-md-body fp-md';
    md.innerHTML = renderMarkdown(text);
    externalLinksNewTab(md);
    addCopyButtons(md);
    return md;
  }
  if (kind === 'csv' || kind === 'tsv') return filePreviewTable(text, kind === 'tsv' ? '\t' : ',');
  const pre = document.createElement('pre');
  pre.className = 'fp-pre';
  if (kind === 'json') {
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch {}
  }
  pre.textContent = text;
  return pre;
}

function parseDelimited(text, delim) {
  const rows = [];
  let row = [], field = '', quoted = false;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delim) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}

// Long cells are clipped with an ellipsis. Hover marks a clipped cell (title + pointer cursor);
// a click or tap toggles it open, wrapped in place. Measured lazily so 500 rows cost no layout up front.
function filePreviewTableCellExpand(table) {
  const isClipped = td => td.scrollWidth > td.clientWidth;
  table.addEventListener('pointerover', e => {
    const td = e.target.closest('td');
    if (!td || td.classList.contains('is-open')) return;
    const clipped = isClipped(td);
    td.classList.toggle('is-clip', clipped);
    if (clipped) td.title = td.textContent;
    else td.removeAttribute('title');
  });
  table.addEventListener('click', e => {
    const td = e.target.closest('td');
    if (!td || e.detail > 1 || !getSelection().isCollapsed) return;
    if (td.classList.contains('is-open')) {
      td.classList.replace('is-open', 'is-clip');
      td.title = td.textContent;
      return;
    }
    if (!isClipped(td)) return;
    td.classList.remove('is-clip');
    td.classList.add('is-open');
    td.removeAttribute('title');
  });
}

function filePreviewTable(text, delim) {
  const rows = parseDelimited(text, delim);
  if (!rows.length) return filePreviewNote('This file is empty.');
  const [header, ...data] = rows;
  const shown = data.slice(0, FILE_PREVIEW_MAX_ROWS);
  const cols = Math.max(header.length, ...shown.map(r => r.length));

  const table = document.createElement('table');
  table.className = 'fp-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (let c = 0; c < cols; c++) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = header[c] ?? '';
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  const tbody = document.createElement('tbody');
  const frag = document.createDocumentFragment();
  shown.forEach(r => {
    const tr = document.createElement('tr');
    for (let c = 0; c < cols; c++) {
      const td = document.createElement('td');
      td.textContent = r[c] ?? '';
      tr.appendChild(td);
    }
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  table.append(thead, tbody);
  filePreviewTableCellExpand(table);

  const caption = filePreviewNote(data.length > shown.length
    ? `Showing ${shown.length.toLocaleString()} of ${data.length.toLocaleString()} rows. Download the file to see all of them.`
    : `${data.length.toLocaleString()} ${data.length === 1 ? 'row' : 'rows'}`);
  caption.classList.add('fp-caption');
  const wrap = document.createElement('div');
  wrap.className = 'fp-table-wrap';
  wrap.append(caption, table);
  return wrap;
}
