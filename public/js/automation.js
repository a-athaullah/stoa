// automation.js — Settings automation tab (Stoa)
// Requires: fjson, showToast, svgPencil, svgX, svgSpinnerTiny from settings.js / core.js

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function autoRelTime(ts) {
  const diff = (Date.now() - new Date(ts + 'Z').getTime()) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

function autoSvgTrash(sz = 14) {
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h11M5.5 4.5V3h5v1.5"/><rect x="3.5" y="4.5" width="9" height="9" rx="1.5"/><path d="M6.5 7.5v3M9.5 7.5v3"/></svg>`;
}

function autoShowErr(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = msg ? '' : 'none'; }
}

// ── State ─────────────────────────────────────────────────────────────────────
const AUTO_VARS = [
  '{{slack_message_text}}',
  '{{slack_message_link}}',
  '{{slack_thread_ts}}',
  '{{slack_user}}',
  '{{slack_channel}}',
  '{{extracted_url}}',
];

let autoState = {
  loaded: false,
  connections: [],          // from GET /api/automations/connections
  automations: [],          // from GET /api/automations
  rooms: [],                // from GET /api/rooms
  // Connection form
  connFormOpen: false,
  connFormMode: 'new',      // 'new' | 'edit'
  editingConnId: null,
  connFormLoading: false,
  connFormError: null,
  connForm: {
    name: '',
    provider: 'slack',
    tokenType: 'bot',       // 'bot' | 'user'
    appToken: '',
    token: '',
  },
  // Connection confirm
  connConfirmId: null,
  connConfirmAction: null,  // 'disconnect' | 'delete'
  // Automation form
  confirmDeleteId: null,
  formOpen: false,
  formMode: 'new',          // 'new' | 'edit'
  editingId: null,
  form: {
    name: '',
    triggerEvent: 'mention',
    connectionId: '',
    conditions: [],
    targetRoomId: '',
    promptTemplate: '',
  },
};

// ── Load ──────────────────────────────────────────────────────────────────────
async function sLoadAutomationTab() {
  if (!autoState.loaded) {
    try {
      const [connsRes, autosRes, roomsRes] = await Promise.all([
        fjson('/api/automations/connections'),
        fjson('/api/automations'),
        fjson('/api/rooms'),
      ]);
      autoState.connections = connsRes;
      autoState.automations = autosRes;
      autoState.rooms = roomsRes;
      autoState.loaded = true;
    } catch {
      showToast('Failed to load automation settings', { error: true });
    }
  }
  autoRender();
}

// ── Render ────────────────────────────────────────────────────────────────────
function autoRender() {
  const el = document.getElementById('s-tab-automation');
  if (!el) return;

  el.innerHTML = `
    <div class="s-content-inner">
      <div class="auto-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <span class="auto-section-label">connections</span>
          ${!autoState.connFormOpen ? `
            <button class="auto-pill-btn auto-add-conn-btn" style="display:inline-flex;align-items:center;gap:6px;padding:5px 11px 5px 9px;font-size:12.5px">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
              add connection
            </button>
          ` : ''}
        </div>
        ${autoRenderConnectionsSection()}
      </div>
      <div class="auto-section" style="margin-top:28px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <span class="auto-section-label">${autoState.formOpen ? (autoState.formMode === 'edit' ? 'edit automation' : 'new automation') : 'automations'}</span>
          ${!autoState.formOpen ? `
            <button class="auto-pill-btn auto-add-btn" style="display:inline-flex;align-items:center;gap:6px;padding:5px 11px 5px 9px;font-size:12.5px">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
              add new
            </button>
          ` : ''}
        </div>
        ${autoState.formOpen ? autoRenderForm() : autoRenderAutomationsCard()}
      </div>
    </div>
  `;

  autoBindEvents(el);
}

// ── Connections section ───────────────────────────────────────────────────────
function autoRenderConnectionsSection() {
  const parts = [];

  if (autoState.connections.length === 0 && !autoState.connFormOpen) {
    parts.push(`
      <div class="auto-card" style="padding:36px 24px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">
        <svg width="28" height="28" viewBox="0 0 16 16" fill="none" stroke="var(--h-ink-faint)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="5" r="2.5"/><circle cx="11" cy="11" r="2.5"/><path d="M7.5 5h1.5a2 2 0 012 2v1.5"/><path d="M8.5 11H7A2 2 0 015 9V7.5"/></svg>
        <span style="font-family:var(--h-serif);font-size:16px;color:var(--h-ink-mute)">No connections yet</span>
        <span style="font-family:var(--h-sans);font-size:13px;color:var(--h-ink-faint);max-width:360px;line-height:1.55">Add a connection to start receiving events from Slack or other services.</span>
        <button class="auto-pill-btn auto-add-conn-btn" style="margin-top:6px;display:inline-flex;align-items:center;gap:6px;padding:6px 13px 6px 11px;font-size:13px">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
          add connection
        </button>
      </div>
    `);
  } else {
    autoState.connections.forEach(conn => {
      parts.push(autoRenderConnectionCard(conn));
    });
  }

  if (autoState.connFormOpen) {
    parts.push(autoRenderConnectionForm());
  }

  return parts.join('');
}

