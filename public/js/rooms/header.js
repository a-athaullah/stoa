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
    wrap.style.position = 'relative';
    wrap.appendChild(makeAvatar(p.name, p.avatar_color, p.avatar_url, 26));
    if (p.type === 'ai') {
      wrap.style.cursor = 'pointer';
      wrap.title = `${p.name} — click to manage sub-agents`;
      wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        openSubAgentDropdown(wrap, room.id, p);
      });
      if (p.session_status === 'indeterminate') {
        const dot = document.createElement('span');
        dot.style.cssText = 'position:absolute;bottom:0;right:0;width:8px;height:8px;border-radius:50%;background:#d97706;border:2px solid var(--h-surface);pointer-events:none';
        dot.title = `${p.name}: session was running when server restarted — check manually`;
        wrap.appendChild(dot);
      }
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

  // Room settings (sub-agent model tiers + spawn budget) — Phase 3
  if (room.id) {
    const setBtn = document.createElement('button');
    setBtn.className = 'h-header-action-btn';
    setBtn.title = 'Room settings';
    setBtn.style.marginLeft = '8px';
    setBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    setBtn.onclick = () => openRoomSettings(room);
    header.appendChild(setBtn);
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

  drop.addEventListener('click', e => e.stopPropagation());
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

// ── Room settings panel (Phase 3) ───────────────────────────────────────────
// Modal for per-room sub-agent config: model tier fallback chains + spawn budget.
// Model tiers mirror the server's SERVER_DEFAULT_TIERS; leaving them unset means
// "use server defaults". Saving PATCHes the room (model_tiers + budget) and, if
// changed, toggles the spawn kill switch via its dedicated endpoint.
function openRoomSettings(room) {
  document.querySelectorAll('.h-room-settings-overlay').forEach(e => e.remove());
  const SA_MODELS = [
    'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1',
    'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
    'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5',
  ];
  // Must match server.js SERVER_DEFAULT_TIERS — shown when a room has no override.
  const DEFAULTS = {
    quick:    ['claude-haiku-4-5'],
    standard: ['claude-sonnet-5', 'claude-haiku-4-5'],
    deep:     ['claude-opus-5', 'claude-sonnet-5'],
  };
  const TIERS = ['quick', 'standard', 'deep'];
  const shortName = m => m.replace(/^claude-/, '').replace(/-\d.*$/, '');

  // Local edit state (seeded from a fresh GET below)
  let tiersState = null;   // null = use server defaults; object = per-room override
  let paused = false, pausedOrig = false;
  let maxConcurrent = 3, maxPerHour = 10;
  let schedules = [];      // loaded from /api/rooms/:id/sub-agent-schedules
  let scheduleDiagnoses = {}; // schedule_id → { status, details } from /doctor
  let linkedSubs = [];     // sub-agents linked to this room (for schedule form dropdown)
  let schedFormOpen = false, schedEditId = null;

  const overlay = document.createElement('div');
  overlay.className = 'h-room-settings-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:200;display:flex;align-items:center;justify-content:center;font-family:var(--h-sans)';
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const panel = document.createElement('div');
  panel.style.cssText = 'width:470px;max-width:92vw;max-height:86vh;overflow-y:auto;background:var(--h-surface);border:1px solid var(--h-border);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:20px 22px';
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);

  panel.innerHTML = '<div style="font-size:12.5px;color:var(--h-ink-faint)">loading…</div>';

  Promise.all([
    fjson(`/api/rooms/${room.id}`),
    fjson(`/api/rooms/${room.id}/sub-agent-schedules`),
    fjson(`/api/rooms/${room.id}/sub-agents`),
    fjson(`/api/rooms/${room.id}/sub-agent-schedules/doctor`).catch(() => ({ diagnoses: [] })),
  ]).then(([r, sc, sa, doc]) => {
    maxConcurrent = Math.max(1, Math.min(10, r.max_sub_agents || 3));
    maxPerHour = Math.max(1, Math.min(100, r.max_spawns_per_hour || 10));
    paused = pausedOrig = !!r.spawns_paused;
    try { tiersState = r.model_tiers ? JSON.parse(r.model_tiers) : null; } catch { tiersState = null; }
    schedules = sc.schedules || [];
    scheduleDiagnoses = Object.fromEntries((doc.diagnoses || []).map(d => [d.schedule_id, d]));
    linkedSubs = sa.linked || [];
    renderBody();
  }).catch(() => { panel.innerHTML = '<div style="font-size:12.5px;color:#b35a4b">failed to load room settings</div>'; });

  function makeCard(title, subtitle) {
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid var(--h-border);border-radius:12px;padding:14px 16px;margin-bottom:14px';
    const t = document.createElement('div');
    t.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:15px;color:var(--h-ink)';
    t.textContent = title;
    card.appendChild(t);
    if (subtitle) {
      const s = document.createElement('div');
      s.style.cssText = 'font-size:12px;color:var(--h-ink-faint);margin-top:3px;margin-bottom:10px';
      s.textContent = subtitle;
      card.appendChild(s);
    }
    return card;
  }

  function makeStepper(value, min, max, onChange) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:2px;border:1px solid var(--h-border);border-radius:999px;overflow:hidden';
    const mk = (txt, delta) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.style.cssText = 'width:28px;height:28px;background:transparent;border:none;color:var(--h-ink-mute);cursor:pointer;font-size:15px;line-height:1';
      b.onclick = () => { const nv = Math.max(min, Math.min(max, value + delta)); if (nv !== value) { value = nv; val.textContent = value; onChange(value); } };
      return b;
    };
    const val = document.createElement('span');
    val.style.cssText = 'min-width:28px;text-align:center;font-size:13.5px;color:var(--h-ink);font-variant-numeric:tabular-nums';
    val.textContent = value;
    wrap.append(mk('−', -1), val, mk('+', +1));
    return wrap;
  }

  // A tier's fallback chain: ordered monospace pills (primary first), ↑ to promote,
  // × to remove, and a "+ fallback" dropdown to append an unused model.
  function makeChainEditor(tier) {
    const chain = tiersState[tier] || (tiersState[tier] = DEFAULTS[tier].slice());
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:6px';
    chain.forEach((m, i) => {
      if (i > 0) {
        const arrow = document.createElement('span');
        arrow.style.cssText = 'color:var(--h-ink-faint);font-size:12px'; arrow.textContent = '→';
        row.appendChild(arrow);
      }
      const pill = document.createElement('span');
      pill.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:3px 4px 3px 9px;border-radius:999px;background:var(--h-surface);border:1px solid var(--h-border);font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--h-ink)';
      const nm = document.createElement('span'); nm.textContent = shortName(m); nm.title = m;
      pill.appendChild(nm);
      if (i > 0) {
        const up = document.createElement('button');
        up.textContent = '↑'; up.title = 'promote';
        up.style.cssText = 'background:transparent;border:none;color:var(--h-ink-faint);cursor:pointer;font-size:12px;padding:0 2px';
        up.onclick = () => { chain.splice(i - 1, 0, chain.splice(i, 1)[0]); renderBody(); };
        pill.appendChild(up);
      }
      const x = document.createElement('button');
      x.textContent = '×'; x.title = 'remove';
      x.style.cssText = 'background:transparent;border:none;color:var(--h-ink-faint);cursor:pointer;font-size:14px;padding:0 3px 0 1px';
      x.onclick = () => { chain.splice(i, 1); if (!chain.length) delete tiersState[tier]; renderBody(); };
      pill.appendChild(x);
      row.appendChild(pill);
    });
    const unused = SA_MODELS.filter(m => !chain.includes(m));
    if (unused.length) {
      const add = document.createElement('select');
      add.style.cssText = 'border:1px dashed var(--h-border);border-radius:999px;background:transparent;color:var(--h-ink-mute);font-size:12px;padding:3px 6px;cursor:pointer;font-family:var(--h-sans)';
      const ph = document.createElement('option'); ph.value = ''; ph.textContent = '+ fallback'; add.appendChild(ph);
      for (const m of unused) { const o = document.createElement('option'); o.value = m; o.textContent = shortName(m); add.appendChild(o); }
      add.onchange = () => { if (add.value) { (tiersState[tier] = tiersState[tier] || []).push(add.value); renderBody(); } };
      row.appendChild(add);
    }
    return row;
  }

  function fmtCadence(spec) {
    if (!spec) return '?';
    if (spec.type === 'daily') {
      const tz = spec.tz || 'UTC';
      const short = tz === 'Asia/Jakarta' ? 'WIB' : tz.split('/').pop();
      return `daily at ${spec.at} ${short}`;
    }
    const m = spec.every_minutes;
    return m >= 120 && m % 60 === 0 ? `every ${m / 60} h` : `every ${m} min`;
  }

  function fmtNextRun(iso) {
    if (!iso) return 'paused';
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) + ' ' +
           d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function renderScheduleCard() {
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid var(--h-border);border-radius:12px;overflow:hidden;margin-bottom:14px';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--h-border);background:color-mix(in srgb, var(--h-bg) 38%, var(--h-surface))';
    const hleft = document.createElement('div');
    const htitle = document.createElement('span');
    htitle.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:15px;color:var(--h-ink)';
    htitle.textContent = 'Scheduled triggers';
    const hsub = document.createElement('span');
    hsub.style.cssText = 'font-size:12px;color:var(--h-ink-faint);margin-left:10px';
    const enabledCount = schedules.filter(s => s.enabled).length;
    hsub.textContent = enabledCount ? `${enabledCount} active` : 'sub-agents that fire on a timer';
    const issueCount = Object.values(scheduleDiagnoses).filter(d => d.status !== 'ok').length;
    if (issueCount) {
      const warn = document.createElement('span');
      warn.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:999px;background:#b35a4b;color:#fff;font-weight:600;margin-left:8px';
      warn.textContent = `${issueCount} issue${issueCount > 1 ? 's' : ''}`;
      warn.title = 'Some schedules have issues — see badges below';
      hsub.after(warn);
    }
    hleft.append(htitle, hsub);

    const addBtn = document.createElement('button');
    addBtn.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:4px 12px;cursor:pointer';
    addBtn.textContent = '+ add schedule';
    addBtn.onclick = () => { schedFormOpen = true; schedEditId = null; renderBody(); };
    header.append(hleft, addBtn);
    card.appendChild(header);

    const body = document.createElement('div');

    if (schedFormOpen) {
      body.appendChild(renderScheduleForm());
    }

    if (!schedules.length && !schedFormOpen) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:24px 20px;text-align:center';
      const et = document.createElement('div');
      et.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:16px;color:var(--h-ink);margin-bottom:6px';
      et.textContent = 'no scheduled triggers yet';
      const es = document.createElement('div');
      es.style.cssText = 'font-size:13px;color:var(--h-ink-mute);line-height:1.55;max-width:380px;margin:0 auto 10px';
      es.textContent = 'a schedule hands a sub-agent the same task on a timer — every few minutes, or once a day at a set hour.';
      empty.append(et, es);
      body.appendChild(empty);
    } else {
      schedules.forEach((sched, i) => {
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:10px;padding:11px 16px;${i < schedules.length - 1 ? 'border-bottom:1px solid var(--h-border)' : ''}${!sched.enabled ? ';opacity:.55' : ''}`;

        const seal = document.createElement('span');
        seal.style.cssText = 'width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink);background:var(--h-surface);border:1px solid var(--h-border);flex:0 0 auto';
        seal.textContent = (sched.sub_agent_label || '?')[0];
        row.appendChild(seal);

        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px';
        const top = document.createElement('div');
        top.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--h-ink)';
        lbl.textContent = sched.sub_agent_label || '?';
        const cadence = document.createElement('span');
        cadence.style.cssText = 'font-size:11px;color:var(--h-ink-mute);padding:2px 8px;border-radius:999px;border:1px solid var(--h-border);background:var(--h-surface)';
        cadence.textContent = fmtCadence(sched.schedule_spec);
        const diag = scheduleDiagnoses[sched.id];
        if (diag && diag.status !== 'ok') {
          const badge = document.createElement('span');
          const badgeColor = diag.status === 'overdue' ? '#d97706' : '#b35a4b';
          badge.style.cssText = `font-size:10px;padding:2px 7px;border-radius:999px;background:${badgeColor};color:#fff;font-weight:600;letter-spacing:.02em`;
          badge.textContent = diag.status;
          badge.title = diag.details || diag.status;
          top.append(badge);
        }
        top.append(lbl, cadence);
        const task = document.createElement('div');
        task.style.cssText = 'font-size:12px;color:var(--h-ink-faint);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        task.textContent = sched.task;
        info.append(top, task);
        row.appendChild(info);

        const next = document.createElement('span');
        next.style.cssText = 'flex:0 0 auto;font-size:11px;color:var(--h-ink-faint);min-width:80px;text-align:right';
        next.textContent = sched.enabled ? `next: ${fmtNextRun(sched.next_run_at)}` : 'disabled';
        row.appendChild(next);

        const tog = document.createElement('button');
        tog.style.cssText = `flex:0 0 auto;background:transparent;border:1px solid var(--h-border);border-radius:999px;padding:3px 10px;cursor:pointer;font-family:var(--h-sans);font-size:11px;color:${sched.enabled ? 'var(--h-ink-mute)' : '#b35a4b'}`;
        tog.textContent = sched.enabled ? 'on' : 'off';
        tog.onclick = async () => {
          try {
            await fetch(`/api/rooms/${room.id}/sub-agent-schedules/${sched.id}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: !sched.enabled }),
            });
            reloadSchedules();
          } catch { showToast('Failed to toggle schedule', { error: true }); }
        };
        row.appendChild(tog);

        const editBtn = document.createElement('button');
        editBtn.style.cssText = 'flex:0 0 auto;background:transparent;border:none;color:var(--h-ink-faint);cursor:pointer;font-size:14px;padding:2px';
        editBtn.textContent = '✎';
        editBtn.title = 'edit';
        editBtn.onclick = () => { schedFormOpen = true; schedEditId = sched.id; renderBody(); };
        row.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.style.cssText = 'flex:0 0 auto;background:transparent;border:none;color:var(--h-ink-faint);cursor:pointer;font-size:14px;padding:2px';
        delBtn.textContent = '×';
        delBtn.title = 'delete';
        delBtn.onclick = async () => {
          if (!confirm(`Delete schedule for "${sched.sub_agent_label}"?`)) return;
          try {
            await fetch(`/api/rooms/${room.id}/sub-agent-schedules/${sched.id}`, { method: 'DELETE' });
            reloadSchedules();
          } catch { showToast('Failed to delete schedule', { error: true }); }
        };
        row.appendChild(delBtn);

        body.appendChild(row);
      });
    }

    card.appendChild(body);
    return card;
  }

  async function reloadSchedules() {
    try {
      const [sc, doc] = await Promise.all([
        fjson(`/api/rooms/${room.id}/sub-agent-schedules`),
        fjson(`/api/rooms/${room.id}/sub-agent-schedules/doctor`).catch(() => ({ diagnoses: [] })),
      ]);
      schedules = sc.schedules || [];
      scheduleDiagnoses = Object.fromEntries((doc.diagnoses || []).map(d => [d.schedule_id, d]));
    } catch {}
    renderBody();
  }

  function renderScheduleForm() {
    const editing = schedEditId ? schedules.find(s => s.id === schedEditId) : null;
    let formType = editing?.schedule_spec?.type || 'interval';
    let formEvery = editing?.schedule_spec?.every_minutes || 30;
    let formAt = editing?.schedule_spec?.at || '07:00';
    let formTz = editing?.schedule_spec?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta';
    let formSubId = editing?.sub_agent_id || (linkedSubs[0]?.id ?? '');
    let formTask = editing?.task || '';
    let formEnabled = editing ? !!editing.enabled : true;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:14px 16px 16px;border-bottom:1px solid var(--h-border);background:color-mix(in srgb, var(--h-bg) 30%, var(--h-surface))';

    const ftitle = document.createElement('div');
    ftitle.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:14px';
    const ft = document.createElement('span');
    ft.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:14px;color:var(--h-ink)';
    ft.textContent = editing ? 'edit schedule' : 'new schedule';
    const fx = document.createElement('button');
    fx.style.cssText = 'background:transparent;border:none;color:var(--h-ink-faint);cursor:pointer;font-size:16px';
    fx.textContent = '×';
    fx.onclick = () => { schedFormOpen = false; schedEditId = null; renderBody(); };
    ftitle.append(ft, fx);
    wrap.appendChild(ftitle);

    const mkField = (label, hint) => {
      const f = document.createElement('div');
      f.style.cssText = 'margin-bottom:12px';
      const l = document.createElement('div');
      l.style.cssText = 'font-size:11.5px;color:var(--h-ink-mute);text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px';
      l.textContent = label;
      f.appendChild(l);
      if (hint) { const h = document.createElement('div'); h.style.cssText = 'font-size:11px;color:var(--h-ink-faint);margin-bottom:5px'; h.textContent = hint; f.appendChild(h); }
      return f;
    };

    // Sub-agent picker
    const subField = mkField('sub-agent', 'must be linked to this room');
    const subSel = document.createElement('select');
    subSel.style.cssText = 'width:100%;padding:7px 10px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);font-family:ui-monospace,Menlo,monospace;font-size:13px';
    if (!linkedSubs.length) {
      const o = document.createElement('option'); o.textContent = 'no sub-agents linked'; o.disabled = true; subSel.appendChild(o);
    } else {
      for (const sa of linkedSubs) {
        const o = document.createElement('option');
        o.value = sa.id;
        o.textContent = `${sa.parent_name} (${sa.label})`;
        if (sa.id === formSubId) o.selected = true;
        subSel.appendChild(o);
      }
    }
    subSel.onchange = () => { formSubId = parseInt(subSel.value); };
    subField.appendChild(subSel);
    wrap.appendChild(subField);

    // Type picker
    const typeField = mkField('schedule type');
    const typeRow = document.createElement('div');
    typeRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px';
    ['interval', 'daily'].forEach(tid => {
      const btn = document.createElement('button');
      const on = tid === formType;
      btn.style.cssText = `padding:8px 10px;border-radius:8px;cursor:pointer;text-align:left;border:1px solid ${on ? 'var(--h-ink)' : 'var(--h-border)'};background:${on ? 'var(--h-surface)' : 'transparent'};font-family:var(--h-sans);font-size:12.5px;color:${on ? 'var(--h-ink)' : 'var(--h-ink-mute)'}`;
      btn.textContent = tid === 'interval' ? 'interval — fires on a cadence' : 'daily — once at a set time';
      btn.onclick = () => { formType = tid; renderBody(); };
      typeRow.appendChild(btn);
    });
    typeField.appendChild(typeRow);
    wrap.appendChild(typeField);

    // Cadence input
    if (formType === 'interval') {
      const cadField = mkField('interval', 'minutes between runs · 5 min to 1440 (24h)');
      const cadRow = document.createElement('div');
      cadRow.style.cssText = 'display:flex;align-items:center;gap:8px';
      cadRow.appendChild(makeStepper(formEvery, 5, 1440, v => { formEvery = v; }));
      const cadLabel = document.createElement('span');
      cadLabel.style.cssText = 'font-size:13px;color:var(--h-ink-mute)';
      cadLabel.textContent = 'minutes';
      cadRow.appendChild(cadLabel);
      cadField.appendChild(cadRow);
      wrap.appendChild(cadField);
    } else {
      const tzShort = formTz === 'Asia/Jakarta' ? 'WIB' : formTz.split('/').pop();
      const timeField = mkField('time of day', `24-hour clock in ${formTz} (${tzShort})`);
      const timeInput = document.createElement('input');
      timeInput.type = 'time';
      timeInput.value = formAt;
      timeInput.style.cssText = 'padding:7px 10px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);font-family:ui-monospace,Menlo,monospace;font-size:13px';
      timeInput.onchange = () => { formAt = timeInput.value; };
      timeField.appendChild(timeInput);
      wrap.appendChild(timeField);
    }

    // Task
    const taskField = mkField('task', 'sent to the sub-agent on every run');
    const taskArea = document.createElement('textarea');
    taskArea.style.cssText = 'width:100%;min-height:60px;padding:8px 10px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);font-family:var(--h-sans);font-size:13px;resize:vertical;box-sizing:border-box';
    taskArea.value = formTask;
    taskArea.placeholder = 'Check deployment health and report anomalies…';
    taskArea.oninput = () => { formTask = taskArea.value; };
    taskField.appendChild(taskArea);
    wrap.appendChild(taskField);

    // Enabled toggle
    const enRow = document.createElement('div');
    enRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:14px';
    const enLabel = document.createElement('span');
    enLabel.style.cssText = 'font-size:13px;color:var(--h-ink-mute)';
    enLabel.textContent = 'enabled';
    const enTog = document.createElement('button');
    enTog.style.cssText = `background:transparent;border:1px solid var(--h-border);border-radius:999px;padding:3px 12px;cursor:pointer;font-family:var(--h-sans);font-size:12px;color:${formEnabled ? 'var(--h-ink-mute)' : '#b35a4b'}`;
    enTog.textContent = formEnabled ? 'on' : 'off';
    enTog.onclick = () => { formEnabled = !formEnabled; enTog.textContent = formEnabled ? 'on' : 'off'; enTog.style.color = formEnabled ? 'var(--h-ink-mute)' : '#b35a4b'; };
    enRow.append(enLabel, enTog);
    wrap.appendChild(enRow);

    // Buttons
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;align-items:center';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'h-btn-primary';
    saveBtn.style.cssText = 'padding:7px 18px;font-size:12.5px';
    saveBtn.textContent = editing ? 'save' : 'create schedule';
    saveBtn.onclick = async () => {
      const spec = formType === 'interval'
        ? { type: 'interval', every_minutes: formEvery }
        : { type: 'daily', at: formAt, tz: formTz };
      const payload = { task: formTask, schedule_spec: spec, enabled: formEnabled };
      if (!editing) payload.sub_agent_id = formSubId;
      saveBtn.disabled = true;
      try {
        const url = editing
          ? `/api/rooms/${room.id}/sub-agent-schedules/${editing.id}`
          : `/api/rooms/${room.id}/sub-agent-schedules`;
        const r = await fetch(url, {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) { const e = await r.json().catch(() => ({})); showToast(e.error || 'Failed', { error: true }); saveBtn.disabled = false; return; }
        schedFormOpen = false; schedEditId = null;
        reloadSchedules();
      } catch { showToast('Failed to save schedule', { error: true }); saveBtn.disabled = false; }
    };
    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = 'background:transparent;border:none;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12.5px;padding:7px 12px;cursor:pointer';
    cancelBtn.textContent = 'cancel';
    cancelBtn.onclick = () => { schedFormOpen = false; schedEditId = null; renderBody(); };
    btns.append(saveBtn, cancelBtn);
    wrap.appendChild(btns);

    return wrap;
  }

  function renderBody() {
    panel.innerHTML = '';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px';
    head.innerHTML = `<span style="font-family:var(--h-serif);font-style:italic;font-size:19px;color:var(--h-ink)">Room settings</span><span style="font-size:12px;color:var(--h-ink-faint)">${(room.title || '').replace(/</g, '&lt;')}</span>`;
    panel.appendChild(head);

    // ── Model tiers card
    const tc = makeCard('Model tiers', 'first model is primary — the rest are tried in order on failure');
    if (!tiersState) {
      const def = document.createElement('div');
      def.style.cssText = 'font-size:12.5px;color:var(--h-ink-mute);line-height:1.7';
      def.innerHTML = 'using server defaults · ' + TIERS.map(t => `<span style="color:var(--h-ink)">${t}</span> → ${DEFAULTS[t].map(shortName).join(' → ')}`).join('<br>');
      tc.appendChild(def);
      const ov = document.createElement('button');
      ov.textContent = 'override for this room';
      ov.style.cssText = 'margin-top:12px;background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12.5px;padding:6px 14px;cursor:pointer';
      ov.onclick = () => { tiersState = { quick: DEFAULTS.quick.slice(), standard: DEFAULTS.standard.slice(), deep: DEFAULTS.deep.slice() }; renderBody(); };
      tc.appendChild(ov);
    } else {
      for (const t of TIERS) {
        const trow = document.createElement('div');
        trow.style.cssText = 'display:flex;align-items:flex-start;gap:12px;padding:8px 0;border-top:1px solid var(--h-border)';
        const chip = document.createElement('span');
        chip.style.cssText = 'flex:0 0 66px;font-size:12px;color:var(--h-ink);padding-top:4px';
        chip.textContent = t;
        const ce = document.createElement('div'); ce.style.flex = '1'; ce.appendChild(makeChainEditor(t));
        trow.append(chip, ce);
        tc.appendChild(trow);
      }
      const reset = document.createElement('button');
      reset.textContent = 'reset to server defaults';
      reset.style.cssText = 'margin-top:12px;background:transparent;border:none;color:var(--h-ink-faint);font-family:var(--h-sans);font-size:12px;padding:4px 0;cursor:pointer;text-decoration:underline';
      reset.onclick = () => { tiersState = null; renderBody(); };
      tc.appendChild(reset);
    }
    panel.appendChild(tc);

    // ── Spawn budget card
    const bc = makeCard('Sub-agent budget', 'limits how many sub-agents this room may run');
    const mkRow = (label, hint, control) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0';
      const left = document.createElement('div');
      left.innerHTML = `<div style="font-size:13px;color:var(--h-ink)">${label}</div><div style="font-size:11.5px;color:var(--h-ink-faint)">${hint}</div>`;
      r.append(left, control);
      return r;
    };
    bc.appendChild(mkRow('max concurrent', 'sub-agents running at once', makeStepper(maxConcurrent, 1, 10, v => { maxConcurrent = v; })));
    bc.appendChild(mkRow('max spawns / hour', 'AI-triggered spawns per hour', makeStepper(maxPerHour, 1, 100, v => { maxPerHour = v; })));
    // pause toggle
    const pr = document.createElement('div');
    pr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--h-border);margin-top:4px';
    const pleft = document.createElement('div');
    pleft.innerHTML = '<div style="font-size:13px;color:var(--h-ink)">pause new spawns</div><div style="font-size:11.5px;color:var(--h-ink-faint)">running ones finish; blocks new ones</div>';
    const ptog = document.createElement('button');
    const paintTog = () => { ptog.textContent = paused ? 'paused' : 'active'; ptog.style.cssText = `background:transparent;border:1px solid var(--h-border);border-radius:999px;padding:5px 14px;cursor:pointer;font-family:var(--h-sans);font-size:12.5px;color:${paused ? '#b35a4b' : 'var(--h-ink-mute)'}`; };
    paintTog();
    ptog.onclick = () => { paused = !paused; paintTog(); };
    pr.append(pleft, ptog);
    bc.appendChild(pr);
    panel.appendChild(bc);

    // ── Scheduled triggers card
    panel.appendChild(renderScheduleCard());

    // ── Footer
    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:4px';
    const cancel = document.createElement('button');
    cancel.textContent = 'cancel';
    cancel.style.cssText = 'background:transparent;border:none;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:13px;padding:8px 14px;cursor:pointer';
    cancel.onclick = close;
    const save = document.createElement('button');
    save.className = 'h-btn-primary'; save.style.cssText = 'padding:8px 20px;font-size:13px';
    save.textContent = 'save';
    save.onclick = async () => {
      save.disabled = true;
      try {
        const r = await fetch(`/api/rooms/${room.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model_tiers: tiersState, max_sub_agents: maxConcurrent, max_spawns_per_hour: maxPerHour }),
        });
        if (!r.ok) { const e = await r.json().catch(() => ({})); showToast(e.error || 'Failed to save', { error: true }); save.disabled = false; return; }
        if (paused !== pausedOrig) {
          const pr2 = await fetch(`/api/rooms/${room.id}/spawns-pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }) });
          if (pr2.ok) { room.spawns_paused = paused ? 1 : 0; }
        }
        room.max_sub_agents = maxConcurrent;
        showToast('Room settings saved', {});
        close();
      } catch { showToast('Failed to save', { error: true }); save.disabled = false; }
    };
    foot.append(cancel, save);
    panel.appendChild(foot);
  }
}

