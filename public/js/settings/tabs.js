// ── Settings tab switching ────────────────────────────────────────────────────
const SETTINGS_TAB_LABELS = {
  agents: 'AI Agent', server: 'server', general: 'general', docs: 'docs',
  platforms: 'platforms', automation: 'automation', usage: 'usage', doctor: 'doctor',
};

function sActivateTab(name) {
  document.querySelectorAll('.s-tab[data-tab]').forEach(el => {
    const isActive = el.dataset.tab === name;
    el.classList.toggle('active', isActive);
  });
  ['agents', 'server', 'general', 'docs', 'platforms', 'automation', 'usage', 'doctor'].forEach(t => {
    const el = document.getElementById('s-tab-' + t);
    if (el) el.style.display = t === name ? '' : 'none';
  });
  const titleEl = document.getElementById('s-page-title');
  if (titleEl) titleEl.textContent = SETTINGS_TAB_LABELS[name] || name;
  if (name === 'server')     sLoadServerTab();
  if (name === 'general')    sLoadGeneralTab();
  if (name === 'docs')       sLoadDocsTab();
  if (name === 'platforms')   sLoadPlatformsTab();
  if (name === 'automation') sLoadAutomationTab();
  if (name === 'usage')      sLoadUsageTab();
  if (name === 'doctor')     sLoadDoctorTab();
}

