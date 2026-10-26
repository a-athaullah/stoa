// ── Room sidebar ────────────────────────────────────────────────────────────
// Icon strip on the right edge: Search, Download, Workspace, and per-room
// settings (Model Tier, Budget, Display, Schedules, Memory) via popovers.

let _rsbActiveBtn = null;
let _rsbPopover = null;
let _rsbOutsideListener = null;

let _rsbTooltipEl = null;

function _showRsbTooltip(btn) {
  if (!btn.dataset.tooltip) return;
  if (!_rsbTooltipEl) {
    _rsbTooltipEl = document.createElement('div');
    _rsbTooltipEl.className = 'h-fixed-tooltip';
    document.body.appendChild(_rsbTooltipEl);
  }
  _rsbTooltipEl.textContent = btn.dataset.tooltip;
  _rsbTooltipEl.classList.remove('visible');

  const r = btn.getBoundingClientRect();
  requestAnimationFrame(() => {
    const tw = _rsbTooltipEl.offsetWidth;
    _rsbTooltipEl.style.top = (r.top + r.height / 2 - _rsbTooltipEl.offsetHeight / 2) + 'px';
    _rsbTooltipEl.style.left = (r.left - tw - 8) + 'px';
    _rsbTooltipEl.classList.add('visible');
  });
}

function _hideRsbTooltip() {
  if (_rsbTooltipEl) _rsbTooltipEl.classList.remove('visible');
}

