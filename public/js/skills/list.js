// ── Skills tab: list page ────────────────────────────────────────────────────
const SK_ICON_PLUS = ['M12 5v14', 'M5 12h14'];
const SK_ICON_CHEVRON = ['M6 9l6 6 6-6'];

function skillsRender() {
  const host = document.getElementById('s-tab-skills');
  if (!host) return;
  skillsState.view = 'list';
  const scrollY = host.scrollTop;
  const searchFocused = document.activeElement?.id === 'sk-search';
  const inner = skEl('div', 's-content-inner sk-root');

  const head = skEl('div', 'sk-head');
  const titles = skEl('div', 'sk-head-titles');
  titles.appendChild(skEl('p', 'sk-intro', 'Reusable instructions, with optional scripts and assets, that any agent or sub-agent can run. Type /name in a message to use one.'));
  head.appendChild(titles);
  head.appendChild(skMakeNewMenu());
  inner.appendChild(head);

  if (!skillsState.loaded) {
    inner.appendChild(skEl('div', 'sk-muted', skillsState.loadError ? `Couldn’t load skills: ${skillsState.loadError}` : 'Loading skills…'));
    if (skillsState.loadError) inner.appendChild(skBtn('auto-small-btn', 'Retry', () => { skillsState.loadError = null; skillsRender(); sLoadSkillsTab(); }));
    host.replaceChildren(inner);
    return;
  }

  if (!skillsState.skills.length) {
    inner.appendChild(skMakeEmptyState());
  } else {
    inner.appendChild(skMakeToolbar());
    const rows = skillsFiltered();
    if (!rows.length) {
      inner.appendChild(skEl('div', 'sk-muted', 'No skills match this filter.'));
    } else {
      const list = skEl('ul', 'sk-list');
      list.setAttribute('aria-label', 'Skills');
      rows.forEach(s => list.appendChild(skMakeRow(s)));
      inner.appendChild(list);
    }
  }

  host.replaceChildren(inner);
  host.scrollTop = scrollY;
  if (searchFocused) {
    const search = document.getElementById('sk-search');
    search?.focus();
    search?.setSelectionRange(search.value.length, search.value.length);
  }
  skBindDropZone(host);
}

