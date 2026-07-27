/**
 * PWA Install Prompt Handler & iOS Installation Banner
 * Provides a $0 zero-cost installation prompt experience for all mobile users.
 */

let deferredPrompt = null;

export function initPWAInstallPrompt() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

  // Listen for beforeinstallprompt on Android/Desktop Chrome
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner('chrome');
  });

  // If on iOS and not yet installed in standalone mode, display iOS guide
  if (isIOS && !isStandalone) {
    // Show banner after 5 seconds of initial load
    setTimeout(() => {
      const hasDismissed = localStorage.getItem('pwa_ios_banner_dismissed');
      if (!hasDismissed) {
        showInstallBanner('ios');
      }
    }, 4000);
  }
}

function showInstallBanner(type) {
  const existing = document.getElementById('pwa-install-banner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.className = 'fixed bottom-4 left-4 right-4 z-50 bg-slate-900/95 text-white p-4 rounded-2xl shadow-2xl border border-slate-700 backdrop-blur-md flex items-center justify-between animate-fade-in';

  if (type === 'chrome') {
    banner.innerHTML = `
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 bg-amber-500/20 text-amber-400 rounded-xl flex items-center justify-center font-bold text-lg">
          📚
        </div>
        <div>
          <h4 class="text-sm font-semibold">Install Reading Tracker</h4>
          <p class="text-xs text-slate-400">Add to home screen for offline access</p>
        </div>
      </div>
      <div class="flex items-center space-x-2">
        <button id="pwa-install-btn" class="px-3 py-1.5 bg-amber-500 text-slate-950 font-bold rounded-lg text-xs hover:bg-amber-400 transition-all">
          Install
        </button>
        <button id="pwa-dismiss-btn" class="text-slate-400 hover:text-white p-1 text-sm">✕</button>
      </div>
    `;
  } else if (type === 'ios') {
    banner.innerHTML = `
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 bg-sky-500/20 text-sky-400 rounded-xl flex items-center justify-center font-bold text-lg">
          📱
        </div>
        <div class="pr-2">
          <h4 class="text-sm font-semibold">Add to Home Screen</h4>
          <p class="text-xs text-slate-400">Tap <span class="text-sky-400 font-semibold">Share <i class="fa-solid fa-arrow-up-from-bracket"></i></span> then <strong>Add to Home Screen</strong></p>
        </div>
      </div>
      <button id="pwa-dismiss-btn" class="text-slate-400 hover:text-white p-1 text-sm">✕</button>
    `;
  }

  document.body.appendChild(banner);

  const installBtn = banner.querySelector('#pwa-install-btn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          banner.remove();
        }
        deferredPrompt = null;
      }
    });
  }

  const dismissBtn = banner.querySelector('#pwa-dismiss-btn');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      if (type === 'ios') {
        localStorage.setItem('pwa_ios_banner_dismissed', 'true');
      }
      banner.remove();
    });
  }
}
