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
  const isEmail = conn.provider === 'email';

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
    const label = isWa ? (meta.botJid || conn.name) : isEmail ? conn.name : (meta.botName || conn.name);
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
  } else if (isEmail) {
    const parts = [
      meta.user ? escHtml(meta.user) : null,
      meta.host ? escHtml(meta.host) : null,
      meta.folder && meta.folder !== 'INBOX' ? escHtml(meta.folder) : null,
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
    : isEmail
    ? `<span style="font-family:var(--h-sans);font-size:11px;color:var(--h-ink-faint);background:var(--h-hairline);padding:1px 6px;border-radius:4px;margin-left:4px">Email</span>`
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
  const isEmail = f.provider === 'email';
  const isBotToken = f.tokenType !== 'user';

  const editingConn = isEdit ? autoState.connections.find(c => c.id === autoState.editingConnId) : null;
  const editNeedsConnect = isEdit && editingConn && editingConn.status !== 'connected';
  let saveBtnLabel = isEdit ? (editNeedsConnect ? 'Save & Connect' : 'Save') : (isWa ? 'Connect & Show QR' : 'Connect');
  const connectBtn = autoState.connFormLoading
    ? `<button class="auto-save-btn" id="auto-conn-save-btn" disabled style="display:inline-flex;align-items:center;gap:7px">${svgSpinnerTiny()} ${isWa ? 'Connecting…' : editNeedsConnect ? 'Connecting…' : isEdit ? 'Saving…' : 'Connecting…'}</button>`
    : `<button class="auto-save-btn" id="auto-conn-save-btn">${saveBtnLabel}</button>`;

  const testBtnHtml = isEmail ? (() => {
    const r = autoState.connTestResult;
    if (autoState.connTestLoading) {
      return `<button class="auto-small-btn" id="auto-conn-test-btn" disabled style="display:inline-flex;align-items:center;gap:5px">${svgSpinnerTiny()} Testing…</button>`;
    }
    let badge = '';
    if (r) {
      badge = r.ok
        ? `<span style="font-family:var(--h-sans);font-size:12px;color:#7fb98c">✓ Connection OK</span>`
        : `<span style="font-family:var(--h-sans);font-size:12px;color:#b35a4b">✗ ${escHtml(r.error || 'Failed')}</span>`;
    }
    return `<button class="auto-small-btn" id="auto-conn-test-btn" style="display:inline-flex;align-items:center;gap:5px">Test connection</button>${badge ? ' ' + badge : ''}`;
  })() : '';

  const emailFields = !isEmail ? '' : (() => {
    const isGmail = f.emailPreset === 'gmail';
    const customHostFields = isGmail ? '' : `
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div style="display:flex;flex-direction:column;gap:5px;flex:1;min-width:160px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">IMAP Host</span>
          <input class="auto-field-input" id="auto-conn-email-host" type="text" placeholder="imap.example.com" autocomplete="off" value="${escHtml(f.emailHost)}">
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;width:90px">
          <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Port</span>
          <input class="auto-field-input" id="auto-conn-email-port" type="number" min="1" max="65535" value="${f.emailPort}" style="max-width:90px">
        </div>
      </div>
    `;

    return `
      <!-- Preset -->
      <div style="display:flex;flex-direction:column;gap:7px">
        <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Preset</span>
        <div style="display:flex;gap:18px" id="auto-conn-email-preset">
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-family:var(--h-sans);font-size:13px;color:var(--h-ink-mute)">
            <input type="radio" name="auto-email-preset" value="gmail" ${isGmail ? 'checked' : ''} style="accent-color:var(--h-accent)">
            Gmail (imap.gmail.com:993)
          </label>
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-family:var(--h-sans);font-size:13px;color:var(--h-ink-mute)">
            <input type="radio" name="auto-email-preset" value="custom" ${!isGmail ? 'checked' : ''} style="accent-color:var(--h-accent)">
            Custom IMAP
          </label>
        </div>
      </div>

      ${customHostFields}

      <!-- Email address -->
      <div style="display:flex;flex-direction:column;gap:5px">
        <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Email address</span>
        <input class="auto-field-input" id="auto-conn-email-user" type="email" placeholder="you@gmail.com" autocomplete="off" value="${escHtml(f.emailUser)}">
      </div>

      <!-- App password -->
      <div style="display:flex;flex-direction:column;gap:5px">
        <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">App password ${isEdit ? '<span style="font-size:12px;color:var(--h-ink-faint)">(leave blank to keep existing)</span>' : ''}</span>
        <input class="auto-token-input" id="auto-conn-email-password" type="password" placeholder="${isEdit && editingConn?.metadata?.hasPassword ? '••••••••••••••••' : 'xxxx xxxx xxxx xxxx'}" autocomplete="new-password" value="">
        ${isGmail ? `
          <div style="padding:9px 12px;background:color-mix(in srgb,var(--h-accent) 7%,var(--h-surface));border:1px solid color-mix(in srgb,var(--h-accent) 20%,transparent);border-radius:7px;margin-top:2px">
            <span style="font-family:var(--h-sans);font-size:12.5px;color:var(--h-ink-mute);line-height:1.5">
              Gmail requires an <strong>app password</strong>, not your account password.
              Go to <strong>Google Account → Security → 2-Step Verification → App passwords</strong> and create one for "Mail".
            </span>
          </div>
        ` : ''}
      </div>

      <!-- Folder -->
      <div style="display:flex;flex-direction:column;gap:5px">
        <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Folder <span style="font-size:12px;color:var(--h-ink-faint)">(default: INBOX)</span></span>
        <input class="auto-field-input" id="auto-conn-email-folder" type="text" placeholder="INBOX" autocomplete="off" value="${escHtml(f.emailFolder || 'INBOX')}" style="max-width:200px">
      </div>

      <!-- Allowed senders (required) -->
      <div style="display:flex;flex-direction:column;gap:5px">
        <span style="font-family:var(--h-serif);font-style:italic;font-size:13px;color:var(--h-ink-mute)">Allowed senders <span style="font-size:12px;color:#b35a4b">required</span></span>
        <textarea class="auto-prompt-ta" id="auto-conn-email-senders" rows="3" placeholder="boss@example.com&#10;*@kantor.com&#10;alerts@service.io">${escHtml(f.emailAllowedSenders)}</textarea>
        <span style="font-family:var(--h-sans);font-size:12px;color:var(--h-ink-faint)">One per line. Wildcards: <code>*@domain.com</code>. Emails from unlisted senders are silently ignored.</span>
      </div>

      <!-- Require auth pass -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--h-surface-tinted,color-mix(in srgb,var(--h-accent) 4%,var(--h-surface)));border:1px solid var(--h-hairline);border-radius:8px">
        <div style="display:flex;flex-direction:column;gap:2px">
          <span style="font-family:var(--h-sans);font-size:13px;color:var(--h-ink)">Require DMARC/DKIM pass</span>
          <span style="font-family:var(--h-sans);font-size:12px;color:var(--h-ink-faint)">Drop emails without dmarc=pass or dkim=pass (prevents spoofing)</span>
        </div>
        <span id="auto-conn-email-auth-toggle" role="switch" aria-checked="${f.emailRequireAuthPass ? 'true' : 'false'}" tabindex="0"
          style="width:36px;height:20px;border-radius:999px;position:relative;display:inline-block;cursor:pointer;flex-shrink:0;background:${f.emailRequireAuthPass ? '#7fb98c' : 'var(--h-hairline)'};transition:background .15s">
          <span style="position:absolute;top:2px;left:${f.emailRequireAuthPass ? '18px' : '2px'};width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.2)"></span>
        </span>
      </div>

      <!-- Test connection -->
      <div style="display:flex;align-items:center;gap:10px">
        ${testBtnHtml}
      </div>
    `;
  })();

  const slackFields = isWa || isEmail ? '' : `
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
            ? `<div class="auto-fake-select" style="pointer-events:none;opacity:.7;min-width:140px">${isWa ? 'WhatsApp' : isEmail ? 'Email (IMAP)' : 'Slack'} <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></div>`
            : `<select class="auto-sel" id="auto-conn-provider" style="min-width:160px">
                <option value="slack" ${f.provider === 'slack' ? 'selected' : ''}>Slack</option>
                <option value="whatsapp" ${f.provider === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
                <option value="email" ${f.provider === 'email' ? 'selected' : ''}>Email (IMAP)</option>
               </select>`
          }
        </div>

        ${emailFields}
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
