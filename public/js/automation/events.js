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

