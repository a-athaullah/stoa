// ── Skill autocomplete ─────────────────────────────────────────────────────
const SKILL_COLORS = ['#5b8fd4','#d39749','#8a7660','#6b9e6b','#c25d5d','#9b6bc2','#4a9e9e'];

function showSkillPopup(query) {
  const popup = document.getElementById('skill-popup');
  const matches = allSkills.filter(s => s.name.startsWith(query)).slice(0, 7);
  if (!matches.length) { hideSkillPopup(); return; }

  popup.innerHTML = '';
  skillPopupIdx = 0;
  matches.forEach((skill, i) => {
    const color = SKILL_COLORS[i % SKILL_COLORS.length];
    const item = document.createElement('div');
    item.className = 'h-skill-item';
    item.dataset.idx = i;
    const agentTag = skill.actor_name
      ? `<span class="h-skill-agent">${escHtml(skill.actor_name)}</span>` : '';
    item.innerHTML =
      `<span class="h-skill-name" style="--skill-color:${color}">/${escHtml(skill.name)}</span>` +
      `<span class="h-skill-desc">${escHtml(skill.description || '')}</span>` +
      agentTag;
    item.onmousedown = e => {
      e.preventDefault();
      applySkill(skill.name);
    };
    if (i === 0) item.classList.add('active');
    popup.appendChild(item);
  });
  popup.style.display = 'block';
}

function hideSkillPopup() {
  document.getElementById('skill-popup').style.display = 'none';
  skillPopupIdx = -1;
}

function skillColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return SKILL_COLORS[Math.abs(h) % SKILL_COLORS.length];
}

