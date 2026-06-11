// ── PWA Install Banner (mobile only) ─────────────────────────────────────
(function() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  let deferredPrompt = null;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!isMobile || isStandalone) return;
  if (localStorage.getItem('stoa-install-dismissed')) return;

  const banner = document.createElement('div');
  banner.className = 'h-install-banner';
  banner.innerHTML = `
    <div class="h-install-banner-row">
      <img class="h-install-banner-icon" src="/stoa-icon.svg" alt="Stoa">
      <div class="h-install-banner-text">
        <div class="h-install-banner-title">Install Stoa</div>
        <div class="h-install-banner-sub">Add to home screen for quick access</div>
      </div>
    </div>
    <div class="h-install-banner-actions">
      <button class="h-install-btn-dismiss">Not now</button>
      <button class="h-install-btn-add">Install</button>
    </div>`;
  document.body.appendChild(banner);

  banner.querySelector('.h-install-btn-dismiss').addEventListener('click', () => {
    banner.classList.remove('visible');
    localStorage.setItem('stoa-install-dismissed', '1');
  });

  banner.querySelector('.h-install-btn-add').addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') localStorage.setItem('stoa-install-dismissed', '1');
      deferredPrompt = null;
    }
    banner.classList.remove('visible');
  });

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    banner.classList.add('visible');
  });

  // On HTTP (non-localhost), beforeinstallprompt won't fire — show manual instructions
  setTimeout(() => {
    if (!deferredPrompt && !banner.classList.contains('visible')) {
      const isAndroid = /Android/i.test(navigator.userAgent);
      banner.querySelector('.h-install-btn-add').textContent = 'OK';
      banner.querySelector('.h-install-banner-sub').textContent = isAndroid
        ? 'Tap menu (⋮) → Add to Home Screen'
        : 'Tap Share → Add to Home Screen';
      banner.classList.add('visible');
    }
  }, 3000);
})();

