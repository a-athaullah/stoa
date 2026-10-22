// ── MCP approvals: approve / deny cards in the room feed and thread panel ────
const MCP_APPR_STATUS_TEXT = {
  approved: 'approved',
  denied: 'denied',
  expired: 'expired: treated as denied',
};

const mcpApprovals = new Map();
let mcpApprTimer = null;
let mcpApprLoadSeq = 0;

function mcpApprovalsReset() {
  mcpApprovals.clear();
  mcpApprLoadSeq++;
}

async function mcpApprovalsLoad(roomId) {
  const seq = ++mcpApprLoadSeq;
  const r = await mcpApi('GET', `/api/mcp/approvals?${new URLSearchParams({ room_id: String(roomId), status: 'pending' })}`);
  if (seq !== mcpApprLoadSeq || currentRoomId !== roomId || !r.ok) return;
  (Array.isArray(r.data?.approvals) ? r.data.approvals : []).forEach(a => mcpApprovals.set(a.id, a));
  mcpApprovalsSync();
}

// Room WS and the owner's global WS both deliver approval events: every path here is idempotent by id.
function mcpApprovalEvent(msg) {
  if (msg.type === 'mcp_approval') {
    mcpApprovalNew(msg.approval);
    mcpApprLogEvent(msg.approval);
  } else if (msg.type === 'mcp_approval_resolved') {
    const res = msg.approval ? { id: msg.approval.id, status: msg.approval.status, decided_at: msg.approval.decided_at } : msg;
    mcpApprovalResolved(res);
    mcpApprLogEvent(res);
  }
}

function mcpApprovalNew(a) {
  if (!a || a.room_id !== currentRoomId || mcpApprovals.has(a.id)) return;
  mcpApprovals.set(a.id, a);
  mcpApprovalsSync();
  if (a.thread_id && typeof activeThreadId !== 'undefined' && activeThreadId === a.thread_id) {
    if (typeof _scrollThreadToBottom === 'function') _scrollThreadToBottom(true);
  } else {
    scrollToBottom(true);
  }
}

function mcpApprovalResolved(msg) {
  const a = mcpApprovals.get(msg?.id);
  if (!a || a.status === msg.status) return;
  a.status = msg.status;
  a.decided_at = msg.decided_at || null;
  mcpApprovalsSync();
}

function mcpApprovalsSync() {
  const feed = document.getElementById('messages-inner');
  const threadBody = typeof activeThreadId !== 'undefined' && activeThreadId ? document.getElementById('thread-body') : null;
  mcpApprovals.forEach(a => {
    if (a.room_id !== currentRoomId) return;
    if (!a.thread_id) {
      mcpApprPlace(feed, a, mcpMakeApprovalCard);
      return;
    }
    if (threadBody && activeThreadId === a.thread_id) mcpApprPlace(threadBody, a, mcpMakeApprovalCard);
    const pointer = feed?.querySelector(`.mcp-appr-pointer[data-approval-id="${a.id}"]`);
    if (a.status === 'pending') mcpApprPlace(feed, a, mcpMakeApprovalPointer);
    else pointer?.remove();
  });
  mcpApprTick();
  if (!mcpApprTimer && [...mcpApprovals.values()].some(a => a.status === 'pending')) {
    mcpApprTimer = setInterval(mcpApprTick, 1000);
  }
}

// Re-render only when the status changed, so an open args <details> keeps its state while pending.
function mcpApprPlace(container, a, make) {
  if (!container) return;
  const node = make(a);
  const existing = container.querySelector(`.${node.classList[0]}[data-approval-id="${a.id}"]`);
  if (!existing) container.appendChild(node);
  else if (existing.dataset.status !== a.status) existing.replaceWith(node);
}

function mcpApprWho(a) {
  return a.sub_agent_label ? `${a.actor_name || 'an agent'} · ${a.sub_agent_label}` : (a.actor_name || 'an agent');
}

function mcpApprToolName(a) {
  return a.server_slug ? `${a.server_slug}__${a.tool}` : a.tool;
}

