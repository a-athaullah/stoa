// ── Themes tab ───────────────────────────────────────────────────────────────
// Each card's preview carries its own data-theme, so the swatch is painted by
// the same base.css tokens as the real UI — no palette is duplicated in JS.
const THEME_GROUPS = [
  { scheme: 'light', label: 'Light' },
  { scheme: 'dark', label: 'Dark' },
];

function sMakeThemePreview(id) {
  const pv = document.createElement('div');
  pv.className = 's-theme-preview';
  pv.dataset.theme = id;
  pv.setAttribute('aria-hidden', 'true');
  const rail = document.createElement('span');
  rail.className = 's-theme-pv-rail';
  const side = document.createElement('span');
  side.className = 's-theme-pv-side';
  for (let i = 0; i < 3; i++) {
    const line = document.createElement('span');
    line.className = 's-theme-pv-line';
    side.appendChild(line);
  }
  const main = document.createElement('span');
  main.className = 's-theme-pv-main';
  const bubble = document.createElement('span');
  bubble.className = 's-theme-pv-bubble';
  bubble.textContent = 'Aa';
  const accent = document.createElement('span');
  accent.className = 's-theme-pv-accent';
  main.append(bubble, accent);
  pv.append(rail, side, main);
  return pv;
}

function sMakeThemeCard(theme) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 's-theme-card';
  card.dataset.themeId = theme.id;
  const foot = document.createElement('span');
  foot.className = 's-theme-card-foot';
  const name = document.createElement('span');
  name.className = 's-theme-name';
  name.textContent = theme.label;
  const check = document.createElement('span');
  check.className = 's-theme-check';
  check.setAttribute('aria-hidden', 'true');
  check.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  foot.append(name, check);
  card.append(sMakeThemePreview(theme.id), foot);
  card.addEventListener('click', () => {
    setTheme(theme.id);
    sSyncThemeCards();
  });
  return card;
}

function sSyncThemeCards() {
  const active = currentTheme();
  document.querySelectorAll('#s-themes-list .s-theme-card').forEach(card => {
    const on = card.dataset.themeId === active;
    card.classList.toggle('active', on);
    card.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function sRenderThemesTab() {
  const list = document.getElementById('s-themes-list');
  if (!list) return;
  if (!list.childElementCount) {
    THEME_GROUPS.forEach(group => {
      const label = document.createElement('div');
      label.className = 's-theme-group-label';
      label.id = 's-theme-group-' + group.scheme;
      label.textContent = group.label;
      const grid = document.createElement('div');
      grid.className = 's-theme-grid';
      grid.setAttribute('role', 'group');
      grid.setAttribute('aria-labelledby', label.id);
      THEMES.filter(t => t.scheme === group.scheme).forEach(t => grid.appendChild(sMakeThemeCard(t)));
      list.append(label, grid);
    });
  }
  sSyncThemeCards();
}
