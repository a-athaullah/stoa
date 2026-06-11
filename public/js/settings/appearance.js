// ── Reading comfort controls ──────────────────────────────────────────────
const MSG_SIZES = [
  { label: 'Tiny', v: 0.72, icon: 13 },
  { label: 'Small', v: 0.82, icon: 15 },
  { label: 'Compact', v: 0.9, icon: 17 },
  { label: 'Default', v: 1.0, icon: 20 },
];
const MSG_LEADS = [
  { label: 'Tight', v: 0.9, gap: 2 },
  { label: 'Normal', v: 1.0, gap: 4 },
  { label: 'Relaxed', v: 1.15, gap: 6 },
];
const MSG_WIDTHS = [
  { label: 'Narrow', v: 460, w: 14 },
  { label: 'Standard', v: 560, w: 20 },
  { label: 'Wide', v: 680, w: 26 },
];

function sGetMsgPref(key, def) {
  const v = localStorage.getItem('stoa-msg-' + key);
  return v !== null ? parseFloat(v) : def;
}

function sApplyMsgVar(cssVar, val, storeKey) {
  document.documentElement.style.setProperty(cssVar, typeof val === 'number' && val > 100 ? val + 'px' : String(val));
  localStorage.setItem('stoa-msg-' + storeKey, val);
}

function sRenderReadingControls() {
  const el = document.getElementById('s-reading-controls');
  if (!el) return;

  let scale = sGetMsgPref('scale', 1);
  let lead = sGetMsgPref('leading', 1);
  let width = sGetMsgPref('width', 560);

  function nearest(arr, val) { return arr.reduce((b, o) => Math.abs(o.v - val) < Math.abs(b.v - val) ? o : b); }

  function render() {
    const aSize = nearest(MSG_SIZES, scale);
    const aLead = nearest(MSG_LEADS, lead);
    const aWid = nearest(MSG_WIDTHS, width);

    el.innerHTML = '';

    // Text size
    const sizeLabel = document.createElement('div');
    sizeLabel.className = 's-msg-sublabel';
    sizeLabel.textContent = 'text size';
    el.appendChild(sizeLabel);

    const sizeRow = document.createElement('div');
    sizeRow.className = 's-msg-row';
    MSG_SIZES.forEach(o => {
      const btn = document.createElement('button');
      btn.className = 's-seg-btn' + (o.label === aSize.label ? ' active' : '');
      btn.innerHTML = `<span class="s-seg-icon" style="font-size:${o.icon}px">A</span><span class="s-seg-label">${o.label}</span>`;
      btn.onclick = () => { scale = o.v; sApplyMsgVar('--stoa-msg-scale', o.v, 'scale'); render(); };
      sizeRow.appendChild(btn);
    });
    el.appendChild(sizeRow);

    // Line spacing + width row
    const wrapRow = document.createElement('div');
    wrapRow.className = 's-msg-row-wrap';

    // Line spacing
    const leadCol = document.createElement('div');
    leadCol.className = 's-msg-col';
    const leadLabel = document.createElement('div');
    leadLabel.className = 's-msg-sublabel';
    leadLabel.textContent = 'line spacing';
    leadCol.appendChild(leadLabel);
    const leadRow = document.createElement('div');
    leadRow.className = 's-msg-row';
    MSG_LEADS.forEach(o => {
      const btn = document.createElement('button');
      btn.className = 's-seg-btn' + (o.label === aLead.label ? ' active' : '');
      const bars = `<span class="s-seg-bars" style="gap:${o.gap}px"><span class="s-seg-bar"></span><span class="s-seg-bar"></span><span class="s-seg-bar"></span></span>`;
      btn.innerHTML = `${bars}<span class="s-seg-label">${o.label}</span>`;
      btn.onclick = () => { lead = o.v; sApplyMsgVar('--stoa-msg-leading', o.v, 'leading'); render(); };
      leadRow.appendChild(btn);
    });
    leadCol.appendChild(leadRow);
    wrapRow.appendChild(leadCol);

    // Width
    const widCol = document.createElement('div');
    widCol.className = 's-msg-col';
    const widLabel = document.createElement('div');
    widLabel.className = 's-msg-sublabel';
    widLabel.textContent = 'width';
    widCol.appendChild(widLabel);
    const widRow = document.createElement('div');
    widRow.className = 's-msg-row';
    MSG_WIDTHS.forEach(o => {
      const btn = document.createElement('button');
      btn.className = 's-seg-btn' + (o.label === aWid.label ? ' active' : '');
      const bars = `<span class="s-seg-bars" style="gap:3px"><span class="s-seg-bar" style="width:${o.w}px"></span><span class="s-seg-bar" style="width:${o.w}px"></span></span>`;
      btn.innerHTML = `${bars}<span class="s-seg-label">${o.label}</span>`;
      btn.onclick = () => { width = o.v; sApplyMsgVar('--stoa-msg-width', o.v, 'width'); render(); };
      widRow.appendChild(btn);
    });
    widCol.appendChild(widRow);
    wrapRow.appendChild(widCol);
    el.appendChild(wrapRow);

    // Live preview
    const preview = document.createElement('div');
    preview.className = 's-msg-preview';

    const aiRow = document.createElement('div');
    aiRow.className = 's-msg-preview-row';
    const aiBubble = document.createElement('div');
    aiBubble.className = 's-msg-preview-bubble';
    aiBubble.style.cssText = `max-width:min(var(--stoa-msg-width,560px),78%);font-size:calc(var(--stoa-msg-scale,1)*16px);line-height:calc(1.6*var(--stoa-msg-leading,1));border-top-left-radius:4px;background:color-mix(in srgb,#6f9f8c 16%,var(--h-surface));border-color:color-mix(in srgb,#6f9f8c 36%,var(--h-surface))`;
    aiBubble.innerHTML = 'The client replays from the last <em>message_state</em> event — not from the last token, so a reconnect never loses the thread.';
    aiRow.appendChild(aiBubble);
    preview.appendChild(aiRow);

    const humanRow = document.createElement('div');
    humanRow.className = 's-msg-preview-row human';
    const humanBubble = document.createElement('div');
    humanBubble.className = 's-msg-preview-bubble';
    humanBubble.style.cssText = `max-width:min(var(--stoa-msg-width,560px),78%);font-size:calc(var(--stoa-msg-scale,1)*16px);line-height:calc(1.6*var(--stoa-msg-leading,1));border-top-right-radius:4px;background:var(--h-slip);border-color:var(--h-hair-soft)`;
    humanBubble.textContent = 'Got it — that reads much better at this size.';
    humanRow.appendChild(humanBubble);
    preview.appendChild(humanRow);

    el.appendChild(preview);
  }

  render();
}

