function imgFallback(img) {
  img.onerror = () => {
    img.onerror = null;
    img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" rx="6" fill="%23e8e0d6"/><path d="M44 50l12-16 10 12 6-7 8 11z" fill="%23c4b8a8"/><circle cx="46" cy="34" r="6" fill="%23c4b8a8"/><text x="60" y="72" text-anchor="middle" font-size="9" fill="%239a8f80" font-family="system-ui">image unavailable</text></svg>');
    img.style.opacity = '0.6';
    img.onclick = null;
  };
}

// ── Markdown rendering ─────────────────────────────────────────────────────
marked.use({
  breaks: true, gfm: true,
  renderer: {
    code(token) {
      const src = (typeof token === 'string' ? token : token.text) ?? '';
      const lang = typeof token === 'string' ? '' : (token.lang || '');
      if (!src) return `<pre><code>${''}</code></pre>`;
      let highlighted;
      const language = lang && hljs.getLanguage(lang) ? lang : null;
      try {
        highlighted = language
          ? hljs.highlight(src, { language }).value
          : hljs.highlightAuto(src).value;
      } catch { highlighted = src.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
      const langLabel = language
        ? `<span class="h-code-lang">${language}</span>`
        : '';
      return `<pre>${langLabel}<code class="hljs${language ? ' language-' + language : ''}">${highlighted}</code></pre>`;
    }
  }
});

function renderMarkdown(text) {
  if (!text) return '';
  return DOMPurify.sanitize(marked.parse(text), { ADD_ATTR: ['class'] });
}

async function copyToClipboard(text) {
  if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  return ok;
}

function showCopyFeedback(btn) {
  const row = btn.closest('.h-msg-row');
  if (row) row.classList.add('show-actions');
  const orig = btn.innerHTML;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5cb85c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  btn.classList.add('copied');
  setTimeout(() => {
    btn.innerHTML = orig;
    btn.classList.remove('copied');
    if (row) row.classList.remove('show-actions');
  }, 1500);
}

async function deleteMessage(msgId) {
  try { const res = await fetch(`/api/messages/${msgId}`, { method: 'DELETE' }); if (!res.ok) throw new Error(); } catch { showToast('Failed to delete message', { error: true }); }
}

function getAttachments(m) {
  let list = [];
  if (m.attachments) {
    try { list = typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments; } catch {}
  }
  if (!list.length) {
    if (m.image_url) list.push({ url: m.image_url, name: '', type: 'image' });
    if (m.file_url && m.file_name) {
      const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(m.file_name);
      list.push({ url: m.file_url, name: m.file_name, type: isImg ? 'image' : 'file' });
    }
  }
  return list;
}

function renderAttachments(bubble, m) {
  const attachments = getAttachments(m);
  if (!attachments.length) return;

  const images = attachments.filter(a => a.type === 'image');
  const files  = attachments.filter(a => a.type === 'file');

  if (images.length === 1) {
    const img = document.createElement('img');
    img.src = images[0].url;
    img.className = 'h-msg-img';
    img.loading = 'lazy';
    imgFallback(img);
    img.onclick = () => openLightbox(images, 0);
    bubble.appendChild(img);
  } else if (images.length > 1) {
    const wrap = document.createElement('div');
    wrap.className = 'h-gallery-wrap';
    const gallery = document.createElement('div');
    gallery.className = 'h-msg-gallery';
    const track = document.createElement('div');
    track.className = 'h-gallery-track';
    let tx = 0, maxScroll = 0;

    images.forEach((a, i) => {
      const img = document.createElement('img');
      img.src = a.url;
      img.loading = 'lazy';
      imgFallback(img);
      img.onclick = () => { if (!wasDragged) openLightbox(images, i); };
      img.style.pointerEvents = 'auto';
      img.style.cursor = 'pointer';
      track.appendChild(img);
    });
    gallery.appendChild(track);

    const counter = document.createElement('div');
    counter.className = 'h-gallery-counter';
    counter.textContent = images.length + ' images';

    function clamp(val) {
      maxScroll = Math.max(0, track.scrollWidth - gallery.offsetWidth);
      return Math.max(-maxScroll, Math.min(0, val));
    }
    function setPos(val, animate) {
      tx = clamp(val);
      if (animate) {
        track.classList.add('snapping');
        track.addEventListener('transitionend', () => track.classList.remove('snapping'), { once: true });
      } else {
        track.classList.remove('snapping');
      }
      track.style.transform = 'translateX(' + tx + 'px)';
    }

    let dragStartX = 0, dragOffset = 0, isDragging = false, wasDragged = false;

    function pointerDown(x) {
      isDragging = true;
      wasDragged = false;
      dragStartX = x;
      track.classList.remove('snapping');
      gallery.classList.add('dragging');
    }
    function pointerMove(x) {
      if (!isDragging) return;
      dragOffset = x - dragStartX;
      if (Math.abs(dragOffset) > 5) wasDragged = true;
      track.style.transform = 'translateX(' + clamp(tx + dragOffset) + 'px)';
    }
    function pointerUp() {
      if (!isDragging) return;
      isDragging = false;
      gallery.classList.remove('dragging');
      setPos(tx + dragOffset, true);
      dragOffset = 0;
    }

    gallery.addEventListener('touchstart', e => pointerDown(e.touches[0].clientX), { passive: true });
    gallery.addEventListener('touchmove', e => pointerMove(e.touches[0].clientX), { passive: true });
    gallery.addEventListener('touchend', pointerUp);

    gallery.addEventListener('mousedown', e => { e.preventDefault(); pointerDown(e.clientX); });
    document.addEventListener('mousemove', e => { if (isDragging) pointerMove(e.clientX); });
    document.addEventListener('mouseup', pointerUp);

    const scrollStep = 200;
    const btnL = document.createElement('button');
    btnL.className = 'h-gallery-nav left';
    btnL.innerHTML = '&#8249;';
    btnL.onclick = e => { e.stopPropagation(); setPos(tx + scrollStep, true); };
    const btnR = document.createElement('button');
    btnR.className = 'h-gallery-nav right';
    btnR.innerHTML = '&#8250;';
    btnR.onclick = e => { e.stopPropagation(); setPos(tx - scrollStep, true); };

    wrap.appendChild(gallery);
    wrap.appendChild(btnL);
    wrap.appendChild(btnR);
    wrap.appendChild(counter);
    bubble.appendChild(wrap);
  }

  files.forEach(a => {
    const link = document.createElement('a');
    link.href = a.url;
    link.target = '_blank';
    link.className = 'h-msg-file';
    link.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${escHtml(a.name)}`;
    bubble.appendChild(link);
  });
}

function openLightbox(images, startIdx) {
  const lb = document.getElementById('img-lightbox');
  const img = document.getElementById('img-lightbox-src');
  lb._images = images;
  lb._idx = startIdx;
  img.src = images[startIdx].url;
  lb.classList.toggle('has-nav', images.length > 1);
  lb.classList.add('visible');
}

function lbNav(dir) {
  const lb = document.getElementById('img-lightbox');
  if (!lb._images) return;
  lb._idx = (lb._idx + dir + lb._images.length) % lb._images.length;
  document.getElementById('img-lightbox-src').src = lb._images[lb._idx].url;
}

function addCopyButtons(el) {
  el.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.h-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'h-copy-btn';
    btn.textContent = 'copy';
    btn.onclick = async () => {
      const code = pre.querySelector('code');
      const text = code ? code.textContent : pre.textContent;
      if (await copyToClipboard(text)) {
        btn.textContent = 'copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('copied'); }, 2000);
      }
    };
    pre.appendChild(btn);
  });
}

function looksLikePath(text) {
  const t = text.trim();
  if (t.length < 3) return false;
  const hasSlash = t.includes('/') || t.includes('\\');
  if (!hasSlash) return false;
  if (/^https?:\/\//.test(t)) return false;
  if (/^[A-Za-z]:[\\\/]/.test(t)) return true;
  if (/^[~.]?[\\\/]/.test(t)) return true;
  if (/^\/[\w.\-]/.test(t)) return true;
  return false;
}

function linkifyFilePaths(el) {
  el.querySelectorAll('code').forEach(node => {
    if (node.closest('a') || node.classList.contains('h-file-link')) return;
    const text = node.textContent.trim();
    if (looksLikePath(text)) makeFileLink(node, text);
  });

  el.querySelectorAll('pre code').forEach(codeEl => {
    if (codeEl.closest('.h-file-link')) return;
    const text = codeEl.textContent.trim();
    if (looksLikePath(text) && text.split('\n').length <= 2) {
      const pre = codeEl.closest('pre');
      pre.style.cursor = 'pointer';
      pre.classList.add('h-file-link-block');
      pre.onclick = (e) => {
        if (e.target.closest('.h-copy-btn')) return;
        openFileFromPath(text.replace(/\n/g, ''));
      };
    }
  });
}

function makeFileLink(codeEl, filePath) {
  codeEl.classList.add('h-file-link');
  codeEl.style.cursor = 'pointer';
  codeEl.onclick = (e) => { e.preventDefault(); openFileFromPath(filePath); };
}

function openFileFromPath(absOrRelPath) {
  let filePath = absOrRelPath.replace(/\\/g, '/').replace(/\/+$/, '');
  let isAbsolute = /^\//.test(filePath) || /^[A-Za-z]:/.test(filePath);
  if (wsFileTreeRoot) {
    const root = wsFileTreeRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    if (filePath.startsWith(root + '/')) {
      filePath = filePath.slice(root.length + 1);
      isAbsolute = false;
    }
  }
  const panel = document.getElementById('workspace-panel');
  if (!panel.classList.contains('open')) toggleWorkspacePanel();
  const ext = wsGetExt(filePath);
  if (!ext) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(isAbsolute ? { type: 'file_list', abs_path: filePath } : { type: 'file_list' }));
    }
    wsActiveView = 'files';
    wsActiveFile = null;
    document.querySelectorAll('.ws-pin-tab').forEach(t => t.classList.toggle('active', t.dataset.wsPin === 'files'));
    wsRenderContent();
  } else {
    if (isAbsolute && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'file_read', path: filePath, absolute: true }));
    }
    wsOpenFile(filePath);
  }
}