function renderRoomSidebar(room, participants) {
  const sidebar = document.getElementById('room-sidebar');
  if (!sidebar) return;
  sidebar.innerHTML = '';

  function mkBtn(title, svg, onClick) {
    const b = document.createElement('button');
    b.className = 'h-rsb-btn';
    b.dataset.tooltip = title;
    b.innerHTML = svg;
    b.onclick = onClick;
    b.addEventListener('mouseenter', () => _showRsbTooltip(b));
    b.addEventListener('mouseleave', _hideRsbTooltip);
    return b;
  }

  function mkDivider() {
    const d = document.createElement('div');
    d.className = 'h-rsb-divider';
    return d;
  }

  function openPopover(anchorBtn, buildFn) {
    if (_rsbActiveBtn === anchorBtn && _rsbPopover) { closeRsbPopover(); return; }
    closeRsbPopover();
    _rsbActiveBtn = anchorBtn;
    anchorBtn.classList.add('active');

    const pop = document.createElement('div');
    pop.className = 'h-rsb-popover';
    document.body.appendChild(pop);
    _rsbPopover = pop;
    buildFn(pop);

    const btnRect = anchorBtn.getBoundingClientRect();
    const sidebarRect = sidebar.getBoundingClientRect();
    pop.style.right = (window.innerWidth - sidebarRect.left + 4) + 'px';

    // Anchor below chat header, stretch to bottom of viewport
    requestAnimationFrame(() => {
      const header = document.getElementById('chat-header');
      const topOffset = header ? header.getBoundingClientRect().bottom + 8 : 56;
      pop.style.top = topOffset + 'px';
      pop.style.maxHeight = (window.innerHeight - topOffset - 12) + 'px';
    });

    setTimeout(() => {
      _rsbOutsideListener = (e) => {
        if (_rsbPopover && !_rsbPopover.contains(e.target) && e.target !== anchorBtn && document.contains(e.target)) {
          closeRsbPopover();
        }
      };
      document.addEventListener('click', _rsbOutsideListener);
    }, 0);
  }

  const ICONS = {
    search:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    download:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v9M5 8l3 3 3-3"/><path d="M3 13h10"/></svg>`,
    workspace: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M14 4v16"/></svg>`,
    layers:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    shield:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    eye:       `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    clock:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    brain:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.44-2.14z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.44-2.14z"/></svg>`,
    users:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  };

  const SA_MODELS = getAvailableModels().filter(m => m.platform === 'anthropic').map(m => m.value);
  const DEFAULTS = {
    quick:    ['claude-haiku-4-5-20251001'],
    standard: ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    deep:     ['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'],
  };
  const TIERS = ['quick', 'standard', 'deep'];
  const shortName = m => m.replace(/^claude-/, '').replace(/-\d.*$/, '');

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

  function popTitle(text) {
    const t = document.createElement('div');
    t.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:16px;color:var(--h-ink);margin-bottom:14px';
    t.textContent = text;
    return t;
  }

  // ── Search
  sidebar.appendChild(mkBtn('Search in room', ICONS.search, () => toggleRoomSearch()));

  // ── Download / Export
  const dlBtn = mkBtn('Export conversation', ICONS.download, () => {
    openPopover(dlBtn, pop => {
      pop.appendChild(popTitle('Export'));
      ['JSON', 'CSV'].forEach(fmt => {
        const b = document.createElement('button');
        b.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;border:1px solid var(--h-border);border-radius:8px;background:transparent;color:var(--h-ink);font-family:var(--h-sans);font-size:13px;cursor:pointer;margin-bottom:6px';
        b.textContent = fmt;
        b.onmouseenter = () => b.style.background = 'var(--h-surface-hi, var(--h-surface))';
        b.onmouseleave = () => b.style.background = 'transparent';
        b.onclick = () => {
          const a = document.createElement('a');
          a.href = `/api/rooms/${room.id}/export?format=${fmt.toLowerCase()}`;
          a.download = '';
          document.body.appendChild(a); a.click(); a.remove();
          closeRsbPopover();
        };
        pop.appendChild(b);
      });
    });
  });
  sidebar.appendChild(dlBtn);

  // ── Dev Workspace
  const wsPanel = document.getElementById('workspace-panel');
  const wsBtn = mkBtn('Dev Workspace', ICONS.workspace, () => {
    toggleWorkspacePanel();
    wsBtn.classList.toggle('active', wsPanel && wsPanel.classList.contains('open'));
  });
  if (wsPanel && wsPanel.classList.contains('open')) wsBtn.classList.add('active');
  sidebar.appendChild(wsBtn);

  // ── Agents
  const agentsBtn = mkBtn('Agents', ICONS.users, () => openPopover(agentsBtn, buildAgentsPanel));
  sidebar.appendChild(agentsBtn);

  sidebar.appendChild(mkDivider());

  // ── Model Tier
  const tierBtn = mkBtn('Model Tiers', ICONS.layers, () => openPopover(tierBtn, buildModelTierPanel));
  sidebar.appendChild(tierBtn);

  // ── Sub-agent Budget
  const budgetBtn = mkBtn('Sub-agent Budget', ICONS.shield, () => openPopover(budgetBtn, buildBudgetPanel));
  sidebar.appendChild(budgetBtn);

  // ── Display
  const displayBtn = mkBtn('Display', ICONS.eye, () => openPopover(displayBtn, buildDisplayPanel));
  sidebar.appendChild(displayBtn);

  // ── Scheduled Triggers
  const schedBtn = mkBtn('Scheduled Triggers', ICONS.clock, () => openPopover(schedBtn, pop => { pop.appendChild(popTitle('Scheduled triggers')); buildSchedulePanel(pop, room); }));
  sidebar.appendChild(schedBtn);

  // ── Memory
  const memBtn = mkBtn('Memory', ICONS.brain, () => openPopover(memBtn, buildMemoryPanel));
  sidebar.appendChild(memBtn);

  // ────────────────────────────────────────────────────────── Panel builders

  function buildAgentsPanel(pop) {
    pop.appendChild(popTitle('Agents'));
    const body = document.createElement('div');
    body.innerHTML = '<div style="font-size:12.5px;color:var(--h-ink-faint)">loading…</div>';
    pop.appendChild(body);

    function avatarEl(actor, size = 28) {
      const av = document.createElement('div');
      av.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-family:var(--h-serif);font-style:italic;flex:0 0 auto;overflow:hidden;border:1px solid var(--h-border)`;
      if (actor.avatar_url) {
        const img = document.createElement('img');
        img.src = actor.avatar_url;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover';
        av.appendChild(img);
      } else {
        av.style.background = actor.avatar_color || 'var(--h-surface)';
        av.style.color = 'var(--h-ink)';
        av.textContent = actor.avatar_symbol || actor.name?.[0] || '?';
      }
      return av;
    }

    function sectionLabel(text) {
      const l = document.createElement('div');
      l.style.cssText = 'font-size:11px;color:var(--h-ink-mute);text-transform:uppercase;letter-spacing:.08em;margin:14px 0 6px';
      l.textContent = text;
      return l;
    }

    async function load() {
      try {
        const [parts, subAgents, allActors] = await Promise.all([
          fjson(`/api/rooms/${room.id}/participants`),
          fjson(`/api/rooms/${room.id}/sub-agents`),
          fjson(`/api/actors`),
        ]);
        body.innerHTML = '';
        renderParticipants(parts, allActors);
        renderSubAgents(subAgents);
      } catch (err) {
        body.innerHTML = `<div style="font-size:12.5px;color:var(--h-red)">failed to load</div>`;
      }
    }

    function renderParticipants(parts, allActors) {
      body.appendChild(sectionLabel('Participants'));

      const list = Array.isArray(parts) ? parts : (parts.participants || []);
      const actors = Array.isArray(allActors) ? allActors : (allActors.actors || []);
      const actorById = new Map(actors.map(a => [a.id, a]));
      if (!list.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:12.5px;color:var(--h-ink-mute);font-style:italic;padding:4px 0';
        empty.textContent = 'no participants';
        body.appendChild(empty);
      } else {
        list.forEach(p => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:5px 0';
          const av = avatarEl(p);
          const info = document.createElement('div');
          info.style.cssText = 'flex:1;min-width:0';
          const name = document.createElement('div');
          name.style.cssText = 'font-size:13px;color:var(--h-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
          name.textContent = p.name || p.actor_name || '?';
          const meta = document.createElement('div');
          meta.style.cssText = 'font-size:11px;color:var(--h-ink-faint);display:flex;align-items:center;gap:6px;margin-top:1px';
          const typeChip = document.createElement('span');
          typeChip.textContent = p.type || p.actor_type || 'ai';
          typeChip.style.cssText = 'padding:1px 6px;border-radius:999px;border:1px solid var(--h-border);font-size:10.5px';
          const actorId = p.actor_id || p.id;
          const online = (p.type || p.actor_type) === 'human'
            ? actorId === humanActor?.id
            : !!actorById.get(actorId)?.online;
          const status = !online ? 'offline' : p.session_status === 'active' ? 'active' : 'online';
          const statusDot = document.createElement('span');
          statusDot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${online ? 'oklch(65% .18 145)' : 'var(--h-border)'}`;
          statusDot.title = status;
          meta.append(typeChip, statusDot, document.createTextNode(status));
          info.append(name, meta);
          row.append(av, info);
          body.appendChild(row);
        });
      }

      // Add agent section
      const participantIds = new Set(list.map(p => p.actor_id || p.id));
      const addable = actors.filter(a => (a.type === 'ai' || a.actor_type === 'ai') && !participantIds.has(a.id));

      if (addable.length) {
        body.appendChild(sectionLabel('Add agent'));
        const addWrap = document.createElement('div');
        addWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';

        let selectedActorId = addable[0].id;
        let selectedWorkdir = '';
        let workdirOptions = [];

        const actorSel = document.createElement('select');
        actorSel.style.cssText = 'width:100%;padding:5px 8px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);font-family:var(--h-sans);font-size:12px';
        for (const a of addable) {
          const o = document.createElement('option');
          o.value = a.id;
          o.textContent = a.name;
          actorSel.appendChild(o);
        }

        const workdirSel = document.createElement('select');
        workdirSel.style.cssText = 'width:100%;padding:5px 8px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);font-family:var(--h-sans);font-size:12px';

        async function loadWorkdirs(actorId) {
          workdirSel.innerHTML = '<option value="">loading…</option>';
          try {
            const wd = await fjson(`/api/actors/${actorId}/workdirs`);
            workdirOptions = Array.isArray(wd) ? wd : (wd.workdirs || []);
            workdirSel.innerHTML = '';
            const noneOpt = document.createElement('option');
            noneOpt.value = '';
            noneOpt.textContent = '(no workdir)';
            workdirSel.appendChild(noneOpt);
            for (const w of workdirOptions) {
              const o = document.createElement('option');
              o.value = w.path || w;
              o.textContent = w.label || w.path || w;
              workdirSel.appendChild(o);
            }
            selectedWorkdir = '';
          } catch {
            workdirSel.innerHTML = '<option value="">(none)</option>';
          }
        }

        actorSel.onchange = () => {
          selectedActorId = parseInt(actorSel.value);
          loadWorkdirs(selectedActorId);
        };
        workdirSel.onchange = () => { selectedWorkdir = workdirSel.value; };

        const addBtn = document.createElement('button');
        addBtn.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:5px 14px;cursor:pointer;align-self:flex-start';
        addBtn.textContent = 'add agent';
        addBtn.onclick = async () => {
          addBtn.disabled = true;
          try {
            const payload = { actor_id: selectedActorId };
            if (selectedWorkdir) payload.workdir = selectedWorkdir;
            const r = await fetch(`/api/rooms/${room.id}/participants`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (r.ok) { showToast('Agent added'); closeRsbPopover(); }
            else { const e = await r.json().catch(() => ({})); showToast(e.error || 'Failed', { error: true }); addBtn.disabled = false; }
          } catch { showToast('Failed', { error: true }); addBtn.disabled = false; }
        };

        addWrap.append(actorSel, workdirSel, addBtn);
        body.appendChild(addWrap);
        loadWorkdirs(selectedActorId);
      }
    }

    function subAgentDescLine(text) {
      const d = document.createElement('div');
      d.style.cssText = 'font-size:11px;color:var(--h-ink-faint);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      d.textContent = text;
      d.title = text;
      return d;
    }

    function subAgentAvatarEl(sa) {
      return avatarEl({
        avatar_url: sa.avatar_url,
        avatar_color: sa.avatar_color,
        avatar_symbol: sa.avatar_symbol,
        name: sa.label || sa.parent_name,
      }, 24);
    }

    function renderSubAgents(subAgents) {
      const linked = subAgents.linked || [];
      const available = subAgents.available || [];

      body.appendChild(sectionLabel('Sub-agents'));

      if (!linked.length && !available.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:12.5px;color:var(--h-ink-mute);font-style:italic;padding:4px 0';
        empty.textContent = 'no sub-agents';
        body.appendChild(empty);
        return;
      }

      linked.forEach(sa => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 0';
        const seal = subAgentAvatarEl(sa);
        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0';
        const name = document.createElement('div');
        name.style.cssText = 'font-size:12.5px;color:var(--h-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        name.textContent = sa.label || '?';
        const parent = document.createElement('div');
        parent.style.cssText = 'font-size:11px;color:var(--h-ink-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        parent.textContent = [sa.role, sa.parent_name].filter(Boolean).join(' · ');
        info.append(name, parent);
        if (sa.description) info.appendChild(subAgentDescLine(sa.description));
        const unlinkBtn = document.createElement('button');
        unlinkBtn.style.cssText = 'background:transparent;border:none;color:var(--h-ink-faint);cursor:pointer;font-size:13px;padding:2px 4px';
        unlinkBtn.textContent = '×';
        unlinkBtn.title = 'unlink';
        unlinkBtn.onclick = async () => {
          unlinkBtn.disabled = true;
          try {
            const r = await fetch(`/api/rooms/${room.id}/sub-agents/${sa.id}`, { method: 'DELETE' });
            if (r.ok) { row.style.opacity = '.4'; showToast('Sub-agent unlinked'); }
            else { const e = await r.json().catch(() => ({})); showToast(e.error || 'Failed', { error: true }); unlinkBtn.disabled = false; }
          } catch { showToast('Failed', { error: true }); unlinkBtn.disabled = false; }
        };
        row.append(seal, info, unlinkBtn);
        body.appendChild(row);
      });

      if (available.length) {
        const avLabel = document.createElement('div');
        avLabel.style.cssText = 'font-size:11px;color:var(--h-ink-faint);margin:10px 0 5px;font-style:italic';
        avLabel.textContent = 'available to link';
        body.appendChild(avLabel);

        available.forEach(sa => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0';
          const seal = subAgentAvatarEl(sa);
          seal.style.borderStyle = 'dashed';
          const info = document.createElement('div');
          info.style.cssText = 'flex:1;min-width:0';
          const name = document.createElement('div');
          name.style.cssText = 'font-size:12.5px;color:var(--h-ink-mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
          name.textContent = sa.label || '?';
          const parent = document.createElement('div');
          parent.style.cssText = 'font-size:11px;color:var(--h-ink-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
          parent.textContent = [sa.role, sa.parent_name].filter(Boolean).join(' · ');
          info.append(name, parent);
          if (sa.description) info.appendChild(subAgentDescLine(sa.description));
          const linkBtn = document.createElement('button');
          linkBtn.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:11px;padding:2px 10px;cursor:pointer';
          linkBtn.textContent = 'link';
          linkBtn.onclick = async () => {
            linkBtn.disabled = true;
            try {
              const r = await fetch(`/api/rooms/${room.id}/sub-agents`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sub_agent_id: sa.id }),
              });
              if (r.ok) { showToast('Sub-agent linked'); closeRsbPopover(); }
              else { const e = await r.json().catch(() => ({})); showToast(e.error || 'Failed', { error: true }); linkBtn.disabled = false; }
            } catch { showToast('Failed', { error: true }); linkBtn.disabled = false; }
          };
          row.append(seal, info, linkBtn);
          body.appendChild(row);
        });
      }
    }

    load();
  }

  function buildModelTierPanel(pop) {
    pop.appendChild(popTitle('Model tiers'));
    pop.appendChild(Object.assign(document.createElement('div'), {
      style: 'font-size:12px;color:var(--h-ink-faint);margin-bottom:12px',
      textContent: 'first model is primary — the rest are tried in order on failure',
    }));
    const body = document.createElement('div');
    pop.appendChild(body);

    let tiersState = null;
    fjson(`/api/rooms/${room.id}`).then(r => {
      try { tiersState = r.model_tiers ? JSON.parse(r.model_tiers) : null; } catch { tiersState = null; }
      renderTiers();
    }).catch(() => { body.textContent = 'failed to load'; });

    function makeChainEditor(tier) {
      const chain = tiersState[tier] || (tiersState[tier] = DEFAULTS[tier].slice());
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:6px';
      chain.forEach((m, i) => {
        if (i > 0) { const a = document.createElement('span'); a.style.cssText = 'color:var(--h-ink-faint);font-size:12px'; a.textContent = '→'; row.appendChild(a); }
        const pill = document.createElement('span');
        pill.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:3px 4px 3px 9px;border-radius:999px;background:var(--h-surface);border:1px solid var(--h-border);font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--h-ink)';
        const nm = document.createElement('span'); nm.textContent = shortName(m); nm.title = m; pill.appendChild(nm);
        if (i > 0) {
          const up = document.createElement('button'); up.textContent = '↑'; up.title = 'promote';
          up.style.cssText = 'background:transparent;border:none;color:var(--h-ink-faint);cursor:pointer;font-size:12px;padding:0 2px';
          up.onclick = () => { chain.splice(i - 1, 0, chain.splice(i, 1)[0]); renderTiers(); };
          pill.appendChild(up);
        }
        const x = document.createElement('button'); x.textContent = '×'; x.title = 'remove';
        x.style.cssText = 'background:transparent;border:none;color:var(--h-ink-faint);cursor:pointer;font-size:14px;padding:0 3px 0 1px';
        x.onclick = () => { chain.splice(i, 1); if (!chain.length) delete tiersState[tier]; renderTiers(); };
        pill.appendChild(x); row.appendChild(pill);
      });
      const unused = SA_MODELS.filter(m => !chain.includes(m));
      if (unused.length) {
        const add = document.createElement('select');
        add.style.cssText = 'border:1px dashed var(--h-border);border-radius:999px;background:transparent;color:var(--h-ink-mute);font-size:12px;padding:3px 6px;cursor:pointer;font-family:var(--h-sans)';
        const ph = document.createElement('option'); ph.value = ''; ph.textContent = '+ fallback'; add.appendChild(ph);
        for (const m of unused) { const o = document.createElement('option'); o.value = m; o.textContent = shortName(m); add.appendChild(o); }
        add.onchange = () => { if (add.value) { (tiersState[tier] = tiersState[tier] || []).push(add.value); renderTiers(); } };
        row.appendChild(add);
      }
      return row;
    }

    function renderTiers() {
      body.innerHTML = '';
      if (!tiersState) {
        const def = document.createElement('div');
        def.style.cssText = 'font-size:12.5px;color:var(--h-ink-mute);line-height:1.7;margin-bottom:12px';
        def.innerHTML = 'using server defaults · ' + TIERS.map(t => `<span style="color:var(--h-ink)">${t}</span> → ${DEFAULTS[t].map(shortName).join(' → ')}`).join('<br>');
        body.appendChild(def);
        const ov = document.createElement('button');
        ov.textContent = 'override for this room';
        ov.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12.5px;padding:6px 14px;cursor:pointer';
        ov.onclick = () => { tiersState = { quick: DEFAULTS.quick.slice(), standard: DEFAULTS.standard.slice(), deep: DEFAULTS.deep.slice() }; renderTiers(); };
        body.appendChild(ov);
      } else {
        for (const t of TIERS) {
          const trow = document.createElement('div');
          trow.style.cssText = 'display:flex;align-items:flex-start;gap:12px;padding:8px 0;border-top:1px solid var(--h-border)';
          const chip = document.createElement('span'); chip.style.cssText = 'flex:0 0 66px;font-size:12px;color:var(--h-ink);padding-top:4px'; chip.textContent = t;
          const ce = document.createElement('div'); ce.style.flex = '1'; ce.appendChild(makeChainEditor(t));
          trow.append(chip, ce); body.appendChild(trow);
        }
        const reset = document.createElement('button');
        reset.textContent = 'reset to server defaults';
        reset.style.cssText = 'margin-top:12px;background:transparent;border:none;color:var(--h-ink-faint);font-family:var(--h-sans);font-size:12px;padding:4px 0;cursor:pointer;text-decoration:underline';
        reset.onclick = () => { tiersState = null; renderTiers(); };
        body.appendChild(reset);
      }

      const foot = document.createElement('div');
      foot.style.cssText = 'display:flex;justify-content:flex-end;margin-top:14px;border-top:1px solid var(--h-border);padding-top:12px';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'h-btn-primary'; saveBtn.style.cssText = 'padding:6px 18px;font-size:12.5px'; saveBtn.textContent = 'save';
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try {
          const r = await fetch(`/api/rooms/${room.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model_tiers: tiersState }) });
          if (r.ok) { showToast('Tiers saved'); closeRsbPopover(); }
          else { const e = await r.json().catch(() => ({})); showToast(e.error || 'Failed', { error: true }); saveBtn.disabled = false; }
        } catch { showToast('Failed', { error: true }); saveBtn.disabled = false; }
      };
      foot.appendChild(saveBtn); body.appendChild(foot);
    }
  }

  function buildBudgetPanel(pop) {
    pop.appendChild(popTitle('Sub-agent budget'));
    pop.appendChild(Object.assign(document.createElement('div'), {
      style: 'font-size:12px;color:var(--h-ink-faint);margin-bottom:12px',
      textContent: 'limits how many sub-agents this room may run',
    }));
    const body = document.createElement('div');
    pop.appendChild(body);

    let maxConcurrent = 3, maxPerHour = 10, paused = false, pausedOrig = false;
    fjson(`/api/rooms/${room.id}`).then(r => {
      maxConcurrent = Math.max(1, Math.min(10, r.max_sub_agents || 3));
      maxPerHour = Math.max(1, Math.min(100, r.max_spawns_per_hour || 10));
      paused = pausedOrig = !!r.spawns_paused;
      renderBudget();
    }).catch(() => { body.textContent = 'failed to load'; });

    function renderBudget() {
      body.innerHTML = '';
      const mkRow = (label, hint, control) => {
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0';
        const left = document.createElement('div');
        left.innerHTML = `<div style="font-size:13px;color:var(--h-ink)">${label}</div><div style="font-size:11.5px;color:var(--h-ink-faint)">${hint}</div>`;
        r.append(left, control); return r;
      };
      body.appendChild(mkRow('max concurrent', 'sub-agents running at once', makeStepper(maxConcurrent, 1, 10, v => { maxConcurrent = v; })));
      body.appendChild(mkRow('max spawns / hour', 'AI-triggered spawns per hour', makeStepper(maxPerHour, 1, 100, v => { maxPerHour = v; })));

      const pr = document.createElement('div');
      pr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--h-border);margin-top:4px';
      const pleft = document.createElement('div');
      pleft.innerHTML = '<div style="font-size:13px;color:var(--h-ink)">pause new spawns</div><div style="font-size:11.5px;color:var(--h-ink-faint)">running ones finish; blocks new ones</div>';
      const ptog = document.createElement('button');
      const paintTog = () => { ptog.textContent = paused ? 'paused' : 'active'; ptog.style.cssText = `background:transparent;border:1px solid var(--h-border);border-radius:999px;padding:5px 14px;cursor:pointer;font-family:var(--h-sans);font-size:12.5px;color:${paused ? 'var(--h-red)' : 'var(--h-ink-mute)'}`; };
      paintTog(); ptog.onclick = () => { paused = !paused; paintTog(); };
      pr.append(pleft, ptog); body.appendChild(pr);

      const foot = document.createElement('div');
      foot.style.cssText = 'display:flex;justify-content:flex-end;margin-top:14px;border-top:1px solid var(--h-border);padding-top:12px';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'h-btn-primary'; saveBtn.style.cssText = 'padding:6px 18px;font-size:12.5px'; saveBtn.textContent = 'save';
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try {
          const r = await fetch(`/api/rooms/${room.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ max_sub_agents: maxConcurrent, max_spawns_per_hour: maxPerHour }) });
          if (!r.ok) { const e = await r.json().catch(() => ({})); showToast(e.error || 'Failed', { error: true }); saveBtn.disabled = false; return; }
          if (paused !== pausedOrig) {
            await fetch(`/api/rooms/${room.id}/spawns-pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }) });
            room.spawns_paused = paused ? 1 : 0;
          }
          room.max_sub_agents = maxConcurrent;
          showToast('Budget saved'); closeRsbPopover();
        } catch { showToast('Failed', { error: true }); saveBtn.disabled = false; }
      };
      foot.appendChild(saveBtn); body.appendChild(foot);
    }
  }

  function buildDisplayPanel(pop) {
    pop.appendChild(popTitle('Display'));
    pop.appendChild(Object.assign(document.createElement('div'), {
      style: 'font-size:12px;color:var(--h-ink-faint);margin-bottom:12px',
      textContent: 'control how much progress detail is shown while agents run',
    }));
    const body = document.createElement('div');
    pop.appendChild(body);

    const DISPLAY_OPTIONS = [
      { key: 'tool_progress',    label: 'Tool steps',  opts: [{ v:'all', h:'show all' }, { v:'new', h:'clear on done' }, { v:'off', h:'hide' }] },
      { key: 'live_status',      label: 'Live status', opts: [{ v:'full', h:'full text' }, { v:'verb', h:'verb only' }, { v:'off', h:'hide' }] },
      { key: 'cleanup_progress', label: 'Cleanup',     opts: [{ v:'on', h:'clean on done' }, { v:'off', h:'keep trail' }] },
    ];

    function render() {
      body.innerHTML = '';
      for (const setting of DISPLAY_OPTIONS) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding-top:8px;flex-wrap:wrap';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:12px;color:var(--h-ink-mute);width:76px;flex-shrink:0';
        lbl.textContent = setting.label; row.appendChild(lbl);
        const btnRow = document.createElement('div'); btnRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
        const resolvedVal = setting.key === 'tool_progress' ? getToolProgress() : setting.key === 'live_status' ? getLiveStatus() : getCleanupProgress();
        for (const opt of setting.opts) {
          const active = resolvedVal === opt.v;
          const b = document.createElement('button');
          b.style.cssText = `background:${active ? 'var(--h-accent-subtle,color-mix(in srgb,var(--h-accent) 12%,transparent))' : 'transparent'};border:1px solid ${active ? 'var(--h-accent,var(--h-border))' : 'var(--h-border)'};border-radius:999px;padding:4px 12px;cursor:pointer;font-family:var(--h-sans);font-size:12px;color:${active ? 'var(--h-accent,var(--h-ink))' : 'var(--h-ink-mute)'};display:flex;flex-direction:column;align-items:center;gap:1px`;
          b.innerHTML = `<span style="font-weight:${active ? '600' : '400'}">${opt.v}</span><span style="font-size:10px;opacity:.7">${opt.h}</span>`;
          b.onclick = () => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'set_room_setting', key: setting.key, value: opt.v })); render(); };
          btnRow.appendChild(b);
        }
        row.appendChild(btnRow); body.appendChild(row);
      }
    }
    render();
  }

  function buildMemoryPanel(pop) {
    pop.appendChild(popTitle('System Prompt & Memory'));

    // ── Tab bar — System Prompt first
    const TAB_BASE = 'background:transparent;border:none;font-family:var(--h-sans);font-size:12.5px;padding:4px 12px;cursor:pointer;border-radius:999px;transition:background .15s,color .15s';
    const TAB_ON = 'color:var(--h-ink);background:var(--h-surface-hi)';
    const TAB_OFF = 'color:var(--h-ink-faint)';
    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:2px;margin-bottom:12px;border:1px solid var(--h-border);border-radius:999px;padding:3px;background:var(--h-bg)';
    const tabSysBtn = document.createElement('button'); tabSysBtn.textContent = 'System Prompt'; tabSysBtn.style.cssText = TAB_BASE + ';' + TAB_ON;
    const tabMemBtn = document.createElement('button'); tabMemBtn.textContent = 'Memory'; tabMemBtn.style.cssText = TAB_BASE + ';' + TAB_OFF;
    tabBar.append(tabSysBtn, tabMemBtn);
    pop.appendChild(tabBar);

    // flex layout so panes stretch to fill available height
    pop.style.display = 'flex';
    pop.style.flexDirection = 'column';
    pop.style.overflow = 'hidden';

    const PANE_CSS = 'flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden';
    const sysPane = document.createElement('div'); sysPane.style.cssText = PANE_CSS;
    const memPane = document.createElement('div'); memPane.style.cssText = PANE_CSS; memPane.style.display = 'none';
    pop.appendChild(sysPane);
    pop.appendChild(memPane);

    const switchTab = (tab) => {
      const onSys = tab === 'system';
      sysPane.style.display = onSys ? 'flex' : 'none';
      memPane.style.display = onSys ? 'none' : 'flex';
      tabSysBtn.style.cssText = TAB_BASE + ';' + (onSys ? TAB_ON : TAB_OFF);
      tabMemBtn.style.cssText = TAB_BASE + ';' + (onSys ? TAB_OFF : TAB_ON);
    };
    tabSysBtn.onclick = () => switchTab('system');
    tabMemBtn.onclick = () => switchTab('memory');

    // ── Shared: build a render/edit field inside a pane
    const RENDER_WRAP_CSS = 'border:1px solid var(--h-border);border-radius:8px;padding:10px 14px;background:var(--h-surface);flex:1;overflow-y:auto;font-size:13px;line-height:1.6;color:var(--h-ink);word-break:break-word';
    const TA_CSS = 'width:100%;box-sizing:border-box;flex:1;resize:none;min-height:0;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;padding:8px 10px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);outline:none';
    const BTN_CSS = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:4px 14px;cursor:pointer';
    const CANCEL_CSS = 'background:transparent;border:none;color:var(--h-ink-faint);font-family:var(--h-sans);font-size:12px;padding:4px 8px;cursor:pointer';
    const COUNTER_CSS = 'font-size:11.5px;color:var(--h-ink-faint);font-variant-numeric:tabular-nums';

    function buildEditField(pane, { initialContent, limit, placeholder, onSave }) {
      let content = initialContent;

      const outer = document.createElement('div');
      outer.style.cssText = 'position:relative;flex:1;display:flex;flex-direction:column;min-height:0';

      // render view
      const renderWrap = document.createElement('div');
      renderWrap.className = 'h-bubble';
      renderWrap.style.cssText = RENDER_WRAP_CSS;

      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.style.cssText = 'position:absolute;top:8px;right:8px;background:var(--h-surface);border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:11.5px;padding:3px 10px;cursor:pointer;z-index:1';

      // edit view
      const editWrap = document.createElement('div');
      editWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0';
      const ta = document.createElement('textarea');
      ta.placeholder = placeholder; ta.maxLength = limit;
      ta.style.cssText = TA_CSS;

      const footer = document.createElement('div'); footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:6px;flex:0 0 auto';
      const counter = document.createElement('span'); counter.style.cssText = COUNTER_CSS;
      const updateCounter = () => { const used = ta.value.length; const pct = used / limit; counter.textContent = `${used} / ${limit}`; counter.style.color = pct > .9 ? 'var(--h-red)' : pct > .75 ? 'var(--h-amber)' : 'var(--h-ink-faint)'; };
      ta.addEventListener('input', updateCounter);

      const btnRow = document.createElement('div'); btnRow.style.cssText = 'display:flex;gap:6px';
      const saveBtn = document.createElement('button'); saveBtn.textContent = 'save'; saveBtn.style.cssText = BTN_CSS;
      const cancelBtn = document.createElement('button'); cancelBtn.textContent = 'cancel'; cancelBtn.style.cssText = CANCEL_CSS;
      btnRow.append(saveBtn, cancelBtn);
      footer.append(counter, btnRow);
      editWrap.append(ta, footer);

      const toRender = () => {
        renderWrap.innerHTML = content.trim()
          ? renderMarkdown(content)
          : '<span style="color:var(--h-ink-faint);font-style:italic;font-size:13px">empty — click Edit to add content</span>';
        addCopyButtons(renderWrap);
        renderWrap.style.display = 'block'; editBtn.style.display = '';
        editWrap.style.display = 'none';
      };

      const toEdit = () => {
        ta.value = content; updateCounter();
        renderWrap.style.display = 'none'; editBtn.style.display = 'none';
        editWrap.style.display = 'flex';
        requestAnimationFrame(() => ta.focus());
      };

      editBtn.onclick = toEdit;
      cancelBtn.onclick = () => toRender();
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        const saved = await onSave(ta.value);
        if (saved) { content = ta.value; toRender(); }
        saveBtn.disabled = false;
      };

      outer.append(renderWrap, editBtn, editWrap);
      pane.appendChild(outer);

      // start in render mode if there's content, else edit mode
      if (content.trim()) toRender(); else toEdit();
    }

    // ── Memory pane
    const body = memPane;
    body.innerHTML = '<div style="font-size:12.5px;color:var(--h-ink-faint)">loading…</div>';

    (async () => {
      try {
        const r = await fetch(`/api/rooms/${room.id}/memory`);
        if (!r.ok) { body.innerHTML = '<div style="font-size:12.5px;color:var(--h-red)">failed to load</div>'; return; }
        const data = await r.json();
        body.innerHTML = '';
        const BUDGET = data.budget || 1800;

        buildEditField(body, {
          initialContent: data.content || '',
          limit: BUDGET,
          placeholder: 'Write context injected into every session in this room…',
          onSave: async (val) => {
            try {
              const rr = await fetch(`/api/rooms/${room.id}/memory`, { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ content: val }) });
              if (rr.ok) { showToast('Memory saved'); return true; }
              const e = await rr.json().catch(() => ({})); showToast(e.error || 'Failed to save', { error:true }); return false;
            } catch { showToast('Failed to save', { error:true }); return false; }
          },
        });
      } catch { body.innerHTML = '<div style="font-size:12.5px;color:var(--h-red)">failed to load</div>'; }
    })();

    // ── System Prompt pane
    sysPane.innerHTML = '<div style="font-size:12.5px;color:var(--h-ink-faint)">loading…</div>';
    (async () => {
      try {
        const r = await fetch(`/api/rooms/${room.id}/system-prompt`);
        if (!r.ok) { sysPane.innerHTML = '<div style="font-size:12.5px;color:var(--h-red)">failed to load</div>'; return; }
        const data = await r.json();
        sysPane.innerHTML = '';

        const spDesc = document.createElement('div');
        spDesc.style.cssText = 'font-size:12px;color:var(--h-ink-faint);margin-bottom:10px';
        spDesc.textContent = 'custom instructions prepended to agent sessions in this room';
        sysPane.appendChild(spDesc);

        buildEditField(sysPane, {
          initialContent: data.system_prompt || '',
          limit: 65536,
          placeholder: 'e.g. You are a code reviewer. Focus on security issues…',
          onSave: async (val) => {
            try {
              const rr = await fetch(`/api/rooms/${room.id}/system-prompt`, { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ system_prompt: val }) });
              if (rr.ok) { showToast('System prompt saved'); return true; }
              const e = await rr.json().catch(() => ({})); showToast(e.error || 'Failed to save', { error:true }); return false;
            } catch { showToast('Failed to save', { error:true }); return false; }
          },
        });

        // ── Max active threads ──
        const matSection = document.createElement('div');
        matSection.style.cssText = 'margin-top:18px;padding-top:14px;border-top:1px solid var(--h-border)';

        const matLabel = document.createElement('div');
        matLabel.style.cssText = 'font-size:12.5px;font-weight:500;margin-bottom:6px';
        matLabel.textContent = 'Max active threads';
        matSection.appendChild(matLabel);

        const matRow = document.createElement('div');
        matRow.style.cssText = 'display:flex;gap:8px;align-items:center';

        const matInput = document.createElement('input');
        matInput.type = 'number';
        matInput.min = '1';
        matInput.max = '20';
        matInput.step = '1';
        matInput.value = data.max_active_threads != null ? data.max_active_threads : 3;
        matInput.style.cssText = 'width:64px;padding:4px 8px;border:1px solid var(--h-border);border-radius:6px;background:var(--h-bg);color:var(--h-ink);font-size:13px';
        matRow.appendChild(matInput);

        const matSaveBtn = document.createElement('button');
        matSaveBtn.textContent = 'Save';
        matSaveBtn.style.cssText = 'padding:4px 12px;font-size:12.5px;border-radius:6px;border:1px solid var(--h-border);background:var(--h-bg);color:var(--h-ink);cursor:pointer';
        matRow.appendChild(matSaveBtn);
        matSection.appendChild(matRow);

        const matDesc = document.createElement('div');
        matDesc.style.cssText = 'font-size:11.5px;color:var(--h-ink-faint);margin-top:7px;line-height:1.5';
        matDesc.textContent = 'How many threads the agent may work on at once. While the limit is reached, a message that would open a new thread is not processed.';
        matSection.appendChild(matDesc);

        matSaveBtn.addEventListener('click', async () => {
          const raw = matInput.value.trim();
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 1 || n > 20 || raw === '') {
            showToast('Max active threads must be a whole number from 1 to 20', { error: true }); return;
          }
          try {
            const rr = await fetch(`/api/rooms/${room.id}/system-prompt`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ max_active_threads: n }) });
            if (rr.ok) { showToast('Max active threads saved'); return; }
            const e = await rr.json().catch(() => ({})); showToast(e.error || 'Failed to save', { error: true });
          } catch { showToast('Failed to save', { error: true }); }
        });

        sysPane.appendChild(matSection);
      } catch { sysPane.innerHTML = '<div style="font-size:12.5px;color:var(--h-red)">failed to load</div>'; }
    })();
  }
}

function closeRsbPopover() {
  if (_rsbOutsideListener) { document.removeEventListener('click', _rsbOutsideListener); _rsbOutsideListener = null; }
  if (_rsbPopover) { _rsbPopover.remove(); _rsbPopover = null; }
  if (_rsbActiveBtn) { _rsbActiveBtn.classList.remove('active'); _rsbActiveBtn = null; }
}
