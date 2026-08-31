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

  const tagline = document.createElement('div');
  tagline.className = 'h-room-tagline';
  info.appendChild(tagline);

  header.appendChild(info);

  const sealsWrap = document.createElement('div');
  sealsWrap.className = 'h-header-seals';
  for (const p of participants) {
    const wrap = document.createElement('div');
    wrap.className = 'h-header-seal';
    wrap.appendChild(makeAvatar(p.name, p.avatar_color, p.avatar_url, 26));
    if (p.type === 'ai') {
      wrap.style.cursor = 'pointer';
      wrap.title = `${p.name} — click to manage sub-agents`;
      wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        openSubAgentDropdown(wrap, room.id, p);
      });
    }
    sealsWrap.appendChild(wrap);
  }

  // Sub-agent seals (fetched async, rendered after parent seals)
  if (room.id) {
    fjson(`/api/rooms/${room.id}/sub-agents`).then(data => {
      if (!data?.linked?.length) return;
      for (const sa of data.linked) {
        const saWrap = document.createElement('div');
        saWrap.className = 'h-header-seal h-header-seal-sub';
        saWrap.title = `${sa.parent_name}/${sa.label} (${sa.tier})`;
        const parentActor = participants.find(p => p.actor_id === sa.parent_actor_id);
        const color = parentActor?.avatar_color || '#888';
        const mini = document.createElement('span');
        mini.style.cssText = `width:18px;height:18px;border-radius:50%;font-size:9px;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,${color} 20%,var(--h-surface));color:${color};border:1px solid color-mix(in srgb,${color} 30%,transparent);font-family:var(--h-sans);font-weight:600;letter-spacing:-.02em`;
        mini.textContent = sa.label.charAt(0).toUpperCase();
        saWrap.appendChild(mini);
        sealsWrap.insertBefore(saWrap, sealsWrap.querySelector('.h-add-participant'));
      }
    }).catch(() => {});
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'h-add-participant';
  addBtn.textContent = '+';
  addBtn.title = 'Add agent';

  addBtn.onclick = (e) => {
    e.stopPropagation();
    openAddAgentModal(currentRoomId, participants);
  };

  sealsWrap.appendChild(addBtn);
  header.appendChild(sealsWrap);

  // Sub-agent run controls (running pill + paused pill + popover) — Phase 2b
  if (room.id) {
    const runCtl = document.createElement('div');
    runCtl.className = 'h-run-ctl';
    runCtl.style.cssText = 'display:inline-flex;align-items:center;position:relative';
    header.appendChild(runCtl);
    startRunControls(runCtl, room);
  }

  // Search button
  const searchBtn = document.createElement('button');
  searchBtn.className = 'h-header-action-btn';
  searchBtn.title = 'Search in room';
  searchBtn.style.marginLeft = '8px';
  searchBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  searchBtn.onclick = () => toggleRoomSearch();
  header.appendChild(searchBtn);

  // Export button
  const exportWrap = document.createElement('div');
  exportWrap.style.cssText = 'position:relative;display:inline-flex;margin-left:8px';
  const exportBtn = document.createElement('button');
  exportBtn.className = 'h-header-action-btn';
  exportBtn.title = 'Export conversation';
  exportBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v9M5 8l3 3 3-3"/><path d="M3 13h10"/></svg>`;
  const exportDrop = document.createElement('div');
  exportDrop.className = 'h-export-dropdown';
  exportDrop.innerHTML = `
    <button class="h-export-opt" data-fmt="json">JSON</button>
    <button class="h-export-opt" data-fmt="csv">CSV</button>`;
  exportBtn.onclick = (e) => {
    e.stopPropagation();
    exportDrop.classList.toggle('open');
    setTimeout(() => document.addEventListener('click', () => exportDrop.classList.remove('open'), { once: true }), 0);
  };
  exportDrop.querySelectorAll('.h-export-opt').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      exportDrop.classList.remove('open');
      const fmt = btn.dataset.fmt;
      const a = document.createElement('a');
      a.href = `/api/rooms/${room.id}/export?format=${fmt}`;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
  });
  exportWrap.appendChild(exportBtn);
  exportWrap.appendChild(exportDrop);
  header.appendChild(exportWrap);

  const hasClaudeAgent = participants.some(p => p.type === 'ai' && p.adapter === 'claude');
  if (hasClaudeAgent) {
    const compactBtn = document.createElement('button');
    compactBtn.className = 'h-header-action-btn h-compact-btn';
    compactBtn.title = 'Compact sessions';
    compactBtn.style.marginLeft = '8px';
    compactBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l5-4 5 4"/><path d="M3 10l5 4 5-4"/></svg>`;
    compactBtn.onclick = () => {
      if (compactBtn.disabled) return;
      compactSessions(room.id);
    };
    header.appendChild(compactBtn);
  }

  const wsToggle = document.createElement('button');
  wsToggle.className = 'h-ws-toggle' + (document.getElementById('workspace-panel').classList.contains('open') ? ' active' : '');
  wsToggle.title = 'Dev Workspace';
  wsToggle.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M14 4v16"/></svg>`;
  wsToggle.onclick = toggleWorkspacePanel;
  header.appendChild(wsToggle);
}