function skMakeNewMenu() {
  const wrap = skEl('div', 'sk-new');
  const btn = skBtn('auto-save-btn sk-new-btn', 'New skill');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.appendChild(skIcon(SK_ICON_CHEVRON, 13));
  const menu = skEl('div', 'sk-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const close = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
  };
  const onOutside = e => { if (!wrap.contains(e.target)) close(); };
  const item = (label, hint, fn) => {
    const it = skBtn('sk-menu-item', null, () => { close(); fn(); });
    it.setAttribute('role', 'menuitem');
    it.appendChild(skEl('span', 'sk-menu-label', label));
    if (hint) it.appendChild(skEl('span', 'sk-menu-hint', hint));
    menu.appendChild(it);
  };
  item('Write from scratch', 'Start from a SKILL.md template', () => skillsOpenEditor(null));
  item('Import file', '.md, .zip, .skill, .tar.gz', () => skPickFiles(false));
  item('Import folder', 'A folder with SKILL.md', () => skPickFiles(true));
  item('Import from GitHub', 'Public repository URL', () => skOpenImportDialog({ kind: 'url' }));
  btn.addEventListener('click', () => {
    const open = menu.hidden;
    if (!open) { close(); return; }
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    menu.querySelector('.sk-menu-item')?.focus();
  });
  menu.addEventListener('keydown', e => {
    const items = [...menu.querySelectorAll('.sk-menu-item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
    else if (e.key === 'Tab') close();
  });
  wrap.append(btn, menu);
  return wrap;
}

function skMakeEmptyState() {
  const box = skEl('div', 'sk-empty');
  box.appendChild(skEl('div', 'sk-empty-title', 'No skills yet'));
  box.appendChild(skEl('p', 'sk-empty-body', 'A skill is a folder with a SKILL.md file: a name, a one-line description and the steps to follow. Scripts, templates or images can sit next to it. Skills exported from Claude Code or claude.ai import as they are.'));
  const actions = skEl('div', 'sk-empty-actions');
  actions.appendChild(skBtn('auto-save-btn', 'Write a skill', () => skillsOpenEditor(null)));
  actions.appendChild(skBtn('auto-cancel-btn', 'Import a file', () => skPickFiles(false)));
  box.appendChild(actions);
  box.appendChild(skEl('p', 'sk-empty-hint', 'You can also drop a file or folder anywhere on this page.'));
  return box;
}

function skMakeToolbar() {
  const bar = skEl('div', 'sk-toolbar');
  const search = skEl('input', 'sk-search');
  search.id = 'sk-search';
  search.type = 'search';
  search.placeholder = 'Search skills';
  search.setAttribute('aria-label', 'Search skills');
  search.value = skillsState.query;
  search.addEventListener('input', () => { skillsState.query = search.value; skillsRender(); });
  bar.appendChild(search);

  const chips = skEl('div', 'sk-filters');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Filter');
  SKILL_FILTERS.forEach(f => {
    const count = f.id === 'all' ? skillsState.skills.length
      : f.id === 'mine' ? skillsState.skills.filter(skIsMine).length
      : f.id === 'agents' ? skillsState.skills.filter(s => !skIsMine(s)).length
      : skillsState.skills.filter(s => !s.enabled).length;
    const b = skBtn('sk-filter', f.label, () => { skillsState.filter = f.id; skillsRender(); });
    b.setAttribute('aria-pressed', skillsState.filter === f.id ? 'true' : 'false');
    b.appendChild(skEl('span', 'sk-filter-count', String(count)));
    chips.appendChild(b);
  });
  bar.appendChild(chips);
  return bar;
}

function skMakeRow(s) {
  const li = skEl('li', 'sk-row' + (s.enabled ? '' : ' sk-row-disabled'));
  li.dataset.skillId = s.id;

  const main = skBtn('sk-row-main', null, () => skillsOpenEditor(s.id), `Edit /${s.name}`);
  const top = skEl('span', 'sk-row-top');
  top.appendChild(skEl('span', 'sk-row-name', '/' + s.name));
  if (!s.enabled) top.appendChild(skEl('span', 'sk-badge', 'Disabled'));
  main.appendChild(top);
  main.appendChild(skEl('span', 'sk-row-desc', s.description || ''));
  const meta = skEl('span', 'sk-row-meta');
  meta.appendChild(skCreatorEl(s));
  meta.appendChild(skEl('span', 'sk-row-size', skSizeLine(s)));
  const when = skEl('span', 'sk-row-when', _relativeTime(s.updated_at));
  if (s.updated_at) when.title = mcpLocalTime(s.updated_at);
  meta.appendChild(when);
  main.appendChild(meta);
  li.appendChild(main);

  const side = skEl('div', 'sk-row-side');
  if (skillsState.confirmDeleteId === s.id) {
    side.appendChild(skEl('span', 'sk-confirm-text', `Delete /${s.name}?`));
    const busy = skillsState.busy.has(s.id);
    const yes = skBtn('mcp-danger-btn', busy ? 'Deleting…' : 'Delete', () => skillsDelete(s));
    yes.disabled = busy;
    const no = skBtn('auto-small-btn', 'Cancel', () => { skillsState.confirmDeleteId = null; skillsRender(); });
    no.disabled = busy;
    side.append(yes, no);
  } else {
    side.appendChild(mcpSwitch(!!s.enabled, s.enabled ? `Disable /${s.name}` : `Enable /${s.name}`, async next => {
      const ok = await skillsToggleEnabled(s, next);
      if (ok) skillsRender();
      return ok;
    }));
    side.appendChild(skBtn('s-icon-btn sk-icon-btn', null, () => { skillsState.confirmDeleteId = s.id; skillsRender(); }, `Delete /${s.name}`))
      .appendChild(skIcon(['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6']));
  }
  li.appendChild(side);
  return li;
}