function autoRenderConnectionCard(conn) {
  const isConnected = conn.status === 'connected';
  const isError = conn.status === 'error';
  const isDisconnected = conn.status === 'disconnected';
  const meta = conn.metadata || {};
  const botName = meta.botName || '';
  const workspaceName = meta.workspaceName || '';
  const tokenTypeLabel = conn.token_type === 'user' ? 'user' : 'bot';

  const dotStyle = isConnected
    ? 'background:#7fb98c;box-shadow:0 0 0 3px color-mix(in srgb,#7fb98c 22%,transparent)'
    : isError
    ? 'background:#b35a4b'
    : 'background:transparent;border:1.5px solid var(--h-ink-faint)';

  const statusLabel = isConnected ? 'connected' : isError ? 'error' : 'disconnected';
  const statusColor = isConnected ? '#7fb98c' : isError ? '#b35a4b' : 'var(--h-ink-faint)';

  const isConfirm = autoState.connConfirmId === conn.id;

  let actions = '';
  if (isConfirm) {
    const action = autoState.connConfirmAction;
    const confirmLabel = action === 'disconnect' ? `Disconnect @${escHtml(botName || conn.name)}?` : `Delete @${escHtml(botName || conn.name)}?`;
    const okLabel = action === 'disconnect' ? 'Disconnect' : 'Delete';
    actions = `
      <div style="display:flex;align-items:center;gap:8px;margin-left:auto">
        <span style="font-family:var(--h-sans);font-size:12.5px;color:var(--h-ink-mute)">${confirmLabel}</span>
        <button class="auto-small-btn auto-conn-confirm-cancel-btn">Cancel</button>
        <button class="auto-small-btn auto-conn-confirm-ok-btn" data-id="${conn.id}" data-action="${action}" style="color:#b35a4b;border-color:#b35a4b">${okLabel}</button>
      </div>
    `;
  } else {
    const btns = [];
    btns.push(`<button class="auto-small-btn auto-conn-edit-btn" data-id="${conn.id}">${svgPencil(13)} Edit</button>`);
    if (isConnected) {
      btns.push(`<button class="auto-small-btn auto-conn-disconnect-btn" data-id="${conn.id}" style="color:#b35a4b;border-color:color-mix(in srgb,#b35a4b 40%,transparent)">Disconnect</button>`);
    } else if (isDisconnected) {
      btns.push(`<button class="auto-small-btn auto-conn-reconnect-btn" data-id="${conn.id}">Reconnect</button>`);
      btns.push(`<button class="auto-small-btn auto-conn-delete-btn" data-id="${conn.id}" style="color:#b35a4b;border-color:color-mix(in srgb,#b35a4b 40%,transparent)">Delete</button>`);
    } else if (isError) {
      btns.push(`<button class="auto-small-btn auto-conn-retry-btn" data-id="${conn.id}" style="color:#b35a4b;border-color:color-mix(in srgb,#b35a4b 40%,transparent)">Retry</button>`);
      btns.push(`<button class="auto-small-btn auto-conn-delete-btn" data-id="${conn.id}" style="color:#b35a4b;border-color:color-mix(in srgb,#b35a4b 40%,transparent)">Delete</button>`);
    }
    actions = `<div class="auto-row-actions" style="display:flex;gap:6px;opacity:0;transition:opacity .12s;margin-left:auto">${btns.join('')}</div>`;
  }

  const subline = [
    botName ? `@${escHtml(botName)}` : null,
    `${tokenTypeLabel} token`,
    workspaceName ? `Workspace: ${escHtml(workspaceName)}` : null,
  ].filter(Boolean).join(' · ');

  return `
    <div class="auto-card" style="margin-bottom:8px" data-conn-id="${conn.id}">
      <div class="auto-conn-row" style="display:flex;align-items:center;gap:12px;padding:12px 16px;${isError ? 'border-bottom:1px solid var(--h-hair-soft)' : ''}">
        <span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;display:inline-block;${dotStyle}"></span>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
          <div style="display:flex;align-items:baseline;gap:10px">
            <span style="font-family:var(--h-serif);font-size:15px;color:var(--h-ink)">${escHtml(conn.name)}</span>
            <span style="font-family:var(--h-sans);font-size:12px;color:${statusColor};margin-left:auto">${statusLabel}</span>
          </div>
          ${subline ? `<span style="font-family:var(--h-sans);font-size:12px;color:var(--h-ink-faint)">${subline}</span>` : ''}
        </div>
        ${actions}
      </div>
      ${isError && conn.error_msg ? `
        <div style="padding:8px 16px 10px;background:color-mix(in srgb,#b35a4b 6%,var(--h-surface))">
          <span style="font-family:var(--h-sans);font-size:12.5px;color:#b35a4b">${escHtml(conn.error_msg)}</span>
        </div>
      ` : ''}
    </div>
  `;
}

