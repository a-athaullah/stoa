// ── Chat header ────────────────────────────────────────────────────────────
function renderChatHeader(room, participants) {
  const header = document.getElementById('chat-header');
  header.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.id = 'mobile-back';
  backBtn.setAttribute('aria-label', 'back to rooms');
  backBtn.innerHTML = '&#8592;';
  backBtn.onclick = () => document.body.classList.remove('in-chat');
  header.appendChild(backBtn);

  if (document.body.classList.contains('sidebar-collapsed')) {
    const roomsToggle = document.createElement('button');
    roomsToggle.className = 'h-rooms-toggle';
    roomsToggle.title = 'Show room list';
    roomsToggle.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/></svg>`;
    roomsToggle.onclick = () => toggleSidebar();
    header.appendChild(roomsToggle);
  }

  const info = document.createElement('div');
  info.className = 'h-header-info';

  const name = document.createElement('div');
  name.className = 'h-room-name';
  name.textContent = room.title;
  name.title = 'Click to rename';
  name.onclick = () => {
    name.contentEditable = 'true';
    name.classList.add('editing');
    name.focus();
    const range = document.createRange();
    range.selectNodeContents(name);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  async function commitRename() {
    name.contentEditable = 'false';
    name.classList.remove('editing');
    const newTitle = name.textContent.trim();
    if (newTitle && newTitle !== room.title) {
      const oldTitle = room.title;
      room.title = newTitle;
      try {
        const r = await fetch(`/api/rooms/${room.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        });
        if (!r.ok) throw new Error('rename failed');
      } catch { showToast('Failed to rename room', { error: true }); room.title = oldTitle; name.textContent = oldTitle; }
    } else {
      name.textContent = room.title;
    }
  }
  name.addEventListener('blur', commitRename);
  name.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
    if (e.key === 'Escape') { name.textContent = room.title; name.blur(); }
  });
  info.appendChild(name);

  const tagline = document.createElement('span');
  tagline.className = 'h-room-tagline';
  const modelShort = (room.model || '').replace(/^claude-/, '') || '';
  const agentCount = participants.filter(p => p.type === 'ai').length;

  if (modelShort) {
    const pill = document.createElement('span');
    pill.className = 'h-model-pill';
    pill.textContent = modelShort;
    tagline.appendChild(pill);
    tagline.appendChild(document.createTextNode(' · '));
  }

  const saCount = (roomSubAgentsCache[room.id] || []).length;
  const countParts = [`${agentCount} agent${agentCount !== 1 ? 's' : ''}`];
  if (saCount) countParts.push(`${saCount} sub-agent${saCount !== 1 ? 's' : ''}`);
  tagline.appendChild(document.createTextNode(countParts.join(' · ')));
  info.appendChild(tagline);

  header.appendChild(info);

  // Sub-agent run controls
  if (room.id) {
    const runCtl = document.createElement('div');
    runCtl.className = 'h-run-ctl';
    runCtl.style.cssText = 'display:inline-flex;align-items:center;position:relative';
    header.appendChild(runCtl);
    startRunControls(runCtl, room);
  }
}

// ── Sub-agent run controls ───────────────────────────────────────────────────
function elapsedSince(createdAt) {
  if (!createdAt) return '';
  const then = new Date(createdAt.replace(' ', 'T') + 'Z').getTime();
  let s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); s = s % 60;
  return `${m}m ${s}s`;
}