function applySkill(name) {
  const input = document.getElementById('msg-input');
  const sel = window.getSelection();
  if (!sel.rangeCount) { hideSkillPopup(); return; }
  const node = sel.anchorNode;
  const color = skillColor(name);

  if (node.nodeType === 3 && input.contains(node)) {
    const text = node.textContent;
    const cursor = sel.anchorOffset;
    const before = text.slice(0, cursor);
    const match = before.match(/(^|\s)\/([a-z0-9-]*)$/);
    if (match) {
      const start = match.index + match[1].length;
      const beforeText = text.slice(0, start);
      const afterText = text.slice(cursor);
      const parent = node.parentElement;
      const frag = document.createDocumentFragment();
      if (beforeText) frag.appendChild(document.createTextNode(beforeText));
      const span = document.createElement('span');
      span.className = 'h-skill-tag';
      span.style.color = color;
      span.contentEditable = 'false';
      span.textContent = '/' + name;
      frag.appendChild(span);
      const after = document.createTextNode(' ' + afterText);
      frag.appendChild(after);
      parent.replaceChild(frag, node);
      const range = document.createRange();
      range.setStart(after, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      hideSkillPopup();
      return;
    }
  }
  input.focus();
  const span = document.createElement('span');
  span.className = 'h-skill-tag';
  span.style.color = color;
  span.contentEditable = 'false';
  span.textContent = '/' + name;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(span);
  const after = document.createTextNode(' ');
  span.parentNode.insertBefore(after, span.nextSibling);
  range.setStart(after, 1);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  hideSkillPopup();
}

function skillPopupNavigate(dir) {
  const popup = document.getElementById('skill-popup');
  if (popup.style.display === 'none') return false;
  const items = popup.querySelectorAll('.h-skill-item');
  if (!items.length) return false;
  items[skillPopupIdx]?.classList.remove('active');
  skillPopupIdx = (skillPopupIdx + dir + items.length) % items.length;
  items[skillPopupIdx].classList.add('active');
  return true;
}

function onComposerInput() {
  const input = document.getElementById('msg-input');
  saveDraft(currentRoomId);
  const sel = window.getSelection();
  if (sel.rangeCount && input.contains(sel.anchorNode)) {
    const node = sel.anchorNode;
    const text = node.nodeType === 3 ? node.textContent.slice(0, sel.anchorOffset) : '';
    const skillMatch = text.match(/(^|\s)\/([a-z0-9-]*)$/);
    const mentionQuery = mentionQueryAtCaret(input);
    if (skillMatch) {
      showSkillPopup(skillMatch[2]);
      hideMentionPopup();
    } else if (mentionQuery !== null) {
      showMentionPopup(mentionQuery, 'msg-input');
      hideSkillPopup();
    } else {
      hideSkillPopup();
      hideMentionPopup();
    }
  } else {
    hideSkillPopup();
    hideMentionPopup();
  }
  handleInlineMarkdown();
}

function handleInlineMarkdown() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== 3) return;
  const input = document.getElementById('msg-input');
  if (!input.contains(node)) return;
  const parent = node.parentElement;
  if (parent.nodeName === 'CODE' || parent.nodeName === 'PRE') return;

  const text = node.textContent;
  const cursor = sel.anchorOffset;
  const before = text.slice(0, cursor);

  const patterns = [
    { re: /`([^`]+)`$/, tag: 'code' },
    { re: /\*([^\*]+)\*$/, tag: 'strong' },
    { re: /(?:^|[^a-zA-Z0-9])_([^_]+)_$/, tag: 'em', lookbehind: true },
    { re: /~([^~]+)~$/, tag: 's' },
  ];

  for (const { re, tag, lookbehind } of patterns) {
    const match = before.match(re);
    if (!match) continue;
    const innerText = match[1];
    const fullMatch = lookbehind ? match[0].slice(match[0].length - match[1].length - 2) : match[0];
    const start = cursor - fullMatch.length;
    const beforeText = text.slice(0, start);
    const afterText = text.slice(cursor);
    const frag = document.createDocumentFragment();
    if (beforeText) frag.appendChild(document.createTextNode(beforeText));
    const el = document.createElement(tag);
    el.textContent = innerText;
    frag.appendChild(el);
    const afterNode = document.createTextNode(afterText || '​');
    frag.appendChild(afterNode);
    parent.replaceChild(frag, node);
    const range = document.createRange();
    range.setStart(afterNode, afterText ? 0 : 1);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
}

// ── Mention highlighting in bubbles ───────────────────────────────────────
function highlightMentions(html) {
  const names = (roomParticipantsCache[currentRoomId] || []).map(p => p.name);
  const subLabels = (roomSubAgentsCache[currentRoomId] || []).map(s => s.label);
  const all = [...names, ...subLabels];
  if (!all.length) return html;
  const escaped = all.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  escaped.sort((a, b) => b.length - a.length);
  const re = new RegExp(`@(${escaped.join('|')})(?=\\s|&nbsp;|[.,!?;:]|<|$)`, 'gm');
  return html.replace(re, (match, name) => '<span class="h-mention-inline">@' + wsEscHtml(name) + '</span>');
}

// ── Mention autocomplete ──────────────────────────────────────────────────
// Shared by the room composer (#msg-input) and the thread composer
// (#thread-msg-input); each has its own popup element.
const MENTION_POPUP_FOR_INPUT = { 'msg-input': 'mention-popup', 'thread-msg-input': 'thread-mention-popup' };
let mentionInputId = 'msg-input';

function mentionPopupEl() {
  return document.getElementById(MENTION_POPUP_FOR_INPUT[mentionInputId]);
}

function isMentionPopupOpen() {
  const popup = mentionPopupEl();
  return !!popup && popup.style.display !== 'none';
}

function mentionQueryAtCaret(input) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !input.contains(sel.anchorNode)) return null;
  const node = sel.anchorNode;
  const text = node.nodeType === 3 ? node.textContent.slice(0, sel.anchorOffset) : '';
  const match = text.match(/(^|\s)@([^\s]*)$/);
  return match ? match[2] : null;
}

function makeMentionAvatarEl(p) {
  if (!p.isSub) return makeAvatar(p.name, p.avatar_color, p.avatar_url, 22);
  return makeAvatarEl(p.parent_name, p.parent_avatar_color, p.parent_avatar_url, 22, p.name, p.avatar_color, p.avatar_symbol, p.avatar_url);
}

function showMentionPopup(query, inputId = 'msg-input') {
  if (inputId !== mentionInputId) hideMentionPopup();
  mentionInputId = inputId;
  const popup = mentionPopupEl();
  if (!popup) return;
  const parts = roomParticipantsCache[currentRoomId] || [];
  const subs = roomSubAgentsCache[currentRoomId] || [];
  const q = query.toLowerCase();
  const partMatches = parts
    .filter(p => p.actor_id !== humanActor?.id && p.name.toLowerCase().startsWith(q))
    .map(p => ({ name: p.name, avatar_color: p.avatar_color, avatar_url: p.avatar_url, isSub: false }));
  const subMatches = subs
    .filter(s => s.label.toLowerCase().startsWith(q))
    .map(s => ({
      name: s.label, role: s.role || null, isSub: true,
      avatar_color: s.avatar_color || null, avatar_symbol: s.avatar_symbol || null, avatar_url: s.avatar_url || null,
      parent_name: s.parent_name, parent_avatar_color: s.parent_avatar_color, parent_avatar_url: s.parent_avatar_url,
    }));
  const matches = [...partMatches, ...subMatches].slice(0, 7);
  if (!matches.length) { hideMentionPopup(); return; }

  popup.innerHTML = '';
  mentionPopupIdx = 0;
  matches.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'h-mention-item';
    item.dataset.idx = i;
    item.appendChild(makeMentionAvatarEl(p));
    const text = document.createElement('span');
    text.className = 'h-mention-text';
    const name = document.createElement('span');
    name.className = 'h-mention-name';
    name.textContent = p.name;
    text.appendChild(name);
    if (p.role) {
      const role = document.createElement('span');
      role.className = 'h-mention-role';
      role.textContent = p.role;
      role.title = p.role;
      text.appendChild(role);
    }
    item.appendChild(text);
    if (p.isSub) {
      const badge = document.createElement('span');
      badge.className = 'h-mention-sub-badge';
      badge.textContent = 'sub';
      item.appendChild(badge);
    }
    item.onmousedown = e => {
      e.preventDefault();
      applyMention(p.name);
    };
    if (i === 0) item.classList.add('active');
    popup.appendChild(item);
  });
  popup.style.display = 'block';
}

function hideMentionPopup() {
  const popup = mentionPopupEl();
  if (popup) popup.style.display = 'none';
  mentionPopupIdx = -1;
}

function applyActiveMention() {
  const popup = mentionPopupEl();
  const active = popup?.querySelector('.h-mention-item.active') || popup?.querySelector('.h-mention-item');
  if (active) applyMention(active.querySelector('.h-mention-name').textContent);
}

function applyMention(name) {
  const input = document.getElementById(mentionInputId);
  const sel = window.getSelection();
  if (!input || !sel.rangeCount) { hideMentionPopup(); return; }
  const node = sel.anchorNode;

  if (node.nodeType === 3 && input.contains(node)) {
    const text = node.textContent;
    const cursor = sel.anchorOffset;
    const before = text.slice(0, cursor);
    const match = before.match(/(^|\s)@([^\s]*)$/);
    if (match) {
      const start = match.index + match[1].length;
      const beforeText = text.slice(0, start);
      const afterText = text.slice(cursor);
      const parent = node.parentElement;
      const frag = document.createDocumentFragment();
      if (beforeText) frag.appendChild(document.createTextNode(beforeText));
      const span = document.createElement('span');
      span.className = 'h-mention-tag';
      span.contentEditable = 'false';
      span.textContent = '@' + name;
      frag.appendChild(span);
      const after = document.createTextNode(' ' + afterText);
      frag.appendChild(after);
      parent.replaceChild(frag, node);
      const range = document.createRange();
      range.setStart(after, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      hideMentionPopup();
      return;
    }
  }
  hideMentionPopup();
}

// ── Model selector ────────────────────────────────────────────────────────
const ANTHROPIC_MODELS_FALLBACK = [
  { value: 'claude-opus-5-5', label: 'Opus 5.5' },
  { value: 'claude-opus-5', label: 'Opus 5' },
  { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5' },
  { value: 'claude-fable-5-1', label: 'Fable 5.1' },
  { value: 'claude-fable-5', label: 'Fable 5' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

let allServerModels = null;
let allHarnessData = null;

async function fetchHarnesses() {
  if (allHarnessData !== null) return allHarnessData;
  try { allHarnessData = await fjson('/api/harnesses'); } catch { allHarnessData = []; }
  return allHarnessData;
}

// harness_models is re-synced server-side on every harnesses_update, so drop the cached copy.
async function refreshHarnessCache() {
  allHarnessData = null;
  return fetchHarnesses();
}

function getModelsForHarness(harnessName) {
  if (!Array.isArray(allHarnessData) || !harnessName) return null;
  const h = allHarnessData.find(x => x.name === harnessName);
  if (!h || !h.models?.length) return null;
  return h.models.map(m => ({
    value: m.model_id, label: m.display_name || m.model_id,
    vision: false, tools: false, local: false,
    platform: harnessName, platform_id: harnessName, is_default: !!m.is_default,
  }));
}

function _agentHarnessModels(harnessStatus, harnessName) {
  if (!Array.isArray(harnessStatus) || !harnessName) return null;
  const st = harnessStatus.find(s => s.id === harnessName);
  if (!st?.models?.length) return null;
  return st.models.map(m => ({
    value: m.id, label: m.label || m.id,
    vision: false, tools: false, local: false,
    platform: harnessName, platform_id: harnessName, is_default: !!m.is_default,
  }));
}

async function fetchPlatformModels() {
  try {
    const groups = await fjson('/api/ai/models');
    allServerModels = [];
    for (const g of groups) {
      const platKey = g.platform_id === 'anthropic' ? 'anthropic' : g.platform_name;
      for (const m of g.models) {
        allServerModels.push({ value: m.value, label: m.label, vision: m.vision || false, tools: m.tools || false, local: m.local || false, platform: platKey, platform_id: g.platform_id, base_url: g.base_url || '', custom: !!m.custom });
      }
    }
    if (currentRoomData) updateModelSelector(currentRoomData, roomParticipantsCache[currentRoomId] || []);
    else populateModelDropdown();
  } catch {}
  fetchHarnesses(); // prime harness cache in background
}

function getAvailableModels() {
  if (allServerModels) return allServerModels;
  // platform_id: 'anthropic' so fallback models disambiguate the same way server models do.
  return ANTHROPIC_MODELS_FALLBACK.map(m => ({ ...m, platform: 'anthropic', platform_id: 'anthropic' }));
}

// Find a model by value, disambiguating by platform when a name exists on multiple platforms.
// No platform → Anthropic native model (model_config is null), so default to 'anthropic' rather
// than matching every platform that shares this name. Falls back to any-platform match.
function _findModel(models, value, platformId) {
  const pid = platformId || 'anthropic';
  return models.find(x => x.value === value && x.platform_id === pid)
    || models.find(x => x.value === value);
}

const _capIcon = (type, size = 11) => {
  const labels = { vision: 'Vision', tools: 'Tools', local: 'Local model' };
  const label = labels[type] || '';
  if (type === 'vision') return `<span title="${label}" style="display:inline-flex"><svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></span>`;
  if (type === 'tools') return `<span title="${label}" style="display:inline-flex"><svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>`;
  if (type === 'local') return `<span title="${label}" style="display:inline-flex"><svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/></svg></span>`;
  return '';
};

function _capIconsHtml(m, size = 11) {
  let h = '';
  if (m.local) h += _capIcon('local', size);
  if (m.vision) h += _capIcon('vision', size);
  if (m.tools) h += _capIcon('tools', size);
  return h;
}

let _dropdownSelected = null;

// model_config is stored as a JSON string (or already-parsed object). Extract platform_id safely —
// a model name can exist in multiple platforms, so the dropdown needs it to disambiguate.
function parsePlatformId(modelConfig) {
  if (!modelConfig) return null;
  try {
    const cfg = typeof modelConfig === 'string' ? JSON.parse(modelConfig) : modelConfig;
    return cfg?.platform_id || null;
  } catch { return null; }
}

function populateModelDropdown(ignored, currentModel, currentPlatformId, overrideModels) {
  const list = document.getElementById('model-dropdown-list');
  const textEl = document.getElementById('model-dropdown-text');
  const badgesEl = document.getElementById('model-capability-badges');
  if (!list || !textEl) return;

  const models = overrideModels || getAvailableModels();
  list.innerHTML = '';
  const hasMultiplePlatforms = models.some(m => m.platform !== 'anthropic');

  const makeOption = (m) => {
    const div = document.createElement('div');
    div.className = 'h-model-option';
    div.dataset.value = m.value;
    if (m.base_url) div.dataset.baseUrl = m.base_url;
    if (m.platform_id) div.dataset.platformId = m.platform_id;
    const icons = _capIconsHtml(m);
    div.innerHTML = `<span>${escHtml(m.label)}</span>${m.custom ? '<span class="h-model-custom-tag">custom</span>' : ''}${icons ? `<span class="h-model-cap-icons">${icons}</span>` : ''}`;
    div.addEventListener('click', () => selectModelOption(m.value, m.platform_id));
    return div;
  };

  if (hasMultiplePlatforms) {
    const seen = new Set();
    for (const m of models) {
      if (seen.has(m.platform)) continue;
      seen.add(m.platform);
      const header = document.createElement('div');
      header.className = 'h-model-optgroup';
      header.textContent = m.platform === 'anthropic' ? 'Anthropic' : m.platform;
      list.appendChild(header);
      for (const pm of models.filter(x => x.platform === m.platform).sort((a, b) => a.label.localeCompare(b.label))) {
        list.appendChild(makeOption(pm));
      }
    }
  } else {
    for (const m of models) list.appendChild(makeOption(m));
  }

  const target = currentModel || 'claude-sonnet-4-6';
  _setDropdownValue(target, models, currentPlatformId);
}

function _setDropdownValue(value, models, platformId) {
  if (!models) models = getAvailableModels();
  const list = document.getElementById('model-dropdown-list');
  const textEl = document.getElementById('model-dropdown-text');
  const badgesEl = document.getElementById('model-capability-badges');
  if (!list || !textEl) return;

  _dropdownSelected = value;
  // No platform → Anthropic native model, so default to 'anthropic'. Highlighting must match the
  // same single platform, otherwise a model name shared across platforms double-highlights.
  const pid = platformId || 'anthropic';
  const m = _findModel(models, value, pid);
  textEl.textContent = m ? m.label : value;
  if (badgesEl) badgesEl.innerHTML = m ? _capIconsHtml(m, 13) : '';

  list.querySelectorAll('.h-model-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.value === value && el.dataset.platformId === pid);
  });
}

function selectModelOption(value, platformId) {
  _setDropdownValue(value, null, platformId);
  const list = document.getElementById('model-dropdown-list');
  if (list) list.classList.remove('open');

  if (!currentRoomId || !ws) return;
  const models = getAvailableModels();
  const m = _findModel(models, value, platformId);
  const msg = { type: 'set_room_model', model: value };
  if (m?.platform_id && m.platform_id !== 'anthropic') {
    msg.model_config = { platform_id: m.platform_id, base_url: m.base_url || '' };
  } else {
    msg.model_config = null;
  }
  ws.send(JSON.stringify(msg));
}

function updateModelSelector(room, parts) {
  const wrap = document.getElementById('model-selector-wrap');
  if (!wrap) return;
  const hasAIAgent = (parts || []).some(p => p.type === 'ai');
  wrap.style.display = hasAIAgent ? 'flex' : 'none';
  if (hasAIAgent) {
    const aiPart = (parts || []).find(p => p.type === 'ai');
    const aiActor = aiPart ? allActors.find(a => a.id === aiPart.actor_id) : null;
    const harness = aiActor?.adapter || 'claude';
    const harnessModels = harness !== 'claude'
      ? (_agentHarnessModels(aiActor?.harness_status, harness) || getModelsForHarness(harness))
      : null;
    populateModelDropdown(null, room.model, parsePlatformId(room.model_config), harnessModels);
    handleModelUpdate({ model: room.model || 'claude-sonnet-4-6' });
    _refreshModelResolution();
  }
}

function refreshModelDropdownForActor(actorId) {
  if (!currentRoomId || !currentRoomData) return;
  const parts = roomParticipantsCache[currentRoomId] || [];
  const aiPart = parts.find(p => p.type === 'ai');
  if (aiPart?.actor_id === actorId) updateModelSelector(currentRoomData, parts);
  _refreshModelResolution();
}

// ── Per-agent model resolution preview ──────────────────────────────────────
let _roomModelResolutionCache = null;

async function _refreshModelResolution() {
  if (!currentRoomId) return;
  const roomId = currentRoomId;
  _roomModelResolutionCache = null;
  _updateResolutionPreview();
  try {
    const data = await fjson(`/api/rooms/${roomId}/model-resolution`);
    if (currentRoomId === roomId) {
      _roomModelResolutionCache = data;
      _updateResolutionPreview();
    }
  } catch {
    // endpoint not yet available — preview stays hidden
  }
}

const _RESOLUTION_SOURCE_LABELS = {
  agent_default: '↪ agent default',
  harness_default: '↪ harness default',
  cli_default: '↪ CLI default',
};

function _updateResolutionPreview() {
  const list = document.getElementById('model-dropdown-list');
  if (!list) return;
  const old = list.querySelector('.h-model-resolution-section');
  if (old) old.remove();
  const rows = _roomModelResolutionCache;
  if (!Array.isArray(rows) || !rows.length) return;
  const hasFallback = rows.some(r => r.source && r.source !== 'room');
  if (rows.length === 1 && !hasFallback) return;

  const section = document.createElement('div');
  section.className = 'h-model-resolution-section';

  const sep = document.createElement('div');
  sep.className = 'h-model-optgroup';
  sep.textContent = 'model per agent';
  section.appendChild(sep);

  for (const res of rows) {
    const row = document.createElement('div');
    row.className = 'h-model-resolution-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'h-model-resolution-name';
    nameEl.textContent = res.name || `#${res.actor_id}`;

    const harnessEl = document.createElement('span');
    harnessEl.className = 'h-model-resolution-harness';
    harnessEl.textContent = `· ${res.harness || 'claude'}`;

    const arrow = document.createElement('span');
    arrow.className = 'h-model-resolution-arrow';
    arrow.textContent = '→';

    const modelEl = document.createElement('span');
    modelEl.className = 'h-model-resolution-model';
    modelEl.textContent = res.model || 'CLI default';

    row.append(nameEl, harnessEl, arrow, modelEl);

    const sourceLabel = res.source && _RESOLUTION_SOURCE_LABELS[res.source];
    if (sourceLabel) {
      const sourceEl = document.createElement('span');
      sourceEl.className = 'h-model-resolution-source';
      sourceEl.textContent = sourceLabel;
      row.appendChild(sourceEl);
    }

    section.appendChild(row);
  }

  list.appendChild(section);
}

document.getElementById('model-dropdown-trigger')?.addEventListener('click', function(e) {
  e.stopPropagation();
  const list = document.getElementById('model-dropdown-list');
  if (!list) return;
  const isOpen = list.classList.toggle('open');
  if (isOpen && _dropdownSelected) {
    const sel = list.querySelector('.h-model-option.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
});

document.addEventListener('click', () => {
  document.getElementById('model-dropdown-list')?.classList.remove('open');
});

function mentionPopupNavigate(dir) {
  if (!isMentionPopupOpen()) return false;
  const popup = mentionPopupEl();
  const items = popup.querySelectorAll('.h-mention-item');
  if (!items.length) return false;
  items[mentionPopupIdx]?.classList.remove('active');
  mentionPopupIdx = (mentionPopupIdx + dir + items.length) % items.length;
  items[mentionPopupIdx].classList.add('active');
  return true;
}


