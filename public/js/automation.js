// automation.js — Settings automation tab (Stoa)
// Requires: fjson, showToast, svgPencil, svgX, svgSpinnerTiny from settings.js / core.js

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
  slackStatus: 'disconnected', // disconnected | config | connecting | connected | error
  slackConfig: null,           // { workspaceName, botName, appTokenHint, botTokenHint }
  confirmDisconnect: false,
  automations: [],
  rooms: [],
  confirmDeleteId: null,
  formOpen: false,
  formMode: 'new',             // new | edit
  editingId: null,
  form: {
    name: '',
    triggerEvent: 'mention',
    conditions: [],
    targetRoomId: '',
    promptTemplate: '',
  },
};

// ── Load ──────────────────────────────────────────────────────────────────────
async function sLoadAutomationTab() {
  if (!autoState.loaded) {
    try {
      const [slackRes, autosRes, roomsRes] = await Promise.all([
        fjson('/api/automations/slack'),
        fjson('/api/automations'),
        fjson('/api/rooms'),
      ]);
      autoState.slackStatus = slackRes.connected ? 'connected' : 'disconnected';
      autoState.slackConfig = slackRes.connected ? slackRes : null;
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

  const sectionLabel = autoState.formOpen
    ? (autoState.formMode === 'edit' ? 'edit automation' : 'new automation')
    : 'automations';

  el.innerHTML = `
    <div class="s-content-inner">
      <div class="auto-section">
        <span class="auto-section-label">integrations</span>
        ${autoRenderSlackArea()}
      </div>
      <div class="auto-section">
        <span class="auto-section-label">${sectionLabel}</span>
        ${autoState.formOpen ? autoRenderForm() : autoRenderAutomationsCard()}
      </div>
    </div>
  `;

  autoBindEvents(el);
}

// ── Slack area ────────────────────────────────────────────────────────────────
function autoRenderSlackArea() {
  if (autoState.slackStatus === 'config') return autoRenderSlackConfigPanel();
  return autoRenderSlackCard();
}

function autoRenderSlackCard() {
  const s = autoState.slackStatus;
  const isConnected = s === 'connected';
  const isError = s === 'error';
  const cfg = autoState.slackConfig;

  const dotStyle = isConnected
    ? 'background:#7fb98c;box-shadow:0 0 0 3px color-mix(in srgb,#7fb98c 22%,transparent)'
    : isError
    ? 'background:#b35a4b'
    : 'background:transparent;border:1.5px solid var(--h-ink-faint)';

  const statusLabel = isConnected ? 'Connected' : isError ? 'Connection error' : 'Not connected';
  const statusColor = isConnected ? '#7fb98c' : isError ? '#b35a4b' : 'var(--h-ink-faint)';
  const headerBorder = isConnected ? 'border-bottom:1px solid var(--h-hair-soft);' : '';

  const rightBtn = isConnected ? `
    <div style="display:flex;gap:4px">
      <button class="s-icon-btn auto-slack-edit-btn" title="Edit">${svgPencil(14)}</button>
      <button class="s-icon-btn auto-slack-disconnect-btn" title="Disconnect" style="color:#b35a4b">${svgX(13)}</button>
    </div>
  ` : isError ? `
    <button class="auto-outline-btn auto-slack-retry-btn" style="color:#b35a4b;border-color:#b35a4b">Retry</button>
  ` : `
    <button class="auto-pill-btn auto-slack-connect-btn">Connect Slack</button>
  `;

  const header = `
    <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;${headerBorder}">
      <span style="width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0;${dotStyle}"></span>
      <span style="font-family:var(--h-serif);font-size:16px;color:var(--h-ink)">Slack</span>
      <span style="font-family:var(--h-sans);font-size:13px;color:${statusColor}">${statusLabel}</span>
      <span style="flex:1"></span>
      ${rightBtn}
    </div>
  `;

  const body = isConnected && cfg ? `
    <div style="padding:12px 18px 14px;display:flex;gap:26px;flex-wrap:wrap;background:color-mix(in srgb,var(--h-bg) 22%,var(--h-surface))">
      <div style="display:flex;flex-direction:column;gap:3px">
        <span style="font-family:var(--h-sans);font-size:11.5px;color:var(--h-ink-faint);letter-spacing:.03em">App Token</span>
        <span style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:var(--h-ink-mute)">${escHtml(cfg.appTokenHint || '')}<span style="color:var(--h-ink-faint);letter-spacing:.08em">••••••••</span></span>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px">
        <span style="font-family:var(--h-sans);font-size:11.5px;color:var(--h-ink-faint);letter-spacing:.03em">Bot Token</span>
        <span style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:var(--h-ink-mute)">${escHtml(cfg.botTokenHint || '')}<span style="color:var(--h-ink-faint);letter-spacing:.08em">••••••••</span></span>
      </div>
      ${cfg.userTokenHint ? `
      <div style="display:flex;flex-direction:column;gap:3px">
        <span style="font-family:var(--h-sans);font-size:11.5px;color:var(--h-ink-faint);letter-spacing:.03em">User Token</span>
        <span style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:var(--h-ink-mute)">${escHtml(cfg.userTokenHint)}<span style="color:var(--h-ink-faint);letter-spacing:.08em">••••••••</span></span>
      </div>` : ''}
      <div style="display:flex;flex-direction:column;gap:3px">
        <span style="font-family:var(--h-sans);font-size:11.5px;color:var(--h-ink-faint);letter-spacing:.03em">workspace</span>
        <span style="font-family:var(--h-sans);font-size:13px;color:var(--h-ink-mute)">${escHtml(cfg.workspaceName || '—')} · ${escHtml(cfg.botName || '—')} · Socket Mode: Active</span>
      </div>
    </div>
  ` : isError ? `
    <div style="padding:10px 18px 14px">
      <span style="font-family:var(--h-sans);font-size:13px;color:#b35a4b">Socket Mode disconnected — check your App Token and try again.</span>
    </div>
  ` : `
    <div style="padding:10px 18px 14px">
      <span style="font-family:var(--h-sans);font-size:13px;color:var(--h-ink-faint)">Connect Slack to enable Slack-based automations.</span>
    </div>
  `;

  const confirmRow = (autoState.confirmDisconnect && isConnected) ? `
    <div style="padding:12px 18px;display:flex;align-items:center;justify-content:space-between;background:color-mix(in srgb,#b35a4b 8%,var(--h-surface));border-top:1px solid var(--h-hair-soft)">
      <span style="font-family:var(--h-sans);font-size:13px;color:var(--h-ink-mute)">Disconnect from ${escHtml(cfg?.workspaceName || 'Slack')}?</span>
      <div style="display:flex;gap:8px">
        <button class="auto-small-btn auto-cancel-disconnect-btn">Cancel</button>
        <button class="auto-small-btn auto-confirm-disconnect-btn" style="color:#b35a4b;border-color:#b35a4b">Disconnect</button>
      </div>
    </div>
  ` : '';

  return `<div class="auto-card">${header}${body}${confirmRow}</div>`;
}

function autoRenderSlackConfigPanel() {
  const cfg = autoState.slackConfig;
  return `
    <div class="auto-card">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-bottom:1px solid var(--h-hair-soft);background:color-mix(in srgb,var(--h-bg) 38%,var(--h-surface))">
        <span style="font-family:var(--h-serif);font-size:16px;color:var(--h-ink)">Configure Slack Integration</span>
        <button class="s-icon-btn auto-slack-config-cancel-btn" title="Cancel">${svgX(13)}</button>
      </div>
      <div style="padding:18px 20px 20px;display:flex;flex-direction:column;gap:16px">
        <div style="display:flex;flex-direction:column;gap:5px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">App Token (Socket Mode)</span>
          <input class="auto-token-input" id="auto-app-token" type="password" placeholder="xapp-1-..." autocomplete="off">
          <span style="font-family:var(--h-sans);font-size:12px;color:var(--h-ink-faint)">Used for WebSocket connection to Slack</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Bot Token <span style="font-size:11px;color:var(--h-ink-faint)">(optional if User Token provided)</span></span>
          <input class="auto-token-input" id="auto-bot-token" type="password" placeholder="xoxb-..." autocomplete="off">
          <span style="font-family:var(--h-sans);font-size:12px;color:var(--h-ink-faint)">For bot identity — not needed if using User Token approach</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">User Token <span style="font-size:11px;color:var(--h-ink-faint)">(optional)</span></span>
          <input class="auto-token-input" id="auto-user-token" type="password" placeholder="xoxp-..." autocomplete="off">
          <span style="font-family:var(--h-sans);font-size:12px;color:var(--h-ink-faint)">For listening to your channels and DMs — without inviting the bot</span>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
          <button class="auto-cancel-btn auto-slack-config-cancel-btn">Cancel</button>
          <button class="auto-save-btn" id="auto-slack-connect-btn">Connect</button>
        </div>
      </div>
    </div>
  `;
}

// ── Automations card ───────────────────────────────────────────────────────────
function autoRenderAutomationsCard() {
  const canAdd = autoState.slackStatus === 'connected';
  const rows = autoState.automations.map(a => autoRenderAutomationRow(a)).join('');

  return `
    <div class="auto-card">
      <div class="auto-card-header">
        <div style="display:flex;align-items:baseline;gap:10px">
          <span style="font-family:var(--h-serif);font-size:16px;color:var(--h-ink)">automations</span>
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-faint)">rules that trigger agent messages</span>
        </div>
        ${canAdd ? `
          <button class="auto-pill-btn auto-add-btn" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px 6px 10px;font-size:13px">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
            add new
          </button>
        ` : ''}
      </div>
      ${autoState.automations.length ? rows : autoRenderEmpty()}
    </div>
  `;
}

function autoRenderEmpty() {
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

// ── Form ──────────────────────────────────────────────────────────────────────
function autoRenderForm() {
  const f = autoState.form;
  const events = [
    { value: 'mention',  label: 'Mention' },
    { value: 'message',  label: 'Message in channel' },
    { value: 'reaction', label: 'Reaction added' },
  ];
  const condFields = [
    { value: 'message_text',  label: 'message text' },
    { value: 'slack_user',    label: 'slack_user' },
    { value: 'slack_channel', label: 'slack_channel' },
  ];
  const condOps = [
    { value: 'contains',       label: 'contains' },
    { value: 'not_contains',   label: 'not contains' },
    { value: 'starts_with',    label: 'starts with' },
    { value: 'matches_regex',  label: 'matches regex' },
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
            <div class="auto-fake-select" style="min-width:140px">Slack <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></div>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px">
            <span style="font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute)">Event</span>
            <select class="auto-sel" id="auto-form-event">
              ${events.map(e => `<option value="${e.value}" ${f.triggerEvent === e.value ? 'selected' : ''}>${e.label}</option>`).join('')}
            </select>
          </div>
        </div>

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
  // Slack
  container.querySelector('.auto-slack-connect-btn')?.addEventListener('click', () => {
    autoState.slackStatus = 'config';
    autoRender();
  });
  container.querySelectorAll('.auto-slack-config-cancel-btn').forEach(b => b.addEventListener('click', () => {
    autoState.slackStatus = autoState.slackConfig ? 'connected' : 'disconnected';
    autoRender();
  }));
  container.querySelector('#auto-slack-connect-btn')?.addEventListener('click', autoDoSlackConnect);
  container.querySelector('.auto-slack-edit-btn')?.addEventListener('click', () => {
    autoState.slackStatus = 'config';
    autoRender();
  });
  container.querySelector('.auto-slack-disconnect-btn')?.addEventListener('click', () => {
    autoState.confirmDisconnect = true;
    autoRender();
  });
  container.querySelector('.auto-cancel-disconnect-btn')?.addEventListener('click', () => {
    autoState.confirmDisconnect = false;
    autoRender();
  });
  container.querySelector('.auto-confirm-disconnect-btn')?.addEventListener('click', autoDoSlackDisconnect);
  container.querySelector('.auto-slack-retry-btn')?.addEventListener('click', () => {
    autoState.slackStatus = 'config';
    autoRender();
  });

  // Hover on rows
  container.querySelectorAll('.auto-row').forEach(row => {
    const actions = row.querySelector('.auto-row-actions');
    if (!actions) return;
    row.addEventListener('mouseenter', () => { actions.style.opacity = '1'; });
    row.addEventListener('mouseleave', () => { actions.style.opacity = '0'; });
  });

  // Toggle
  container.querySelectorAll('.auto-toggle-btn').forEach(btn => btn.addEventListener('click', async () => {
    const id = parseInt(btn.dataset.id);
    const enabled = btn.dataset.enabled === '1' ? 0 : 1;
    await autoDoToggle(id, enabled);
  }));

  // Edit
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
      conditions: conds,
      targetRoomId: auto.target_room_id,
      promptTemplate: auto.prompt_template,
    };
    autoRender();
  }));

  // Delete
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

  // Add automation
  container.querySelector('.auto-add-btn')?.addEventListener('click', () => {
    autoState.formOpen = true;
    autoState.formMode = 'new';
    autoState.editingId = null;
    autoState.form = { name: '', triggerEvent: 'mention', conditions: [], targetRoomId: '', promptTemplate: '' };
    autoRender();
  });

  // Form close/cancel
  container.querySelector('.auto-form-close-btn')?.addEventListener('click', autoFormClose);
  container.querySelector('.auto-form-cancel-btn')?.addEventListener('click', autoFormClose);

  // Add condition
  container.querySelector('.auto-add-cond-btn')?.addEventListener('click', () => {
    autoSyncForm();
    autoState.form.conditions.push({ field: 'message_text', op: 'contains', value: '' });
    autoRender();
  });

  // Remove condition
  container.querySelectorAll('.auto-cond-remove').forEach(btn => btn.addEventListener('click', () => {
    autoSyncForm();
    const idx = parseInt(btn.dataset.idx);
    autoState.form.conditions.splice(idx, 1);
    autoRender();
  }));

  // Var chips
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

  // Form save
  container.querySelector('#auto-form-save-btn')?.addEventListener('click', autoDoFormSave);
}