function openSubAgentDropdown(anchorEl, roomId, participant) {
  document.querySelectorAll('.h-sa-dropdown').forEach(d => d.remove());
  const drop = document.createElement('div');
  drop.className = 'h-sa-dropdown';
  drop.style.cssText = 'position:absolute;top:100%;right:0;min-width:200px;background:var(--h-surface);border:1px solid var(--h-border);border-radius:8px;padding:8px 0;box-shadow:0 4px 16px rgba(0,0,0,.15);z-index:100;font-family:var(--h-sans);font-size:13px';

  const title = document.createElement('div');
  title.style.cssText = 'padding:4px 12px 8px;font-family:var(--h-serif);font-style:italic;font-size:12px;color:var(--h-ink-mute);border-bottom:1px solid var(--h-border);margin-bottom:4px';
  title.textContent = `${participant.name}'s sub-agents`;
  drop.appendChild(title);

  const list = document.createElement('div');
  list.style.cssText = 'max-height:200px;overflow-y:auto';
  drop.appendChild(list);

  async function loadItems() {
    try {
      const data = await fjson(`/api/rooms/${roomId}/sub-agents`);
      const actorSubs = [...data.linked.filter(s => s.parent_actor_id === participant.actor_id), ...data.available.filter(s => s.parent_actor_id === participant.actor_id)];
      const linkedIds = new Set(data.linked.map(s => s.id));
      list.innerHTML = '';
      if (!actorSubs.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:8px 12px;color:var(--h-ink-faint);font-style:italic;font-size:12px';
        empty.textContent = 'no sub-agents defined';
        list.appendChild(empty);
        return;
      }
      for (const sa of actorSubs) {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 12px;cursor:pointer';
        row.addEventListener('mouseenter', () => row.style.background = 'var(--h-hover)');
        row.addEventListener('mouseleave', () => row.style.background = 'transparent');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = linkedIds.has(sa.id);
        cb.addEventListener('change', async () => {
          cb.disabled = true;
          try {
            if (cb.checked) {
              const r = await fetch(`/api/rooms/${roomId}/sub-agents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub_agent_id: sa.id }) });
              if (!r.ok) { const e = await r.json().catch(() => ({})); showToast(e.error || 'Failed', { error: true }); cb.checked = false; }
            } else {
              await fetch(`/api/rooms/${roomId}/sub-agents/${sa.id}`, { method: 'DELETE' });
            }
          } catch { cb.checked = !cb.checked; showToast('Failed', { error: true }); }
          cb.disabled = false;
        });
        const lbl = document.createElement('span');
        lbl.style.color = 'var(--h-ink)';
        lbl.textContent = sa.label;
        const tier = document.createElement('span');
        tier.style.cssText = 'font-size:11px;color:var(--h-ink-faint);margin-left:auto';
        tier.textContent = sa.tier;
        row.append(cb, lbl, tier);
        list.appendChild(row);
      }
    } catch { list.innerHTML = '<div style="padding:8px 12px;color:var(--h-ink-faint)">failed to load</div>'; }
  }
  loadItems();

  anchorEl.style.position = 'relative';
  anchorEl.appendChild(drop);
  setTimeout(() => document.addEventListener('click', function close(e) {
    if (!drop.contains(e.target)) { drop.remove(); document.removeEventListener('click', close); }
  }), 0);
}

// ── Sub-agent run controls (Phase 2b) ───────────────────────────────────────
// Live "N running" pill + "spawns paused" pill in the header; the pill opens a
// popover listing each active run (elapsed time, tier) with a Stop action and a
// pause toggle. Polls the runs endpoint while the header is mounted.
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
    // Bail if this header was replaced (container detached)
    if (!container.isConnected) { clearInterval(window.__runCtlTimer); window.__runCtlTimer = null; return; }
    let runs = [];
    try { runs = await fjson(`/api/rooms/${room.id}/sub-agent-runs`) || []; } catch { return; }
    render(runs);
  }

  function render(runs) {
    container.innerHTML = '';
    // Running pill
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
    // Paused pill
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

  // Close popover on outside click
  document.addEventListener('click', function outside(e) {
    if (!container.isConnected) { document.removeEventListener('click', outside); return; }
    if (popoverOpen && !container.contains(e.target)) { popoverOpen = false; refresh(); }
  });

  refresh();
  window.__runCtlTimer = setInterval(() => {
    if (document.hidden) return;   // don't poll a backgrounded tab (idle waste)
    if (popoverOpen) return;       // don't wipe/rebuild an open popover (loses hover + in-flight stop state)
    refresh();
  }, 3000);
}

