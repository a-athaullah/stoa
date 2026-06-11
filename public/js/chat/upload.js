// ── Upload with progress ──────────────────────────────────────────────────
function uploadWithProgress(file) {
  return new Promise((resolve, reject) => {
    const prog = document.getElementById('upload-progress');
    const fill = document.getElementById('upload-progress-fill');
    const text = document.getElementById('upload-progress-text');
    prog.classList.add('visible');
    prog.classList.remove('processing');
    fill.style.width = '0%';
    text.textContent = 'Uploading...';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload/raw');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'file'));
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        fill.style.width = pct + '%';
        const kb = Math.round(e.loaded / 1024);
        const totalKb = Math.round(e.total / 1024);
        if (pct < 100) {
          text.textContent = `Uploading... ${pct}% (${kb}/${totalKb} KB)`;
        } else {
          prog.classList.add('processing');
          text.textContent = 'Processing...';
        }
      }
    };
    xhr.onload = () => {
      prog.classList.remove('visible', 'processing');
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('Invalid response')); }
      } else {
        reject(new Error('Upload failed: ' + xhr.status));
      }
    };
    xhr.onerror = () => { prog.classList.remove('visible', 'processing'); reject(new Error('Network error')); };
    xhr.send(file);
  });
}

// ── Image paste ────────────────────────────────────────────────────────────
async function handleImagePaste(e) {
  const items = [...(e.clipboardData?.items || [])];
  const imageItem = items.find(i => i.type.startsWith('image/'));
  if (!imageItem) return;
  e.preventDefault();
  const file = imageItem.getAsFile();
  try {
    const { url, name } = await uploadWithProgress(file);
    addPendingAttachment(url, name || file.name, 'image');
  } catch (err) {
    showUploadError(err.message || 'Upload failed');
  }
}

function addPendingAttachment(url, name, type) {
  pendingAttachments.push({ url, name, type });
  renderAttachPreview();
}

function removePendingAttachment(idx) {
  pendingAttachments.splice(idx, 1);
  renderAttachPreview();
}

function clearAttachments() {
  pendingAttachments = [];
  renderAttachPreview();
}

function renderAttachPreview() {
  const el = document.getElementById('attach-preview');
  if (!pendingAttachments.length) { el.classList.remove('visible'); el.innerHTML = ''; return; }
  el.classList.add('visible');
  el.innerHTML = pendingAttachments.map((a, i) => {
    if (a.type === 'image') {
      return `<div class="attach-thumb"><img src="${a.url}" alt="${escHtml(a.name)}"><button class="attach-thumb-x" data-idx="${i}">&times;</button></div>`;
    }
    const ext = (a.name || '').split('.').pop()?.toUpperCase() || 'FILE';
    return `<div class="attach-thumb-file"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>${escHtml(a.name)}</span><button class="attach-thumb-x" data-idx="${i}">&times;</button></div>`;
  }).join('');
  el.querySelectorAll('.attach-thumb-x').forEach(btn => {
    btn.onclick = () => removePendingAttachment(parseInt(btn.dataset.idx));
  });
}