// ── Form helpers ──────────────────────────────────────────────────────────────
function autoSyncForm() {
  const name    = document.getElementById('auto-form-name');
  const event   = document.getElementById('auto-form-event');
  const room    = document.getElementById('auto-form-room');
  const prompt  = document.getElementById('auto-form-prompt');
  if (name)   autoState.form.name           = name.value;
  if (event)  autoState.form.triggerEvent   = event.value;
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

function autoShowErr(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = msg ? '' : 'none'; }
}

// ── API ───────────────────────────────────────────────────────────────────────
async function autoDoSlackConnect() {
  const appToken  = document.getElementById('auto-app-token')?.value?.trim();
  const botToken  = document.getElementById('auto-bot-token')?.value?.trim();
  const userToken = document.getElementById('auto-user-token')?.value?.trim() || null;
  if (!appToken || !botToken) { showToast('App Token and Bot Token are required', { error: true }); return; }

  const btn = document.getElementById('auto-slack-connect-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = svgSpinnerTiny() + ' Connecting…'; }

  try {
    const res = await fjson('/api/automations/slack/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appToken, botToken, userToken }),
    });
    autoState.slackStatus = 'connected';
    autoState.slackConfig = res;
    autoState.confirmDisconnect = false;
    autoRender();
    showToast('Slack connected');
  } catch {
    autoState.slackStatus = 'error';
    autoRender();
    showToast('Failed to connect Slack', { error: true });
  }
}

