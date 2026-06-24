// automation.js — Settings automation tab (Stoa)
// Requires: fjson, showToast, svgPencil, svgX, svgSpinnerTiny from settings.js / core.js

// ── Helpers ───────────────────────────────────────────────────────────────────
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
const AUTO_VARS_SLACK = [
  '{{slack_message_text}}',
  '{{slack_message_link}}',
  '{{slack_thread_ts}}',
  '{{slack_user}}',
  '{{slack_channel}}',
  '{{extracted_url}}',
];

const AUTO_VARS_WA = [
  '{{wa_message_text}}',
  '{{wa_sender}}',
  '{{wa_sender_name}}',
  '{{wa_chat_id}}',
  '{{wa_chat_name}}',
  '{{wa_is_group}}',
  '{{wa_is_mentioned}}',
  '{{extracted_url}}',
];

const AUTO_VARS = AUTO_VARS_SLACK;

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
    tokenType: 'bot',       // 'bot' | 'user' | 'qr'
    appToken: '',
    token: '',
    phoneNumber: '',
    maxMediaSizeMb: 100,
  },
  // Connection confirm
  connConfirmId: null,
  connConfirmAction: null,  // 'disconnect' | 'delete'
  // QR modal
  qrModal: { open: false, connId: null, qrData: null },
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
    replyMode: 'none',
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

  const existingOverlay = document.getElementById('auto-qr-modal-overlay');
  if (autoState.qrModal.open) {
    if (!existingOverlay) {
      document.body.insertAdjacentHTML('beforeend', autoRenderQrModal());
      autoBindQrModalEvents();
    }
    requestAnimationFrame(() => autoRenderQrCanvas());
  } else if (existingOverlay) {
    existingOverlay.remove();
  }

  autoBindEvents(el);
}

