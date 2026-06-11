// ── Docs tab ─────────────────────────────────────────────────────────────────
let docsLang    = localStorage.getItem('stoa-docs-lang') || 'en';
let docsCatalog = [];   // [{ slug, title, langs }]
let docsActiveSlug = null;

async function sLoadDocsTab() {
  try {
    docsCatalog = await fjson('/api/docs');
    sRenderDocsLangRow();
    sRenderDocsSidebar();
  } catch { showToast('Failed to load docs', { error: true }); }
}

function sRenderDocsLangRow() {
  const allLangs = [...new Set(docsCatalog.flatMap(d => d.langs))].sort();
  const sel = document.getElementById('s-docs-lang-select');
  sel.innerHTML = '';
  for (const lang of allLangs) {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = STOA_LANGS[lang] || lang.toUpperCase();
    if (lang === docsLang) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = () => {
    docsLang = sel.value;
    localStorage.setItem('stoa-docs-lang', docsLang);
    sRenderDocsSidebar();
    if (docsActiveSlug) sOpenDoc(docsActiveSlug);
  };
}

function sRenderDocsSidebar() {
  const sidebar = document.getElementById('s-docs-sidebar');
  sidebar.innerHTML = '';
  for (const doc of docsCatalog) {
    const a = document.createElement('a');
    a.className = 's-docs-file' + (doc.slug === docsActiveSlug ? ' active' : '');
    a.textContent = doc.title;
    a.href = '#';
    a.dataset.slug = doc.slug;
    a.addEventListener('click', e => { e.preventDefault(); sOpenDoc(doc.slug); });
    sidebar.appendChild(a);
  }
}

async function sOpenDoc(slug) {
  docsActiveSlug = slug;
  document.querySelectorAll('.s-docs-file').forEach(el =>
    el.classList.toggle('active', el.dataset.slug === slug));
  const body = document.getElementById('s-docs-body');
  body.innerHTML = '<p class="s-docs-empty">loading…</p>';

  try {
    const doc = docsCatalog.find(d => d.slug === slug);
    const lang = doc?.langs.includes(docsLang) ? docsLang : 'en';
    const filename = `${slug}.${lang}.md`;
    const res = await fetch(`/api/docs/${encodeURIComponent(filename)}`);
    if (!res.ok) { body.innerHTML = '<p class="s-docs-empty">document not found.</p>'; return; }
    const md = await res.text();
    body.innerHTML = DOMPurify.sanitize(marked.parse(md), { ADD_ATTR: ['class'] });
    addCopyButtons(body);
    if (lang !== docsLang) {
      const note = document.createElement('p');
      note.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:12px;color:var(--h-ink-faint);margin-bottom:16px';
      note.textContent = `Translation not available — showing English version.`;
      body.insertBefore(note, body.firstChild);
    }
  } catch { body.innerHTML = '<p class="s-docs-empty">failed to load document.</p>'; }
}