async function autoDoSlackDisconnect() {
  try {
    await fjson('/api/automations/slack/disconnect', { method: 'DELETE' });
    autoState.slackStatus = 'disconnected';
    autoState.slackConfig = null;
    autoState.confirmDisconnect = false;
    autoRender();
    showToast('Slack disconnected');
  } catch {
    showToast('Failed to disconnect Slack', { error: true });
  }
}

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

  let ok = true;
  autoShowErr('auto-err-name',   f.name.trim()          ? '' : 'Name is required');
  autoShowErr('auto-err-room',   f.targetRoomId         ? '' : 'Select a target room');
  autoShowErr('auto-err-prompt', f.promptTemplate.trim() ? '' : 'Prompt is required');
  if (!f.name.trim() || !f.targetRoomId || !f.promptTemplate.trim()) ok = false;
  if (!ok) return;

  const saveBtn = document.getElementById('auto-form-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = svgSpinnerTiny() + ' Saving…'; }

  const payload = {
    name:               f.name.trim(),
    trigger_type:       'slack',
    trigger_event:      f.triggerEvent,
    trigger_conditions: JSON.stringify(f.conditions),
    target_room_id:     parseInt(f.targetRoomId),
    prompt_template:    f.promptTemplate.trim(),
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function autoRelTime(ts) {
  const diff = (Date.now() - new Date(ts + 'Z').getTime()) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff/60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)} hours ago`;
  return `${Math.floor(diff/86400)} days ago`;
}

function autoSvgTrash(sz=14) {
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h11M5.5 4.5V3h5v1.5"/><rect x="3.5" y="4.5" width="9" height="9" rx="1.5"/><path d="M6.5 7.5v3M9.5 7.5v3"/></svg>`;
}
