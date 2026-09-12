// ── Room sidebar ────────────────────────────────────────────────────────────
// Icon strip on the right edge: Search, Download, Workspace, and per-room
// settings (Model Tier, Budget, Display, Schedules, Memory) via popovers.

let _rsbActiveBtn = null;
let _rsbPopover = null;

function renderRoomSidebar(room, participants) {
  const sidebar = document.getElementById('room-sidebar');
  if (!sidebar) return;
  sidebar.innerHTML = '';

  function mkBtn(title, svg, onClick) {
    const b = document.createElement('button');
    b.className = 'h-rsb-btn';
    b.title = title;
    b.innerHTML = svg;
    b.onclick = onClick;
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

    // Clamp vertically
    requestAnimationFrame(() => {
      const popH = pop.offsetHeight;
      let top = btnRect.top;
      if (top + popH > window.innerHeight - 12) top = window.innerHeight - popH - 12;
      if (top < 8) top = 8;
      pop.style.top = top + 'px';
    });

    setTimeout(() => {
      document.addEventListener('click', function outside(e) {
        if (_rsbPopover && !_rsbPopover.contains(e.target) && e.target !== anchorBtn) {
          closeRsbPopover();
          document.removeEventListener('click', outside);
        }
      });
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
  };

  const SA_MODELS = [
    'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1',
    'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
    'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5',
  ];
  const DEFAULTS = {
    quick:    ['claude-haiku-4-5'],
    standard: ['claude-sonnet-5', 'claude-haiku-4-5'],
    deep:     ['claude-opus-5', 'claude-sonnet-5'],
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
  const schedBtn = mkBtn('Scheduled Triggers', ICONS.clock, () => openPopover(schedBtn, buildSchedulePanel));
  sidebar.appendChild(schedBtn);

  // ── Memory
  const memBtn = mkBtn('Memory', ICONS.brain, () => openPopover(memBtn, buildMemoryPanel));
  sidebar.appendChild(memBtn);

  // ────────────────────────────────────────────────────────── Panel builders

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
      const paintTog = () => { ptog.textContent = paused ? 'paused' : 'active'; ptog.style.cssText = `background:transparent;border:1px solid var(--h-border);border-radius:999px;padding:5px 14px;cursor:pointer;font-family:var(--h-sans);font-size:12.5px;color:${paused ? '#b35a4b' : 'var(--h-ink-mute)'}`; };
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

  function buildSchedulePanel(pop) {
    pop.appendChild(popTitle('Scheduled triggers'));
    const body = document.createElement('div');
    pop.appendChild(body);

    let schedules = [], scheduleDiagnoses = {}, linkedSubs = [], schedFormOpen = false, schedEditId = null;
    let formType = 'interval', formEvery = 30, formAt = '07:00';
    let formTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta';
    let formSubId = '', formTask = '', formEnabled = true;

    async function load() {
      try {
        const [sc, sa, doc] = await Promise.all([
          fjson(`/api/rooms/${room.id}/sub-agent-schedules`),
          fjson(`/api/rooms/${room.id}/sub-agents`),
          fjson(`/api/rooms/${room.id}/sub-agent-schedules/doctor`).catch(() => ({ diagnoses: [] })),
        ]);
        schedules = sc.schedules || [];
        scheduleDiagnoses = Object.fromEntries((doc.diagnoses || []).map(d => [d.schedule_id, d]));
        linkedSubs = sa.linked || [];
        formSubId = linkedSubs[0]?.id ?? '';
        renderSchedule();
      } catch { body.innerHTML = '<div style="font-size:12.5px;color:#b35a4b">failed to load</div>'; }
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
      renderSchedule();
    }

    function openForm(editId) {
      schedFormOpen = true; schedEditId = editId;
      const ed = editId ? schedules.find(s => s.id === editId) : null;
      if (ed) {
        formType = ed.schedule_spec?.type || 'interval';
        formEvery = ed.schedule_spec?.every_minutes || 30;
        formAt = ed.schedule_spec?.at || '07:00';
        formTz = ed.schedule_spec?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta';
        formSubId = ed.sub_agent_id || (linkedSubs[0]?.id ?? '');
        formTask = ed.task || ''; formEnabled = !!ed.enabled;
      } else {
        formType = 'interval'; formEvery = 30; formAt = '07:00';
        formTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta';
        formSubId = linkedSubs[0]?.id ?? ''; formTask = ''; formEnabled = true;
      }
      renderSchedule();
    }

    function fmtCadence(spec) {
      if (!spec) return '?';
      if (spec.type === 'daily') { const tz = spec.tz || 'UTC'; return `daily at ${spec.at} ${tz === 'Asia/Jakarta' ? 'WIB' : tz.split('/').pop()}`; }
      const m = spec.every_minutes; return m >= 120 && m % 60 === 0 ? `every ${m / 60} h` : `every ${m} min`;
    }
    function fmtNextRun(iso) {
      if (!iso) return 'paused';
      const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
      return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false }) + ' ' + d.toLocaleDateString([], { month:'short', day:'numeric' });
    }

    function renderSchedule() {
      body.innerHTML = '';
      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px';
      const count = schedules.filter(s => s.enabled).length;
      const sub = document.createElement('span');
      sub.style.cssText = 'font-size:12px;color:var(--h-ink-faint)';
      sub.textContent = count ? `${count} active` : '';
      const addBtn = document.createElement('button');
      addBtn.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:3px 10px;cursor:pointer';
      addBtn.textContent = '+ add';
      addBtn.onclick = () => openForm(null);
      hdr.append(sub, addBtn); body.appendChild(hdr);

      if (schedFormOpen) body.appendChild(renderScheduleForm());

      if (!schedules.length && !schedFormOpen) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:16px 0;text-align:center;font-size:13px;color:var(--h-ink-mute);font-style:italic';
        empty.textContent = 'no scheduled triggers yet';
        body.appendChild(empty); return;
      }

      schedules.forEach((sched, i) => {
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:8px;padding:9px 0;${i < schedules.length - 1 ? 'border-bottom:1px solid var(--h-border)' : ''}${!sched.enabled ? ';opacity:.55' : ''}`;
        const seal = document.createElement('span');
        seal.style.cssText = 'width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-family:var(--h-serif);font-style:italic;font-size:12px;color:var(--h-ink);background:var(--h-surface);border:1px solid var(--h-border);flex:0 0 auto';
        seal.textContent = (sched.sub_agent_label || '?')[0];
        const info = document.createElement('div'); info.style.cssText = 'flex:1;min-width:0';
        const top = document.createElement('div'); top.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap';
        const lbl = document.createElement('span'); lbl.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--h-ink)'; lbl.textContent = sched.sub_agent_label || '?';
        const cad = document.createElement('span'); cad.style.cssText = 'font-size:10.5px;color:var(--h-ink-mute);padding:1px 6px;border-radius:999px;border:1px solid var(--h-border)'; cad.textContent = fmtCadence(sched.schedule_spec);
        const diag = scheduleDiagnoses[sched.id];
        if (diag && diag.status !== 'ok') { const badge = document.createElement('span'); badge.style.cssText = `font-size:9.5px;padding:1px 6px;border-radius:999px;background:${diag.status === 'overdue' ? '#d97706' : '#b35a4b'};color:#fff;font-weight:600`; badge.textContent = diag.status; badge.title = diag.details || ''; top.appendChild(badge); }
        top.append(lbl, cad);
        const task = document.createElement('div'); task.style.cssText = 'font-size:11.5px;color:var(--h-ink-faint);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px'; task.textContent = sched.task;
        info.append(top, task);
        const ctrl = document.createElement('div'); ctrl.style.cssText = 'display:flex;align-items:center;gap:3px;flex:0 0 auto';
        const tog = document.createElement('button');
        tog.style.cssText = `background:transparent;border:1px solid var(--h-border);border-radius:999px;padding:2px 8px;cursor:pointer;font-family:var(--h-sans);font-size:11px;color:${sched.enabled ? 'var(--h-ink-mute)' : '#b35a4b'}`;
        tog.textContent = sched.enabled ? 'on' : 'off';
        tog.onclick = async () => { try { await fetch(`/api/rooms/${room.id}/sub-agent-schedules/${sched.id}`, { method:'PATCH', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ enabled: !sched.enabled }) }); reloadSchedules(); } catch { showToast('Failed', { error:true }); } };
        const editBtn = document.createElement('button'); editBtn.style.cssText = 'background:transparent;border:none;color:var(--h-ink-faint);cursor:pointer;font-size:13px;padding:2px 4px'; editBtn.textContent = '✎'; editBtn.title = 'edit'; editBtn.onclick = () => openForm(sched.id);
        const delBtn = document.createElement('button'); delBtn.style.cssText = 'background:transparent;border:none;color:var(--h-ink-faint);cursor:pointer;font-size:13px;padding:2px 4px'; delBtn.textContent = '×'; delBtn.title = 'delete';
        delBtn.onclick = async () => { if (!confirm(`Delete schedule for "${sched.sub_agent_label}"?`)) return; try { await fetch(`/api/rooms/${room.id}/sub-agent-schedules/${sched.id}`, { method:'DELETE' }); reloadSchedules(); } catch { showToast('Failed', { error:true }); } };
        ctrl.append(tog, editBtn, delBtn);
        row.append(seal, info, ctrl); body.appendChild(row);
      });
    }

    function renderScheduleForm() {
      const editing = schedEditId ? schedules.find(s => s.id === schedEditId) : null;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'padding:12px 14px;border:1px solid var(--h-border);border-radius:10px;margin-bottom:12px;background:color-mix(in srgb,var(--h-bg) 30%,var(--h-surface))';
      const ftitle = document.createElement('div'); ftitle.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px';
      const ft = document.createElement('span'); ft.style.cssText = 'font-family:var(--h-serif);font-style:italic;font-size:14px;color:var(--h-ink)'; ft.textContent = editing ? 'edit schedule' : 'new schedule';
      const fx = document.createElement('button'); fx.style.cssText = 'background:transparent;border:none;color:var(--h-ink-faint);cursor:pointer;font-size:16px'; fx.textContent = '×';
      fx.onclick = () => { schedFormOpen = false; schedEditId = null; renderSchedule(); };
      ftitle.append(ft, fx); wrap.appendChild(ftitle);

      const mkField = (label) => { const f = document.createElement('div'); f.style.cssText = 'margin-bottom:10px'; const l = document.createElement('div'); l.style.cssText = 'font-size:11px;color:var(--h-ink-mute);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px'; l.textContent = label; f.appendChild(l); return f; };

      const subField = mkField('sub-agent');
      const subSel = document.createElement('select');
      subSel.style.cssText = 'width:100%;padding:6px 8px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);font-family:ui-monospace,Menlo,monospace;font-size:12px';
      if (!linkedSubs.length) { const o = document.createElement('option'); o.textContent = 'no sub-agents linked'; o.disabled = true; subSel.appendChild(o); }
      else { for (const sa of linkedSubs) { const o = document.createElement('option'); o.value = sa.id; o.textContent = `${sa.parent_name} (${sa.label})`; if (sa.id === formSubId) o.selected = true; subSel.appendChild(o); } }
      subSel.onchange = () => { formSubId = parseInt(subSel.value); };
      subField.appendChild(subSel); wrap.appendChild(subField);

      const typeField = mkField('type');
      const typeRow = document.createElement('div'); typeRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px';
      ['interval', 'daily'].forEach(tid => {
        const on = tid === formType;
        const b = document.createElement('button');
        b.style.cssText = `padding:6px 8px;border-radius:8px;cursor:pointer;border:1px solid ${on ? 'var(--h-ink)' : 'var(--h-border)'};background:${on ? 'var(--h-surface)' : 'transparent'};font-family:var(--h-sans);font-size:11.5px;color:${on ? 'var(--h-ink)' : 'var(--h-ink-mute)'}`;
        b.textContent = tid;
        b.onclick = () => { formType = tid; renderSchedule(); };
        typeRow.appendChild(b);
      });
      typeField.appendChild(typeRow); wrap.appendChild(typeField);

      if (formType === 'interval') {
        const cad = mkField('interval (minutes)');
        const row2 = document.createElement('div'); row2.style.cssText = 'display:flex;align-items:center;gap:8px';
        row2.appendChild(makeStepper(formEvery, 5, 1440, v => { formEvery = v; }));
        cad.appendChild(row2); wrap.appendChild(cad);
      } else {
        const tzShort = formTz === 'Asia/Jakarta' ? 'WIB' : formTz.split('/').pop();
        const tf = mkField(`time (24h · ${tzShort})`);
        const ti = document.createElement('input'); ti.type = 'time'; ti.value = formAt;
        ti.style.cssText = 'padding:6px 8px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);font-family:ui-monospace,Menlo,monospace;font-size:12px';
        ti.onchange = () => { formAt = ti.value; };
        tf.appendChild(ti); wrap.appendChild(tf);
      }

      const taskF = mkField('task');
      const ta = document.createElement('textarea');
      ta.style.cssText = 'width:100%;min-height:52px;padding:6px 8px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);font-family:var(--h-sans);font-size:12px;resize:vertical;box-sizing:border-box';
      ta.value = formTask; ta.placeholder = 'Check deployment health…'; ta.oninput = () => { formTask = ta.value; };
      taskF.appendChild(ta); wrap.appendChild(taskF);

      const btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:8px';
      const saveBtn = document.createElement('button'); saveBtn.className = 'h-btn-primary'; saveBtn.style.cssText = 'padding:5px 14px;font-size:12px'; saveBtn.textContent = editing ? 'save' : 'create';
      saveBtn.onclick = async () => {
        const spec = formType === 'interval' ? { type:'interval', every_minutes:formEvery } : { type:'daily', at:formAt, tz:formTz };
        const payload = { task: formTask, schedule_spec: spec, enabled: formEnabled };
        if (!editing) payload.sub_agent_id = formSubId;
        saveBtn.disabled = true;
        try {
          const url = editing ? `/api/rooms/${room.id}/sub-agent-schedules/${editing.id}` : `/api/rooms/${room.id}/sub-agent-schedules`;
          const r = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
          if (!r.ok) { const e = await r.json().catch(() => ({})); showToast(e.error || 'Failed', { error:true }); saveBtn.disabled = false; return; }
          schedFormOpen = false; schedEditId = null; reloadSchedules();
        } catch { showToast('Failed', { error:true }); saveBtn.disabled = false; }
      };
      const cancelBtn = document.createElement('button'); cancelBtn.style.cssText = 'background:transparent;border:none;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:5px 8px;cursor:pointer'; cancelBtn.textContent = 'cancel';
      cancelBtn.onclick = () => { schedFormOpen = false; schedEditId = null; renderSchedule(); };
      btns.append(saveBtn, cancelBtn); wrap.appendChild(btns);
      return wrap;
    }

    body.innerHTML = '<div style="font-size:12.5px;color:var(--h-ink-faint)">loading…</div>';
    load();
  }

  function buildMemoryPanel(pop) {
    pop.appendChild(popTitle('Memory'));
    pop.appendChild(Object.assign(document.createElement('div'), {
      style: 'font-size:12px;color:var(--h-ink-faint);margin-bottom:10px',
      textContent: 'context injected into agent sessions in this room',
    }));
    const body = document.createElement('div');
    body.innerHTML = '<div style="font-size:12.5px;color:var(--h-ink-faint)">loading…</div>';
    pop.appendChild(body);

    (async () => {
      try {
        const r = await fetch(`/api/rooms/${room.id}/memory`);
        if (!r.ok) { body.innerHTML = '<div style="font-size:12.5px;color:#b35a4b">failed to load</div>'; return; }
        const data = await r.json();
        body.innerHTML = '';
        let memContent = data.content || '';
        const BUDGET = data.budget || 1800;

        if (data.pending_count > 0) {
          const banner = document.createElement('div');
          banner.style.cssText = 'background:color-mix(in srgb,oklch(80% .18 80) 18%,transparent);border:1px solid color-mix(in srgb,oklch(75% .18 80) 40%,transparent);border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:10px';
          const bannerTxt = document.createElement('span'); bannerTxt.style.cssText = 'font-size:12.5px;color:var(--h-ink)'; bannerTxt.textContent = `${data.pending_count} pending write${data.pending_count > 1 ? 's' : ''} from agents`;
          const reviewBtn = document.createElement('button'); reviewBtn.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:4px 12px;cursor:pointer;white-space:nowrap'; reviewBtn.textContent = 'review';
          let pendingOpen = false;
          const pendingList = document.createElement('div'); pendingList.style.display = 'none';
          reviewBtn.onclick = async () => {
            pendingOpen = !pendingOpen; reviewBtn.textContent = pendingOpen ? 'hide' : 'review';
            if (pendingOpen) {
              pendingList.style.display = 'block'; pendingList.innerHTML = '<span style="font-size:12px;color:var(--h-ink-mute)">loading…</span>';
              try {
                const pr = await fetch(`/api/rooms/${room.id}/memory/pending`); const pd = await pr.json();
                pendingList.innerHTML = '';
                (pd.writes || []).forEach(w => {
                  const wRow = document.createElement('div'); wRow.style.cssText = 'border:1px solid var(--h-border);border-radius:8px;padding:10px 12px;margin-bottom:8px';
                  const wMeta = document.createElement('div'); wMeta.style.cssText = 'font-size:11.5px;color:var(--h-ink-faint);margin-bottom:6px'; const wd = new Date(w.proposed_at + 'Z'); wMeta.textContent = `${w.actor_name} · ${wd.toLocaleString()}`;
                  const wPre = document.createElement('pre'); wPre.style.cssText = 'font-size:12px;color:var(--h-ink);white-space:pre-wrap;word-break:break-word;margin:0 0 8px'; wPre.textContent = w.proposed_content;
                  const wBtns = document.createElement('div'); wBtns.style.cssText = 'display:flex;gap:6px';
                  const appr = document.createElement('button'); appr.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:3px 12px;cursor:pointer'; appr.textContent = 'approve';
                  appr.onclick = async () => { appr.disabled = true; const rr = await fetch(`/api/rooms/${room.id}/memory/pending/${w.id}/approve`, { method:'POST' }); if (rr.ok) { wRow.style.opacity = '.4'; memContent = w.proposed_content; memTa.value = memContent; updateMemCounter(); showToast('Write approved'); } else showToast('Failed to approve', { error:true }); };
                  const rej = document.createElement('button'); rej.style.cssText = 'background:transparent;border:none;color:var(--h-ink-faint);font-family:var(--h-sans);font-size:12px;padding:3px 8px;cursor:pointer'; rej.textContent = 'reject';
                  rej.onclick = async () => { rej.disabled = true; const rr = await fetch(`/api/rooms/${room.id}/memory/pending/${w.id}/reject`, { method:'POST' }); if (rr.ok) { wRow.style.opacity = '.4'; showToast('Write rejected'); } else showToast('Failed to reject', { error:true }); };
                  wBtns.append(appr, rej); wRow.append(wMeta, wPre, wBtns); pendingList.appendChild(wRow);
                });
              } catch { pendingList.innerHTML = '<span style="font-size:12px;color:var(--h-ink-mute)">failed to load</span>'; }
            } else { pendingList.style.display = 'none'; }
          };
          banner.append(bannerTxt, reviewBtn); body.appendChild(banner); body.appendChild(pendingList);
        }

        const memTa = document.createElement('textarea');
        memTa.value = memContent; memTa.placeholder = 'Write context injected into every session in this room…'; memTa.maxLength = BUDGET;
        memTa.style.cssText = 'width:100%;box-sizing:border-box;min-height:90px;resize:vertical;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;padding:8px 10px;border:1px solid var(--h-border);border-radius:8px;background:var(--h-surface);color:var(--h-ink);outline:none;margin-top:2px';
        const memFooter = document.createElement('div'); memFooter.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:6px';
        const memCounter = document.createElement('span'); memCounter.style.cssText = 'font-size:11.5px;color:var(--h-ink-faint);font-variant-numeric:tabular-nums';
        const updateMemCounter = () => { const used = memTa.value.length; const pct = used / BUDGET; memCounter.textContent = `${used} / ${BUDGET}`; memCounter.style.color = pct > .9 ? 'oklch(55% .18 27)' : pct > .75 ? 'oklch(60% .15 80)' : 'var(--h-ink-faint)'; };
        updateMemCounter(); memTa.addEventListener('input', updateMemCounter);
        const memSave = document.createElement('button'); memSave.style.cssText = 'background:transparent;border:1px solid var(--h-border);border-radius:999px;color:var(--h-ink-mute);font-family:var(--h-sans);font-size:12px;padding:4px 14px;cursor:pointer'; memSave.textContent = 'save';
        memSave.onclick = async () => {
          memSave.disabled = true;
          try { const rr = await fetch(`/api/rooms/${room.id}/memory`, { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ content: memTa.value }) }); if (rr.ok) showToast('Memory saved'); else { const e = await rr.json().catch(() => ({})); showToast(e.error || 'Failed to save', { error:true }); } }
          catch { showToast('Failed to save', { error:true }); }
          memSave.disabled = false;
        };
        memFooter.append(memCounter, memSave); body.append(memTa, memFooter);
      } catch { body.innerHTML = '<div style="font-size:12.5px;color:#b35a4b">failed to load</div>'; }
    })();
  }
}

function closeRsbPopover() {
  if (_rsbPopover) { _rsbPopover.remove(); _rsbPopover = null; }
  if (_rsbActiveBtn) { _rsbActiveBtn.classList.remove('active'); _rsbActiveBtn = null; }
}
