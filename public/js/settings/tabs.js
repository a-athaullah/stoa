// ── Settings tab switching ────────────────────────────────────────────────────
function sActivateTab(name) {
  document.querySelectorAll('.s-tab[data-tab]').forEach(el => {
    const isActive = el.dataset.tab === name;
    el.classList.toggle('active', isActive);
  });
  ['agents', 'server', 'general', 'docs', 'platforms', 'automation', 'usage'].forEach(t => {
    const el = document.getElementById('s-tab-' + t);
    if (el) el.style.display = t === name ? '' : 'none';
  });
  if (name === 'server')     sLoadServerTab();
  if (name === 'general')    sLoadGeneralTab();
  if (name === 'docs')       sLoadDocsTab();
  if (name === 'platforms')   sLoadPlatformsTab();
  if (name === 'automation') sLoadAutomationTab();
  if (name === 'usage')      sLoadUsageTab();
}