function autoRenderConnectionForm() {
  const f = autoState.connForm;
  const isEdit = autoState.connFormMode === 'edit';
  const isBotToken = f.tokenType !== 'user';

  const tokenLabel = isBotToken ? 'Bot Token' : 'User Token';
  const tokenPlaceholder = isBotToken ? 'xoxb-...' : 'xoxp-...';

  const editingConn = isEdit ? autoState.connections.find(c => c.id === autoState.editingConnId) : null;
  const editNeedsConnect = isEdit && editingConn && editingConn.status !== 'connected';
  const saveBtnLabel = isEdit ? (editNeedsConnect ? 'Save & Connect' : 'Save') : 'Connect';
  const connectBtn = autoState.connFormLoading
    ? `<button class="auto-save-btn" id="auto-conn-save-btn" disabled style="display:inline-flex;align-items:center;gap:7px">${svgSpinnerTiny()} ${editNeedsConnect ? 'Connecting…' : isEdit ? 'Saving…' : 'Connecting…'}</button>`
    : `<button class="auto-save-btn" id="auto-conn-save-btn">${saveBtnLabel}</button>`;

  return `
    <div class="auto-card" style="margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--h-hair-soft);background:color-mix(in srgb,var(--h-surface) 70%,var(--h-bg))">
        <span style="font-family:var(--h-serif);font-style:italic;font-size:16px;color:var(--h-ink)">${isEdit ? 'Edit Connection' : 'New Connection'}</span>
        <button class="s-icon-btn auto-conn-form-cancel-btn" title="Cancel">${svgX(13)}</button>
      </div>
      <div style="padding:18px 18px 20px;display:flex;flex-direction:column;gap:15px">

        <!-- Name -->
        <div style="display:flex;flex-direction:column;gap:5px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Name</span>
          <input class="auto-field-input" id="auto-conn-name" type="text" placeholder="e.g. Slack — Customer Support Bot" value="${escHtml(f.name)}" autocomplete="off">
        </div>

        <!-- Provider -->
        <div style="display:flex;flex-direction:column;gap:5px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Provider</span>
          <div class="auto-fake-select" style="pointer-events:none;opacity:.7;min-width:140px">Slack <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></div>
        </div>

        <!-- Token Type -->
        <div style="display:flex;flex-direction:column;gap:7px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Token Type</span>
          <div style="display:flex;gap:18px" id="auto-conn-token-type">
            <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-family:var(--h-sans);font-size:13px;color:var(--h-ink-mute)">
              <input type="radio" name="auto-conn-tt" value="user" ${f.tokenType === 'user' ? 'checked' : ''} style="accent-color:var(--h-accent)">
              User Token (xoxp-)
            </label>
            <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-family:var(--h-sans);font-size:13px;color:var(--h-ink-mute)">
              <input type="radio" name="auto-conn-tt" value="bot" ${f.tokenType !== 'user' ? 'checked' : ''} style="accent-color:var(--h-accent)">
              Bot Token (xoxb-)
            </label>
          </div>
        </div>

        <!-- App Token -->
        <div style="display:flex;flex-direction:column;gap:5px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">App Token (Socket Mode)</span>
          <input class="auto-token-input" id="auto-conn-app-token" type="password" placeholder="xapp-1-..." autocomplete="off" value="${escHtml(f.appToken)}">
        </div>

        <!-- Bot/User Token -->
        <div style="display:flex;flex-direction:column;gap:5px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">${tokenLabel}</span>
          <input class="auto-token-input" id="auto-conn-token" type="password" placeholder="${tokenPlaceholder}" autocomplete="off" value="${escHtml(f.token)}">
        </div>

        ${autoState.connFormError ? `
          <div style="font-family:var(--h-sans);font-size:12.5px;color:#b35a4b;padding:8px 12px;background:color-mix(in srgb,#b35a4b 8%,var(--h-surface));border-radius:6px;border:1px solid color-mix(in srgb,#b35a4b 25%,transparent)">
            ${escHtml(autoState.connFormError)}
          </div>
        ` : ''}

        <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:4px">
          <button class="auto-cancel-btn auto-conn-form-cancel-btn">Cancel</button>
          ${connectBtn}
        </div>
      </div>
    </div>
  `;
}

// ── Automations section ───────────────────────────────────────────────────────
function autoRenderAutomationsCard() {
  const rows = autoState.automations.map(a => autoRenderAutomationRow(a)).join('');

  return `
    <div class="auto-card">
      ${autoState.automations.length ? rows : autoRenderAutomationsEmpty()}
    </div>
  `;
}

function autoRenderAutomationsEmpty() {
  return `
    <div style="padding:40px 24px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">
      <svg width="30" height="30" viewBox="0 0 16 16" fill="none" stroke="var(--h-ink-faint)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2L4 9h4.5L7 14l5-7H8L9.5 2z"/></svg>
      <span style="font-family:var(--h-serif);font-size:17px;color:var(--h-ink-mute)">No automations yet</span>
      <span style="font-family:var(--h-sans);font-size:13px;color:var(--h-ink-faint);max-width:380px;line-height:1.55">
        Add a rule to let external events — like a Slack mention — trigger an AI agent automatically.
      </span>
    </div>
  `;
}

