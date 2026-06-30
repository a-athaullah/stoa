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
      appToken: conn.appToken || '',
      token: conn.token || '',
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

  container.querySelectorAll('.auto-conn-show-qr-btn').forEach(btn => btn.addEventListener('click', () => {
    const connId = parseInt(btn.dataset.id);
    autoState.qrModal.open = true;
    autoState.qrModal.connId = connId;
    autoState.qrModal.dismissedConnId = null;
    sessionStorage.removeItem('stoa-qr-dismissed');
    autoRender();
    autoDoConnReconnect(connId);
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

  // Token type radio (Slack)
  container.querySelectorAll('#auto-conn-token-type input[type=radio]').forEach(radio => {
    radio.addEventListener('change', () => {
      autoConnSyncForm();
      autoState.connForm.tokenType = radio.value;
      autoRender();
    });
  });

  // Provider select
  container.querySelector('#auto-conn-provider')?.addEventListener('change', e => {
    autoConnSyncForm();
    autoState.connForm.provider = e.target.value;
    autoState.connForm.tokenType = e.target.value === 'whatsapp' ? 'qr' : 'bot';
    autoRender();
  });

  // QR modal close handled by autoBindQrModalEvents (modal lives in body, not container)

  container.querySelectorAll('.auto-conn-form-cancel-btn').forEach(btn => btn.addEventListener('click', autoConnFormClose));

  container.querySelector('#auto-conn-save-btn')?.addEventListener('click', autoDoConnSave);

  // ── Connection dropdown change → re-render form (updates Integration, Event, Conditions, Variables) ──
  container.querySelector('#auto-form-conn')?.addEventListener('change', () => {
    const prevProvider = autoGetFormProvider();
    autoSyncForm();
    const newProvider = autoGetFormProvider();
    if (newProvider !== prevProvider) {
      autoState.form.triggerEvent = newProvider === 'whatsapp' ? 'message' : 'mention';
      autoState.form.conditions = [];
      autoState.form.replyMode = 'none';
    }
    autoRender();
  });

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
  container.querySelectorAll('.auto-edit-btn').forEach(btn => btn.addEventListener('click', async () => {
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
      replyMode: auto.reply_mode || 'none',
    };
    try { autoState.rooms = await fjson('/api/rooms'); } catch {}
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
  container.querySelector('.auto-add-btn')?.addEventListener('click', async () => {
    const activeConns = autoState.connections.filter(c => c.status === 'connected' || c.status === 'connecting');
    const defaultConnId = activeConns.length === 1 ? String(activeConns[0].id) : '';
    const defaultConn = activeConns.find(c => String(c.id) === defaultConnId);
    const isWa = defaultConn?.provider === 'whatsapp';
    autoState.formOpen = true;
    autoState.formMode = 'new';
    autoState.editingId = null;
    autoState.form = {
      name: '',
      triggerEvent: isWa ? 'message' : 'mention',
      connectionId: defaultConnId,
      conditions: [],
      targetRoomId: '',
      promptTemplate: '',
      replyMode: 'none',
    };
    try { autoState.rooms = await fjson('/api/rooms'); } catch {}
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
  const name      = document.getElementById('auto-form-name');
  const event     = document.getElementById('auto-form-event');
  const conn      = document.getElementById('auto-form-conn');
  const room      = document.getElementById('auto-form-room');
  const prompt    = document.getElementById('auto-form-prompt');
  const replyMode = document.querySelector('#auto-form-reply-mode input[type=radio]:checked');
  if (name)      autoState.form.name           = name.value;
  if (event)     autoState.form.triggerEvent   = event.value;
  if (conn)      autoState.form.connectionId   = conn.value;
  if (room)      autoState.form.targetRoomId   = room.value;
  if (prompt)    autoState.form.promptTemplate = prompt.value;
  if (replyMode) autoState.form.replyMode      = replyMode.value;

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
  const name      = document.getElementById('auto-conn-name');
  const appToken  = document.getElementById('auto-conn-app-token');
  const token     = document.getElementById('auto-conn-token');
  const ttRadio   = document.querySelector('#auto-conn-token-type input[type=radio]:checked');
  const phone     = document.getElementById('auto-conn-phone');
  const mediaSize = document.getElementById('auto-conn-media-size');
  if (name)      autoState.connForm.name         = name.value;
  if (appToken)  autoState.connForm.appToken      = appToken.value;
  if (token)     autoState.connForm.token         = token.value;
  if (ttRadio)   autoState.connForm.tokenType     = ttRadio.value;
  if (phone)     autoState.connForm.phoneNumber   = phone.value;
  if (mediaSize) autoState.connForm.maxMediaSizeMb = parseInt(mediaSize.value) || 100;
}

function autoConnFormClose() {
  autoState.connFormOpen = false;
  autoState.editingConnId = null;
  autoState.connFormError = null;
  autoRender();
}

// ── QR handling ───────────────────────────────────────────────────────────────
function autoCloseQrModal() {
  const connId = autoState.qrModal.connId;
  autoState.qrModal.dismissedConnId = connId;
  if (connId) sessionStorage.setItem('stoa-qr-dismissed', String(connId));
  autoState.qrModal.open = false;
  autoState.qrModal.qrData = null;
  const overlay = document.getElementById('auto-qr-modal-overlay');
  if (overlay) overlay.remove();
}

function autoBindQrModalEvents() {
  const overlay = document.getElementById('auto-qr-modal-overlay');
  if (!overlay) return;
  overlay.querySelectorAll('.auto-qr-close-btn').forEach(btn =>
    btn.addEventListener('click', () => { autoCloseQrModal(); autoRender(); }));
  overlay.addEventListener('click', e => {
    if (e.target === overlay) { autoCloseQrModal(); autoRender(); }
  });
}

function autoHandleWaQr(msg) {
  if (autoState.qrModal.dismissedConnId === msg.connId) return;
  const stored = sessionStorage.getItem('stoa-qr-dismissed');
  if (stored && String(msg.connId) === stored) {
    autoState.qrModal.dismissedConnId = msg.connId;
    return;
  }
  autoState.qrModal.connId = msg.connId;
  autoState.qrModal.qrData = msg.qr;
  if (!autoState.qrModal.open) autoState.qrModal.open = true;
  const overlay = document.getElementById('auto-qr-modal-overlay');
  if (overlay) overlay.remove();
  document.body.insertAdjacentHTML('beforeend', autoRenderQrModal());
  autoBindQrModalEvents();
  requestAnimationFrame(() => autoRenderQrCanvas());
}

function autoHandleConnStatus(msg) {
  if (msg.connId === autoState.qrModal.connId && autoState.qrModal.open) {
    autoCloseQrModal();
  } else if (msg.connId === autoState.qrModal.dismissedConnId) {
    autoState.qrModal.dismissedConnId = null;
    sessionStorage.removeItem('stoa-qr-dismissed');
  }
  const conn = autoState.connections.find(c => c.id === msg.connId);
  if (conn) {
    conn.status = msg.status;
    conn.error_msg = msg.error || null;
  }
  autoRender();
}

function autoRenderQrCanvas() {
  const canvas = document.getElementById('auto-qr-canvas');
  if (!canvas || !autoState.qrModal.qrData) return;
  if (typeof QRCode === 'undefined') return;
  QRCode.toCanvas(canvas, autoState.qrModal.qrData, { width: 220, margin: 1 }, () => {});
}

