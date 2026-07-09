async function sLoadGeneralTab() {
  sRenderReadingControls();
  try {
    const user = await fjson('/api/auth/me');
    document.getElementById('s-auth-email-input').value = user.email || '';
  } catch {}
  // Notification toggle
  const toggle = document.getElementById('s-notif-toggle');
  const hint = document.getElementById('s-notif-hint');
  toggle.className = 's-notif-toggle' + (notifEnabled ? ' on' : '');
  if (!('Notification' in window)) {
    hint.textContent = 'Your browser does not support notifications.';
  } else if (Notification.permission === 'denied') {
    hint.textContent = 'Notifications blocked by browser. Allow in browser settings.';
  } else {
    hint.textContent = notifEnabled ? 'You will be notified when agents respond in other rooms.' : 'Notifications are off.';
  }
}

async function sLoadServerTab() {
  let data;
  try { data = await fjson('/api/settings'); }
  catch { showToast('Failed to load server settings', { error: true }); return; }
  const port = data.port || 3000;
  document.getElementById('s-human-name-input').value = data.human_name || '';
  const storedUrl = data.public_url || '';
  try { const u = new URL(storedUrl); document.getElementById('s-public-url-input').value = u.protocol + '//' + u.hostname; }
  catch { document.getElementById('s-public-url-input').value = storedUrl; }
  document.getElementById('s-public-url-input').placeholder = 'http://localhost';
  document.getElementById('s-port-input').value = port;
  document.getElementById('s-max-ai-turns-input').value = data.max_ai_turns || 15;
  document.getElementById('s-max-concurrent-input').value = data.max_concurrent || 1;
  document.getElementById('s-session-idle-ttl-input').value = data.session_idle_ttl || 5;
  document.getElementById('s-compact-threshold-input').value = data.auto_compact_threshold_kb || 500;
  document.getElementById('s-cleanup-hour-input').value = data.cleanup_cron_hour ?? 10;
  document.getElementById("s-cleanup-age-input").value = data.cleanup_max_age_hours || 24;
  document.getElementById("s-max-pinned-input").value = data.max_pinned_rooms || 3;
  sPublicUrl = data.public_url || '';
  sPort = port;
  // Populate avatar preview from current humanActor
  const human = humanActor || allActors.find(a => a.type === 'human');
  sUpdateAvatarPreview(human?.avatar_url || null);
}

async function sSaveSetting(key, value, savedId) {
  const body = {};
  body[key] = value;
  try { const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) { showToast('Failed to save setting', { error: true }); return; } } catch { showToast('Failed to save setting', { error: true }); return; }
  const el = document.getElementById(savedId);
  if (el) { el.classList.add('visible'); setTimeout(() => el.classList.remove('visible'), 2000); }
  if (key === 'human_name') {
    const actor = allActors.find(a => a.type === 'human');
    if (actor) { actor.name = value; renderSidebarFooter(); }
  }
}

// ── Avatar upload helpers ───────────────────────────────────────────────────
function sUpdateAvatarPreview(avatarUrl) {
  const preview = document.getElementById('s-avatar-preview');
  const removeBtn = document.getElementById('s-avatar-remove');
  if (!preview) return;
  preview.innerHTML = '';
  if (avatarUrl) {
    const img = document.createElement('img');
    img.src = avatarUrl;
    preview.appendChild(img);
    if (removeBtn) removeBtn.classList.add('visible');
  } else {
    const human = humanActor || allActors.find(a => a.type === 'human');
    if (human) preview.appendChild(makeAvatar(human.name, human.avatar_color, null, 52));
    if (removeBtn) removeBtn.classList.remove('visible');
  }
}

async function sResizeAndUploadAvatar(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > 2 * 1024 * 1024) { alert('Image must be under 2 MB.'); return; }
  const human = humanActor || allActors.find(a => a.type === 'human');
  if (!human) return;

  const reader = new FileReader();
  reader.onload = e => {
    const origDataUrl = e.target.result;
    const img = new Image();
    img.onload = async () => {
      const maxSize = 256;
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else       { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL(file.type === 'image/gif' ? 'image/png' : file.type);
      try {
        const res = await fetch(`/api/actors/${human.id}/avatar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data_url: dataUrl }),
        });
        if (!res.ok) throw new Error('avatar upload failed');
        const data = await res.json();
        if (data.avatar_url) {
          human.avatar_url = data.avatar_url;
          sUpdateAvatarPreview(data.avatar_url);
          renderSidebarFooter();
          renderComposerSeal();
        }
      } catch (err) { console.error('avatar upload failed', err); showToast('Failed to upload avatar', { error: true }); }
    };
    img.onerror = () => { console.error('Failed to load image for avatar'); showToast('Invalid image file', { error: true }); };
    img.src = origDataUrl;
  };
  reader.onerror = () => console.error('Failed to read file for avatar');
  reader.readAsDataURL(file);
}

async function sRemoveAvatar() {
  const human = humanActor || allActors.find(a => a.type === 'human');
  if (!human) return;
  try {
    const delRes = await fetch(`/api/actors/${human.id}/avatar`, { method: 'DELETE' });
    if (!delRes.ok) throw new Error('avatar delete failed');
    human.avatar_url = null;
    sUpdateAvatarPreview(null);
    renderSidebarFooter();
    renderComposerSeal();
  } catch (err) { console.error('avatar remove failed', err); showToast('Failed to remove avatar', { error: true }); }
}

async function sResizeAndUploadActorAvatar(actorId, file, avEl) {
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > 2 * 1024 * 1024) { alert('Image must be under 2 MB.'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = async () => {
      const maxSize = 256;
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else       { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL(file.type === 'image/gif' ? 'image/png' : file.type);
      try {
        const res = await fetch(`/api/actors/${actorId}/avatar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data_url: dataUrl }),
        });
        if (!res.ok) throw new Error('avatar upload failed');
        const data = await res.json();
        if (data.avatar_url) {
          const actor = allActors.find(a => a.id === actorId);
          if (actor) actor.avatar_url = data.avatar_url;
          // Replace avatar element in row
          const imgEl = document.createElement('img');
          imgEl.src = data.avatar_url;
          imgEl.style.cssText = 'width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;display:block;';
          const existing = avEl.querySelector('img, .h-seal');
          if (existing) avEl.replaceChild(imgEl, existing);
          else avEl.prepend(imgEl);
        }
      } catch (err) { console.error('actor avatar upload failed', err); showToast('Failed to upload avatar', { error: true }); }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

let globalWs = null;
