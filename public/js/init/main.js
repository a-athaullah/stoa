// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const saved = localStorage.getItem('stoa-theme');
  applyTheme(saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches));
  // Restore reading comfort preferences
  ['scale', 'leading', 'width'].forEach(k => {
    const v = localStorage.getItem('stoa-msg-' + k);
    if (v) {
      const cssVar = '--stoa-msg-' + k;
      document.documentElement.style.setProperty(cssVar, k === 'width' ? v + 'px' : v);
    }
  });
  document.getElementById('sidebar-collapse-btn').onclick = toggleSidebar;
  document.getElementById('empty-rooms-toggle').onclick = toggleSidebar;
  // Auth check — show login if not authenticated
  const isAuthed = await checkAuth();
  if (!isAuthed) { showLogin(); return; }
  hideLogin();
  requestNotifPermission();
  await checkSetup();
  try {
    allActors = await fjson('/api/actors');
  } catch (e) {
    console.error('Failed to load actors:', e);
    allActors = [];
  }
  allActors.forEach(a => actorByName[a.name] = a);
  humanActor = allActors.find(a => a.type === 'human');
  syncNewRoomBtn();
  renderSidebarFooter();
  renderComposerSeal();
  fetchPlatformModels();

  let rooms = [];
  try { rooms = await fjson('/api/rooms'); } catch (e) {
    console.error('Failed to load rooms, retrying:', e);
    await new Promise(r => setTimeout(r, 1000));
    try { rooms = await fjson('/api/rooms'); } catch (e2) { console.error('Retry failed:', e2); }
  }
  renderRoomList(rooms);

  if (rooms.length) {
    try {
      const ids = rooms.map(r => r.id).join(',');
      const grouped = await fjson(`/api/rooms/participants?ids=${ids}`);
      for (const room of rooms) {
        const parts = grouped[room.id] || [];
        roomParticipantsCache[room.id] = parts;
        renderRoomDots(room.id, parts);
      }
    } catch (e) { console.error('Failed to load participants:', e); }
  }

  // Keep messages scrolled when composer grows or virtual keyboard appears
  const composerEl = document.getElementById('composer');
  let lastComposerH = composerEl.offsetHeight;
  new ResizeObserver(() => {
    const h = composerEl.offsetHeight;
    if (h !== lastComposerH) {
      const msgEl = document.getElementById('messages');
      if (msgEl) msgEl.scrollTop += h - lastComposerH;
      lastComposerH = h;
    }
  }).observe(composerEl);

  if (window.visualViewport) {
    let lastVpH = window.visualViewport.height;
    window.visualViewport.addEventListener('resize', () => {
      const vpH = window.visualViewport.height;
      if (vpH < lastVpH) {
        const msgEl = document.getElementById('messages');
        if (msgEl) msgEl.scrollTop += lastVpH - vpH;
      }
      lastVpH = vpH;
    });
  }

  // Textarea — auto-resize + skill autocomplete
  const input = document.getElementById('msg-input');
  input.addEventListener('input', onComposerInput);
  input.addEventListener('keydown', e => {
    const popup = document.getElementById('skill-popup');
    const popupOpen = popup.style.display !== 'none';
    const mPopup = document.getElementById('mention-popup');
    const mOpen = mPopup.style.display !== 'none';

    if (popupOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      skillPopupNavigate(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (mOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      mentionPopupNavigate(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (popupOpen && e.key === 'Tab') {
      e.preventDefault();
      const active = popup.querySelector('.h-skill-item.active') || popup.querySelector('.h-skill-item');
      if (active) applySkill(active.querySelector('.h-skill-name').textContent.slice(1));
      return;
    }
    if (mOpen && e.key === 'Tab') {
      e.preventDefault();
      const active = mPopup.querySelector('.h-mention-item.active') || mPopup.querySelector('.h-mention-item');
      if (active) applyMention(active.querySelector('.h-mention-name').textContent);
      return;
    }
    if (popupOpen && e.key === 'Escape') {
      e.preventDefault(); hideSkillPopup(); return;
    }
    if (mOpen && e.key === 'Escape') {
      e.preventDefault(); hideMentionPopup(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'X') {
      e.preventDefault(); document.execCommand('strikeThrough', false, null); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
      e.preventDefault(); applyFormat('code'); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault(); applyFormat('link'); return;
    }

    // Tab indent/outdent in lists (Slack behavior)
    if (e.key === 'Tab') {
      const sel = window.getSelection();
      const li = sel.rangeCount && findAncestorTag(sel.anchorNode, 'LI');
      if (li) {
        e.preventDefault();
        document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, null);
        return;
      }
    }

    // Enter inside code block → newline (unless "Enter to send" is on without Shift)
    if (e.key === 'Enter') {
      const sel0 = window.getSelection();
      const pre0 = sel0.rangeCount && findAncestorTag(sel0.anchorNode, 'PRE');
      if (pre0 && (e.shiftKey || !document.getElementById('enter-send-toggle').classList.contains('active'))) {
        e.preventDefault();
        // Exit code block: Enter on empty line exits (Slack behavior)
        const preText = pre0.textContent;
        if (!preText || preText === '\n') {
          const div = document.createElement('div');
          div.innerHTML = '<br>';
          pre0.parentNode.insertBefore(div, pre0.nextSibling);
          pre0.remove();
          const r = document.createRange();
          r.setStart(div, 0);
          r.collapse(true);
          sel0.removeAllRanges(); sel0.addRange(r);
          return;
        }
        const range = sel0.getRangeAt(0);
        // Split: text after cursor goes to new <pre>
        const afterRange = document.createRange();
        afterRange.setStart(range.endContainer, range.endOffset);
        afterRange.setEnd(pre0, pre0.childNodes.length);
        const afterContent = afterRange.extractContents();
        const newPre = document.createElement('pre');
        if (afterContent.textContent || afterContent.querySelector('br')) {
          newPre.appendChild(afterContent);
        } else {
          newPre.innerHTML = '<br>';
        }
        pre0.parentNode.insertBefore(newPre, pre0.nextSibling);
        // If current pre is now empty, add <br> placeholder
        if (!pre0.textContent && !pre0.querySelector('br')) {
          pre0.innerHTML = '<br>';
        }
        const r = document.createRange();
        r.setStart(newPre, 0);
        r.collapse(true);
        sel0.removeAllRanges(); sel0.addRange(r);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (popupOpen && skillPopupIdx >= 0) {
        e.preventDefault();
        const active = popup.querySelector('.h-skill-item.active');
        if (active) applySkill(active.querySelector('.h-skill-name').textContent.slice(1));
        return;
      }
      if (mOpen && mentionPopupIdx >= 0) {
        e.preventDefault();
        const active = mPopup.querySelector('.h-mention-item.active');
        if (active) applyMention(active.querySelector('.h-mention-name').textContent);
        return;
      }
      // List continuation: Enter on empty list item exits list (Slack behavior)
      const sel = window.getSelection();
      const li = sel.rangeCount && findAncestorTag(sel.anchorNode, 'LI');
      if (li) {
        if (li.textContent === '' || li.textContent === '​') {
          e.preventDefault();
          const list = li.closest('ol, ul');
          li.remove();
          if (list && list.children.length === 0) list.remove();
          document.execCommand('insertParagraph', false, null);
          document.execCommand('outdent', false, null);
        }
        return; // let default Enter create next li
      }
      // "Enter to send" toggle — when off, Enter = newline
      if (!document.getElementById('enter-send-toggle').classList.contains('active')) return;
      e.preventDefault(); sendMessage();
    }
  });

  // Markdown shortcuts (Slack behavior): *bold*, _italic_, ~strike~, `code`, ```codeblock
  let mdProcessing = false;
  input.addEventListener('input', () => {
    if (mdProcessing) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const node = sel.anchorNode;
    if (!node) return;
    const tNode = node.nodeType === 3 ? node : null;
    if (!tNode) return;
    if (tNode.parentElement && tNode.parentElement.closest('pre')) return;
    const text = tNode.textContent;
    const cursor = sel.anchorOffset;
    const before = text.substring(0, cursor);

    // ``` — triple backtick instantly creates empty code block (Slack behavior)
    if (before.endsWith('```')) {
      mdProcessing = true;
      const start = cursor - 3;
      const range = document.createRange();
      range.setStart(tNode, start);
      range.setEnd(tNode, cursor);
      range.deleteContents();
      const pre = document.createElement('pre');
      pre.innerHTML = '<br>';
      if (tNode.textContent === '') {
        tNode.parentElement.replaceChild(pre, tNode);
      } else {
        range.insertNode(pre);
      }
      const r2 = document.createRange();
      r2.setStart(pre, 0);
      r2.collapse(true);
      sel.removeAllRanges(); sel.addRange(r2);
      mdProcessing = false;
      return;
    }

    // `code` — single backtick inline (but not ```)
    const codeMatch = before.match(/(?<!`)`([^`]+?)`$/);
    if (codeMatch) {
      mdProcessing = true;
      const start = cursor - codeMatch[0].length;
      const content = codeMatch[1];
      const range = document.createRange();
      range.setStart(tNode, start);
      range.setEnd(tNode, cursor);
      range.deleteContents();
      const code = document.createElement('code');
      code.textContent = content;
      range.insertNode(code);
      const r2 = document.createRange();
      r2.setStartAfter(code);
      r2.collapse(true);
      sel.removeAllRanges(); sel.addRange(r2);
      document.execCommand('insertText', false, '​');
      mdProcessing = false;
      return;
    }

    // Inline patterns: *bold*, _italic_, ~strike~
    const patterns = [
      { re: /\*([^\*]+?)\*$/, tag: 'strong' },
      { re: /(?:^|(?<=\s))_([^_]+?)_$/, tag: 'em' },
      { re: /~(?!\/)([^~]+?)~$/, tag: 's' },
    ];
    for (const p of patterns) {
      const m = before.match(p.re);
      if (m) {
        mdProcessing = true;
        const start = cursor - m[0].length;
        const content = m[1];
        const range = document.createRange();
        range.setStart(tNode, start);
        range.setEnd(tNode, cursor);
        range.deleteContents();
        const el = document.createElement(p.tag);
        el.textContent = content;
        range.insertNode(el);
        const r2 = document.createRange();
        r2.setStartAfter(el);
        r2.collapse(true);
        sel.removeAllRanges(); sel.addRange(r2);
        document.execCommand('insertText', false, '​');
        mdProcessing = false;
        return;
      }
    }
  });

  input.addEventListener('paste', e => {
    const items = [...(e.clipboardData?.items || [])];
    if (items.find(i => i.type.startsWith('image/'))) { hideMentionPopup(); hideSkillPopup(); handleImagePaste(e); return; }
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const urlRe = /^https?:\/\/\S+$/;
    const sel = window.getSelection();
    if (urlRe.test(text.trim()) && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      const selectedText = sel.toString();
      const a = document.createElement('a');
      a.href = text.trim();
      if (selectedText) {
        a.textContent = selectedText;
        range.deleteContents();
      } else {
        a.textContent = text.trim();
      }
      range.insertNode(a);
      range.setStartAfter(a);
      range.collapse(true);
      sel.removeAllRanges(); sel.addRange(range);
    } else {
      document.execCommand('insertText', false, text);
    }
  });

  // ── Formatting toolbar ──────────────────────────────────────────────────────
  function findAncestorTag(node, tag) {
    while (node && node !== input) {
      if (node.nodeName === tag) return node;
      node = node.parentElement;
    }
    return null;
  }

  function applyFormat(fmt) {
    input.focus();
    if (fmt === 'bold')   { document.execCommand('bold',          false, null); return; }
    if (fmt === 'italic') { document.execCommand('italic',        false, null); return; }
    if (fmt === 'strike') { document.execCommand('strikeThrough', false, null); return; }
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    if (fmt === 'code') {
      const existing = findAncestorTag(sel.anchorNode, 'CODE');
      if (existing && !existing.closest('pre')) {
        const parent = existing.parentElement;
        while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
        parent.removeChild(existing);
        return;
      }
    }
    if (fmt === 'codeblock') {
      const existing = findAncestorTag(sel.anchorNode, 'PRE');
      if (existing) {
        // Simply unwrap this <pre> into a <div> — each line is its own <pre>
        const div = document.createElement('div');
        div.innerHTML = existing.textContent || '<br>';
        existing.parentElement.replaceChild(div, existing);
        const r = document.createRange();
        r.selectNodeContents(div);
        r.collapse(false);
        sel.removeAllRanges(); sel.addRange(r);
        return;
      }
    }
    if (fmt === 'ol' || fmt === 'ul') {
      document.execCommand(fmt === 'ol' ? 'insertOrderedList' : 'insertUnorderedList', false, null);
      return;
    }
    if (fmt === 'blockquote') {
      const existing = findAncestorTag(sel.anchorNode, 'BLOCKQUOTE');
      if (existing) {
        document.execCommand('outdent', false, null);
      } else {
        document.execCommand('formatBlock', false, 'blockquote');
      }
      return;
    }
    if (fmt === 'link') {
      const text = sel.toString();
      wsShowPrompt('Insert link', '', 'https://...', (url) => {
        if (!url) return;
        const s = window.getSelection();
        if (text && s.rangeCount) {
          document.execCommand('createLink', false, url);
        } else if (s.rangeCount) {
          const a = document.createElement('a');
          a.href = url; a.textContent = url;
          const r = s.getRangeAt(0);
          r.insertNode(a);
          r.setStartAfter(a);
          r.collapse(true);
          s.removeAllRanges();
          s.addRange(r);
        }
      });
      return;
    }

    const text = sel.toString();
    const el = fmt === 'codeblock'
      ? Object.assign(document.createElement('pre'),  { textContent: text || '​' })
      : Object.assign(document.createElement('code'), { textContent: text || '​' });
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(el);
    range.setStartAfter(el);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  document.querySelectorAll('.h-fmt-btn').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      applyFormat(btn.dataset.fmt);
    });
  });

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel.rangeCount || !input.contains(sel.anchorNode)) return;
    document.querySelector('[data-fmt="bold"]')?.classList.toggle('active', document.queryCommandState('bold'));
    document.querySelector('[data-fmt="italic"]')?.classList.toggle('active', document.queryCommandState('italic'));
    document.querySelector('[data-fmt="strike"]')?.classList.toggle('active', document.queryCommandState('strikeThrough'));
    const inCode = !!findAncestorTag(sel.anchorNode, 'CODE') && !findAncestorTag(sel.anchorNode, 'PRE');
    const inPre = !!findAncestorTag(sel.anchorNode, 'PRE');
    document.querySelector('[data-fmt="code"]')?.classList.toggle('active', inCode);
    document.querySelector('[data-fmt="codeblock"]')?.classList.toggle('active', inPre);
    document.querySelector('[data-fmt="blockquote"]')?.classList.toggle('active', !!findAncestorTag(sel.anchorNode, 'BLOCKQUOTE'));
    document.querySelector('[data-fmt="ol"]')?.classList.toggle('active', !!findAncestorTag(sel.anchorNode, 'OL'));
    document.querySelector('[data-fmt="ul"]')?.classList.toggle('active', !!findAncestorTag(sel.anchorNode, 'UL'));
    document.querySelector('[data-fmt="link"]')?.classList.toggle('active', !!findAncestorTag(sel.anchorNode, 'A'));
  });

  // "Enter to send" toggle — default ON desktop, OFF mobile
  const enterToggle = document.getElementById('enter-send-toggle');
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
  const savedPref = localStorage.getItem('stoa-enter-send');
  const enterSendOn = savedPref !== null ? savedPref === 'true' : !isMobile;
  if (enterSendOn) enterToggle.classList.add('active');
  enterToggle.addEventListener('click', () => {
    enterToggle.classList.toggle('active');
    localStorage.setItem('stoa-enter-send', enterToggle.classList.contains('active'));
  });

  document.getElementById('send-btn').addEventListener('click', sendMessage);
  document.getElementById('stop-btn').addEventListener('click', stopGeneration);
  document.getElementById('new-room-btn').addEventListener('click', openNewRoomModal);
  initEmojiPicker();
  initScrollLoader();
  document.getElementById('new-room-create').addEventListener('click', submitNewRoom);
  document.getElementById('new-room-cancel').addEventListener('click', () => {
    document.getElementById('new-room-modal').style.display = 'none';
  });
  document.getElementById('new-room-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitNewRoom();
    if (e.key === 'Escape') document.getElementById('new-room-modal').style.display = 'none';
  });
  document.getElementById('new-room-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('new-room-modal')) {
      document.getElementById('new-room-modal').style.display = 'none';
    }
  });
  document.getElementById('add-agent-submit').addEventListener('click', submitAddAgent);
  document.getElementById('add-agent-cancel').addEventListener('click', () => {
    document.getElementById('add-agent-modal').style.display = 'none';
  });
  document.getElementById('add-agent-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('add-agent-modal')) {
      document.getElementById('add-agent-modal').style.display = 'none';
    }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && wsEditMode) {
      e.preventDefault();
      wsSaveFile();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && currentRoomId) {
      e.preventDefault();
      toggleRoomSearch();
    }
    if (e.key === 'Escape') {
      if (wsExpanded) { wsToggleExpand(); return; }
      if (wsEditMode && !wsEditDirty) { wsExitEditMode(true); return; }
      const scrim = document.querySelector('.ws-scrim');
      if (scrim) { scrim.remove(); return; }
      const ctxMenu = document.querySelector('.ws-ctx-menu');
      if (ctxMenu) { ctxMenu.remove(); return; }
      const bar = document.getElementById('room-search-bar');
      if (bar.classList.contains('visible')) { closeRoomSearch(); return; }
      if (processingMessages.size > 0) { stopGeneration(); return; }
      hideSkillPopup();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (wsEditMode && wsEditDirty) { e.preventDefault(); e.returnValue = ''; }
  });
  window.onerror = (msg, src, line, col, err) => {
    fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, source: `${src}:${line}:${col}`, stack: err?.stack }) }).catch(() => {});
  };
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message || String(e.reason);
    fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Unhandled rejection: ' + msg, source: e.reason?.stack }) }).catch(() => {});
  });

  // Attach menu
  const attachMenu = document.getElementById('attach-menu');
  document.getElementById('attach-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    attachMenu.classList.toggle('visible');
  });
  document.addEventListener('click', () => attachMenu.classList.remove('visible'));

  async function compressImage(file, maxDim, quality = 0.8) {
    if (!maxDim) maxDim = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 1280 : 1920;
    let bmp;
    if (typeof createImageBitmap === 'function') {
      bmp = await createImageBitmap(file);
    } else {
      bmp = await new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
        img.src = url;
      });
    }
    let { width, height } = bmp;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, width, height);
    if (bmp.close) bmp.close();
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('Compression failed'));
        const baseName = file.name.replace(/\.[^.]+$/, '') + '.webp';
        resolve(new File([blob], baseName, { type: 'image/webp' }));
      }, 'image/webp', quality);
    });
  }

  async function handleFileUpload(file, isImage) {
    try {
      let toUpload = file;
      if (isImage && file.size > 200 * 1024) {
        try {
          toUpload = await compressImage(file);
        } catch {
          try { toUpload = await compressImage(file, 800, 0.7); } catch { /* upload original */ }
        }
      }
      const { url, name } = await uploadWithProgress(toUpload);
      addPendingAttachment(url, name || file.name, isImage ? 'image' : 'file');
    } catch (err) {
      showUploadError(err.message || 'Upload failed');
    }
  }

  document.getElementById('attach-photo').addEventListener('click', () => {
    attachMenu.classList.remove('visible');
    const fi = document.createElement('input');
    fi.type = 'file';
    fi.accept = 'image/*';
    fi.multiple = true;
    fi.onchange = () => { for (const f of fi.files) handleFileUpload(f, true); };
    fi.click();
  });

  document.getElementById('attach-file').addEventListener('click', () => {
    attachMenu.classList.remove('visible');
    const fi = document.createElement('input');
    fi.type = 'file';
    fi.multiple = true;
    fi.onchange = () => { for (const f of fi.files) handleFileUpload(f, f.type.startsWith('image/')); };
    fi.click();
  });

  // Drag & drop file upload on composer
  const composer = document.getElementById('composer');
  composer.addEventListener('dragover', e => {
    e.preventDefault();
    composer.classList.add('drag-over');
  });
  composer.addEventListener('dragleave', e => {
    if (!composer.contains(e.relatedTarget)) composer.classList.remove('drag-over');
  });
  composer.addEventListener('drop', e => {
    e.preventDefault();
    composer.classList.remove('drag-over');
    for (const file of e.dataTransfer.files) {
      handleFileUpload(file, file.type.startsWith('image/'));
    }
  });

  initSettings();
  initGlobalWs();
}


