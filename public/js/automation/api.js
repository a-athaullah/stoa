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
    const isWa = f.provider === 'whatsapp';
    if (isEdit) {
      const payload = { name: f.name.trim() };
      if (!isWa) {
        payload.tokenType = f.tokenType;
        if (f.appToken) payload.appToken = f.appToken;
        if (f.token)    payload.token    = f.token;
      } else {
        if (f.phoneNumber)   payload.phoneNumber   = f.phoneNumber;
        if (f.maxMediaSizeMb) payload.maxMediaSizeMb = f.maxMediaSizeMb;
      }
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
        if (isWa) {
          // Open QR modal immediately for WA reconnect
          autoState.qrModal = { open: true, connId: savedConnId, qrData: null };
          autoRender();
        }
        await autoDoConnReconnect(savedConnId);
        return;
      }
      showToast('Connection updated');
    } else {
      if (!isWa) {
        if (!f.appToken) { throw new Error('App Token is required'); }
        if (!f.token)    { throw new Error('Bot/User Token is required'); }
      }
      const payload = {
        name: f.name.trim(),
        provider: f.provider,
        tokenType: f.tokenType,
      };
      if (!isWa) {
        payload.appToken = f.appToken;
        payload.token    = f.token;
      } else {
        payload.phoneNumber   = f.phoneNumber;
        payload.maxMediaSizeMb = f.maxMediaSizeMb || 100;
      }
      res = await fjson('/api/automations/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      autoState.connections.push(res);
      if (isWa) {
        // Open QR modal and wait for QR from server
        autoState.qrModal = { open: true, connId: res.id, qrData: null };
        showToast('WhatsApp connecting — scan the QR code');
      } else {
        showToast('Connection added');
      }
    }
    autoState.connFormLoading = false;
    autoConnFormClose();
    autoRender();
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

  const activeConns = autoState.connections.filter(c => c.status === 'connected' || c.status === 'connecting');
  const needsConn = activeConns.length > 0;
  const selectedConn = f.connectionId ? autoState.connections.find(c => String(c.id) === String(f.connectionId)) : null;
  const triggerType = selectedConn?.provider === 'whatsapp' ? 'whatsapp' : 'slack';

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
    trigger_type:       triggerType,
    trigger_event:      f.triggerEvent,
    trigger_conditions: JSON.stringify(f.conditions),
    target_room_id:     parseInt(f.targetRoomId),
    prompt_template:    f.promptTemplate.trim(),
    connection_id:      parseInt(f.connectionId) || null,
    reply_mode:         f.replyMode || 'none',
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