function autoRenderAutomationRow(auto) {
  const isEnabled = !!auto.enabled;
  const isConfirm = autoState.confirmDeleteId === auto.id;

  const dotStyle = isEnabled
    ? 'background:#7fb98c;box-shadow:0 0 0 3px color-mix(in srgb,#7fb98c 18%,transparent)'
    : 'background:transparent;border:1.5px solid var(--h-ink-faint)';
  const nameColor = isEnabled ? 'var(--h-ink)' : 'var(--h-ink-mute)';

  const triggerParts = [`Slack ${auto.trigger_event}`];
  try {
    JSON.parse(auto.trigger_conditions || '[]').forEach(c => {
      if (c.value) triggerParts.push(`"${escHtml(c.value)}"`);
    });
  } catch {}

  const room = autoState.rooms.find(r => r.id === auto.target_room_id);
  const roomName = room ? escHtml(room.title) : `Room ${auto.target_room_id}`;

  const lastRun = auto.last_run_at
    ? `Last run: ${autoRelTime(auto.last_run_at)} · Ran ${auto.run_count} time${auto.run_count !== 1 ? 's' : ''}`
    : 'Last run: Never';

  const toggleBg = isEnabled ? '#7fb98c' : 'var(--h-hairline)';
  const thumbLeft = isEnabled ? '18px' : '2px';

  if (isConfirm) {
    return `
      <div class="auto-row" data-id="${auto.id}" style="border-bottom:1px solid var(--h-hair-soft)">
        <div style="padding:12px 18px;display:flex;align-items:center;justify-content:space-between;background:color-mix(in srgb,#b35a4b 8%,var(--h-surface))">
          <span style="font-family:var(--h-sans);font-size:13px;color:var(--h-ink-mute)">Delete "${escHtml(auto.name)}"?</span>
          <div style="display:flex;gap:8px">
            <button class="auto-small-btn auto-cancel-delete-btn" data-id="${auto.id}">Cancel</button>
            <button class="auto-small-btn auto-confirm-delete-btn" data-id="${auto.id}" style="color:#b35a4b;border-color:#b35a4b">Delete</button>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="auto-row" data-id="${auto.id}" style="display:flex;gap:14px;padding:14px 18px;border-bottom:1px solid var(--h-hair-soft);align-items:flex-start">
      <span style="width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:7px;display:inline-block;${dotStyle}"></span>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
        <span style="font-family:var(--h-serif);font-size:16px;color:${nameColor}">${escHtml(auto.name)}</span>
        <span style="font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Trigger: ${triggerParts.join(' + ')}">Trigger: ${triggerParts.join(' + ')}</span>
        <span style="font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-faint)">Action: Send to room "${roomName}"</span>
        <span style="font-family:var(--h-sans);font-size:12px;color:var(--h-ink-faint);margin-top:1px">${lastRun}</span>
      </div>
      <div class="auto-row-controls" style="display:flex;align-items:center;gap:8px;margin-top:3px;flex-shrink:0">
        <span class="auto-toggle-btn" data-id="${auto.id}" data-enabled="${isEnabled ? '1' : '0'}" title="${isEnabled ? 'Disable' : 'Enable'}" style="width:36px;height:20px;border-radius:999px;position:relative;display:inline-block;cursor:pointer;background:${toggleBg};transition:background .15s;flex-shrink:0">
          <span style="position:absolute;top:2px;left:${thumbLeft};width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.2)"></span>
        </span>
        <div class="auto-row-actions" style="display:flex;gap:4px;opacity:0;transition:opacity .12s">
          <button class="s-icon-btn auto-edit-btn" data-id="${auto.id}" title="Edit">${svgPencil(14)}</button>
          <button class="s-icon-btn auto-delete-btn" data-id="${auto.id}" title="Delete" style="color:#b35a4b">${autoSvgTrash(14)}</button>
        </div>
      </div>
    </div>
  `;
}

// ── Automation Form ───────────────────────────────────────────────────────────
function autoRenderForm() {
  const f = autoState.form;
  const events = [
    { value: 'mention',  label: 'Mention' },
    { value: 'message',  label: 'Message in channel' },
    { value: 'reaction_added', label: 'Reaction added' },
  ];
  const condFields = f.triggerEvent === 'reaction_added'
    ? [
        { value: 'reaction',      label: 'reaction' },
        { value: 'slack_user',    label: 'slack_user' },
        { value: 'slack_channel', label: 'slack_channel' },
      ]
    : [
        { value: 'message_text',  label: 'message text' },
        { value: 'slack_user',    label: 'slack_user' },
        { value: 'slack_channel', label: 'slack_channel' },
      ];
  const condOps = [
    { value: 'contains',      label: 'contains' },
    { value: 'not_contains',  label: 'not contains' },
    { value: 'starts_with',   label: 'starts with' },
    { value: 'matches_regex', label: 'matches regex' },
  ];

  const condRows = f.conditions.map((c, i) => {
    const isLast = i === f.conditions.length - 1;
    return `
      <div class="auto-cond-row" data-idx="${i}" style="${isLast ? '' : 'border-bottom:1px solid var(--h-hair-soft);'}">
        <select class="auto-cond-sel auto-cond-field" data-idx="${i}" style="min-width:112px">
          ${condFields.map(f2 => `<option value="${f2.value}" ${c.field === f2.value ? 'selected' : ''}>${f2.label}</option>`).join('')}
        </select>
        <select class="auto-cond-sel auto-cond-op" data-idx="${i}" style="min-width:90px">
          ${condOps.map(o => `<option value="${o.value}" ${c.op === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        <input class="auto-cond-val" data-idx="${i}" type="text" value="${escHtml(c.value)}" placeholder="value…">
        <button class="auto-cond-remove" data-idx="${i}" title="Remove">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </div>
    `;
  }).join('');

  const condEmpty = f.conditions.length === 0
    ? `<div style="padding:12px;font-family:var(--h-sans);font-size:13px;color:var(--h-ink-faint);text-align:center">No conditions — any Slack event will match</div>`
    : '';

  const roomOptions = autoState.rooms
    .filter(r => !r.archived_at)
    .map(r => `<option value="${r.id}" ${String(f.targetRoomId) === String(r.id) ? 'selected' : ''}>${escHtml(r.title)}</option>`)
    .join('');

  const slackConns = autoState.connections.filter(c => c.provider === 'slack');
  let connField = '';
  if (slackConns.length === 0) {
    connField = `
      <div style="display:flex;flex-direction:column;gap:5px">
        <span style="font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute)">Connection</span>
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:color-mix(in srgb,#b35a4b 6%,var(--h-surface));border:1px solid color-mix(in srgb,#b35a4b 22%,transparent);border-radius:7px">
          <span style="font-family:var(--h-sans);font-size:13px;color:#b35a4b;flex:1">No Slack connections — add one first</span>
          <button class="auto-pill-btn auto-goto-add-conn-btn" style="font-size:12px;padding:4px 10px;white-space:nowrap">+ add connection</button>
        </div>
      </div>
    `;
  } else {
    // Auto-select if only one, or use existing selection
    const selectedId = f.connectionId || (slackConns.length === 1 ? String(slackConns[0].id) : '');
    const connOptions = slackConns.map(c => {
      const label = `${escHtml(c.name)} (${c.token_type})`;
      return `<option value="${c.id}" ${String(selectedId) === String(c.id) ? 'selected' : ''}>${escHtml(label)}</option>`;
    }).join('');
    connField = `
      <div style="display:flex;flex-direction:column;gap:5px">
        <span style="font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute)">Connection</span>
        <select class="auto-sel" id="auto-form-conn" style="min-width:200px">
          ${slackConns.length > 1 ? '<option value="">— select connection —</option>' : ''}
          ${connOptions}
        </select>
        <span class="auto-field-err" id="auto-err-conn"></span>
      </div>
    `;
  }

  return `
    <div class="auto-card">
      <div class="auto-card-header">
        <span style="font-family:var(--h-serif);font-style:italic;font-size:17px;color:var(--h-ink)">
          ${autoState.formMode === 'edit' ? 'Edit Automation' : 'New Automation'}
        </span>
        <button class="s-icon-btn auto-form-close-btn" title="Close">${svgX(14)}</button>
      </div>
      <div style="padding:20px 20px 22px;display:flex;flex-direction:column;gap:18px">

        <!-- Name -->
        <div style="display:flex;flex-direction:column;gap:5px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Name</span>
          <input class="auto-field-input" id="auto-form-name" type="text" placeholder="e.g. PR Review — Bitbucket" value="${escHtml(f.name)}" autocomplete="off">
          <span class="auto-field-err" id="auto-err-name"></span>
        </div>

        <!-- TRIGGER -->
        <div class="auto-form-divider"><span></span><span class="auto-section-label">trigger</span><span></span></div>

        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
          <div style="display:flex;flex-direction:column;gap:5px">
            <span style="font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute)">Integration</span>
            <div class="auto-fake-select" style="pointer-events:none;min-width:120px">Slack <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></div>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px">
            <span style="font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute)">Event</span>
            <select class="auto-sel" id="auto-form-event">
              ${events.map(e => `<option value="${e.value}" ${f.triggerEvent === e.value ? 'selected' : ''}>${e.label}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Connection -->
        ${connField}

        <!-- Conditions -->
        <div style="display:flex;flex-direction:column;gap:5px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">
              Conditions <span style="font-size:12px;color:var(--h-ink-faint)">(ALL must match)</span>
            </span>
            <button class="auto-small-btn auto-add-cond-btn" style="display:inline-flex;align-items:center;gap:5px">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
              add
            </button>
          </div>
          <div class="auto-conds-wrap" id="auto-conds">
            ${condRows}${condEmpty}
          </div>
        </div>

        <!-- ACTION -->
        <div class="auto-form-divider"><span></span><span class="auto-section-label">action</span><span></span></div>

        <!-- Room -->
        <div style="display:flex;flex-direction:column;gap:5px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Send message to room</span>
          <select class="auto-sel" id="auto-form-room" style="min-width:200px">
            <option value="">— select room —</option>
            ${roomOptions}
          </select>
          <span class="auto-field-err" id="auto-err-room"></span>
        </div>

        <!-- Prompt -->
        <div style="display:flex;flex-direction:column;gap:7px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Prompt</span>
          <textarea class="auto-prompt-ta" id="auto-form-prompt" rows="5" placeholder="Message to send to the room…">${escHtml(f.promptTemplate)}</textarea>
          <span class="auto-field-err" id="auto-err-prompt"></span>
          <div style="display:flex;flex-direction:column;gap:6px">
            <span style="font-family:var(--h-sans);font-size:12px;color:var(--h-ink-faint)">Available variables — click to insert at cursor:</span>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${AUTO_VARS.map(v => `<span class="auto-var-chip" data-var="${v}">${v}</span>`).join('')}
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:16px;border-top:1px solid var(--h-hair-soft)">
          <button class="auto-cancel-btn auto-form-cancel-btn">Cancel</button>
          <button class="auto-save-btn" id="auto-form-save-btn">Save Automation</button>
        </div>
      </div>
    </div>
  `;
}

// ── Event binding ─────────────────────────────────────────────────────────────
function autoBindEvents(container) {
  // ── Connection buttons ──
  container.querySelectorAll('.auto-add-conn-btn').forEach(btn => btn.addEventListener('click', () => {
    autoState.connFormOpen = true;
    autoState.connFormMode = 'new';
    autoState.editingConnId = null;
    autoState.connFormError = null;
    autoState.connForm = { name: '', provider: 'slack', tokenType: 'bot', appToken: '', token: '' };
    autoRender();
  }));

  container.querySelectorAll('.auto-conn-edit-btn').forEach(btn => btn.addEventListener('click', () => {
    const id = parseInt(btn.dataset.id);
    const conn = autoState.connections.find(c => c.id === id);
    if (!conn) return;
    autoState.connFormOpen = true;
    autoState.connFormMode = 'edit';
    autoState.editingConnId = id;
    autoState.connFormError = null;
    autoState.connForm = {
      name: conn.name,
      provider: conn.provider || 'slack',
      tokenType: conn.token_type || 'bot',
      appToken: '',
      token: '',
    };
    autoRender();
  }));

  container.querySelectorAll('.auto-conn-disconnect-btn').forEach(btn => btn.addEventListener('click', () => {
    autoState.connConfirmId = parseInt(btn.dataset.id);
    autoState.connConfirmAction = 'disconnect';
    autoRender();
  }));

  container.querySelectorAll('.auto-conn-delete-btn').forEach(btn => btn.addEventListener('click', () => {
    autoState.connConfirmId = parseInt(btn.dataset.id);
    autoState.connConfirmAction = 'delete';
    autoRender();
  }));

  container.querySelectorAll('.auto-conn-reconnect-btn').forEach(btn => btn.addEventListener('click', () => {
    autoDoConnReconnect(parseInt(btn.dataset.id));
  }));

  container.querySelectorAll('.auto-conn-retry-btn').forEach(btn => btn.addEventListener('click', () => {
    autoDoConnReconnect(parseInt(btn.dataset.id));
  }));

  container.querySelectorAll('.auto-conn-confirm-cancel-btn').forEach(btn => btn.addEventListener('click', () => {
    autoState.connConfirmId = null;
    autoState.connConfirmAction = null;
    autoRender();
  }));

  container.querySelectorAll('.auto-conn-confirm-ok-btn').forEach(btn => btn.addEventListener('click', () => {
    const id = parseInt(btn.dataset.id);
    const action = btn.dataset.action;
    if (action === 'disconnect') autoDoConnDisconnect(id);
    else if (action === 'delete') autoDoConnDelete(id);
  }));

  // Token type radio
  container.querySelectorAll('#auto-conn-token-type input[type=radio]').forEach(radio => {
    radio.addEventListener('change', () => {
      autoConnSyncForm();
      autoState.connForm.tokenType = radio.value;
      // Re-render just the form part — re-render full for simplicity
      autoRender();
    });
  });

  container.querySelectorAll('.auto-conn-form-cancel-btn').forEach(btn => btn.addEventListener('click', autoConnFormClose));

  container.querySelector('#auto-conn-save-btn')?.addEventListener('click', autoDoConnSave);

  // ── Automation row hover ──
  container.querySelectorAll('.auto-row').forEach(row => {
    const actions = row.querySelector('.auto-row-actions');
    if (!actions) return;
    row.addEventListener('mouseenter', () => { actions.style.opacity = '1'; });
    row.addEventListener('mouseleave', () => { actions.style.opacity = '0'; });
  });

  // Connection card hover
  container.querySelectorAll('.auto-card[data-conn-id]').forEach(card => {
    const actions = card.querySelector('.auto-row-actions');
    if (!actions) return;
    card.addEventListener('mouseenter', () => { actions.style.opacity = '1'; });
    card.addEventListener('mouseleave', () => { actions.style.opacity = '0'; });
  });

  // ── Toggle ──
  container.querySelectorAll('.auto-toggle-btn').forEach(btn => btn.addEventListener('click', async () => {
    const id = parseInt(btn.dataset.id);
    const enabled = btn.dataset.enabled === '1' ? 0 : 1;
    await autoDoToggle(id, enabled);
  }));

  // ── Edit automation ──
  container.querySelectorAll('.auto-edit-btn').forEach(btn => btn.addEventListener('click', () => {
    const id = parseInt(btn.dataset.id);
    const auto = autoState.automations.find(a => a.id === id);
    if (!auto) return;
    let conds = [];
    try { conds = JSON.parse(auto.trigger_conditions || '[]'); } catch {}
    autoState.formOpen = true;
    autoState.formMode = 'edit';
    autoState.editingId = id;
    autoState.form = {
      name: auto.name,
      triggerEvent: auto.trigger_event,
      connectionId: auto.connection_id ? String(auto.connection_id) : '',
      conditions: conds,
      targetRoomId: auto.target_room_id,
      promptTemplate: auto.prompt_template,
    };
    autoRender();
  }));

  // ── Delete automation ──
  container.querySelectorAll('.auto-delete-btn').forEach(btn => btn.addEventListener('click', () => {
    autoState.confirmDeleteId = parseInt(btn.dataset.id);
    autoRender();
  }));
  container.querySelectorAll('.auto-cancel-delete-btn').forEach(btn => btn.addEventListener('click', () => {
    autoState.confirmDeleteId = null;
    autoRender();
  }));
  container.querySelectorAll('.auto-confirm-delete-btn').forEach(btn => btn.addEventListener('click', async () => {
    await autoDoDelete(parseInt(btn.dataset.id));
  }));

  // ── Add automation ──
  container.querySelector('.auto-add-btn')?.addEventListener('click', () => {
    const slackConns = autoState.connections.filter(c => c.provider === 'slack');
    autoState.formOpen = true;
    autoState.formMode = 'new';
    autoState.editingId = null;
    autoState.form = {
      name: '',
      triggerEvent: 'mention',
      connectionId: slackConns.length === 1 ? String(slackConns[0].id) : '',
      conditions: [],
      targetRoomId: '',
      promptTemplate: '',
    };
    autoRender();
  });

  // ── Form close/cancel ──
  container.querySelector('.auto-form-close-btn')?.addEventListener('click', autoFormClose);
  container.querySelector('.auto-form-cancel-btn')?.addEventListener('click', autoFormClose);

  // ── Go to add connection from automation form ──
  container.querySelector('.auto-goto-add-conn-btn')?.addEventListener('click', () => {
    autoFormClose();
    autoState.connFormOpen = true;
    autoState.connFormMode = 'new';
    autoState.editingConnId = null;
    autoState.connFormError = null;
    autoState.connForm = { name: '', provider: 'slack', tokenType: 'bot', appToken: '', token: '' };
    autoRender();
    // Scroll to connections section
    const el = document.getElementById('s-tab-automation');
    if (el) el.scrollTop = 0;
  });

  // ── Add condition ──
  container.querySelector('.auto-add-cond-btn')?.addEventListener('click', () => {
    autoSyncForm();
    autoState.form.conditions.push({ field: 'message_text', op: 'contains', value: '' });
    autoRender();
  });

  // ── Remove condition ──
  container.querySelectorAll('.auto-cond-remove').forEach(btn => btn.addEventListener('click', () => {
    autoSyncForm();
    const idx = parseInt(btn.dataset.idx);
    autoState.form.conditions.splice(idx, 1);
    autoRender();
  }));

  // ── Variable chips ──
  container.querySelectorAll('.auto-var-chip').forEach(chip => chip.addEventListener('click', () => {
    const v = chip.dataset.var;
    const ta = document.getElementById('auto-form-prompt');
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + v + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + v.length;
    ta.focus();
    autoState.form.promptTemplate = ta.value;
  }));

  // ── Save automation ──
  container.querySelector('#auto-form-save-btn')?.addEventListener('click', autoDoFormSave);
}

// ── Form helpers ──────────────────────────────────────────────────────────────
function autoSyncForm() {
  const name   = document.getElementById('auto-form-name');
  const event  = document.getElementById('auto-form-event');
  const conn   = document.getElementById('auto-form-conn');
  const room   = document.getElementById('auto-form-room');
  const prompt = document.getElementById('auto-form-prompt');
  if (name)   autoState.form.name           = name.value;
  if (event)  autoState.form.triggerEvent   = event.value;
  if (conn)   autoState.form.connectionId   = conn.value;
  if (room)   autoState.form.targetRoomId   = room.value;
  if (prompt) autoState.form.promptTemplate = prompt.value;

  const cfs = document.querySelectorAll('.auto-cond-field');
  const cos = document.querySelectorAll('.auto-cond-op');
  const cvs = document.querySelectorAll('.auto-cond-val');
  autoState.form.conditions = autoState.form.conditions.map((c, i) => ({
    field: cfs[i]?.value || c.field,
    op:    cos[i]?.value || c.op,
    value: cvs[i]?.value ?? c.value,
  }));
}

function autoFormClose() {
  autoState.formOpen = false;
  autoState.editingId = null;
  autoRender();
}

function autoConnSyncForm() {
  const name     = document.getElementById('auto-conn-name');
  const appToken = document.getElementById('auto-conn-app-token');
  const token    = document.getElementById('auto-conn-token');
  const ttRadio  = document.querySelector('#auto-conn-token-type input[type=radio]:checked');
  if (name)     autoState.connForm.name     = name.value;
  if (appToken) autoState.connForm.appToken = appToken.value;
  if (token)    autoState.connForm.token    = token.value;
  if (ttRadio)  autoState.connForm.tokenType = ttRadio.value;
}

function autoConnFormClose() {
  autoState.connFormOpen = false;
  autoState.editingConnId = null;
  autoState.connFormError = null;
  autoRender();
}

// ── API — Connections ─────────────────────────────────────────────────────────
async function autoDoConnSave() {
  autoConnSyncForm();
  const f = autoState.connForm;

  if (!f.name.trim()) { showToast('Name is required', { error: true }); return; }

  autoState.connFormLoading = true;
  autoState.connFormError = null;
  autoRender();

  const isEdit = autoState.connFormMode === 'edit';
  const _editingConn = isEdit ? autoState.connections.find(c => c.id === autoState.editingConnId) : null;
  const editNeedsConnect = isEdit && _editingConn && _editingConn.status !== 'connected';

  try {
    let res;
    if (isEdit) {
      const payload = { name: f.name.trim(), tokenType: f.tokenType };
      if (f.appToken) payload.appToken = f.appToken;
      if (f.token)    payload.token    = f.token;
      res = await fjson(`/api/automations/connections/${autoState.editingConnId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const idx = autoState.connections.findIndex(c => c.id === autoState.editingConnId);
      if (idx >= 0) autoState.connections[idx] = res;
      if (editNeedsConnect) {
        showToast('Saved — connecting…');
        const savedConnId = autoState.editingConnId || res.id;
        autoState.connFormLoading = false;
        autoConnFormClose();
        await autoDoConnReconnect(savedConnId);
        return;
      }
      showToast('Connection updated');
    } else {
      if (!f.appToken) { throw new Error('App Token is required'); }
      if (!f.token)    { throw new Error('Bot/User Token is required'); }
      res = await fjson('/api/automations/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: f.name.trim(),
          provider: f.provider,
          tokenType: f.tokenType,
          appToken: f.appToken,
          token: f.token,
        }),
      });
      autoState.connections.push(res);
      showToast('Connection added');
    }
    autoState.connFormLoading = false;
    autoConnFormClose();
  } catch (err) {
    autoState.connFormLoading = false;
    autoState.connFormError = err?.message || 'Failed to save connection';
    autoRender();
  }
}

async function autoDoConnDisconnect(id) {
  try {
    await fjson(`/api/automations/connections/${id}/disconnect`, { method: 'POST' });
    const conn = autoState.connections.find(c => c.id === id);
    if (conn) conn.status = 'disconnected';
    autoState.connConfirmId = null;
    autoState.connConfirmAction = null;
    autoRender();
    showToast('Connection disconnected');
  } catch {
    autoState.connConfirmId = null;
    autoState.connConfirmAction = null;
    showToast('Failed to disconnect', { error: true });
  }
}

async function autoDoConnDelete(id) {
  try {
    await fjson(`/api/automations/connections/${id}`, { method: 'DELETE' });
    autoState.connections = autoState.connections.filter(c => c.id !== id);
    autoState.connConfirmId = null;
    autoState.connConfirmAction = null;
    autoRender();
    showToast('Connection deleted');
  } catch {
    autoState.connConfirmId = null;
    autoState.connConfirmAction = null;
    showToast('Failed to delete connection', { error: true });
  }
}

async function autoDoConnReconnect(id) {
  try {
    const res = await fjson(`/api/automations/connections/${id}/reconnect`, { method: 'POST' });
    const idx = autoState.connections.findIndex(c => c.id === id);
    if (idx >= 0) autoState.connections[idx] = res;
    autoRender();
    showToast('Reconnected');
  } catch {
    showToast('Failed to reconnect', { error: true });
    const idx = autoState.connections.findIndex(c => c.id === id);
    if (idx >= 0) autoState.connections[idx] = { ...autoState.connections[idx], status: 'error' };
    autoRender();
  }
}

// ── API — Automations ─────────────────────────────────────────────────────────
async function autoDoToggle(id, enabled) {
  try {
    await fjson(`/api/automations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    const a = autoState.automations.find(a => a.id === id);
    if (a) a.enabled = enabled;
    autoRender();
  } catch {
    showToast('Failed to update automation', { error: true });
  }
}

async function autoDoDelete(id) {
  try {
    await fjson(`/api/automations/${id}`, { method: 'DELETE' });
    autoState.automations = autoState.automations.filter(a => a.id !== id);
    autoState.confirmDeleteId = null;
    autoRender();
    showToast('Automation deleted');
  } catch {
    showToast('Failed to delete', { error: true });
  }
}

async function autoDoFormSave() {
  autoSyncForm();
  const f = autoState.form;

  const slackConns = autoState.connections.filter(c => c.provider === 'slack');
  const needsConn = slackConns.length > 0;

  autoShowErr('auto-err-name',   f.name.trim()           ? '' : 'Name is required');
  autoShowErr('auto-err-conn',   (!needsConn || f.connectionId) ? '' : 'Select a connection');
  autoShowErr('auto-err-room',   f.targetRoomId          ? '' : 'Select a target room');
  autoShowErr('auto-err-prompt', f.promptTemplate.trim() ? '' : 'Prompt is required');

  if (!f.name.trim() || !f.targetRoomId || !f.promptTemplate.trim()) return;
  if (needsConn && !f.connectionId) return;

  const saveBtn = document.getElementById('auto-form-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = svgSpinnerTiny() + ' Saving…'; }

  const payload = {
    name:               f.name.trim(),
    trigger_type:       'slack',
    trigger_event:      f.triggerEvent,
    trigger_conditions: JSON.stringify(f.conditions),
    target_room_id:     parseInt(f.targetRoomId),
    prompt_template:    f.promptTemplate.trim(),
    connection_id:      parseInt(f.connectionId) || null,
  };

  try {
    if (autoState.formMode === 'edit') {
      const res = await fjson(`/api/automations/${autoState.editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const idx = autoState.automations.findIndex(a => a.id === autoState.editingId);
      if (idx >= 0) autoState.automations[idx] = res;
      showToast('Automation saved');
    } else {
      const res = await fjson('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      autoState.automations.unshift(res);
      showToast('Automation created');
    }
    autoFormClose();
  } catch {
    showToast('Failed to save automation', { error: true });
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'Save Automation'; }
  }
}
