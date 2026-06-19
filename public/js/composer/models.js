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
    const mentionMatch = text.match(/(^|\s)@([^\s]*)$/);
    if (skillMatch) {
      showSkillPopup(skillMatch[2]);
      hideMentionPopup();
    } else if (mentionMatch) {
      showMentionPopup(mentionMatch[2]);
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
  if (!names.length) return html;
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(${escaped.join('|')})(?=\\s|[.,!?;:]|$)`, 'g');
  return html.replace(re, (match, name) => '<span class="h-mention-inline">@' + wsEscHtml(name) + '</span>');
}

// ── Mention autocomplete ──────────────────────────────────────────────────
function showMentionPopup(query) {
  const popup = document.getElementById('mention-popup');
  const parts = roomParticipantsCache[currentRoomId] || [];
  const q = query.toLowerCase();
  const matches = parts.filter(p => p.actor_id !== humanActor?.id && p.name.toLowerCase().startsWith(q)).slice(0, 7);
  if (!matches.length) { hideMentionPopup(); return; }

  popup.innerHTML = '';
  mentionPopupIdx = 0;
  matches.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'h-mention-item';
    item.dataset.idx = i;
    item.appendChild(makeAvatar(p.name, p.avatar_color, p.avatar_url, 22));
    const name = document.createElement('span');
    name.className = 'h-mention-name';
    name.textContent = p.name;
    item.appendChild(name);
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
  document.getElementById('mention-popup').style.display = 'none';
  mentionPopupIdx = -1;
}

function applyMention(name) {
  const input = document.getElementById('msg-input');
  const sel = window.getSelection();
  if (!sel.rangeCount) { hideMentionPopup(); return; }
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
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
];

let allServerModels = null;

async function fetchPlatformModels() {
  try {
    const groups = await fjson('/api/ai/models');
    allServerModels = [];
    for (const g of groups) {
      const platKey = g.platform_id === 'anthropic' ? 'anthropic' : g.platform_name;
      for (const m of g.models) {
        allServerModels.push({ value: m.value, label: m.label, vision: m.vision || false, tools: m.tools || false, local: m.local || false, platform: platKey, platform_id: g.platform_id, base_url: g.base_url || '' });
      }
    }
    populateModelDropdown();
  } catch {}
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

function populateModelDropdown(ignored, currentModel, currentPlatformId) {
  const list = document.getElementById('model-dropdown-list');
  const textEl = document.getElementById('model-dropdown-text');
  const badgesEl = document.getElementById('model-capability-badges');
  if (!list || !textEl) return;

  const models = getAvailableModels();
  list.innerHTML = '';
  const hasMultiplePlatforms = models.some(m => m.platform !== 'anthropic');

  const makeOption = (m) => {
    const div = document.createElement('div');
    div.className = 'h-model-option';
    div.dataset.value = m.value;
    if (m.base_url) div.dataset.baseUrl = m.base_url;
    if (m.platform_id) div.dataset.platformId = m.platform_id;
    const icons = _capIconsHtml(m);
    div.innerHTML = `<span>${m.label}</span>${icons ? `<span class="h-model-cap-icons">${icons}</span>` : ''}`;
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
    populateModelDropdown(null, room.model, parsePlatformId(room.model_config));
    handleModelUpdate({ model: room.model || 'claude-sonnet-4-6' });
  }
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
  const popup = document.getElementById('mention-popup');
  if (popup.style.display === 'none') return false;
  const items = popup.querySelectorAll('.h-mention-item');
  if (!items.length) return false;
  items[mentionPopupIdx]?.classList.remove('active');
  mentionPopupIdx = (mentionPopupIdx + dir + items.length) % items.length;
  items[mentionPopupIdx].classList.add('active');
  return true;
}


