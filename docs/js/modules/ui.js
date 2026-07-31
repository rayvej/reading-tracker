/**
 * UI Utilities, Toast Notifications, Theme Management & Navigation
 */

let toastTimer = null;

export function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}

export function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  const inner = t.querySelector('div');
  if (inner) inner.textContent = msg;

  if (type === 'success') {
    inner.style.borderColor = 'rgba(52, 211, 153, 0.4)';
    inner.style.boxShadow = '0 10px 30px -10px rgba(52, 211, 153, 0.3)';
  } else if (type === 'error') {
    inner.style.borderColor = 'rgba(248, 113, 113, 0.4)';
    inner.style.boxShadow = '0 10px 30px -10px rgba(248, 113, 113, 0.3)';
  } else {
    inner.style.borderColor = 'var(--border-strong)';
    inner.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.5)';
  }

  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

export function updateMetaThemeColor(isLight) {
  const meta = document.getElementById('theme-color-meta');
  if (meta) {
    meta.setAttribute('content', isLight ? '#FAF8F5' : '#120A13');
  }
}

export function setEditorialTheme(themeName) {
  themeName = themeName || 'espresso';
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem('rt_editorial_theme', themeName);

  document.querySelectorAll('.theme-select-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === themeName);
  });
}

export function setEditorialMode(mode) {
  mode = mode || 'dark';
  document.documentElement.setAttribute('data-mode', mode);
  localStorage.setItem('rt_editorial_mode', mode);
  localStorage.setItem('rt_theme', mode);

  const isLight = mode === 'light';
  updateMetaThemeColor(isLight);

  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.classList.toggle('fa-sun', isLight);
    icon.classList.toggle('fa-moon', !isLight);
  }

  const acctIcon = document.getElementById('acct-mode-icon');
  if (acctIcon) {
    acctIcon.classList.toggle('fa-sun', isLight);
    acctIcon.classList.toggle('fa-moon', !isLight);
  }
}

export function switchTab(tabName) {
  document.querySelectorAll('.tab-screen').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const targetScreen = document.getElementById(`screen-${tabName}`);
  if (targetScreen) targetScreen.classList.remove('hidden');

  const navItem = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  if (navItem) navItem.classList.add('active');

  localStorage.setItem('rt_active_tab', tabName);
}

export function debounce(fn, delay = 300) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function throttle(fn, limit = 300) {
  let inThrottle = false;
  return function(...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

let activeFocusTrap = null;
let previousActiveElement = null;

export function trapFocus(containerEl) {
  if (!containerEl) return;
  previousActiveElement = document.activeElement;
  
  const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const getFocusables = () => Array.from(containerEl.querySelectorAll(focusableSelector))
    .filter(el => !el.disabled && el.offsetParent !== null && el.style.display !== 'none');
  
  const focusables = getFocusables();
  if (focusables.length > 0) {
    focusables[0].focus();
  }

  const keyHandler = (e) => {
    if (e.key !== 'Tab') return;
    const currentFocusables = getFocusables();
    if (currentFocusables.length === 0) return;
    const first = currentFocusables[0];
    const last = currentFocusables[currentFocusables.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        last.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  };

  containerEl.addEventListener('keydown', keyHandler);
  activeFocusTrap = { containerEl, keyHandler };
}

export function releaseFocus() {
  if (activeFocusTrap) {
    const { containerEl, keyHandler } = activeFocusTrap;
    containerEl.removeEventListener('keydown', keyHandler);
    activeFocusTrap = null;
  }
  if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
    previousActiveElement.focus();
    previousActiveElement = null;
  }
}

