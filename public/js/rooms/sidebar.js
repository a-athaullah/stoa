// ── Composer seal ──────────────────────────────────────────────────────────
function renderComposerSeal() {
  const el = document.getElementById('composer-seal');
  if (!el || !humanActor) return;
  el.innerHTML = '';
  el.appendChild(makeAvatar(humanActor.name, humanActor.avatar_color, humanActor.avatar_url, 24));
}

// ── Sidebar footer (human actor) ────────────────────────────────────────────
function renderSidebarFooter() {
  const footer = document.getElementById('sidebar-footer');
  if (!humanActor) return;
  if (typeof updateAppNavAvatar === 'function') updateAppNavAvatar();
  footer.innerHTML = '';
  footer.appendChild(makeAvatar(humanActor.name, humanActor.avatar_color, humanActor.avatar_url, 22));
  const nameEl = document.createElement('span');
  nameEl.className = 'h-footer-name';
  nameEl.textContent = humanActor.name.toLowerCase();
  footer.appendChild(nameEl);
  const conn = document.createElement('span');
  conn.className = 'h-conn-status';
  conn.innerHTML = '<span class="h-conn-dot"></span><span class="h-conn-label">offline</span>';
  footer.appendChild(conn);
  const isDark = document.documentElement.classList.contains('dark');
  const themeBtn = document.createElement('button');
  themeBtn.id = 'theme-toggle';
  themeBtn.className = 'h-theme-btn';
  themeBtn.setAttribute('aria-label', 'toggle theme');
  themeBtn.title = isDark ? 'switch to light' : 'switch to dark';
  themeBtn.innerHTML = isDark ? SUN_SVG : MOON_SVG;
  themeBtn.onclick = toggleTheme;
  footer.appendChild(themeBtn);
}