function mcpMakeApprovalCard(a) {
  const card = mcpEl('div', 'mcp-appr');
  card.dataset.approvalId = a.id;
  card.dataset.status = a.status;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', `MCP approval: ${mcpApprWho(a)} wants to run ${mcpApprToolName(a)}`);

  const head = mcpEl('div', 'mcp-appr-head');
  head.appendChild(mcpEl('span', 'mcp-appr-label', 'MCP approval'));
  if (a.status === 'pending') {
    const timer = mcpEl('span', 'mcp-appr-timer');
    timer.dataset.expiresAt = a.expires_at || '';
    head.appendChild(timer);
  }
  card.appendChild(head);

  const title = mcpEl('div', 'mcp-appr-title');
  title.append(mcpEl('span', 'mcp-appr-who', mcpApprWho(a)), document.createTextNode(' wants to run '),
    mcpEl('code', 'mcp-appr-tool', mcpApprToolName(a)));
  card.appendChild(title);

  const args = mcpEl('details', 'mcp-appr-args');
  args.open = (a.args_preview || '').length <= 240;
  args.appendChild(mcpEl('summary', null, 'arguments'));
  args.appendChild(mcpEl('pre', 'mcp-args-preview', a.args_preview || '—'));
  card.appendChild(args);

  if (a.status === 'pending') {
    const actions = mcpEl('div', 'mcp-appr-actions');
    const approve = mcpBtn('mcp-appr-approve', 'approve', () => mcpDecide(a, 'approve', actions));
    const deny = mcpBtn('mcp-appr-deny', 'deny', () => mcpDecide(a, 'deny', actions));
    actions.append(approve, deny);
    card.appendChild(actions);
  } else {
    const st = mcpEl('div', `mcp-appr-result mcp-appr-${a.status}`,
      [MCP_APPR_STATUS_TEXT[a.status] || a.status, a.decided_at ? mcpLocalTime(a.decided_at) : ''].filter(Boolean).join(' · '));
    st.setAttribute('role', 'status');
    card.appendChild(st);
  }
  return card;
}

function mcpMakeApprovalPointer(a) {
  const row = mcpEl('div', 'mcp-appr-pointer');
  row.dataset.approvalId = a.id;
  row.dataset.status = a.status;
  row.append(mcpEl('span', 'mcp-appr-label', 'MCP approval'),
    mcpEl('span', 'mcp-appr-who', mcpApprWho(a)), document.createTextNode(' wants to run '),
    mcpEl('code', 'mcp-appr-tool', mcpApprToolName(a)), document.createTextNode(' in a thread'));
  row.appendChild(mcpBtn('mcp-link-btn', 'review', () => openThread(a.thread_id)));
  return row;
}

// Returns the final { status, decided_at }, or null when the request failed and can be retried.
async function mcpDecide(a, decision, actions) {
  actions.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const r = await mcpApi('POST', `/api/mcp/approvals/${a.id}`, { decision });
  const body = r.data?.approval || r.data || {};
  let out = null;
  if (r.ok) out = { status: body.status || (decision === 'approve' ? 'approved' : 'denied'), decided_at: body.decided_at || null };
  else if (r.status === 409 && MCP_APPR_STATUS_TEXT[body.status]) out = { status: body.status, decided_at: body.decided_at || null };
  else if (r.status === 404 || r.status === 409) {
    showToast(r.status === 404 ? 'This approval request no longer exists' : 'This request was already decided', { error: true });
    out = { status: 'expired', decided_at: null };
  }
  if (!out) {
    showToast(`Couldn’t ${decision} ${mcpApprToolName(a)}: ${r.error}`, { error: true });
    actions.querySelectorAll('button').forEach(b => { b.disabled = false; });
    return null;
  }
  mcpApprovalResolved({ id: a.id, ...out });
  return out;
}

function mcpApprTick() {
  const timers = document.querySelectorAll('.mcp-appr[data-status="pending"] .mcp-appr-timer');
  timers.forEach(t => {
    const left = Math.round((mcpTsMs(t.dataset.expiresAt) - Date.now()) / 1000);
    if (isNaN(left)) { t.textContent = ''; return; }
    if (left <= 0) {
      t.textContent = 'expiring…';
      t.closest('.mcp-appr')?.querySelectorAll('.mcp-appr-actions button').forEach(b => { b.disabled = true; });
      return;
    }
    t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`;
    t.classList.toggle('mcp-appr-timer-low', left <= 60);
  });
  if (![...mcpApprovals.values()].some(a => a.status === 'pending') && mcpApprTimer) {
    clearInterval(mcpApprTimer);
    mcpApprTimer = null;
  }
}
