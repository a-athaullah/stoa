// ── Connections section ───────────────────────────────────────────────────────
function autoRenderConnectionsSection() {
  const parts = [];

  if (autoState.connections.length === 0 && !autoState.connFormOpen) {
    parts.push(`
      <div class="auto-card" style="padding:36px 24px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">
        <svg width="28" height="28" viewBox="0 0 16 16" fill="none" stroke="var(--h-ink-faint)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="5" r="2.5"/><circle cx="11" cy="11" r="2.5"/><path d="M7.5 5h1.5a2 2 0 012 2v1.5"/><path d="M8.5 11H7A2 2 0 015 9V7.5"/></svg>
        <span style="font-family:var(--h-serif);font-size:16px;color:var(--h-ink-mute)">No connections yet</span>
        <span style="font-family:var(--h-sans);font-size:13px;color:var(--h-ink-faint);max-width:360px;line-height:1.55">Add a connection to start receiving events from Slack, WhatsApp, or other services.</span>
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

  if (autoState.qrModal.open) {
    parts.push(autoRenderQrModal());
  }

  return parts.join('');
}

function autoRenderConnectionCard(conn) {
  const isConnected = conn.status === 'connected';
  const isError = conn.status === 'error';
  const isDisconnected = conn.status === 'disconnected';
  const isConnecting = conn.status === 'connecting';
  const meta = conn.metadata || {};
  const isWa = conn.provider === 'whatsapp';

  const dotStyle = isConnected
    ? 'background:#7fb98c;box-shadow:0 0 0 3px color-mix(in srgb,#7fb98c 22%,transparent)'
    : isError
    ? 'background:#b35a4b'
    : isConnecting
    ? 'background:#c8a84b'
    : 'background:transparent;border:1.5px solid var(--h-ink-faint)';

  const statusLabel = isConnected ? 'connected' : isError ? 'error' : isConnecting ? 'connecting…' : 'disconnected';
  const statusColor = isConnected ? '#7fb98c' : isError ? '#b35a4b' : isConnecting ? '#c8a84b' : 'var(--h-ink-faint)';

  const isConfirm = autoState.connConfirmId === conn.id;

  let actions = '';
  if (isConfirm) {
    const action = autoState.connConfirmAction;
    const label = isWa ? (meta.botJid || conn.name) : (meta.botName || conn.name);
    const confirmLabel = action === 'disconnect' ? `Disconnect @${escHtml(label)}?` : `Delete @${escHtml(label)}?`;
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
    } else if (isDisconnected || isConnecting) {
      if (isWa && isConnecting) {
        btns.push(`<button class="auto-small-btn auto-conn-show-qr-btn" data-id="${conn.id}">Show QR</button>`);
      } else {
        btns.push(`<button class="auto-small-btn auto-conn-reconnect-btn" data-id="${conn.id}">Reconnect</button>`);
      }
      btns.push(`<button class="auto-small-btn auto-conn-delete-btn" data-id="${conn.id}" style="color:#b35a4b;border-color:color-mix(in srgb,#b35a4b 40%,transparent)">Delete</button>`);
    } else if (isError) {
      btns.push(`<button class="auto-small-btn auto-conn-retry-btn" data-id="${conn.id}" style="color:#b35a4b;border-color:color-mix(in srgb,#b35a4b 40%,transparent)">Retry</button>`);
      btns.push(`<button class="auto-small-btn auto-conn-delete-btn" data-id="${conn.id}" style="color:#b35a4b;border-color:color-mix(in srgb,#b35a4b 40%,transparent)">Delete</button>`);
    }
    actions = `<div class="auto-row-actions" style="display:flex;gap:6px;opacity:0;transition:opacity .12s;margin-left:auto">${btns.join('')}</div>`;
  }

  let subline = '';
  if (isWa) {
    const parts = [
      meta.phoneNumber ? `+${meta.phoneNumber.replace(/^\+/, '')}` : null,
      meta.botJid ? `jid: ${escHtml(meta.botJid.split(':')[0])}` : null,
      meta.maxMediaSizeMb ? `media ≤${meta.maxMediaSizeMb}MB` : null,
    ].filter(Boolean);
    subline = parts.join(' · ');
  } else {
    const botName = meta.botName || '';
    const workspaceName = meta.workspaceName || '';
    const tokenTypeLabel = conn.token_type === 'user' ? 'user' : 'bot';
    subline = [
      botName ? `@${escHtml(botName)}` : null,
      `${tokenTypeLabel} token`,
      workspaceName ? `Workspace: ${escHtml(workspaceName)}` : null,
    ].filter(Boolean).join(' · ');
  }

  const providerBadge = isWa
    ? `<span style="font-family:var(--h-sans);font-size:11px;color:var(--h-ink-faint);background:var(--h-hairline);padding:1px 6px;border-radius:4px;margin-left:4px">WhatsApp</span>`
    : '';

  return `
    <div class="auto-card" style="margin-bottom:8px" data-conn-id="${conn.id}">
      <div class="auto-conn-row" style="display:flex;align-items:center;gap:12px;padding:12px 16px;${isError ? 'border-bottom:1px solid var(--h-hair-soft)' : ''}">
        <span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;display:inline-block;${dotStyle}"></span>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
          <div style="display:flex;align-items:baseline;gap:6px">
            <span style="font-family:var(--h-serif);font-size:15px;color:var(--h-ink)">${escHtml(conn.name)}</span>
            ${providerBadge}
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
      ${isWa && isConnecting && autoState.qrModal.connId === conn.id ? `
        <div style="padding:8px 16px 10px;background:color-mix(in srgb,#c8a84b 6%,var(--h-surface))">
          <span style="font-family:var(--h-sans);font-size:12.5px;color:#c8a84b">Waiting for QR scan — open WhatsApp → Linked Devices → Link a Device</span>
        </div>
      ` : ''}
    </div>
  `;
}

function autoRenderConnectionForm() {
  const f = autoState.connForm;
  const isEdit = autoState.connFormMode === 'edit';
  const isWa = f.provider === 'whatsapp';
  const isBotToken = f.tokenType !== 'user';

  const editingConn = isEdit ? autoState.connections.find(c => c.id === autoState.editingConnId) : null;
  const editNeedsConnect = isEdit && editingConn && editingConn.status !== 'connected';
  let saveBtnLabel = isEdit ? (editNeedsConnect ? 'Save & Connect' : 'Save') : (isWa ? 'Connect & Show QR' : 'Connect');
  const connectBtn = autoState.connFormLoading
    ? `<button class="auto-save-btn" id="auto-conn-save-btn" disabled style="display:inline-flex;align-items:center;gap:7px">${svgSpinnerTiny()} ${isWa ? 'Connecting…' : editNeedsConnect ? 'Connecting…' : isEdit ? 'Saving…' : 'Connecting…'}</button>`
    : `<button class="auto-save-btn" id="auto-conn-save-btn">${saveBtnLabel}</button>`;

  const slackFields = isWa ? '' : `
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
      <input class="auto-token-input" id="auto-conn-app-token" type="text" placeholder="xapp-1-..." autocomplete="off" value="${escHtml(f.appToken)}">
    </div>

    <!-- Bot/User Token -->
    <div style="display:flex;flex-direction:column;gap:5px">
      <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">${isBotToken ? 'Bot Token' : 'User Token'}</span>
      <input class="auto-token-input" id="auto-conn-token" type="text" placeholder="${isBotToken ? 'xoxb-...' : 'xoxp-...'}" autocomplete="off" value="${escHtml(f.token)}">
    </div>
  `;

  const waFields = !isWa ? '' : `
    <!-- Phone Number (optional, informational) -->
    <div style="display:flex;flex-direction:column;gap:5px">
      <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Phone Number <span style="font-size:12px;color:var(--h-ink-faint)">(optional, for reference)</span></span>
      <input class="auto-field-input" id="auto-conn-phone" type="text" placeholder="628xxxxxxxxxx" autocomplete="off" value="${escHtml(f.phoneNumber)}">
    </div>

    <!-- Max Media Size -->
    <div style="display:flex;flex-direction:column;gap:5px">
      <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Max Media Download Size (MB)</span>
      <input class="auto-field-input" id="auto-conn-media-size" type="number" min="1" max="500" value="${f.maxMediaSizeMb || 100}" style="max-width:120px">
      <span style="font-family:var(--h-sans);font-size:12px;color:var(--h-ink-faint)">Media larger than this will not be downloaded. Default: 100MB.</span>
    </div>

    <!-- QR info -->
    <div style="padding:10px 12px;background:color-mix(in srgb,var(--h-accent) 8%,var(--h-surface));border:1px solid color-mix(in srgb,var(--h-accent) 22%,transparent);border-radius:7px">
      <span style="font-family:var(--h-sans);font-size:13px;color:var(--h-ink-mute);line-height:1.5">After connecting, a QR code will appear. Open WhatsApp on your phone → <strong>Linked Devices</strong> → <strong>Link a Device</strong> and scan it.</span>
    </div>
  `;

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
          <input class="auto-field-input" id="auto-conn-name" type="text" placeholder="${isWa ? 'e.g. WhatsApp — Support Line' : 'e.g. Slack — Customer Support Bot'}" value="${escHtml(f.name)}" autocomplete="off">
        </div>

        <!-- Provider -->
        <div style="display:flex;flex-direction:column;gap:5px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Provider</span>
          ${isEdit
            ? `<div class="auto-fake-select" style="pointer-events:none;opacity:.7;min-width:140px">${isWa ? 'WhatsApp' : 'Slack'} <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></div>`
            : `<select class="auto-sel" id="auto-conn-provider" style="min-width:160px">
                <option value="slack" ${f.provider === 'slack' ? 'selected' : ''}>Slack</option>
                <option value="whatsapp" ${f.provider === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
               </select>`
          }
        </div>

        ${slackFields}
        ${waFields}

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

function autoRenderQrModal() {
  const { connId, qrData } = autoState.qrModal;
  const conn = autoState.connections.find(c => c.id === connId);
  const connName = conn ? escHtml(conn.name) : 'WhatsApp';
  return `
    <div id="auto-qr-modal-overlay" style="position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center">
      <div style="background:var(--h-surface);border-radius:14px;padding:28px 32px;display:flex;flex-direction:column;align-items:center;gap:18px;max-width:340px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.3)">
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:17px;color:var(--h-ink)">Scan QR Code</span>
          <button class="s-icon-btn auto-qr-close-btn" title="Close">${svgX(13)}</button>
        </div>
        <span style="font-family:var(--h-sans);font-size:13px;color:var(--h-ink-mute);text-align:center">
          Open WhatsApp → <strong>Linked Devices</strong> → <strong>Link a Device</strong><br>then scan the code below to connect <em>${connName}</em>.
        </span>
        <div id="auto-qr-canvas-wrap" style="background:#fff;padding:12px;border-radius:8px;display:flex;align-items:center;justify-content:center;min-width:220px;min-height:220px">
          ${qrData
            ? `<canvas id="auto-qr-canvas"></canvas>`
            : `<span style="font-family:var(--h-sans);font-size:13px;color:var(--h-ink-faint)">Waiting for QR…</span>`
          }
        </div>
        <span style="font-family:var(--h-sans);font-size:12px;color:var(--h-ink-faint);text-align:center">QR code refreshes every ~20 seconds. Do not close this window while scanning.</span>
        <button class="auto-cancel-btn auto-qr-close-btn">Close</button>
      </div>
    </div>
  `;
}