function startRunControls(container, room) {
  if (window.__runCtlTimer) { clearInterval(window.__runCtlTimer); window.__runCtlTimer = null; }
  let paused = !!room.spawns_paused;
  let popoverOpen = false;

  async function refresh() {
    if (!container.isConnected) { clearInterval(window.__runCtlTimer); window.__runCtlTimer = null; return; }
    let runs = [];
    try { runs = await fjson(`/api/rooms/${room.id}/sub-agent-runs`) || []; } catch { return; }
    render(runs);
  }

  function render(runs) {
    container.innerHTML = '';
    if (runs.length) {
      const pill = document.createElement('button');
      pill.className = 'h-run-pill';
      pill.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:8px;padding:5px 12px 5px 10px;border-radius:999px;cursor:pointer;background:var(--h-surface);border:1px solid var(--h-border);color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12.5px';
      pill.innerHTML = `<span style="display:inline-flex;gap:3px"><span class="h-dot" style="background:#7fb98c"></span><span class="h-dot" style="background:#7fb98c"></span></span>${runs.length} running`;
      pill.onclick = (e) => { e.stopPropagation(); popoverOpen = !popoverOpen; render(runs); };
      container.appendChild(pill);
    } else {
      popoverOpen = false;
    }
    if (paused) {
      const pp = document.createElement('span');
      pp.style.cssText = 'display:inline-flex;align-items:center;gap:7px;margin-left:8px;padding:5px 12px;border-radius:999px;background:color-mix(in srgb,var(--h-ink) 6%,transparent);border:1px dashed var(--h-border);color:var(--h-ink-faint);font-family:var(--h-sans);font-size:12.5px';
      pp.innerHTML = `<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><rect x="2.5" y="2" width="2.6" height="8" rx=".8"/><rect x="6.9" y="2" width="2.6" height="8" rx=".8"/></svg>spawns paused`;
      pp.title = 'New sub-agent spawns are blocked — running ones finish normally';
      container.appendChild(pp);
    }
    if (popoverOpen && runs.length) container.appendChild(buildRunsPopover(runs));
  }

  function buildRunsPopover(runs) {
    const pop = document.createElement('div');
    pop.style.cssText = 'position:absolute;top:calc(100% + 4px);right:0;width:316px;background:var(--h-surface);border:1px solid var(--h-border);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.20);padding:5px;z-index:120;font-family:var(--h-sans)';
    pop.addEventListener('click', e => e.stopPropagation());

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:7px 10px 6px';
    head.innerHTML = `<span style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--h-ink-faint)">running now</span><span style="font-size:11.5px;color:var(--h-ink-faint);font-style:italic">${runs.length} of ${room.max_sub_agents || 3}</span>`;
    pop.appendChild(head);

    for (const r of runs) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:9px';
      const color = r.avatar_color || '#888';
      const mini = document.createElement('span');
      mini.style.cssText = `width:26px;height:26px;border-radius:50%;flex:0 0 auto;font-size:11px;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,${color} 20%,var(--h-surface));color:${color};border:1px solid color-mix(in srgb,${color} 30%,transparent);font-weight:600`;
      mini.textContent = (r.sub_agent_label || '?').charAt(0).toUpperCase();
      const mid = document.createElement('div');
      mid.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px';
      const midLabel = document.createElement('span');
      midLabel.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:var(--h-ink)';
      midLabel.textContent = r.sub_agent_label || '';
      const midSub = document.createElement('span');
      midSub.style.cssText = 'font-size:11.5px;color:var(--h-ink-faint);font-style:italic';
      midSub.textContent = `${r.parent_name || ''}'s · running ${elapsedSince(r.created_at)}`;
      mid.append(midLabel, midSub);
      const tier = document.createElement('span');
      tier.style.cssText = 'font-size:11px;color:var(--h-ink-faint)';
      tier.textContent = r.tier || '';
      const stop = document.createElement('button');
      stop.textContent = 'stop';
      stop.style.cssText = 'background:transparent;color:#b35a4b;border:1px solid color-mix(in srgb,#b35a4b 34%,var(--h-border));padding:4px 12px;border-radius:999px;cursor:pointer;font-family:var(--h-sans);font-size:12px;flex:0 0 auto';
      stop.onclick = async () => {
        stop.disabled = true;
        try { await fetch(`/api/rooms/${room.id}/sub-agent-runs/${r.message_id}/stop`, { method: 'POST' }); }
        catch { showToast('Failed to stop', { error: true }); stop.disabled = false; return; }
        refresh();
      };
      row.append(mini, mid, tier, stop);
      pop.appendChild(row);
    }

    const foot = document.createElement('div');
    foot.style.cssText = 'padding:8px 10px 6px;margin-top:2px;border-top:1px solid var(--h-border);display:flex;align-items:center;gap:8px';
    const note = document.createElement('span');
    note.style.cssText = 'font-size:11.5px;color:var(--h-ink-faint);flex:1';
    note.textContent = paused ? 'spawns paused — running ones finish.' : 'pausing blocks new spawns — these finish.';
    const toggle = document.createElement('button');
    toggle.textContent = paused ? 'resume' : 'pause';
    toggle.style.cssText = 'background:transparent;color:var(--h-ink-mute);border:1px solid var(--h-border);padding:4px 12px;border-radius:999px;cursor:pointer;font-family:var(--h-sans);font-size:12px';
    toggle.onclick = async () => {
      toggle.disabled = true;
      try {
        const res = await fetch(`/api/rooms/${room.id}/spawns-pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: !paused }) });
        const j = await res.json().catch(() => ({}));
        if (res.ok) { paused = !!j.paused; room.spawns_paused = paused ? 1 : 0; }
        else showToast(j.error || 'Failed', { error: true });
      } catch { showToast('Failed', { error: true }); }
      toggle.disabled = false;
      refresh();
    };
    foot.append(note, toggle);
    pop.appendChild(foot);
    return pop;
  }

  document.addEventListener('click', function outside(e) {
    if (!container.isConnected) { document.removeEventListener('click', outside); return; }
    if (popoverOpen && !container.contains(e.target)) { popoverOpen = false; refresh(); }
  });

  refresh();
  window.__runCtlTimer = setInterval(() => {
    if (document.hidden) return;
    if (popoverOpen) return;
    refresh();
  }, 3000);
}
