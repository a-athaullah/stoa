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

  const triggerProvider = auto.trigger_type === 'whatsapp' ? 'WhatsApp' : 'Slack';
  const triggerParts = [`${triggerProvider} ${auto.trigger_event}`];
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
function autoGetFormProvider() {
  const connId = autoState.form.connectionId;
  if (!connId) return 'slack';
  const conn = autoState.connections.find(c => String(c.id) === String(connId));
  return conn?.provider || 'slack';
}

function autoRenderForm() {
  const f = autoState.form;
  const provider = autoGetFormProvider();
  const isWa = provider === 'whatsapp';

  const slackEvents = [
    { value: 'mention',  label: 'Mention' },
    { value: 'message',  label: 'Message in channel' },
    { value: 'reaction_added', label: 'Reaction added' },
  ];
  const waEvents = [
    { value: 'message',       label: 'Direct message' },
    { value: 'group_message', label: 'Group message' },
    { value: 'group_mention', label: 'Group mention (bot tagged)' },
    { value: 'message_any',   label: 'Any message (DM + group)' },
  ];
  const events = isWa ? waEvents : slackEvents;

  const slackCondFields = f.triggerEvent === 'reaction_added'
    ? [
        { value: 'reaction',      label: 'reaction' },
        { value: 'slack_user',    label: 'slack_user' },
        { value: 'slack_channel', label: 'slack_channel' },
      ]
    : [
        { value: 'message_text',  label: 'message text' },
        { value: 'slack_full_text', label: 'full text (incl. attachments)' },
        { value: 'slack_user',    label: 'slack_user' },
        { value: 'slack_channel', label: 'slack_channel' },
        { value: 'slack_bot_id',  label: 'slack_bot_id' },
      ];
  const waCondFields = [
    { value: 'message_text', label: 'message text' },
    { value: 'wa_sender',    label: 'sender JID' },
    { value: 'wa_chat_id',   label: 'chat ID' },
  ];
  const condFields = isWa ? waCondFields : slackCondFields;
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
    ? `<div style="padding:12px;font-family:var(--h-sans);font-size:13px;color:var(--h-ink-faint);text-align:center">No conditions — any ${isWa ? 'WhatsApp' : 'Slack'} event will match</div>`
    : '';

  const roomOptions = autoState.rooms
    .filter(r => !r.archived_at)
    .map(r => `<option value="${r.id}" ${String(f.targetRoomId) === String(r.id) ? 'selected' : ''}>${escHtml(r.title)}</option>`)
    .join('');

  const allConns = autoState.connections.filter(c => c.status === 'connected' || c.status === 'connecting');
  let connField = '';
  if (allConns.length === 0) {
    connField = `
      <div style="display:flex;flex-direction:column;gap:5px">
        <span style="font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute)">Connection</span>
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:color-mix(in srgb,#b35a4b 6%,var(--h-surface));border:1px solid color-mix(in srgb,#b35a4b 22%,transparent);border-radius:7px">
          <span style="font-family:var(--h-sans);font-size:13px;color:#b35a4b;flex:1">No active connections — add one first</span>
          <button class="auto-pill-btn auto-goto-add-conn-btn" style="font-size:12px;padding:4px 10px;white-space:nowrap">+ add connection</button>
        </div>
      </div>
    `;
  } else {
    const selectedId = f.connectionId || (allConns.length === 1 ? String(allConns[0].id) : '');
    const connOptions = allConns.map(c => {
      const provLabel = c.provider === 'whatsapp' ? 'WhatsApp' : `Slack/${c.token_type}`;
      return `<option value="${c.id}" ${String(selectedId) === String(c.id) ? 'selected' : ''}>${escHtml(c.name)} (${provLabel})</option>`;
    }).join('');
    connField = `
      <div style="display:flex;flex-direction:column;gap:5px">
        <span style="font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute)">Connection</span>
        <select class="auto-sel" id="auto-form-conn" style="min-width:200px">
          ${allConns.length > 1 ? '<option value="">— select connection —</option>' : ''}
          ${connOptions}
        </select>
        <span class="auto-field-err" id="auto-err-conn"></span>
      </div>
    `;
  }

  const autoVars = isWa ? AUTO_VARS_WA : AUTO_VARS_SLACK;

  const replyModeField = isWa ? `
    <!-- Reply Mode -->
    <div style="display:flex;flex-direction:column;gap:7px">
      <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Reply to WhatsApp</span>
      <div style="display:flex;gap:18px" id="auto-form-reply-mode">
        <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-family:var(--h-sans);font-size:13px;color:var(--h-ink-mute)">
          <input type="radio" name="auto-reply-mode" value="none" ${(f.replyMode || 'none') === 'none' ? 'checked' : ''} style="accent-color:var(--h-accent)">
          No reply (Stoa room only)
        </label>
        <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-family:var(--h-sans);font-size:13px;color:var(--h-ink-mute)">
          <input type="radio" name="auto-reply-mode" value="reply_wa" ${(f.replyMode || 'none') === 'reply_wa' ? 'checked' : ''} style="accent-color:var(--h-accent)">
          Enable AI to reply via WA
        </label>
      </div>
    </div>
  ` : '';

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

        <!-- Connection (determines integration type) -->
        ${connField}

        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
          <div style="display:flex;flex-direction:column;gap:5px">
            <span style="font-family:var(--h-serif);font-style:italic;font-size:12.5px;color:var(--h-ink-mute)">Integration</span>
            <div class="auto-fake-select" style="pointer-events:none;min-width:120px">${isWa ? 'WhatsApp' : 'Slack'} <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></div>
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
              ${autoVars.map(v => `<span class="auto-var-chip" data-var="${v}">${v}</span>`).join('')}
            </div>
          </div>
        </div>

        ${replyModeField}

        <!-- Footer -->
        <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:16px;border-top:1px solid var(--h-hair-soft)">
          <button class="auto-cancel-btn auto-form-cancel-btn">Cancel</button>
          <button class="auto-save-btn" id="auto-form-save-btn">Save Automation</button>
        </div>
      </div>
    </div>
  `;
}

