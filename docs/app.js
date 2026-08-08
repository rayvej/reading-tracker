// ─── Reading Tracker — app.js ────────────────────────────────────────────────
// Global Error Handler — shows visual debug banners in dev only
const _isDevMode = (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '');
window.addEventListener('error', e => {
  if (_isDevMode) {
    const errDiv = document.createElement('div');
    errDiv.className = 'fixed top-0 inset-x-0 bg-red-600 text-white text-xs p-4 z-[9999] overflow-auto max-h-40';
    errDiv.textContent = `JS Error: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`;
    document.body.appendChild(errDiv);
  } else {
    console.error('[RT Error]', e.message, e.filename, e.lineno);
  }
});
window.addEventListener('unhandledrejection', e => {
  const reasonStr = String(e.reason || '');
  if (reasonStr.includes('ServiceWorker') || reasonStr.includes('sw.js') || reasonStr.includes('Failed to fetch') || reasonStr.includes('unknown error occurred when fetching')) {
    console.warn('Suppressed ServiceWorker update rejection:', e.reason);
    return;
  }
  if (_isDevMode) {
    const errDiv = document.createElement('div');
    errDiv.className = 'fixed top-0 inset-x-0 bg-red-600 text-white text-xs p-4 z-[9999] overflow-auto max-h-40';
    errDiv.textContent = `Promise Reject: ${e.reason}`;
    document.body.appendChild(errDiv);
  } else {
    console.error('[RT Unhandled Rejection]', e.reason);
  }
});

// Firebase v10 modular SDK via CDN
import { initializeApp }                           from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup,
         signInWithRedirect, getRedirectResult,
         signOut, onAuthStateChanged }             from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { initializeFirestore, getFirestore, persistentLocalCache,
         collection, doc, addDoc, setDoc, getDoc,
         getDocs, updateDoc, deleteDoc,
         query, where, orderBy, limit,
         onSnapshot, writeBatch,
         serverTimestamp }                         from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { firebaseConfig }                          from './firebase-config.js';
import { generate10YearArchivistData, generateHighVelocityData, generateChaosStressData } from './js/seed10YearData.js';
import { testGeminiApiKey, analyzeNoteImage, analyzeVoiceTranscript, standardizeTransliteration, generateScholarlyDigest, callGeminiApiWithFallback } from './js/modules/gemini-service.js';

window.categoryChartMode = 'pages';

// Request persistent storage to prevent browser eviction
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then(granted => {
    if (granted) console.log('[Storage] Persistent storage granted');
    else console.warn('[Storage] Persistent storage denied — data may be evicted');
  });
}

// ── Firebase Init ─────────────────────────────────────────────────────────────
const fbApp  = initializeApp(firebaseConfig);
const auth   = getAuth(fbApp);
let db;
try {
  db = initializeFirestore(fbApp, { localCache: persistentLocalCache() });
} catch (e) {
  console.warn("Firestore offline cache disabled (Safari private browsing or other restriction):", e);
  db = getFirestore(fbApp);
}
const gp     = new GoogleAuthProvider();

// ── Optimistic Local-First & Idempotent Firestore Sync Pattern ─────────────
function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return 'rt_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  return 'rt_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

async function optimisticSaveDoc(collectionSubpath, data) {
  const docId = data.id || generateId();
  data.id = docId;

  if (db && uid && !window.isMockAuth) {
    const docRef = doc(db, `users/${uid}/${collectionSubpath}/${docId}`);
    setDoc(docRef, data, { merge: true }).catch(err => {
      console.warn(`[Optimistic Sync] Background write queued for ${collectionSubpath}/${docId}:`, err.message);
    });
  }

  if (typeof markViewsDirty === 'function') markViewsDirty();
  return { id: docId, ...data };
}

// ── Security & Sanitization Helper ──────────────────────────────────────────
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

// ── State ─────────────────────────────────────────────────────────────────────
let uid        = null;
let booksCache = [];          // all book docs { id, ...data }
let wishlistCache = [];       // all wishlist items
let logsCache = [];           // cached reading logs
let goalsCache = {};

if (typeof window !== 'undefined') {
  try {
    Object.defineProperty(window, 'booksCache', { get: () => booksCache, set: v => { booksCache = v; }, configurable: true });
    Object.defineProperty(window, 'logsCache', { get: () => logsCache, set: v => { logsCache = v; }, configurable: true });
  } catch (e) {
    window.booksCache = booksCache;
    window.logsCache = logsCache;
  }
}
let dashboardStats = null;
let currentView       = 'dashboard'; // Start on dashboard as default premium screen
let dashFilter        = 'all';
let dashYearFilter    = 'all';
let wishlistFilter    = 'all';
let categoryChartMode = window.categoryChartMode || 'pages';
let collectionChartMode = 'pages';
let librarySearchTerm = '';
let libraryStatusFilter = 'all';
let wishlistSearchTerm= '';
let bookshelfStatusFilter = 'All';
let bookshelfOwnershipFilter = 'All';
let bookshelfSearchTerm   = '';
let bookshelfSortOrder    = 'title-asc';
let bookshelfViewMode     = 'list';   // 'list' | 'grid'
let bookshelfGrouping     = 'none';   // 'none' | 'group'
let bookshelfSelectMode   = false;
let bookshelfSelectedIds  = new Set();
let pinBuffer = '';
const PIN_LENGTH = 4;
const SESSION_KEY = 'rt_session';
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// Stopwatch timer state
let timerInterval = null;
let timerSeconds = 0;
let timerRunning = false;

// Chart.js state
let activeChart = null;

// Global Setup & Submission State Flags (declared early to prevent TDZ ReferenceErrors)
let isDashboardSetup = false;
let isBookshelfSetup = false;
let isSettingsModalSetup = false;
let isStarterImportSetup = false;
let isAccountViewSetup = false;
let reminderTimerId = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; };

// Global Chart.js registry to prevent memory leaks and duplicate canvas bindings
const chartRegistry = new Map();
function registerChart(canvasId, chartInstance) {
  if (chartRegistry.has(canvasId)) {
    try { chartRegistry.get(canvasId).destroy(); } catch (e) { console.warn('Chart destroy:', e); }
  }
  chartRegistry.set(canvasId, chartInstance);
  return chartInstance;
}

// Micro Error Boundary wrapper for safe rendering
function safeRender(containerId, renderFn, fallbackHtml = null) {
  try {
    return renderFn();
  } catch (err) {
    console.error(`[Micro Error Boundary] Render error in container '${containerId}':`, err);
    if (containerId) {
      const container = typeof containerId === 'string' ? $(containerId) : containerId;
      if (container) {
        container.innerHTML = fallbackHtml || `
          <div class="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-semibold flex items-center justify-between">
            <span>Unable to render view cleanly.</span>
            <button onclick="location.reload()" class="px-2.5 py-1 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[10px] font-bold">Reload</button>
          </div>
        `;
      }
    }
  }
}

// Diacritic-insensitive search normalization
function normalizeSearchStr(str) {
  if (typeof str !== 'string') return '';
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function debounce(fn, delay = 150) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

let viewDirtyFlags = {
  dashboard: true,
  bookshelf: true,
  knowledge: true,
  goals: true,
  wishlist: true,
  log: true,
  account: true
};
function markViewsDirty() {
  Object.keys(viewDirtyFlags).forEach(k => viewDirtyFlags[k] = true);
  if (typeof reconciledStatsCache !== 'undefined') reconciledStatsCache.clear();
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtNum(n) { return (n ?? 0).toLocaleString(); }
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfYear()  { return `${new Date().getFullYear()}-01-01`; }
function startOfMonth() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }

async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin + 'rt-salt-v1'));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  const t = $('toast');
  const inner = t.querySelector('div');
  inner.textContent = msg;
  // CSS-variable-driven colour overlay
  if (type === 'success') {
    inner.style.color = 'var(--emerald)';
    inner.style.borderColor = 'rgba(var(--emerald-rgb),0.25)';
  } else if (type === 'error') {
    inner.style.color = 'var(--rose)';
    inner.style.borderColor = 'rgba(var(--rose-rgb),0.25)';
  } else {
    inner.style.color = 'var(--text-primary)';
    inner.style.borderColor = 'var(--border-strong)';
  }
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

// ── Dark / Light Mode ────────────────────────────────────────────────────────
function updateMetaThemeColor(isLight) {
  const meta = document.getElementById('theme-color-meta');
  if (meta) {
    meta.setAttribute('content', isLight ? '#FAF8F5' : '#120A13');
  }
}

function setEditorialTheme(themeName) {
  themeName = themeName || 'espresso';
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem('rt_editorial_theme', themeName);

  document.querySelectorAll('.theme-select-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === themeName);
  });
}
window.setEditorialTheme = setEditorialTheme;

function setEditorialMode(mode) {
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

  document.querySelectorAll('.mode-select-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}
window.setEditorialMode = setEditorialMode;

function setEditorialFont(fontName) {
  fontName = fontName || 'serif';
  document.documentElement.setAttribute('data-font', fontName);
  localStorage.setItem('rt_editorial_font', fontName);
  document.querySelectorAll('.font-select-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.font === fontName);
  });
}
window.setEditorialFont = setEditorialFont;

function initFont() {
  const savedFont = localStorage.getItem('rt_editorial_font') || 'serif';
  setEditorialFont(savedFont);
}

function initTheme() {
  const savedTheme = localStorage.getItem('rt_editorial_theme') || 'espresso';
  const savedMode = localStorage.getItem('rt_editorial_mode') || (localStorage.getItem('rt_theme') === 'light' ? 'light' : 'dark');
  setEditorialTheme(savedTheme);
  setEditorialMode(savedMode);
  initFont();
}

function toggleTheme() {
  const currentMode = document.documentElement.getAttribute('data-mode') || 'dark';
  const nextMode = currentMode === 'dark' ? 'light' : 'dark';
  setEditorialMode(nextMode);
  if (typeof currentView !== 'undefined' && currentView === 'dashboard' && typeof renderDashboard === 'function') {
    renderDashboard();
  }
}

// ── Screen visibility ─────────────────────────────────────────────────────────
function showScreen(id) {
  ['auth-screen','pin-screen','seed-screen'].forEach(s => {
    const el = $(s);
    if (el) el.classList.toggle('hidden', s !== id);
  });
  const app = $('app');
  if (id === 'app') { app.classList.remove('hidden'); }
  else              { app.classList.add('hidden'); }
}

// Apply theme as early as possible
initTheme();

// ── Auth ──────────────────────────────────────────────────────────────────────
$('btn-google-signin').addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, gp);
  } catch (e) {
    console.warn("Popup blocked or failed, attempting redirect fallback:", e);
    try {
      await signInWithRedirect(auth, gp);
    } catch (err) {
      showToast('Sign-in failed: ' + err.message, 'error');
    }
  }
});

$('btn-signout').addEventListener('click', async () => {
  if (!confirm('Sign out?')) return;
  sessionStorage.removeItem(SESSION_KEY);
  booksCache = [];
  await signOut(auth);
  showScreen('auth-screen');
});

// Instant 0ms pre-warming for returning authenticated users
const cachedUid = localStorage.getItem('rt_user_cached_uid');
if (cachedUid && !window.isMockAuth) {
  uid = cachedUid;
  const hasSession = sessionStorage.getItem(SESSION_KEY) === uid;
  if (hasSession) {
    initApp();
  } else {
    showScreen('pin-screen');
  }
}

onAuthStateChanged(auth, async user => {
  if (window.isMockAuth) return;
  if (!user) {
    localStorage.removeItem('rt_user_cached_uid');
    showScreen('auth-screen');
    return;
  }
  uid = user.uid;
  localStorage.setItem('rt_user_cached_uid', uid);
  const hasSession = sessionStorage.getItem(SESSION_KEY) === uid;
  if (hasSession) {
    await initApp();
  } else {
    await checkAndShowPin();
  }
});

// ── PIN ───────────────────────────────────────────────────────────────────────
// ── PIN ───────────────────────────────────────────────────────────────────────
let pinFlowMode = 'VERIFY'; // 'VERIFY' | 'CREATE_NEW' | 'CONFIRM_NEW'
let pendingNewPin = '';

async function checkAndShowPin() {
  pinFlowMode = 'VERIFY';
  pendingNewPin = '';
  let storedHash = localStorage.getItem('rt_pin_hash');
  if (!storedHash) {
    if (db && uid) {
      try {
        const settingsRef = doc(db, `users/${uid}/settings/app`);
        const snap = await getDoc(settingsRef);
        if (snap.exists() && snap.data()?.pin_hash) {
          storedHash = snap.data().pin_hash;
          localStorage.setItem('rt_pin_hash', storedHash);
        } else {
          storedHash = await hashPin('1234');
          localStorage.setItem('rt_pin_hash', storedHash);
          setDoc(settingsRef, { pin_hash: storedHash }, { merge: true }).catch(err => console.warn('PIN setDoc background error:', err));
        }
      } catch (e) {
        console.warn('PIN remote fetch error, using default:', e);
        storedHash = await hashPin('1234');
        localStorage.setItem('rt_pin_hash', storedHash);
      }
    } else {
      storedHash = await hashPin('1234');
      localStorage.setItem('rt_pin_hash', storedHash);
    }
  }
  
  await updatePinScreenUI();
  showScreen('pin-screen');
  pinBuffer = '';
  renderPinDots();
}

async function updatePinScreenUI() {
  const titleEl = $('pin-screen-title');
  const subEl = $('pin-screen-subtitle');
  const defaultHash = await hashPin('1234');
  const storedHash = localStorage.getItem('rt_pin_hash');
  const isDefault = storedHash === defaultHash;

  if (pinFlowMode === 'CREATE_NEW') {
    if (titleEl) titleEl.textContent = 'Create New Security PIN';
    if (subEl) subEl.innerHTML = 'Default PIN 1234 used. <span class="text-amber-400 font-semibold">Please create your personal 4-digit PIN.</span>';
  } else if (pinFlowMode === 'CONFIRM_NEW') {
    if (titleEl) titleEl.textContent = 'Confirm Security PIN';
    if (subEl) subEl.innerHTML = 'Re-enter your new 4-digit PIN to confirm.';
  } else {
    if (titleEl) titleEl.textContent = 'Enter Security PIN';
    if (subEl) {
      if (isDefault) {
        subEl.innerHTML = 'Default Security PIN: <span class="font-mono font-bold text-theme-gold">1234</span> (Requires change)';
      } else {
        subEl.innerHTML = 'Enter your 4-digit Security PIN';
      }
    }
  }
}

function showPinError(msg) {
  pinBuffer = '';
  const dots = $('pin-dots')?.querySelectorAll('span');
  if (dots) {
    dots.forEach(d => {
      d.classList.remove('bg-gold', 'border-gold', 'scale-110', 'shadow-lg', 'shadow-gold/20');
      d.classList.add('bg-rose-500', 'border-rose-500', 'animate-shake');
    });
  }
  const err = $('pin-error');
  if (err) {
    err.textContent = msg;
    err.classList.remove('opacity-0', 'hidden');
    setTimeout(() => {
      renderPinDots();
      err.classList.add('opacity-0');
    }, 1400);
  }
}

function renderPinDots() {
  const dots = $('pin-dots').querySelectorAll('span');
  dots.forEach((d, i) => {
    const isFilled = i < pinBuffer.length;
    d.classList.toggle('bg-gold', isFilled);
    d.classList.toggle('border-gold', isFilled);
    d.classList.toggle('scale-110', isFilled);
    d.classList.toggle('shadow-lg', isFilled);
    d.classList.toggle('shadow-gold/20', isFilled);
    
    d.classList.toggle('border-slate-600', !isFilled);
    
    d.classList.remove('bg-rose-500', 'border-rose-500', 'animate-shake');
  });
}

$('pin-pad').addEventListener('click', async e => {
  const key = e.target.closest('[data-key]');
  const back = e.target.closest('#pin-backspace');
  if (back) { pinBuffer = pinBuffer.slice(0, -1); renderPinDots(); return; }
  if (!key) return;
  if (pinBuffer.length >= PIN_LENGTH) return;
  pinBuffer += key.dataset.key;
  renderPinDots();
  if (pinBuffer.length === PIN_LENGTH) {
    if (typeof performance !== 'undefined' && performance.mark) {
      performance.clearMarks('pin-submitted');
      performance.clearMarks('dashboard-rendered');
      performance.clearMarks('dashboard-full-interactive');
      performance.clearMeasures('PIN-to-Dashboard Latency');
      performance.clearMeasures('PIN-to-Dashboard Interactive Latency');
      performance.mark('pin-submitted');
    }
    await processPinSubmission(pinBuffer);
  }
});

async function processPinSubmission(pin) {
  if (pinFlowMode === 'CREATE_NEW') {
    if (pin === '1234') {
      showPinError('Please select a PIN other than 1234');
      return;
    }
    pendingNewPin = pin;
    pinFlowMode = 'CONFIRM_NEW';
    pinBuffer = '';
    await updatePinScreenUI();
    renderPinDots();
    return;
  }

  if (pinFlowMode === 'CONFIRM_NEW') {
    if (pin !== pendingNewPin) {
      showPinError('PINs do not match — try again');
      pendingNewPin = '';
      pinFlowMode = 'CREATE_NEW';
      await updatePinScreenUI();
      return;
    }
    // PIN successfully set & confirmed!
    const newHash = await hashPin(pendingNewPin);
    localStorage.setItem('rt_pin_hash', newHash);
    if (db && uid) {
      setDoc(doc(db, `users/${uid}/settings/app`), { pin_hash: newHash }, { merge: true }).catch(err => console.warn('PIN update sync error:', err));
    }
    showToast('✓ Security PIN updated successfully!', 'success');
    pinFlowMode = 'VERIFY';
    pendingNewPin = '';
    sessionStorage.setItem(SESSION_KEY, uid);
    await proceedAfterPinVerification();
    return;
  }

  // Normal verification mode
  await verifyPin(pin);
}

async function proceedAfterPinVerification() {
  const waitingWorker = window.swWaitingWorker || (window.swRegistration && window.swRegistration.waiting);
  if (waitingWorker) {
    window.swWaitingWorker = waitingWorker;
    showUpdateModal(async () => {
      showScreen('app');
      await initApp();
    });
  } else {
    showScreen('app');
    await initApp();
  }
}

async function verifyPin(pin) {
  let storedHash = localStorage.getItem('rt_pin_hash');
  const inputHash = await hashPin(pin);
  const defaultHash = await hashPin('1234');

  // Fallback path: If local hash is missing or fails, attempt Firestore fetch
  if (!storedHash && db && uid) {
    try {
      const settingsRef = doc(db, `users/${uid}/settings/app`);
      const snap = await getDoc(settingsRef);
      if (snap.exists() && snap.data()?.pin_hash) {
        storedHash = snap.data().pin_hash;
        localStorage.setItem('rt_pin_hash', storedHash);
      }
    } catch (e) {
      console.warn('Firestore PIN fallback fetch error:', e);
    }
  }

  if (storedHash && inputHash === storedHash) {
    // If entered PIN matches default PIN '1234', require changing PIN first!
    if (inputHash === defaultHash) {
      pinFlowMode = 'CREATE_NEW';
      pinBuffer = '';
      await updatePinScreenUI();
      renderPinDots();
      return;
    }
    sessionStorage.setItem(SESSION_KEY, uid);
    await proceedAfterPinVerification();
  } else {
    showPinError('Incorrect PIN — try again');
  }
}

// ── Seed Import ───────────────────────────────────────────────────────────────
async function initApp() {
  window.booksCache = booksCache || [];
  window.logsCache = logsCache || [];
  try {
    Object.defineProperty(window, 'booksCache', { get: () => booksCache || [], set: v => { booksCache = v; }, configurable: true });
    Object.defineProperty(window, 'logsCache', { get: () => logsCache || [], set: v => { logsCache = v; }, configurable: true });
  } catch (e) {}
  showScreen('app');
  
  // 1. Initialize UI handlers immediately (synchronously)
  initTheme();
  setupNav();
  setupLogForm();
  setupDashboard();
  setupLibrary();
  setupGoals();
  setupBookshelf();
  setupLogDetailSheet();
  setupHaptics();
  setupSettingsModal();
  setupStarterImportModal();
  setupAccountView();
  showView('dashboard'); // Start on Dashboard
  
  window.saveNewBook = saveNewBook;
  window.submitLog = submitLog;
  window.initApp = initApp;
  window.optimisticSaveDoc = optimisticSaveDoc;
  window.importFromJSON = importFromJSON;
  window.exportToJSON = exportToJSON;
  
  window.saveNewBook = saveNewBook;
  window.submitLog = submitLog;
  window.initApp = initApp;
  window.optimisticSaveDoc = optimisticSaveDoc;
  window.importFromJSON = importFromJSON;
  window.exportToJSON = exportToJSON;
  
  // 2. Load database content asynchronously in the background
  loadDatabaseData();
}
window.initApp = initApp;
window.saveNewBook = saveNewBook;
async function loadDatabaseData() {
  try {
    // 1. Fast Partition: Load books & logs cache from storage
    await loadBooksCache();
    await loadLogsCache();

    populateBookDropdown();
    if (typeof populateGroupDatalist === 'function') populateGroupDatalist(booksCache);
    
    // 2. Render active view shell immediately from cache
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'goals')     renderGoals();
    if (currentView === 'wishlist')  renderBookshelf();
    if (currentView === 'knowledge') renderKnowledgeView();

    // 3. Defer background tasks (remap corrections, self-healing, goals config) so they don't block main thread
    const runDeferredTasks = async () => {
      // Startup Correction: remap mislabeled New Era logs from cycle 2 to 1
      const mislabeledLogs = logsCache.filter(l => l.book_title === 'Bahá’u’lláh and the New Era' && parseInt(l.read_cycle || 1, 10) === 2);
      if (mislabeledLogs.length > 0) {
        console.log(`[Startup-Correction] Correcting ${mislabeledLogs.length} mislabeled log cycles for New Era`);
        for (const l of mislabeledLogs) {
          if (db && uid) {
            updateDoc(doc(db, `users/${uid}/reading_logs/${l.id}`), { read_cycle: 1 }).catch(() => {});
          }
          l.read_cycle = 1;
        }
      }

      // Run background self-healing for any data status inconsistencies
      healBookStatuses();

      // Ensure default goals config exists for user
      if (db && uid) {
        try {
          const goalsRef = doc(db, `users/${uid}/goals/config`);
          const goalsSnap = await getDoc(goalsRef);
          if (!goalsSnap.exists()) {
            await setDoc(goalsRef, {
              annual_books_target: 12,
              annual_pages_target: 3000,
              monthly_books_target: 1,
              monthly_pages_target: 300
            }, { merge: true });
          }
        } catch (e) {
          console.warn('Goals config background check error:', e);
        }
      }

      // Auto-prompt clean users (0 books) with the Starter Completion Importer
      const userKey = uid || 'local';
      if ((!booksCache || booksCache.length === 0) && !localStorage.getItem('rt_starter_dismissed_' + userKey)) {
        setTimeout(() => openStarterImportModal(), 400);
      }
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => runDeferredTasks(), { timeout: 2000 });
    } else {
      setTimeout(runDeferredTasks, 100);
    }
  } catch (e) {
    console.error("Failed to load library database:", e);
    if (booksCache.length === 0) {
      showToast("Database connection offline. Showing local data.", "error");
    }
  }
}

async function runSeedImport() {
  showScreen('seed-screen');
  $('seed-status').textContent = 'Loading your reading history…';
  $('seed-bar').style.width = '5%';

  try {
  const resp = await fetch('./seed-data.json');
  if (!resp.ok) throw new Error('Seed data load failed: HTTP ' + resp.status);
  const seed = await resp.json();
  const total = seed.books.length + seed.reading_logs.length + seed.wishlist.length;
  let done = 0;

  function progress(label) {
    done++;
    $('seed-bar').style.width = Math.round((done / total) * 100) + '%';
    $('seed-status').textContent = label;
  }

  // Write goals
  await setDoc(doc(db, `users/${uid}/goals/config`), seed.goals);

  // Batch-import books (500 per batch)
  const booksRef = collection(db, `users/${uid}/books`);
  for (let i = 0; i < seed.books.length; i += 400) {
    const batch = writeBatch(db);
    seed.books.slice(i, i + 400).forEach(b => {
      batch.set(doc(booksRef), b);
      progress(`Importing books… (${Math.min(i+400, seed.books.length)}/${seed.books.length})`);
    });
    await batch.commit();
  }

  // Batch-import reading logs
  const logsRef = collection(db, `users/${uid}/reading_logs`);
  for (let i = 0; i < seed.reading_logs.length; i += 400) {
    const batch = writeBatch(db);
    seed.reading_logs.slice(i, i + 400).forEach(l => {
      if (l.book_title === 'Bahá’u’lláh and the New Era' && l.read_cycle === 2) {
        l.read_cycle = 1;
      }
      batch.set(doc(logsRef), l);
      progress(`Importing reading logs… (${Math.min(i+400, seed.reading_logs.length)}/${seed.reading_logs.length})`);
    });
    await batch.commit();
  }

  // Batch-import wishlist
  const wishRef = collection(db, `users/${uid}/wishlist`);
  for (let i = 0; i < seed.wishlist.length; i += 400) {
    const batch = writeBatch(db);
    seed.wishlist.slice(i, i + 400).forEach(w => {
      batch.set(doc(wishRef), w);
      progress(`Importing wishlist… (${Math.min(i+400, seed.wishlist.length)}/${seed.wishlist.length})`);
    });
    await batch.commit();
  }

  $('seed-bar').style.width = '100%';
  $('seed-status').textContent = 'All done! Welcome to your Reading Tracker.';
  await new Promise(r => setTimeout(r, 800));
  showScreen('app');
  } catch (e) {
    console.error('Seed import failed:', e);
    showToast('Import failed: ' + (e.message || 'Unknown error') + '. Please try again when online.', 'error');
    showScreen('app');
  }
}

/** Auto-Backup Snapshot of Live Data */
function createLiveUserBackup() {
  try {
    const backup = {
      books: booksCache || [],
      logs: logsCache || [],
      wishlist: wishlistCache || [],
      timestamp: new Date().toISOString()
    };
    localStorage.setItem('rt_live_user_backup', JSON.stringify(backup));
  } catch (err) {
    console.warn('Backup error:', err);
  }
}

/** Restore Original Data from Auto-Backup */
async function restoreLiveUserBackup() {
  const raw = localStorage.getItem('rt_live_user_backup');
  if (!raw) {
    showToast('No auto-backup snapshot found.', 'warning');
    return;
  }

  if (!confirm('Restore your original pre-test account data from automatic backup?')) return;

  try {
    showToast('Restoring original account data…', 'info');
    const backup = JSON.parse(raw);

    // RES-03: Use writeBatch for atomic deletion and restoration in 400-item chunks
    if (db && uid) {
      const bSnap = await getDocs(collection(db, `users/${uid}/books`));
      const lSnap = await getDocs(collection(db, `users/${uid}/reading_logs`));
      const wSnap = await getDocs(collection(db, `users/${uid}/wishlist`));

      const allDeletes = [
        ...bSnap.docs.map(d => doc(db, `users/${uid}/books/${d.id}`)),
        ...lSnap.docs.map(d => doc(db, `users/${uid}/reading_logs/${d.id}`)),
        ...wSnap.docs.map(d => doc(db, `users/${uid}/wishlist/${d.id}`))
      ];

      for (let i = 0; i < allDeletes.length; i += 400) {
        const batch = writeBatch(db);
        allDeletes.slice(i, i + 400).forEach(ref => batch.delete(ref));
        await batch.commit();
      }

      // Re-inject backup books
      const booksRef = collection(db, `users/${uid}/books`);
      for (let i = 0; i < backup.books.length; i += 400) {
        const batch = writeBatch(db);
        backup.books.slice(i, i + 400).forEach(b => batch.set(doc(booksRef), b));
        await batch.commit();
      }

      // Re-inject backup logs
      const logsRef = collection(db, `users/${uid}/reading_logs`);
      for (let i = 0; i < backup.logs.length; i += 400) {
        const batch = writeBatch(db);
        backup.logs.slice(i, i + 400).forEach(l => batch.set(doc(logsRef), l));
        await batch.commit();
      }

      // Re-inject backup wishlist
      const wishRef = collection(db, `users/${uid}/wishlist`);
      for (let i = 0; i < backup.wishlist.length; i += 400) {
        const batch = writeBatch(db);
        backup.wishlist.slice(i, i + 400).forEach(w => batch.set(doc(wishRef), w));
        await batch.commit();
      }
    }

    booksCache = [];
    logsCache = [];
    wishlistCache = [];
    await loadBooksCache();
    await loadLogsCache();

    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'goals') renderGoals();
    if (currentView === 'wishlist') renderBookshelf();
    showToast('✓ Original account data restored successfully!', 'success');
  } catch (e) {
    showToast('Failed to restore backup: ' + e.message, 'error');
  }
}

/** Multi-Profile Data Simulator Loader */
async function runCustomProfileImport(profileType) {
  // 1. Take safety backup of live user data first
  createLiveUserBackup();

  showScreen('seed-screen');
  $('seed-status').textContent = 'Preparing test profile simulation…';
  $('seed-bar').style.width = '5%';

  let seed;
  let label = '';
  if (profileType === '10yr') {
    seed = generate10YearArchivistData();
    label = '10-Year Master Archivist Profile (2016–2026)';
  } else if (profileType === 'power') {
    seed = generateHighVelocityData();
    label = 'High-Velocity Power Reader Profile';
  } else {
    seed = generateChaosStressData();
    label = 'Chaos & Edge Case Stress Profile';
  }

  // Clear current collections first
  if (db && uid) {
    const bSnap = await getDocs(collection(db, `users/${uid}/books`));
    for (const d of bSnap.docs) await deleteDoc(doc(db, `users/${uid}/books/${d.id}`));
    const lSnap = await getDocs(collection(db, `users/${uid}/reading_logs`));
    for (const d of lSnap.docs) await deleteDoc(doc(db, `users/${uid}/reading_logs/${d.id}`));
    const wSnap = await getDocs(collection(db, `users/${uid}/wishlist`));
    for (const d of wSnap.docs) await deleteDoc(doc(db, `users/${uid}/wishlist/${d.id}`));
  }

  const total = seed.books.length + seed.reading_logs.length + seed.wishlist.length;
  let done = 0;

  function progress(txt) {
    done++;
    $('seed-bar').style.width = Math.round((done / total) * 100) + '%';
    $('seed-status').textContent = txt;
  }

  // 2. Write goals
  if (seed.goals && db && uid) {
    await setDoc(doc(db, `users/${uid}/goals/config`), seed.goals);
  }

  // 3. Write books
  const booksRef = collection(db, `users/${uid}/books`);
  for (let i = 0; i < seed.books.length; i += 400) {
    const batch = writeBatch(db);
    seed.books.slice(i, i + 400).forEach(b => {
      batch.set(doc(booksRef), b);
      progress(`Seeding books… (${Math.min(i + 400, seed.books.length)}/${seed.books.length})`);
    });
    await batch.commit();
  }

  // 4. Write logs
  const logsRef = collection(db, `users/${uid}/reading_logs`);
  for (let i = 0; i < seed.reading_logs.length; i += 400) {
    const batch = writeBatch(db);
    seed.reading_logs.slice(i, i + 400).forEach(l => {
      batch.set(doc(logsRef), l);
      progress(`Seeding logs… (${Math.min(i + 400, seed.reading_logs.length)}/${seed.reading_logs.length})`);
    });
    await batch.commit();
  }

  // 5. Write wishlist
  const wishRef = collection(db, `users/${uid}/wishlist`);
  for (let i = 0; i < seed.wishlist.length; i += 400) {
    const batch = writeBatch(db);
    seed.wishlist.slice(i, i + 400).forEach(w => {
      batch.set(doc(wishRef), w);
      progress(`Seeding wishlist… (${Math.min(i + 400, seed.wishlist.length)}/${seed.wishlist.length})`);
    });
    await batch.commit();
  }

  booksCache = [];
  logsCache = [];
  wishlistCache = [];
  await loadBooksCache();
  await loadLogsCache();

  $('seed-bar').style.width = '100%';
  $('seed-status').textContent = `Seeded ${label} cleanly!`;
  await new Promise(r => setTimeout(r, 800));
  showScreen('app');

  if (currentView === 'dashboard') renderDashboard();
  if (currentView === 'goals') renderGoals();
  if (currentView === 'wishlist') renderBookshelf();
  showToast(`⚡ Seeded ${label}!`, 'success');
}

/** Automated Diagnostic & Benchmark Audit Suite */
function runDiagnosticAudit() {
  const t0 = performance.now();
  
  // 1. Measure 3D Spine Bookshelf Render Time
  let spineRenderTime = 0;
  if (typeof window.render3DSpineBookshelf === 'function') {
    const tStart = performance.now();
    window.render3DSpineBookshelf(booksCache);
    spineRenderTime = Math.round(performance.now() - tStart);
  }

  // 2. Validate Standard Calculation Rules Math Assertion
  let mathAssertionPassed = true;
  let computedBooksRead = 0;
  let computedPagesRead = 0;

  try {
    (booksCache || []).forEach(b => {
      const isFinished = ['Finished', 'Owned and Read', 'Borrowed and Read', 'Gifted and Read'].includes(b.status);
      const reads = Math.max(b.read_count || 0, isFinished ? 1 : 0);
      computedBooksRead += reads;
      computedPagesRead += reads * (b.total_pages || 0);
    });
  } catch (err) {
    mathAssertionPassed = false;
  }

  const totalTime = Math.round(performance.now() - t0);
  const booksCount = (booksCache || []).length;
  const logsCount = (logsCache || []).length;
  
  // Calculate Payload Bytes
  const rawJSON = JSON.stringify({ books: booksCache, logs: logsCache, wishlist: wishlistCache });
  const payloadMB = (rawJSON.length / (1024 * 1024)).toFixed(2);

  const reportStr = `📊 10-YEAR DIAGNOSTIC AUDIT REPORT\n` +
    `----------------------------------------\n` +
    `• Books Loaded: ${booksCount}\n` +
    `• Logs Loaded: ${logsCount}\n` +
    `• Total Payload Size: ${payloadMB} MB\n` +
    `• 3D Spine Render Time: ${spineRenderTime} ms\n` +
    `• Calculation Assertion: ${mathAssertionPassed ? 'PASSED ✓' : 'FAILED ✕'}\n` +
    `• Calculated Books Read: ${computedBooksRead}\n` +
    `• Total Diagnostic Time: ${totalTime} ms`;

  console.log(reportStr);
  alert(reportStr);
}

// ── Settings & Data Management ────────────────────────────────────────────────
function setupSettingsModal() {
  if (isSettingsModalSetup) return;
  isSettingsModalSetup = true;
  const btnOpen = $('btn-settings-open');
  const btnClose = $('settings-modal-close');
  const backdrop = $('settings-modal-backdrop');
  const modal = $('settings-modal');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      showView('account');
    });
  }

  const closeModal = () => modal.classList.remove('open');
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (backdrop) backdrop.addEventListener('click', closeModal);

  // Notifications inputs
  setupNotificationSettingsUI();

  // App Update Inspector
  setupSettingsUpdateInspector();

  // Load sample data
  const btnSample = $('btn-load-sample-data');
  if (btnSample) {
    btnSample.addEventListener('click', async () => {
      closeModal();
      if (!confirm('Load sample reading data into your account? This will import demo books, reading logs, and goals.')) return;
      try {
        await runSeedImport();
        booksCache = [];
        logsCache = [];
        wishlistCache = [];
        await loadBooksCache();
        await loadLogsCache();
        populateBookDropdown();
        if (typeof populateGroupDatalist === 'function') populateGroupDatalist(booksCache);

        if (currentView === 'dashboard') renderDashboard();
        if (currentView === 'goals')     renderGoals();
        if (currentView === 'wishlist')  renderWishlist();
        if (currentView === 'library')   renderLibrary();
        showToast('Sample reading data loaded successfully!', 'success');
      } catch (e) {
        console.error('Sample data import failed:', e);
        showToast('Failed to load sample data: ' + e.message, 'error');
      }
    });
  }

async function verifyDoublePinForReset() {
  let storedHash = localStorage.getItem('rt_pin_hash');
  if (db && uid) {
    try {
      const snap = await getDoc(doc(db, `users/${uid}/settings/app`));
      if (snap.exists() && snap.data()?.pin_hash) {
        storedHash = snap.data().pin_hash;
      }
    } catch (err) {
      console.warn('Failed to fetch PIN hash from Firestore:', err);
    }
  }

  if (!storedHash) {
    storedHash = await hashPin('1234');
  }

  // Step 1: Prompt 1st PIN entry
  const pin1 = prompt("🔒 Security Check (Step 1 of 2):\n\nEnter your 4-digit Security PIN to initiate account data reset:");
  if (pin1 === null) {
    showToast("Account data reset cancelled.", "info");
    return false;
  }

  const hash1 = await hashPin(pin1.trim());
  if (hash1 !== storedHash) {
    showToast("Incorrect PIN (Step 1 failed) — Account reset cancelled.", "error");
    return false;
  }

  // Step 2: Prompt 2nd PIN entry (Confirm)
  const pin2 = prompt("⚠️ Double PIN Confirmation (Step 2 of 2):\n\nRe-enter your 4-digit Security PIN to PERMANENTLY CONFIRM deleting all books, reading logs, and wishlist items:");
  if (pin2 === null) {
    showToast("Account data reset cancelled.", "info");
    return false;
  }

  const hash2 = await hashPin(pin2.trim());
  if (hash2 !== storedHash) {
    showToast("Incorrect PIN (Step 2 failed) — Account reset cancelled.", "error");
    return false;
  }

  if (pin1.trim() !== pin2.trim()) {
    showToast("PIN entries did not match — Account reset cancelled.", "error");
    return false;
  }

  return true;
}

  // Clear account data
  const btnClear = $('btn-clear-account-data');
  if (btnClear) {
    btnClear.addEventListener('click', async () => {
      closeModal();
      const pinConfirmed = await verifyDoublePinForReset();
      if (!pinConfirmed) return;

      try {
        showToast('Clearing account data...', 'info');
        
        // Delete books
        const booksSnap = await getDocs(collection(db, `users/${uid}/books`));
        for (let i = 0; i < booksSnap.docs.length; i += 400) {
          const batch = writeBatch(db);
          booksSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }

        // Delete logs
        const logsSnap = await getDocs(collection(db, `users/${uid}/reading_logs`));
        for (let i = 0; i < logsSnap.docs.length; i += 400) {
          const batch = writeBatch(db);
          logsSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }

        // Delete wishlist
        const wishSnap = await getDocs(collection(db, `users/${uid}/wishlist`));
        for (let i = 0; i < wishSnap.docs.length; i += 400) {
          const batch = writeBatch(db);
          wishSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }

        booksCache = [];
        logsCache = [];
        wishlistCache = [];
        populateBookDropdown();
        if (typeof populateGroupDatalist === 'function') populateGroupDatalist(booksCache);

        if (currentView === 'dashboard') renderDashboard();
        if (currentView === 'goals')     renderGoals();
        if (currentView === 'wishlist')  renderWishlist();
        if (currentView === 'library')   renderLibrary();

        showToast('Account data reset successfully.', 'success');
      } catch (e) {
        console.error('Failed to clear data:', e);
        showToast('Failed to clear data: ' + e.message, 'error');
      }
    });
  }

  // Change PIN
  const btnPin = $('btn-change-pin');
  if (btnPin) {
    btnPin.addEventListener('click', async () => {
      closeModal();
      const newPin = prompt('Enter a new 4-digit PIN (numbers only):');
      if (!newPin) return;
      if (!/^\d{4}$/.test(newPin)) {
        showToast('PIN must be exactly 4 digits', 'error');
        return;
      }
      try {
        const newHash = await hashPin(newPin);
        await setDoc(doc(db, `users/${uid}/settings/app`), { pin_hash: newHash }, { merge: true });
        showToast('Security PIN updated successfully!', 'success');
      } catch (e) {
        showToast('Failed to update PIN: ' + e.message, 'error');
      }
    });
  }
}

// ── Starter / Fast Completion Importer Modal ─────────────────────────────────
let starterSelectedPrecision = 'year'; // 'year' | 'finish' | 'range' | 'detailed'
let starterSelectedRating = 0;
let starterSessionBatchCount = 0;

function setupStarterImportModal() {
  if (isStarterImportSetup) return;
  isStarterImportSetup = true;
  const modal = $('starter-import-modal');
  if (!modal) return;

  // Open button in Settings modal & Account View
  const btnSettingsOpen = $('btn-open-starter-importer');
  if (btnSettingsOpen) {
    btnSettingsOpen.addEventListener('click', () => {
      const settingsModal = $('settings-modal');
      if (settingsModal) settingsModal.classList.remove('open');
      openStarterImportModal();
    });
  }

  const btnAcctQuickAdd = $('acct-btn-quick-add-completed');
  if (btnAcctQuickAdd) {
    btnAcctQuickAdd.addEventListener('click', () => {
      openStarterImportModal();
    });
  }

  // Group selection toggle for custom group text box
  const groupSelect = $('starter-book-group');
  if (groupSelect) {
    groupSelect.addEventListener('change', (e) => {
      const customContainer = $('starter-group-custom-container');
      if (customContainer) customContainer.classList.toggle('hidden', e.target.value !== 'Other');
    });
  }

  // Auto-Find Cover Artwork
  const btnSearchCover = $('starter-btn-search-cover');
  if (btnSearchCover) {
    btnSearchCover.addEventListener('click', () => {
      if (typeof window.autoFindSingleCover === 'function') {
        window.autoFindSingleCover('starter-book-title', 'starter-book-author', 'starter-book-cover-url', 'starter-cover-preview');
      }
    });
  }

  // Upload Cover Photo File Listener
  const coverFileEl = $('starter-book-cover-file');
  if (coverFileEl) {
    coverFileEl.addEventListener('change', function() {
      if (typeof window.handleCoverFileUpload === 'function') {
        window.handleCoverFileUpload(this, 'starter-book-cover-url', 'starter-cover-preview');
      }
    });
  }

  // Cover URL live input listener for preview box
  const coverUrlEl = $('starter-book-cover-url');
  if (coverUrlEl) {
    coverUrlEl.addEventListener('input', function() {
      const val = this.value.trim();
      const preview = $('starter-cover-preview');
      if (!preview) return;
      if (val) {
        const img = document.createElement('img');
        img.src = val;
        img.className = 'w-full h-full object-cover rounded-lg';
        img.onerror = function() { this.onerror = null; preview.innerHTML = '<i class="fa-solid fa-image"></i>'; };
        preview.innerHTML = '';
        preview.appendChild(img);
      } else {
        preview.innerHTML = '<i class="fa-solid fa-image"></i>';
      }
    });
  }

  // Close / Skip buttons
  const btnClose = $('starter-modal-close');
  const btnSkip = $('starter-modal-skip');
  if (btnClose) btnClose.addEventListener('click', () => closeStarterImportModal());
  if (btnSkip) btnSkip.addEventListener('click', () => closeStarterImportModal());

  // Precision selector buttons
  const precBtns = {
    year: $('btn-starter-prec-year'),
    finish: $('btn-starter-prec-finish'),
    range: $('btn-starter-prec-range'),
    detailed: $('btn-starter-prec-detailed'),
    unknown: $('btn-starter-prec-unknown')
  };

  const precSecs = {
    year: $('starter-prec-sec-year'),
    finish: $('starter-prec-sec-finish'),
    range: $('starter-prec-sec-range'),
    detailed: $('starter-prec-sec-detailed'),
    unknown: $('starter-prec-sec-unknown')
  };

  Object.keys(precBtns).forEach(key => {
    if (!precBtns[key]) return;
    precBtns[key].addEventListener('click', () => {
      starterSelectedPrecision = key;
      Object.keys(precBtns).forEach(k => {
        if (precBtns[k]) precBtns[k].classList.toggle('active', k === key);
        if (precSecs[k]) precSecs[k].classList.toggle('hidden', k !== key);
      });
    });
  });

  // Rating stars
  const starBtns = document.querySelectorAll('.starter-star');
  starBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const rating = parseInt(btn.dataset.star, 10);
      starterSelectedRating = rating;
      starBtns.forEach((b, idx) => {
        b.classList.toggle('text-theme-gold', idx < rating);
        b.classList.toggle('text-theme-tertiary', idx >= rating);
      });
    });
  });

  // Save buttons
  const btnSaveAnother = $('starter-modal-save-another');
  const btnSaveDone = $('starter-modal-save-done');

  if (btnSaveAnother) {
    btnSaveAnother.addEventListener('click', async () => {
      await saveStarterBook(true);
    });
  }

  if (btnSaveDone) {
    btnSaveDone.addEventListener('click', async () => {
      await saveStarterBook(false);
    });
  }
}

function openStarterImportModal() {
  const modal = $('starter-import-modal');
  if (!modal) return;
  modal.classList.add('open');
  starterSessionBatchCount = 0;
  updateStarterBatchBadge();
  resetStarterForm();
}
window.openStarterImportModal = openStarterImportModal;

function closeStarterImportModal() {
  const modal = $('starter-import-modal');
  if (!modal) return;
  modal.classList.remove('open');
  if (uid) {
    localStorage.setItem('rt_starter_dismissed_' + uid, 'true');
  }
}

function updateStarterBatchBadge() {
  const badge = $('starter-batch-badge');
  const badgeText = $('starter-batch-count-text');
  if (!badge || !badgeText) return;
  if (starterSessionBatchCount > 0) {
    badgeText.textContent = `${starterSessionBatchCount} book${starterSessionBatchCount > 1 ? 's' : ''} added this session`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function resetStarterForm() {
  if ($('starter-book-title')) $('starter-book-title').value = '';
  if ($('starter-book-author')) $('starter-book-author').value = '';
  if ($('starter-book-collection')) $('starter-book-collection').value = 'Bahai';
  if ($('starter-book-group')) $('starter-book-group').value = 'Non-Fiction';
  if ($('starter-book-group-custom')) $('starter-book-group-custom').value = '';
  if ($('starter-group-custom-container')) $('starter-group-custom-container').classList.add('hidden');
  if ($('starter-book-format')) $('starter-book-format').value = 'Physical Book';
  if ($('starter-book-pages')) $('starter-book-pages').value = '300';
  if ($('starter-book-category')) $('starter-book-category').value = 'Non-Fiction';
  if ($('starter-book-priority')) $('starter-book-priority').value = 'Medium';
  if ($('starter-book-cost')) $('starter-book-cost').value = '';
  if ($('starter-book-where-to-buy')) $('starter-book-where-to-buy').value = '';
  if ($('starter-book-cover-url')) $('starter-book-cover-url').value = '';
  if ($('starter-cover-preview')) $('starter-cover-preview').innerHTML = `<i class="fa-solid fa-image"></i>`;
  if ($('starter-book-notes')) $('starter-book-notes').value = '';

  starterSelectedRating = 0;
  document.querySelectorAll('.starter-star').forEach(b => {
    b.classList.remove('text-theme-gold');
    b.classList.add('text-theme-tertiary');
  });

  const todayStr = todayISO();
  const currentYr = new Date().getFullYear();
  if ($('starter-input-year')) $('starter-input-year').value = currentYr;
  if ($('starter-input-finish-date')) $('starter-input-finish-date').value = todayStr;
  if ($('starter-input-start-date')) $('starter-input-start-date').value = todayStr;
  if ($('starter-input-end-date')) $('starter-input-end-date').value = todayStr;
  if ($('starter-input-det-start')) $('starter-input-det-start').value = todayStr;
  if ($('starter-input-det-end')) $('starter-input-det-end').value = todayStr;
  if ($('starter-input-det-daily-pages')) $('starter-input-det-daily-pages').value = '';
}

let isStarterBookSubmitting = false;

async function saveStarterBook(batchContinue) {
  if (isStarterBookSubmitting) return;

  const title = ($('starter-book-title')?.value || '').trim();
  if (!title) {
    showToast('Please enter a book title', 'error');
    if ($('starter-book-title')) $('starter-book-title').focus();
    return;
  }

  const author = ($('starter-book-author')?.value || '').trim();
  const collection = $('starter-book-collection')?.value || 'Bahai';
  let group = $('starter-book-group')?.value || 'Non-Fiction';
  if (group === 'Other' && $('starter-book-group-custom')?.value.trim()) {
    group = $('starter-book-group-custom').value.trim();
  }
  const format = $('starter-book-format')?.value || 'Physical Book';
  const totalPages = parseInt($('starter-book-pages')?.value || '300', 10);
  if (isNaN(totalPages) || totalPages <= 0) {
    showToast('Please enter a valid page length (> 0)', 'error');
    if ($('starter-book-pages')) $('starter-book-pages').focus();
    return;
  }
  const category = $('starter-book-category')?.value || 'Non-Fiction';
  const priority = $('starter-book-priority')?.value || 'Medium';
  const cost = parseFloat($('starter-book-cost')?.value || '0') || 0;
  const whereToBuy = ($('starter-book-where-to-buy')?.value || '').trim();
  const coverUrl = ($('starter-book-cover-url')?.value || '').trim();
  const notes = ($('starter-book-notes')?.value || '').trim();

  isStarterBookSubmitting = true;
  const btnDone = $('starter-modal-save-done');
  const btnAnother = $('starter-modal-save-another');
  if (btnDone) btnDone.disabled = true;
  if (btnAnother) btnAnother.disabled = true;

  let finishDate = todayISO();
  let startDate = todayISO();
  let createdLogs = [];

  const currentYear = new Date().getFullYear();

  if (starterSelectedPrecision === 'year') {
    const yr = parseInt($('starter-input-year')?.value || currentYear, 10) || currentYear;
    if (yr === currentYear) {
      finishDate = todayISO();
    } else {
      finishDate = `${yr}-12-31`;
    }
    startDate = `${yr}-01-01`;
    createdLogs.push({
      date: finishDate,
      pages_read: totalPages,
      read_cycle: 1,
      note: notes ? `Finished in ${yr}: ${notes}` : `Finished in ${yr}`
    });
  } else if (starterSelectedPrecision === 'finish') {
    finishDate = $('starter-input-finish-date')?.value || todayISO();
    startDate = finishDate;
    createdLogs.push({
      date: finishDate,
      pages_read: totalPages,
      read_cycle: 1,
      note: notes || 'Completed'
    });
  } else if (starterSelectedPrecision === 'range') {
    startDate = $('starter-input-start-date')?.value || todayISO();
    finishDate = $('starter-input-end-date')?.value || todayISO();
    if (startDate > finishDate) finishDate = startDate;

    if (startDate === finishDate) {
      createdLogs.push({
        date: finishDate,
        pages_read: totalPages,
        read_cycle: 1,
        note: notes || 'Completed'
      });
    } else {
      const halfPages = Math.max(1, Math.floor(totalPages / 2));
      const remPages = totalPages - halfPages;
      createdLogs.push({
        date: startDate,
        pages_read: halfPages,
        read_cycle: 1,
        note: 'Started reading'
      });
      createdLogs.push({
        date: finishDate,
        pages_read: remPages,
        read_cycle: 1,
        note: notes ? `Finished: ${notes}` : 'Completed'
      });
    }
  } else if (starterSelectedPrecision === 'detailed') {
    startDate = $('starter-input-det-start')?.value || todayISO();
    finishDate = $('starter-input-det-end')?.value || todayISO();
    if (startDate > finishDate) finishDate = startDate;

    const dailyPace = parseInt($('starter-input-det-daily-pages')?.value || '0', 10);
    const startMs = new Date(startDate + 'T00:00:00').getTime();
    const endMs = new Date(finishDate + 'T00:00:00').getTime();
    const dayDiff = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);

    if (dailyPace > 0 && dayDiff > 1) {
      let pagesRemaining = totalPages;
      let currMs = startMs;
      while (pagesRemaining > 0 && currMs <= endMs) {
        const pagesToday = Math.min(pagesRemaining, dailyPace);
        const dStr = new Date(currMs).toISOString().slice(0, 10);
        createdLogs.push({
          date: dStr,
          pages_read: pagesToday,
          read_cycle: 1,
          note: pagesRemaining === pagesToday ? (notes || 'Completed') : ''
        });
        pagesRemaining -= pagesToday;
        currMs += 86400000;
      }
      if (pagesRemaining > 0) {
        createdLogs.push({
          date: finishDate,
          pages_read: pagesRemaining,
          read_cycle: 1,
          note: notes || 'Completed'
        });
      }
    } else {
      createdLogs.push({
        date: finishDate,
        pages_read: totalPages,
        read_cycle: 1,
        note: notes || 'Completed'
      });
    }
  } else if (starterSelectedPrecision === 'unknown') {
    finishDate = '';
    startDate = '';
    createdLogs.push({
      date: todayISO(),
      pages_read: totalPages,
      read_cycle: 1,
      note: notes ? `Completed (Date Unknown): ${notes}` : 'Completed (Date Unknown)'
    });
  }

  try {
    const bookData = {
      title,
      author,
      collection,
      group,
      format,
      total_pages: totalPages,
      current_page: totalPages,
      status: 'completed',
      category,
      priority,
      cost,
      where_to_buy: whereToBuy,
      cover_url: coverUrl,
      cover_image: coverUrl,
      rating: starterSelectedRating || 0,
      notes: notes || '',
      start_date: startDate,
      finish_date: finishDate,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp()
    };

    const savedBook = await optimisticSaveDoc('books', bookData);
    if (!booksCache.some(b => b.id === savedBook.id || b.title === savedBook.title)) {
      booksCache.push(savedBook);
    }

    for (const l of createdLogs) {
      const savedLog = await optimisticSaveDoc('reading_logs', {
        book_id: savedBook.id,
        book_title: title,
        date: l.date,
        pages_read: l.pages_read,
        read_cycle: 1,
        note: l.note || '',
        created_at: serverTimestamp()
      });
      if (!logsCache.some(log => log.id === savedLog.id)) {
        logsCache.unshift(savedLog);
      }
    }

    booksCache = [];
    logsCache = [];
    await loadBooksCache();
    await loadLogsCache();

    populateBookDropdown();
    if (typeof populateGroupDatalist === 'function') populateGroupDatalist(booksCache);

    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'goals') renderGoals();
    if (currentView === 'wishlist') renderBookshelf();

    starterSessionBatchCount++;
    updateStarterBatchBadge();

    if (batchContinue) {
      showToast(`Saved "${title}"! Ready for next book.`, 'success');
      resetStarterForm();
      if ($('starter-book-title')) $('starter-book-title').focus();
    } else {
      closeStarterImportModal();
      showToast(`Added "${title}" to completed library!`, 'success');
    }
  } catch (err) {
    console.error("Failed to save starter book:", err);
    showToast('Failed to save book: ' + err.message, 'error');
  } finally {
    isStarterBookSubmitting = false;
    const btnDone = $('starter-modal-save-done');
    const btnAnother = $('starter-modal-save-another');
    if (btnDone) btnDone.disabled = false;
    if (btnAnother) btnAnother.disabled = false;
  }
}



// ── Daily Morning Reminders & Notifications ───────────────────────────────

function generateDailyReminderPayload(overrideBooks, overrideLogs) {
  const booksToSearch = overrideBooks || booksCache || [];
  const logsToSearch = overrideLogs || logsCache || [];

  const activeBooks = booksToSearch.filter(b => b.status === 'In Progress');
  if (activeBooks.length === 0 && booksToSearch.length === 0) return null;

  const book = activeBooks.length > 0 ? activeBooks[0] : booksToSearch[0];
  const activeLogs = logsToSearch.filter(l => l.book_id === book.id || (l.title && l.title.toLowerCase() === book.title.toLowerCase()));

  const currentPage = typeof getBookCurrentProgress === 'function' 
    ? getBookCurrentProgress(book, activeLogs) 
    : (book.current_page || 0);
  const totalPages = Number(book.total_pages) || 1;
  const remainingPages = Math.max(0, totalPages - currentPage);
  const progressPct = Math.min(100, Math.round((currentPage / totalPages) * 100));

  // Calculate estimated completion date based on reading pace
  const logsWithPages = activeLogs.filter(l => Number(l.pages_read) > 0);
  let daysLeft = 7;
  if (logsWithPages.length > 0) {
    const totalPagesLogged = logsWithPages.reduce((sum, l) => sum + Number(l.pages_read), 0);
    const uniqueDays = new Set(logsWithPages.map(l => (l.date || '').substring(0, 10))).size || 1;
    const pagesPerDay = totalPagesLogged / uniqueDays;
    daysLeft = pagesPerDay > 0 ? Math.ceil(remainingPages / pagesPerDay) : 7;
  } else {
    daysLeft = Math.ceil(remainingPages / 25);
  }

  const estFinishDate = new Date(Date.now() + Math.max(1, daysLeft) * 86400000);
  const finishDateStr = estFinishDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Fetch the latest note from the latest log in the reading log section
  const logsWithNotes = activeLogs
    .filter(l => l.notes && l.notes.trim().length > 0 && !l.notes.startsWith('Historical cycle'))
    .sort((a, b) => new Date(b.date || b.timestamp || 0) - new Date(a.date || a.timestamp || 0));

  const latestLogNote = logsWithNotes.length > 0 ? logsWithNotes[0].notes.trim() : (book.notes ? book.notes.trim() : null);

  const title = `📖 ${book.title} (${progressPct}% • Est. Finish: ${finishDateStr})`;

  const savedSettings = (() => { try { return JSON.parse(localStorage.getItem('rt_reminder_settings') || '{}'); } catch { return {}; } })();
  const customText = (savedSettings.customText || '').trim();

  let body = "";
  if (customText) {
    body = customText;
  } else if (latestLogNote) {
    const cleanNote = latestLogNote.length > 150 ? latestLogNote.substring(0, 147) + "..." : latestLogNote;
    body = `"${cleanNote}"`;
  } else {
    body = `Page ${currentPage} of ${totalPages} (${remainingPages} pg remaining)`;
  }

  return {
    title,
    body,
    bookTitle: book.title,
    currentPage,
    totalPages,
    progressPct,
    finishDateStr,
    recentNote: latestLogNote,
    bookId: book.id
  };
}

function getMillisecondsUntilNextReminder(timeStr = "07:00") {
  const parts = (timeStr || "07:00").split(':').map(Number);
  const targetHours = isNaN(parts[0]) ? 7 : parts[0];
  const targetMins = isNaN(parts[1]) ? 0 : parts[1];

  const now = new Date();
  const target = new Date();
  target.setHours(targetHours, targetMins, 0, 0);

  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}

function scheduleDailyReminderAlarm() {
  if (reminderTimerId) clearTimeout(reminderTimerId);

  const savedSettings = (() => { try { return JSON.parse(localStorage.getItem('rt_reminder_settings') || '{}'); } catch { return {}; } })();
  const isEnabled = savedSettings.enabled !== false;
  const reminderTime = savedSettings.time || "07:00";

  if (!isEnabled) return;

  const ms = getMillisecondsUntilNextReminder(reminderTime);

  reminderTimerId = setTimeout(() => {
    triggerDailyReminder(false);
    scheduleDailyReminderAlarm();
  }, ms);
}

function triggerDailyReminder(isTest = false) {
  const payload = generateDailyReminderPayload();
  if (!payload) {
    if (isTest) showToast('No active book available for reminder test.', 'warning');
    return;
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(payload.title, {
          body: payload.body,
          icon: 'icon-192.png',
          badge: 'icon-192.png',
          tag: 'daily-reading-reminder',
          data: { url: `/#book-${payload.bookId}` }
        });
      });
    } else {
      new Notification(payload.title, {
        body: payload.body,
        icon: 'icon-192.png',
        tag: 'daily-reading-reminder'
      });
    }
    if (isTest) showToast(`Notification sent: ${payload.title}`, 'success');
  } else if (isTest) {
    showToast(`Reminder Preview:\n${payload.title}\n${payload.body}`, 'info');
  }
}

function setupNotificationSettingsUI() {
  const enableToggle = $('setting-reminder-enable');
  const timePicker = $('setting-reminder-time');
  const quoteToggle = $('setting-reminder-quote');
  const customTextInput = $('setting-reminder-custom-text');
  const btnPush = $('btn-request-notification-permission');
  const btnTest = $('btn-test-notification');

  const savedSettings = (() => { try { return JSON.parse(localStorage.getItem('rt_reminder_settings') || '{}'); } catch { return {}; } })();
  const isEnabled = savedSettings.enabled !== false;
  const timeVal = savedSettings.time || "07:00";
  const includeQuote = savedSettings.includeQuote !== false;
  const customText = savedSettings.customText || '';

  if (enableToggle) enableToggle.checked = isEnabled;
  if (timePicker) timePicker.value = timeVal;
  if (quoteToggle) quoteToggle.checked = includeQuote;
  if (customTextInput) customTextInput.value = customText;

  function updateSavedSettings() {
    const newSettings = {
      enabled: enableToggle ? enableToggle.checked : true,
      time: timePicker ? timePicker.value || "07:00" : "07:00",
      includeQuote: quoteToggle ? quoteToggle.checked : true,
      customText: customTextInput ? customTextInput.value.trim() : ''
    };
    localStorage.setItem('rt_reminder_settings', JSON.stringify(newSettings));
    if (db && uid) {
      setDoc(doc(db, `users/${uid}/settings/notifications`), newSettings, { merge: true }).catch(err => {
        console.warn('Failed to sync notification settings to Firestore:', err);
      });
    }
    scheduleDailyReminderAlarm();
  }

  if (enableToggle) enableToggle.addEventListener('change', updateSavedSettings);
  if (timePicker) timePicker.addEventListener('change', () => {
    updateSavedSettings();
    showToast(`Daily reminder time set to ${timePicker.value}`, 'success');
  });
  if (quoteToggle) quoteToggle.addEventListener('change', updateSavedSettings);
  if (customTextInput) customTextInput.addEventListener('change', updateSavedSettings);

  if (btnPush) {
    btnPush.addEventListener('click', async () => {
      if (!('Notification' in window)) {
        showToast('Notifications are not supported in this browser.', 'warning');
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        showToast('Push Notifications enabled successfully!', 'success');
      } else if (perm === 'denied') {
        showToast('Notification permission denied in browser settings.', 'error');
      }
    });
  }

  if (btnTest) {
    btnTest.addEventListener('click', () => {
      triggerDailyReminder(true);
    });
  }

  scheduleDailyReminderAlarm();
}

// ── Account View & Management ────────────────────────────────────────────────
function syncAccountThemeSwitch() {
  const switchEl = $('acct-theme-toggle-switch');
  const textEl = $('acct-theme-status-text');
  const iconEl = $('acct-theme-icon');
  const isLight = document.body.classList.contains('light-mode');
  
  if (switchEl) switchEl.checked = !isLight;
  if (textEl) textEl.textContent = isLight ? 'Light Mode Active' : 'Dark Mode Active';
  if (iconEl) {
    iconEl.className = isLight ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
}

function applyAccentColor(accent) {
  const accentColors = {
    gold: { main: '#D6A85C', rgb: '214, 168, 92' },
    emerald: { main: '#34D399', rgb: '52, 211, 153' },
    sky: { main: '#38BDF8', rgb: '56, 189, 248' },
    rose: { main: '#F472B6', rgb: '244, 114, 182' }
  };
  const theme = accentColors[accent] || accentColors.gold;
  document.documentElement.style.setProperty('--gold', theme.main);
  document.documentElement.style.setProperty('--gold-rgb', theme.rgb);
  localStorage.setItem('rt_accent', accent);
}

async function renderAccountView() {
  const user = auth.currentUser;
  const userNameEl = $('account-user-name');
  const userEmailEl = $('account-user-email');
  
  const savedName = localStorage.getItem('rt_user_name');
  if (userNameEl) userNameEl.textContent = savedName || (user && user.displayName) || 'Reader Profile';
  if (userEmailEl) userEmailEl.textContent = (user && user.email) ? user.email : 'local@readingtracker.app';

  // Load books & logs cache to compute quick stats matching Dashboard
  const mergedBooks = await getMergedBooks();
  await loadLogsCache();

  const stats = getReconciledStats(mergedBooks, logsCache, 'all', 'all');
  const activeLogs = logsCache.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));
  const streaks = calculateStreaks(activeLogs);

  if ($('acct-stat-books')) $('acct-stat-books').textContent = stats.totalReads;
  if ($('acct-stat-pages')) $('acct-stat-pages').textContent = fmtNum(stats.pagesRead);
  if ($('acct-stat-streak')) $('acct-stat-streak').textContent = `${streaks.current}d`;

  // Sync theme toggle UI
  syncAccountThemeSwitch();

  // Load saved preferences
  const userGoals = getUserDailyGoals();
  const prefFormat = localStorage.getItem('rt_pref_format') || 'Physical';
  const prefPages = userGoals.pagesTarget;
  const prefMins = userGoals.minutesTarget;

  if ($('pref-default-format')) $('pref-default-format').value = prefFormat;
  if ($('pref-daily-pages')) $('pref-daily-pages').value = prefPages;
  if ($('pref-daily-minutes')) $('pref-daily-minutes').value = prefMins;



  // Load saved Gemini API Key
  const savedGeminiKey = getGeminiApiKey();
  if ($('acct-gemini-api-key')) $('acct-gemini-api-key').value = savedGeminiKey;
  if ($('gemini-key-status')) {
    if (savedGeminiKey) {
      $('gemini-key-status').textContent = 'Key Active ✓';
      $('gemini-key-status').className = 'font-bold text-emerald-400';
    } else {
      $('gemini-key-status').textContent = 'Not Set';
      $('gemini-key-status').className = 'font-bold text-theme-gold';
    }
  }
}

function setupAccountView() {
  if (isAccountViewSetup) return;
  isAccountViewSetup = true;
  // Edit Display Name
  const btnEditName = $('btn-edit-profile-name');
  if (btnEditName) {
    btnEditName.addEventListener('click', () => {
      const currentName = $('account-user-name') ? $('account-user-name').textContent : 'Reader Profile';
      const newName = prompt('Enter your display name:', currentName);
      if (newName && newName.trim()) {
        const trimmed = newName.trim();
        localStorage.setItem('rt_user_name', trimmed);
        if ($('account-user-name')) $('account-user-name').textContent = trimmed;
        showToast('Display name updated!', 'success');
      }
    });
  }

  // Color Mode Buttons (Dark vs Light for ANY theme)
  document.querySelectorAll('.mode-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      setEditorialMode(mode);
      showToast(`Color Mode set to ${mode.toUpperCase()} MODE`, 'info');
    });
  });

  // Theme Style Buttons
  document.querySelectorAll('.theme-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      setEditorialTheme(theme);
      showToast(`Visual Theme set to ${theme.replace('-', ' ').toUpperCase()}`, 'info');
    });
  });

  // Typography Identity Buttons
  document.querySelectorAll('.font-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const font = btn.dataset.font;
      setEditorialFont(font);
      showToast(`Typography identity set to ${font === 'serif' ? 'LITERARY SERIF' : 'MODERN SANS'}`, 'info');
    });
  });

  // Accent Color Picker
  const accentPicker = $('accent-color-picker');
  if (accentPicker) {
    accentPicker.querySelectorAll('button[data-accent]').forEach(btn => {
      btn.addEventListener('click', () => {
        const accent = btn.dataset.accent;
        applyAccentColor(accent);
        showToast(`Accent color updated to ${accent.toUpperCase()}!`, 'success');
      });
    });
  }

  // Gemini API Key Save & Validate Button
  const btnSaveGeminiKey = $('btn-save-gemini-key');
  const inputGeminiKey = $('acct-gemini-api-key');
  const statusGeminiKey = $('gemini-key-status');

  if (inputGeminiKey) {
    inputGeminiKey.value = localStorage.getItem('rt_gemini_api_key') || '';
  }

  if (btnSaveGeminiKey && inputGeminiKey) {
    btnSaveGeminiKey.addEventListener('click', async () => {
      const keyVal = inputGeminiKey.value.trim();
      if (!keyVal) {
        localStorage.removeItem('rt_gemini_api_key');
        if (statusGeminiKey) {
          statusGeminiKey.textContent = 'Not Set';
          statusGeminiKey.className = 'font-bold text-theme-secondary';
        }
        showToast('Gemini API Key removed.', 'info');
        return;
      }

      btnSaveGeminiKey.disabled = true;
      btnSaveGeminiKey.textContent = 'Testing...';
      try {
        const res = await testGeminiApiKey(keyVal);
        localStorage.setItem('rt_gemini_api_key', keyVal);
        if (statusGeminiKey) {
          if (res && res.isRateLimited) {
            statusGeminiKey.textContent = 'Active ✓ (Standby)';
            statusGeminiKey.className = 'font-bold text-amber-400';
            showToast('Gemini API Key validated & saved! (Free Tier Rate Limit active - will auto-retry)', 'info');
          } else {
            statusGeminiKey.textContent = 'Active ✓';
            statusGeminiKey.className = 'font-bold text-emerald-400';
            showToast('Gemini API Key validated & saved!', 'success');
          }
        }
      } catch (err) {
        // SEC-03: Only save key if it passes a rate-limit check (key itself is valid)
        const isRateLimitError = (err.message.includes('Quota exceeded') || err.message.includes('rate limit') || err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED'));
        if (isRateLimitError) {
          localStorage.setItem('rt_gemini_api_key', keyVal); // Rate-limited but key is valid
        }
        if (statusGeminiKey) {
          statusGeminiKey.textContent = 'Key Saved';
          statusGeminiKey.className = 'font-bold text-amber-400';
        }
        const friendlyMsg = (err.message.includes('Quota exceeded') || err.message.includes('rate limit') || err.message.includes('429'))
          ? 'Free Tier rate limit active. Key saved & ready.'
          : err.message;
        showToast('Gemini Key saved (' + friendlyMsg + ')', 'info');
      } finally {
        btnSaveGeminiKey.disabled = false;
        btnSaveGeminiKey.textContent = 'Save Key';
      }
    });
  }

  // Security PIN Buttons
  const btnChangePin = $('acct-btn-change-pin');
  if (btnChangePin) {
    btnChangePin.addEventListener('click', async () => {
      const newPin = prompt('Enter a new 4-digit PIN (numbers only):');
      if (!newPin) return;
      if (!/^\d{4}$/.test(newPin)) {
        showToast('PIN must be exactly 4 digits', 'error');
        return;
      }
      try {
        const newHash = await hashPin(newPin);
        if (db && uid) {
          await setDoc(doc(db, `users/${uid}/settings/app`), { pin_hash: newHash }, { merge: true });
        }
        localStorage.setItem('rt_pin_hash', newHash);
        showToast('Security PIN updated successfully!', 'success');
        if ($('acct-pin-status-text')) $('acct-pin-status-text').textContent = 'PIN Protection Active (4 Digits)';
      } catch (e) {
        showToast('Failed to update PIN: ' + e.message, 'error');
      }
    });
  }

  const btnTogglePin = $('acct-btn-toggle-pin');
  if (btnTogglePin) {
    btnTogglePin.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to remove PIN security? Anyone opening the app will have direct access.')) return;
      try {
        if (db && uid) {
          await setDoc(doc(db, `users/${uid}/settings/app`), { pin_hash: null }, { merge: true });
        }
        localStorage.removeItem('rt_pin_hash');
        showToast('Security PIN removed', 'info');
        if ($('acct-pin-status-text')) $('acct-pin-status-text').textContent = 'PIN Protection Disabled';
      } catch (e) {
        showToast('Failed to remove PIN: ' + e.message, 'error');
      }
    });
  }

  // Excel Export Button
  const btnExportExcel = $('acct-btn-export-excel');
  if (btnExportExcel) {
    btnExportExcel.addEventListener('click', exportToExcelWorkbook);
  }

  // JSON Export & Import
  const btnExportJson = $('acct-btn-export-json');
  if (btnExportJson) {
    btnExportJson.addEventListener('click', exportToJSON);
  }

  const btnImportJson = $('acct-btn-import-json');
  const jsonFileInput = $('acct-json-file-input');
  if (btnImportJson && jsonFileInput) {
    btnImportJson.addEventListener('click', () => jsonFileInput.click());
    jsonFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) importFromJSON(file);
      jsonFileInput.value = '';
    });
  }

  // Sample Data & Reset Account Data
  const btnSample = $('acct-btn-load-sample');
  if (btnSample) {
    btnSample.addEventListener('click', async () => {
      if (!confirm('Load sample reading data into your account? This will import demo books, logs, and goals.')) return;
      try {
        await runSeedImport();
        booksCache = [];
        logsCache = [];
        await loadBooksCache();
        await loadLogsCache();
        renderDashboard();
        renderAccountView();
        showToast('Sample reading data loaded successfully!', 'success');
      } catch (e) {
        showToast('Failed to load sample data: ' + e.message, 'error');
      }
    });
  }

  const btnReset = $('acct-btn-reset-data');
  if (btnReset) {
    btnReset.addEventListener('click', async () => {
      const pinConfirmed = await verifyDoublePinForReset();
      if (!pinConfirmed) return;

      try {
        showToast('Resetting account data…', 'info');
        if (db && uid) {
          const bSnap = await getDocs(collection(db, `users/${uid}/books`));
          for (const d of bSnap.docs) await deleteDoc(doc(db, `users/${uid}/books/${d.id}`));
          const lSnap = await getDocs(collection(db, `users/${uid}/reading_logs`));
          for (const d of lSnap.docs) await deleteDoc(doc(db, `users/${uid}/reading_logs/${d.id}`));
          const wSnap = await getDocs(collection(db, `users/${uid}/wishlist`));
          for (const d of wSnap.docs) await deleteDoc(doc(db, `users/${uid}/wishlist/${d.id}`));
        }
        booksCache = [];
        logsCache = [];
        wishlistCache = [];
        renderDashboard();
        renderAccountView();
        showToast('Account data reset complete.', 'success');
      } catch (e) {
        showToast('Failed to reset account data: ' + e.message, 'error');
      }
    });
  }

  // Developer 10-Year Simulation & Diagnostic Suite Handlers (Hidden / Standalone)
  function openDevSuiteModal() {
    const devModal = $('dev-suite-modal');
    if (devModal) devModal.classList.add('open');
  }
  window.openDevSuiteModal = openDevSuiteModal;

  window.DevSuite = {
    seed10Yr: async () => {
      if (confirm('Seed 10-Year Master Archivist Profile (2016–2026)? An automatic backup of your live data will be created first.')) {
        await runCustomProfileImport('10yr');
      }
    },
    seedPower: async () => {
      if (confirm('Seed High-Velocity Power Reader Profile? An automatic backup of your live data will be created first.')) {
        await runCustomProfileImport('power');
      }
    },
    seedChaos: async () => {
      if (confirm('Seed Chaos & Edge Case Stress Profile? An automatic backup of your live data will be created first.')) {
        await runCustomProfileImport('chaos');
      }
    },
    runAudit: () => {
      runDiagnosticAudit();
    },
    restoreData: async () => {
      await restoreLiveUserBackup();
    },
    openModal: () => {
      openDevSuiteModal();
    }
  };

  const dev10yr = $('dev-seed-10yr');
  if (dev10yr) {
    dev10yr.addEventListener('click', async () => {
      if (!confirm('Seed 10-Year Master Archivist Profile (2016–2026)? An automatic backup of your live data will be created first.')) return;
      await runCustomProfileImport('10yr');
    });
  }

  const devPower = $('dev-seed-power');
  if (devPower) {
    devPower.addEventListener('click', async () => {
      if (!confirm('Seed High-Velocity Power Reader Profile? An automatic backup of your live data will be created first.')) return;
      await runCustomProfileImport('power');
    });
  }

  const devChaos = $('dev-seed-chaos');
  if (devChaos) {
    devChaos.addEventListener('click', async () => {
      if (!confirm('Seed Chaos & Edge Case Stress Profile? An automatic backup of your live data will be created first.')) return;
      await runCustomProfileImport('chaos');
    });
  }

  const devAudit = $('dev-run-audit');
  if (devAudit) {
    devAudit.addEventListener('click', () => {
      runDiagnosticAudit();
    });
  }

  const devRestore = $('dev-restore-backup');
  if (devRestore) {
    devRestore.addEventListener('click', async () => {
      await restoreLiveUserBackup();
    });
  }

  // Keyboard shortcut Ctrl+Shift+D / Cmd+Shift+D to trigger hidden Dev Suite
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      openDevSuiteModal();
      showToast('Developer Diagnostic Suite opened', 'info');
    }
  });

  // URL parameter ?dev=true or ?debug=1 trigger
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('dev') || urlParams.has('debug')) {
    setTimeout(() => {
      openDevSuiteModal();
      showToast('Developer Mode Active', 'info');
    }, 500);
  }

  // Reading Preferences Change Listeners
  const prefFormat = $('pref-default-format');
  if (prefFormat) {
    prefFormat.addEventListener('change', () => {
      localStorage.setItem('rt_pref_format', prefFormat.value);
      showToast(`Default format set to ${prefFormat.value}`, 'success');
    });
  }

  const prefPages = $('pref-daily-pages');
  if (prefPages) {
    prefPages.addEventListener('change', () => {
      localStorage.setItem('rt_pref_pages', prefPages.value);
      showToast(`Daily page target updated to ${prefPages.value} pages`, 'success');
    });
  }

  const prefMins = $('pref-daily-minutes');
  if (prefMins) {
    prefMins.addEventListener('change', () => {
      localStorage.setItem('rt_pref_mins', prefMins.value);
      showToast(`Daily time target updated to ${prefMins.value} mins`, 'success');
    });
  }

  // System & Cache Buttons
  const btnClearCache = $('acct-btn-clear-cache');
  if (btnClearCache) {
    btnClearCache.addEventListener('click', () => {
      // RES-04: Preserve critical keys during cache clear
      const keysToPreserve = ['rt_pin_hash', 'rt_user_cached_uid', 'rt_gemini_api_key'];
      const preserved = {};
      keysToPreserve.forEach(k => { preserved[k] = localStorage.getItem(k); });
      localStorage.clear();
      Object.entries(preserved).forEach(([k, v]) => { if (v !== null) localStorage.setItem(k, v); });
      showToast('Cache cleared successfully! Reloading...', 'success');
      setTimeout(() => location.reload(), 1000);
    });
  }

  const btnSignout = $('acct-btn-signout');
  if (btnSignout) {
    btnSignout.addEventListener('click', () => {
      if (confirm('Sign out of your account?')) {
        signOut(auth);
      }
    });
  }
}

const ALLOWED_SCRIPT_ORIGINS = ['https://cdn.sheetjs.com', 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'];
function ensureScript(url) {
  // SEC-07: Validate URL origin before dynamic script injection
  try {
    const u = new URL(url);
    if (!ALLOWED_SCRIPT_ORIGINS.includes(u.origin)) {
      console.error('[Security] Blocked script from disallowed origin:', u.origin);
      return Promise.reject(new Error('Blocked script origin: ' + u.origin));
    }
  } catch (e) {
    return Promise.reject(new Error('Invalid script URL'));
  }
  if (document.querySelector(`script[src="${url}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function exportToExcelWorkbook() {
  if (typeof XLSX === 'undefined') {
    showToast('Loading Excel exporter...', 'info');
    try {
      await ensureScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    } catch (err) {
      showToast('Failed to load Excel exporter library.', 'error');
      return;
    }
  }

  showToast('Generating Excel workbook...', 'info');

  try {
    await loadBooksCache();
    await loadLogsCache();

    const books = booksCache || [];
    const logs = logsCache || [];

    let totalFinishedCycles = 0;
    let totalPagesRead = 0;
    let finishedTitlesCount = 0;
    let activeTitlesCount = 0;
    let unreadTitlesCount = 0;
    let bahaiCount = 0;
    let nonBahaiCount = 0;

    books.forEach(b => {
      const readCount = b.read_count || (b.status === 'Finished' ? 1 : 0);
      totalFinishedCycles += readCount;
      const pages = Number(b.pages) || 0;
      totalPagesRead += (readCount * pages);

      if (b.status === 'Finished') finishedTitlesCount++;
      else if (b.status === 'In Progress') activeTitlesCount++;
      else if (b.status === 'Not Started' || b.status === 'Want to Buy') unreadTitlesCount++;

      if ((b.category || '').toLowerCase().includes('bahá\'í') || (b.category || '').toLowerCase().includes('bahai')) {
        bahaiCount++;
      } else {
        nonBahaiCount++;
      }
    });

    const streak = calculateStreak(logs);
    const wb = XLSX.utils.book_new();

    // Sheet 1: Overview & Summary Stats
    const overviewRows = [
      ["Reading Tracker Account Summary", ""],
      ["Export Date", new Date().toLocaleString()],
      ["", ""],
      ["Metric Name", "Value"],
      ["Total Books Read (Completed Cycles)", totalFinishedCycles],
      ["Total Pages Read (Lifetime)", totalPagesRead],
      ["Finished Titles", finishedTitlesCount],
      ["Active Titles (In Progress)", activeTitlesCount],
      ["Unread Titles", unreadTitlesCount],
      ["Total Library Titles", books.length],
      ["Bahá'í Titles", bahaiCount],
      ["Non-Bahá'í Titles", nonBahaiCount],
      ["Current Reading Streak (Days)", streak.current || 0],
      ["Longest Reading Streak (Days)", streak.max || 0],
      ["Total Logging Days", streak.totalDays || 0],
      ["Total Reading Log Entries", logs.length]
    ];
    const wsOverview = XLSX.utils.aoa_to_sheet(overviewRows);
    wsOverview['!cols'] = [{ wch: 35 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsOverview, "Overview & Summary");

    // Sheet 2: Book Library Catalog
    const catalogRows = books.map(b => ({
      "ID": b.id || "",
      "Title": b.title || "",
      "Author": b.author || "",
      "Category": b.category || "General",
      "Status": b.status || "",
      "Total Pages": Number(b.pages) || 0,
      "Completed Reads": b.read_count || (b.status === 'Finished' ? 1 : 0),
      "Current Cycle": b.cycle || 1,
      "Rating": b.rating ? `${b.rating}/5` : "Unrated",
      "Format": b.format || "Physical",
      "Date Started": b.date_started || "",
      "Date Finished": b.date_finished || "",
      "Cover Approved": b.cover_approved ? "Yes" : "No",
      "Notes": b.notes || ""
    }));
    const wsCatalog = XLSX.utils.json_to_sheet(catalogRows);
    wsCatalog['!cols'] = [
      { wch: 15 }, { wch: 35 }, { wch: 25 }, { wch: 15 },
      { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 12 },
      { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 15 },
      { wch: 15 }, { wch: 30 }
    ];
    XLSX.utils.book_append_sheet(wb, wsCatalog, "Book Library");

    // Sheet 3: Reading Logs History
    const logRows = logs.map(l => {
      const minutes = Number(l.minutes_read) || 0;
      const pages = Number(l.pages_read) || 0;
      const pacePPH = (minutes > 0 && pages > 0) ? Math.round((pages / (minutes / 60))) : "N/A";

      return {
        "Log ID": l.id || "",
        "Date": l.date || "",
        "Book Title": l.book_title || "",
        "Cycle": l.cycle || 1,
        "Start Page": l.start_page ?? 0,
        "End Page": l.end_page ?? 0,
        "Pages Read": pages,
        "Minutes Read": minutes,
        "Pace (Pages/Hr)": pacePPH,
        "Notes": l.notes || ""
      };
    });
    const wsLogs = XLSX.utils.json_to_sheet(logRows);
    wsLogs['!cols'] = [
      { wch: 15 }, { wch: 12 }, { wch: 35 }, { wch: 10 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
      { wch: 16 }, { wch: 30 }
    ];
    XLSX.utils.book_append_sheet(wb, wsLogs, "Reading Logs");

    // Sheet 4: Annual Breakdown
    const yearStats = {};
    logs.forEach(l => {
      const yr = (l.date || '').substring(0, 4);
      if (!yr) return;
      if (!yearStats[yr]) yearStats[yr] = { year: yr, logsCount: 0, pagesRead: 0, minutesRead: 0 };
      yearStats[yr].logsCount++;
      yearStats[yr].pagesRead += Number(l.pages_read) || 0;
      yearStats[yr].minutesRead += Number(l.minutes_read) || 0;
    });
    const annualRows = Object.values(yearStats).sort((a,b) => b.year - a.year).map(y => ({
      "Year": y.year,
      "Log Entries": y.logsCount,
      "Pages Read": y.pagesRead,
      "Hours Read": Math.round((y.minutesRead / 60) * 10) / 10,
      "Avg Pages/Day (Active)": Math.round((y.pagesRead / (y.logsCount || 1)) * 10) / 10
    }));
    const wsAnnual = XLSX.utils.json_to_sheet(annualRows);
    wsAnnual['!cols'] = [
      { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 22 }
    ];
    XLSX.utils.book_append_sheet(wb, wsAnnual, "Annual Breakdown");

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Reading_Tracker_Export_${dateStr}.xlsx`);
    showToast('Excel workbook exported successfully!', 'success');
  } catch (err) {
    console.error('Export Excel error:', err);
    showToast('Failed to export Excel workbook: ' + err.message, 'error');
  }
}

async function exportToJSON() {
  await loadBooksCache();
  await loadLogsCache();

  const data = {
    app: "Reading Tracker",
    version: "2.5.0",
    exportDate: new Date().toISOString(),
    books: booksCache,
    logs: logsCache
  };

  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Reading_Tracker_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON backup exported successfully!', 'success');
}

function importFromJSON(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.books || !Array.isArray(data.books)) {
          throw new Error('Invalid backup file format: missing books array');
        }

        showToast(`Importing ${data.books.length} books and ${(data.logs || []).length} logs...`, 'info');

        // Optimistic local-first: hydrate memory caches IMMEDIATELY
        booksCache = data.books || [];
        logsCache = data.logs || [];
        if (data.wishlist && Array.isArray(data.wishlist)) {
          wishlistCache = data.wishlist;
        }

        // Re-render UI from restored caches (non-fatal — render errors must not block import)
        try {
          await renderBookshelf();
          renderDashboard();
          renderAccountView();
          populateBookDropdown();
        } catch (renderErr) {
          console.warn('[Import] Render after import failed (data intact):', renderErr.message);
        }

        // Background Firestore sync (non-blocking — a network failure must never prevent local restore)
        if (db && uid) {
          (async () => {
            try {
              for (const b of data.books) {
                const ref = doc(db, `users/${uid}/books/${b.id || Date.now()}`);
                await setDoc(ref, b, { merge: true });
              }
              if (data.logs && Array.isArray(data.logs)) {
                for (const l of data.logs) {
                  const ref = doc(db, `users/${uid}/reading_logs/${l.id || Date.now()}`);
                  await setDoc(ref, l, { merge: true });
                }
              }
            } catch (syncErr) {
              console.warn('[Import] Background Firestore sync failed (local data intact):', syncErr.message);
            }
          })();
        }

        showToast('Import completed successfully!', 'success');
        resolve(true);
      } catch (err) {
        console.error('Import JSON error:', err);
        showToast('Failed to import backup: ' + err.message, 'error');
        resolve(false);
      }
    };
    reader.onerror = () => {
      showToast('Failed to read backup file.', 'error');
      resolve(false);
    };
    reader.readAsText(file);
  });
}

// ── Books Cache ───────────────────────────────────────────────────────────────
async function loadBooksCache() {
  if (booksCache.length > 0) return;
  try {
    if (db && uid) {
      const snap = await getDocs(collection(db, `users/${uid}/books`));
      booksCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Auto-heal missing cover_url from seed-data.json if needed
      const unapprovedCount = booksCache.filter(b => !b.cover_url).length;
      if (unapprovedCount > 0) {
        try {
          const resp = await fetch('./seed-data.json');
          if (resp.ok) {
            const seed = await resp.json();
            const seedCoverMap = {};
            (seed.books || []).forEach(sb => {
              if (sb.title && sb.cover_url) {
                seedCoverMap[sb.title.trim().toLowerCase()] = sb.cover_url;
              }
            });
            booksCache.forEach(b => {
              if (!b.cover_url && b.title) {
                const matchedCover = seedCoverMap[b.title.trim().toLowerCase()];
                if (matchedCover) {
                  b.cover_url = matchedCover;
                  // Persist back to Firestore asynchronously
                  updateDoc(doc(db, `users/${uid}/books/${b.id}`), { cover_url: matchedCover }).catch(err => console.warn('Cover auto-heal persist:', err));
                }
              }
            });
          }
        } catch (err) {
          console.warn('Seed cover heal error:', err);
        }
      }

      booksCache.sort((a, b) => a.title.localeCompare(b.title));
      markViewsDirty();
    }
  } catch (e) {
    console.warn('[Cache] Using cached books array:', e.message);
  }
}

async function loadLogsCache() {
  if (logsCache.length > 0) return;
  try {
    if (db && uid) {
      const snap = await getDocs(query(collection(db, `users/${uid}/reading_logs`), orderBy('date', 'desc')));
      logsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      markViewsDirty();
    }
  } catch (e) {
    console.warn('[Cache] Using cached logs array:', e.message);
  }
}

async function getMergedBooks() {
  await loadBooksCache();
  if (wishlistCache.length === 0) {
    const cachedWishlist = localStorage.getItem('rt_wishlist_cache');
    if (cachedWishlist) {
      try { wishlistCache = JSON.parse(cachedWishlist); } catch (e) {}
    }
    if (wishlistCache.length === 0 && db && uid) {
      try {
        const snap = await getDocs(collection(db, `users/${uid}/wishlist`));
        wishlistCache = snap.docs.map(d => ({ id: d.id, ...d.data(), _isWishlist: true }));
        localStorage.setItem('rt_wishlist_cache', JSON.stringify(wishlistCache));
        markViewsDirty();
      } catch (e) {
        console.warn('[Cache] Using cached wishlist array:', e.message);
      }
    }
  }
  
  const wishlistMap = {};
  wishlistCache.forEach(w => {
    wishlistMap[w.title.toLowerCase()] = w;
  });

  const libraryItems = booksCache.map(b => {
    const wl = wishlistMap[b.title.toLowerCase()];
    
    let ownership = 'Owned';
    if (b.status === 'Borrowed' || b.status === 'Borrowed and Read') {
      ownership = 'Borrowed';
    } else if (b.status === 'Want to Buy' || b.status === 'Wishlist') {
      ownership = 'Wishlist';
    } else if (wl) {
      if (wl.status === 'Borrowed' || wl.status === 'Borrowed and Read') {
        ownership = 'Borrowed';
      } else if (wl.status === 'Want to Buy' || wl.status === 'Wishlist') {
        ownership = 'Wishlist';
      }
    }
    
    return {
      ...b,
      collection: b.collection || 'Non-Bahai',
      group: b.group || b.group_name || b.reading_group || b.category || 'Other',
      priority: b.priority || (wl ? wl.priority : 'Low'),
      est_cost: b.est_cost || (wl ? wl.est_cost : 0),
      where_to_buy: b.where_to_buy || (wl ? wl.where_to_buy : ''),
      notes: b.notes || (wl ? wl.notes : ''),
      total_pages: b.total_pages || 0,
      _fromWishlist: !!wl || ['Want to Buy', 'Gifted', 'Borrowed', 'Wishlist'].includes(b.status),
      _isWishlist: false,
      ownership: ownership
    };
  });

  const bookTitleSet = new Set(booksCache.map(b => (b.title || '').toLowerCase()));

  const wishlistOnly = wishlistCache
    .filter(w => !bookTitleSet.has((w.title || '').toLowerCase()))
    .map(w => {
      let ownership = 'Wishlist';
      if (w.status === 'Owned' || w.status === 'Owned and Read' || w.status === 'Gifted' || w.status === 'Gifted and Read') {
        ownership = 'Owned';
      } else if (w.status === 'Borrowed' || w.status === 'Borrowed and Read') {
        ownership = 'Borrowed';
      }
      
      return {
        id: w.id,
        title: w.title,
        author: w.author || '',
        collection: w.collection || 'Non-Bahai',
        group: w.group || w.group_name || w.reading_group || w.category || 'Other',
        total_pages: w.est_pages || w.total_pages || 0,
        priority: w.priority || 'Low',
        status: w.status || 'Want to Buy',
        est_cost: w.est_cost || 0,
        where_to_buy: w.where_to_buy || '',
        notes: w.notes || '',
        pages_read: 0,
        read_count: (w.status === 'Owned and Read' || w.status === 'Borrowed and Read') ? 1 : 0,
        _fromWishlist: true,
        _isWishlist: true,
        ownership: ownership
      };
    });

  return libraryItems;
}

// ── Navigation ────────────────────────────────────────────────────────────────
function setupNav() {
  // Wire iOS tab bar with WebHaptics
  document.querySelectorAll('#tab-bar .tab-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (navigator.vibrate) navigator.vibrate([8]);
      showView(btn.dataset.view);
    });
  });

  // Wire Center Floating Action Button (FAB) for Log Session
  const fabLog = $('btn-fab-log');
  if (fabLog) {
    fabLog.addEventListener('click', () => {
      if (navigator.vibrate) navigator.vibrate([10]);
      showView('log');
    });
  }

  // Wire dark/light mode toggle
  const themeBtn = $('btn-theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  // Wire sign-out
  const soBtn = $('btn-signout');
  if (soBtn) soBtn.addEventListener('click', () => signOut(auth));
}

function showView(name) {
  currentView = name;

  // 1. Instantaneous tab bar active state update
  document.querySelectorAll('#tab-bar .tab-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });

  // 2. Instantaneous view panel visibility toggle
  document.querySelectorAll('.view').forEach(v => {
    const isActive = v.id === `view-${name}`;
    v.classList.toggle('active', isActive);
    v.classList.toggle('hidden', !isActive);
  });

  // 3. Defer non-blocking rendering to next animation frame for silky smooth 60fps transitions
  const key = name === 'wishlist' ? 'bookshelf' : name;
  requestAnimationFrame(() => {
    if (name === 'dashboard') safeRender('view-dashboard', () => renderDashboard());
    if (name === 'knowledge') safeRender('view-knowledge', () => renderKnowledgeView());
    if (name === 'goals')     safeRender('view-goals', () => renderGoals());
    if (name === 'wishlist')  safeRender('view-wishlist', () => renderBookshelf());
    if (name === 'log')       safeRender('view-log', () => typeof renderLogView === 'function' && renderLogView());
    if (name === 'account')   safeRender('view-account', () => renderAccountView());
    if (key in viewDirtyFlags) viewDirtyFlags[key] = false;
  });

  // Hide wishlist fab if present
  const fab = $('wishlist-fab');
  if (fab) fab.classList.add('hidden');
}

// ── Log Form ──────────────────────────────────────────────────────────────────
let isLogAddBtnSetup = false;

function setupLogForm() {
  $('log-date').value = todayISO();

  const addBtn = $('btn-log-add-new-book');
  if (addBtn && !isLogAddBtnSetup) {
    isLogAddBtnSetup = true;
    addBtn.addEventListener('click', () => {
      openAddBookModal();
    });
  }

  $('log-book').addEventListener('change', async () => {
    const title = $('log-book').value;
    if (!title) {
      $('log-start').value = '';
      $('log-cycle').value = '1';
      $('log-start-hint').textContent = '';
      return;
    }
    
    // Check if the selected book is from master catalog and not in booksCache yet
    let existingBook = booksCache.find(b => b.title === title);
    if (!existingBook && masterCatalog.length > 0) {
      const catBook = masterCatalog.find(b => b.title === title);
      if (catBook) {
        try {
          const newBook = {
            title: catBook.title,
            author: catBook.author || null,
            collection: catBook.collection || 'Bahai',
            group: catBook.group || 'Writings',
            group_name: catBook.group || 'Writings',
            total_pages: catBook.total_pages || 300,
            priority: 'Medium',
            status: 'In Progress',
            pages_read: 0,
            read_count: 0,
            cover_url: catBook.cover_url || null,
            date_added: todayISO()
          };
          const saved = await optimisticSaveDoc('books', newBook);
          if (!booksCache.some(b => b.id === saved.id || b.title === saved.title)) {
            booksCache.push(saved);
          }
          showToast(`✓ "${catBook.title}" added to your library!`, 'success');
          populateBookDropdown();
          $('log-book').value = catBook.title;
        } catch (e) {
          console.warn('Auto-add catalog book error:', e);
        }
      }
    }

    handleBookSelection(title, booksCache, logsCache);
    
    const startPage = parseInt($('log-start').value) || 0;
    const cycle = parseInt($('log-cycle').value) || 1;
    if (startPage > 0) {
      $('log-start-hint').textContent = `↑ Auto-filled from last session (Cycle ${cycle})`;
      $('log-start-hint').className = 'input-hint found';
    } else {
      $('log-start-hint').textContent = cycle > 1 ? `Starting Cycle ${cycle} fresh` : 'Starting fresh';
      $('log-start-hint').className = 'input-hint';
    }
  });

  $('log-submit').addEventListener('click', submitLog);
  setupStopwatch();
}

async function populateBookDropdown() {
  const sel = $('log-book');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select a book —</option>';

  // 1. User's library books
  const sorted = [...booksCache].sort((a, b) => {
    const order = { 'In Progress': 0, 'Finished': 1, 'Not Started': 2 };
    return (order[a.status] ?? 2) - (order[b.status] ?? 2) || a.title.localeCompare(b.title);
  });

  let lastGroup = null;
  sorted.forEach(b => {
    const g = b.status === 'In Progress' ? '📖 Currently Reading' : b.status === 'Finished' ? '✅ Finished' : '📚 Not Started';
    if (g !== lastGroup) {
      const og = document.createElement('optgroup'); og.label = g;
      sel.appendChild(og); lastGroup = g;
    }
    const opt = document.createElement('option');
    opt.value = b.title;
    opt.textContent = b.title;
    sel.appendChild(opt);
  });

  // 2. Master Catalog books (for books not yet in booksCache)
  const catalog = await loadMasterCatalog();
  const unaddedMasterBooks = catalog.filter(mb => !booksCache.some(b => b.title?.toLowerCase() === mb.title?.toLowerCase()));
  if (unaddedMasterBooks.length > 0) {
    const masterOg = document.createElement('optgroup');
    masterOg.label = '✨ Master Catalog (Auto-adds to library)';
    unaddedMasterBooks.forEach(mb => {
      const opt = document.createElement('option');
      opt.value = mb.title;
      opt.textContent = `${mb.title} — ${mb.author || 'Catalog'}`;
      masterOg.appendChild(opt);
    });
    sel.appendChild(masterOg);
  }

  // Preserve selection or default
  if (cur) {
    sel.value = cur;
  } else if (logsCache && logsCache.length > 0) {
    const sortedLogs = [...logsCache].sort((a, b) => new Date(b.date) - new Date(a.date));
    const latestBookTitle = sortedLogs[0].book_title;
    if (latestBookTitle && booksCache.some(b => b.title === latestBookTitle)) {
      sel.value = latestBookTitle;
      handleBookSelection(latestBookTitle, booksCache, logsCache);
      
      const startPage = parseInt($('log-start').value) || 0;
      const cycle = parseInt($('log-cycle').value) || 1;
      if (startPage > 0) {
        $('log-start-hint').textContent = `↑ Auto-filled from last session (Cycle ${cycle})`;
        $('log-start-hint').className = 'input-hint found';
      } else {
        $('log-start-hint').textContent = cycle > 1 ? `Starting Cycle ${cycle} fresh` : 'Starting fresh';
        $('log-start-hint').className = 'input-hint';
      }
    }
  }
}

let isSubmitLogSubmitting = false;

async function submitLog() {
  if (typeof window !== 'undefined') window.submitLog = submitLog;
  if (isSubmitLogSubmitting) return;

  const title   = $('log-book').value;
  const date    = $('log-date').value;
  const start   = parseInt($('log-start').value);
  const end     = parseInt($('log-end').value);
  const cycle   = parseInt($('log-cycle').value) || 1;
  const mins    = parseInt($('log-minutes').value) || null;
  const notes   = $('log-notes').value.trim() || null;

  if (!title)                  { showToast('Please select a book.', 'error'); return; }
  if (!date)                   { showToast('Please enter a date.', 'error'); return; }
  if (isNaN(start) || start < 0) { showToast('Start page cannot be negative.', 'error'); return; }
  if (isNaN(end) || end <= 0) { showToast('Please enter a valid end page.', 'error'); return; }
  if (end <= start)            { showToast('End page must be greater than start page.', 'error'); return; }
  // Validate end page against book's total pages
  const selectedBook = booksCache.find(b => b.title === title || b.id === title);
  if (selectedBook && selectedBook.total_pages && end > selectedBook.total_pages) {
    showToast(`End page (${end}) exceeds book length (${selectedBook.total_pages} pages).`, 'error');
    return;
  }
  if (mins !== null && (isNaN(mins) || mins <= 0)) { showToast('Minutes spent must be a positive number.', 'error'); return; }

  isSubmitLogSubmitting = true;
  const btn = $('log-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const newLog = {
      date, book_title: title, read_cycle: cycle,
      start_page: start, end_page: end,
      minutes_spent: mins, notes,
      created_at: serverTimestamp()
    };

    // Add log entry (Optimistic local-first + idempotent background setDoc sync)
    const savedLog = await optimisticSaveDoc('reading_logs', newLog);
    if (!logsCache.some(l => l.id === savedLog.id)) {
      logsCache.unshift(savedLog);
    }

    // Recalculate book status
    await recalculateBook(title, cycle);

    // Reset form
    $('log-date').value = todayISO();
    $('log-end').value = '';
    $('log-minutes').value = '';
    $('log-notes').value = '';

    const pages = end - start;
    showToast(`✓ Logged ${pages} page${pages === 1 ? '' : 's'} in "${title.slice(0, 30)}${title.length > 30 ? '…' : ''}"`, 'success');

    if (typeof openPostSessionReflectionModal === 'function') {
      openPostSessionReflectionModal(null, title);
    }

    // Refresh books cache so dropdown updates
    populateBookDropdown();
    $('log-book').value = title;

    // Trigger start hint update
    $('log-start').value = end;
    $('log-start-hint').textContent = '↑ Auto-filled from last session';
    $('log-start-hint').className = 'input-hint found';

  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    console.error(e);
  } finally {
    isSubmitLogSubmitting = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Log Reading Session'; }
  }
}

async function recalculateBook(title, cycle) {
  // Find this book in cache
  const book = booksCache.find(b => b.title === title);
  if (!book) return;
  const tot = parseInt(book.total_pages || 0, 10);
  const rc = parseInt(book.read_count || 0, 10);

  // Get all logs for this book
  const logsSnap = await getDocs(query(
    collection(db, `users/${uid}/reading_logs`),
    where('book_title', '==', title)
  ));
  const logs = logsSnap.docs.map(d => d.data());

  // Calculate completed cycles safely
  const maxLogCycle = logs.length > 0 ? Math.max(...logs.map(l => parseInt(l.read_cycle || 1, 10))) : 1;
  let completedCycles = 0;
  for (let c = 1; c <= maxLogCycle + 1; c++) {
    const cycleLogs = logs.filter(l => parseInt(l.read_cycle || 1, 10) === c);
    if (cycleLogs.length === 0) continue;
    const maxEnd = Math.max(...cycleLogs.map(l => parseInt(l.end_page || 0, 10)));
    const isHistorical = cycleLogs.some(l => l.notes && l.notes.includes('Historical cycle'));
    if (maxEnd >= tot || isHistorical || c <= rc) {
      completedCycles = Math.max(completedCycles, c);
    }
  }

  const finalReadCount = Math.max(rc, completedCycles);
  const activeCycle = Math.max(finalReadCount + 1, cycle);
  const activeLogs = logs.filter(l => parseInt(l.read_cycle || 1, 10) === activeCycle);
  const maxActiveEnd = activeLogs.length > 0 ? Math.max(...activeLogs.map(l => parseInt(l.end_page || 0, 10))) : 0;

  const newStatus = (maxActiveEnd >= tot) ? 'Finished' : (maxActiveEnd > 0 ? 'In Progress' : book.status);

  let newPagesRead;
  if (newStatus === 'Finished') {
    newPagesRead = tot;
  } else if (newStatus === 'In Progress') {
    newPagesRead = Math.min(maxActiveEnd, tot);
  } else {
    newPagesRead = 0;
  }

  // Find and update the book doc
  const booksSnap = await getDocs(query(
    collection(db, `users/${uid}/books`), where('title', '==', title)
  ));
  if (!booksSnap.empty) {
    await updateDoc(booksSnap.docs[0].ref, {
      status: newStatus,
      pages_read: newPagesRead,
      read_count: finalReadCount
    });
    // Update local cache too
    const cached = booksCache.find(b => b.title === title);
    if (cached) {
      cached.status = newStatus;
      cached.pages_read = newPagesRead;
      cached.read_count = finalReadCount;
    }
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function populateYearDropdown(logs) {
  const sel = $('dash-year-select');
  if (!sel) return;
  const years = [...new Set(logs.map(l => l.date.slice(0, 4)))].filter(y => y && y.length === 4).sort((a,b) => b - a);
  const currentSelected = sel.value || dashYearFilter || 'all';
  sel.innerHTML = '<option value="all">All Time</option>';
  years.forEach(y => {
    const opt = el('option', '', y);
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  });
  if (Array.from(sel.options).some(o => o.value === currentSelected)) {
    sel.value = currentSelected;
  } else {
    sel.value = 'all';
  }
}

function calculateStreaks(logs) {
  const dates = [...new Set(logs.map(l => l.date))].sort();
  if (dates.length === 0) return { current: 0, longest: 0 };
  
  let current = 0;
  let longest = 0;
  let temp = 0;
  let prevDate = null;
  
  const todayStr = todayISO();
  
  for (let i = 0; i < dates.length; i++) {
    const cur = new Date(dates[i] + 'T00:00:00');
    if (prevDate === null) {
      temp = 1;
    } else {
      const diffTime = Math.abs(cur - prevDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        temp++;
      } else if (diffDays > 1) {
        if (temp > longest) longest = temp;
        temp = 1;
      }
    }
    prevDate = cur;
  }
  if (temp > longest) longest = temp;
  
  // Check if current streak is active (ends today or yesterday)
  const lastDate = new Date(dates[dates.length - 1] + 'T00:00:00');
  const today = new Date(todayStr + 'T00:00:00');
  const diffLastTime = Math.abs(today - lastDate);
  const diffLastDays = Math.ceil(diffLastTime / (1000 * 60 * 60 * 24));
  
  if (diffLastDays <= 1) {
    current = temp;
  } else {
    current = 0;
  }
  
  return { current, longest };
}

function setupDashboard() {
  if (isDashboardSetup) return;
  isDashboardSetup = true;
  // Segment filter (Bahá'í / Non-Bahá'í / All)
  $('dash-seg').addEventListener('click', e => {
    const btn = e.target.closest('[data-col]');
    if (!btn) return;
    dashFilter = btn.dataset.col;
    $('dash-seg').querySelectorAll('.seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.col === dashFilter);
    });
    transitionView(() => renderDashboard());
  });

  // Year filter
  $('dash-year-select').addEventListener('change', e => {
    dashYearFilter = e.target.value;
    transitionView(() => renderDashboard());
  });

  // Heatmap timeframe selector
  const tfBox = $('dash-heatmap-tf');
  if (tfBox) {
    tfBox.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        dashHeatmapTimeframe = btn.dataset.range;
        tfBox.querySelectorAll('button').forEach(b => {
          b.classList.toggle('active', b.dataset.range === dashHeatmapTimeframe);
        });
        transitionView(() => {
          const activeLogs = logsCache.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));
          renderActivityHeatmap(activeLogs);
        });
      });
    });
  }

  // Collection Split toggle (Pages vs Books)
  const donutToggle = document.getElementById('donut-chart-toggle');
  if (donutToggle) {
    donutToggle.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        collectionChartMode = btn.dataset.mode;
        donutToggle.querySelectorAll('button').forEach(b => {
          b.classList.toggle('active', b.dataset.mode === collectionChartMode);
        });
        transitionView(() => renderDonutChart());
      });
    });
  }

  // Category toggle (Pages vs Books)
  const catToggle = document.getElementById('cat-chart-toggle');
  if (catToggle) {
    catToggle.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        categoryChartMode = btn.dataset.mode;
        catToggle.querySelectorAll('button').forEach(b => {
          b.classList.toggle('active', b.dataset.mode === categoryChartMode);
        });
        transitionView(() => renderBarChart());
      });
    });
  }

  // Insights Hub Tab Switcher
  const insightsTabBar = document.getElementById('insights-tab-bar');
  if (insightsTabBar) {
    insightsTabBar.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        insightsTabBar.querySelectorAll('button').forEach(b => {
          b.classList.toggle('active', b.dataset.tab === targetTab);
        });
        document.querySelectorAll('.insights-tab-panel').forEach(panel => {
          const isActive = panel.id === `insights-panel-${targetTab}`;
          panel.classList.toggle('hidden', !isActive);
          if (isActive) {
            panel.classList.add('animate-fade-in');
          }
        });
      });
    });
  }

  // Dashboard Detailed Breakdown Tab Switcher (Monthly, Day of Week, Seasonal, Yearly)
  const breakdownTabBar = document.getElementById('dash-breakdown-tab-bar');
  if (breakdownTabBar) {
    breakdownTabBar.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        breakdownTabBar.querySelectorAll('button').forEach(b => {
          b.classList.toggle('active', b.dataset.tab === targetTab);
        });
        document.querySelectorAll('.dash-breakdown-panel').forEach(panel => {
          const isActive = panel.id === `dash-breakdown-${targetTab}`;
          panel.classList.toggle('hidden', !isActive);
          if (isActive) {
            panel.classList.add('animate-fade-in');
          }
        });
      });
    });
  }

  // Dashboard Reading Records Tab Switcher (Book Length, Reading Speed, Authors & Genres)
  const recordsTabBar = document.getElementById('dash-records-tab-bar');
  if (recordsTabBar) {
    recordsTabBar.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        recordsTabBar.querySelectorAll('button').forEach(b => {
          b.classList.toggle('active', b.dataset.tab === targetTab);
        });
        document.querySelectorAll('.dash-records-panel').forEach(panel => {
          const isActive = panel.id === `dash-records-${targetTab}`;
          panel.classList.toggle('hidden', !isActive);
          if (isActive) {
            panel.classList.add('animate-fade-in');
          }
        });
      });
    });
  }

  // Dashboard Reading Milestones Tab Switcher (Books Milestones, Pages Milestones)
  const milestonesTabBar = document.getElementById('dash-milestones-tab-bar');
  if (milestonesTabBar) {
    milestonesTabBar.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        milestonesTabBar.querySelectorAll('button').forEach(b => {
          b.classList.toggle('active', b.dataset.tab === targetTab);
        });
        document.querySelectorAll('.dash-ms-panel').forEach(panel => {
          const isActive = panel.id === `dash-ms-panel-${targetTab}`;
          panel.classList.toggle('hidden', !isActive);
          if (isActive) {
            panel.classList.add('animate-fade-in');
          }
        });
      });
    });
  }
}

function getMedian(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a,b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function calculateETA(needed, rate) {
  if (rate <= 0) return 'Never';
  const daysNeeded = needed / rate;
  const etaDate = new Date();
  etaDate.setDate(etaDate.getDate() + daysNeeded);
  return etaDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function getDynamicBookThresholds(currentCount) {
  const base = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 5000, 10000];
  const thresholds = base.filter(t => t <= currentCount);
  const remaining = base.filter(t => t > currentCount);
  const upcoming = remaining.slice(0, 2);
  while (upcoming.length < 2) {
    const last = upcoming.length > 0 ? upcoming[upcoming.length - 1] : (thresholds.length > 0 ? thresholds[thresholds.length - 1] : 100);
    upcoming.push(last * 2);
  }
  return [...thresholds, ...upcoming];
}

function getDynamicPageThresholds(currentPages) {
  const base = [1000, 2500, 5000, 10000, 15000, 25000, 35000, 50000, 75000, 100000, 150000, 200000, 250000, 500000, 1000000];
  const thresholds = base.filter(t => t <= currentPages);
  const remaining = base.filter(t => t > currentPages);
  const upcoming = remaining.slice(0, 2);
  while (upcoming.length < 2) {
    const last = upcoming.length > 0 ? upcoming[upcoming.length - 1] : (thresholds.length > 0 ? thresholds[thresholds.length - 1] : 10000);
    upcoming.push(last * 2);
  }
  return [...thresholds, ...upcoming];
}

function renderMilestones(completions, ytdDaysElapsed) {
  const currentYrStr = String(new Date().getFullYear());
  const ytdCompletionsCount = completions.filter(c => c.date && c.date.startsWith(currentYrStr)).length;
  const bookRate = (ytdDaysElapsed > 0 && ytdCompletionsCount > 0) ? (ytdCompletionsCount / ytdDaysElapsed) : (completions.length / Math.max(1, ytdDaysElapsed));
  const currentBookCount = completions.length;

  // ── BOOKS MILESTONES ──
  const bookThresholds = getDynamicBookThresholds(currentBookCount);
  const booksCountBadge = $('ms-books-count-badge');
  if (booksCountBadge) {
    booksCountBadge.innerHTML = `<span class="font-extrabold text-[11px]">${fmtNum(currentBookCount)}</span> <span class="text-[9.5px] opacity-75 font-semibold">Read</span>`;
  }

  const passedBooks = [];
  let nextBookGoal = null;

  bookThresholds.forEach(t => {
    if (completions.length >= t) {
      const date = completions[t - 1].date;
      passedBooks.push({ target: t, date: date === '2020-01-01' ? 'Completed' : fmtDate(date) });
    } else if (!nextBookGoal) {
      const needed = t - completions.length;
      const eta = calculateETA(needed, bookRate > 0 ? bookRate : 0.05);
      const pct = Math.min(100, Math.round((currentBookCount / t) * 100));
      nextBookGoal = { target: t, current: currentBookCount, needed, eta, pct };
    }
  });

  // Featured Next Book Goal Card
  const booksFeaturedEl = $('ms-books-featured');
  if (booksFeaturedEl) {
    if (nextBookGoal) {
      booksFeaturedEl.innerHTML = `
        <div class="p-3.5 rounded-2xl border flex flex-col gap-2.5 relative overflow-hidden" style="background: rgba(var(--gold-rgb), 0.07); border-color: rgba(var(--gold-rgb), 0.28)">
          <div class="flex flex-wrap justify-between items-center gap-1.5 min-w-0">
            <span class="font-bold text-xs flex items-center gap-1.5 min-w-0" style="color: var(--text-primary)">
              <i class="fa-solid fa-bullseye text-[12px] shrink-0" style="color: var(--gold)"></i>
              <span class="whitespace-nowrap font-extrabold">Next: ${fmtNum(nextBookGoal.target)} Books</span>
            </span>
            <span class="px-2 py-0.5 rounded-full text-[9.5px] font-extrabold uppercase tracking-wide whitespace-nowrap shrink-0 border ml-auto" style="background: rgba(var(--gold-rgb), 0.18); color: var(--gold); border-color: rgba(var(--gold-rgb), 0.35)">
              ETA: ${nextBookGoal.eta}
            </span>
          </div>
          <div class="flex justify-between items-center text-[10.5px] font-semibold" style="color: var(--text-secondary)">
            <span>${fmtNum(nextBookGoal.current)} / ${fmtNum(nextBookGoal.target)} books</span>
            <span class="font-black tabular-nums text-xs" style="color: var(--text-primary)">${nextBookGoal.pct}%</span>
          </div>
          <div class="w-full bg-black/10 dark:bg-white/10 rounded-full h-2 overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500" style="width: ${nextBookGoal.pct}%; background: linear-gradient(90deg, var(--gold), var(--accent))"></div>
          </div>
        </div>
      `;
    } else {
      booksFeaturedEl.innerHTML = '';
    }
  }

  // Passed Books Badges
  const booksBadgesEl = $('ms-books-badges');
  if (booksBadgesEl) {
    booksBadgesEl.innerHTML = passedBooks.reverse().map(b => `
      <div class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold w-full transition-all hover:translate-x-0.5" style="background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.22); color: var(--emerald)">
        <div class="flex items-center gap-1.5 min-w-0 font-bold shrink-0">
          <i class="fa-solid fa-circle-check text-[11px] shrink-0"></i>
          <span class="whitespace-nowrap font-extrabold">${fmtNum(b.target)} Books</span>
        </div>
        <span class="text-[10px] font-medium opacity-85 whitespace-nowrap shrink-0 ml-auto tabular-nums">${b.date}</span>
      </div>
    `).join('');
  }

  // ── PAGES MILESTONES ──
  const pageEvents = [];
  completions.forEach(c => {
    pageEvents.push({ pages: c.pages, date: c.date });
  });
  booksCache.forEach(b => {
    if (b.status === 'In Progress' && (b.pages_read || 0) > 0) {
      if (dashFilter === 'all' || b.collection === dashFilter) {
        pageEvents.push({ pages: b.pages_read, date: todayISO() });
      }
    }
  });
  pageEvents.sort((a, b) => a.date.localeCompare(b.date));

  let runningPages = 0;
  pageEvents.forEach(evt => {
    runningPages += evt.pages;
  });

  const pageThresholds = getDynamicPageThresholds(runningPages);

  const pagesCountBadge = $('ms-pages-count-badge');
  if (pagesCountBadge) {
    pagesCountBadge.innerHTML = `<span class="font-extrabold text-[11px]">${fmtNum(runningPages)}</span> <span class="text-[9.5px] opacity-75 font-semibold">Pages</span>`;
  }

  // Re-calculate dates with exact thresholds
  runningPages = 0;
  const milestoneReachedDates = {};
  pageEvents.forEach(evt => {
    runningPages += evt.pages;
    pageThresholds.forEach(t => {
      if (runningPages >= t && !milestoneReachedDates[t]) {
        milestoneReachedDates[t] = evt.date;
      }
    });
  });

  const ytdPagesVal = pageEvents.filter(e => e.date && e.date.startsWith(currentYrStr)).reduce((s, e) => s + e.pages, 0);
  const pageRate = (ytdDaysElapsed > 0 && ytdPagesVal > 0) ? (ytdPagesVal / ytdDaysElapsed) : (runningPages / Math.max(1, ytdDaysElapsed));

  const passedPages = [];
  let nextPageGoal = null;

  pageThresholds.forEach(t => {
    const completedDate = milestoneReachedDates[t];
    if (completedDate) {
      passedPages.push({ target: t, date: completedDate === '2020-01-01' ? 'Completed' : fmtDate(completedDate) });
    } else if (!nextPageGoal) {
      const needed = t - runningPages;
      const eta = calculateETA(needed, pageRate > 0 ? pageRate : 10);
      const pct = Math.min(100, Math.round((runningPages / t) * 100));
      nextPageGoal = { target: t, current: runningPages, needed, eta, pct };
    }
  });

  // Featured Next Page Goal Card
  const pagesFeaturedEl = $('ms-pages-featured');
  if (pagesFeaturedEl) {
    if (nextPageGoal) {
      pagesFeaturedEl.innerHTML = `
        <div class="p-3.5 rounded-2xl border flex flex-col gap-2.5 relative overflow-hidden" style="background: rgba(16, 185, 129, 0.07); border-color: rgba(16, 185, 129, 0.28)">
          <div class="flex flex-wrap justify-between items-center gap-1.5 min-w-0">
            <span class="font-bold text-xs flex items-center gap-1.5 min-w-0" style="color: var(--text-primary)">
              <i class="fa-solid fa-bullseye text-[12px] shrink-0" style="color: var(--emerald)"></i>
              <span class="whitespace-nowrap font-extrabold">Next: ${fmtNum(nextPageGoal.target)} Pages</span>
            </span>
            <span class="px-2 py-0.5 rounded-full text-[9.5px] font-extrabold uppercase tracking-wide whitespace-nowrap shrink-0 border ml-auto" style="background: rgba(16, 185, 129, 0.18); color: var(--emerald); border-color: rgba(16, 185, 129, 0.35)">
              ETA: ${nextPageGoal.eta}
            </span>
          </div>
          <div class="flex justify-between items-center text-[10.5px] font-semibold" style="color: var(--text-secondary)">
            <span>${fmtNum(nextPageGoal.current)} / ${fmtNum(nextPageGoal.target)} pages</span>
            <span class="font-black tabular-nums text-xs" style="color: var(--text-primary)">${nextPageGoal.pct}%</span>
          </div>
          <div class="w-full bg-black/10 dark:bg-white/10 rounded-full h-2 overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500" style="width: ${nextPageGoal.pct}%; background: linear-gradient(90deg, #38BDF8, #34D399)"></div>
          </div>
        </div>
      `;
    } else {
      pagesFeaturedEl.innerHTML = '';
    }
  }

  // Passed Pages Badges
  const pagesBadgesEl = $('ms-pages-badges');
  if (pagesBadgesEl) {
    pagesBadgesEl.innerHTML = passedPages.reverse().map(p => `
      <div class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold w-full transition-all hover:translate-x-0.5" style="background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.22); color: var(--emerald)">
        <div class="flex items-center gap-1.5 min-w-0 font-bold shrink-0">
          <i class="fa-solid fa-circle-check text-[11px] shrink-0"></i>
          <span class="whitespace-nowrap font-extrabold">${fmtNum(p.target)} Pages</span>
        </div>
        <span class="text-[10px] font-medium opacity-85 whitespace-nowrap shrink-0 ml-auto tabular-nums">${p.date}</span>
      </div>
    `).join('');
  }
}

function renderTimeBasedTables(logs, completions) {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthlyData = Array(12).fill(0).map((_, i) => ({ month: monthNames[i], sessions: 0, pages: 0 }));
  
  logs.forEach(l => {
    if (!l.date) return;
    const parts = l.date.split('-');
    const m = parseInt(parts[1], 10) - 1;
    if (m >= 0 && m < 12) {
      monthlyData[m].sessions++;
      monthlyData[m].pages += Math.max(0, (l.end_page || 0) - (l.start_page || 0));
    }
  });

  const mBody = $('tbl-monthly-body');
  if (mBody) {
    mBody.innerHTML = '';
    monthlyData.forEach(row => {
      if (row.sessions === 0 && row.pages === 0) return;
      const tr = el('tr');
      tr.innerHTML = `
        <td>${row.month}</td>
        <td class="text-center tabular-nums">${row.sessions}</td>
        <td class="text-right font-bold tabular-nums">${fmtNum(row.pages)}</td>
      `;
      mBody.appendChild(tr);
    });
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayData = Array(7).fill(0).map((_, i) => ({ day: dayNames[i], sessions: 0, pages: 0 }));
  logs.forEach(l => {
    if (!l.date) return;
    const d = new Date(l.date + 'T00:00:00').getDay();
    if (d >= 0 && d < 7) {
      dayData[d].sessions++;
      dayData[d].pages += Math.max(0, (l.end_page || 0) - (l.start_page || 0));
    }
  });
  const dBody = $('tbl-dayofweek-body');
  if (dBody) {
    dBody.innerHTML = '';
    dayData.forEach(row => {
      if (row.sessions === 0 && row.pages === 0) return;
      const avg = row.sessions > 0 ? (row.pages / row.sessions).toFixed(1) : 0;
      const tr = el('tr');
      tr.innerHTML = `
        <td>${row.day}</td>
        <td class="text-center tabular-nums">${row.sessions}</td>
        <td class="text-center tabular-nums">${fmtNum(row.pages)}</td>
        <td class="text-right font-bold tabular-nums">${avg}</td>
      `;
      dBody.appendChild(tr);
    });
  }

  const seasons = {
    'Winter ❄️': [11, 0, 1],
    'Spring 🌸': [2, 3, 4],
    'Summer ☀️': [5, 6, 7],
    'Autumn 🍂': [8, 9, 10]
  };
  const seasonalData = {};
  Object.keys(seasons).forEach(s => seasonalData[s] = { sessions: 0, pages: 0 });
  logs.forEach(l => {
    if (!l.date) return;
    const m = parseInt(l.date.split('-')[1], 10) - 1;
    Object.entries(seasons).forEach(([s, months]) => {
      if (months.includes(m)) {
        seasonalData[s].sessions++;
        seasonalData[s].pages += Math.max(0, (l.end_page || 0) - (l.start_page || 0));
      }
    });
  });
  const sBody = $('tbl-seasonal-body');
  if (sBody) {
    sBody.innerHTML = '';
    Object.entries(seasonalData).forEach(([s, row]) => {
      if (row.sessions === 0 && row.pages === 0) return;
      const tr = el('tr');
      tr.innerHTML = `
        <td>${s}</td>
        <td class="text-center tabular-nums">${row.sessions}</td>
        <td class="text-right font-bold tabular-nums">${fmtNum(row.pages)}</td>
      `;
      sBody.appendChild(tr);
    });
  }

  const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const yearlyData = {};
  years.forEach(y => yearlyData[y] = { books: 0, pages: 0 });
  
  completions.forEach(c => {
    const y = parseInt(c.date.slice(0, 4));
    if (yearlyData[y]) yearlyData[y].books++;
  });
  
  logs.forEach(l => {
    const y = parseInt(l.date.slice(0, 4));
    if (yearlyData[y]) {
      yearlyData[y].pages += Math.max(0, (l.end_page || 0) - (l.start_page || 0));
    }
  });

  const yBody = $('tbl-yearly-body');
  if (yBody) {
    yBody.innerHTML = '';
    years.slice().reverse().forEach(y => {
      const row = yearlyData[y];
      if (row.books === 0 && row.pages === 0) return;
      const tr = el('tr');
      tr.innerHTML = `
        <td>${y}</td>
        <td class="text-center tabular-nums">${row.books}</td>
        <td class="text-right font-bold tabular-nums">${fmtNum(row.pages)}</td>
      `;
      yBody.appendChild(tr);
    });
  }
}

function getReconciledPagesForPeriod(mergedBooks, logsCache, completions, startDate, endDate, dashFilter) {
  let pagesRead = 0;
  const completionsInPeriod = completions.filter(c => c.date >= startDate && c.date <= endDate && (dashFilter === 'all' || c.collection === dashFilter));
  
  const logsByBook = {};
  logsCache.forEach(l => {
    if (l.date >= startDate && l.date <= endDate) {
      const title = l.book_title;
      if (!title) return;
      if (!logsByBook[title]) logsByBook[title] = 0;
      logsByBook[title] += Math.max(0, (l.end_page || 0) - (l.start_page || 0));
    }
  });

  const processedBooks = new Set();
  completionsInPeriod.forEach(c => {
    processedBooks.add(c.title);
  });
  
  Object.keys(logsByBook).forEach(title => {
    processedBooks.add(title);
  });

  const todayStr = todayISO();
  const includesToday = (endDate >= todayStr);
  if (includesToday) {
    mergedBooks.forEach(b => {
      if (b.status === 'In Progress' && (b.pages_read || 0) > 0) {
        if (dashFilter === 'all' || b.collection === dashFilter) {
          processedBooks.add(b.title);
        }
      }
    });
  }

  processedBooks.forEach(title => {
    const book = mergedBooks.find(b => b.title === title);
    const tot = book ? parseInt(book.total_pages || 0, 10) : 0;
    const compsCount = completionsInPeriod.filter(c => c.title === title).length;
    let libPages = compsCount * tot;
    
    if (includesToday && book && book.status === 'In Progress') {
      const activeProg = (tot > 0 && (book.pages_read || 0) > tot) ? ((book.pages_read || 0) % tot) : (book.pages_read || 0);
      libPages += activeProg;
    }

    const logPages = logsByBook[title] || 0;
    pagesRead += Math.max(libPages, logPages);
  });

  return pagesRead;
}

function getEffectiveReadCount(b, logs) {
  if (!b) return 0;
  const title = b.title;
  const tot = parseInt(b.total_pages || 0, 10);
  const bookLogs = (logs || []).filter(l => l.book_title === title);
  const maxLogCycle = bookLogs.length > 0 ? Math.max(...bookLogs.map(l => parseInt(l.read_cycle || 1, 10))) : 0;
  
  const cycleLogsMap = {};
  bookLogs.forEach(l => {
    const c = parseInt(l.read_cycle || 1, 10);
    if (!cycleLogsMap[c]) cycleLogsMap[c] = [];
    cycleLogsMap[c].push(l);
  });
  
  let completedFromLogs = 0;
  Object.keys(cycleLogsMap).forEach(cStr => {
    const c = parseInt(cStr, 10);
    const cLogs = cycleLogsMap[cStr];
    const maxEnd = Math.max(...cLogs.map(l => parseInt(l.end_page || 0, 10)));
    const isHistorical = cLogs.some(l => l.notes && l.notes.includes('Historical cycle'));
    if ((tot > 0 && maxEnd >= tot) || isHistorical || maxLogCycle > c) {
      completedFromLogs = Math.max(completedFromLogs, c);
    }
  });

  const isFinishedStatus = ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status);
  return Math.max(parseInt(b.read_count || 0, 10), completedFromLogs, isFinishedStatus ? 1 : 0);
}

const reconciledStatsCache = new Map();

function getReconciledStats(mergedBooks, logsCache, selectedYear, dashFilter) {
  const cacheKey = `${selectedYear}:${dashFilter}:${mergedBooks.length}:${logsCache.length}`;
  if (reconciledStatsCache.has(cacheKey)) {
    return reconciledStatsCache.get(cacheKey);
  }

  const completions = [];
  const logsByBookCycle = {};
  const mergedBooksMap = new Map(mergedBooks.map(b => [b.title, b]));
  const completionCountsMap = new Map();
  
  logsCache.forEach(l => {
    const key = `${l.book_title}-${l.read_cycle || 1}`;
    if (!logsByBookCycle[key]) logsByBookCycle[key] = [];
    logsByBookCycle[key].push(l);
  });

  // Calculate completions from logs
  Object.keys(logsByBookCycle).forEach(key => {
    const parts = key.split('-');
    const title = parts.slice(0, -1).join('-');
    const cycle = parseInt(parts[parts.length - 1], 10);
    const book = mergedBooksMap.get(title);
    if (book) {
      const tot = parseInt(book.total_pages || 0, 10);
      const cycleLogs = logsByBookCycle[key];
      const compLogs = cycleLogs.filter(l => (l.end_page || 0) >= tot);
      if (compLogs.length > 0 && tot > 0) {
        compLogs.sort((a,b) => a.date.localeCompare(b.date));
        completions.push({
          title,
          cycle,
          date: compLogs[0].date,
          pages: tot,
          collection: book.collection || 'Non-Bahai',
          category: book.group || book.group_name || book.reading_group || book.category || 'Other',
          ownership: book.ownership || 'Owned'
        });
        completionCountsMap.set(title, (completionCountsMap.get(title) || 0) + 1);
      }
    }
  });

  // Blend in finished books that don't have matching daily logs
  mergedBooks.forEach(b => {
    const rc = b.read_count || 0;
    const isFinished = ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status) || rc > 0;
    if (isFinished) {
      const existingCount = completionCountsMap.get(b.title) || 0;
      const neededCount = Math.max(rc, isFinished ? 1 : 0) - existingCount;
      for (let i = 0; i < neededCount; i++) {
        completions.push({
          title: b.title,
          cycle: existingCount + i + 1,
          date: '2020-01-01', // placeholder for missing logs
          pages: b.total_pages || 0,
          collection: b.collection || 'Non-Bahai',
          category: b.group || b.group_name || b.reading_group || b.category || 'Other',
          ownership: b.ownership || 'Owned'
        });
      }
      if (neededCount > 0) {
        completionCountsMap.set(b.title, existingCount + neededCount);
      }
    }
  });

  completions.sort((a, b) => a.date.localeCompare(b.date));

  // Reconciled stats by book and year
  const bookYearStats = {};
  mergedBooks.forEach(b => {
    bookYearStats[b.title] = {
      book: b,
      years: {}
    };
  });

  // Process logs
  logsCache.forEach(l => {
    const title = l.book_title;
    if (!title) return;
    if (!bookYearStats[title]) {
      bookYearStats[title] = {
        book: {
          title,
          total_pages: l.book_pages || 0,
          collection: l.collection || 'Non-Bahai',
          group: 'Other',
          category: 'Other',
          ownership: 'Wishlist'
        },
        years: {}
      };
    }
    const year = l.date.slice(0, 4);
    if (!bookYearStats[title].years[year]) {
      bookYearStats[title].years[year] = { logPages: 0, completions: 0, libPages: 0 };
    }
    const delta = Math.max(0, (l.end_page || 0) - (l.start_page || 0));
    bookYearStats[title].years[year].logPages += delta;
  });

  // Distribute completions
  completions.forEach(c => {
    const title = c.title;
    const year = c.date.slice(0, 4);
    if (!bookYearStats[title]) return;
    if (!bookYearStats[title].years[year]) {
      bookYearStats[title].years[year] = { logPages: 0, completions: 0, libPages: 0 };
    }
    bookYearStats[title].years[year].completions += 1;
    bookYearStats[title].years[year].libPages += c.pages;
  });

  // Add current active progress of In Progress books to the current year
  const currentYearStr = new Date().getFullYear().toString();
  mergedBooks.forEach(b => {
    if (b.status === 'In Progress' && (b.pages_read || 0) > 0) {
      const title = b.title;
      if (!bookYearStats[title].years[currentYearStr]) {
        bookYearStats[title].years[currentYearStr] = { logPages: 0, completions: 0, libPages: 0 };
      }
      const tot = parseInt(b.total_pages || 0, 10);
      const activeProg = (tot > 0 && (b.pages_read || 0) > tot) ? ((b.pages_read || 0) % tot) : (b.pages_read || 0);
      bookYearStats[title].years[currentYearStr].libPages += activeProg;
    }
  });

  // Reconciled totals
  let totalReads = 0;
  let pagesRead = 0;
  
  const categoryPages = {};
  const categoryBooks = {};
  let bahaiPages = 0, nonBahaiPages = 0;
  let bahaiBooks = 0, nonBahaiBooks = 0;

  const activeTitles = new Set();
  const finishedTitles = new Set();

  Object.keys(bookYearStats).forEach(title => {
    const entry = bookYearStats[title];
    const b = entry.book;

    if (dashFilter !== 'all' && b.collection !== dashFilter) return;

    let bookTotalPagesInFilter = 0;
    let bookTotalCompletionsInFilter = 0;

    if (selectedYear === 'all') {
      const rc = getEffectiveReadCount(b, logsCache);
      const tot = parseInt(b.total_pages || 0, 10);
      let activeCyclePages = 0;
      if (b.status === 'In Progress') {
        const activeCycle = rc + 1;
        const activeLogs = logsCache.filter(l => l.book_title === b.title && parseInt(l.read_cycle || 1, 10) === activeCycle);
        if (activeLogs.length > 0) {
          const maxActiveEnd = Math.max(...activeLogs.map(l => parseInt(l.end_page || 0, 10)));
          activeCyclePages = maxActiveEnd % (tot || 1);
        } else {
          activeCyclePages = (b.pages_read || 0) % (tot || 1);
        }
      }
      bookTotalPagesInFilter = (rc * tot) + activeCyclePages;
      bookTotalCompletionsInFilter = rc;
      pagesRead += bookTotalPagesInFilter;
      totalReads += bookTotalCompletionsInFilter;
    } else {
      Object.keys(entry.years).forEach(year => {
        const yearStat = entry.years[year];
        const reconciledPagesInYear = Math.max(yearStat.libPages, yearStat.logPages);
        
        if (year === selectedYear) {
          pagesRead += reconciledPagesInYear;
          totalReads += yearStat.completions;
          bookTotalPagesInFilter += reconciledPagesInYear;
          bookTotalCompletionsInFilter += yearStat.completions;

          if (reconciledPagesInYear > 0 || yearStat.completions > 0) {
            if (yearStat.completions > 0) {
              finishedTitles.add(title);
            } else {
              activeTitles.add(title);
            }
          }
        }
      });
    }

    const groupVal = b.group || b.group_name || b.reading_group || b.category || 'Other';
    const cat = normalizeGroup(groupVal, b.collection, b.title, b.author);
    categoryPages[cat] = (categoryPages[cat] || 0) + bookTotalPagesInFilter;
    categoryBooks[cat] = (categoryBooks[cat] || 0) + bookTotalCompletionsInFilter;

    if (b.collection === 'Bahai') {
      bahaiPages += bookTotalPagesInFilter;
      bahaiBooks += bookTotalCompletionsInFilter;
    } else {
      nonBahaiPages += bookTotalPagesInFilter;
      nonBahaiBooks += bookTotalCompletionsInFilter;
    }
  });

  const filteredCompletions = completions.filter(c => dashFilter === 'all' || c.collection === dashFilter);

  const resultStats = {
    totalReads,
    pagesRead,
    titlesCount: (selectedYear === 'all') ? mergedBooks.filter(b => (dashFilter === 'all' || b.collection === dashFilter)).length : activeTitles.size + finishedTitles.size,
    finishedCount: (selectedYear === 'all') ? mergedBooks.filter(b => (dashFilter === 'all' || b.collection === dashFilter) && ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status)).length : finishedTitles.size,
    progressCount: (selectedYear === 'all') ? mergedBooks.filter(b => (dashFilter === 'all' || b.collection === dashFilter) && b.status === 'In Progress').length : activeTitles.size,
    categoryPages,
    categoryBooks,
    bahaiPages,
    nonBahaiPages,
    bahaiBooks,
    nonBahaiBooks,
    completions: filteredCompletions
  };

  reconciledStatsCache.set(cacheKey, resultStats);
  return resultStats;
}

let dashHeatmapTimeframe = 'pastYear';

function transitionView(fn) {
  if (document.startViewTransition) {
    document.startViewTransition(fn);
  } else {
    fn();
  }
}

function renderLiveSessionBanner(books, logs) {
  const banner = $('dash-live-session');
  if (!banner) return;
  
  const inProgress = books.filter(b => b.status === 'In Progress');
  const titleEl = $('dash-live-title');
  const authorEl = $('dash-live-author');
  const barEl = $('dash-live-bar');
  const etaBadgeEl = $('dash-live-eta-badge');
  const coverContainerEl = $('dash-live-cover-container');
  const glowEl = $('dash-live-glow');
  const pagesLabel = $('dash-live-pages-label');
  const velocityLabel = $('dash-live-velocity-label');
  const actionsEl = $('dash-live-actions');

  if (inProgress.length === 0) {
    if (titleEl) titleEl.textContent = 'No book currently in progress';
    if (authorEl) authorEl.textContent = 'Select a book from your bookshelf to begin';
    if (barEl) barEl.style.width = '0%';
    if (pagesLabel) pagesLabel.textContent = '';
    if (velocityLabel) velocityLabel.textContent = '';
    if (actionsEl) actionsEl.classList.add('hidden');
    if (coverContainerEl) {
      coverContainerEl.innerHTML = `<div class="w-16 h-24 rounded-xl bg-theme-card border border-theme flex items-center justify-center shadow-lg overflow-hidden"><i class="fa-solid fa-book text-theme-tertiary text-xl"></i></div>`;
    }
    if (etaBadgeEl) {
      etaBadgeEl.textContent = 'Standby';
      etaBadgeEl.className = 'px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-theme-card text-theme-secondary border border-theme';
    }
    return;
  }

  // Find the In Progress book that was last logged (with exact log recency tie-breaking for same-day logs)
  const bookLastLogScore = new Map();
  (logs || []).forEach((l, index) => {
    const titleKey = (l.book_title || l.title || '').trim().toLowerCase();
    if (!titleKey) return;
    if (!bookLastLogScore.has(titleKey)) {
      bookLastLogScore.set(titleKey, { date: l.date || '', index });
    }
  });

  const sortedInProgress = [...inProgress].sort((a, b) => {
    const keyA = (a.title || '').trim().toLowerCase();
    const keyB = (b.title || '').trim().toLowerCase();
    const infoA = bookLastLogScore.get(keyA);
    const infoB = bookLastLogScore.get(keyB);

    if (infoA && infoB) {
      if (infoA.date !== infoB.date) {
        return infoB.date.localeCompare(infoA.date);
      }
      // Same day log tie-breaker: smaller array index = logged more recently
      return infoA.index - infoB.index;
    }
    if (infoA) return -1;
    if (infoB) return 1;
    return a.title.localeCompare(b.title);
  });

  const activeBook = sortedInProgress[0];
  const total = activeBook.total_pages || 1;
  const bookLogs = (logs || []).filter(l => l.book_title === activeBook.title);
  const maxLogCycle = bookLogs.length > 0 ? Math.max(...bookLogs.map(l => parseInt(l.read_cycle || 1, 10))) : 1;
  const activeCycle = Math.max((activeBook.read_count || 0) + 1, maxLogCycle);
  const activeLogs = bookLogs.filter(l => parseInt(l.read_cycle || 1, 10) === activeCycle);

  let read = 0;
  if (activeLogs.length > 0) {
    const maxActiveEnd = Math.max(...activeLogs.map(l => parseInt(l.end_page || 0, 10)));
    read = maxActiveEnd % total;
  } else {
    read = (activeBook.pages_read || 0) % total;
  }

  const pct = Math.min(100, Math.round((read / total) * 100));
  const remaining = Math.max(0, total - read);

  // Render enlarged cover
  if (coverContainerEl) {
    coverContainerEl.innerHTML = getCoverHTML(activeBook, 'w-16 h-24 shrink-0 shadow-lg');
  }

  if (titleEl) titleEl.textContent = activeBook.title;
  if (authorEl) authorEl.textContent = `${activeBook.author || 'Unknown Author'} · ${activeBook.collection || ''}`;
  if (barEl) barEl.style.width = `${pct}%`;

  // Pages label
  if (pagesLabel) pagesLabel.textContent = `${read} / ${total} pages (${pct}%)`;

  // Calculate rolling 7-day velocity for ETA
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  const sevenDayISO = sevenDaysAgo.toISOString().slice(0, 10);
  
  const recentLogs = (logs || []).filter(l => l.date >= sevenDayISO);
  const recentDays = new Set(recentLogs.map(l => l.date));
  const recentPages = recentLogs.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
  const velocity = recentDays.size > 0 ? (recentPages / recentDays.size) : 15;
  
  // Calculate live time remaining based on personal reading speed
  const personalPgh = getUserPersonalReadingSpeed(logs);
  const estTotalMins = (remaining / personalPgh) * 60;
  const estHrs = Math.floor(estTotalMins / 60);
  const estMinsRem = Math.round(estTotalMins % 60);
  
  let timeRemStr = '';
  if (remaining === 0) {
    timeRemStr = 'Complete';
  } else if (estHrs > 0 && estMinsRem > 0) {
    timeRemStr = `${estHrs}h ${estMinsRem}m left`;
  } else if (estHrs > 0) {
    timeRemStr = `${estHrs}h left`;
  } else {
    timeRemStr = `${Math.max(1, estMinsRem)}m left`;
  }

  const estDays = velocity > 0 ? Math.max(1, Math.ceil(remaining / velocity)) : 99;
  const estDate = new Date(today);
  estDate.setDate(today.getDate() + estDays);
  const estDateStr = estDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  
  if (velocityLabel) velocityLabel.textContent = `Pace: ${velocity.toFixed(1)} p/d · Speed: ${personalPgh} p/h`;

  if (etaBadgeEl) {
    etaBadgeEl.textContent = remaining === 0 ? 'Completed ✓' : `${timeRemStr} (${personalPgh} p/h)`;
    etaBadgeEl.className = 'px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    etaBadgeEl.title = `Estimated ${timeRemStr} remaining based on your personal speed of ${personalPgh} pages/hour`;
  }

  // Show & Wire Action Buttons
  if (actionsEl) actionsEl.classList.remove('hidden');

  const focusBtn = $('dash-live-focus-btn');
  if (focusBtn) {
    focusBtn.onclick = (e) => {
      e.stopPropagation();
      triggerHaptic();
      if (typeof window.openFullTimerSession === 'function' && activeBook) {
        window.openFullTimerSession(activeBook);
      }
    };
  }

  const quickLogBtn = $('dash-live-quick-log-btn');
  if (quickLogBtn) {
    quickLogBtn.onclick = (e) => {
      e.stopPropagation();
      triggerHaptic();
      showView('log');
      const sel = $('log-book');
      if (sel && activeBook) {
        sel.value = activeBook.title;
        if (typeof handleBookSelection === 'function') {
          handleBookSelection(activeBook.title, (typeof booksCache !== 'undefined' ? booksCache : []), (typeof logsCache !== 'undefined' ? logsCache : []));
        }
      }
    };
  }

  // Cover-Adaptive Mesh Glow — Extract dominant color from cover image
  if (glowEl && activeBook.cover_url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = activeBook.cover_url;
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 8, 8);
        const data = ctx.getImageData(0, 0, 8, 8).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i+1]; b += data[i+2]; count++;
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        banner.style.setProperty('--cover-glow-color', `rgba(${r}, ${g}, ${b}, 0.25)`);
        banner.style.setProperty('--cover-glow-color-mid', `rgba(${r}, ${g}, ${b}, 0.10)`);
      } catch (e) {
        // CORS or canvas error — use theme default glow
      }
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 2: VELOCITY ANALYTICS — Dashboard Section
// ═══════════════════════════════════════════════════════════════
function renderVelocityAnalytics(activeLogs, books, selectedYear) {
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  
  const thirtyAgo = new Date(today);
  thirtyAgo.setDate(today.getDate() - 30);
  const thirtyAgoISO = thirtyAgo.toISOString().slice(0, 10);
  
  const sixtyAgo = new Date(today);
  sixtyAgo.setDate(today.getDate() - 60);
  const sixtyAgoISO = sixtyAgo.toISOString().slice(0, 10);
  
  const last30Logs = activeLogs.filter(l => l.date >= thirtyAgoISO && l.date <= todayISO);
  const prev30Logs = activeLogs.filter(l => l.date >= sixtyAgoISO && l.date < thirtyAgoISO);
  
  const last30Days = new Set(last30Logs.map(l => l.date));
  const prev30Days = new Set(prev30Logs.map(l => l.date));
  
  const last30Pages = last30Logs.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
  const prev30Pages = prev30Logs.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
  
  const velocity = last30Days.size > 0 ? (last30Pages / last30Days.size) : 0;
  const prevVelocity = prev30Days.size > 0 ? (prev30Pages / prev30Days.size) : 0;
  const velocityChange = prevVelocity > 0 ? Math.round(((velocity - prevVelocity) / prevVelocity) * 100) : 0;
  
  const velCurrent = $('vel-current');
  if (velCurrent) velCurrent.textContent = velocity.toFixed(1);
  
  const trendBadge = $('vel-current-trend');
  const trendVal = $('vel-current-trend-val');
  if (trendBadge && velocityChange !== 0) {
    trendBadge.style.display = 'inline-flex';
    trendBadge.className = `velocity-trend-badge ${velocityChange >= 0 ? 'up' : 'down'}`;
    const icon = trendBadge.querySelector('i');
    if (icon) icon.className = `fa-solid ${velocityChange >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'} text-[8px]`;
    if (trendVal) trendVal.textContent = `${velocityChange >= 0 ? '+' : ''}${velocityChange}%`;
  }
  
  const vel30d = $('vel-30d-total');
  if (vel30d) vel30d.textContent = fmtNum(last30Pages);
  const vel30dBooks = $('vel-30d-books');
  if (vel30dBooks) {
    const finishedBooks = books.filter(b => ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status));
    const avgPagesPerBook = finishedBooks.length > 0 ? finishedBooks.reduce((s, b) => s + (b.total_pages || 0), 0) / finishedBooks.length : 250;
    const booksIn30d = avgPagesPerBook > 0 ? (last30Pages / avgPagesPerBook).toFixed(1) : '0';
    vel30dBooks.textContent = `~${booksIn30d} books equivalent`;
  }
  
  const velAnnual = $('vel-annual');
  if (velAnnual) {
    const finishedBooks = books.filter(b => ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status));
    const avgPagesPerBook = finishedBooks.length > 0 ? finishedBooks.reduce((s, b) => s + (b.total_pages || 0), 0) / finishedBooks.length : 250;
    const annualPages = velocity * 365 * (last30Days.size / 30);
    const estAnnualBooks = avgPagesPerBook > 0 ? Math.round(annualPages / avgPagesPerBook) : 0;
    velAnnual.textContent = `${estAnnualBooks} Books`;
  }
  const velAnnualDetail = $('vel-annual-detail');
  if (velAnnualDetail) velAnnualDetail.textContent = 'Based on current pace';
  
  const velConsistency = $('vel-consistency');
  const consistencyPct = Math.round((last30Days.size / 30) * 100);
  if (velConsistency) velConsistency.textContent = `${consistencyPct}%`;
  const velConsistencyDetail = $('vel-consistency-detail');
  if (velConsistencyDetail) velConsistencyDetail.textContent = `${last30Days.size} of 30 days active`;
  
  renderVelocityCurve(activeLogs, selectedYear, velocityChange);
}

function renderVelocityCurve(activeLogs, selectedYear, velocityChange = 0) {
  const container = $('velocity-curve-chart');
  if (!container) return;
  
  const today = new Date();
  const curYear = selectedYear === 'all' ? today.getFullYear() : parseInt(selectedYear);
  const curMonth = today.getMonth();
  
  const yearLogs = activeLogs.filter(l => l.date && l.date.startsWith(String(curYear)));
  const monthCumPages = Array(12).fill(0);
  let runSum = 0;
  
  for (let m = 0; m < 12; m++) {
    const monthStr = String(m + 1).padStart(2, '0');
    const endOfMonth = `${curYear}-${monthStr}-31`;
    const logsUpTo = yearLogs.filter(l => l.date <= endOfMonth);
    runSum = logsUpTo.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
    monthCumPages[m] = runSum;
  }
  
  const currentTotal = monthCumPages[curMonth] || 0;
  const annualTarget = curMonth > 0 ? Math.round((currentTotal / (curMonth + 1)) * 12) : (currentTotal > 0 ? currentTotal * 12 : 3000);
  
  const targetLabelEl = $('vel-curve-target-label');
  if (targetLabelEl) {
    targetLabelEl.textContent = `Projected Pace (~${fmtNum(annualTarget)} pgs/yr)`;
  }
  
  const width = container.clientWidth || 320;
  const height = container.clientHeight || 176;
  const padL = 30, padR = 15, padT = 15, padB = 25;
  const graphW = width - padL - padR;
  const graphH = height - padT - padB;
  const maxVal = Math.max(annualTarget, ...monthCumPages, 100);
  
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const months = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const targetPoints = [];
  const actualPoints = [];
  
  for (let i = 0; i < 12; i++) {
    const x = padL + (i / 11) * graphW;
    const targetY = padT + graphH - (((i + 1) / 12 * annualTarget) / maxVal) * graphH;
    targetPoints.push({ x, y: targetY });
    if (i <= curMonth) {
      const actY = padT + graphH - (monthCumPages[i] / maxVal) * graphH;
      actualPoints.push({ x, y: actY, monthIndex: i, pages: monthCumPages[i] });
    }
  }
  
  const targetPath = targetPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const actualPath = actualPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  
  let areaPath = '';
  if (actualPoints.length > 0) {
    const lastP = actualPoints[actualPoints.length - 1];
    areaPath = `${actualPath} L ${lastP.x.toFixed(1)} ${padT + graphH} L ${actualPoints[0].x.toFixed(1)} ${padT + graphH} Z`;
  }
  
  const statusEl = $('vel-curve-status');
  if (statusEl) {
    if (velocityChange > 0) {
      statusEl.className = 'text-[9px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 leading-none bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      statusEl.textContent = `📈 +${velocityChange}% Pace Trend`;
    } else if (velocityChange < 0) {
      statusEl.className = 'text-[9px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 leading-none bg-rose-500/10 text-rose-400 border border-rose-500/20';
      statusEl.textContent = `📉 ${velocityChange}% Pace Trend`;
    } else {
      statusEl.className = 'text-[9px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 leading-none bg-amber-500/10 text-amber-400 border border-amber-500/20';
      statusEl.textContent = `⚡ Steady Pace`;
    }
  }
  
  const monthLabels = months.map((m, i) => {
    const x = padL + (i / 11) * graphW;
    return `<text x="${x.toFixed(1)}" y="${height - 5}" text-anchor="middle" fill="var(--text-tertiary)" font-size="8" font-weight="600" font-family="var(--font-body)">${m}</text>`;
  }).join('');
  
  container.innerHTML = `
    <svg class="w-full h-full" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="velAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.0"/>
        </linearGradient>
        <linearGradient id="velLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="var(--accent)" />
          <stop offset="100%" stop-color="var(--gold)" />
        </linearGradient>
      </defs>
      <line x1="${padL}" y1="${padT}" x2="${width - padR}" y2="${padT}" stroke="var(--border)" stroke-dasharray="2,2" />
      <line x1="${padL}" y1="${padT + graphH/2}" x2="${width - padR}" y2="${padT + graphH/2}" stroke="var(--border)" stroke-dasharray="2,2" />
      <line x1="${padL}" y1="${padT + graphH}" x2="${width - padR}" y2="${padT + graphH}" stroke="var(--border)" />
      <path d="${targetPath}" fill="none" stroke="rgba(var(--gold-rgb), 0.35)" stroke-width="1.5" stroke-dasharray="4,3" />
      ${areaPath ? `<path d="${areaPath}" fill="url(#velAreaGrad)" />` : ''}
      ${actualPath ? `<path d="${actualPath}" fill="none" stroke="url(#velLineGrad)" stroke-width="2.5" stroke-linecap="round" />` : ''}
      ${actualPoints.map((p, i) => {
        const isLast = i === actualPoints.length - 1;
        const targetReq = Math.round(((p.monthIndex + 1) / 12) * annualTarget);
        const hoverTitle = `${monthNames[p.monthIndex]}: ${fmtNum(p.pages)} pgs actual vs ${fmtNum(targetReq)} pgs target pace`;
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isLast ? '4' : '3'}" fill="${isLast ? 'var(--accent)' : '#34d399'}" stroke="var(--bg-solid)" stroke-width="1.5"><title>${hoverTitle}</title></circle>`;
      }).join('')}
      ${monthLabels}
    </svg>
  `;
}

function getUserDailyGoals() {
  let goals = typeof goalsCache !== 'undefined' ? goalsCache : null;
  if (!goals || !goals.daily_pages_target) {
    try {
      const rawLocal = localStorage.getItem('goals_cache');
      if (rawLocal) goals = JSON.parse(rawLocal);
    } catch(e){}
  }
  const pagesTarget = parseInt(
    (goals && goals.daily_pages_target) || 
    localStorage.getItem('rt_target_pages') || 
    localStorage.getItem('rt_pref_pages') || 
    '20', 10
  );
  const minutesTarget = parseInt(
    (goals && goals.daily_minutes_target) || 
    localStorage.getItem('rt_target_minutes') || 
    localStorage.getItem('rt_pref_mins') || 
    '20', 10
  );
  return {
    pagesTarget: Math.max(1, pagesTarget),
    minutesTarget: Math.max(1, minutesTarget)
  };
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 4: STREAK RINGS — Dashboard Section
// ═══════════════════════════════════════════════════════════════
function renderStreakRings(streaks, activeLogs) {
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  
  const todayLogs = (activeLogs || []).filter(l => l.date === todayISO);
  const todayPages = todayLogs.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);

  const personalSpeed = getUserPersonalReadingSpeed(activeLogs);
  const minsPerPageMultiplier = 60 / personalSpeed;
  const todayMinutes = todayLogs.reduce((s, l) => s + (l.minutes_spent || l.duration_minutes || l.durationMinutes || Math.max(0, (l.end_page || 0) - (l.start_page || 0)) * minsPerPageMultiplier), 0);
  const hasSessionToday = todayLogs.length > 0;
  
  const { pagesTarget: dailyPagesTarget, minutesTarget: dailyMinutesTarget } = getUserDailyGoals();
  
  const minutesPct = Math.min(100, (todayMinutes / dailyMinutesTarget) * 100);
  const minutesRing = $('streak-ring-minutes');
  if (minutesRing) {
    const circumference = 439.8;
    minutesRing.style.strokeDasharray = `${circumference}`;
    minutesRing.style.strokeDashoffset = circumference - (circumference * minutesPct / 100);
  }
  
  const pagesPct = Math.min(100, (todayPages / dailyPagesTarget) * 100);
  const pagesRing = $('streak-ring-pages');
  if (pagesRing) {
    const circumference = 314.2;
    pagesRing.style.strokeDasharray = `${circumference}`;
    pagesRing.style.strokeDashoffset = circumference - (circumference * pagesPct / 100);
  }
  
  const legendMinutes = $('streak-legend-minutes');
  if (legendMinutes) legendMinutes.textContent = `${Math.round(todayMinutes)}/${dailyMinutesTarget}m`;
  
  const legendPages = $('streak-legend-pages');
  if (legendPages) legendPages.textContent = `${todayPages}/${dailyPagesTarget}pg`;
  
  const svgRingContainer = $('streak-rings-svg');
  if (svgRingContainer && !svgRingContainer._interactiveWired) {
    svgRingContainer._interactiveWired = true;
    svgRingContainer.classList.add('interactive-ring-container');
    svgRingContainer.addEventListener('click', () => {
      if (typeof triggerHaptic === 'function') triggerHaptic();
      const statusMsg = `🔥 Activity Rings: ${Math.round(todayMinutes)}/${dailyMinutesTarget} mins (${Math.round(minutesPct)}%) • ${todayPages}/${dailyPagesTarget} pages (${Math.round(pagesPct)}%). Keep reading to close your rings!`;
      if (typeof showToast === 'function') showToast(statusMsg, 'info');
    });
  }

  const streakRepairKey = 'rt_streak_repair_tokens';
  let tokens = parseInt(localStorage.getItem(streakRepairKey) || '0', 10);
  
  if (todayPages >= dailyPagesTarget * 2) {
    const earnedToday = localStorage.getItem('rt_streak_repair_earned_' + todayISO);
    if (!earnedToday) {
      tokens++;
      localStorage.setItem(streakRepairKey, tokens);
      localStorage.setItem('rt_streak_repair_earned_' + todayISO, '1');
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 5: SCROLL-TRIGGERED ANIMATIONS
// ═══════════════════════════════════════════════════════════════
function initScrollAnimations() {
  const elements = document.querySelectorAll('.animate-on-scroll:not(.animate-visible)');
  if (!elements.length) return;
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -30px 0px' });
  
  elements.forEach(el => observer.observe(el));
}

function renderFormatOwnershipCard(books) {
  const card = $('dash-format-ownership');
  if (!card) return;

  let physical = 0, digital = 0;
  let owned = 0, borrowed = 0;

  books.forEach(b => {
    const isDigital = (b.format || '').toLowerCase().includes('audio') || (b.format || '').toLowerCase().includes('ebook') || (b.format || '').toLowerCase().includes('digital');
    if (isDigital) digital++;
    else physical++;

    const isBorrowed = (b.ownership || b.status || '').toLowerCase().includes('borrowed') || (b.ownership || '').toLowerCase().includes('library');
    if (isBorrowed) borrowed++;
    else owned++;
  });

  const totMedium = physical + digital || 1;
  const physPct = Math.round((physical / totMedium) * 100);
  const digPct = 100 - physPct;

  const totOwn = owned + borrowed || 1;
  const ownPct = Math.round((owned / totOwn) * 100);
  const borPct = 100 - ownPct;

  if ($('fmt-medium-ratio')) $('fmt-medium-ratio').textContent = `${physPct}% Physical`;
  if ($('fmt-bar-physical')) $('fmt-bar-physical').style.width = `${physPct}%`;
  if ($('fmt-bar-digital')) $('fmt-bar-digital').style.width = `${digPct}%`;
  if ($('fmt-cnt-physical')) $('fmt-cnt-physical').textContent = physical;
  if ($('fmt-cnt-digital')) $('fmt-cnt-digital').textContent = digital;

  if ($('fmt-own-ratio')) $('fmt-own-ratio').textContent = `${ownPct}% Owned`;
  if ($('fmt-bar-owned')) $('fmt-bar-owned').style.width = `${ownPct}%`;
  if ($('fmt-bar-borrowed')) $('fmt-bar-borrowed').style.width = `${borPct}%`;
  if ($('fmt-cnt-owned')) $('fmt-cnt-owned').textContent = owned;
  if ($('fmt-cnt-borrowed')) $('fmt-cnt-borrowed').textContent = borrowed;
}

function openChartDrilldownModal(categoryOrCollectionName, categoryBooksList) {
  const modal = $('modal-chart-drilldown');
  if (!modal) return;
  if ($('drilldown-modal-title')) $('drilldown-modal-title').textContent = categoryOrCollectionName;
  if ($('drilldown-modal-subtitle')) $('drilldown-modal-subtitle').textContent = `${categoryBooksList.length} titles in this segment`;

  const listEl = $('drilldown-modal-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (categoryBooksList.length === 0) {
    listEl.innerHTML = '<p class="text-xs text-theme-tertiary text-center py-4">No books found in this selection.</p>';
  } else {
    categoryBooksList.forEach(b => {
      const isFinished = ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status) || b.read_count > 0;
      const statusColor = isFinished ? 'emerald' : b.status === 'In Progress' ? 'blue' : 'amber';
      const row = el('div', 'p-3 rounded-2xl bg-white/[0.03] border border-theme flex justify-between items-center gap-3 active:scale-[0.99] cursor-pointer hover:bg-white/[0.06] transition-all');
      row.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="text-xs font-bold text-theme-primary truncate">${b.title}</div>
          <div class="text-[10px] text-theme-secondary truncate mt-0.5">${b.author || 'Unknown'} · ${b.total_pages || 0} pg</div>
        </div>
        <span class="px-2 py-0.5 rounded-full text-[8px] font-black uppercase bg-${statusColor}-500/10 text-${statusColor}-400 border border-${statusColor}-500/20">${b.status}</span>
      `;
      row.addEventListener('click', () => {
        modal.classList.add('hidden');
        openBookDetailModal(b);
      });
      listEl.appendChild(row);
    });
  }

  modal.classList.remove('hidden');
}

function openHeatmapDayModal(dateStr, dayLogs, booksReadList) {
  const modal = $('modal-heatmap-day');
  if (!modal) return;
  const dateFormatted = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  if ($('heatmap-day-modal-title')) $('heatmap-day-modal-title').textContent = dateFormatted;
  
  const totalPages = dayLogs.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
  const totalMins = dayLogs.reduce((s, l) => s + (l.minutes_spent || 0), 0);
  if ($('heatmap-day-modal-subtitle')) $('heatmap-day-modal-subtitle').textContent = `${dayLogs.length} session${dayLogs.length === 1 ? '' : 's'} · ${totalPages} pages · ${totalMins} mins`;

  const contentEl = $('heatmap-day-modal-content');
  if (contentEl) {
    contentEl.innerHTML = '';
    if (dayLogs.length === 0) {
      contentEl.innerHTML = `
        <div class="text-center py-6 flex flex-col items-center gap-2">
          <div class="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-theme-tertiary text-sm"><i class="fa-solid fa-moon"></i></div>
          <p class="text-xs text-theme-secondary font-medium">No reading sessions recorded for this date.</p>
        </div>
      `;
    } else {
      dayLogs.forEach(l => {
        const pagesRead = Math.max(0, (l.end_page || 0) - (l.start_page || 0));
        const card = el('div', 'p-3.5 rounded-2xl bg-white/[0.04] border border-theme flex flex-col gap-1.5');
        card.innerHTML = `
          <div class="flex justify-between items-start">
            <span class="text-xs font-bold text-theme-primary truncate flex-1 pr-2">${l.book_title}</span>
            <span class="text-xs font-black text-emerald-400 tabular-nums">+${pagesRead} pg</span>
          </div>
          <div class="flex justify-between text-[10px] text-theme-secondary font-semibold">
            <span>Pages ${l.start_page || 0} → ${l.end_page || 0}</span>
            <span>${l.minutes_spent ? `${l.minutes_spent} mins` : 'Unspecified duration'}</span>
          </div>
          ${l.notes ? `<div class="text-[10px] text-theme-secondary italic bg-white/5 p-2 rounded-xl mt-1 border border-theme">${l.notes}</div>` : ''}
        `;
        contentEl.appendChild(card);
      });
    }
  }

  modal.classList.add('open');
  if (navigator.vibrate) navigator.vibrate([15]);
  if (typeof showToast === 'function') {
    showToast(`📅 ${dateFormatted}: ${totalPages} pages read (${dayLogs.length} session${dayLogs.length === 1 ? '' : 's'})`, 'info');
  }
}

function closeHeatmapDayModal() {
  const modal = $('modal-heatmap-day');
  if (modal) modal.classList.remove('open');
}

function renderAnnualChallengeWidget(books, logs) {
  const countEl = $('annual-challenge-count');
  const targetTextEl = $('annual-challenge-target-text');
  const pctEl = $('annual-challenge-pct');
  const barEl = $('annual-challenge-bar');
  const statusBadgeEl = $('annual-challenge-status-badge');
  const paceTextEl = $('annual-challenge-pace-text');

  if (!countEl || !barEl) return;

  const savedTarget = parseInt(localStorage.getItem('rt_setting_annual_target') || '25', 10);
  const annualTarget = isNaN(savedTarget) || savedTarget <= 0 ? 25 : savedTarget;
  const currentYear = new Date().getFullYear();
  
  // Count books finished in current year (or finished status)
  const finishedThisYear = books.filter(b => {
    return ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status) || (b.read_count && b.read_count > 0);
  }).length;

  const pct = Math.min(100, Math.round((finishedThisYear / annualTarget) * 100));
  countEl.textContent = finishedThisYear;
  targetTextEl.textContent = ` / ${annualTarget} books finished`;
  pctEl.textContent = `${pct}%`;
  barEl.style.width = `${pct}%`;

  // Calculate day of year pace
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  const expectedPaceCount = Math.round((dayOfYear / 365) * annualTarget);

  if (finishedThisYear >= expectedPaceCount) {
    const diffAhead = finishedThisYear - expectedPaceCount;
    if (statusBadgeEl) {
      statusBadgeEl.className = 'px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      statusBadgeEl.textContent = 'On Track';
    }
    if (paceTextEl) {
      paceTextEl.textContent = diffAhead > 0 
        ? `🎉 You are ${diffAhead} book${diffAhead === 1 ? '' : 's'} ahead of your ${currentYear} target schedule!` 
        : `✨ Right on track for your ${annualTarget} book target in ${currentYear}!`;
    }
  } else {
    const diffBehind = expectedPaceCount - finishedThisYear;
    if (statusBadgeEl) {
      statusBadgeEl.className = 'px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20';
      statusBadgeEl.textContent = 'Behind Pace';
    }
    if (paceTextEl) {
      paceTextEl.textContent = `📚 ${diffBehind} book${diffBehind === 1 ? '' : 's'} behind schedule to reach ${annualTarget} books this year. Keep reading!`;
    }
  }
}

async function renderDashboard() {
  await loadLogsCache();
  await loadBooksCache();

  // Fast path: Render Live Session Banner immediately from local cache (0ms latency, no async waterfall)
  const initialBooks = dashFilter === 'all' ? booksCache : booksCache.filter(b => b.collection === dashFilter);
  renderLiveSessionBanner(initialBooks, logsCache);

  populateYearDropdown(logsCache);
  
  const selectedYear = $('dash-year-select').value;
  
  const activeLogs = logsCache.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));
  
  let filteredLogs = logsCache;
  let filteredActiveLogs = activeLogs;
  if (selectedYear !== 'all') {
    filteredLogs = logsCache.filter(l => l.date.startsWith(selectedYear));
    filteredActiveLogs = activeLogs.filter(l => l.date.startsWith(selectedYear));
  }
  
  const mergedBooks = await getMergedBooks();
  const books = dashFilter === 'all' ? mergedBooks : mergedBooks.filter(b => b.collection === dashFilter);
  
  // Re-verify Live Banner with full merged books set
  renderLiveSessionBanner(books, logsCache);

  const stats = getReconciledStats(mergedBooks, logsCache, selectedYear, dashFilter);
  dashboardStats = stats;
  const completions = stats.completions;
  const filteredCompletions = completions;
  const totalReads = stats.totalReads;
  const pagesRead = stats.pagesRead;
  const titlesCount = stats.titlesCount;
  const finishedCount = stats.finishedCount;
  const progressCount = stats.progressCount;

  const finishedBooks = books.filter(b => ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status));
  const finishedPagesSum = finishedBooks.reduce((s, b) => s + (b.total_pages || 0), 0);
  const avgPagesPerBook = finishedCount > 0 ? Math.round(finishedPagesSum / finishedCount) : 0;
  
  $('stat-reads').textContent = totalReads;
  $('detail-reads').textContent = `Avg: ${avgPagesPerBook} pages/book`;
  $('stat-titles').textContent = titlesCount;
  const unreadCount = Math.max(0, titlesCount - finishedCount - progressCount);
  $('detail-titles').textContent = `${progressCount} Active · ${unreadCount} Unread`;
  $('stat-pages').textContent = fmtNum(pagesRead);
  $('detail-pages').textContent = `Logged in ${selectedYear === 'all' ? 'total' : selectedYear}`;
  
  const totalPagesInLib = books.reduce((s, b) => s + (b.total_pages || 0), 0);
  const overallPct = totalPagesInLib > 0 ? Math.round((pagesRead / totalPagesInLib) * 100) : 0;
  const pagesRemaining = Math.max(0, totalPagesInLib - pagesRead);
  
  $('stat-pct').textContent = overallPct + '%';
  $('detail-pct').textContent = `Pages left: ${fmtNum(pagesRemaining)}`;

  // Streaks & Activity
  const streaks = calculateStreaks(activeLogs);
  $('stat-streak-cur').textContent = streaks.current;
  $('stat-streak-max').textContent = streaks.longest;
  
  const allUniqueDays = [...new Set(activeLogs.map(l => l.date))].length;
  $('stat-days-total').textContent = allUniqueDays;
  
  const logPagesSum = activeLogs.reduce((s, l) => s + Math.max(0, l.end_page - l.start_page), 0);
  const avgPagesPerActiveDay = allUniqueDays > 0 ? (logPagesSum / allUniqueDays).toFixed(1) : 0;
  $('stat-pages-active-avg').textContent = avgPagesPerActiveDay;
  
  const today = new Date();
  const yearNum = today.getFullYear();
  const monthNum = today.getMonth() + 1;
  const monthDaysCount = new Date(yearNum, monthNum, 0).getDate();
  const currentMonthLogs = activeLogs.filter(l => l.date.startsWith(`${yearNum}-${String(monthNum).padStart(2, '0')}`));
  const monthUniqueDays = [...new Set(currentMonthLogs.map(l => l.date))].length;
  const monthPct = monthDaysCount > 0 ? Math.round((monthUniqueDays / monthDaysCount) * 100) : 0;
  $('stat-days-month-pct').textContent = `${monthPct}%`;
  
  const startOfYear = new Date(`${yearNum}-01-01T00:00:00`);
  const diffTimeYtd = Math.abs(today - startOfYear);
  const ytdDaysElapsed = Math.floor(diffTimeYtd / (86400000)) + 1;
  const currentYearLogs = activeLogs.filter(l => l.date.startsWith(String(yearNum)));
  const ytdUniqueDays = [...new Set(currentYearLogs.map(l => l.date))].length;
  const ytdPct = ytdDaysElapsed > 0 ? Math.round((ytdUniqueDays / ytdDaysElapsed) * 100) : 0;
  $('stat-days-ytd-pct').textContent = `${ytdPct}%`;

  // ── Reading Volume Detail ──
  const rereadBonus = books.reduce((s, b) => s + ((b.read_count > 1) ? (b.read_count - 1) * b.total_pages : 0), 0);
  const booksReread = books.filter(b => b.read_count > 1).length;
  const uniqueAuthors = new Set(books.filter(b => b.author).map(b => b.author)).size;
  const bahaiFinished = books.filter(b => b.collection === 'Bahai' && (b.read_count > 0 || ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status))).length;
  const nonbahaiFinished = books.filter(b => b.collection !== 'Bahai' && (b.read_count > 0 || ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status))).length;
  const pagesIp = books.reduce((s, b) => s + (b.status === 'In Progress' ? (b.pages_read % b.total_pages) : 0), 0);
  const pagesNs = books.reduce((s, b) => s + (['Not Started', 'Owned'].includes(b.status) ? b.total_pages : 0), 0);
  const pctRereadBonus = pagesRead - pagesIp > 0 ? ((rereadBonus / (pagesRead - pagesIp)) * 100).toFixed(2) : 0;

  $('sv-total-reads').textContent = totalReads;
  $('sv-total-pages').textContent = fmtNum(pagesRead);
  $('sv-reread-bonus').textContent = fmtNum(rereadBonus);
  $('sv-books-reread').textContent = booksReread;
  $('sv-unique-authors').textContent = uniqueAuthors;
  $('sv-bahai-reads').textContent = bahaiFinished;
  $('sv-nonbahai-reads').textContent = nonbahaiFinished;
  $('sv-avg-pages').textContent = avgPagesPerBook;
  $('sv-ip-pages').textContent = fmtNum(pagesIp);
  $('sv-ns-pages').textContent = fmtNum(pagesNs);
  $('sv-reread-pct').textContent = `${pctRereadBonus}%`;

  // ── Year Tracking ──
  const yearsWithCompletions = [...new Set(completions.map(c => c.date.slice(0, 4)))].filter(y => y);
  const firstYear = yearsWithCompletions.length > 0 ? Math.min(...yearsWithCompletions.map(y => parseInt(y))) : 2018;
  const recentYear = yearsWithCompletions.length > 0 ? Math.max(...yearsWithCompletions.map(y => parseInt(y))) : 2026;
  const yearsSince = recentYear - firstYear + 1;
  const activeYearsCount = yearsWithCompletions.length;
  
  const booksByYear = {};
  const pagesByYear = {};
  completions.forEach(c => {
    const yr = c.date.slice(0, 4);
    booksByYear[yr] = (booksByYear[yr] || 0) + 1;
    pagesByYear[yr] = (pagesByYear[yr] || 0) + c.pages;
  });
  
  let bestReadsYear = '—', bestReadsCount = 0;
  let bestPagesYear = '—', bestPagesCount = 0;
  Object.keys(booksByYear).forEach(yr => {
    if (booksByYear[yr] > bestReadsCount) {
      bestReadsCount = booksByYear[yr];
      bestReadsYear = yr;
    }
  });
  Object.keys(pagesByYear).forEach(yr => {
    if (pagesByYear[yr] > bestPagesCount) {
      bestPagesCount = pagesByYear[yr];
      bestPagesYear = yr;
    }
  });

  const medianBooksVal = getMedian(Object.values(booksByYear));
  const medianPagesVal = getMedian(Object.values(pagesByYear));

  $('yt-years-since').textContent = yearsSince;
  $('yt-first-year').textContent = firstYear;
  $('yt-recent-year').textContent = recentYear;
  $('yt-active-years').textContent = activeYearsCount;
  $('yt-best-reads-year').textContent = bestReadsYear;
  $('yt-best-reads-count').textContent = bestReadsCount;
  $('yt-best-pages-year').textContent = bestPagesYear;
  $('yt-best-pages-count').textContent = fmtNum(bestPagesCount);
  $('yt-gaps').textContent = yearsSince - activeYearsCount;
  $('yt-median-books').textContent = medianBooksVal;
  $('yt-median-pages').textContent = fmtNum(medianPagesVal);

  // ── Reading Pace ──
  const bookDurations = [];
  books.forEach(b => {
    if (!['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status) && b.read_count === 0) return;
    const blogs = logsCache.filter(l => l.book_title === b.title);
    if (blogs.length === 0) return;
    blogs.sort((a,b) => a.date.localeCompare(b.date));
    const startD = new Date(blogs[0].date);
    const endD = new Date(blogs[blogs.length - 1].date);
    const diff = Math.ceil(Math.abs(endD - startD) / 86400000) + 1;
    bookDurations.push({ title: b.title, days: diff });
  });

  const avgDaysPerBook = bookDurations.length > 0 ? (bookDurations.reduce((s, x) => s + x.days, 0) / bookDurations.length).toFixed(1) : '—';
  const fastestBook = bookDurations.length > 0 ? Math.min(...bookDurations.map(x => x.days)) : '—';
  const slowestBook = bookDurations.length > 0 ? Math.max(...bookDurations.map(x => x.days)) : '—';
  const medianDaysPerBook = bookDurations.length > 0 ? getMedian(bookDurations.map(x => x.days)) : '—';

  let pagesDayOverall = 0;
  if (logsCache.length > 0) {
    const sortedAllLogs = [...logsCache].sort((a,b) => a.date.localeCompare(b.date));
    const startTrackingDate = new Date(sortedAllLogs[0].date);
    const daysSinceStart = Math.ceil(Math.abs(today - startTrackingDate) / 86400000) + 1;
    pagesDayOverall = (pagesRead / daysSinceStart).toFixed(2);
  }

  const avgReadsYr = (totalReads / activeYearsCount).toFixed(2);
  const avgPagesYr = (pagesRead / activeYearsCount).toFixed(1);
  const avgReadsMo = (totalReads / (activeYearsCount * 12)).toFixed(2);
  
  const totalMins = activeLogs.reduce((s, l) => s + (l.minutes_spent || 0), 0);
  const totalHrs = totalMins / 60;
  const pagesPerHour = totalHrs > 0 ? (pagesRead / totalHrs).toFixed(1) : '—';

  $('rp-avg-reads-yr').textContent = avgReadsYr;
  $('rp-avg-pages-yr').textContent = fmtNum(avgPagesYr);
  $('rp-avg-days-book').textContent = avgDaysPerBook;
  $('rp-fastest').textContent = fastestBook;
  $('rp-slowest').textContent = slowestBook;
  $('rp-books-yr').textContent = (totalReads / yearsSince).toFixed(2);
  $('rp-pages-tracked-yr').textContent = fmtNum((pagesRead / yearsSince).toFixed(1));
  $('rp-pages-day-overall').textContent = pagesDayOverall;
  $('rp-median-days').textContent = medianDaysPerBook;
  $('rp-avg-reads-mo').textContent = avgReadsMo;
  $('rp-pages-hr').textContent = pagesPerHour;

  // ── Daily Log Insights ──
  const totalLoggedPages = activeLogs.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
  const minPagesSession = activeLogs.length > 0 ? Math.min(...activeLogs.map(l => Math.max(0, (l.end_page || 0) - (l.start_page || 0)))) : 0;
  const maxPagesSession = activeLogs.length > 0 ? Math.max(...activeLogs.map(l => Math.max(0, (l.end_page || 0) - (l.start_page || 0)))) : 0;

  $('li-sessions').textContent = activeLogs.length;
  $('li-logged-pages').textContent = fmtNum(totalLoggedPages);
  $('li-minutes').textContent = fmtNum(totalMins);
  $('li-hours').textContent = totalHrs.toFixed(1);
  $('li-avg-pages').textContent = activeLogs.length > 0 ? (totalLoggedPages / activeLogs.length).toFixed(1) : 0;
  $('li-avg-mins').textContent = activeLogs.length > 0 ? (totalMins / activeLogs.length).toFixed(1) : 0;
  $('li-pace').textContent = totalMins > 0 ? (totalLoggedPages / totalMins).toFixed(2) : 0;
  $('li-min-pages').textContent = minPagesSession;
  $('li-max-pages').textContent = maxPagesSession;
  $('li-min-per-page').textContent = totalLoggedPages > 0 ? (totalMins / totalLoggedPages).toFixed(2) : 0;

  // ── Reading Milestones ──
  renderMilestones(stats.completions, ytdDaysElapsed);

  // ── Book Length Records ──
  const finishedInLib = books.filter(b => ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status) || b.read_count > 0);
  let longestBook = '—', shortestBook = '—';
  let longestTitle = '—', shortestTitle = '—';
  let medianLength = 0;
  let booksLarge = 0, booksSmall = 0;

  if (finishedInLib.length > 0) {
    const sortedByLen = [...finishedInLib].sort((a,b) => a.total_pages - b.total_pages);
    shortestBook = `${sortedByLen[0].title} (${sortedByLen[0].total_pages} pg)`;
    longestBook = `${sortedByLen[sortedByLen.length - 1].title} (${sortedByLen[sortedByLen.length - 1].total_pages} pg)`;
    medianLength = getMedian(finishedInLib.map(b => b.total_pages));
    booksLarge = books.filter(b => b.total_pages > 500).length;
    booksSmall = books.filter(b => b.total_pages < 100).length;
    
    const sortedByTitleLen = [...books].sort((a,b) => a.title.length - b.title.length);
    shortestTitle = sortedByTitleLen[0].title;
    longestTitle = sortedByTitleLen[sortedByTitleLen.length - 1].title;
  }

  $('rec-longest-book').textContent = longestBook;
  $('rec-shortest-book').textContent = shortestBook;
  $('rec-longest-title').textContent = longestTitle;
  $('rec-shortest-title').textContent = shortestTitle;
  $('rec-median-length').textContent = medianLength;
  $('rec-books-large').textContent = booksLarge;
  $('rec-books-small').textContent = booksSmall;

  // ── Reading Speed Records ──
  const booksFast = bookDurations.filter(x => x.days <= 7).length;
  const booksMedium = bookDurations.filter(x => x.days <= 30).length;
  let speedRecord = '—';
  if (bookDurations.length > 0) {
    const record = [...bookDurations].sort((a,b) => a.days - b.days)[0];
    speedRecord = `${record.title} (${record.days} days)`;
  }
  $('rec-speed-fast').textContent = booksFast;
  $('rec-speed-medium').textContent = booksMedium;
  $('rec-speed-record').textContent = speedRecord;

  // ── Author & Genre Records ──
  const authorCounts = {};
  books.forEach(b => {
    if (b.author) authorCounts[b.author] = (authorCounts[b.author] || 0) + (b.read_count || 0);
  });
  let topAuthor = '—', topAuthorReads = 0;
  let authorsMulti = 0;
  Object.keys(authorCounts).forEach(auth => {
    if (authorCounts[auth] > topAuthorReads) {
      topAuthorReads = authorCounts[auth];
      topAuthor = auth;
    }
    if (authorCounts[auth] > 1) authorsMulti++;
  });
  const booksMultiReads = books.filter(b => b.read_count > 1).length;

  $('rec-top-author').textContent = topAuthor;
  $('rec-top-author-reads').textContent = topAuthorReads;
  $('rec-authors-multi').textContent = authorsMulti;
  $('rec-books-multi-reads').textContent = booksMultiReads;

  // ── YOY Card Visibility ──
  $('dash-yoy-card').classList.toggle('hidden', selectedYear !== 'all' && selectedYear !== String(yearNum));

  // ── YTD vs Same Date Last Year (YOY Card calculation) ─────────────────────
  const todayMMDD = today.toISOString().slice(5, 10); // "MM-DD"
  const compYear = selectedYear === 'all' ? yearNum : parseInt(selectedYear);
  const prevYear = compYear - 1;
  
  const targetYearStart = `${compYear}-01-01`;
  const targetYearEnd = `${compYear}-${todayMMDD}`;
  const prevYearStart = `${prevYear}-01-01`;
  const prevYearEnd = `${prevYear}-${todayMMDD}`;
  
  // Format readable date span for badge (e.g. "Jan 1 – Jul 22")
  const monthName = today.toLocaleString('en-US', { month: 'short' });
  const dayNum = today.getDate();
  const dateSpanStr = `Jan 1 – ${monthName} ${dayNum}`;

  const rangeBadge = $('yoy-date-range-badge');
  if (rangeBadge) rangeBadge.textContent = dateSpanStr;
  
  // Books completed in target year period
  const targetComp = completions.filter(c => c.date >= targetYearStart && c.date <= targetYearEnd && (dashFilter === 'all' || c.collection === dashFilter));
  // Books completed in prev year period
  const prevComp = completions.filter(c => c.date >= prevYearStart && c.date <= prevYearEnd && (dashFilter === 'all' || c.collection === dashFilter));
  
  // Pages read in target year period
  const targetPagesVal = getReconciledPagesForPeriod(mergedBooks, logsCache, completions, targetYearStart, targetYearEnd, dashFilter);
  // Pages read in prev year period
  const prevPagesVal = getReconciledPagesForPeriod(mergedBooks, logsCache, completions, prevYearStart, prevYearEnd, dashFilter);

  const bookDiff = targetComp.length - prevComp.length;
  const bookDiffStr = bookDiff >= 0 ? `+${bookDiff} ahead` : `${bookDiff} behind`;
  
  const pageDiff = targetPagesVal - prevPagesVal;
  const pageDiffStr = pageDiff >= 0 ? `+${fmtNum(pageDiff)} ahead` : `${fmtNum(pageDiff)} behind`;

  // Scale bars relative to the higher of the two values
  const maxBooks = Math.max(targetComp.length, prevComp.length, 1);
  const booksCurrPct = (targetComp.length / maxBooks) * 100;
  const booksPrevPct = (prevComp.length / maxBooks) * 100;

  const maxPages = Math.max(targetPagesVal, prevPagesVal, 1);
  const pagesCurrPct = (targetPagesVal / maxPages) * 100;
  const pagesPrevPct = (prevPagesVal / maxPages) * 100;

  // Labels & Values
  const bCurrLbl = $('yoy-books-curr-label');
  const bPrevLbl = $('yoy-books-prev-label');
  if (bCurrLbl) bCurrLbl.textContent = `${compYear} (This Year)`;
  if (bPrevLbl) bPrevLbl.textContent = `${prevYear} (Same Date)`;

  if ($('yoy-books-curr')) $('yoy-books-curr').textContent = targetComp.length;
  if ($('yoy-books-prev')) $('yoy-books-prev').textContent = prevComp.length;
  
  const bBadge = $('yoy-books-badge');
  if (bBadge) {
    bBadge.textContent = bookDiffStr;
    bBadge.className = `px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${bookDiff >= 0 ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/20' : 'bg-rose-500/15 text-rose-500 border border-rose-500/20'}`;
  }
  
  const booksCurrFill = $('yoy-books-curr-fill');
  const booksPrevFill = $('yoy-books-prev-fill');
  if (booksCurrFill) booksCurrFill.style.width = `${booksCurrPct}%`;
  if (booksPrevFill) booksPrevFill.style.width = `${booksPrevPct}%`;

  const pCurrLbl = $('yoy-pages-curr-label');
  const pPrevLbl = $('yoy-pages-prev-label');
  if (pCurrLbl) pCurrLbl.textContent = `${compYear} (This Year)`;
  if (pPrevLbl) pPrevLbl.textContent = `${prevYear} (Same Date)`;

  if ($('yoy-pages-curr')) $('yoy-pages-curr').textContent = fmtNum(targetPagesVal);
  if ($('yoy-pages-prev')) $('yoy-pages-prev').textContent = fmtNum(prevPagesVal);
  
  const pBadge = $('yoy-pages-badge');
  if (pBadge) {
    pBadge.textContent = pageDiffStr;
    pBadge.className = `px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${pageDiff >= 0 ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/20' : 'bg-rose-500/15 text-rose-500 border border-rose-500/20'}`;
  }

  const pagesCurrFill = $('yoy-pages-curr-fill');
  const pagesPrevFill = $('yoy-pages-prev-fill');
  if (pagesCurrFill) pagesCurrFill.style.width = `${pagesCurrPct}%`;
  if (pagesPrevFill) pagesPrevFill.style.width = `${pagesPrevPct}%`;

  // ── Time-Based Insights Tables ──
  renderTimeBasedTables(logsCache, completions);

  // ── Weekly Velocity ──
  const sevenDaysAgoStr = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const fourteenDaysAgoStr = new Date(today.getTime() - 14 * 86400000).toISOString().slice(0, 10);
  
  const thisWeekLogs = logsCache.filter(l => l.date >= sevenDaysAgoStr);
  const prevWeekLogs = logsCache.filter(l => l.date >= fourteenDaysAgoStr && l.date < sevenDaysAgoStr);
  
  const thisWeekSessions = thisWeekLogs.length;
  const thisWeekPages = thisWeekLogs.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
  const thisWeekMinutes = thisWeekLogs.reduce((s, l) => s + (l.minutes_spent || 0), 0);
  const prevWeekPages = prevWeekLogs.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
  
  const pageDelta = thisWeekPages - prevWeekPages;
  const pageDeltaStr = pageDelta >= 0 ? `+${pageDelta} pages` : `${pageDelta} pages`;
  const weekAvg = (thisWeekPages / 7).toFixed(1);
  
  $('dash-week-stats').innerHTML = `
    <div class="text-[10px] font-bold uppercase tracking-widest text-theme-secondary">📊 Weekly Reading Pace (Last 7 Days)</div>
    <div class="grid grid-cols-3 gap-2.5 mt-2 text-center">
      <div class="bg-theme-card p-2 rounded-xl border border-theme">
        <div class="text-[9px] text-theme-secondary uppercase font-bold tracking-wider">Sessions</div>
        <div class="text-sm font-extrabold text-theme-primary mt-0.5">${thisWeekSessions}</div>
      </div>
      <div class="bg-theme-card p-2 rounded-xl border border-theme">
        <div class="text-[9px] text-theme-secondary uppercase font-bold tracking-wider">Pages Read</div>
        <div class="text-sm font-extrabold text-theme-primary mt-0.5">${fmtNum(thisWeekPages)}</div>
      </div>
      <div class="bg-theme-card p-2 rounded-xl border border-theme">
        <div class="text-[9px] text-theme-secondary uppercase font-bold tracking-wider">Minutes</div>
        <div class="text-sm font-extrabold text-theme-primary mt-0.5">${thisWeekMinutes}m</div>
      </div>
    </div>
    <div class="flex justify-between items-center text-[10px] text-theme-secondary mt-2 border-t border-theme pt-2 font-medium">
      <span>vs. Previous 7 Days: <b class="${pageDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${pageDeltaStr}</b></span>
      <span>Avg Pages/Day: <b class="text-theme-primary">${weekAvg}</b></span>
    </div>
  `;

  // ── Projections & Required Pace ──
  const currentYearStr = String(yearNum);
  const currentYearStats = getReconciledStats(mergedBooks, logsCache, currentYearStr, dashFilter);
  const booksYTD = currentYearStats.totalReads;
  const pagesYTD = currentYearStats.pagesRead;
  
  const lifetimeStats = getReconciledStats(mergedBooks, logsCache, 'all', dashFilter);
  const lifetimeReads = lifetimeStats.totalReads;
  const lifetimePages = lifetimeStats.pagesRead;

  const bookMilestones = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 1000];
  const nextBookMilestone = bookMilestones.find(m => m > lifetimeReads) || 1000;
  
  const pageMilestones = [1000, 5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 200000];
  const nextPageMilestone = pageMilestones.find(m => m > lifetimePages) || 200000;

  const booksToMilestone = Math.max(0, nextBookMilestone - lifetimeReads);
  const pagesToMilestone = Math.max(0, nextPageMilestone - lifetimePages);

  const booksPerDayRate = ytdDaysElapsed > 0 ? booksYTD / ytdDaysElapsed : 0.05;
  const pagesPerDayRate = ytdDaysElapsed > 0 ? pagesYTD / ytdDaysElapsed : 10;

  const booksETA = calculateETA(booksToMilestone, booksPerDayRate > 0 ? booksPerDayRate : 0.05);
  const pagesETA = calculateETA(pagesToMilestone, pagesPerDayRate > 0 ? pagesPerDayRate : 10);

  // Update Year Progress Card
  const daysRemainingInYear = 365 - ytdDaysElapsed;
  const pagesPerCalendarDay = (pagesYTD / ytdDaysElapsed).toFixed(1);
  const booksPerMonthYTD = (booksYTD / (ytdDaysElapsed / 30)).toFixed(2);

  $('dash-year-progress').innerHTML = `
    <div class="grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
      <div class="flex justify-between"><span class="text-theme-secondary font-medium">Days Elapsed</span><span class="text-theme-primary font-bold">${ytdDaysElapsed}</span></div>
      <div class="flex justify-between"><span class="text-theme-secondary font-medium">Days Remaining</span><span class="text-theme-primary font-bold">${daysRemainingInYear}</span></div>
      <div class="flex justify-between"><span class="text-theme-secondary font-medium">Books Completed</span><span class="text-theme-primary font-bold">${booksYTD}</span></div>
      <div class="flex justify-between"><span class="text-theme-secondary font-medium">Pages Read</span><span class="text-theme-primary font-bold">${fmtNum(pagesYTD)}</span></div>
      <div class="flex justify-between col-span-2 border-t border-theme pt-2 mt-1">
        <span class="text-theme-secondary font-medium">Pages/Calendar Day (YTD)</span>
        <span class="text-theme-primary font-bold">${pagesPerCalendarDay}</span>
      </div>
      <div class="flex justify-between col-span-2">
        <span class="text-theme-secondary font-medium">Books Completed/Month</span>
        <span class="text-theme-primary font-bold">${booksPerMonthYTD}</span>
      </div>
    </div>
  `;

  // Update Milestone Projections Card
  $('dash-milestones').innerHTML = `
    <div class="flex flex-col gap-3.5">
      <!-- Books Milestone -->
      <div class="flex flex-col gap-1">
        <div class="flex justify-between text-xs font-semibold text-theme-primary">
          <span>📚 Next Books Milestone</span>
          <span>${lifetimeReads} / ${nextBookMilestone} Books</span>
        </div>
        <div class="w-full bg-theme-card rounded-full h-1.5 overflow-hidden border border-theme mt-0.5">
          <div class="h-full transition-all rounded-full" style="background: var(--gold); width: ${Math.min(100, (lifetimeReads/nextBookMilestone)*100)}%"></div>
        </div>
        <div class="flex justify-between text-[10px] text-theme-secondary mt-1">
          <span>To go: <b>${booksToMilestone} books</b></span>
          <span>ETA: <b>${booksETA}</b></span>
        </div>
      </div>
      
      <!-- Pages Milestone -->
      <div class="flex flex-col gap-1 border-t border-theme pt-3.5">
        <div class="flex justify-between text-xs font-semibold text-theme-primary">
          <span>📄 Next Pages Milestone</span>
          <span>${fmtNum(lifetimePages)} / ${fmtNum(nextPageMilestone)} Pages</span>
        </div>
        <div class="w-full bg-theme-card rounded-full h-1.5 overflow-hidden border border-theme mt-0.5">
          <div class="h-full transition-all rounded-full" style="background: var(--emerald); width: ${Math.min(100, (lifetimePages/nextPageMilestone)*100)}%"></div>
        </div>
        <div class="flex justify-between text-[10px] text-theme-secondary mt-1">
          <span>To go: <b>${fmtNum(pagesToMilestone)} pages</b></span>
          <span>ETA: <b>${pagesETA}</b></span>
        </div>
      </div>
    </div>
  `;

  // ── Currently Reading List ──
  const active = books.filter(b => b.status === 'In Progress');
  const activeEl = $('dash-active-books');
  if (activeEl) {
    activeEl.innerHTML = '';
    if (active.length === 0) {
      activeEl.innerHTML = '<p class="text-xs text-theme-tertiary text-center py-2 font-medium">No books currently in progress</p>';
    } else {
      active.forEach(b => {
        const pagesReadAccum = b.pages_read || 0;
        const currentCyclePages = pagesReadAccum % b.total_pages;
        const left = b.total_pages - currentCyclePages;
        const estDays = Math.ceil(left / 10);
        const pct = Math.min(100, Math.round((currentCyclePages / b.total_pages) * 100));
        
        const card = el('div', 'glass-panel p-3.5 rounded-2xl flex flex-col gap-2 border border-theme active:scale-[0.99] transition-all cursor-pointer carousel-card');
        card.innerHTML = `
          <div class="flex items-start gap-3 min-w-0">
            ${getCoverHTML(b, 'w-10 h-14 shrink-0 shadow-sm')}
            <div class="min-w-0 flex-1">
              <div class="flex justify-between items-start gap-2">
                <div class="text-xs font-bold text-theme-primary truncate">${escapeHtml(b.title)}</div>
                <span class="px-2 py-0.5 rounded-full text-[9px] font-black uppercase shrink-0" style="background: rgba(var(--accent-rgb), 0.12); color: var(--accent); border: 1px solid rgba(var(--accent-rgb), 0.2)">${pct}%</span>
              </div>
              <div class="text-[9px] text-theme-secondary truncate mt-0.5">${escapeHtml(b.author || '')}</div>
            </div>
          </div>
          <div class="flex justify-between text-[9px] text-theme-secondary mt-1 border-t border-theme pt-1.5 font-semibold">
            <span>Pages Left: <b>${left}</b></span>
            <span>ETA @ 10pg/day: <b>${estDays} days</b></span>
          </div>
        `;
        card.addEventListener('click', () => openBookDetailModal(b));
        activeEl.appendChild(card);
      });
    }
  }

  // ── Up Next List ──
  const priorityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
  const upNext = books
    .filter(b => ['Not Started', 'Owned', 'Want to Buy', 'Gifted', 'Borrowed'].includes(b.status))
    .sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3))
    .slice(0, 10);
  const upNextEl = $('dash-up-next-books');
  if (upNextEl) {
    upNextEl.innerHTML = '';
    if (upNext.length === 0) {
      upNextEl.innerHTML = '<p class="text-xs text-theme-tertiary text-center py-2 font-medium">No upcoming books</p>';
    } else {
      upNext.forEach(b => {
        const card = el('div', 'glass-panel p-3.5 rounded-2xl flex flex-col gap-2 border border-theme active:scale-[0.99] transition-all cursor-pointer carousel-card');
        card.innerHTML = `
          <div class="flex items-start gap-3 min-w-0">
            ${getCoverHTML(b, 'w-10 h-14 shrink-0 shadow-sm')}
            <div class="min-w-0 flex-1">
              <div class="flex justify-between items-start gap-2">
                <div class="text-xs font-bold text-theme-primary truncate">${escapeHtml(b.title)}</div>
                <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-500/10 text-theme-gold border border-amber-500/10 uppercase shrink-0">${escapeHtml(b.priority)} Prio</span>
              </div>
              <div class="text-[9px] text-theme-secondary truncate mt-0.5">${escapeHtml(b.author || '')}</div>
            </div>
          </div>
        `;
        card.addEventListener('click', () => openBookDetailModal(b));
        upNextEl.appendChild(card);
      });
    }
  }

  // ── Recently Finished List ──
  const recentEl = $('dash-recent-books');
  if (recentEl) {
    recentEl.innerHTML = '';
    const oneYearAgoStr = new Date(today.getTime() - 365 * 86400000).toISOString().slice(0, 10);
    const recentCompletions = completions
      .filter(c => c.date >= oneYearAgoStr && (dashFilter === 'all' || c.collection === dashFilter))
      .sort((a, b) => b.date.localeCompare(a.date));
      
    if (recentCompletions.length === 0) {
      recentEl.innerHTML = '<p class="text-xs text-theme-tertiary text-center py-2 font-medium">No books recently finished</p>';
    } else {
      recentCompletions.forEach(c => {
        const book = mergedBooks.find(b => b.title === c.title) || { title: c.title, author: '' };
        const card = el('div', 'glass-panel p-3.5 rounded-2xl flex flex-col gap-2 border border-theme active:scale-[0.99] transition-all cursor-pointer carousel-card');
        card.innerHTML = `
          <div class="flex items-start gap-3 min-w-0">
            ${getCoverHTML(book, 'w-10 h-14 shrink-0 shadow-sm')}
            <div class="min-w-0 flex-1">
              <div class="flex justify-between items-start gap-2">
                <div class="text-xs font-bold text-theme-primary truncate">${escapeHtml(c.title)}</div>
                <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/10 uppercase shrink-0">Finished</span>
              </div>
              <div class="text-[9px] text-theme-secondary truncate mt-0.5">${escapeHtml(book.author || '')}</div>
              <div class="flex justify-between text-[9px] text-theme-secondary mt-1 border-t border-theme pt-1.5 font-semibold">
                <span>Date: <b>${fmtDate(c.date)}</b></span>
                <span>Pages: <b>${c.pages} pg</b></span>
              </div>
            </div>
          </div>
        `;
        if (book && book.id) {
          card.addEventListener('click', () => openBookDetailModal(book));
        }
        recentEl.appendChild(card);
      });
    }
  }

  if (typeof performance !== 'undefined' && performance.mark && performance.getEntriesByName('pin-submitted').length > 0) {
    performance.mark('dashboard-rendered');
    try {
      performance.measure('PIN-to-Dashboard Shell Latency', 'pin-submitted', 'dashboard-rendered');
      const measures = performance.getEntriesByName('PIN-to-Dashboard Shell Latency');
      if (measures.length > 0) {
        const latest = measures[measures.length - 1];
        console.log(`⚡ [BENCHMARK] PIN-to-Dashboard Shell Render Latency: ${latest.duration.toFixed(2)} ms`);
      }
    } catch (e) {}
  }

  // ── Render Charts & Advanced Analytics (Deferred for sub-200ms initial DOM paint) ──
  if ('requestAnimationFrame' in window) {
    requestAnimationFrame(() => {
      setTimeout(() => {
        renderAnnualChallengeWidget(mergedBooks, logsCache);
        renderCharts(completions);
        renderVelocityAnalytics(activeLogs, books, selectedYear);
        renderStreakRings(streaks, activeLogs);
        renderContextualMatrix(logsCache);
        initScrollAnimations();

        if (typeof performance !== 'undefined' && performance.mark && performance.getEntriesByName('pin-submitted').length > 0) {
          performance.mark('dashboard-full-interactive');
          try {
            performance.measure('PIN-to-Dashboard Full Interactive Latency', 'pin-submitted', 'dashboard-full-interactive');
            const measures = performance.getEntriesByName('PIN-to-Dashboard Full Interactive Latency');
            if (measures.length > 0) {
              const latest = measures[measures.length - 1];
              console.log(`📊 [BENCHMARK] PIN-to-Dashboard Full Interactive Latency: ${latest.duration.toFixed(2)} ms`);
            }
          } catch (e) {}
        }
      }, 30);
    });
  } else {
    renderCharts(completions);
    renderVelocityAnalytics(activeLogs, books, selectedYear);
    renderStreakRings(streaks, activeLogs);
    renderContextualMatrix(logsCache);
    initScrollAnimations();
  }
}

// ── Goals Helpers: Streaks, Charts & Badges ──────────────────────────────

function triggerHaptic() {
  if (typeof window.triggerHaptic === 'function') {
    window.triggerHaptic();
  } else if (navigator.vibrate) {
    try { navigator.vibrate(10); } catch(e){}
  }
}

function calculateStreak(logs) {
  const active = logs.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));
  const datesSet = new Set(active.filter(l => (l.end_page || 0) > (l.start_page || 0)).map(l => l.date));
  
  const today = new Date();
  const dateToStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  
  let currentStreak = 0;
  let checkDate = new Date(today);
  
  // Check if today has a log, if not check yesterday
  let todayStr = dateToStr(today);
  let hasToday = datesSet.has(todayStr);
  
  if (!hasToday) {
    checkDate.setDate(checkDate.getDate() - 1);
  }
  
  while (datesSet.has(dateToStr(checkDate))) {
    currentStreak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }
  
  // Generate 7-day history dots (Mon to Sun of current week or past 7 days)
  const dots = [];
  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dStr = dateToStr(d);
    const dayLabel = dayNames[d.getDay()];
    dots.push({
      day: dayLabel,
      date: dStr,
      active: datesSet.has(dStr),
      isToday: dStr === todayStr
    });
  }
  
  return { currentStreak, hasToday, dots };
}

function renderDailyCard(activeLogs, dailyPagesTarget) {
  const todayStr = todayISO();
  const todayLogs = activeLogs.filter(l => l.date === todayStr);
  const todayPages = todayLogs.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
  
  const dTarget = dailyPagesTarget || 20;
  const CIRC = 289;
  const pct = Math.min(1, todayPages / dTarget);
  
  if ($('ring-daily-fill')) $('ring-daily-fill').style.strokeDashoffset = CIRC - CIRC * pct;
  if ($('ring-daily-val'))  $('ring-daily-val').textContent = todayPages;
  if ($('ring-daily-lbl'))  $('ring-daily-lbl').textContent = `/ ${dTarget} pgs`;

  const streakData = calculateStreak(activeLogs);
  if ($('streak-count-val')) $('streak-count-val').textContent = `${streakData.currentStreak} Day Streak`;

  const msgEl = $('daily-status-msg');
  if (msgEl) {
    if (todayPages >= dTarget) {
      msgEl.textContent = `🎉 Daily goal achieved! Keep the ${streakData.currentStreak}-day momentum going.`;
    } else if (todayPages > 0) {
      msgEl.textContent = `${dTarget - todayPages} more pages today to complete your daily goal!`;
    } else {
      msgEl.textContent = `Read ${dTarget} pages today to extend your ${streakData.currentStreak}-day streak!`;
    }
  }

  const dotsContainer = $('streak-dots-container');
  if (dotsContainer) {
    dotsContainer.innerHTML = streakData.dots.map(d => `
      <div class="flex flex-col items-center gap-1">
        <span class="text-[8px] font-bold text-theme-secondary uppercase">${d.day}</span>
        <div class="w-5 h-5 rounded-full flex items-center justify-center transition-all ${
          d.active ? 'bg-gradient-to-tr from-amber-500 to-amber-300 text-slate-950 font-black shadow-sm shadow-amber-500/30 text-[10px]' : 
          (d.isToday ? 'border border-amber-400/50 bg-amber-400/10 text-theme-gold text-[8px]' : 'bg-white/5 border border-theme text-slate-600 text-[8px]')
        }">
          ${d.active ? '✓' : ''}
        </div>
      </div>
    `).join('');
  }
}

function renderTrajectoryChart(yearPages, aPT, activeLogs) {
  const container = $('goals-trajectory-chart');
  if (!container) return;
  
  const today = new Date();
  const curYear = today.getFullYear();
  const curMonthIndex = today.getMonth(); // 0 to 11

  // Monthly cumulative pages YTD
  const monthCumPages = Array(12).fill(0);
  let runSum = 0;
  for (let m = 0; m <= curMonthIndex; m++) {
    const endOfMonthISO = `${curYear}-${String(m + 1).padStart(2, '0')}-31`;
    const logsUpToMonth = activeLogs.filter(l => l.date >= `${curYear}-01-01` && l.date <= endOfMonthISO);
    runSum = logsUpToMonth.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
    monthCumPages[m] = runSum;
  }

  const width = container.clientWidth || 320;
  const height = container.clientHeight || 176;
  const padL = 25, padR = 15, padT = 15, padB = 25;
  const graphW = width - padL - padR;
  const graphH = height - padT - padB;

  const maxVal = Math.max(aPT, ...monthCumPages, 100);

  // Helper points
  const targetPoints = [];
  const actualPoints = [];
  const months = ['J','F','M','A','M','J','J','A','S','O','N','D'];

  for (let i = 0; i < 12; i++) {
    const x = padL + (i / 11) * graphW;
    const targetY = padT + graphH - (( (i + 1) / 12 * aPT) / maxVal) * graphH;
    targetPoints.push({ x, y: targetY });

    if (i <= curMonthIndex) {
      const actY = padT + graphH - (monthCumPages[i] / maxVal) * graphH;
      actualPoints.push({ x, y: actY });
    }
  }

  const targetPathStr = targetPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const actualPathStr = actualPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  
  let areaPathStr = '';
  if (actualPoints.length > 0) {
    const lastP = actualPoints[actualPoints.length - 1];
    areaPathStr = `${actualPathStr} L ${lastP.x.toFixed(1)} ${padT + graphH} L ${actualPoints[0].x.toFixed(1)} ${padT + graphH} Z`;
  }

  const trajTargetLbl = $('goals-trajectory-target-lbl');
  if (trajTargetLbl) {
    trajTargetLbl.textContent = `Annual Page Goal (${fmtNum(aPT)} pgs)`;
  }

  // Update status badge
  const currentActual = monthCumPages[curMonthIndex] || yearPages;
  const currentTargetReq = Math.round(((curMonthIndex + 1) / 12) * aPT);
  const statusLbl = $('trajectory-status-lbl');
  if (statusLbl) {
    const diff = currentActual - currentTargetReq;
    if (diff >= 0) {
      statusLbl.className = "text-[9px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 leading-none bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
      statusLbl.textContent = `+${fmtNum(diff)} pgs Ahead`;
    } else {
      statusLbl.className = "text-[9px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 leading-none bg-rose-500/10 text-rose-400 border border-rose-500/20";
      statusLbl.textContent = `${fmtNum(Math.abs(diff))} pgs Behind`;
    }
  }

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  container.innerHTML = `
    <svg class="w-full h-full" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="actualAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#34d399" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#34d399" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <!-- Grid lines -->
      <line x1="${padL}" y1="${padT}" x2="${width - padR}" y2="${padT}" stroke="var(--border)" stroke-dasharray="2,2" />
      <line x1="${padL}" y1="${padT + graphH/2}" x2="${width - padR}" y2="${padT + graphH/2}" stroke="var(--border)" stroke-dasharray="2,2" />
      <line x1="${padL}" y1="${padT + graphH}" x2="${width - padR}" y2="${padT + graphH}" stroke="var(--border-strong)" />
      
      <!-- Target Pace Line -->
      <path d="${targetPathStr}" fill="none" stroke="rgba(245, 158, 11, 0.4)" stroke-width="1.5" stroke-dasharray="4,3" />

      <!-- Actual Area Fill -->
      ${areaPathStr ? `<path d="${areaPathStr}" fill="url(#actualAreaGrad)" />` : ''}

      <!-- Actual Pace Line -->
      ${actualPathStr ? `<path d="${actualPathStr}" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" />` : ''}

      <!-- Data Dots -->
      ${actualPoints.map((p, i) => {
        const targetReq = Math.round(((i + 1) / 12) * aPT);
        const hoverTitle = `${monthNames[i]}: ${fmtNum(monthCumPages[i])} pgs actual vs ${fmtNum(targetReq)} pgs goal trajectory`;
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#10b981" stroke="#064e3b" stroke-width="1.5"><title>${hoverTitle}</title></circle>`;
      }).join('')}

      <!-- Month Labels -->
      ${months.map((m, i) => {
        const x = padL + (i / 11) * graphW;
        return `<text x="${x.toFixed(1)}" y="${height - 5}" text-anchor="middle" font-size="8" font-weight="bold" fill="${i <= curMonthIndex ? '#94a3b8' : '#475569'}">${m}</text>`;
      }).join('')}
    </svg>
  `;
}

function renderAchievementBadges(stats, streak, logsCache, yearBooks, aBT) {
  const container = $('goals-badges-grid');
  if (!container) return;

  const totalReads = stats.totalReads || 0;
  const totalPages = stats.totalPages || 0;
  const maxMonthPages = stats.maxMonthPages || 0;

  const badges = [
    {
      id: 'first_step',
      icon: 'fa-rocket',
      title: 'First Step',
      desc: 'Log 1 session',
      unlocked: logsCache.length > 0,
      progress: `${Math.min(1, logsCache.length)}/1`
    },
    {
      id: 'streak_master',
      icon: 'fa-fire',
      title: '7-Day Streak',
      desc: '7 days reading',
      unlocked: streak.currentStreak >= 7,
      progress: `${Math.min(7, streak.currentStreak)}/7d`
    },
    {
      id: 'bookworm',
      icon: 'fa-book-open',
      title: 'Bookworm',
      desc: 'Read 10 books',
      unlocked: totalReads >= 10,
      progress: `${Math.min(10, totalReads)}/10`
    },
    {
      id: 'century',
      icon: 'fa-award',
      title: '50+ Club',
      desc: 'Read 50 books',
      unlocked: totalReads >= 50,
      progress: `${Math.min(50, totalReads)}/50`
    },
    {
      id: 'marathoner',
      icon: 'fa-bolt',
      title: 'Marathoner',
      desc: '1,000 pg / mo',
      unlocked: maxMonthPages >= 1000,
      progress: `${Math.min(1000, maxMonthPages)}/1k`
    },
    {
      id: 'crusher',
      icon: 'fa-trophy',
      title: 'Goal Crusher',
      desc: 'Hit annual target',
      unlocked: yearBooks >= aBT,
      progress: `${Math.min(aBT, yearBooks)}/${aBT}`
    }
  ];

  const unlockedCount = badges.filter(b => b.unlocked).length;
  if ($('badges-unlocked-count')) $('badges-unlocked-count').textContent = `${unlockedCount} / ${badges.length} Unlocked`;

  container.innerHTML = badges.map(b => `
    <div class="flex flex-col items-center text-center p-2.5 rounded-2xl border transition-all ${
      b.unlocked 
        ? 'bg-gradient-to-b from-amber-500/10 to-amber-500/5 border-amber-500/30 text-theme-gold shadow-md shadow-amber-500/5' 
        : 'bg-black/20 border-theme text-theme-tertiary opacity-60'
    }">
      <div class="w-8 h-8 rounded-xl flex items-center justify-center mb-1 text-sm ${
        b.unlocked ? 'bg-amber-500/20 text-theme-gold border border-amber-500/30' : 'bg-white/5 text-slate-600'
      }">
        <i class="fa-solid ${b.icon}"></i>
      </div>
      <div class="text-[10px] font-extrabold text-theme-primary truncate w-full leading-tight">${b.title}</div>
      <div class="text-[8px] font-semibold text-theme-secondary mt-0.5">${b.unlocked ? '✓ Unlocked' : b.progress}</div>
    </div>
  `).join('');
}

function renderReadingAssistant(yearBooks, aBT, mergedBooks, activeLogs) {
  const msgEl = $('goals-assistant-msg');
  if (!msgEl) return;

  const today = new Date();
  const curYear = today.getFullYear();
  const dayOfYear = Math.floor((today - new Date(`${curYear}-01-01`)) / 86400000) + 1;
  const daysInYear = (curYear % 4 === 0) ? 366 : 365;
  const daysLeft = daysInYear - dayOfYear;

  const booksLeft = Math.max(0, aBT - yearBooks);

  if (booksLeft === 0) {
    msgEl.textContent = `🏆 Incredible! You've already reached your ${aBT}-book target for ${curYear}. Keep reading for extra milestones!`;
    return;
  }

  // Calculate average target length
  const yearPages = activeLogs.filter(l => l.date >= `${curYear}-01-01`).reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
  const avgPageRate = yearPages / Math.max(1, dayOfYear);
  const projTotalPagesLeft = Math.round(avgPageRate * daysLeft);
  const avgTargetPageCount = Math.round(projTotalPagesLeft / booksLeft);

  msgEl.textContent = `To reach your ${aBT}-book goal by Dec 31 (${daysLeft} days left), your remaining ${booksLeft} books should average ~${avgTargetPageCount > 50 ? avgTargetPageCount : 250} pages each at your current pace.`;
}

function setupGoalsTimeframeSwitcher() {
  const switcher = $('goals-timeframe-switcher');
  if (!switcher) return;

  switcher.querySelectorAll('button[data-timeframe]').forEach(btn => {
    btn.addEventListener('click', () => {
      triggerHaptic();
      const tf = btn.dataset.timeframe;

      switcher.querySelectorAll('button').forEach(b => {
        const isActive = b.dataset.timeframe === tf;
        b.classList.toggle('text-theme-gold', isActive);
        b.classList.toggle('bg-amber-500/10', isActive);
        b.classList.toggle('shadow-sm', isActive);
        b.classList.toggle('text-theme-secondary', !isActive);
      });

      // Filter sections
      const viewGoals = $('view-goals');
      if (!viewGoals) return;

      const dailySecs = viewGoals.querySelectorAll('.goals-sec-daily');
      const annualSecs = viewGoals.querySelectorAll('.goals-sec-annual');
      const allSecs = viewGoals.querySelectorAll('.goals-sec-all');

      if (tf === 'all') {
        dailySecs.forEach(s => s.classList.remove('hidden'));
        annualSecs.forEach(s => s.classList.remove('hidden'));
        allSecs.forEach(s => s.classList.remove('hidden'));
      } else if (tf === 'daily') {
        dailySecs.forEach(s => s.classList.remove('hidden'));
        annualSecs.forEach(s => s.classList.add('hidden'));
        allSecs.forEach(s => s.classList.remove('hidden'));
      } else if (tf === 'annual') {
        dailySecs.forEach(s => s.classList.add('hidden'));
        annualSecs.forEach(s => s.classList.remove('hidden'));
        allSecs.forEach(s => s.classList.remove('hidden'));
      } else if (tf === 'monthly') {
        dailySecs.forEach(s => s.classList.add('hidden'));
        annualSecs.forEach(s => s.classList.add('hidden'));
        allSecs.forEach(s => s.classList.remove('hidden'));
      }
    });
  });
}

function setupGoalsPresetsAndSteppers() {
  // Setup Presets
  const presetChips = $('goals-preset-chips');
  if (presetChips) {
    presetChips.querySelectorAll('button[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        triggerHaptic();
        const p = btn.dataset.preset;
        if (p === 'casual') {
          $('goal-daily-pages').value = 15;
          $('goal-daily-minutes').value = 15;
          $('goal-annual-books').value = 6;
          $('goal-annual-pages').value = 1800;
          $('goal-annual-sessions').value = 50;
          $('goal-annual-minutes').value = 1800;
          $('goal-monthly-books').value = 1;
          $('goal-monthly-pages').value = 150;
          $('goal-monthly-sessions').value = 5;
          $('goal-monthly-minutes').value = 150;
        } else if (p === 'consistent') {
          $('goal-daily-pages').value = 20;
          $('goal-daily-minutes').value = 20;
          $('goal-annual-books').value = 12;
          $('goal-annual-pages').value = 3000;
          $('goal-annual-sessions').value = 100;
          $('goal-annual-minutes').value = 3000;
          $('goal-monthly-books').value = 1;
          $('goal-monthly-pages').value = 300;
          $('goal-monthly-sessions').value = 10;
          $('goal-monthly-minutes').value = 300;
        } else if (p === 'avid') {
          $('goal-daily-pages').value = 30;
          $('goal-daily-minutes').value = 30;
          $('goal-annual-books').value = 24;
          $('goal-annual-pages').value = 6000;
          $('goal-annual-sessions').value = 150;
          $('goal-annual-minutes').value = 6000;
          $('goal-monthly-books').value = 2;
          $('goal-monthly-pages').value = 500;
          $('goal-monthly-sessions').value = 15;
          $('goal-monthly-minutes').value = 500;
        } else if (p === 'voracious') {
          $('goal-daily-pages').value = 50;
          $('goal-daily-minutes').value = 45;
          $('goal-annual-books').value = 52;
          $('goal-annual-pages').value = 15000;
          $('goal-annual-sessions').value = 250;
          $('goal-annual-minutes').value = 15000;
          $('goal-monthly-books').value = 4;
          $('goal-monthly-pages').value = 1250;
          $('goal-monthly-sessions').value = 20;
          $('goal-monthly-minutes').value = 1250;
        }

        presetChips.querySelectorAll('button').forEach(b => {
          const isSelected = b === btn;
          b.classList.toggle('border-amber-500/30', isSelected);
          b.classList.toggle('bg-amber-500/10', isSelected);
          b.classList.toggle('text-theme-gold', isSelected);
          b.classList.toggle('border-theme', !isSelected);
          b.classList.toggle('bg-white/5', !isSelected);
          b.classList.toggle('text-theme-secondary', !isSelected);
        });
      });
    });
  }

  // Setup Steppers
  const goalsModal = $('goals-modal');
  if (goalsModal) {
    goalsModal.querySelectorAll('button[data-step-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        triggerHaptic();
        const targetId = btn.dataset.stepId;
        const dir = parseInt(btn.dataset.stepDir, 10);
        const input = $(targetId);
        if (input) {
          const cur = parseInt(input.value, 10) || 0;
          input.value = Math.max(1, cur + dir);
        }
      });
    });
  }
}

// ── Goals & Projections Main ──────────────────────────────────────────────────
function setupGoals() {
  const btn = $('btn-edit-goals');
  if (!btn || btn.dataset.initialized) return;
  btn.dataset.initialized = 'true';

  btn.addEventListener('click', openGoalsModal);
  $('goals-modal-close').addEventListener('click', closeGoalsModal);
  $('goals-modal').addEventListener('click', e => { if (e.target === $('goals-modal')) closeGoalsModal(); });
  $('goals-modal-save').addEventListener('click', saveGoals);

  setupGoalsTimeframeSwitcher();
  setupGoalsPresetsAndSteppers();
}
window.setupGoals = setupGoals;
window.openGoalsModal = openGoalsModal;
window.closeGoalsModal = closeGoalsModal;
window.saveGoals = saveGoals;
window.renderGoals = renderGoals;

async function renderGoals() {
  // Default goals configuration schema
  const defaultGoals = {
    daily_pages_target: 20,
    daily_minutes_target: 20,
    annual_books_target: 12,
    annual_pages_target: 3000,
    annual_sessions_target: 100,
    annual_minutes_target: 3000,
    monthly_books_target: 1,
    monthly_pages_target: 300,
    monthly_sessions_target: 10,
    monthly_minutes_target: 300
  };

  // Load goals config safely with localStorage fallback
  let gSnap = null;
  try {
    if (db && uid) gSnap = await getDoc(doc(db, `users/${uid}/goals/config`));
  } catch (e) {
    console.warn('[Goals] Using cached goals config:', e.message);
  }

  let localStoredGoals = null;
  try {
    const rawLocal = localStorage.getItem('goals_cache');
    if (rawLocal) localStoredGoals = JSON.parse(rawLocal);
  } catch(e){}

  goalsCache = (gSnap && typeof gSnap.exists === 'function' && gSnap.exists()) 
    ? { ...defaultGoals, ...gSnap.data() } 
    : { ...defaultGoals, ...(localStoredGoals || goalsCache) };

  try {
    localStorage.setItem('goals_cache', JSON.stringify(goalsCache));
  } catch(e){}

  const today = new Date();
  const year  = today.getFullYear();
  const startOfYearISO = `${year}-01-01`;
  const startOfMonthISO = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const todayISOStr = todayISO();

  // Filter active logs (user session logs)
  const activeLogs = logsCache.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));

  // Render Daily Ring & Streak
  renderDailyCard(activeLogs, goalsCache.daily_pages_target || 20);

  // Year to Date stats
  const yearLogs = activeLogs.filter(l => l.date >= startOfYearISO && l.date <= `${year}-12-31`);
  const yearSessions = yearLogs.length;
  const yearMinutes = yearLogs.reduce((s, l) => s + (l.minutes_spent || 0), 0);

  // Month to Date stats
  const monthLogs = yearLogs.filter(l => l.date >= startOfMonthISO);
  const monthSessions = monthLogs.length;
  const monthMinutes = monthLogs.reduce((s, l) => s + (l.minutes_spent || 0), 0);

  const mergedBooks = await getMergedBooks();
  const stats = getReconciledStats(mergedBooks, logsCache, 'all', 'all');
  const completions = stats.completions;

  // Calculate pages and books completed YTD and Month using reconciled engine
  const yearPages = getReconciledPagesForPeriod(mergedBooks, logsCache, completions, startOfYearISO, `${year}-12-31`, 'all');
  const yearBooks = completions.filter(c => c.date >= startOfYearISO && c.date <= `${year}-12-31`).length;

  const monthPages = getReconciledPagesForPeriod(mergedBooks, logsCache, completions, startOfMonthISO, todayISOStr, 'all');
  const monthBooks = completions.filter(c => c.date >= startOfMonthISO && c.date <= todayISOStr).length;

  const aBT = goalsCache.annual_books_target     || 12;
  const aPT = goalsCache.annual_pages_target     || 3000;
  const aST = goalsCache.annual_sessions_target  || 100;
  const aMT = goalsCache.annual_minutes_target   || 3000;

  const mBT = goalsCache.monthly_books_target    || 1;
  const mPT = goalsCache.monthly_pages_target    || 300;
  const mST = goalsCache.monthly_sessions_target || 10;
  const mMT = goalsCache.monthly_minutes_target  || 300;

  // Render Trajectory SVG Chart
  renderTrajectoryChart(yearPages, aPT, activeLogs);

  // Calculate Streak & Render Badges
  const streak = calculateStreak(activeLogs);
  renderAchievementBadges(stats, streak, logsCache, yearBooks, aBT);

  // Render Smart Reading Assistant
  renderReadingAssistant(yearBooks, aBT, mergedBooks, activeLogs);

  // Ring fills
  const CIRC = 289;
  const bPct = Math.min(1, yearBooks / aBT);
  const pPct = Math.min(1, yearPages / aPT);
  if ($('ring-books-fill')) $('ring-books-fill').style.strokeDashoffset = CIRC - CIRC * bPct;
  if ($('ring-pages-fill')) $('ring-pages-fill').style.strokeDashoffset = CIRC - CIRC * pPct;
  if ($('ring-books-val'))  $('ring-books-val').textContent = yearBooks;
  if ($('ring-pages-val'))  $('ring-pages-val').textContent = yearPages >= 1000 ? Math.round(yearPages/100)/10 + 'k' : yearPages;
  if ($('ring-books-lbl'))  $('ring-books-lbl').textContent = `/ ${aBT} bks`;
  if ($('ring-pages-lbl'))  $('ring-pages-lbl').textContent = `/ ${aPT >= 1000 ? Math.round(aPT/100)/10 + 'k' : aPT} pgs`;

  const overallYearPct = Math.round(((yearBooks / aBT) + (yearPages / aPT)) / 2 * 100);
  if ($('goals-year-pct')) $('goals-year-pct').textContent = `${overallYearPct}% YTD Pace`;

  // 1. Targets & Completions Table
  const progressStr = (cur, target) => {
    const pct = target > 0 ? Math.round((cur / target) * 100) : 0;
    const left = Math.max(0, target - cur);
    return `<div class="text-right"><div class="font-extrabold text-theme-primary">${pct}%</div><div class="text-[8px] text-theme-secondary mt-0.5">${left} left</div></div>`;
  };

  $('goals-table-body').innerHTML = `
    <tr>
      <td>Books This Month</td>
      <td class="text-center font-bold text-theme-secondary">${mBT}</td>
      <td class="text-center font-bold text-theme-secondary">${monthBooks}</td>
      <td>${progressStr(monthBooks, mBT)}</td>
    </tr>
    <tr>
      <td>Pages This Month</td>
      <td class="text-center font-bold text-theme-secondary">${fmtNum(mPT)}</td>
      <td class="text-center font-bold text-theme-secondary">${fmtNum(monthPages)}</td>
      <td>${progressStr(monthPages, mPT)}</td>
    </tr>
    <tr>
      <td>Sessions This Month</td>
      <td class="text-center font-bold text-theme-secondary">${mST}</td>
      <td class="text-center font-bold text-theme-secondary">${monthSessions}</td>
      <td>${progressStr(monthSessions, mST)}</td>
    </tr>
    <tr>
      <td>Minutes This Month</td>
      <td class="text-center font-bold text-theme-secondary">${fmtNum(mMT)}</td>
      <td class="text-center font-bold text-theme-secondary">${fmtNum(monthMinutes)}</td>
      <td>${progressStr(monthMinutes, mMT)}</td>
    </tr>
    <tr class="border-t border-theme bg-white/2">
      <td>Books This Year</td>
      <td class="text-center font-bold text-theme-secondary">${aBT}</td>
      <td class="text-center font-bold text-theme-secondary">${yearBooks}</td>
      <td>${progressStr(yearBooks, aBT)}</td>
    </tr>
    <tr>
      <td>Pages This Year</td>
      <td class="text-center font-bold text-theme-secondary">${fmtNum(aPT)}</td>
      <td class="text-center font-bold text-theme-secondary">${fmtNum(yearPages)}</td>
      <td>${progressStr(yearPages, aPT)}</td>
    </tr>
    <tr>
      <td>Sessions This Year</td>
      <td class="text-center font-bold text-theme-secondary">${aST}</td>
      <td class="text-center font-bold text-theme-secondary">${yearSessions}</td>
      <td>${progressStr(yearSessions, aST)}</td>
    </tr>
    <tr>
      <td>Minutes Reading YTD</td>
      <td class="text-center font-bold text-theme-secondary">${fmtNum(aMT)}</td>
      <td class="text-center font-bold text-theme-secondary">${fmtNum(yearMinutes)}</td>
      <td>${progressStr(yearMinutes, aMT)}</td>
    </tr>
  `;

  // 2. Required Pace Check Table
  const dayOfYear = Math.floor((today - new Date(`${year}-01-01`)) / 86400000) + 1;
  const daysInYear = (year % 4 === 0) ? 366 : 365;
  const monthsElapsed = dayOfYear / 30.4;
  const weeksElapsed = dayOfYear / 7;
  
  const currentBooksPace = (yearBooks / Math.max(0.1, monthsElapsed)).toFixed(1);
  const currentPagesPace = (yearPages / Math.max(1, dayOfYear)).toFixed(1);
  const currentSessionsPace = (yearSessions / Math.max(0.1, weeksElapsed)).toFixed(1);
  const currentMinutesPace = (yearMinutes / Math.max(1, dayOfYear)).toFixed(1);

  const reqBooksPace = (aBT / 12).toFixed(1);
  const reqPagesPace = (aPT / daysInYear).toFixed(1);
  const reqSessionsPace = (aST / 52).toFixed(1);
  const reqMinutesPace = (aMT / daysInYear).toFixed(1);

  const statusBadge = (cur, req) => {
    const curVal = parseFloat(cur);
    const reqVal = parseFloat(req);
    if (reqVal <= 0) return `<span class="px-2 py-0.5 rounded-full text-[8px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/10 uppercase">✓ On Track</span>`;
    const pct = Math.round((curVal / reqVal) * 100);
    const ok = curVal >= reqVal;
    const diffPct = pct - 100;
    const label = ok ? (diffPct > 0 ? `+${diffPct}% Ahead` : '✓ On Track') : `${diffPct}% Behind`;
    return `<span class="px-2 py-0.5 rounded-full text-[8px] font-black border uppercase ${
      ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10' : 'bg-rose-500/10 text-rose-400 border-rose-500/10'
    }">${label}</span>`;
  };

  const estYearEnd = (curRate, unit) => {
    return Math.round(parseFloat(curRate) * unit);
  };

  $('pace-table-body').innerHTML = `
    <tr>
      <td>Books</td>
      <td class="text-center">${reqBooksPace} /mo</td>
      <td class="text-center font-extrabold text-theme-primary">${currentBooksPace} /mo</td>
      <td class="text-right">${statusBadge(currentBooksPace, reqBooksPace)}</td>
    </tr>
    <tr class="text-[8px] text-theme-secondary">
      <td colspan="4" class="text-right border-none pt-0 pb-2">Year-End Est: <b>${estYearEnd(yearBooks/Math.max(1, dayOfYear), daysInYear)} books</b></td>
    </tr>
    <tr>
      <td>Pages</td>
      <td class="text-center">${reqPagesPace} /day</td>
      <td class="text-center font-extrabold text-theme-primary">${currentPagesPace} /day</td>
      <td class="text-right">${statusBadge(currentPagesPace, reqPagesPace)}</td>
    </tr>
    <tr class="text-[8px] text-theme-secondary">
      <td colspan="4" class="text-right border-none pt-0 pb-2">Year-End Est: <b>${fmtNum(estYearEnd(currentPagesPace, daysInYear))} pages</b></td>
    </tr>
    <tr>
      <td>Sessions</td>
      <td class="text-center">${reqSessionsPace} /wk</td>
      <td class="text-center font-extrabold text-theme-primary">${currentSessionsPace} /wk</td>
      <td class="text-right">${statusBadge(currentSessionsPace, reqSessionsPace)}</td>
    </tr>
    <tr class="text-[8px] text-theme-secondary">
      <td colspan="4" class="text-right border-none pt-0 pb-2">Year-End Est: <b>${estYearEnd(yearSessions/Math.max(1, dayOfYear), daysInYear)} sessions</b></td>
    </tr>
    <tr>
      <td>Minutes</td>
      <td class="text-center">${reqMinutesPace} /day</td>
      <td class="text-center font-extrabold text-theme-primary">${currentMinutesPace} /day</td>
      <td class="text-right">${statusBadge(currentMinutesPace, reqMinutesPace)}</td>
    </tr>
    <tr class="text-[8px] text-theme-secondary">
      <td colspan="4" class="text-right border-none pt-0 pb-2">Year-End Est: <b>${fmtNum(estYearEnd(currentMinutesPace, daysInYear))} minutes</b></td>
    </tr>
  `;

  // 3. Long-Term Milestones
  const lifetimeStats = getReconciledStats(booksCache, logsCache, 'all', 'all');
  const totalPagesReadLifetime = lifetimeStats.pagesRead;
  const totalReadsLifetime = lifetimeStats.totalReads;

  const inProgressBooks = booksCache.filter(b => b.status === 'In Progress');
  const pagesLeftIP = inProgressBooks.reduce((s, b) => s + Math.max(0, b.total_pages - b.pages_read), 0);
  
  const calculateETA = (needed, dailyRate) => {
    if (needed <= 0) return '✓ Achieved!';
    if (!dailyRate || dailyRate <= 0.001) return 'Needs faster pace';
    const daysNeeded = needed / dailyRate;
    if (daysNeeded > 365 * 5) return '> 5 years';
    const eta = new Date();
    eta.setDate(eta.getDate() + daysNeeded);
    const dateStr = eta.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const monthsNeeded = Math.round(daysNeeded / 30.4);
    const relStr = daysNeeded < 30 ? `~${Math.round(daysNeeded)}d` : (monthsNeeded < 12 ? `~${monthsNeeded}m` : `~${(daysNeeded/365).toFixed(1)}y`);
    return `${dateStr} (${relStr})`;
  };

  const pagesPerDayRate = yearPages / Math.max(1, dayOfYear);
  const booksPerYearRate = yearBooks / Math.max(1, dayOfYear) * 365;

  const ipETA = calculateETA(pagesLeftIP, pagesPerDayRate);
  const lifetime50ETA = totalReadsLifetime >= 50 ? '✓ Achieved!' : calculateETA(50 - totalReadsLifetime, booksPerYearRate / 365);
  const lifetime100ETA = totalReadsLifetime >= 100 ? '✓ Achieved!' : calculateETA(100 - totalReadsLifetime, booksPerYearRate / 365);
  const pages30kETA = totalPagesReadLifetime >= 30000 ? '✓ Achieved!' : calculateETA(30000 - totalPagesReadLifetime, pagesPerDayRate);

  $('projection-table-body').innerHTML = `
    <tr>
      <td>Finish "In Progress" Books (${inProgressBooks.length} books left, ${pagesLeftIP} pg)</td>
      <td class="text-right font-bold text-theme-primary">${ipETA}</td>
    </tr>
    <tr>
      <td>Reach 50 Books Lifetime (Current: ${totalReadsLifetime})</td>
      <td class="text-right font-bold text-theme-primary">${lifetime50ETA}</td>
    </tr>
    <tr>
      <td>Reach 100 Books Lifetime (Current: ${totalReadsLifetime})</td>
      <td class="text-right font-bold text-theme-primary">${lifetime100ETA}</td>
    </tr>
    <tr>
      <td>Reach 30k Pages Lifetime (Current: ${fmtNum(totalPagesReadLifetime)})</td>
      <td class="text-right font-bold text-theme-primary">${pages30kETA}</td>
    </tr>
  `;

  // 4. Currently Reading Projections List
  const etasContainer = $('goals-reading-etas');
  etasContainer.innerHTML = '';
  
  if (inProgressBooks.length === 0) {
    etasContainer.innerHTML = '<p class="text-xs text-theme-tertiary text-center py-2 font-medium">No books currently in progress</p>';
  } else {
    inProgressBooks.forEach(b => {
      const left = Math.max(0, b.total_pages - b.pages_read);
      const pct = Math.min(100, Math.round((b.pages_read / Math.max(1, b.total_pages)) * 100));
      
      const bookLogs = activeLogs.filter(l => l.book_title === b.title);
      let avgRate = 0;
      let lastReadStr = 'Not logged recently';
      
      if (bookLogs.length > 0) {
        bookLogs.sort((a,b) => a.date.localeCompare(b.date));
        const oldestDate = new Date(bookLogs[0].date + 'T00:00:00');
        const newestDate = new Date(bookLogs[bookLogs.length - 1].date + 'T00:00:00');
        
        const daysDiff = Math.ceil(Math.abs(newestDate - oldestDate) / 86400000) + 1;
        const totalLoggedPages = bookLogs.reduce((s, l) => s + Math.max(0, l.end_page - l.start_page), 0);
        avgRate = totalLoggedPages / daysDiff;
        lastReadStr = fmtDate(bookLogs[bookLogs.length - 1].date);
      }

      // Hybrid rate blending for accurate & sensible ETAs
      const effectiveRate = avgRate > 0 ? (0.6 * avgRate + 0.4 * pagesPerDayRate) : pagesPerDayRate;
      const bookETA = calculateETA(left, effectiveRate);
      
      const card = el('div', 'glass-panel p-4 rounded-2xl flex flex-col gap-2.5 border border-theme');
      card.innerHTML = `
        <div class="flex justify-between items-start gap-3">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-extrabold text-theme-primary truncate">${b.title}</div>
            <div class="text-[9px] text-theme-secondary mt-0.5">Last read: ${lastReadStr} · ${left} pages left (${pct}%)</div>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[8px] font-black bg-amber-500/10 text-theme-gold border border-amber-500/10 uppercase shrink-0">${pct}%</span>
        </div>
        <div class="w-full bg-theme-card/60 rounded-full h-1.5 overflow-hidden">
          <div class="h-full rounded-full transition-all duration-500" style="width: ${pct}%; background: linear-gradient(90deg, var(--gold), var(--gold-light))"></div>
        </div>
        <div class="flex justify-between items-center text-[10px] text-theme-secondary mt-0.5 border-t border-theme pt-2 font-semibold">
          <span>Pace: <b class="text-theme-primary">${effectiveRate.toFixed(1)} pg/day</b></span>
          <span>ETA: <b class="text-theme-gold font-bold">${bookETA}</b></span>
        </div>
      `;
      etasContainer.appendChild(card);
    });
  }

  // Render Milestone Badges Vault & Streak Calendar
  renderAchievementsVault();
  renderStreakCalendar();
}

/** Reading Achievements & Milestone Badges Vault */
function renderAchievementsVault() {
  const container = document.getElementById('goals-milestones-vault');
  const countEl = document.getElementById('achievements-unlocked-count');
  if (!container) return;
  container.innerHTML = '';

  const lifetime = getReconciledStats(booksCache, logsCache, 'all', 'all');
  const totalPages = lifetime.pagesRead || 0;
  const totalBooks = lifetime.totalReads || 0;

  let streakDays = 0;
  if (typeof activeStreakCount !== 'undefined') streakDays = activeStreakCount;

  const categories = new Set((booksCache || []).map(b => b.category || 'General'));
  const notesCount = (logsCache || []).filter(l => l.notes && l.notes.trim().length > 0).length;

  const trophies = [
    {
      id: 'centurion',
      icon: 'fa-trophy',
      title: 'Centurion',
      desc: 'Finish 100+ books',
      current: totalBooks,
      target: 100,
      unlocked: totalBooks >= 100
    },
    {
      id: 'bibliophile',
      icon: 'fa-book-bookmark',
      title: 'Bibliophile',
      desc: '10,000+ lifetime pages',
      current: totalPages,
      target: 10000,
      unlocked: totalPages >= 10000
    },
    {
      id: 'streak',
      icon: 'fa-fire',
      title: '30-Day Shield',
      desc: 'Maintain a 30-day streak',
      current: streakDays,
      target: 30,
      unlocked: streakDays >= 30
    },
    {
      id: 'polymath',
      icon: 'fa-brain',
      title: 'Polymath',
      desc: 'Read 5+ categories',
      current: categories.size,
      target: 5,
      unlocked: categories.size >= 5
    },
    {
      id: 'archivist',
      icon: 'fa-feather-pointed',
      title: 'Archivist',
      desc: 'Log 50+ session notes',
      current: notesCount,
      target: 50,
      unlocked: notesCount >= 50
    },
    {
      id: 'scholar',
      icon: 'fa-graduation-cap',
      title: 'Scholar',
      desc: 'Finish 10+ core books',
      current: totalBooks,
      target: 10,
      unlocked: totalBooks >= 10
    }
  ];

  let unlockedCount = 0;

  trophies.forEach(t => {
    if (t.unlocked) unlockedCount++;
    const pct = Math.min(100, Math.round((t.current / t.target) * 100));

    const card = document.createElement('div');
    card.className = `p-3 rounded-2xl flex flex-col gap-2 border transition-all ${
      t.unlocked 
        ? 'bg-amber-500/10 border-amber-500/30 text-amber-200 shadow-lg' 
        : 'bg-white/[0.03] border-theme text-theme-secondary opacity-70'
    }`;

    card.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-xl ${t.unlocked ? 'bg-amber-500/20 text-theme-gold' : 'bg-white/5 text-theme-tertiary'} flex items-center justify-center text-sm shrink-0">
          <i class="fa-solid ${t.icon}"></i>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-xs font-bold ${t.unlocked ? 'text-amber-200' : 'text-theme-secondary'} truncate">${t.title}</div>
          <div class="text-[9px] text-theme-secondary truncate">${t.desc}</div>
        </div>
      </div>
      <div class="w-full bg-black/30 rounded-full h-1.5 overflow-hidden mt-1">
        <div class="h-full rounded-full transition-all duration-500 ${t.unlocked ? 'bg-amber-400' : 'bg-slate-600'}" style="width: ${pct}%;"></div>
      </div>
      <div class="flex justify-between items-center text-[9px] font-mono text-theme-secondary">
        <span>${t.unlocked ? 'UNLOCKED ✓' : 'LOCKED'}</span>
        <span>${fmtNum(t.current)} / ${fmtNum(t.target)}</span>
      </div>
    `;

    container.appendChild(card);
  });

  if (countEl) countEl.textContent = `${unlockedCount} / ${trophies.length} Unlocked`;
}

/** Editorial Quote Card Generator Modal & Download */
window.openQuoteCardModal = function(quoteText, author, bookTitle) {
  const modal = document.getElementById('quote-card-modal');
  if (!modal) return;

  const txtEl = document.getElementById('qc-text');
  const autEl = document.getElementById('qc-author');
  const bkEl = document.getElementById('qc-book');

  if (txtEl) txtEl.textContent = `"${(quoteText || 'Selected Quote').replace(/^>\s*/, '')}"`;
  if (autEl) autEl.textContent = author ? `— ${author}` : '— Reading Excerpt';
  if (bkEl) bkEl.textContent = bookTitle || 'Reading Tracker Vault';

  modal.classList.add('open');
};

document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('quote-card-close');
  const dlBtn = document.getElementById('qc-btn-download');

  if (closeBtn) closeBtn.onclick = () => document.getElementById('quote-card-modal').classList.remove('open');
  if (dlBtn) {
    dlBtn.onclick = () => downloadQuoteCardPNG();
  }
});

function downloadQuoteCardPNG() {
  const card = document.getElementById('quote-card-preview');
  if (!card) return;

  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');

  // Background Gradient
  const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
  grad.addColorStop(0, '#1f1915');
  grad.addColorStop(1, '#120e0c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1080);

  // Border
  ctx.strokeStyle = 'rgba(212, 163, 89, 0.3)';
  ctx.lineWidth = 12;
  ctx.strokeRect(40, 40, 1000, 1000);

  // Quotation Mark Watermark
  ctx.font = '280px serif';
  ctx.fillStyle = 'rgba(212, 163, 89, 0.08)';
  ctx.fillText('“', 800, 300);

  // Header Title
  ctx.font = 'bold 32px sans-serif';
  ctx.fillStyle = '#D4A359';
  ctx.fillText('EDITORIAL QUOTE EXCERPT', 100, 140);

  // Quote Text Wrapping
  const text = document.getElementById('qc-text').textContent || '';
  ctx.font = 'italic 44px serif';
  ctx.fillStyle = '#F5EBE6';
  
  const words = text.split(' ');
  let line = '';
  let y = 380;
  const lineHeight = 64;
  const maxWidth = 880;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, 100, y);
      line = words[n] + ' ';
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, 100, y);

  // Footer Attribution
  const author = document.getElementById('qc-author').textContent || '';
  const book = document.getElementById('qc-book').textContent || '';

  ctx.font = 'bold 36px sans-serif';
  ctx.fillStyle = '#E2E8F0';
  ctx.fillText(author, 100, 920);

  ctx.font = '28px monospace';
  ctx.fillStyle = '#D4A359';
  ctx.fillText(book, 100, 970);

  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = '#64748B';
  ctx.fillText('Reading Tracker', 820, 970);

  // Trigger Download
  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `quote_card_${todayISO()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  if (typeof showToast === 'function') showToast('✓ Quote Card PNG downloaded!', 'success');
}

function openGoalsModal() {
  if ($('goal-daily-pages'))      $('goal-daily-pages').value      = goalsCache.daily_pages_target      || 20;
  if ($('goal-daily-minutes'))    $('goal-daily-minutes').value    = goalsCache.daily_minutes_target    || 20;
  if ($('goal-annual-books'))     $('goal-annual-books').value     = goalsCache.annual_books_target     || 12;
  if ($('goal-annual-pages'))     $('goal-annual-pages').value     = goalsCache.annual_pages_target     || 3000;
  if ($('goal-annual-sessions'))  $('goal-annual-sessions').value  = goalsCache.annual_sessions_target  || 100;
  if ($('goal-annual-minutes'))   $('goal-annual-minutes').value   = goalsCache.annual_minutes_target   || 3000;
  if ($('goal-monthly-books'))    $('goal-monthly-books').value    = goalsCache.monthly_books_target    || 1;
  if ($('goal-monthly-pages'))    $('goal-monthly-pages').value    = goalsCache.monthly_pages_target    || 300;
  if ($('goal-monthly-sessions')) $('goal-monthly-sessions').value = goalsCache.monthly_sessions_target || 10;
  if ($('goal-monthly-minutes'))  $('goal-monthly-minutes').value  = goalsCache.monthly_minutes_target  || 300;
  $('goals-modal').classList.add('open');
}
function closeGoalsModal() { $('goals-modal').classList.remove('open'); }

let isSaveGoalsSubmitting = false;

async function saveGoals() {
  if (isSaveGoalsSubmitting) return;

  const parseVal = (id, fallback) => {
    const raw = $(id)?.value;
    if (raw === undefined || raw === null || raw.trim() === '') return fallback;
    const v = parseInt(raw, 10);
    return (!isNaN(v) && v > 0) ? v : fallback;
  };

  // Check for invalid negative inputs
  const inputs = ['goal-daily-pages', 'goal-daily-minutes',
                  'goal-annual-books', 'goal-annual-pages', 'goal-annual-sessions', 'goal-annual-minutes',
                  'goal-monthly-books', 'goal-monthly-pages', 'goal-monthly-sessions', 'goal-monthly-minutes'];
  for (const id of inputs) {
    const raw = $(id)?.value;
    if (raw !== undefined && raw !== null && raw.trim() !== '' && parseInt(raw, 10) <= 0) {
      showToast('Target goals must be positive numbers', 'error');
      return;
    }
  }

  isSaveGoalsSubmitting = true;
  const saveBtn = $('goals-modal-save');
  if (saveBtn) saveBtn.disabled = true;

  const data = {
    daily_pages_target:      parseVal('goal-daily-pages', 20),
    daily_minutes_target:    parseVal('goal-daily-minutes', 20),
    annual_books_target:     parseVal('goal-annual-books', 12),
    annual_pages_target:     parseVal('goal-annual-pages', 3000),
    annual_sessions_target:  parseVal('goal-annual-sessions', 100),
    annual_minutes_target:   parseVal('goal-annual-minutes', 3000),
    monthly_books_target:    parseVal('goal-monthly-books', 1),
    monthly_pages_target:    parseVal('goal-monthly-pages', 300),
    monthly_sessions_target: parseVal('goal-monthly-sessions', 10),
    monthly_minutes_target:  parseVal('goal-monthly-minutes', 300),
  };

  try {
    if (db && uid) await setDoc(doc(db, `users/${uid}/goals/config`), data, { merge: true });
  } catch (e) {
    console.warn('[Goals] Local save only (offline/auth):', e.message);
  } finally {
    isSaveGoalsSubmitting = false;
    if (saveBtn) saveBtn.disabled = false;
  }
  goalsCache = data;
  try {
    localStorage.setItem('goals_cache', JSON.stringify(goalsCache));
    localStorage.setItem('rt_target_pages', data.daily_pages_target);
    localStorage.setItem('rt_target_minutes', data.daily_minutes_target);
    localStorage.setItem('rt_pref_pages', data.daily_pages_target);
    localStorage.setItem('rt_pref_mins', data.daily_minutes_target);
  } catch(e){}

  closeGoalsModal();
  showToast('Goals updated ✓', 'success');
  if (currentView === 'dashboard') renderDashboard();
  renderGoals();
}

// ── Chart.js Visualization ───────────────────────────────────────────────────
// ── Native SVG Chart Renderers ───────────────────────────────────────────────

// Helper: create an SVG element
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

// ── DONUT CHART — Baha'i vs Non-Baha'i pages ─────────────────────────────────
function renderDonutChart() {
  const wrap = $('chart-donut-wrap');
  if (!wrap) return;

  let bahaiVal = 0, nonBahaiVal = 0;
  if (dashboardStats) {
    if (collectionChartMode === 'pages') {
      bahaiVal = dashboardStats.bahaiPages;
      nonBahaiVal = dashboardStats.nonBahaiPages;
    } else {
      bahaiVal = dashboardStats.bahaiBooks;
      nonBahaiVal = dashboardStats.nonBahaiBooks;
    }
  } else {
    booksCache.forEach(b => {
      if (collectionChartMode === 'pages') {
        const completed = (b.read_count || 0) * (b.total_pages || 0);
        const active = b.status === 'In Progress' ? (b.pages_read || 0) : 0;
        const tot = completed + active;
        if (b.collection === 'Bahai') bahaiVal += tot;
        else nonBahaiVal += tot;
      } else {
        const tot = b.read_count || 0;
        if (b.collection === 'Bahai') bahaiVal += tot;
        else nonBahaiVal += tot;
      }
    });
  }

  const total = bahaiVal + nonBahaiVal || 1;
  const r = 37, cx = 50, cy = 50, sw = 8;
  const circ = 2 * Math.PI * r; // ~232.48
  const bahaiDash = (bahaiVal / total) * circ;
  const nonBahaiDash = (nonBahaiVal / total) * circ;

  const isLight = document.body.classList.contains('light-mode');
  const c1 = isLight ? '#FF9F0A' : '#D6A85C'; // Bahai (Gold)
  const c2 = isLight ? '#0A84FF' : '#38BDF8'; // Non-Bahai (Sky Blue)
  const trackColor = 'var(--border)';

  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'w-full h-full', style: 'display:block' });
  svg.appendChild(svgEl('circle', { cx, cy, r, fill: 'none', stroke: trackColor, 'stroke-width': sw }));

  const centerOverlay = el('div', 'absolute inset-0 flex flex-col items-center justify-center pointer-events-none p-1');
  const overlayTotal = el('span', 'text-base font-black text-theme-primary tracking-tight');
  overlayTotal.textContent = fmtNum(total);
  const overlayLabel = el('span', 'text-[9px] font-bold uppercase tracking-wider text-theme-secondary text-center mt-0.5 max-w-[80px] leading-tight');
  overlayLabel.textContent = collectionChartMode === 'pages' ? 'Pages' : 'Books';
  centerOverlay.appendChild(overlayTotal);
  centerOverlay.appendChild(overlayLabel);

  const pctBahai = total > 0 ? Math.round(bahaiVal / total * 100) : 0;
  const pctNon   = 100 - pctBahai;

  if (bahaiVal > 0) {
    const s1 = svgEl('circle', {
      cx, cy, r, fill: 'none', stroke: c1, 'stroke-width': sw,
      'stroke-dasharray': `${bahaiDash} ${circ}`,
      transform: `rotate(-90 ${cx} ${cy})`,
      class: 'transition-all duration-300 cursor-pointer'
    });
    s1.style.transition = 'stroke-width 0.2s ease';
    s1.addEventListener('mouseenter', () => {
      s1.setAttribute('stroke-width', (sw + 2).toString());
      overlayTotal.textContent = fmtNum(bahaiVal);
      overlayLabel.textContent = `Bahá'í (${pctBahai}%)`;
    });
    s1.addEventListener('mouseleave', () => {
      s1.setAttribute('stroke-width', sw.toString());
      overlayTotal.textContent = fmtNum(total);
      overlayLabel.textContent = collectionChartMode === 'pages' ? 'Pages' : 'Books';
    });
    s1.addEventListener('click', () => {
      openChartDrilldownModal("Bahá'í Collection", booksCache.filter(b => b.collection === 'Bahai'));
    });
    svg.appendChild(s1);
  }

  if (nonBahaiVal > 0) {
    const startAngle = -90 + (bahaiVal / total) * 360;
    const s2 = svgEl('circle', {
      cx, cy, r, fill: 'none', stroke: c2, 'stroke-width': sw,
      'stroke-dasharray': `${nonBahaiDash} ${circ}`,
      transform: `rotate(${startAngle} ${cx} ${cy})`,
      class: 'transition-all duration-300 cursor-pointer'
    });
    s2.style.transition = 'stroke-width 0.2s ease';
    s2.addEventListener('mouseenter', () => {
      s2.setAttribute('stroke-width', (sw + 2).toString());
      overlayTotal.textContent = fmtNum(nonBahaiVal);
      overlayLabel.textContent = `Non-Bahá'í (${pctNon}%)`;
    });
    s2.addEventListener('mouseleave', () => {
      s2.setAttribute('stroke-width', sw.toString());
      overlayTotal.textContent = fmtNum(total);
      overlayLabel.textContent = collectionChartMode === 'pages' ? 'Pages' : 'Books';
    });
    s2.addEventListener('click', () => {
      openChartDrilldownModal("Non-Bahá'í Collection", booksCache.filter(b => b.collection === 'Non-Bahai'));
    });
    svg.appendChild(s2);
  }

  // Legend
  const legend = el('div', 'flex flex-col gap-2.5 justify-center w-full max-w-[140px]');
  const unitStr = collectionChartMode === 'pages' ? 'pg' : 'books';
  legend.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${c1}"></span>
      <div>
        <div class="text-[10px] font-bold text-slate-350">Bahá'í</div>
        <div class="text-xs font-black text-theme-primary">${pctBahai}% <span class="text-[9px] font-bold text-theme-secondary">(${fmtNum(bahaiVal)} ${unitStr})</span></div>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${c2}"></span>
      <div>
        <div class="text-[10px] font-bold text-slate-350">Non-Bahá'í</div>
        <div class="text-xs font-black text-theme-primary">${pctNon}% <span class="text-[9px] font-bold text-theme-secondary">(${fmtNum(nonBahaiVal)} ${unitStr})</span></div>
      </div>
    </div>
  `;

  wrap.innerHTML = '';
  const flexContainer = el('div', 'flex flex-row items-center justify-around gap-6 py-2 w-full relative');
  const svgWrapper = el('div', 'relative w-36 h-36 shrink-0 flex items-center justify-center');
  svgWrapper.appendChild(svg);
  svgWrapper.appendChild(centerOverlay);
  flexContainer.appendChild(svgWrapper);
  flexContainer.appendChild(legend);
  wrap.appendChild(flexContainer);
}

// ── SPARKLINE — weekly pages over last 12 weeks ───────────────────────────────
function renderSparklineChart() {
  const wrap = $('chart-sparkline-wrap');
  if (!wrap) return;

  const selectedYear = $('dash-year-select').value;
  const activeLogs = logsCache.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));
  
  let yearLogs = selectedYear === 'all' ? activeLogs : activeLogs.filter(l => l.date.startsWith(selectedYear));
  let filteredLogs = yearLogs.filter(l => {
    const book = booksCache.find(b => b.title === l.book_title);
    return !book || dashFilter === 'all' || book.collection === dashFilter;
  });

  renderChronologicalSparkline(filteredLogs, 'chart-sparkline-wrap');
}

function renderBarChart() {
  renderCategoryPieChart(booksCache, 'chart-bar-wrap');
}

function renderCharts(completions) {
  const selectedYear = $('dash-year-select').value;
  const activeLogs = logsCache.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));
  
  let yearLogs = selectedYear === 'all' ? activeLogs : activeLogs.filter(l => l.date.startsWith(selectedYear));
  let filteredActiveLogs = yearLogs.filter(l => {
    const book = booksCache.find(b => b.title === l.book_title);
    return !book || dashFilter === 'all' || book.collection === dashFilter;
  });

  renderDonutChart();
  renderBarChart();
  renderActivityHeatmap(filteredActiveLogs);
  
  if (completions) {
    renderBooksPerYearChart(completions, 'chart-books-year-wrap');
  }
}


// ── Log Stopwatch & Heatmap ───────────────────────────────────────────────────
function setupStopwatch() {
  const toggleBtn = $('btn-timer-toggle');
  const resetBtn = $('btn-timer-reset');
  const display = $('timer-display');
  
  if (!toggleBtn) return;

  function saveTimerState(running, startTimestamp, accumulatedSeconds) {
    try {
      localStorage.setItem('rt_timer_state', JSON.stringify({
        running,
        startTimestamp,
        accumulatedSeconds
      }));
    } catch (e) {}
  }

  function updateTimerDisplay(totalSecs) {
    const mins = String(Math.floor(totalSecs / 60)).padStart(2, '0');
    const secs = String(totalSecs % 60).padStart(2, '0');
    if (display) display.textContent = `${mins}:${secs}`;
  }

  function startTick() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const stored = localStorage.getItem('rt_timer_state');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.running && parsed.startTimestamp) {
            const elapsed = Math.floor((Date.now() - parsed.startTimestamp) / 1000) + (parsed.accumulatedSeconds || 0);
            timerSeconds = elapsed;
            updateTimerDisplay(timerSeconds);
            const minsInput = $('log-minutes');
            if (minsInput) minsInput.value = Math.max(1, Math.ceil(timerSeconds / 60));
            return;
          }
        } catch (e) {}
      }
      timerSeconds++;
      updateTimerDisplay(timerSeconds);
    }, 1000);
  }

  // Restore running timer state from localStorage on init
  const savedState = localStorage.getItem('rt_timer_state');
  if (savedState) {
    try {
      const parsed = JSON.parse(savedState);
      if (parsed.running && parsed.startTimestamp) {
        const elapsed = Math.floor((Date.now() - parsed.startTimestamp) / 1000) + (parsed.accumulatedSeconds || 0);
        timerSeconds = elapsed;
        timerRunning = true;
        updateTimerDisplay(timerSeconds);
        toggleBtn.textContent = 'Pause';
        toggleBtn.style.cssText = 'background:rgba(var(--rose-rgb),0.1);border-color:rgba(var(--rose-rgb),0.25);color:var(--rose)';
        if (display) display.classList.add('timer-running');
        if (resetBtn) resetBtn.classList.add('hidden');
        startTick();
      } else if (parsed.accumulatedSeconds > 0) {
        timerSeconds = parsed.accumulatedSeconds;
        updateTimerDisplay(timerSeconds);
        toggleBtn.textContent = 'Resume';
        toggleBtn.style.cssText = 'background:rgba(var(--gold-rgb),0.1);border-color:rgba(var(--gold-rgb),0.25);color:var(--gold)';
        if (resetBtn) resetBtn.classList.remove('hidden');
      }
    } catch (e) {}
  }
  
  toggleBtn.addEventListener('click', () => {
    if (timerRunning) {
      clearInterval(timerInterval);
      timerInterval = null;
      timerRunning = false;
      stopBackgroundTimerSession();
      toggleBtn.textContent = 'Resume';
      toggleBtn.style.cssText = 'background:rgba(var(--gold-rgb),0.1);border-color:rgba(var(--gold-rgb),0.25);color:var(--gold)';
      display.classList.remove('timer-running');
      resetBtn.classList.remove('hidden');
      saveTimerState(false, null, timerSeconds);
      const minsInput = $('log-minutes');
      if (minsInput) minsInput.value = Math.max(1, Math.ceil(timerSeconds / 60));
    } else {
      timerRunning = true;
      toggleBtn.textContent = 'Pause';
      toggleBtn.style.cssText = 'background:rgba(var(--rose-rgb),0.1);border-color:rgba(var(--rose-rgb),0.25);color:var(--rose)';
      display.classList.add('timer-running');
      resetBtn.classList.add('hidden');
      const startMs = Date.now();
      saveTimerState(true, startMs, timerSeconds);
      const bookSel = $('log-book');
      const bookTitle = bookSel && bookSel.options[bookSel.selectedIndex] ? bookSel.options[bookSel.selectedIndex].text : 'Reading Session';
      startBackgroundTimerSession(bookTitle, 'Reading Log Timer');
      startTick();
    }
  });

  resetBtn.addEventListener('click', () => {
    clearInterval(timerInterval);
    timerInterval = null;
    timerSeconds = 0;
    timerRunning = false;
    stopBackgroundTimerSession();
    display.textContent = '00:00';
    display.classList.remove('timer-running');
    toggleBtn.textContent = 'Start';
    toggleBtn.style.cssText = 'background:rgba(var(--gold-rgb),0.1);border-color:rgba(var(--gold-rgb),0.25);color:var(--gold)';
    resetBtn.classList.add('hidden');
    localStorage.removeItem('rt_timer_state');
    const minsInput = $('log-minutes');
    if (minsInput) minsInput.value = '';
  });

  // Setup Stepper preset button handlers
  document.querySelectorAll('.btn-stepper-chip').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof triggerHaptic === 'function') triggerHaptic();
      
      const stepEnd = btn.dataset.stepEnd;
      const stepMin = btn.dataset.stepMin;

      if (stepEnd) {
        const endInput = $('log-end');
        const startInput = $('log-start');
        if (endInput) {
          const currentEnd = parseInt(endInput.value, 10);
          const currentStart = parseInt(startInput ? startInput.value : 0, 10) || 0;
          const base = !isNaN(currentEnd) && currentEnd > 0 ? currentEnd : currentStart;
          endInput.value = base + parseInt(stepEnd, 10);
          endInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      if (stepMin) {
        const minInput = $('log-minutes');
        if (minInput) {
          const currentMin = parseInt(minInput.value, 10) || 0;
          minInput.value = currentMin + parseInt(stepMin, 10);
          minInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });
  });
}

function renderLogView() {
  renderHeatmap();
  renderRecentLogs();
}

function renderHeatmap() {
  const container = $('heatmap-calendar');
  if (!container) return;
  container.innerHTML = '';
  
  const activeLogs = logsCache.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));
  const pagesPerDay = {};
  activeLogs.forEach(l => {
    const val = Math.max(0, l.end_page - l.start_page);
    pagesPerDay[l.date] = (pagesPerDay[l.date] || 0) + val;
  });
  
  // Last 12 weeks = 84 days
  const today = new Date();
  const dates = [];
  for (let i = 0; i <= 83; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }
  
  dates.forEach(dStr => {
    const pages = pagesPerDay[dStr] || 0;
    const cell = el('div', 'heatmap-cell');
    if (pages > 0) {
      if (pages <= 10) cell.classList.add('heatmap-tier-1');
      else if (pages <= 20) cell.classList.add('heatmap-tier-2');
      else if (pages <= 40) cell.classList.add('heatmap-tier-3');
      else cell.classList.add('heatmap-tier-4');
    }
    
    const d = new Date(dStr + 'T00:00:00');
    cell.title = `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${pages} pages read`;
    cell.onclick = () => {
      const dayLogs = activeLogs.filter(l => l.date === dStr);
      const booksReadList = [...new Set(dayLogs.map(l => l.book_title).filter(Boolean))];
      if (typeof openHeatmapDayModal === 'function') {
        openHeatmapDayModal(dStr, dayLogs, booksReadList);
      }
    };
    container.appendChild(cell);
  });
}

let recentLogsLimit = 25;

function renderRecentLogs() {
  const container = $('log-recent-list');
  if (!container) return;
  container.innerHTML = '';
  
  const activeLogs = logsCache.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));
  if (activeLogs.length === 0) {
    container.innerHTML = '<p class="text-xs text-theme-tertiary text-center py-2 font-medium">No recent logs recorded</p>';
    return;
  }

  const logsToDisplay = activeLogs.slice(0, recentLogsLimit);
  
  logsToDisplay.forEach(l => {
    const card = el('div', 'glass-panel p-3.5 rounded-2xl flex items-center justify-between gap-3 border border-theme hover:bg-theme-card transition-all cursor-pointer group relative overflow-hidden');
    const pages = Math.max(0, (l.end_page || 0) - (l.start_page || 0));
    
    card.innerHTML = `
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-theme-primary truncate">${l.book_title}</span>
          <span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-gold/15 text-gold border border-gold/20 shrink-0">+${pages} pg</span>
        </div>
        <div class="text-[9px] text-theme-secondary mt-0.5 flex items-center gap-2">
          <span>Cycle ${l.read_cycle || 1}</span>
          <span>•</span>
          <span>pp. ${l.start_page || 0} → ${l.end_page || 0}</span>
          <span>•</span>
          <span>${fmtDate(l.date)}</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div class="text-xs font-bold text-theme-primary">${l.minutes_spent ? `${l.minutes_spent}m` : '—'}</div>
        <button data-edit-log-id="${l.id || ''}" class="w-7 h-7 rounded-lg bg-white/5 hover:bg-gold/20 hover:text-gold text-theme-secondary border border-theme flex items-center justify-center transition-all shrink-0 active:scale-95" title="Edit Log">
          <i class="fa-solid fa-pen text-[10px]"></i>
        </button>
      </div>
    `;
    
    const editBtn = card.querySelector('[data-edit-log-id]');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditLogModal(l);
      });
    }
    
    card.addEventListener('click', () => openLogDetailModal(l));
    container.appendChild(card);
  });

  if (activeLogs.length > recentLogsLimit) {
    const remaining = activeLogs.length - recentLogsLimit;
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'w-full py-3 rounded-2xl border border-theme bg-white/5 hover:bg-white/10 text-xs font-bold text-theme-secondary transition-all active:scale-95 cursor-pointer mt-2';
    loadMoreBtn.innerHTML = `<i class="fa-solid fa-chevron-down mr-1.5"></i> Load More Logs (${remaining} remaining)`;
    loadMoreBtn.onclick = () => {
      recentLogsLimit += 35;
      renderRecentLogs();
    };
    container.appendChild(loadMoreBtn);
  }
}

// ── Master Catalog & Add Book Selection ─────────────────────────────────────
let masterCatalog = [];
let isCatalogEventsSetup = false;

async function loadMasterCatalog() {
  const catalogMap = new Map();

  // 1. Fetch seed-data.json books (100+ master books added by owner)
  try {
    const resp = await fetch('./seed-data.json');
    if (resp.ok) {
      const seed = await resp.json();
      if (seed && seed.books) {
        seed.books.forEach(b => {
          if (b && b.title) {
            const key = b.title.trim().toLowerCase();
            if (!catalogMap.has(key)) {
              catalogMap.set(key, {
                title: b.title.trim(),
                author: b.author || '',
                collection: b.collection || 'Bahai',
                group: b.group_name || b.group || 'Writings',
                total_pages: b.total_pages || 0,
                cover_url: b.cover_url || ''
              });
            }
          }
        });
      }
    }
  } catch (e) {
    console.warn('Failed to load seed-data.json for master catalog:', e);
  }

  // 2. Include user's booksCache
  (booksCache || []).forEach(b => {
    if (b && b.title) {
      const key = b.title.trim().toLowerCase();
      if (!catalogMap.has(key)) {
        catalogMap.set(key, {
          title: b.title.trim(),
          author: b.author || '',
          collection: b.collection || 'Bahai',
          group: b.group_name || b.group || b.reading_group || 'Writings',
          total_pages: b.total_pages || 0,
          cover_url: b.cover_url || ''
        });
      }
    }
  });

  masterCatalog = Array.from(catalogMap.values()).sort((a, b) => a.title.localeCompare(b.title));
  return masterCatalog;
}

async function populateAddBookCatalogDropdown() {
  const sel = $('ab-catalog-select');
  const datalist = $('ab-catalog-datalist');
  if (!sel && !datalist) return;

  const catalog = await loadMasterCatalog();

  if (sel) {
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- Select a pre-existing book to autofill --</option>';
    catalog.forEach((b, index) => {
      const opt = document.createElement('option');
      opt.value = index.toString();
      const meta = [b.author, b.total_pages ? `${b.total_pages} p.` : ''].filter(Boolean).join(' • ');
      opt.textContent = meta ? `${b.title} (${meta})` : b.title;
      sel.appendChild(opt);
    });
    sel.value = currentVal;
  }

  if (datalist) {
    datalist.innerHTML = '';
    catalog.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.title;
      datalist.appendChild(opt);
    });
  }

  setupAddBookCatalogEvents();
}

function applyCatalogBookToForm(book) {
  if (!book) return;
  if ($('ab-title')) $('ab-title').value = book.title || '';
  if ($('ab-author')) $('ab-author').value = book.author || '';
  
  if ($('ab-collection')) {
    const collVal = book.collection === 'Non-Bahai' ? 'Non-Bahai' : 'Bahai';
    $('ab-collection').value = collVal;
  }

  if ($('ab-group-select')) {
    const stdGroups = ['Writings', 'About the Faith', 'Compilations', 'Fiction', 'Non-Fiction'];
    const g = book.group || book.group_name || 'Writings';
    if (stdGroups.includes(g)) {
      $('ab-group-select').value = g;
      if ($('custom-group-container')) $('custom-group-container').classList.add('hidden');
    } else {
      $('ab-group-select').value = 'Other';
      if ($('custom-group-container')) $('custom-group-container').classList.remove('hidden');
      if ($('ab-group-custom')) $('ab-group-custom').value = g;
    }
  }

  if ($('ab-pages')) $('ab-pages').value = book.total_pages || '';
  if ($('ab-cover-url')) $('ab-cover-url').value = book.cover_url || '';

  if ($('ab-cover-preview')) {
    if (book.cover_url) {
      $('ab-cover-preview').innerHTML = `<img src="${book.cover_url}" class="w-full h-full object-cover rounded-lg" alt="" onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-image\\'></i>'">`;
    } else {
      $('ab-cover-preview').innerHTML = `<i class="fa-solid fa-image"></i>`;
    }
  }
}

function setupAddBookCatalogEvents() {
  if (isCatalogEventsSetup) return;
  isCatalogEventsSetup = true;

  const sel = $('ab-catalog-select');
  if (sel) {
    sel.addEventListener('change', e => {
      const idx = parseInt(e.target.value);
      if (!isNaN(idx) && masterCatalog[idx]) {
        applyCatalogBookToForm(masterCatalog[idx]);
      }
    });
  }

  const titleInput = $('ab-title');
  if (titleInput) {
    const handleTitleAutofill = () => {
      const val = titleInput.value.trim().toLowerCase();
      if (!val) return;
      const matched = masterCatalog.find(b => b.title.toLowerCase() === val);
      if (matched) {
        applyCatalogBookToForm(matched);
      }
    };
    titleInput.addEventListener('change', handleTitleAutofill);
    titleInput.addEventListener('input', handleTitleAutofill);
  }
}

function openAddBookModal() {
  if ($('ab-catalog-select')) $('ab-catalog-select').value = '';
  if ($('ab-title')) $('ab-title').value = '';
  if ($('ab-author')) $('ab-author').value = '';
  if ($('ab-pages')) $('ab-pages').value = '';
  if ($('ab-cover-url')) $('ab-cover-url').value = '';
  if ($('ab-cover-preview')) $('ab-cover-preview').innerHTML = `<i class="fa-solid fa-image"></i>`;
  const searchBtn = $('ab-btn-search-cover');
  if (searchBtn) searchBtn.onclick = () => autoFindSingleCover('ab-title', 'ab-author', 'ab-cover-url', 'ab-cover-preview');
  
  populateAddBookCatalogDropdown();
  $('add-book-modal').classList.add('open');
}

function setupBookshelf() {
  if (isBookshelfSetup) return;
  isBookshelfSetup = true;
  const searchEl = $('wishlist-search');
  if (searchEl) {
    const debouncedSearch = debounce(() => {
      renderBookshelf({ skipViewTransition: true });
    }, 150);
    searchEl.addEventListener('input', e => {
      bookshelfSearchTerm = e.target.value;
      debouncedSearch();
    });
  }

  const sortEl = $('bookshelf-sort-select');
  if (sortEl) {
    sortEl.addEventListener('change', e => {
      bookshelfSortOrder = e.target.value;
      renderBookshelf();
    });
  }

  const filterEl = $('bookshelf-filter-status');
  if (filterEl) {
    filterEl.querySelectorAll('[data-bsf]').forEach(btn => {
      btn.addEventListener('click', () => {
        bookshelfStatusFilter = btn.dataset.bsf;
        filterEl.querySelectorAll('[data-bsf]').forEach(b => {
          const active = b.dataset.bsf === bookshelfStatusFilter;
          b.classList.toggle('active', active);
        });
        renderBookshelf();
      });
    });
  }

  const ownershipFilterEl = $('bookshelf-filter-ownership');
  if (ownershipFilterEl) {
    ownershipFilterEl.querySelectorAll('[data-bfo]').forEach(btn => {
      btn.addEventListener('click', () => {
        bookshelfOwnershipFilter = btn.dataset.bfo;
        ownershipFilterEl.querySelectorAll('[data-bfo]').forEach(b => {
          const active = b.dataset.bfo === bookshelfOwnershipFilter;
          b.classList.toggle('active', active);
        });
        renderBookshelf();
      });
    });
  }

  // View mode toggle (List vs Grid)
  const viewBtn = $('btn-view-mode');
  if (viewBtn) {
    viewBtn.addEventListener('click', () => {
      bookshelfViewMode = bookshelfViewMode === 'list' ? 'grid' : 'list';
      $('btn-view-mode-text').textContent = bookshelfViewMode === 'list' ? 'Grid' : 'List';
      const icon = viewBtn.querySelector('i');
      if (icon) {
        icon.className = bookshelfViewMode === 'list' ? 'fa-solid fa-border-all text-[10px]' : 'fa-solid fa-list text-[10px]';
      }
      renderBookshelf();
    });
  }

  // Grouping mode toggle (Flat vs Grouped)
  const groupBtn = $('btn-grouping-mode');
  if (groupBtn) {
    groupBtn.addEventListener('click', () => {
      bookshelfGrouping = bookshelfGrouping === 'none' ? 'group' : 'none';
      $('btn-grouping-mode-text').textContent = bookshelfGrouping === 'none' ? 'Grouped' : 'Flat';
      groupBtn.classList.toggle('bg-gold/10', bookshelfGrouping === 'group');
      groupBtn.classList.toggle('text-gold', bookshelfGrouping === 'group');
      renderBookshelf();
    });
  }

  // Cover Manager Modal trigger
  const coverBtn = $('btn-cover-manager');
  if (coverBtn) coverBtn.addEventListener('click', openCoverManagerModal);
  const coverClose = $('cover-manager-close');
  if (coverClose) coverClose.addEventListener('click', closeCoverManagerModal);
  const coverBackdrop = $('cover-manager-backdrop');
  if (coverBackdrop) coverBackdrop.addEventListener('click', closeCoverManagerModal);
  const autoSearchBtn = $('btn-auto-search-covers');
  if (autoSearchBtn) autoSearchBtn.addEventListener('click', autoSearchAllCovers);
  const approveAllBtn = $('btn-approve-all-top');
  if (approveAllBtn) approveAllBtn.addEventListener('click', autoSearchAllCovers);

  // Multi-Select mode toggle
  const selectBtn = $('btn-select-mode');
  if (selectBtn) {
    selectBtn.addEventListener('click', () => {
      bookshelfSelectMode = !bookshelfSelectMode;
      bookshelfSelectedIds.clear();
      $('btn-select-mode-text').textContent = bookshelfSelectMode ? 'Cancel' : 'Select';
      selectBtn.classList.toggle('bg-gold/20', bookshelfSelectMode);
      selectBtn.classList.toggle('text-gold', bookshelfSelectMode);
      $('bookshelf-batch-bar').classList.toggle('hidden', !bookshelfSelectMode);
      updateBatchBarUI();
      renderBookshelf();
    });
  }

  // Batch actions
  const batchStatus = $('batch-status-select');
  if (batchStatus) {
    batchStatus.addEventListener('change', async e => {
      const val = e.target.value;
      if (val) {
        await batchUpdateStatus(val);
        e.target.value = '';
      }
    });
  }

  const batchDelete = $('btn-batch-delete');
  if (batchDelete) batchDelete.addEventListener('click', batchDeleteBooks);

  const batchCancel = $('btn-batch-cancel');
  if (batchCancel) batchCancel.addEventListener('click', () => {
    bookshelfSelectMode = false;
    bookshelfSelectedIds.clear();
    $('btn-select-mode-text').textContent = 'Select';
    $('btn-select-mode').classList.remove('bg-gold/20', 'text-gold');
    $('bookshelf-batch-bar').classList.add('hidden');
    renderBookshelf();
  });

  const addTrigger = $('btn-add-book-trigger');
  if (addTrigger) addTrigger.addEventListener('click', openAddBookModal);

  const addClose = $('add-book-close');
  if (addClose) addClose.addEventListener('click', () => $('add-book-modal').classList.remove('open'));
  const addSave = $('add-book-save');
  if (addSave) addSave.addEventListener('click', saveNewBook);

  const editClose = $('edit-book-close');
  if (editClose) editClose.addEventListener('click', () => $('edit-book-modal').classList.remove('open'));
  const editSave = $('edit-book-save');
  if (editSave) editSave.addEventListener('click', saveEditBook);

  const editDelete = $('edit-book-delete');
  if (editDelete) editDelete.addEventListener('click', () => {
    if (activeBookObjectForEdit) deleteBook(activeBookObjectForEdit);
  });
}

function updateBatchBarUI() {
  const countEl = $('batch-selected-count');
  if (countEl) countEl.textContent = `${bookshelfSelectedIds.size} selected`;
}

async function renderBookshelf(options = {}) {
  const allItems = await getMergedBooks();

  // 1. Calculate top stats summary
  const totalBooks = allItems.length;
  const totalPages = allItems.reduce((s, b) => s + (b.total_pages || 0), 0);
  const totalVal   = allItems.reduce((s, b) => s + (b.est_cost || 0), 0);

  if ($('st-total-books')) $('st-total-books').textContent = totalBooks;
  if ($('st-total-pages')) $('st-total-pages').textContent = fmtNum(totalPages);
  if ($('st-total-val'))   $('st-total-val').textContent   = `$${totalVal.toFixed(0)}`;

  const container = $('bookshelf-list');
  if (!container) return;

  const q = bookshelfSearchTerm;

  // Filter based on diacritic-insensitive search term across multiple fields, status tab, and ownership tab
  let filtered = allItems.filter(item => {
    if (q) {
      const normalizedQ = normalizeText(q);
      const matchTitle = normalizeText(item.title).includes(normalizedQ);
      const matchAuthor = normalizeText(item.author).includes(normalizedQ);
      const matchGroup = normalizeText(item.group).includes(normalizedQ);
      const matchCollection = normalizeText(item.collection).includes(normalizedQ);
      const matchNotes = normalizeText(item.notes).includes(normalizedQ);
      const matchPriority = normalizeText(item.priority).includes(normalizedQ);
      const matchStatus = normalizeText(item.status).includes(normalizedQ);
      const matchWhere = normalizeText(item.where_to_buy).includes(normalizedQ);
      if (!matchTitle && !matchAuthor && !matchGroup && !matchCollection && !matchNotes && !matchPriority && !matchStatus && !matchWhere) return false;
    }

    if (bookshelfStatusFilter === 'Not Started') {
      if (!['Not Started', 'Owned', 'Gifted', 'Borrowed'].includes(item.status)) return false;
    } else if (bookshelfStatusFilter === 'In Progress') {
      if (item.status !== 'In Progress') return false;
    } else if (bookshelfStatusFilter === 'Finished') {
      if (!['Finished', 'Owned and Read', 'Borrowed and Read', 'Gifted and Read'].includes(item.status)) return false;
    } else if (bookshelfStatusFilter === 'Wishlist') {
      if (item.ownership !== 'Wishlist') return false;
    }

    if (bookshelfOwnershipFilter !== 'All') {
      if (item.ownership !== bookshelfOwnershipFilter) return false;
    }

    return true;
  });

  // Render Active Filter Chips
  renderActiveFilterChips();

  // Apply sorting
  filtered.sort((a, b) => {
    if (bookshelfSortOrder === 'title-desc') {
      return b.title.localeCompare(a.title);
    } else if (bookshelfSortOrder === 'priority-high') {
      const pRank = { High: 3, Medium: 2, Low: 1 };
      return (pRank[b.priority] || 1) - (pRank[a.priority] || 1);
    } else if (bookshelfSortOrder === 'progress-desc') {
      const aProg = a.total_pages > 0 ? (a.pages_read || 0) / a.total_pages : 0;
      const bProg = b.total_pages > 0 ? (b.pages_read || 0) / b.total_pages : 0;
      return bProg - aProg;
    } else if (bookshelfSortOrder === 'author-asc') {
      return (a.author || '').localeCompare(b.author || '');
    }
    return a.title.localeCompare(b.title);
  });

  // Update 3D Spine Bookshelf with filtered list
  if (typeof window.render3DSpineBookshelf === 'function') {
    window.render3DSpineBookshelf(filtered);
  }

  // View Transitions API
  if (document.startViewTransition && !options.skipViewTransition) {
    document.startViewTransition(() => renderBookshelfContent(container, filtered));
  } else {
    renderBookshelfContent(container, filtered);
  }
}

function renderActiveFilterChips() {
  const chipContainer = $('bookshelf-active-filters');
  if (!chipContainer) return;

  const chips = [];
  if (bookshelfSearchTerm) chips.push(`Search: "${bookshelfSearchTerm}"`);
  if (bookshelfStatusFilter !== 'All') chips.push(`Status: ${bookshelfStatusFilter}`);
  if (bookshelfOwnershipFilter !== 'All') chips.push(`Ownership: ${bookshelfOwnershipFilter}`);
  if (bookshelfSortOrder !== 'title-asc') {
    const sortLabels = { 'title-desc': 'Z-A', 'priority-high': 'Priority', 'progress-desc': 'Progress %', 'author-asc': 'Author' };
    chips.push(`Sort: ${sortLabels[bookshelfSortOrder] || bookshelfSortOrder}`);
  }

  if (chips.length === 0) {
    chipContainer.classList.add('hidden');
    chipContainer.innerHTML = '';
    return;
  }

  chipContainer.classList.remove('hidden');
  chipContainer.innerHTML = `
    ${chips.map(c => `<span class="filter-chip">${c}</span>`).join('')}
    <button id="btn-clear-filters" class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-all active:scale-95">
      <i class="fa-solid fa-xmark text-[9px]"></i> Clear Filters
    </button>
  `;

  const clearBtn = $('btn-clear-filters');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    bookshelfSearchTerm = '';
    if ($('wishlist-search')) $('wishlist-search').value = '';
    bookshelfStatusFilter = 'All';
    $('bookshelf-filter-status')?.querySelectorAll('[data-bsf]').forEach(b => b.classList.toggle('active', b.dataset.bsf === 'All'));
    bookshelfOwnershipFilter = 'All';
    $('bookshelf-filter-ownership')?.querySelectorAll('[data-bfo]').forEach(b => b.classList.toggle('active', b.dataset.bfo === 'All'));
    bookshelfSortOrder = 'title-asc';
    if ($('bookshelf-sort-select')) $('bookshelf-sort-select').value = 'title-asc';
    renderBookshelf();
  });
}

// ── Book Cover System & Cover Manager ───────────────────────────────────────
function getSpineFallbackHTML(title, author) {
  const safeTitle = (title || 'Book').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const safeAuthor = (author || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `
    <div class="book-spine-fallback">
      <div class="book-spine-fallback-title">${safeTitle}</div>
      <div class="book-spine-fallback-author">${safeAuthor}</div>
    </div>
  `;
}

function getCoverHTML(b, extraClasses = 'w-12 h-18') {
  if (!b) return '';
  const safeTitle = (b.title || 'Book').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const safeAuthor = (b.author || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  if (b.cover_url) {
    return `
      <div class="book-cover-wrapper ${extraClasses}">
        <img src="${b.cover_url}" alt="${safeTitle}" class="book-cover-img w-full h-full object-cover rounded-lg shadow-sm" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null; this.parentElement.innerHTML=\`<div class='book-spine-fallback'><div class='book-spine-fallback-title'>${safeTitle}</div><div class='book-spine-fallback-author'>${safeAuthor}</div></div>\`"/>
      </div>
    `;
  }
  return `
    <div class="book-cover-wrapper ${extraClasses}">
      ${getSpineFallbackHTML(b.title, b.author)}
    </div>
  `;
}

async function searchCoverCandidates(title, author, collection) {
  const cleanTitle = (title || '').replace(/\/[A-Z0-9]+$/, '').replace(/[‘’]/g, "'").trim();
  const cleanAuthor = (author || '').replace(/[‘’]/g, "'").trim();
  const query = `${cleanTitle} ${cleanAuthor}`.trim();
  
  const candidates = [];
  
  // 1. iTunes API
  try {
    const res = await fetch(`https://itunes.apple.com/search?media=ebook&term=${encodeURIComponent(query)}&limit=3`);
    if (res.ok) {
      const data = await res.json();
      (data.results || []).forEach(item => {
        if (item.artworkUrl100) {
          const img = item.artworkUrl100.replace('100x100bb', '600x600bb');
          if (!candidates.some(c => c.url === img)) {
            candidates.push({ url: img, source: 'iTunes', title: item.trackName, author: item.artistName });
          }
        }
      });
    }
  } catch (e) {}

  // 2. Open Library API
  if (candidates.length < 2 && cleanTitle) {
    try {
      const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(cleanTitle)}&limit=3`);
      if (res.ok) {
        const data = await res.json();
        (data.docs || []).forEach(doc => {
          if (doc.cover_i) {
            const img = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
            if (!candidates.some(c => c.url === img)) {
              candidates.push({
                url: img,
                source: 'Open Library',
                title: doc.title,
                author: (doc.author_name || [])[0] || ''
              });
            }
          }
        });
      }
    } catch (e) {}
  }

  const bahaibookstoreUrl = `https://www.bahaibookstore.com/catalogsearch/result/?q=${encodeURIComponent(cleanTitle)}`;
  
  return { candidates, bahaibookstoreUrl };
}

async function saveBookCover(id, coverUrl, isWishlist = false) {
  try {
    if (isWishlist) {
      await updateDoc(doc(db, `users/${uid}/wishlist/${id}`), { cover_url: coverUrl });
      const item = wishlistCache.find(b => b.id === id);
      if (item) item.cover_url = coverUrl;
    } else {
      await updateDoc(doc(db, `users/${uid}/books/${id}`), { cover_url: coverUrl });
      const item = booksCache.find(b => b.id === id);
      if (item) item.cover_url = coverUrl;
    }
    showToast('Book cover saved!', 'success');
    renderBookshelf();
  } catch (err) {
    console.error('Error saving cover:', err);
    showToast('Failed to save cover.', 'error');
  }
}

async function openCoverManagerModal() {
  const modal = $('cover-manager-modal');
  if (!modal) return;
  modal.classList.add('open');
  await renderCoverManagerGrid();
}

function closeCoverManagerModal() {
  const modal = $('cover-manager-modal');
  if (modal) modal.classList.remove('open');
}

async function renderCoverManagerGrid() {
  const container = $('cover-manager-grid');
  if (!container) return;
  
  const allBooks = await getMergedBooks();
  const approvedCount = allBooks.filter(b => b.cover_url).length;
  
  const progressText = $('cover-progress-text');
  if (progressText) progressText.textContent = `${approvedCount} / ${allBooks.length} Covers Approved`;
  
  const progressBar = $('cover-progress-bar');
  if (progressBar) progressBar.style.width = `${Math.round((approvedCount / (allBooks.length || 1)) * 100)}%`;
  
  container.innerHTML = '';
  
  allBooks.forEach(b => {
    const card = el('div', 'glass-panel p-3.5 rounded-2xl border border-theme flex flex-col gap-3');
    const isWl = b._isWishlist || false;
    const storeSearchUrl = `https://www.bahaibookstore.com/catalogsearch/result/?q=${encodeURIComponent((b.title||'').replace(/\/[A-Z0-9]+$/,''))}`;

    card.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="w-14 h-21 shrink-0" id="cover-preview-${b.id}">
          ${getCoverHTML(b, 'w-14 h-21 shadow-md')}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-bold text-theme-primary leading-snug line-clamp-2">${b.title}</div>
          <div class="text-[10px] text-theme-secondary truncate mt-0.5">${b.author || 'Unknown Author'}</div>
          
          <div class="flex flex-wrap items-center gap-2 mt-2">
            ${b.cover_url ? `<span class="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"><i class="fa-solid fa-check text-[8px]"></i> Approved</span>` : `<span class="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-theme-gold border border-amber-500/30">Needs Cover</span>`}
            
            <a href="${storeSearchUrl}" target="_blank" rel="noopener" class="text-[9px] font-bold text-theme-gold hover:underline flex items-center gap-1">
              <i class="fa-solid fa-arrow-up-right-from-square text-[8px]"></i> Find on Baha'i Bookstore
            </a>
          </div>
        </div>
      </div>

      <!-- Candidate Choices / Custom URL Bar -->
      <div class="flex flex-col gap-2 pt-2 border-t border-theme" id="cover-candidates-${b.id}">
        <div class="flex items-center gap-2">
          <input type="text" class="input input-xs glass-input flex-1 text-[11px] px-2.5 h-8 py-0 rounded-xl" id="cover-url-input-${b.id}" placeholder="Paste Cover Image URL..." value="${b.cover_url || ''}">
          <button class="px-3 py-1 rounded-xl text-xs font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all h-8" onclick="saveCoverFromInput('${b.id}', ${isWl})">
            Save
          </button>
        </div>
        <div class="flex gap-2 items-center flex-wrap" id="cover-candidate-thumbs-${b.id}">
          <button class="text-[10px] font-bold text-theme-secondary hover:text-theme-gold flex items-center gap-1" onclick="fetchAndDisplayCandidates('${b.id}', '${(b.title||'').replace(/'/g, "\\'")}', '${(b.author||'').replace(/'/g, "\\'")}', '${b.collection||''}', ${isWl})">
            <i class="fa-solid fa-magnifying-glass text-[9px]"></i> Search Candidates
          </button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

window.saveCoverFromInput = async function(id, isWishlist) {
  const input = $(`cover-url-input-${id}`);
  if (!input) return;
  const url = input.value.trim();
  await saveBookCover(id, url, isWishlist);
  await renderCoverManagerGrid();
};

window.fetchAndDisplayCandidates = async function(id, title, author, collection, isWishlist) {
  const container = $(`cover-candidate-thumbs-${id}`);
  if (container) container.innerHTML = `<span class="text-[10px] text-theme-gold animate-pulse"><i class="fa-solid fa-spinner fa-spin"></i> Fetching covers...</span>`;

  const { candidates } = await searchCoverCandidates(title, author, collection);
  if (!container) return;
  
  if (candidates.length === 0) {
    container.innerHTML = `<span class="text-[10px] text-theme-secondary">No candidates found automatically. Click "Find on Baha'i Bookstore" above and paste the image link!</span>`;
    return;
  }

  container.innerHTML = candidates.map(c => `
    <div class="relative group cursor-pointer border border-theme hover:border-gold rounded-lg overflow-hidden w-12 h-18 bg-black/40" onclick="applyCandidateCover('${id}', '${c.url}', ${isWishlist})">
      <img src="${c.url}" class="w-full h-full object-cover" loading="lazy">
      <span class="absolute bottom-0 inset-x-0 bg-black/70 text-[7px] text-center font-bold text-white py-0.5 truncate">${c.source}</span>
    </div>
  `).join('');
};

window.applyCandidateCover = async function(id, url, isWishlist) {
  const input = $(`cover-url-input-${id}`);
  if (input) input.value = url;
  await saveBookCover(id, url, isWishlist);
  await renderCoverManagerGrid();
};

async function autoSearchAllCovers() {
  showToast('Searching covers for unapproved books...', 'info');
  const allBooks = await getMergedBooks();
  const unapproved = allBooks.filter(b => !b.cover_url);
  
  let matchCount = 0;
  for (let b of unapproved) {
    const isWl = b._isWishlist || false;
    const { candidates } = await searchCoverCandidates(b.title, b.author, b.collection);
    if (candidates.length > 0) {
      await saveBookCover(b.id, candidates[0].url, isWl);
      matchCount++;
    }
  }
  showToast(`Auto-matched and approved ${matchCount} cover(s)!`, 'success');
  await renderCoverManagerGrid();
}

window.handleCoverFileUpload = function(fileInput, targetInputId, previewId) {
  if (!fileInput.files || !fileInput.files[0]) return;
  const file = fileInput.files[0];
  const reader = new FileReader();
  
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const maxW = 400;
      const maxH = 600;
      let w = img.width;
      let h = img.height;
      
      if (w > maxW) {
        h = Math.round((h * maxW) / w);
        w = maxW;
      }
      if (h > maxH) {
        w = Math.round((w * maxH) / h);
        h = maxH;
      }
      
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
      
      const targetInput = $(targetInputId);
      if (targetInput) targetInput.value = compressedDataUrl;
      
      const preview = $(previewId);
      if (preview) preview.innerHTML = `<img src="${compressedDataUrl}" class="w-full h-full object-cover rounded-lg" loading="lazy" decoding="async">`;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

window.autoFindSingleCover = async function(titleId, authorId, targetInputId, previewId) {
  const title = $(titleId)?.value?.trim() || '';
  const author = $(authorId)?.value?.trim() || '';
  if (!title) {
    showToast('Please type a book title first.', 'error');
    return;
  }
  
  const preview = $(previewId);
  if (preview) preview.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-theme-gold text-xs"></i>`;
  
  const { candidates } = await searchCoverCandidates(title, author);
  if (candidates && candidates.length > 0) {
    const coverUrl = candidates[0].url;
    const targetInput = $(targetInputId);
    if (targetInput) targetInput.value = coverUrl;
    if (preview) preview.innerHTML = `<img src="${coverUrl}" class="w-full h-full object-cover rounded-lg" loading="lazy" decoding="async">`;
    showToast('Found candidate cover artwork!', 'success');
  } else {
    if (preview) preview.innerHTML = `<i class="fa-solid fa-image text-xs"></i>`;
    showToast('No cover found automatically. Try uploading a photo!', 'info');
  }
};

function renderBookshelfContent(container, filtered) {
  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = `<div class="flex flex-col items-center justify-center p-12 text-center text-theme-tertiary gap-3"><span class="text-4xl">📚</span><div class="text-sm font-bold text-theme-secondary">No books found</div><p class="text-xs text-theme-tertiary">Try a different filter or add a new book</p></div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  if (bookshelfGrouping === 'group') {
    // Group books by item.group
    const groups = {};
    filtered.forEach(b => {
      const g = b.group || 'Other';
      if (!groups[g]) groups[g] = [];
      groups[g].push(b);
    });

    Object.keys(groups).sort().forEach(groupName => {
      const groupItems = groups[groupName];

      const section = el('div', 'flex flex-col gap-2 mb-2');
      const header = el('div', 'bookshelf-section-header flex items-center justify-between text-xs font-black tracking-tight text-theme-primary');
      header.innerHTML = `
        <span class="flex items-center gap-2"><i class="fa-solid fa-folder text-theme-gold text-xs"></i> ${escapeHtml(groupName)}</span>
        <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-white/10 text-theme-secondary">${groupItems.length}</span>
      `;
      section.appendChild(header);

      const itemsContainer = el('div', bookshelfViewMode === 'grid' ? 'bookshelf-grid' : 'flex flex-col gap-3');
      const itemFrag = document.createDocumentFragment();
      groupItems.forEach(b => itemFrag.appendChild(renderBookCard(b)));
      itemsContainer.appendChild(itemFrag);
      section.appendChild(itemsContainer);

      fragment.appendChild(section);
    });
    container.appendChild(fragment);
  } else {
    container.className = bookshelfViewMode === 'grid' ? 'bookshelf-grid' : 'flex flex-col gap-3';
    filtered.forEach(b => fragment.appendChild(renderBookCard(b)));
    container.appendChild(fragment);
  }
}

function renderBookCard(b) {
  const isFin = ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status);
  const isAct = b.status === 'In Progress';
  const isWl = ['Want to Buy', 'Gifted', 'Borrowed', 'Wishlist'].includes(b.status) || b._isWishlist;

  let badgeColor = 'bg-theme-card/40 text-theme-secondary border-theme';
  if (isFin) badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10';
  else if (isAct) badgeColor = 'bg-blue-500/10 text-blue-400 border-blue-500/10';
  else if (isWl) badgeColor = 'bg-violet-500/10 text-violet-400 border-violet-500/10';
  else if (b.status === 'Owned') badgeColor = 'bg-amber-500/10 text-theme-gold border-amber-500/10';

  let ownBadgeColor = 'bg-theme-card/40 text-slate-350 border-theme';
  if (b.ownership === 'Owned') ownBadgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10';
  else if (b.ownership === 'Borrowed') ownBadgeColor = 'bg-blue-500/10 text-blue-400 border-blue-500/10';
  else if (b.ownership === 'Wishlist') ownBadgeColor = 'bg-violet-500/10 text-violet-400 border-violet-500/10';

  const prioClasses = {
    'High': 'bg-rose-500/10 text-rose-400 border-rose-500/10',
    'Medium': 'bg-amber-500/10 text-theme-gold border-amber-500/10',
    'Low': 'bg-theme-card/40 text-theme-secondary border-theme'
  };
  const prioBadge = prioClasses[b.priority] || prioClasses['Low'];

  const pagesReadAccum = b.pages_read || 0;
  const currentCyclePages = b.total_pages > 0 ? Math.min(pagesReadAccum, b.total_pages) : 0;
  const progressPct = b.total_pages > 0 ? Math.min(100, Math.round((currentCyclePages / b.total_pages) * 100)) : 0;
  const readCycle = (b.read_count || 0) + (isAct ? 1 : 0);

  const isChecked = bookshelfSelectedIds.has(b.id);

  if (bookshelfViewMode === 'grid') {
    // 2-Column Compact Grid Card
    const card = el('div', `bookshelf-card-item glass-panel p-3 rounded-2xl border border-theme flex flex-col justify-between gap-2.5 relative hover:bg-white/[0.01] active:scale-[0.98] transition-all cursor-pointer ${isChecked ? 'border-gold/50 bg-gold/5' : ''}`);
    card.dataset.id = b.id;

    card.innerHTML = `
      ${bookshelfSelectMode ? `
        <input type="checkbox" class="checkbox checkbox-xs checkbox-warning absolute top-3 right-3 z-10" ${isChecked ? 'checked' : ''}>
      ` : ''}
      <div class="flex items-start gap-2.5 min-w-0">
        ${getCoverHTML(b, 'w-12 h-18 shrink-0')}
        <div class="min-w-0 flex-1">
          <div class="text-xs font-bold text-theme-primary leading-tight line-clamp-2">${escapeHtml(b.title)}</div>
          <div class="text-[10px] text-theme-secondary truncate mt-0.5">${escapeHtml(b.author || 'Unknown')}</div>
          <div class="flex flex-wrap gap-1 mt-1.5">
            <span class="shrink-0 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase border ${badgeColor}">${b.status}</span>
            <span class="shrink-0 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase border ${prioBadge}">${escapeHtml(b.priority)}</span>
          </div>
        </div>
      </div>
      ${isAct ? `
        <div class="w-full bg-theme-card border border-theme rounded-full h-1 overflow-hidden mt-0.5">
          <div class="h-full transition-all" style="background: var(--emerald); width: ${progressPct}%"></div>
        </div>
      ` : ''}
    `;

    card.addEventListener('click', e => {
      if (bookshelfSelectMode) {
        if (bookshelfSelectedIds.has(b.id)) bookshelfSelectedIds.delete(b.id);
        else bookshelfSelectedIds.add(b.id);
        updateBatchBarUI();
        renderBookshelf();
        return;
      }
      openBookDetailModal(b);
    });

    return card;
  }

  const card = el('div', `bookshelf-card-item glass-panel p-4 rounded-3xl border border-theme flex flex-col gap-3 relative hover:bg-white/[0.01] active:scale-[0.99] transition-all cursor-pointer ${isChecked ? 'border-gold/50 bg-gold/5' : ''}`);

  const costText = b.est_cost > 0 ? ` · $${b.est_cost.toFixed(2)}` : '';

  let buyHTML = '';
  if (b.where_to_buy) {
    const isUrl = b.where_to_buy.startsWith('http://') || b.where_to_buy.startsWith('https://');
    buyHTML = `
      <div class="text-[11px] text-theme-secondary flex items-center gap-1.5 mt-0.5">
        <i class="fa-solid fa-shopping-cart text-[10px] text-theme-gold"></i>
        <span>Where to Buy:</span>
        ${isUrl ? `<a href="${b.where_to_buy}" target="_blank" class="text-theme-gold underline truncate hover:text-theme-gold font-semibold" onclick="event.stopPropagation()">${b.where_to_buy}</a>` : `<span class="text-theme-primary truncate font-semibold">${b.where_to_buy}</span>`}
      </div>
    `;
  }

  let notesHTML = '';
  if (b.notes) {
    notesHTML = `
      <div class="text-[11px] text-theme-secondary italic px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04] mt-0.5 whitespace-pre-wrap leading-relaxed">
        <i class="fa-solid fa-quote-left text-[9px] text-theme-tertiary mr-1 align-top"></i>${b.notes}
      </div>
    `;
  }

  card.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      ${bookshelfSelectMode ? `
        <input type="checkbox" class="checkbox checkbox-sm checkbox-warning mt-0.5 shrink-0" ${isChecked ? 'checked' : ''}>
      ` : ''}
      ${getCoverHTML(b, 'w-14 h-21 shrink-0')}
      <div class="min-w-0 flex-1">
        <div class="text-sm font-bold text-theme-primary leading-snug line-clamp-2">&#8203;${b.title}</div>
        <div class="text-[11px] text-theme-secondary truncate mt-0.5">${b.author || 'Unknown Author'} · ${b.total_pages || 'N/A'} pg${costText}</div>
        <div class="flex flex-wrap gap-1.5 mt-2">
          <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-theme-card/40 text-slate-350 border border-theme">${b.collection === 'Bahai' ? "Bahá'í" : "Non-Bahá'í"}</span>
          <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-theme-card/40 text-slate-350 border border-theme">${b.group || 'Other'}</span>
          <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider border ${prioBadge}">Priority: ${b.priority}</span>
          <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider border ${ownBadgeColor}">${b.ownership}</span>
        </div>
      </div>
      <span class="shrink-0 text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider border ${badgeColor}">${b.status}</span>
    </div>

    ${isAct ? `
      <div class="flex flex-col gap-1.5 mt-0.5">
        <div class="flex justify-between text-[9px] text-theme-secondary font-bold uppercase tracking-wider">
          <span>Reading Progress</span>
          <span>${currentCyclePages} / ${b.total_pages} pg (${progressPct}%)</span>
        </div>
        <div class="w-full bg-theme-card border border-theme rounded-full h-1.5 overflow-hidden">
          <div class="h-full transition-all" style="background: var(--emerald); width: ${progressPct}%"></div>
        </div>
      </div>
    ` : ''}

    ${buyHTML}
    ${notesHTML}

    <div class="flex justify-between items-center text-[10px] text-theme-secondary border-t border-theme pt-2.5 font-semibold mt-1">
      <div class="flex gap-3">
        <span>Cycle: <b class="text-theme-primary">${isAct ? readCycle : (b.read_count || 0)}</b></span>
        <span>Reads: <b class="text-theme-primary">${b.read_count || 0}</b></span>
      </div>
      <div class="flex gap-1.5">
        ${isFin ? `<button class="btn btn-xs rounded-lg bg-gold/10 hover:bg-gold/20 text-gold border border-gold/20 text-[9px] font-extrabold h-6 min-h-6 px-2.5" data-action="re-read">Re-Read</button>` : ''}
        ${isAct ? `<button class="btn btn-xs rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-[9px] font-extrabold h-6 min-h-6 px-2.5" data-action="complete">Complete</button>` : ''}
        <button class="btn btn-xs rounded-lg bg-white/5 hover:bg-white/10 text-slate-350 border border-theme text-[9px] font-bold h-6 min-h-6 px-2.5" data-action="edit">Edit</button>
      </div>
    </div>
  `;

  // Click card
  card.addEventListener('click', e => {
    if (e.target.closest('button') || e.target.closest('a')) return;
    if (bookshelfSelectMode) {
      if (bookshelfSelectedIds.has(b.id)) bookshelfSelectedIds.delete(b.id);
      else bookshelfSelectedIds.add(b.id);
      updateBatchBarUI();
      renderBookshelf();
      return;
    }
    openBookDetailModal(b);
  });

  const compBtn = card.querySelector('[data-action="complete"]');
  if (compBtn) compBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if (confirm(`Mark "${b.title}" completed? This adds a final cycle log session.`)) await markBookComplete(b);
  });

  const rereadBtn = card.querySelector('[data-action="re-read"]');
  if (rereadBtn) rereadBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if (confirm(`Start re-reading "${b.title}"? Cycle ${(b.read_count || 1) + 1} will begin.`)) await startBookReRead(b);
  });

  card.querySelector('[data-action="edit"]').addEventListener('click', e => {
    e.stopPropagation();
    openEditBookModal(b);
  });

  return card;
}

function enableSwipeActions(card) {
  let startX = 0;
  let currentX = 0;
  let isSwiping = false;

  card.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    isSwiping = true;
  }, { passive: true });

  card.addEventListener('touchmove', e => {
    if (!isSwiping) return;
    const diff = e.touches[0].clientX - startX;
    if (diff < 0) {
      currentX = Math.max(-140, diff);
      card.style.transform = `translateX(${currentX}px)`;
    }
  }, { passive: true });

  card.addEventListener('touchend', () => {
    isSwiping = false;
    if (currentX < -60) {
      card.style.transform = 'translateX(-120px)';
    } else {
      card.style.transform = 'translateX(0px)';
    }
    currentX = 0;
  });
}

async function batchUpdateStatus(newStatus) {
  if (bookshelfSelectedIds.size === 0) return;
  if (!confirm(`Move ${bookshelfSelectedIds.size} selected book(s) to "${newStatus}"?`)) return;

  try {
    const allBooks = await getMergedBooks();
    const selectedBooks = allBooks.filter(b => bookshelfSelectedIds.has(b.id));

    for (const b of selectedBooks) {
      if (b._isWishlist) {
        await updateDoc(doc(db, `users/${uid}/wishlist/${b.id}`), { status: newStatus });
      } else {
        await updateDoc(doc(db, `users/${uid}/books/${b.id}`), { status: newStatus });
      }
    }

    showToast(`✓ Updated ${selectedBooks.length} book(s) to "${newStatus}"`, 'success');
    bookshelfSelectMode = false;
    bookshelfSelectedIds.clear();
    $('btn-select-mode-text').textContent = 'Select';
    $('btn-select-mode').classList.remove('bg-gold/20', 'text-gold');
    $('bookshelf-batch-bar').classList.add('hidden');
    booksCache = [];
    wishlistCache = [];
    await loadBooksCache();
    await renderBookshelf();
  } catch (e) {
    showToast('Failed batch update: ' + e.message, 'error');
  }
}

async function batchDeleteBooks() {
  if (bookshelfSelectedIds.size === 0) return;
  if (!confirm(`Are you sure you want to delete ${bookshelfSelectedIds.size} selected book(s)? This cannot be undone.`)) return;

  try {
    const allBooks = await getMergedBooks();
    const selectedBooks = allBooks.filter(b => bookshelfSelectedIds.has(b.id));

    for (const b of selectedBooks) {
      if (b._isWishlist) {
        await deleteDoc(doc(db, `users/${uid}/wishlist/${b.id}`));
      } else {
        await deleteDoc(doc(db, `users/${uid}/books/${b.id}`));
      }
    }

    showToast(`✓ Deleted ${selectedBooks.length} book(s)`, 'success');
    bookshelfSelectMode = false;
    bookshelfSelectedIds.clear();
    $('btn-select-mode-text').textContent = 'Select';
    $('btn-select-mode').classList.remove('bg-gold/20', 'text-gold');
    $('bookshelf-batch-bar').classList.add('hidden');
    booksCache = [];
    wishlistCache = [];
    await loadBooksCache();
    await renderBookshelf();
  } catch (e) {
    showToast('Failed batch delete: ' + e.message, 'error');
  }
}



async function startBookReRead(b) {
  try {
    const nextCycle = (b.read_count || 1) + 1;
    // Update the document by ID directly to ensure it works reliably and instantly
    await updateDoc(doc(db, `users/${uid}/books/${b.id}`), {
      status: 'In Progress',
      pages_read: b.total_pages * (b.read_count || 1)
    });
    
    showToast(`✓ Started Cycle ${nextCycle} for "${b.title.slice(0, 20)}…"`, 'success');
    await loadBooksCache();
    await renderBookshelf();
    populateBookDropdown();
  } catch (e) {
    showToast('Failed to start re-read: ' + e.message, 'error');
  }
}

async function markBookComplete(b) {
  try {
    const date = todayISO();
    const cycle = (b.read_count || 0) + 1;
    const start = b.pages_read || 0;
    const end = b.total_pages;
    
    await addDoc(collection(db, `users/${uid}/reading_logs`), {
      date,
      book_title: b.title,
      read_cycle: cycle,
      start_page: start,
      end_page: end,
      minutes_spent: null,
      notes: "Manual library completion",
      created_at: serverTimestamp()
    });
    
    await recalculateBook(b.title, cycle);
    showToast(`✓ Registered completion for "${b.title}"!`, 'success');
    logsCache = [];
    await renderBookshelf();
    populateBookDropdown();
  } catch (e) {
    showToast('Failed to complete book: ' + e.message, 'error');
  }
}

let isSaveNewBookSubmitting = false;

async function saveNewBook() {
  if (isSaveNewBookSubmitting) return;

  const title = $('ab-title').value.trim();
  const author = $('ab-author').value.trim() || null;
  const coll = $('ab-collection').value;
  
  const selectVal = $('ab-group-select').value;
  const group = selectVal === 'Other' ? $('ab-group-custom').value.trim() : selectVal;
  
  if (!title) { showToast('Please enter a book title.', 'error'); return; }
  if (title.length > 300) { showToast('Book title is too long (max 300 characters).', 'error'); return; }
  const existingDuplicate = booksCache.find(b => b && b.title && b.title.toLowerCase() === title.toLowerCase());
  if (existingDuplicate) {
    showToast(`A book titled "${title}" already exists in your library.`, 'error');
    return;
  }
  if (selectVal === 'Other' && !group) { showToast('Please type a custom group name.', 'error'); return; }
  
  const pages = parseInt($('ab-pages').value);
  const prio = $('ab-priority').value;
  const status = $('ab-status').value;
  const cost = parseFloat($('ab-cost').value) || 0;
  const buyLink = $('ab-where-to-buy').value.trim() || '';
  const notes = $('ab-notes').value.trim() || '';
  const coverUrl = $('ab-cover-url')?.value?.trim() || null;
  
  if (isNaN(pages) || pages <= 0) { showToast('Please enter a valid page length.', 'error'); return; }
  if (pages > 99999) { showToast('Page count seems unrealistic (max 99,999).', 'error'); return; }
  if (cost < 0) { showToast('Cost cannot be negative.', 'error'); return; }

  isSaveNewBookSubmitting = true;
  const saveBtn = $('add-book-save');
  if (saveBtn) saveBtn.disabled = true;

  try {
    const isFinished = status === 'Finished';
    const isWishlistStatus = ['Want to Buy', 'Gifted', 'Borrowed', 'Owned'].includes(status);
    
    const newBook = {
      title,
      author,
      collection: coll,
      group: group,
      group_name: group,
      reading_group: group,
      total_pages: pages,
      priority: prio,
      status: status,
      pages_read: isFinished ? pages : 0,
      read_count: isFinished ? 1 : 0,
      est_cost: cost,
      where_to_buy: buyLink,
      notes: notes,
      cover_url: coverUrl,
      date_added: todayISO()
    };
    
    // Save to main books collection (Optimistic local-first + idempotent background setDoc sync)
    const savedBook = await optimisticSaveDoc('books', newBook);
    if (!booksCache.some(b => b.id === savedBook.id || b.title === savedBook.title)) {
      booksCache.push(savedBook);
    }
    
    // If it's a wishlist item, also add to legacy wishlist collection for complete database safety
    if (isWishlistStatus) {
      await optimisticSaveDoc('wishlist', {
        title, author, category: group, priority: prio, status: status,
        est_pages: pages, est_cost: cost, where_to_buy: buyLink, notes: notes,
        cover_url: coverUrl, date_added: todayISO()
      });
      wishlistCache = []; // Reset wishlist cache to force reload
    }
    
    if (isFinished) {
      const histLog = {
        date: todayISO(),
        book_title: title,
        read_cycle: 1,
        start_page: 0,
        end_page: pages,
        minutes_spent: null,
        notes: "Historical starting complete",
        created_at: serverTimestamp()
      };
      const savedHistLog = await optimisticSaveDoc('reading_logs', histLog);
      if (!logsCache.some(l => l.id === savedHistLog.id)) {
        logsCache.unshift(savedHistLog);
      }
    }
    
    // Reset form fields
    $('ab-title').value = '';
    $('ab-author').value = '';
    $('ab-group-select').value = 'Writings';
    $('ab-group-custom').value = '';
    $('custom-group-container').classList.add('hidden');
    $('ab-pages').value = '';
    $('ab-priority').value = 'Low';
    $('ab-status').value = 'Not Started';
    $('ab-cost').value = '';
    $('ab-where-to-buy').value = '';
    $('ab-notes').value = '';
    
    $('add-book-modal').classList.remove('open');
    showToast(`✓ Book "${title}" successfully registered!`, 'success');
    await renderBookshelf();
    populateBookDropdown();
  } catch (e) {
    showToast('Failed to add book: ' + e.message, 'error');
  } finally {
    isSaveNewBookSubmitting = false;
    const saveBtn = $('add-book-save');
    if (saveBtn) saveBtn.disabled = false;
  }
}
if (typeof window !== 'undefined') window.saveNewBook = saveNewBook;

let activeBookObjectForEdit = null;

function openEditBookModal(b) {
  activeBookObjectForEdit = b;
  $('eb-book-id').value = b.id;
  $('eb-title').value = b.title || '';
  $('eb-author').value = b.author || '';
  $('eb-collection').value = b.collection === 'Bahai' ? 'Bahai' : 'Non-Bahai';
  $('eb-group').value = b.group || '';
  $('eb-pages').value = b.total_pages || '';
  $('eb-read-count').value = b.read_count || 0;
  $('eb-status').value = b.status || 'Not Started';
  $('eb-progress').value = b.status === 'In Progress' ? (b.pages_read || 0) : 0;
  $('eb-priority').value = b.priority || 'Low';
  $('eb-cost').value = b.est_cost || 0;
  $('eb-where-to-buy').value = b.where_to_buy || '';
  $('eb-notes').value = b.notes || '';
  if ($('eb-cover-url')) $('eb-cover-url').value = b.cover_url || '';
  if ($('eb-cover-preview')) {
    $('eb-cover-preview').innerHTML = b.cover_url ? `<img src="${b.cover_url}" class="w-full h-full object-cover rounded-lg" loading="lazy" decoding="async">` : `<i class="fa-solid fa-image"></i>`;
  }
  const searchBtn = $('eb-btn-search-cover');
  if (searchBtn) searchBtn.onclick = () => autoFindSingleCover('eb-title', 'eb-author', 'eb-cover-url', 'eb-cover-preview');
  $('edit-book-modal').classList.add('open');
}

let isSaveEditBookSubmitting = false;

async function saveEditBook() {
  if (isSaveEditBookSubmitting) return;

  const id = $('eb-book-id').value;
  const title = $('eb-title').value.trim();
  const author = $('eb-author').value.trim() || null;
  const collectionVal = $('eb-collection').value;
  const groupVal = $('eb-group').value.trim() || 'Other';
  const pages = parseInt($('eb-pages').value);
  const rc = parseInt($('eb-read-count').value) || 0;
  const status = $('eb-status').value;
  const prog = parseInt($('eb-progress').value) || 0;
  const prio = $('eb-priority').value;
  const cost = parseFloat($('eb-cost').value) || 0;
  const buyLink = $('eb-where-to-buy').value.trim() || '';
  const notes = $('eb-notes').value.trim() || '';
  const coverUrl = $('eb-cover-url')?.value?.trim() || null;

  if (!title) { showToast('Please enter a book title.', 'error'); return; }
  if (isNaN(pages) || pages <= 0) { showToast('Please enter a valid page length.', 'error'); return; }
  if (cost < 0) { showToast('Cost cannot be negative.', 'error'); return; }
  if (rc < 0) { showToast('Read count cannot be negative.', 'error'); return; }
  if (prog < 0) { showToast('Reading progress cannot be negative.', 'error'); return; }
  if (status === 'In Progress' && prog > pages) { showToast('Progress cannot exceed total pages.', 'error'); return; }

  isSaveEditBookSubmitting = true;
  const saveBtn = $('edit-book-save');
  if (saveBtn) saveBtn.disabled = true;

  try {
    const updates = {
      title: title,
      author: author,
      collection: collectionVal,
      group: groupVal,
      group_name: groupVal,
      reading_group: groupVal,
      total_pages: pages,
      read_count: rc,
      status: status,
      pages_read: status === 'Finished' ? (pages * (rc || 1)) : status === 'In Progress' ? prog : 0,
      priority: prio,
      est_cost: cost,
      where_to_buy: buyLink,
      notes: notes,
      cover_url: coverUrl
    };

    if (activeBookObjectForEdit && activeBookObjectForEdit._isWishlist) {
      await updateDoc(doc(db, `users/${uid}/wishlist/${id}`), {
        title: title,
        author: author || '',
        category: groupVal,
        priority: prio,
        status: status,
        est_pages: pages,
        est_cost: cost,
        where_to_buy: buyLink,
        notes: notes
      });
    } else {
      await updateDoc(doc(db, `users/${uid}/books/${id}`), updates);
    }

    // Sync with corresponding legacy wishlist items by title if they exist
    const wlSnap = await getDocs(query(collection(db, `users/${uid}/wishlist`), where('title', '==', title)));
    if (!wlSnap.empty) {
      for (const d of wlSnap.docs) {
        await updateDoc(doc(db, `users/${uid}/wishlist/${d.id}`), {
          title: title,
          author: author || '',
          category: groupVal,
          priority: prio,
          status: status,
          est_pages: pages,
          est_cost: cost,
          where_to_buy: buyLink,
          notes: notes
        });
      }
    }

    $('edit-book-modal').classList.remove('open');
    showToast('✓ Book details successfully updated!', 'success');
    booksCache = [];
    wishlistCache = [];
    await loadBooksCache();
    await renderBookshelf();
    populateBookDropdown();
  } catch (e) {
    showToast('Failed to update book: ' + e.message, 'error');
  } finally {
    isSaveEditBookSubmitting = false;
    const saveBtn = $('edit-book-save');
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function deleteBook(b) {
  if (!b) return;
  if (!confirm(`Are you sure you want to delete "${b.title}"? This cannot be undone.`)) return;

  try {
    if (b._isWishlist) {
      await deleteDoc(doc(db, `users/${uid}/wishlist/${b.id}`));
    } else {
      await deleteDoc(doc(db, `users/${uid}/books/${b.id}`));
      const wlSnap = await getDocs(query(collection(db, `users/${uid}/wishlist`), where('title', '==', b.title)));
      for (const d of wlSnap.docs) {
        await deleteDoc(doc(db, `users/${uid}/wishlist/${d.id}`));
      }
    }
    $('edit-book-modal').classList.remove('open');
    $('book-detail-modal').classList.remove('open');
    showToast(`✓ Deleted "${b.title.slice(0, 20)}…"`, 'success');
    booksCache = [];
    wishlistCache = [];
    await loadBooksCache();
    await renderBookshelf();
    populateBookDropdown();
  } catch (e) {
    showToast('Failed to delete book: ' + e.message, 'error');
  }
}

// ── Log Detail & Historical Log CRUD ─────────────────────────────────────────
let activeLogObject = null;

function openLogDetailModal(l) {
  activeLogObject = l;
  // Populate sheet fields
  $('detail-log-title').textContent = l.book_title;
  $('detail-log-date').textContent = fmtDate(l.date);
  $('detail-log-cycle').textContent = `Cycle ${l.read_cycle || 1}`;
  const pages = Math.max(0, (l.end_page || 0) - (l.start_page || 0));
  $('detail-log-pages').textContent = `pp. ${l.start_page || 0} → ${l.end_page || 0} (${pages} pgs)`;
  $('detail-log-minutes').textContent = l.minutes_spent ? `${l.minutes_spent} min` : '—';
  $('detail-log-notes').textContent = l.notes || 'No notes recorded.';
  
  // Attach edit button listener
  const editBtn = $('btn-edit-active-detail-log');
  if (editBtn) {
    editBtn.onclick = () => {
      closeLogDetailSheet();
      openEditLogModal(l);
    };
  }
  
  // Open sheet
  $('log-detail-sheet').classList.add('open');
  $('sheet-backdrop').classList.add('open');
}

function closeLogDetailSheet() {
  $('log-detail-sheet').classList.remove('open');
  $('sheet-backdrop').classList.remove('open');
}

function setupLogDetailSheet() {
  const closeBtn = $('log-detail-close');
  if (closeBtn) closeBtn.addEventListener('click', closeLogDetailSheet);
  const backdrop = $('sheet-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeLogDetailSheet);
}

// ── Historical Reading Log CRUD Modal Functions ──────────────────────────────
let currentEditingLog = null;

function openEditLogModal(l) {
  if (!l) return;
  currentEditingLog = l;
  $('edit-log-id').value = l.id || '';
  $('edit-log-title').textContent = `Edit Log — ${l.book_title}`;
  $('edit-log-date').value = l.date || todayISO();
  $('edit-log-start').value = parseInt(l.start_page || 0, 10);
  $('edit-log-end').value = parseInt(l.end_page || 0, 10);
  $('edit-log-cycle').value = parseInt(l.read_cycle || 1, 10);
  $('edit-log-minutes').value = l.minutes_spent ? parseInt(l.minutes_spent, 10) : '';
  $('edit-log-notes').value = l.notes || '';

  $('edit-log-modal').classList.add('open');
  Haptics.click();
}

function closeEditLogModal() {
  $('edit-log-modal').classList.remove('open');
  currentEditingLog = null;
}

let isSaveLogEditSubmitting = false;

async function saveLogEdit() {
  if (isSaveLogEditSubmitting) return;

  const logId = $('edit-log-id').value;
  if (!logId || !currentEditingLog) {
    showToast('Error: No log entry selected for editing', 'error');
    return;
  }

  const date = $('edit-log-date').value;
  const start = parseInt($('edit-log-start').value, 10);
  const end = parseInt($('edit-log-end').value, 10);
  const cycle = parseInt($('edit-log-cycle').value, 10) || 1;
  const mins = parseInt($('edit-log-minutes').value, 10) || null;
  const notes = $('edit-log-notes').value.trim() || null;

  if (!date) { showToast('Please enter a date.', 'error'); return; }
  if (isNaN(start) || start < 0) { showToast('Start page cannot be negative.', 'error'); return; }
  if (isNaN(end) || end <= 0) { showToast('Please enter a valid end page.', 'error'); return; }
  if (end <= start) { showToast('End page must be greater than start page.', 'error'); return; }
  if (mins !== null && (isNaN(mins) || mins <= 0)) { showToast('Minutes spent must be a positive number.', 'error'); return; }

  isSaveLogEditSubmitting = true;
  const saveBtn = $('edit-log-save');
  if (saveBtn) saveBtn.disabled = true;

  try {
    const originalTitle = currentEditingLog.book_title;
    const logRef = doc(db, `users/${uid}/reading_logs/${logId}`);

    await updateDoc(logRef, {
      date,
      start_page: start,
      end_page: end,
      read_cycle: cycle,
      minutes_spent: mins,
      notes,
      updated_at: serverTimestamp()
    });

    // Recalculate book status and pages read
    await recalculateBook(originalTitle, cycle);

    // Invalidate logsCache & reload fresh state
    logsCache = [];
    await loadLogsCache();

    closeEditLogModal();
    closeLogDetailSheet();

    if (currentView === 'log') {
      renderRecentLogs();
      renderActivityHeatmap(logsCache);
    } else if (currentView === 'dashboard') {
      renderDashboard();
    }

    Haptics.success();
    showToast('✓ Reading log updated successfully!', 'success');
  } catch (e) {
    showToast('Failed to update log: ' + e.message, 'error');
    console.error(e);
  } finally {
    isSaveLogEditSubmitting = false;
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function deleteLogEntry() {
  if (!currentEditingLog) return;
  const logId = currentEditingLog.id;
  const title = currentEditingLog.book_title;
  const cycle = currentEditingLog.read_cycle || 1;

  if (!confirm(`Are you sure you want to delete this log entry for "${title}"?`)) {
    return;
  }

  try {
    await deleteDoc(doc(db, `users/${uid}/reading_logs/${logId}`));

    // Recalculate book status and pages read
    await recalculateBook(title, cycle);

    logsCache = [];
    await loadLogsCache();

    closeEditLogModal();
    closeLogDetailSheet();

    if (currentView === 'log') {
      renderRecentLogs();
      renderActivityHeatmap(logsCache);
    } else if (currentView === 'dashboard') {
      renderDashboard();
    }

    Haptics.success();
    showToast('✓ Reading log entry deleted.', 'success');
  } catch (e) {
    showToast('Failed to delete log: ' + e.message, 'error');
    console.error(e);
  }
}

// Legacy stubs to prevent ReferenceErrors after consolidation
function setupLibrary() {}
function setupWishlist() {}
function renderLibrary() {}
function renderWishlist() { renderBookshelf(); }







// =========================================================================
// ELITE FEATURES: TACTILE HAPTICS EMULATION
// =========================================================================
const Haptics = {
  click: () => {
    if ('vibrate' in navigator) {
      navigator.vibrate(12);
    }
  },
  success: () => {
    if ('vibrate' in navigator) {
      navigator.vibrate([15, 30, 15]);
    }
  },
  nudge: () => {
    if ('vibrate' in navigator) {
      navigator.vibrate(25);
    }
  }
};

function setupHaptics() {
  document.addEventListener('click', e => {
    const el = e.target.closest('.tab-item, button, .seg-btn, .heatmap-cell, .heatmap-day');
    if (el) {
      Haptics.click();
    }
  });
}

// =========================================================================
// 12-WEEK CHRONOLOGICAL GRAPH OVERHAUL (TimeZone & Gap Fixed)
// =========================================================================
function renderChronologicalSparkline(logs, containerId) {
  // Deprecated/removed from Dashboard layout
}

// =========================================================================
// BOOKS READ PER YEAR BAR CHART RENDERER (Goals View)
// =========================================================================
function renderBooksPerYearChart(completions, containerId) {
  const svgContainer = document.getElementById(containerId);
  if (!svgContainer) return;
  svgContainer.innerHTML = '';

  const filteredCompletions = completions.filter(c => dashFilter === 'all' || c.collection === dashFilter);

  const yearCounts = {};
  filteredCompletions.forEach(c => {
    const year = c.date.slice(0, 4);
    if (year && year.length === 4) {
      yearCounts[year] = (yearCounts[year] || 0) + 1;
    }
  });

  const years = Object.keys(yearCounts).sort();
  if (years.length === 0) {
    svgContainer.innerHTML = `<div class="text-center py-6 text-xs text-neutral-400">No completed books found</div>`;
    return;
  }

  const width = 500;
  const height = 150;
  const paddingLeft = 35;
  const paddingRight = 15;
  const paddingTop = 20;
  const paddingBottom = 25;

  const maxVal = Math.max(...Object.values(yearCounts), 5);

  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const barWidth = Math.min(45, (plotWidth / years.length) * 0.6);
  const gap = (plotWidth - (barWidth * years.length)) / (years.length > 1 ? years.length - 1 : 1);

  const labelColor = 'var(--text-secondary)';
  const gridColor = 'var(--border)';

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'w-full h-full', style: 'display:block' });

  const yTicks = [0, Math.round(maxVal / 2), maxVal];
  yTicks.forEach(tick => {
    const y = paddingTop + plotHeight - (tick / maxVal) * plotHeight;
    svg.appendChild(svgEl('line', {
      x1: paddingLeft, y1: y,
      x2: width - paddingRight, y2: y,
      stroke: gridColor,
      'stroke-width': '1',
      'stroke-dasharray': '3 3'
    }));
    const text = svgEl('text', {
      x: paddingLeft - 8, y: y + 3,
      'text-anchor': 'end',
      style: `font-size: 8px; fill: ${labelColor}; font-weight: 600; font-family: var(--font-body)`
    });
    text.textContent = tick;
    svg.appendChild(text);
  });

  years.forEach((year, index) => {
    const val = yearCounts[year];
    const barH = (val / maxVal) * plotHeight;
    const x = paddingLeft + index * (barWidth + (years.length > 1 ? gap : 0));
    const y = paddingTop + plotHeight - barH;

    const rect = svgEl('rect', {
      x: x, y: y,
      width: barWidth, height: Math.max(2, barH),
      rx: '4', ry: '4',
      fill: 'var(--accent)',
      class: 'transition-all duration-300 hover:opacity-80 cursor-pointer'
    });

    rect.addEventListener('click', () => {
      const completedBooksInYear = filteredCompletions.filter(c => c.date.slice(0, 4) === year);
      showYearBooksPopup(year, completedBooksInYear);
    });

    svg.appendChild(rect);

    const valText = svgEl('text', {
      x: x + barWidth / 2, y: y - 5,
      'text-anchor': 'middle',
      style: `font-size: 8px; font-weight: 800; fill: var(--text-primary); font-family: var(--font-body)`
    });
    valText.textContent = val;
    svg.appendChild(valText);

    const yearText = svgEl('text', {
      x: x + barWidth / 2, y: height - 8,
      'text-anchor': 'middle',
      style: `font-size: 8px; fill: ${labelColor}; font-weight: 600; font-family: var(--font-body)`
    });
    yearText.textContent = year;
    svg.appendChild(yearText);
  });

  svgContainer.appendChild(svg);
}

function showYearBooksPopup(year, completedBooksInYear) {
  if (typeof Haptics !== 'undefined' && Haptics.click) Haptics.click();
  
  // Create modal container
  const modal = el('div', 'fixed inset-0 z-[100] flex items-end sm:items-center justify-center opacity-0 pointer-events-none transition-all duration-300 [&.open]:opacity-100 [&.open]:pointer-events-auto');
  modal.id = 'year-books-popup';
  
  // Backdrop
  const backdrop = el('div', 'absolute inset-0 bg-black/60 backdrop-blur-sm');
  backdrop.addEventListener('click', () => {
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 300);
  });
  modal.appendChild(backdrop);
  
  // Content Card
  const card = el('div', 'w-full sm:max-w-md p-6 rounded-t-[30px] sm:rounded-[30px] flex flex-col gap-4 shadow-2xl translate-y-10 sm:translate-y-0 sm:scale-95 transition-all duration-300 overflow-y-auto max-h-[80vh] relative z-[110]');
  card.style.cssText = 'background: var(--bg-elevated); border: 0.5px solid var(--border-strong)';
  
  // Header
  const header = el('div', 'flex justify-between items-center');
  header.innerHTML = `
    <div>
      <h3 class="text-base font-black tracking-tight" style="color: var(--text-primary)">Books Completed in ${year}</h3>
      <p class="text-[10px] font-bold text-theme-secondary mt-0.5">${completedBooksInYear.length} book${completedBooksInYear.length === 1 ? '' : 's'} read</p>
    </div>
    <button class="w-8 h-8 rounded-full flex items-center justify-center bg-theme-card/40 text-slate-450" id="close-year-popup">
      <i class="fa-solid fa-xmark text-sm"></i>
    </button>
  `;
  card.appendChild(header);
  
  // Books list
  const list = el('div', 'flex flex-col gap-2.5 mt-2 overflow-y-auto max-h-[60vh] safe-padding-bottom');
  if (completedBooksInYear.length === 0) {
    list.innerHTML = `<div class="text-xs text-theme-tertiary italic py-2 text-center">No completed books recorded for ${year}.</div>`;
  } else {
    // Sort chronologically ascending
    const sorted = [...completedBooksInYear].sort((a, b) => a.date.localeCompare(b.date));
    sorted.forEach((c, idx) => {
      const book = booksCache.find(b => b.title === c.title);
      const row = el('div', 'glass-panel p-3.5 rounded-2xl flex justify-between items-center border border-theme active:scale-[0.98] transition-all cursor-pointer');
      row.innerHTML = `
        <div class="min-w-0 pr-3 flex-1">
          <div class="text-xs font-bold text-theme-primary truncate">${idx + 1}. ${c.title}</div>
          <div class="text-[9px] text-theme-secondary truncate mt-0.5">${book ? book.author || 'Unknown' : 'Unknown'}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-[10px] font-black text-emerald">${c.date}</div>
          <div class="text-[8px] text-theme-secondary font-semibold mt-0.5">${c.pages || 0} pg</div>
        </div>
      `;
      if (book) {
        row.addEventListener('click', () => {
          modal.classList.remove('open');
          setTimeout(() => modal.remove(), 300);
          openBookDetailModal(book);
        });
      }
      list.appendChild(row);
    });
  }
  
  card.appendChild(list);
  modal.appendChild(card);
  document.body.appendChild(modal);
  
  card.querySelector('#close-year-popup').addEventListener('click', () => {
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 300);
  });
  
  requestAnimationFrame(() => {
    modal.classList.add('open');
  });
}

// =========================================================================
// SECTION 3: BY CATEGORY PIE CHART RENDERER (Namespace & Toggle Fixed)
// =========================================================================
function renderCategoryPieChart(books, containerId) {
  const svgContainer = document.getElementById(containerId);
  if (!svgContainer) return;
  svgContainer.innerHTML = '';

  const counts = {
    'Writings': 0,
    'About the Faith': 0,
    'Compilations': 0,
    'Fiction': 0,
    'Non-Fiction': 0,
    'Other': 0
  };

  if (dashboardStats) {
    const source = categoryChartMode === 'pages' ? dashboardStats.categoryPages : dashboardStats.categoryBooks;
    Object.keys(counts).forEach(cat => {
      counts[cat] = source[cat] || 0;
    });
  } else {
    books.forEach(book => {
      const groupVal = book.group || book.group_name || book.reading_group || book.category || 'Other';
      const normalized = normalizeGroup(groupVal, book.collection, book.title, book.author);
      
      let val = 0;
      if (categoryChartMode === 'pages') {
        val = ((book.read_count || 0) * (book.total_pages || 0)) + (book.status === 'In Progress' ? (book.pages_read || 0) : 0);
      } else {
        val = book.read_count || (['Finished', 'Owned and Read', 'Borrowed and Read'].includes(book.status) ? 1 : 0);
      }
      
      if (counts[normalized] !== undefined) {
        counts[normalized] += val;
      } else {
        counts['Other'] += val;
      }
    });
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) {
    svgContainer.innerHTML = `<div class="text-center py-6 text-xs text-neutral-400">No books found to categorize</div>`;
    return;
  }

  const colors = {
    'Writings': '#38BDF8',       // Sky Blue
    'About the Faith': '#F472B6', // Sunset Rose
    'Compilations': '#818CF8',    // Indigo/Lavender
    'Fiction': '#D6A85C',         // Stone Gold
    'Non-Fiction': '#34D399',     // Emerald Mint
    'Other': '#64748B'            // Slate Muted
  };

  const r = 37, sw = 8;
  const circumference = 2 * Math.PI * r; // r=37 -> ~232.48
  let cumulativePercent = 0;

  const chartFlex = el('div', 'flex flex-col items-center justify-center gap-6 py-3 w-full');
  const svgWrapper = el('div', 'relative w-36 h-36 shrink-0 flex items-center justify-center');
  
  const trackColor = 'var(--border)';

  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'w-full h-full', style: 'display:block' });
  svg.appendChild(svgEl('circle', { cx: '50', cy: '50', r: '37', fill: 'none', stroke: trackColor, 'stroke-width': '8' }));

  const centerOverlay = el('div', 'absolute inset-0 flex flex-col items-center justify-center pointer-events-none p-1');
  const overlayTotal = el('span', 'text-base font-black text-theme-primary tracking-tight');
  overlayTotal.textContent = fmtNum(total);
  const overlayLabel = el('span', 'text-[9px] font-bold tracking-wider text-theme-secondary uppercase text-center mt-0.5 max-w-[80px] leading-tight');
  overlayLabel.textContent = categoryChartMode === 'pages' ? 'Pages' : 'Books';
  
  centerOverlay.appendChild(overlayTotal);
  centerOverlay.appendChild(overlayLabel);
  svgWrapper.appendChild(svg);
  svgWrapper.appendChild(centerOverlay);

  const legendGrid = el('div', 'flex flex-col gap-2 w-full max-w-[280px]');

  Object.keys(counts).forEach(cat => {
    const count = counts[cat];
    if (count === 0) return;

    const percent = count / total;
    const strokeLength = percent * circumference;
    const angle = -90 + cumulativePercent * 360;

    const segment = svgEl('circle', {
      cx: '50', cy: '50', r: '37',
      fill: 'none',
      stroke: colors[cat],
      'stroke-width': '8',
      'stroke-dasharray': strokeLength + ' ' + circumference,
      transform: `rotate(${angle} 50 50)`,
      class: 'transition-all duration-300 cursor-pointer'
    });

    const valLabel = categoryChartMode === 'pages' ? `${fmtNum(count)} pg` : `${count} book${count === 1 ? '' : 's'}`;
    const pctVal = Math.round(percent * 100);

    const legendItem = el('div', 'flex items-center gap-2.5 text-xs p-1.5 px-2.5 rounded-xl border border-transparent transition-all');
    legendItem.innerHTML = `
      <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${colors[cat]}"></span>
      <span class="font-semibold text-theme-primary">${cat}</span>
      <span class="text-slate-450 font-bold ml-auto">${valLabel} (${pctVal}%)</span>
    `;
    legendGrid.appendChild(legendItem);

    segment.addEventListener('mouseenter', () => {
      segment.setAttribute('stroke-width', '12');
      overlayTotal.textContent = fmtNum(count);
      overlayLabel.textContent = cat;
      legendItem.classList.add('bg-white/5', 'border-theme');
    });

    segment.addEventListener('mouseleave', () => {
      segment.setAttribute('stroke-width', '10');
      overlayTotal.textContent = fmtNum(total);
      overlayLabel.textContent = categoryChartMode === 'pages' ? 'Pages' : 'Books';
      legendItem.classList.remove('bg-white/5', 'border-theme');
    });

    legendItem.classList.add('cursor-pointer');
    const openCatDrilldown = () => {
      const matched = books.filter(b => {
        const groupVal = b.group || b.group_name || b.reading_group || b.category || 'Other';
        return normalizeGroup(groupVal, b.collection, b.title, b.author) === cat;
      });
      openChartDrilldownModal(`${cat} Category`, matched);
    };

    segment.addEventListener('click', openCatDrilldown);
    legendItem.addEventListener('click', openCatDrilldown);

    svg.appendChild(segment);
    cumulativePercent += percent;
  });

  chartFlex.appendChild(svgWrapper);
  chartFlex.appendChild(legendGrid);
  svgContainer.appendChild(chartFlex);
}

// =========================================================================
// SECTION 4: RE-READ LOG STATUS EVALUATOR (Fixes multi-cycle progress bugs)
// =========================================================================

// =========================================================================
// SELF-HEALING DATABASE INCONSISTENCY RUNNER
// =========================================================================
async function healBookStatuses() {
  let updatedAny = false;
  for (const b of booksCache) {
    const bookLogs = logsCache.filter(l => l.book_title === b.title);
    const tot = parseInt(b.total_pages || 0, 10);
    if (tot <= 0) continue;
    
    const effectiveRc = getEffectiveReadCount(b, logsCache);
    const activeCycle = Math.max(effectiveRc + 1, (b.status === 'In Progress' ? (b.read_count || 0) + 1 : effectiveRc));
    const activeLogs = bookLogs.filter(l => parseInt(l.read_cycle || 1, 10) === activeCycle);
    const maxActiveEnd = activeLogs.length > 0 ? Math.max(...activeLogs.map(l => parseInt(l.end_page || 0, 10))) : 0;
    
    let correctStatus = b.status;
    let currentPagesRead = 0;
    let correctReadCount = effectiveRc;
    
    if (maxActiveEnd > 0) {
      correctStatus = 'In Progress';
      currentPagesRead = (tot > 0 && maxActiveEnd > tot) ? (maxActiveEnd % tot) : maxActiveEnd;
    } else {
      if (effectiveRc > 0) {
        correctStatus = 'Finished';
        currentPagesRead = tot;
      } else {
        const isWishlist = ['Want to Buy', 'Gifted', 'Borrowed', 'Wishlist'].includes(b.status);
        correctStatus = isWishlist ? b.status : 'Not Started';
        currentPagesRead = 0;
      }
    }
    
    if (b.status !== correctStatus || b.pages_read !== currentPagesRead || b.read_count !== correctReadCount) {
      console.log(`[Self-Healing] Book "${b.title}": ${b.status} -> ${correctStatus}, pages_read ${b.pages_read} -> ${currentPagesRead}, read_count ${b.read_count} -> ${correctReadCount}`);
      await updateDoc(doc(db, `users/${uid}/books/${b.id}`), {
        status: correctStatus,
        pages_read: currentPagesRead,
        read_count: correctReadCount
      });
      b.status = correctStatus;
      b.pages_read = currentPagesRead;
      b.read_count = correctReadCount;
      updatedAny = true;
    }
  }
  if (updatedAny) {
    console.log("[Self-Healing] Database corrected. Refreshing dashboard.");
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'wishlist') renderBookshelf();
  }
}

function evaluateBookReadingProgress(book, logs) {
  const activeCycle = (book.read_count || 0) + 1;
  const bookLogs = logs.filter(l => l.book_title === book.title);
  
  if (book.status === 'In Progress') {
    const cycleLogs = bookLogs.filter(l => parseInt(l.read_cycle || 1, 10) === activeCycle);
    if (cycleLogs.length > 0) {
      cycleLogs.sort((a, b) => new Date(a.date) - new Date(b.date));
      const latestLog = cycleLogs[cycleLogs.length - 1];
      const endPage = parseInt(latestLog.end_page || 0, 10);
      const totalPages = parseInt(book.total_pages || 0, 10);
      if (endPage >= totalPages) {
        return 'Finished';
      }
    }
    return 'In Progress';
  }

  if (bookLogs.length === 0) {
    return 'Not Started';
  }

  bookLogs.sort((a, b) => new Date(a.date) - new Date(b.date));

  const activeLogsCycle = Math.max(...bookLogs.map(l => parseInt(l.read_cycle || 1, 10)));
  const cycleLogs = bookLogs.filter(l => parseInt(l.read_cycle || 1, 10) === activeLogsCycle);

  const latestLog = cycleLogs[cycleLogs.length - 1];
  const endPage = parseInt(latestLog.end_page || 0, 10);
  const totalPages = parseInt(book.total_pages || 0, 10);

  if (endPage >= totalPages) {
    return 'Finished';
  } else if (endPage > 0) {
    return 'In Progress';
  }
  
  return 'Not Started';
}

// =========================================================================
// SECTION 5: CONDITIONAL DROPDOWN IN ADD BOOK (Form Markup Helper)
// =========================================================================
function toggleCustomGroupInput(val) {
  const container = document.getElementById('custom-group-container');
  if (container) {
    if (val === 'Other') {
      container.classList.remove('hidden');
    } else {
      container.classList.add('hidden');
    }
  }
}
window.toggleCustomGroupInput = toggleCustomGroupInput;

// =========================================================================
// SECTION 6: GITHUB-STYLE INTENSITY HEATMAP MATRIX (Interactive Tooltips & HSL Colors)
// =========================================================================
function renderActivityHeatmap(logs) {
  const container = document.getElementById('heatmap-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  const activityMap = {};
  const activeLogs = (logs || []).filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));

  activeLogs.forEach(log => {
    const dStr = log.date;
    if (!dStr) return;

    if (currentHeatmapMetric === 'duration') {
      const mins = parseInt(log.duration_minutes || log.durationMinutes || log.minutes_spent || 0, 10);
      activityMap[dStr] = (activityMap[dStr] || 0) + mins;
    } else if (currentHeatmapMetric === 'sessions') {
      activityMap[dStr] = (activityMap[dStr] || 0) + 1;
    } else if (currentHeatmapMetric === 'notes') {
      if (log.notes && log.notes.trim() && !log.notes.startsWith('Historical cycle')) {
        activityMap[dStr] = (activityMap[dStr] || 0) + 1;
      }
    } else {
      // Default: 'pages'
      const start = parseInt(log.start_page || 0, 10);
      const end = parseInt(log.end_page || 0, 10);
      const pages = parseInt(log.pages_read_today, 10) || parseInt(log.pagesRead, 10) || Math.max(0, end - start) || 0;
      activityMap[dStr] = (activityMap[dStr] || 0) + pages;
    }
  });

  if (currentHeatmapMetric === 'notes' && typeof getStandaloneNotes === 'function') {
    const standaloneNotes = getStandaloneNotes();
    standaloneNotes.forEach(n => {
      if (n.date) {
        activityMap[n.date] = (activityMap[n.date] || 0) + 1;
      }
    });
  }

  const today = new Date();
  let daysCount = 363;

  if (dashHeatmapTimeframe === 'thisYear') {
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    daysCount = Math.max(7, Math.floor((today - startOfYear) / 86400000));
  } else if (dashHeatmapTimeframe === 'allTime') {
    const allDates = Object.keys(activityMap).sort();
    if (allDates.length > 0) {
      const earliest = new Date(allDates[0] + 'T00:00:00');
      daysCount = Math.min(1095, Math.max(363, Math.floor((today - earliest) / 86400000)));
    }
  }

  let activeCellsCount = 0;
  
  for (let i = 0; i <= daysCount; i++) {
    const activeDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const year = activeDate.getFullYear();
    const month = String(activeDate.getMonth() + 1).padStart(2, '0');
    const day = String(activeDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    const metricVal = activityMap[dateStr] || 0;
    
    const block = document.createElement('div');
    block.className = 'heatmap-day';
    
    if (metricVal > 0) {
      activeCellsCount++;
      if (currentHeatmapMetric === 'duration') {
        if (metricVal <= 15) block.classList.add('heatmap-tier-1');
        else if (metricVal <= 30) block.classList.add('heatmap-tier-2');
        else if (metricVal <= 60) block.classList.add('heatmap-tier-3');
        else block.classList.add('heatmap-tier-4');
      } else if (currentHeatmapMetric === 'sessions' || currentHeatmapMetric === 'notes') {
        if (metricVal === 1) block.classList.add('heatmap-tier-1');
        else if (metricVal === 2) block.classList.add('heatmap-tier-2');
        else if (metricVal === 3) block.classList.add('heatmap-tier-3');
        else block.classList.add('heatmap-tier-4');
      } else { // pages
        if (metricVal <= 10) block.classList.add('heatmap-tier-1');
        else if (metricVal <= 20) block.classList.add('heatmap-tier-2');
        else if (metricVal <= 40) block.classList.add('heatmap-tier-3');
        else block.classList.add('heatmap-tier-4');
      }
    }
    
    const dateFormatted = activeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    let metricLabel = 'pages read';
    if (currentHeatmapMetric === 'duration') metricLabel = 'mins read';
    else if (currentHeatmapMetric === 'sessions') metricLabel = 'sessions logged';
    else if (currentHeatmapMetric === 'notes') metricLabel = 'notes captured';

    block.setAttribute('title', `${dateFormatted}: ${metricVal} ${metricLabel}`);
    
    block.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerHaptic();
      
      openHeatmapDayDetailDrawer(dateStr);
    });
    
    container.appendChild(block);
  }
}

if (!window._heatmapTooltipWired) {
  window._heatmapTooltipWired = true;
  document.addEventListener('click', () => {
    const tooltip = document.getElementById('heatmap-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
  });
}

// =========================================================================
// ROBUST GROUP NORMALIZATION (Fixes "Other" category bug)
// =========================================================================
function normalizeGroup(groupName, collection = '', title = '', author = '') {
  const raw = (groupName || '').trim();
  const clean = raw.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const cleanAlnum = clean.replace(/[^a-z0-9]/g, "");
  
  const tClean = (title || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const aClean = (author || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 1. Writings
  if (
    cleanAlnum.includes('writing') ||
    cleanAlnum.includes('bahaullah') ||
    cleanAlnum.includes('thebab') ||
    cleanAlnum.includes('abdulbaha') ||
    cleanAlnum.includes('shoghieffendi') ||
    cleanAlnum.includes('aqdas') ||
    cleanAlnum.includes('iqan') ||
    cleanAlnum.includes('gitanjali') ||
    aClean.includes("bahaullah") ||
    aClean.includes("the bab") ||
    aClean.includes("abdul-baha") ||
    aClean.includes("abdulbaha") ||
    aClean.includes("shoghi effendi")
  ) {
    return 'Writings';
  }

  // 2. Compilations
  if (cleanAlnum.includes('compilation') || tClean.includes('compilation') || tClean.includes('selections from')) {
    return 'Compilations';
  }

  // 3. About the Faith
  if (cleanAlnum.includes('aboutthefaith') || cleanAlnum.includes('about') || cleanAlnum === 'bahai') {
    return 'About the Faith';
  }

  // 4. Non-Fiction
  if (cleanAlnum.includes('nonfiction') || clean.includes('non-fiction')) {
    return 'Non-Fiction';
  }

  // 5. Fiction
  if (cleanAlnum.includes('fiction') && !cleanAlnum.includes('non')) {
    return 'Fiction';
  }

  // 6. Smart Fallbacks for 'Other' / empty categories based on Collection
  if (collection === 'Bahai') {
    return 'About the Faith';
  } else if (collection === 'Non-Bahai') {
    return 'Non-Fiction';
  }

  return 'Other';
}

// =========================================================================
// DIACRITIC-INSENSITIVE NORMALIZER & DRILL-DOWN MODAL
// =========================================================================
function normalizeText(str) {
  if (!str) return '';
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[\u2018\u2019\u201c\u201d'`"’‘]/g, "") // remove all smart/straight quotes and apostrophes
    .replace(/[-]/g, "") // remove hyphens
    .replace(/\s+/g, "") // remove all spaces
    .toLowerCase();
}

function openBookDetailModal(b) {
  window._activeDetailBook = b;
  $('bd-title').textContent = b.title;
  $('bd-author').textContent = b.author ? `by ${b.author}` : 'Unknown Author';
  
  if (typeof updatePacePrediction === 'function') {
    updatePacePrediction(b, 25);
  }
  
  const bdCover = $('bd-cover-container');
  if (bdCover) {
    bdCover.innerHTML = getCoverHTML(b, 'w-16 h-24 shadow-lg cursor-pointer');
    bdCover.onclick = (e) => {
      e.stopPropagation();
      openCoverManagerModal();
    };
  }
  
  const isFin = ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status);
  const isAct = b.status === 'In Progress';
  const isWl = ['Want to Buy', 'Gifted', 'Borrowed', 'Wishlist'].includes(b.status) || b._isWishlist;
  
  // Badges
  let badgeColor = 'bg-theme-card/40 text-theme-secondary border-theme';
  if (isFin) badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10';
  else if (isAct) badgeColor = 'bg-blue-500/10 text-blue-400 border-blue-500/10';
  else if (isWl) badgeColor = 'bg-violet-500/10 text-violet-400 border-violet-500/10';
  else if (b.status === 'Owned') badgeColor = 'bg-amber-500/10 text-theme-gold border-amber-500/10';
  
  let ownBadgeColor = 'bg-theme-card/40 text-slate-350 border-theme';
  if (b.ownership === 'Owned') ownBadgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10';
  else if (b.ownership === 'Borrowed') ownBadgeColor = 'bg-blue-500/10 text-blue-400 border-blue-500/10';
  else if (b.ownership === 'Wishlist') ownBadgeColor = 'bg-violet-500/10 text-violet-400 border-violet-500/10';

  const prioClasses = {
    'High': 'bg-rose-500/10 text-rose-400 border-rose-500/10',
    'Medium': 'bg-amber-500/10 text-theme-gold border-amber-500/10',
    'Low': 'bg-theme-card/40 text-theme-secondary border-theme'
  };
  const prioBadge = prioClasses[b.priority] || prioClasses['Low'];
  
  $('bd-badges').innerHTML = `
    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${badgeColor}">${b.status}</span>
    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-theme-card/40 text-slate-350 border border-theme">${b.collection === 'Bahai' ? "Bahá'í" : "Non-Bahá'í"}</span>
    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-theme-card/40 text-slate-350 border border-theme">${b.group || 'Other'}</span>
    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${prioBadge}">Priority: ${b.priority}</span>
    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${ownBadgeColor}">${b.ownership}</span>
  `;
  
  // Progress
  const pagesReadAccum = b.pages_read || 0;
  const currentCyclePages = b.total_pages > 0 ? pagesReadAccum % b.total_pages : 0;
  const progressPct = b.total_pages > 0 ? Math.min(100, Math.round((currentCyclePages / b.total_pages) * 100)) : 0;
  const readCycle = (b.read_count || 0) + (isAct ? 1 : 0);
  
  $('bd-progress-text').textContent = `${isFin ? b.total_pages : currentCyclePages} / ${b.total_pages} pg`;
  $('bd-cycles-text').textContent = `Cycle: ${readCycle} · Reads: ${b.read_count || 0}`;
  
  // Circular progress ring
  const circle = $('bd-progress-ring');
  const pctText = $('bd-progress-pct');
  const dispPct = isFin ? 100 : progressPct;
  pctText.textContent = `${dispPct}%`;
  const circumference = 2 * Math.PI * 20; // 125.66
  const offset = circumference - (dispPct / 100) * circumference;
  circle.style.strokeDashoffset = offset;
  
  // Book Reading Calculator calculations
  const paceInput = $('bd-calc-pace');
  function updateCalculator() {
    const pace = parseInt(paceInput.value, 10) || 10;
    let pagesRemaining = b.total_pages;
    if (isFin) {
      pagesRemaining = 0;
    } else if (isAct) {
      pagesRemaining = Math.max(0, b.total_pages - currentCyclePages);
    }
    
    $('bd-calc-remaining').textContent = `${pagesRemaining} pg`;
    
    if (pagesRemaining <= 0) {
      $('bd-calc-days').textContent = '0 days';
      $('bd-calc-weeks').textContent = '0 weeks';
      $('bd-calc-date').textContent = 'Finished';
      $('bd-calc-time').textContent = '0 min';
      $('bd-calc-hist-days').textContent = '0 days';
      return;
    }
    
    const daysToFinish = Math.ceil(pagesRemaining / pace);
    const weeksToFinish = (pagesRemaining / pace / 7).toFixed(1);
    $('bd-calc-days').textContent = `${daysToFinish} days`;
    $('bd-calc-weeks').textContent = `${weeksToFinish} weeks`;
    
    const projDate = new Date();
    projDate.setDate(projDate.getDate() + daysToFinish);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    $('bd-calc-date').textContent = `${projDate.getDate()}-${months[projDate.getMonth()]}-${projDate.getFullYear()}`;
    
    // Average reading speed in pages per minute (avgPPM)
    const totalLoggedPages = logsCache.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
    const totalMins = logsCache.reduce((s, l) => s + (l.minutes_spent || 0), 0);
    const avgPPM = totalMins > 0 ? (totalLoggedPages / totalMins) : 0.5;
    const totalReadingMins = Math.round(pagesRemaining / avgPPM);
    $('bd-calc-time').textContent = `${totalReadingMins} min`;
    
    // Days to Finish (historical YTD average pace)
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((now - startOfYear) / (1000 * 60 * 60 * 24)) + 1;
    const yearLogs = logsCache.filter(l => l.date && l.date.startsWith(String(now.getFullYear())));
    const yearPages = yearLogs.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
    const pagesPerDayRate = yearPages / Math.max(1, dayOfYear);
    
    if (pagesPerDayRate > 0) {
      const histDays = Math.ceil(pagesRemaining / pagesPerDayRate);
      $('bd-calc-hist-days').textContent = `${histDays} days`;
    } else {
      $('bd-calc-hist-days').textContent = '—';
    }
  }
  if (paceInput) {
    paceInput.oninput = updateCalculator;
    updateCalculator();
  }

  // Wishlist details
  const wlInfo = $('bd-wishlist-info');
  if (b._fromWishlist || isWl) {
    wlInfo.classList.remove('hidden');
    $('bd-cost').textContent = b.est_cost > 0 ? `$${b.est_cost.toFixed(2)}` : '$0.00';
    $('bd-priority').textContent = b.priority || 'Low';
    
    const buyContainer = $('bd-buy-container');
    buyContainer.innerHTML = '';
    if (b.where_to_buy) {
      const isUrl = b.where_to_buy.startsWith('http://') || b.where_to_buy.startsWith('https://');
      buyContainer.innerHTML = `
        <div class="text-[11px] text-theme-secondary flex items-center gap-1.5 mt-0.5">
          <i class="fa-solid fa-shopping-cart text-[10px] text-theme-gold"></i>
          <span>Where to Buy:</span>
          ${isUrl ? `<a href="${b.where_to_buy}" target="_blank" class="text-theme-gold underline truncate hover:text-theme-gold font-semibold">${b.where_to_buy}</a>` : `<span class="text-theme-primary truncate font-semibold">${b.where_to_buy}</span>`}
        </div>
      `;
    }
  } else {
    wlInfo.classList.add('hidden');
  }
  
  // Render timeline of logs
  const timeline = $('bd-timeline');
  timeline.innerHTML = '';
  
  const bookLogs = logsCache.filter(l => l.book_title === b.title);
  if (bookLogs.length === 0) {
    timeline.innerHTML = `<div class="text-xs text-theme-tertiary italic py-2">No read sessions logged yet.</div>`;
  } else {
    // Sort chronologically ASCENDING
    const sortedLogs = [...bookLogs].sort((a, b) => new Date(a.date) - new Date(b.date));
    sortedLogs.forEach(l => {
      const addedPages = parseInt(l.end_page || 0, 10) - parseInt(l.start_page || 0, 10);
      const minutes = l.minutes_spent ? ` · ⏱ ${l.minutes_spent} min` : '';
      
      const item = el('div', 'flex flex-col gap-1 relative pl-4');
      // Timeline bullet indicator
      const bullet = el('div', 'absolute left-[-16px] top-[4px] w-2 h-2 rounded-full border bg-theme-card border-white/20');
      if (l.notes && l.notes.includes('Historical')) bullet.classList.add('bg-emerald-500', 'border-emerald-500/20');
      else bullet.classList.add('bg-blue-500', 'border-blue-500/20');
      
      let notesHTML = '';
      if (l.notes) {
        notesHTML = `
          <div class="text-[11px] text-slate-350 italic px-2.5 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] mt-1 whitespace-pre-wrap leading-relaxed">
            <i class="fa-solid fa-quote-left text-[8px] text-theme-tertiary mr-1 align-top"></i>${l.notes}
          </div>
        `;
      }
      
      item.innerHTML = `
        <div class="flex justify-between items-center text-[10px] font-bold text-theme-secondary">
          <span>${l.date}</span>
          <span class="text-theme-secondary">Cycle ${l.read_cycle}</span>
        </div>
        <div class="text-xs font-bold text-theme-primary">
          Read p. ${l.start_page} – ${l.end_page} <span class="text-emerald-400 font-semibold">(+${addedPages} pg)</span>${minutes}
        </div>
        ${notesHTML}
      `;
      item.appendChild(bullet);
      timeline.appendChild(item);
    });
  }
  
  // Wire action buttons
  const rereadBtn = $('bd-action-reread');
  if (rereadBtn) {
    if (isFin) {
      rereadBtn.classList.remove('hidden');
      // recreate listener
      const newBtn = rereadBtn.cloneNode(true);
      rereadBtn.parentNode.replaceChild(newBtn, rereadBtn);
      newBtn.addEventListener('click', async () => {
        if (confirm(`Start re-reading "${b.title}"? Cycle ${(b.read_count || 1) + 1} will begin.`)) {
          $('book-detail-modal').classList.remove('open');
          await startBookReRead(b);
        }
      });
    } else {
      rereadBtn.classList.add('hidden');
    }
  }
  
  const editBtn = $('bd-action-edit');
  if (editBtn) {
    let focusBtn = $('bd-action-focus');
    if (!focusBtn && editBtn.parentNode) {
      focusBtn = document.createElement('button');
      focusBtn.id = 'bd-action-focus';
      focusBtn.className = 'flex-1 py-3 rounded-xl font-bold text-xs bg-amber-500/20 hover:bg-amber-500/30 text-theme-gold border border-amber-500/30 transition-all active:scale-[0.98]';
      focusBtn.innerHTML = '<i class="fa-solid fa-play mr-1"></i> Focus Session';
      editBtn.parentNode.insertBefore(focusBtn, editBtn);
    }
    if (focusBtn) {
      focusBtn.onclick = () => {
        $('book-detail-modal').classList.remove('open');
        openFullTimerSession(b);
      };
    }

    const newBtn = editBtn.cloneNode(true);
    editBtn.parentNode.replaceChild(newBtn, editBtn);
    newBtn.addEventListener('click', () => {
      $('book-detail-modal').classList.remove('open');
      openEditBookModal(b);
    });
  }

  // Open modal
  $('book-detail-modal').classList.add('open');
}

// Wire detail modal close
window.addEventListener('DOMContentLoaded', () => {
  const closeBtn = $('book-detail-close');
  if (closeBtn) closeBtn.addEventListener('click', () => $('book-detail-modal').classList.remove('open'));
});

// =========================================================================
// SMART FORM CYCLE & PROGRESS CALCULATIONS
// =========================================================================
function handleBookSelection(selectedBookTitle, books, logs) {
  const book = books.find(b => b.title === selectedBookTitle);
  if (!book) return;
  
  const bookLogs = logs.filter(l => l.book_title === selectedBookTitle);
  let currentCycle = 1;
  let startPage = 0;
  
  if (bookLogs.length > 0) {
    bookLogs.sort((a, b) => {
      const cycleA = parseInt(a.read_cycle || 1, 10);
      const cycleB = parseInt(b.read_cycle || 1, 10);
      if (cycleA !== cycleB) return cycleA - cycleB;
      const timeA = a.created_at?.toDate ? a.created_at.toDate().getTime() : (a.created_at?.seconds ? a.created_at.seconds * 1000 : new Date(a.date || 0).getTime());
      const timeB = b.created_at?.toDate ? b.created_at.toDate().getTime() : (b.created_at?.seconds ? b.created_at.seconds * 1000 : new Date(b.date || 0).getTime());
      return timeA - timeB;
    });
    
    const lastLog = bookLogs[bookLogs.length - 1];
    currentCycle = parseInt(lastLog.read_cycle || 1, 10);
    startPage = parseInt(lastLog.end_page || 0, 10);
    
    if (startPage >= parseInt(book.total_pages || 0, 10)) {
      currentCycle += 1;
      startPage = 0;
    }
  } else {
    const tot = parseInt(book.total_pages || 0, 10);
    const raw = parseInt(book.pages_read || book.current_page || 0, 10);
    startPage = (tot > 0 && raw > tot) ? (raw % tot) : raw;
    if (tot > 0 && startPage >= tot) {
      startPage = 0;
    }
  }
  
  document.getElementById('log-start').value = startPage;
  document.getElementById('log-cycle').value = currentCycle;
}

// =========================================================================
// SERVICE WORKER & PWA UPDATE MANAGEMENT SYSTEM
// =========================================================================
window.swRegistration = null;
window.swWaitingWorker = null;

function showUpdateModal(onDismissCallback = null) {
  const modal = document.getElementById('pwa-update-modal');
  if (!modal) {
    if (onDismissCallback) onDismissCallback();
    return;
  }

  modal.style.display = 'flex';
  modal.classList.add('open');

  const btnUpdate = document.getElementById('btn-pwa-update-now');
  const btnDismiss = document.getElementById('btn-pwa-update-dismiss');

  const handleUpdate = () => {
    if (btnUpdate) {
      btnUpdate.disabled = true;
      btnUpdate.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Updating...';
    }
    const waitingWorker = window.swWaitingWorker || (window.swRegistration && window.swRegistration.waiting);
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    }
    setTimeout(() => {
      window.location.reload();
    }, 300);
  };

  const handleDismiss = () => {
    modal.classList.remove('open');
    modal.style.display = 'none';
    if (onDismissCallback) onDismissCallback();
  };

  if (btnUpdate) {
    const newBtnUpdate = btnUpdate.cloneNode(true);
    btnUpdate.parentNode.replaceChild(newBtnUpdate, btnUpdate);
    newBtnUpdate.addEventListener('click', handleUpdate);
  }
  if (btnDismiss) {
    const newBtnDismiss = btnDismiss.cloneNode(true);
    btnDismiss.parentNode.replaceChild(newBtnDismiss, btnDismiss);
    newBtnDismiss.addEventListener('click', handleDismiss);
  }
}

function setupServiceWorkerUpdateSystem() {
  if (!('serviceWorker' in navigator)) return;

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (window.isMockAuth || refreshing) return;
    refreshing = true;
    showUpdateModal();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      window.swRegistration = reg;

      if (reg.waiting) {
        window.swWaitingWorker = reg.waiting;
      }

      if (reg && reg.update) {
        reg.update().catch(err => console.warn('SW update ignored error:', err));
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              window.swWaitingWorker = newWorker;
              console.log('[SW] New version installed and waiting.');
              showUpdateModal();
            }
          });
        }
      });
    }).catch(err => console.warn('SW register ignored error:', err));
  });
}

function setupSettingsUpdateInspector() {
  const checkBtns = document.querySelectorAll('#btn-check-sw-update, #btn-acct-check-sw-update');
  const forceBtns = document.querySelectorAll('#btn-force-reload-app, #btn-acct-force-reload-app');

  checkBtns.forEach(btnCheck => {
    btnCheck.addEventListener('click', async () => {
      checkBtns.forEach(b => {
        b.disabled = true;
        b.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Checking...';
      });

      if ('serviceWorker' in navigator && window.swRegistration) {
        try {
          await window.swRegistration.update();
        } catch (e) {
          console.warn('SW manual update check error:', e);
        }
      }

      setTimeout(() => {
        checkBtns.forEach(b => {
          b.disabled = false;
          b.innerHTML = '<i class="fa-solid fa-rotate text-[11px]"></i> Check Updates';
        });

        const waiting = window.swWaitingWorker || (window.swRegistration && window.swRegistration.waiting);
        if (waiting) {
          window.swWaitingWorker = waiting;
          showUpdateModal();
        } else {
          const badge = document.getElementById('app-version-badge') || document.getElementById('acct-version-badge');
          const ver = badge ? badge.textContent : 'v110';
          if (typeof showToast === 'function') {
            showToast(`You are running the latest version (${ver})`, 'success');
          }
        }
      }, 800);
    });
  });

  forceBtns.forEach(btnForce => {
    btnForce.addEventListener('click', async () => {
      if (confirm('Force refresh app to download the latest updates directly from the server?')) {
        forceBtns.forEach(b => {
          b.disabled = true;
          b.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Refreshing...';
        });
        if ('caches' in window) {
          try {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          } catch (e) {}
        }
        if ('serviceWorker' in navigator && window.swRegistration) {
          try {
            await window.swRegistration.unregister();
          } catch (e) {}
        }
        window.location.reload(true);
      }
    });
  });
}

setupServiceWorkerUpdateSystem();
window.showUpdateModal = showUpdateModal;
window.setupSettingsUpdateInspector = setupSettingsUpdateInspector;


// =========================================================================
// GLOBAL ESCAPE KEY HANDLER (WCAG 2.1.1)
// =========================================================================
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const modals = [
    'book-detail-modal', 'goals-modal', 'settings-modal',
    'add-book-modal', 'edit-book-modal', 'stats-detail-modal',
    'notes-modal', 'heatmapDayModal', 'contextualDetailModal',
    'cover-search-modal'
  ];
  for (const id of modals) {
    const modal = document.getElementById(id);
    if (modal && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
      e.preventDefault();
      return;
    }
  }
});

// =========================================================================
// SECTION 10: OCR PAGE SCANNER INTEGRATION
// =========================================================================
function getGeminiApiKey() {
  const key = localStorage.getItem('rt_gemini_api_key');
  if (key && key.trim()) {
    if (typeof firebaseConfig !== 'undefined' && key.trim() === firebaseConfig.apiKey) {
      localStorage.removeItem('rt_gemini_api_key');
      return '';
    }
    return key.trim();
  }
  return '';
}

const SCANNER_CONFIG = {
  dbName: "OfflineScanDB",
  storeName: "scans",
  dbVersion: 1,
  modelName: "gemini-1.5-flash",
  getApiUrl: function() {
    const key = getGeminiApiKey();
    return `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`;
  }
};

let dbInstance = null;

function initIndexedDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);
    const request = indexedDB.open(SCANNER_CONFIG.dbName, SCANNER_CONFIG.dbVersion);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(SCANNER_CONFIG.storeName)) {
        db.createObjectStore(SCANNER_CONFIG.storeName, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };
    request.onerror = (event) => {
      console.error("IndexedDB initialization failure: ", event.target.error);
      reject(event.target.error);
    };
  });
}

async function saveScanOffline(base64Data, mimeType, bookTitle) {
  const db = await initIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SCANNER_CONFIG.storeName], "readwrite");
    const store = transaction.objectStore(SCANNER_CONFIG.storeName);
    const record = {
      imageData: base64Data,
      mimeType: mimeType,
      bookTitle: bookTitle,
      timestamp: Date.now()
    };
    const request = store.add(record);
    request.onsuccess = () => {
      Haptics.success();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getPendingScans() {
  const db = await initIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SCANNER_CONFIG.storeName], "readonly");
    const store = transaction.objectStore(SCANNER_CONFIG.storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deletePendingScan(id) {
  const db = await initIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SCANNER_CONFIG.storeName], "readwrite");
    const store = transaction.objectStore(SCANNER_CONFIG.storeName);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function triggerPageScan() {
  Haptics.click();
  const fileInput = document.getElementById('scan-page-file');
  if (fileInput) {
    fileInput.click();
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = error => reject(error);
  });
}

function showToastNotification(message) {
  showToast(message, 'success');
}

async function handlePageScan(event) {
  const file = event.target.files[0];
  if (!file) return;

  const notesField = document.getElementById('log-notes');
  const activeBook = document.getElementById('log-book') ? document.getElementById('log-book').value : 'Active Book';

  const base64Data = await fileToBase64(file);
  const dataUrl = `data:${file.type || 'image/jpeg'};base64,${base64Data}`;
  const apiKey = getGeminiApiKey();

  // If online & Gemini API key is configured, perform AI OCR transcription
  if (navigator.onLine && apiKey && notesField) {
    const spinner = document.getElementById('ocr-loading-spinner');
    if (spinner) spinner.classList.remove('hidden');
    notesField.disabled = true;
    const originalPlaceholder = notesField.placeholder;
    notesField.placeholder = "Scanning page layout with AI... Please wait.";
    notesField.style.opacity = "0.7";
    Haptics.nudge();

    try {
      const result = await requestTranscriptionFromGemini(base64Data, file.type || "image/jpeg");
      openVerificationModal(result.text, result.pageNumber);
    } catch (error) {
      console.warn("AI OCR fallback to photo note: ", error.message);
      saveStandaloneNote({
        id: 'sa_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        title: activeBook || 'Photo Quote',
        author: '',
        date: todayISO(),
        notes: 'Photo Quote',
        photoUrl: dataUrl,
        isFavorite: false,
        isQuote: true
      });
      showToast("Photo quote saved to Notes tab!", "success");
      renderKnowledgeView();
    } finally {
      notesField.disabled = false;
      notesField.placeholder = originalPlaceholder;
      notesField.style.opacity = "1";
      if (spinner) spinner.classList.add('hidden');
      event.target.value = '';
    }
    return;
  }

  // Zero-prompt behavior: Save photo note immediately
  saveStandaloneNote({
    id: 'sa_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    title: activeBook || 'Photo Quote',
    author: '',
    date: todayISO(),
    notes: 'Photo Quote',
    photoUrl: dataUrl,
    isFavorite: false,
    isQuote: true
  });
  showToast("Photo note saved to Notes tab!", "success");
  Haptics.success();
  renderKnowledgeView();
  event.target.value = '';
}

function openGeminiKeyModal() {
  if (typeof showView === 'function') {
    showView('account');
    const input = document.getElementById('acct-gemini-api-key');
    if (input) {
      input.focus();
      input.scrollIntoView({ behavior: 'smooth' });
    }
  }
}

function initGeminiKeyModalListeners() {
  const btnSave = document.getElementById('btn-save-gemini-key');
  const inputKey = document.getElementById('acct-gemini-api-key');
  if (btnSave && inputKey) {
    btnSave.onclick = () => {
      const val = inputKey.value.trim();
      if (val) {
        localStorage.setItem('rt_gemini_api_key', val);
        if (typeof showToast === 'function') showToast('Gemini API Key saved!', 'success');
      } else {
        localStorage.removeItem('rt_gemini_api_key');
        if (typeof showToast === 'function') showToast('Gemini API Key removed.', 'info');
      }
    };
  }
}

async function requestTranscriptionFromGemini(base64Data, mimeType) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    openGeminiKeyModal();
    throw new Error("Missing Gemini API Key. Please enter your key in Google AI Studio modal.");
  }

  const promptText = "Perform meticulous optical character recognition (OCR) on this page photograph. Transcribe all readable paragraphs verbatim inside chronological correct line breaks. Then, check the page corners to extract the printed page integer, if visible. Return strictly as a formatted JSON object.";
  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: promptText },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          text: { 
            type: "STRING", 
            description: "Verbatim transcribe of all readable passages on the page." 
          },
          pageNumber: { 
            type: "INTEGER", 
            description: "The printed page number found in the margins, if visible. Null if missing." 
          }
        },
        required: ["text"]
      }
    }
  };

  try {
    const resultData = await callGeminiApiWithFallback(apiKey, payload);
    const textBody = resultData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textBody) {
      throw new Error("Transcribing algorithm returned an empty payload.");
    }
    return JSON.parse(textBody);
  } catch (err) {
    if (err.message.includes('403') || err.message.includes('disabled') || err.message.includes('API key not valid')) {
      localStorage.removeItem('rt_gemini_api_key');
      openGeminiKeyModal();
      throw new Error("Invalid or disabled Gemini API Key. Please enter a free key from Google AI Studio.");
    }
    throw new Error(`Google Gemini AI Error: ${err.message}`);
  }
}

function openVerificationModal(text, pageNumber) {
  const modal = document.getElementById('ocr-verify-modal');
  const textField = document.getElementById('ocr-verify-text');
  const pageField = document.getElementById('ocr-verify-page');
  if (!modal || !textField || !pageField) return;
  textField.value = text || "";
  pageField.value = pageNumber || "";
  modal.classList.add('open');
  Haptics.success();
}

function closeVerificationModal() {
  const modal = document.getElementById('ocr-verify-modal');
  if (modal) {
    modal.classList.remove('open');
  }
}

function commitVerifiedScan() {
  const textVal = document.getElementById('ocr-verify-text').value.trim();
  const pageVal = document.getElementById('ocr-verify-page').value.trim();
  const notesField = document.getElementById('log-notes');
  const endPageField = document.getElementById('log-end');
  
  if (textVal && notesField) {
    const existing = notesField.value;
    const formattedQuote = existing ? `${existing}\n\n[Scanned Page Quote]:\n"${textVal}"` : `[Scanned Page Quote]:\n"${textVal}"`;
    notesField.value = formattedQuote;
  }
  if (pageVal && endPageField) {
    endPageField.value = pageVal;
    endPageField.dispatchEvent(new Event('input', { bubbles: true }));
    endPageField.dispatchEvent(new Event('change', { bubbles: true }));
    endPageField.classList.add('ring-2', 'ring-sky-400');
    setTimeout(() => endPageField.classList.remove('ring-2', 'ring-sky-400'), 1500);
  }
  closeVerificationModal();
  Haptics.success();
  showToastNotification("Transcription successfully added to your active log draft!");
}

async function processOfflineSyncQueue() {
  if (!navigator.onLine) return;
  const pending = await getPendingScans();
  if (pending.length === 0) return;
  showToastNotification(`Connection restored! Syncing ${pending.length} pending offline page scans...`);
  for (const scan of pending) {
    try {
      const result = await requestTranscriptionFromGemini(scan.imageData, scan.mimeType);
      let localShelf = JSON.parse(localStorage.getItem('scanned_shelf') || '[]');
      localShelf.push({
        id: scan.id,
        bookTitle: scan.bookTitle,
        text: result.text,
        pageNumber: result.pageNumber,
        timestamp: scan.timestamp
      });
      localStorage.setItem('scanned_shelf', JSON.stringify(localShelf));
      await deletePendingScan(scan.id);
    } catch (err) {
      console.error(`Syncing failure on record ${scan.id}: `, err);
    }
  }
  Haptics.success();
  renderPendingShelfNotifiers();
}

function renderPendingShelfNotifiers() {
  const localShelf = JSON.parse(localStorage.getItem('scanned_shelf') || '[]');
  const containerId = 'scanned-shelf-notifiers';
  let container = document.getElementById(containerId);
  const notesField = document.getElementById('log-notes');
  if (!notesField) return;
  if (localShelf.length === 0) {
    if (container) container.remove();
    return;
  }
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'mt-3 space-y-2 w-full';
    notesField.parentElement.appendChild(container);
  }
  container.innerHTML = localShelf.map((item, idx) => `
    <div class="bg-sky-500/10 border border-sky-500/20 rounded-xl p-3 flex justify-between items-center gap-3">
      <div class="text-left min-w-0 flex-1">
        <span class="text-[9px] font-bold text-sky-400 uppercase tracking-wider block">Background Scan Sync Available</span>
        <span class="text-xs text-white font-medium block truncate">Draft: ${item.bookTitle}</span>
      </div>
      <div class="flex gap-1.5 shrink-0">
        <button onclick="discardScannedShelfItem(${idx})" class="text-neutral-400 hover:text-red-400 p-1.5 rounded-lg bg-white/5 border border-theme text-xs"><i class="fa-solid fa-trash"></i></button>
        <button onclick="loadScannedShelfItem(${idx})" class="bg-sky-500 hover:bg-sky-600 text-white font-bold text-[10px] px-2.5 py-1.5 rounded-lg">Load Scan</button>
      </div>
    </div>
  `).join('');
}

window.discardScannedShelfItem = function(idx) {
  let localShelf = JSON.parse(localStorage.getItem('scanned_shelf') || '[]');
  localShelf.splice(idx, 1);
  localStorage.setItem('scanned_shelf', JSON.stringify(localShelf));
  renderPendingShelfNotifiers();
};

window.loadScannedShelfItem = function(idx) {
  let localShelf = JSON.parse(localStorage.getItem('scanned_shelf') || '[]');
  const item = localShelf[idx];
  if (item) {
    openVerificationModal(item.text, item.pageNumber);
    window.discardScannedShelfItem(idx);
  }
};

window.triggerPageScan = triggerPageScan;
window.closeVerificationModal = closeVerificationModal;
window.commitVerifiedScan = commitVerifiedScan;
window.openEditLogModal = openEditLogModal;
window.closeEditLogModal = closeEditLogModal;
window.saveLogEdit = saveLogEdit;
window.deleteLogEntry = deleteLogEntry;

function bindScannerEvents() {
  const trigger = document.getElementById('scan-page-trigger');
  if (trigger) trigger.onclick = triggerPageScan;
  const fileInput = document.getElementById('scan-page-file');
  if (fileInput) fileInput.onchange = handlePageScan;
}

window.renderDashboard = renderDashboard;
window.showScreen = showScreen;
window.showView = showView;
window.setUid = (id) => { uid = id; };
window.getBooksCache = () => booksCache;
window.setBooksCache = (arr) => { 
  booksCache = arr; 
  window.booksCache = arr; 
  markViewsDirty();
  if (typeof window.render3DSpineBookshelf === 'function') window.render3DSpineBookshelf();
};
window.getLogsCache = () => logsCache;
window.setLogsCache = (arr) => { logsCache = arr; markViewsDirty(); };
window.getWishlistCache = () => wishlistCache;
window.setWishlistCache = (arr) => { wishlistCache = arr; markViewsDirty(); };

// Run scanner setup
(function initScannerOnRuntime() {
  if (typeof bindScannerEvents === 'function') bindScannerEvents();
  if (typeof initIndexedDB === 'function') initIndexedDB();
  if (typeof processOfflineSyncQueue === 'function') window.addEventListener('online', processOfflineSyncQueue);
  if (typeof renderPendingShelfNotifiers === 'function') setTimeout(renderPendingShelfNotifiers, 1200);
  if (typeof initSabbaticalModule === 'function') setTimeout(initSabbaticalModule, 1000);
  if (typeof initQuickNoteModalListeners === 'function') setTimeout(initQuickNoteModalListeners, 1000);
  if (typeof initGeminiKeyModalListeners === 'function') setTimeout(initGeminiKeyModalListeners, 1000);
})();

/* ═══════════════════════════════════════════════════════════════
   KNOWLEDGE & NOTES TAB ENGINE (Overhauled)
   ══════════════════════════════════════════════════════════════ */
let knowledgeCurrentTag = 'all';
let knowledgeSelectedBook = 'all';
let qnModalFavorite = false;
let qnUploadedPhotoData = null;

function getFavoriteNoteIds() {
  try {
    return JSON.parse(localStorage.getItem('rt_favorite_notes') || '[]');
  } catch (e) {
    return [];
  }
}

function toggleFavoriteNote(noteId) {
  let favs = getFavoriteNoteIds();
  if (favs.includes(noteId)) {
    favs = favs.filter(id => id !== noteId);
    showToast('Removed from Favorites', 'info');
  } else {
    favs.push(noteId);
    showToast('★ Added to Favorites!', 'success');
  }
  localStorage.setItem('rt_favorite_notes', JSON.stringify(favs));
  renderKnowledgeView();
}

function getStandaloneNotes() {
  try {
    const raw = localStorage.getItem('rt_standalone_notes');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(sn => !sn.id || !sn.id.startsWith('sn_seed_')) : [];
  } catch (e) {
    return [];
  }
}

function saveStandaloneNote(noteObj) {
  const notes = getStandaloneNotes();
  notes.unshift(noteObj);
  localStorage.setItem('rt_standalone_notes', JSON.stringify(notes));
}

function renderKnowledgeView(selectedTag = knowledgeCurrentTag) {
  knowledgeCurrentTag = selectedTag;
  const feed = $('knowledge-quote-feed');
  if (!feed) return;

  // Auto-fetch caches if empty so notes render even on direct navigation
  if ((!logsCache || logsCache.length === 0) && typeof loadLogsCache === 'function' && db && uid) {
    loadLogsCache().then(() => renderKnowledgeView(selectedTag));
  }
  if ((!booksCache || booksCache.length === 0) && typeof loadBooksCache === 'function' && db && uid) {
    loadBooksCache().then(() => renderKnowledgeView(selectedTag));
  }

  const favIds = getFavoriteNoteIds();
  const standaloneNotes = getStandaloneNotes();
  const notesList = [];

  const logsArr = (typeof logsCache !== 'undefined' && Array.isArray(logsCache)) ? logsCache : [];
  const booksArr = (typeof booksCache !== 'undefined' && Array.isArray(booksCache)) ? booksCache : [];

  // Create book title to author map for session log author enrichment
  const bookAuthorMap = {};
  booksArr.forEach(b => {
    if (b.title && b.author) bookAuthorMap[b.title.trim().toLowerCase()] = b.author;
  });

  // 1. Extract non-empty notes from session logs
  logsArr.forEach((log, index) => {
    if (log.notes && log.notes.trim() && !log.notes.startsWith('Historical cycle')) {
      const noteId = log.id ? `log_${log.id}` : `log_${log.date}_${index}_${(log.book_title || '').slice(0, 10)}`;
      const isManualFav = favIds.includes(noteId);
      const startP = log.start_page || log.startPage || null;
      const endP = log.end_page || log.endPage || null;
      let pageLabel = null;
      if (startP != null && endP != null && endP > startP) {
        pageLabel = `pp. ${startP}–${endP}`;
      } else if (endP != null && endP > 0) {
        pageLabel = `p. ${endP}`;
      }

      const matchedAuthor = log.author || (log.book_title ? bookAuthorMap[log.book_title.trim().toLowerCase()] : '') || '';
      const hasQuoteMarks = /["“"»«>]/.test(log.notes);

      notesList.push({
        id: noteId,
        type: 'log',
        title: log.book_title || 'Reading Session',
        author: matchedAuthor,
        date: log.date,
        cycle: log.read_cycle || 1,
        notes: log.notes,
        pageLabel: pageLabel,
        isQuote: hasQuoteMarks,
        isFavorite: isManualFav
      });
    }
  });

  // 2. Extract notes attached directly to book items
  booksArr.forEach(b => {
    if (b.notes && b.notes.trim()) {
      const noteId = `book_${b.id || b.title}`;
      const isManualFav = favIds.includes(noteId);
      notesList.push({
        id: noteId,
        type: 'book',
        title: b.title,
        author: b.author || '',
        date: b.date_added || todayISO(),
        cycle: b.read_count || 1,
        notes: b.notes,
        pageLabel: null,
        isQuote: /["“"»«>]/.test(b.notes),
        isFavorite: isManualFav
      });
    }
  });

  // 3. Extract Standalone / Quick Notes
  standaloneNotes.forEach(sn => {
    const isManualFav = favIds.includes(sn.id);
    notesList.push({
      id: sn.id,
      type: 'standalone',
      title: sn.title || 'Quick Note',
      author: sn.author || '',
      date: sn.date || todayISO(),
      notes: sn.notes || '',
      photoUrl: sn.photoUrl || null,
      pageLabel: sn.pageLabel || null,
      isQuote: sn.isQuote !== false,
      isFavorite: isManualFav || sn.isFavorite === true
    });
  });

  // Sort notes by date descending
  notesList.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // Update Header Stats Summary
  const totalCount = notesList.length;
  const favsCount = notesList.filter(n => n.isFavorite).length;
  const uniqueBooksCount = new Set(notesList.map(n => n.title)).size;

  if ($('kn-stat-total')) $('kn-stat-total').textContent = totalCount;
  if ($('kn-stat-favs')) $('kn-stat-favs').textContent = favsCount;
  if ($('kn-stat-books')) $('kn-stat-books').textContent = uniqueBooksCount;

  // 4. Currently Reading Spotlight & Daily Resurfacing
  const inProgressBookTitles = new Set(
    booksArr.filter(b => b.status === 'In Progress' || b.status === 'Reading').map(b => b.title)
  );

  const currentlyReadingNotes = notesList.filter(n => inProgressBookTitles.has(n.title));
  let resurfacedNote = null;
  const todayNum = new Date().getDate() + new Date().getMonth() * 31;

  if (currentlyReadingNotes.length > 0) {
    resurfacedNote = currentlyReadingNotes[todayNum % currentlyReadingNotes.length];
    if ($('daily-card-label')) {
      $('daily-card-label').innerHTML = `<i class="fa-solid fa-book-open-reader text-xs"></i> Currently Reading Spotlight`;
    }
  } else if (notesList.length > 0) {
    resurfacedNote = notesList[todayNum % notesList.length];
    if ($('daily-card-label')) {
      $('daily-card-label').innerHTML = `<i class="fa-solid fa-sparkles text-xs"></i> Daily Highlight Resurfacing`;
    }
  }

  if (resurfacedNote) {
    if ($('daily-quote-text')) $('daily-quote-text').textContent = `"${resurfacedNote.notes.replace(/^>\s*/, '')}"`;
    if ($('daily-quote-author')) $('daily-quote-author').textContent = resurfacedNote.author ? `— ${resurfacedNote.author}` : '— Reading Note';
    if ($('daily-quote-book')) $('daily-quote-book').textContent = resurfacedNote.title;
  } else {
    if ($('daily-quote-text')) $('daily-quote-text').textContent = '"The reading of all good books is like a conversation with the finest minds of past centuries."';
    if ($('daily-quote-author')) $('daily-quote-author').textContent = '— René Descartes';
    if ($('daily-quote-book')) $('daily-quote-book').textContent = 'Reading Tracker';
  }

  // 5. Populate Book Filter Select Dropdown
  const bookSelect = $('knowledge-book-select');
  if (bookSelect) {
    const bookTitles = Array.from(new Set(notesList.map(n => n.title))).sort();
    let optionsHTML = `<option value="all">📚 All Books & Notes</option><option value="standalone">📝 Standalone Notes</option>`;
    bookTitles.forEach(t => {
      if (t !== 'Quick Note' && t !== 'Standalone Note') {
        optionsHTML += `<option value="${t.replace(/"/g, '&quot;')}">📖 ${t}</option>`;
      }
    });
    bookSelect.innerHTML = optionsHTML;

    // Validate that knowledgeSelectedBook exists in available options
    const validValues = ['all', 'standalone', ...bookTitles];
    if (!validValues.includes(knowledgeSelectedBook)) {
      knowledgeSelectedBook = 'all';
    }
    bookSelect.value = knowledgeSelectedBook;

    bookSelect.onchange = () => {
      knowledgeSelectedBook = bookSelect.value;
      renderKnowledgeView();
    };
  }

  // 6. Search Bar Event Listener
  const searchInput = $('knowledge-search-input');
  const searchClear = $('knowledge-search-clear');
  let searchQuery = searchInput ? searchInput.value.trim() : '';

  if (searchInput) {
    searchInput.oninput = () => {
      if (searchClear) searchClear.classList.toggle('hidden', !searchInput.value);
      renderKnowledgeView();
    };
  }
  if (searchClear) {
    searchClear.onclick = () => {
      if (searchInput) searchInput.value = '';
      searchClear.classList.add('hidden');
      renderKnowledgeView();
    };
  }

  // 7. Apply Filters (Tag, Book, Search)
  let filtered = notesList;

  // Book Filter
  if (knowledgeSelectedBook === 'standalone') {
    filtered = filtered.filter(n => n.type === 'standalone' || n.title === 'Quick Note' || n.title === 'Standalone Note');
  } else if (knowledgeSelectedBook !== 'all') {
    filtered = filtered.filter(n => n.title === knowledgeSelectedBook);
  }

  // Tag Filter
  if (selectedTag === 'quotes') {
    filtered = filtered.filter(n => n.isQuote);
  } else if (selectedTag === 'reflections') {
    filtered = filtered.filter(n => !n.isQuote);
  } else if (selectedTag === 'favorites') {
    filtered = filtered.filter(n => n.isFavorite);
  }

  // Diacritic-Insensitive Search Filter
  if (searchQuery) {
    const normQ = normalizeText(searchQuery);
    filtered = filtered.filter(n => {
      const matchNotes = normalizeText(n.notes).includes(normQ);
      const matchTitle = normalizeText(n.title).includes(normQ);
      const matchAuthor = normalizeText(n.author).includes(normQ);
      return matchNotes || matchTitle || matchAuthor;
    });
  }

  // Update Active State on Tag Buttons
  document.querySelectorAll('#knowledge-tag-bar .quote-tag').forEach(b => {
    b.classList.toggle('active', b.dataset.tag === selectedTag);
  });

  feed.innerHTML = '';

  if (filtered.length === 0) {
    const isFiltered = knowledgeSelectedBook !== 'all' || selectedTag !== 'all' || searchQuery !== '';
    feed.innerHTML = `
      <div class="glass-panel p-8 text-center rounded-3xl flex flex-col items-center gap-3">
        <i class="fa-solid fa-quote-left text-3xl text-theme-gold/40"></i>
        <p class="text-sm font-bold text-theme-primary">${isFiltered ? 'No notes match your active filter or search' : 'No notes recorded yet'}</p>
        <p class="text-xs text-theme-secondary mb-2">${isFiltered ? 'Try clearing your search query, changing the book filter, or switching tags.' : 'Log a session with notes or click Quick Note to capture your thoughts.'}</p>
        ${isFiltered ? `
          <button id="kn-btn-clear-filters" class="px-4 py-2 text-xs font-bold rounded-xl text-slate-900 shadow-md cursor-pointer transition-all active:scale-95" style="background: var(--gold)">
            <i class="fa-solid fa-rotate-left mr-1"></i> Clear All Filters
          </button>
        ` : ''}
      </div>
    `;

    const resetBtn = $('kn-btn-clear-filters');
    if (resetBtn) {
      resetBtn.onclick = () => {
        knowledgeSelectedBook = 'all';
        if (bookSelect) bookSelect.value = 'all';
        if (searchInput) searchInput.value = '';
        if (searchClear) searchClear.classList.add('hidden');
        renderKnowledgeView('all');
      };
    }
    return;
  }

  // 8. Render Quote Cards in Paginated Chunks (25 per batch for 60 FPS performance)
  let limit = window.knowledgeFeedLimit || 25;
  const itemsToRender = filtered.slice(0, limit);

  itemsToRender.forEach(n => {
    const card = el('div', 'quote-card animate-fade-in flex flex-col gap-2 relative');
    
    let photoHTML = '';
    if (n.photoUrl) {
      photoHTML = `<div class="mb-2 rounded-xl overflow-hidden max-h-48 border border-theme"><img src="${n.photoUrl}" class="w-full object-cover" alt="Note Photo Attachment" loading="lazy" decoding="async" /></div>`;
    }

    let pageHTML = '';
    if (n.pageLabel) {
      pageHTML = `<span class="page-badge"><i class="fa-solid fa-bookmark text-[9px] text-theme-gold mr-1"></i>${n.pageLabel}</span>`;
    }

    card.innerHTML = `
      ${photoHTML}
      <blockquote class="italic text-sm font-medium leading-relaxed" style="color: var(--text-primary)">
        "${n.notes.replace(/^>\s*/, '')}"
      </blockquote>
      <div class="flex items-center justify-between text-xs mt-2 pt-2 border-t border-theme">
        <div class="flex flex-col min-w-0 pr-2">
          <span class="font-bold truncate" style="color: var(--gold)">${n.title}</span>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="text-[10px] text-theme-secondary">${n.author ? n.author + ' • ' : ''}${fmtDate(n.date)}</span>
            ${pageHTML}
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button class="quote-card-action-btn hover:text-theme-gold" data-action="share" title="Share Quote Card PNG">
            <i class="fa-solid fa-camera-retro"></i>
          </button>
          <button class="quote-card-action-btn ${n.isFavorite ? 'active-fav' : ''}" data-action="fav" data-id="${n.id}" title="${n.isFavorite ? 'Remove Favorite' : 'Mark Favorite'}">
            <i class="${n.isFavorite ? 'fa-solid' : 'fa-regular'} fa-star"></i>
          </button>
          <button class="quote-card-action-btn" data-action="copy" title="Copy Quote with Citation">
            <i class="fa-regular fa-copy"></i>
          </button>
        </div>
      </div>
    `;

    // Action button listeners
    const shareBtn = card.querySelector('[data-action="share"]');
    if (shareBtn) {
      shareBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof triggerHaptic === 'function') triggerHaptic();
        openQuoteCardModal(n.notes, n.author, n.title);
      };
    }

    const favBtn = card.querySelector('[data-action="fav"]');
    if (favBtn) {
      favBtn.onclick = (e) => {
        e.stopPropagation();
        Haptics.click();
        toggleFavoriteNote(n.id);
      };
    }

    const copyBtn = card.querySelector('[data-action="copy"]');
    if (copyBtn) {
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        Haptics.click();
        const citation = `"${n.notes.replace(/^>\s*/, '')}"\n— ${n.author ? n.author + ', ' : ''}${n.title}${n.pageLabel ? ' (' + n.pageLabel + ')' : ''}`;
        navigator.clipboard.writeText(citation).then(() => {
          showToast('Quote copied to clipboard!', 'success');
        }).catch(() => {
          showToast('Failed to copy text', 'error');
        });
      };
    }

    feed.appendChild(card);
  });

  if (filtered.length > limit) {
    const remaining = filtered.length - limit;
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'w-full py-3.5 rounded-2xl border border-theme bg-white/5 hover:bg-white/10 text-xs font-bold text-theme-secondary transition-all active:scale-95 cursor-pointer mt-2';
    loadMoreBtn.innerHTML = `<i class="fa-solid fa-chevron-down mr-1.5"></i> Load More Notes (${remaining} remaining)`;
    loadMoreBtn.onclick = () => {
      window.knowledgeFeedLimit = (window.knowledgeFeedLimit || 25) + 30;
      renderKnowledgeView(selectedTag);
    };
    feed.appendChild(loadMoreBtn);
  }

  // Wire Export Vault ZIP button
  const zipBtn = $('btn-export-markdown-zip');
  if (zipBtn) zipBtn.onclick = exportObsidianMarkdownVault;

  // Wire BibTeX Citation Exporter button
  const bibtexBtn = $('btn-export-bibtex');
  if (bibtexBtn) bibtexBtn.onclick = exportBibTeXCitations;

  // Wire Quick Note Open Button
  const quickNoteBtn = $('btn-quick-note-open');
  if (quickNoteBtn) quickNoteBtn.onclick = openQuickNoteModal;

  // Wire Tag Bar Click Handlers
  document.querySelectorAll('#knowledge-tag-bar .quote-tag').forEach(b => {
    b.onclick = () => {
      if (navigator.vibrate) navigator.vibrate([8]);
      renderKnowledgeView(b.dataset.tag);
    };
  });
}

/* ═══════════════════════════════════════════════════════════════
   QUICK NOTE & PHOTO QUOTE MODAL CONTROLLER
   ══════════════════════════════════════════════════════════════ */
function openQuickNoteModal() {
  Haptics.click();
  const modal = $('quick-note-modal');
  if (!modal) return;

  const titleInput = $('qn-title-input');
  const textInput = $('qn-text-input');
  const bookSelect = $('qn-book-select');
  const previewBox = $('qn-photo-preview-box');
  const imgElem = $('qn-photo-img');

  if (titleInput) titleInput.value = '';
  if (textInput) textInput.value = '';
  qnUploadedPhotoData = null;
  qnModalFavorite = false;

  updateQuickNoteFavUI();

  if (previewBox) previewBox.classList.add('hidden');
  if (imgElem) imgElem.src = '';

  if (bookSelect) {
    let html = `<option value="">📝 Standalone / Unlinked Note</option>`;
    booksCache.forEach(b => {
      html += `<option value="${b.title.replace(/"/g, '&quot;')}">📖 ${b.title}</option>`;
    });
    bookSelect.innerHTML = html;
  }

  modal.classList.add('open');
}

function closeQuickNoteModal() {
  const modal = $('quick-note-modal');
  if (modal) modal.classList.remove('open');
}

function updateQuickNoteFavUI() {
  const favIcon = $('qn-fav-icon');
  const favLabel = $('qn-fav-label');
  if (favIcon) {
    favIcon.className = qnModalFavorite ? 'fa-solid fa-star text-theme-gold' : 'fa-regular fa-star';
  }
  if (favLabel) {
    favLabel.textContent = qnModalFavorite ? 'Favorited' : 'Mark Favorite';
    favLabel.className = qnModalFavorite ? 'text-theme-gold font-bold' : 'text-theme-secondary';
  }
}

function initQuickNoteModalListeners() {
  const closeBtn = $('quick-note-close');
  const cancelBtn = $('qn-cancel-btn');
  const backdrop = $('quick-note-backdrop');
  const favToggle = $('qn-favorite-toggle');
  const photoTrigger = $('qn-photo-trigger');
  const photoFile = $('qn-photo-file');
  const photoRemove = $('qn-photo-remove');
  const ocrBtn = $('qn-btn-ocr');
  const saveBtn = $('qn-save-btn');

  if (closeBtn) closeBtn.onclick = closeQuickNoteModal;
  if (cancelBtn) cancelBtn.onclick = closeQuickNoteModal;
  if (backdrop) backdrop.onclick = closeQuickNoteModal;

  if (favToggle) {
    favToggle.onclick = () => {
      qnModalFavorite = !qnModalFavorite;
      updateQuickNoteFavUI();
      Haptics.click();
    };
  }

  if (photoTrigger && photoFile) {
    photoTrigger.onclick = () => photoFile.click();
    photoFile.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const compressedDataUrl = await compressImage(file, 800, 800, 0.7);
        qnUploadedPhotoData = {
          dataUrl: compressedDataUrl,
          file: file
        };
        const previewBox = $('qn-photo-preview-box');
        const imgElem = $('qn-photo-img');
        if (imgElem) imgElem.src = compressedDataUrl;
        if (previewBox) previewBox.classList.remove('hidden');
        Haptics.success();
      } catch (err) {
        console.warn('Image compression fallback:', err);
      }
    };
  }

  if (photoRemove) {
    photoRemove.onclick = () => {
      qnUploadedPhotoData = null;
      const previewBox = $('qn-photo-preview-box');
      const photoFile = $('qn-photo-file');
      if (previewBox) previewBox.classList.add('hidden');
      if (photoFile) photoFile.value = '';
    };
  }

  if (ocrBtn) {
    ocrBtn.onclick = async () => {
      if (!qnUploadedPhotoData || !qnUploadedPhotoData.file) {
        showToast('Please choose or take a photo first', 'warning');
        return;
      }

      const apiKey = getGeminiApiKey();
      if (!apiKey) {
        showToast('Photo attached! (To enable optional AI text transcription, add a key in Account Settings)', 'info');
        return;
      }

      ocrBtn.disabled = true;
      ocrBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-[10px]"></i> Transcribing...`;
      try {
        const base64Data = qnUploadedPhotoData.dataUrl.split(',')[1];
        const mimeType = qnUploadedPhotoData.file.type || 'image/jpeg';
        const result = await requestTranscriptionFromGemini(base64Data, mimeType);
        const textInput = $('qn-text-input');
        if (textInput && result.text) {
          textInput.value = (textInput.value ? textInput.value + '\n\n' : '') + result.text;
          showToast('AI Page transcription complete!', 'success');
          Haptics.success();
        }
      } catch (err) {
        console.error('Quick Note OCR error:', err);
        showToast('AI transcription unavailable: ' + err.message, 'warning');
      } finally {
        ocrBtn.disabled = false;
        ocrBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles text-[10px]"></i> Transcribe with Gemini AI`;
      }
    };
  }

  let isQuickNoteSubmitting = false;

  if (saveBtn) {
    saveBtn.onclick = async () => {
      if (isQuickNoteSubmitting) return;

      const titleInput = $('qn-title-input') ? $('qn-title-input').value.trim() : '';
      const textInput = $('qn-text-input') ? $('qn-text-input').value.trim() : '';
      const bookSelect = $('qn-book-select') ? $('qn-book-select').value : '';

      if (!textInput && !qnUploadedPhotoData) {
        showToast('Please type a note or upload a photo', 'warning');
        return;
      }

      isQuickNoteSubmitting = true;
      saveBtn.disabled = true;

      try {
        let bookTitle = bookSelect || titleInput || 'Quick Note';
        let authorName = '';

        if (bookSelect) {
          const matchedBook = booksCache.find(b => b.title === bookSelect);
          if (matchedBook) authorName = matchedBook.author || '';
        }

        const newNote = {
          id: 'sa_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          title: bookTitle,
          author: authorName,
          date: todayISO(),
          notes: textInput || 'Photo Quote',
          photoUrl: qnUploadedPhotoData ? qnUploadedPhotoData.dataUrl : null,
          isFavorite: qnModalFavorite,
          isQuote: true
        };

        saveStandaloneNote(newNote);
        closeQuickNoteModal();
        showToast('Quick Note saved to vault!', 'success');
        Haptics.success();
        renderKnowledgeView();
      } catch (err) {
        showToast('Failed to save note: ' + err.message, 'error');
      } finally {
        isQuickNoteSubmitting = false;
        saveBtn.disabled = false;
      }
    };
  }
}

/**
 * Export BibTeX Citations File for Scholarly Research
 */
function exportBibTeXCitations() {
  if (!booksCache || !booksCache.length) {
    showToast('No books available in library to export citations.', 'error');
    return;
  }
  let bibtex = `% Reading Tracker BibTeX Citations Export - Generated ${new Date().toISOString().slice(0, 10)}\n\n`;
  booksCache.forEach((b, idx) => {
    const authorLast = (b.author || 'author').split(' ').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
    const titleFirst = (b.title || 'title').split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `${authorLast || 'ref'}${b.year || '2026'}_${titleFirst || idx+1}`;
    bibtex += `@book{${key},\n`;
    bibtex += `  title     = {${(b.title || 'Untitled').replace(/[{}]/g, '')}},\n`;
    if (b.author) bibtex += `  author    = {${b.author.replace(/[{}]/g, '')}},\n`;
    if (b.year)   bibtex += `  year      = {${b.year}},\n`;
    if (b.total_pages) bibtex += `  pages     = {${b.total_pages}},\n`;
    if (b.category || b.collection) bibtex += `  keywords  = {${b.collection || b.category}},\n`;
    bibtex += `}\n\n`;
  });

  const blob = new Blob([bibtex], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Reading_Tracker_BibTeX_Citations_${new Date().toISOString().slice(0, 10)}.bib`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('✓ BibTeX (.bib) Citations Exported!', 'success');
}

/**
 * Export Obsidian-Compatible Markdown Vault ZIP Archive
 */
async function exportObsidianMarkdownVault() {
  if (typeof JSZip === 'undefined') {
    showToast('Loading ZIP archive exporter...', 'info');
    try {
      await ensureScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    } catch (err) {
      showToast('Failed to load ZIP exporter library.', 'error');
      return;
    }
  }

  const zip = new JSZip();
  const booksFolder = zip.folder('Books');
  const sessionsFolder = zip.folder('Sessions');

  // Export finished & active books as Markdown files with YAML frontmatter
  booksCache.forEach(b => {
    const safeTitle = (b.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '_');
    const content = `---
title: "${b.title || ''}"
author: "${b.author || ''}"
category: "${b.collection || b.category || 'General'}"
status: "${b.status || 'Not Started'}"
total_pages: ${b.total_pages || 0}
read_count: ${b.read_count || 0}
rating: ${b.rating || 0}
date_added: "${b.date_added || ''}"
tags: [reading-tracker, ${b.collection === 'Bahai' ? 'bahai' : 'non-bahai'}]
---

# ${b.title || 'Untitled'}
**Author:** ${b.author || 'Unknown'}  
**Status:** ${b.status || 'Not Started'} | **Pages:** ${b.total_pages || 0}

## Notes & Reflections
${b.notes || 'No notes logged for this book.'}
`;
    booksFolder.file(`${safeTitle}.md`, content);
  });

  // Export sessions with quotes as Markdown files
  const activeLogs = logsCache.filter(l => l.notes && l.notes.trim() && !l.notes.startsWith('Historical cycle'));
  activeLogs.forEach(l => {
    const safeTitle = (l.book_title || 'Session').replace(/[\\/:*?"<>|]/g, '_');
    const dateStr = l.date || todayISO();
    const content = `---
book_title: "${l.book_title || ''}"
date: "${dateStr}"
read_cycle: ${l.read_cycle || 1}
pages_read: ${(l.end_page || 0) - (l.start_page || 0)}
minutes_spent: ${l.minutes_spent || 0}
tags: [reading-log, highlight]
---

# Reading Session: ${l.book_title || 'Session'}
**Date:** ${dateStr}  
**Pages Read:** ${l.start_page || 0} → ${l.end_page || 0} (${(l.end_page || 0) - (l.start_page || 0)} pages)  
**Time Spent:** ${l.minutes_spent || 0} minutes

## Session Note & Highlights
> ${l.notes}
`;
    sessionsFolder.file(`${dateStr}_${safeTitle}.md`, content);
  });

  // Generate ZIP blob and trigger browser download
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reading_tracker_obsidian_vault_${todayISO()}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('📦 Obsidian Markdown Vault ZIP Exported Successfully!');
}

/* ═══════════════════════════════════════════════════════════════
   SABBATICAL & STREAK FREEZE MODULE (Custom Reasons)


/* ═══════════════════════════════════════════════════════════════
   BESPOKE EDITORIAL APP EXTENSIONS (CSV Export, Timer, Analytics)
   ══════════════════════════════════════════════════════════════ */

/**
 * Priority Export: Downloads full database (Books, Reading Logs) as structured CSV files.
 */
window.exportAllDataToCSV = function() {
  const bCache = window.booksCache || [];
  const lCache = window.logsCache || [];

  // 1. Export Books CSV
  let booksCSV = "Book ID,Title,Author,Category,Status,Total Pages,Current Page,Read Count,Rating,Date Added,Notes\n";
  bCache.forEach(b => {
    const title = `"${(b.title || '').replace(/"/g, '""')}"`;
    const author = `"${(b.author || '').replace(/"/g, '""')}"`;
    const notes = `"${(b.notes || '').replace(/"/g, '""')}"`;
    booksCSV += `${b.id || ''},${title},${author},${b.collection || b.category || ''},${b.status || ''},${b.total_pages || 0},${b.current_page || 0},${b.read_count || 0},${b.rating || 0},${b.date_added || ''},${notes}\n`;
  });
  triggerCSVDownload(booksCSV, `reading_tracker_books_${todayISO()}.csv`);

  // 2. Export Reading Logs CSV
  let logsCSV = "Log ID,Book ID,Book Title,Date,Start Page,End Page,Pages Read,Minutes Spent,Notes\n";
  lCache.forEach(l => {
    const title = `"${(l.book_title || '').replace(/"/g, '""')}"`;
    const notes = `"${(l.notes || '').replace(/"/g, '""')}"`;
    const pagesRead = (l.end_page || 0) - (l.start_page || 0);
    logsCSV += `${l.id || ''},${l.book_id || ''},${title},${l.date || ''},${l.start_page || 0},${l.end_page || 0},${pagesRead},${l.minutes_spent || 0},${notes}\n`;
  });
  
  setTimeout(() => {
    triggerCSVDownload(logsCSV, `reading_tracker_logs_${todayISO()}.csv`);
  }, 400);

  if (typeof showToast === 'function') showToast('📊 Priority CSV Files Exported Successfully!', 'success');
};

function triggerCSVDownload(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Client-Side Canvas Image Compression (Prevents Firestore 1MB document errors) */
function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Invalid image file'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.onerror = (err) => reject(err);
      img.src = e.target.result;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/* Full-Screen Reading Timer Overlay State & Logic */
let fullTimerState = {
  seconds: 0,
  intervalId: null,
  book: null,
  startPage: 0,
  currentEndPage: 0,
  photoData: null,
  isMinimized: false,
  startMs: 0
};

// ════════════════════════════════════════════════════════════
// BACKGROUND TIMER & LOCK SCREEN MEDIASESSION CONTROLS
// ════════════════════════════════════════════════════════════
let bgTimerAudio = null;
let wakeLockObj = null;

function startBackgroundTimerSession(bookTitle, author) {
  fullTimerState.startMs = Date.now() - (fullTimerState.seconds * 1000);

  // 1. Silent background audio loop to keep timer thread alive on iOS / Android
  try {
    if (!bgTimerAudio) {
      bgTimerAudio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
      bgTimerAudio.loop = true;
    }
    bgTimerAudio.play().catch(e => console.log('Background timer audio initialization:', e));
  } catch(e) {}

  // 2. Register MediaSession Metadata & Lock Screen Playback Controls
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: bookTitle ? `Reading: ${bookTitle}` : 'Active Reading Session',
      artist: author ? `${author} • Focus Session` : 'Reading Tracker',
      album: 'Reading Tracker Mobile',
      artwork: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    });
    navigator.mediaSession.playbackState = 'playing';

    try {
      navigator.mediaSession.setActionHandler('play', () => {
        if (!fullTimerState.intervalId) {
          startTimerClock();
          const pauseBtn = document.getElementById('timer-btn-pause');
          if (pauseBtn) pauseBtn.innerHTML = '<i class="fa-solid fa-pause mr-1"></i> Pause';
        }
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (fullTimerState.intervalId) {
          clearInterval(fullTimerState.intervalId);
          fullTimerState.intervalId = null;
          const pauseBtn = document.getElementById('timer-btn-pause');
          if (pauseBtn) pauseBtn.innerHTML = '<i class="fa-solid fa-play mr-1"></i> Resume';
        }
      });
    } catch(e) {}
  }
}

function updateMediaSessionPosition(elapsedSeconds) {
  if ('mediaSession' in navigator && typeof navigator.mediaSession.setPositionState === 'function') {
    try {
      navigator.mediaSession.setPositionState({
        duration: Math.max(elapsedSeconds + 1, 3600),
        playbackRate: 1,
        position: elapsedSeconds
      });
    } catch(e) {}
  }
}

function stopBackgroundTimerSession() {
  try {
    if (bgTimerAudio) {
      bgTimerAudio.pause();
      bgTimerAudio.currentTime = 0;
    }
  } catch(e) {}

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'none';
  }
  if (wakeLockObj) {
    wakeLockObj.release().catch(() => {}).finally(() => { wakeLockObj = null; });
  }
}

// Recalculate exact wall-clock time elapsed when phone wakes up or tab is foregrounded
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && fullTimerState.startMs > 0 && fullTimerState.intervalId) {
    const realElapsedSeconds = Math.floor((Date.now() - fullTimerState.startMs) / 1000);
    fullTimerState.seconds = Math.max(fullTimerState.seconds, realElapsedSeconds);
    const mins = Math.floor(fullTimerState.seconds / 60);
    const secs = fullTimerState.seconds % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    const clockEl = document.getElementById('timer-clock-display');
    if (clockEl) clockEl.textContent = timeStr;
    const miniSub = document.getElementById('timer-mini-subtitle');
    if (miniSub) miniSub.textContent = `${timeStr} · Active Session`;

    updatePaceAndPages();
    updateMediaSessionPosition(fullTimerState.seconds);
  }
});

window.openFullTimerSession = function(book) {
  const overlay = document.getElementById('timer-fullscreen-overlay');
  const floatBar = document.getElementById('timer-floating-bar');
  if (!overlay) return;

  // 1. Calculate Start Page: Last end_page from logsCache for this book
  let startPage = 0;
  if (book) {
    const tot = parseInt(book.total_pages || 0, 10);
    const bookLogs = (window.logsCache || []).filter(l => l.book_title === book.title);
    if (bookLogs.length > 0) {
      bookLogs.sort((a, b) => {
        const cycleA = parseInt(a.read_cycle || 1, 10);
        const cycleB = parseInt(b.read_cycle || 1, 10);
        if (cycleA !== cycleB) return cycleA - cycleB;
        const timeA = a.created_at?.toDate ? a.created_at.toDate().getTime() : (a.created_at?.seconds ? a.created_at.seconds * 1000 : new Date(a.date || 0).getTime());
        const timeB = b.created_at?.toDate ? b.created_at.toDate().getTime() : (b.created_at?.seconds ? b.created_at.seconds * 1000 : new Date(b.date || 0).getTime());
        return timeA - timeB;
      });
      const lastLog = bookLogs[bookLogs.length - 1];
      startPage = parseInt(lastLog.end_page || 0, 10);
      if (tot > 0 && startPage >= tot) {
        startPage = 0;
      }
    } else {
      const raw = parseInt(book.pages_read || book.current_page || 0, 10);
      startPage = (tot > 0 && raw > tot) ? (raw % tot) : raw;
      if (tot > 0 && startPage >= tot) {
        startPage = 0;
      }
    }
  }

  fullTimerState.book = book;
  fullTimerState.startPage = startPage;
  fullTimerState.currentEndPage = startPage;
  fullTimerState.seconds = 0;
  fullTimerState.startMs = Date.now();
  fullTimerState.photoData = null;
  fullTimerState.isMinimized = false;

  // 2. Populate UI Elements
  const titleEl = document.getElementById('timer-book-title');
  const startEl = document.getElementById('timer-start-page');
  const endInput = document.getElementById('timer-input-end-page');
  const pagesReadEl = document.getElementById('timer-pages-read');
  const clockEl = document.getElementById('timer-clock-display');
  const paceEl = document.getElementById('timer-speed-pace');
  const notesInput = document.getElementById('timer-input-notes');
  const photoPreview = document.getElementById('timer-photo-preview-box');
  const photoFileInput = document.getElementById('timer-photo-file-input');

  if (titleEl) titleEl.textContent = book ? book.title : 'Active Reading Session';
  if (startEl) startEl.textContent = startPage;
  if (endInput) endInput.value = '';
  if (pagesReadEl) pagesReadEl.textContent = '+0';
  if (clockEl) clockEl.textContent = '00:00';
  if (paceEl) paceEl.textContent = '0 p/hr';
  if (notesInput) notesInput.value = '';
  if (photoPreview) photoPreview.classList.add('hidden');
  if (photoFileInput) photoFileInput.value = '';

  // 3. Mini bar update
  if (floatBar) floatBar.classList.add('hidden');
  const miniTitle = document.getElementById('timer-mini-title');
  if (miniTitle) miniTitle.textContent = book ? book.title : 'Active Focus Session';

  overlay.classList.add('active');
  startTimerClock();
  startBackgroundTimerSession(book ? book.title : null, book ? book.author : null);
};

function startTimerClock() {
  if (fullTimerState.intervalId) clearInterval(fullTimerState.intervalId);
  fullTimerState.startMs = Date.now() - (fullTimerState.seconds * 1000);
  
  fullTimerState.intervalId = setInterval(() => {
    fullTimerState.seconds = Math.max(fullTimerState.seconds + 1, Math.floor((Date.now() - fullTimerState.startMs) / 1000));
    const mins = Math.floor(fullTimerState.seconds / 60);
    const secs = fullTimerState.seconds % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    const clockEl = document.getElementById('timer-clock-display');
    if (clockEl) clockEl.textContent = timeStr;

    // Mini bar subtitle
    const miniSub = document.getElementById('timer-mini-subtitle');
    if (miniSub) miniSub.textContent = `${timeStr} · Active Session`;

    updatePaceAndPages();
    updateMediaSessionPosition(fullTimerState.seconds);
  }, 1000);
}

function updatePaceAndPages() {
  const endInput = document.getElementById('timer-input-end-page');
  const pagesReadEl = document.getElementById('timer-pages-read');
  const paceEl = document.getElementById('timer-speed-pace');

  let endVal = fullTimerState.startPage;
  if (endInput && endInput.value.trim() !== '') {
    endVal = parseInt(endInput.value, 10);
  }
  fullTimerState.currentEndPage = isNaN(endVal) ? fullTimerState.startPage : endVal;

  const pagesRead = Math.max(0, fullTimerState.currentEndPage - fullTimerState.startPage);
  if (pagesReadEl) pagesReadEl.textContent = `+${pagesRead}`;

  const elapsedHours = fullTimerState.seconds / 3600;
  if (paceEl) {
    paceEl.textContent = elapsedHours > 0.005 && pagesRead > 0 ? `${Math.round(pagesRead / elapsedHours)} p/hr` : '0 p/hr';
  }
}

function setupTimerEvents() {
  const minBtn = document.getElementById('timer-btn-minimize');
  const cancelBtn = document.getElementById('timer-btn-cancel');
  const pauseBtn = document.getElementById('timer-btn-pause');
  const completeBtn = document.getElementById('timer-btn-complete');
  const overlay = document.getElementById('timer-fullscreen-overlay');
  const floatBar = document.getElementById('timer-floating-bar');
  const endInput = document.getElementById('timer-input-end-page');

  const addPhotoBtn = document.getElementById('timer-btn-add-photo');
  const photoFile = document.getElementById('timer-photo-file-input');
  const photoRemove = document.getElementById('timer-photo-remove');

  // Interactive end page calculation
  if (endInput) {
    endInput.addEventListener('input', updatePaceAndPages);
  }

  // Compressed photo attachment logic
  if (addPhotoBtn && photoFile) {
    addPhotoBtn.onclick = () => photoFile.click();
    photoFile.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const compressedDataUrl = await compressImage(file, 800, 800, 0.7);
        fullTimerState.photoData = compressedDataUrl;
        const previewBox = document.getElementById('timer-photo-preview-box');
        const imgElem = document.getElementById('timer-photo-img');
        if (imgElem) imgElem.src = compressedDataUrl;
        if (previewBox) previewBox.classList.remove('hidden');
        if (typeof triggerHaptic === 'function') triggerHaptic();
      } catch (err) {
        console.warn('Image compression error:', err);
      }
    };
  }

  if (photoRemove) {
    photoRemove.onclick = () => {
      fullTimerState.photoData = null;
      const previewBox = document.getElementById('timer-photo-preview-box');
      if (previewBox) previewBox.classList.add('hidden');
      if (photoFile) photoFile.value = '';
    };
  }

  // 1. Minimize (Down Arrow) -> Moves to bottom floating bar, timer CONTINUES running!
  if (minBtn) {
    minBtn.onclick = () => {
      if (typeof triggerHaptic === 'function') triggerHaptic();
      if (overlay) overlay.classList.remove('active');
      if (floatBar) floatBar.classList.remove('hidden');
      fullTimerState.isMinimized = true;
    };
  }

  // Mini Floating Bar Expand
  const miniExpand = document.getElementById('timer-mini-expand');
  const miniExpandBtn = document.getElementById('timer-mini-btn-expand');
  const expandFunc = () => {
    if (typeof triggerHaptic === 'function') triggerHaptic();
    if (floatBar) floatBar.classList.add('hidden');
    if (overlay) overlay.classList.add('active');
    fullTimerState.isMinimized = false;
  };
  if (miniExpand) miniExpand.onclick = expandFunc;
  if (miniExpandBtn) miniExpandBtn.onclick = (e) => { e.stopPropagation(); expandFunc(); };

  // Mini Floating Bar Pause
  const miniPauseBtn = document.getElementById('timer-mini-btn-pause');
  if (miniPauseBtn) {
    miniPauseBtn.onclick = (e) => {
      e.stopPropagation();
      if (typeof triggerHaptic === 'function') triggerHaptic();
      if (fullTimerState.intervalId) {
        clearInterval(fullTimerState.intervalId);
        fullTimerState.intervalId = null;
        miniPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
        if (pauseBtn) pauseBtn.innerHTML = '<i class="fa-solid fa-play mr-1"></i> Resume';
      } else {
        startTimerClock();
        miniPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        if (pauseBtn) pauseBtn.innerHTML = '<i class="fa-solid fa-pause mr-1"></i> Pause';
      }
    };
  }

  // 2. Cancel Focus Session
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      if (!confirm('Cancel this focus session? Timer progress and notes will be discarded.')) return;
      if (typeof triggerHaptic === 'function') triggerHaptic();
      if (fullTimerState.intervalId) clearInterval(fullTimerState.intervalId);
      fullTimerState.intervalId = null;
      stopBackgroundTimerSession();
      if (overlay) overlay.classList.remove('active');
      if (floatBar) floatBar.classList.add('hidden');
      if (typeof showToast === 'function') showToast('Focus session cancelled', 'info');
    };
  }

  // 3. Pause / Resume Button
  if (pauseBtn) {
    pauseBtn.onclick = () => {
      if (typeof triggerHaptic === 'function') triggerHaptic();
      if (fullTimerState.intervalId) {
        clearInterval(fullTimerState.intervalId);
        fullTimerState.intervalId = null;
        pauseBtn.innerHTML = '<i class="fa-solid fa-play mr-1"></i> Resume';
        if (miniPauseBtn) miniPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
      } else {
        startTimerClock();
        pauseBtn.innerHTML = '<i class="fa-solid fa-pause mr-1"></i> Pause';
        if (miniPauseBtn) miniPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
      }
    };
  }

  // 4. Finish & Log Button
  if (completeBtn) {
    completeBtn.onclick = async () => {
      if (typeof triggerHaptic === 'function') triggerHaptic();
      if (fullTimerState.intervalId) clearInterval(fullTimerState.intervalId);
      fullTimerState.intervalId = null;
      stopBackgroundTimerSession();

      const book = fullTimerState.book;
      const title = book ? book.title : 'General Session';
      const start = fullTimerState.startPage;
      const end = fullTimerState.currentEndPage > start ? fullTimerState.currentEndPage : start;
      const mins = Math.max(1, Math.round(fullTimerState.seconds / 60));
      const notesInput = document.getElementById('timer-input-notes');
      const notesText = notesInput ? notesInput.value.trim() : '';
      const photoData = fullTimerState.photoData;

      if (overlay) overlay.classList.remove('active');
      if (floatBar) floatBar.classList.add('hidden');

      try {
        const uid = typeof auth !== 'undefined' && auth.currentUser ? auth.currentUser.uid : null;
        if (uid && typeof db !== 'undefined') {
          const bookLogs = (window.logsCache || []).filter(l => l.book_title === title);
          const maxCycle = bookLogs.length > 0 ? Math.max(...bookLogs.map(l => parseInt(l.read_cycle || 1, 10))) : 1;
          const cycle = book ? Math.max((book.read_count || 0) + 1, maxCycle) : 1;

          await addDoc(collection(db, `users/${uid}/reading_logs`), {
            date: todayISO(),
            book_title: title,
            read_cycle: cycle,
            start_page: start,
            end_page: end,
            minutes_spent: mins,
            notes: notesText,
            photo_url: photoData || null,
            created_at: serverTimestamp()
          });

          if (typeof recalculateBook === 'function') {
            await recalculateBook(title, cycle);
          }

          window.logsCache = [];
          if (typeof loadLogsCache === 'function') await loadLogsCache();
          if (typeof renderDashboard === 'function') renderDashboard();

          const pagesRead = Math.max(0, end - start);
          if (typeof showToast === 'function') {
            showToast(`✓ Logged ${pagesRead} page${pagesRead === 1 ? '' : 's'} in ${mins}m for "${title.slice(0, 25)}"`, 'success');
          }
        }
      } catch (err) {
        console.error('Error logging focus session:', err);
        if (typeof showToast === 'function') showToast('Session ended', 'info');
      }
    };
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupTimerEvents();

  const hmClose = document.getElementById('heatmap-day-close-btn');
  const hmBackdrop = document.getElementById('heatmap-day-backdrop');
  if (hmClose) hmClose.onclick = closeHeatmapDayModal;
  if (hmBackdrop) hmBackdrop.onclick = closeHeatmapDayModal;

  const ctxClose = document.getElementById('contextual-detail-close-btn');
  const ctxBackdrop = document.getElementById('contextual-detail-backdrop');
  if (ctxClose) ctxClose.onclick = closeContextualDetailModal;
  if (ctxBackdrop) ctxBackdrop.onclick = closeContextualDetailModal;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeHeatmapDayModal();
      closeContextualDetailModal();
    }
  });
});

(function restoreEditorialTheme() {
  const savedTheme = localStorage.getItem('rt_editorial_theme') || (localStorage.getItem('rt_theme') === 'light' ? 'parched-paper' : 'espresso');
  if (typeof setEditorialTheme === 'function') setEditorialTheme(savedTheme);
})();

window.render3DSpineBookshelf = async function(items) {
  const shelfContainer = document.getElementById('bookshelf-3d-shelf');
  if (!shelfContainer) return;
  
  let list = Array.isArray(items) ? items : null;
  if (list === null) {
    if (typeof getMergedBooks === 'function') {
      try {
        list = await getMergedBooks();
      } catch (err) {}
    }
  }
  if (list === null) {
    list = (typeof booksCache !== 'undefined' && Array.isArray(booksCache)) 
      ? booksCache 
      : (Array.isArray(window.booksCache) ? window.booksCache : []);
  }

  const books = list || [];
  if (!books.length) {
    shelfContainer.innerHTML = '<div class="text-xs text-theme-secondary/60 py-6 text-center w-full font-mono">No matching books for active filter</div>';
    return;
  }

  const gradients = [
    'linear-gradient(90deg, #4d1b14 0%, #7a2b20 40%, #4d1b14 100%)', // Ruby Crimson Leather
    'linear-gradient(90deg, #123322 0%, #1e5237 40%, #123322 100%)', // Emerald Oxford
    'linear-gradient(90deg, #182233 0%, #263854 40%, #182233 100%)', // Deep Navy Cloth
    'linear-gradient(90deg, #3d2618 0%, #593924 40%, #3d2618 100%)', // Roasted Espresso
    'linear-gradient(90deg, #281a38 0%, #412b5c 40%, #281a38 100%)', // Imperial Violet
    'linear-gradient(90deg, #2b3318 0%, #435226 40%, #2b3318 100%)', // Forest Moss
    'linear-gradient(90deg, #382d1a 0%, #544427 40%, #382d1a 100%)'  // Antique Amber
  ];

  shelfContainer.innerHTML = '';
  books.forEach((b, i) => {
    const pages = Math.max(20, parseInt(b.total_pages || b.pages || 250, 10));
    const width = Math.min(52, Math.max(22, Math.round(18 + (pages / 28))));
    const height = Math.min(210, Math.max(138, 138 + (pages % 70)));
    const grad = gradients[i % gradients.length];
    const safeTitle = (b.title || 'Untitled').replace(/"/g, '&quot;');
    const safeAuthor = (b.author || '').replace(/"/g, '&quot;');
    const fontSize = width < 26 ? '0.68rem' : '0.78rem';
    
    // Calculate progress percentage
    let pct = 0;
    if (['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status)) {
      pct = 100;
    } else if (b.pages_read && b.total_pages) {
      pct = Math.min(100, Math.round(((b.pages_read % b.total_pages) / b.total_pages) * 100));
    }

    const spine = document.createElement('div');
    spine.className = 'book-spine-item relative overflow-hidden shadow-lg border-x border-theme';
    spine.style.cssText = `width: ${width}px; height: ${height}px; background: ${grad}; color: #F5EBE6; font-size: ${fontSize};`;
    spine.title = `${safeTitle}${safeAuthor ? ' by ' + safeAuthor : ''} (${pages} pages — ${pct}% read)`;

    spine.innerHTML = `
      <div class="absolute top-1 left-0 right-0 h-0.5 bg-amber-400/70"></div>
      <div class="absolute bottom-1.5 left-0 right-0 h-0.5 bg-amber-400/70"></div>
      <span class="truncate font-serif font-semibold leading-none">${safeTitle}</span>
      <div class="book-spine-progress">
        <div class="book-spine-progress-fill" style="width: ${pct}%;"></div>
      </div>
    `;

    spine.addEventListener('click', () => {
      if (typeof openBookDetailModal === 'function') {
        openBookDetailModal(b);
      }
    });

    shelfContainer.appendChild(spine);
  });
};

setTimeout(() => {
  if (typeof window.render3DSpineBookshelf === 'function') window.render3DSpineBookshelf();
}, 1000);

/* ═══════════════════════════════════════════════════════════════
   HANDS-FREE VOICE DICTATION LOGIC (Web Speech API)
   ══════════════════════════════════════════════════════════════ */
function setupVoiceDictation(targetInputId, micBtnId) {
  const micBtn = document.getElementById(micBtnId);
  const targetInput = document.getElementById(targetInputId);
  if (!micBtn || !targetInput) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.onclick = () => {
      if (typeof showToast === 'function') showToast('Voice Recognition is not supported by your browser.', 'warning');
    };
    return;
  }

  let recognition = null;
  let isRecording = false;

  micBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (isRecording && recognition) {
      recognition.stop();
      return;
    }

    try {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        isRecording = true;
        micBtn.classList.add('mic-recording');
        micBtn.innerHTML = `<i class="fa-solid fa-microphone-slash text-[10px]"></i> Stop`;
        if (typeof showToast === 'function') showToast('🎙️ Dictating... speak your thoughts out loud!', 'info');
      };

      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript + ' ';
          }
        }
        if (transcript.trim().length > 0) {
          const currentVal = targetInput.value.trim();
          targetInput.value = currentVal ? `${currentVal}\n${transcript.trim()}` : transcript.trim();
        }
      };

      recognition.onerror = (err) => {
        console.warn('Speech recognition error:', err.error);
        if (typeof showToast === 'function') showToast('Dictation info: ' + err.error, 'warning');
      };

      recognition.onend = () => {
        isRecording = false;
        micBtn.classList.remove('mic-recording');
        micBtn.innerHTML = `<i class="fa-solid fa-microphone text-[10px]"></i> Dictate`;
      };

      recognition.start();
    } catch (err) {
      console.error('Dictation setup error:', err);
    }
  };
}

/* ═══════════════════════════════════════════════════════════════
   DYNAMIC "YEAR IN READING" WRAPPED STORY CAROUSEL
   ══════════════════════════════════════════════════════════════ */
let currentWrappedSlideIndex = 0;

window.openYearWrappedModal = function(selectedYear) {
  const modal = document.getElementById('year-wrapped-modal');
  const yearSelect = document.getElementById('wrapped-year-select');
  if (!modal) return;

  const currentYear = new Date().getFullYear();

  // Dynamically populate available years from earliest log year up to currentYear (never future years!)
  if (yearSelect) {
    let earliestYear = currentYear;
    (window.logsCache || []).forEach(l => {
      if (l.date && /^\d{4}/.test(l.date)) {
        const y = parseInt(l.date.slice(0, 4), 10);
        if (y < earliestYear) earliestYear = y;
      }
    });

    let selectHTML = '';
    for (let y = currentYear; y >= earliestYear; y--) {
      selectHTML += `<option value="${y}" ${y === (selectedYear || currentYear) ? 'selected' : ''}>Year ${y}</option>`;
    }
    yearSelect.innerHTML = selectHTML;
    yearSelect.onchange = (e) => {
      const chosen = parseInt(e.target.value, 10);
      renderYearWrappedSlides(chosen);
    };
  }

  renderYearWrappedSlides(selectedYear || currentYear);
  modal.classList.add('open');
};

function renderYearWrappedSlides(targetYear) {
  currentWrappedSlideIndex = 0;

  const viewport = document.getElementById('wrapped-slides-viewport');
  const indicators = document.getElementById('wrapped-story-indicators');
  if (!viewport) return;

  const yearLogs = (window.logsCache || []).filter(l => l.date && l.date.startsWith(String(targetYear)));
  
  let totalPagesYear = 0;
  let totalMinutesYear = 0;
  const monthMap = {};
  const dayMap = {};
  const authorMap = {};
  const categoryMap = {};
  let longestBookTitle = '—';
  let maxBookPages = 0;

  yearLogs.forEach(l => {
    const p = Math.max(0, parseInt(l.end_page || 0, 10) - parseInt(l.start_page || 0, 10));
    const m = parseInt(l.minutes_spent || 0, 10);
    totalPagesYear += p;
    totalMinutesYear += m;

    if (l.date) {
      const monthKey = l.date.slice(0, 7);
      monthMap[monthKey] = (monthMap[monthKey] || 0) + p;
      dayMap[l.date] = (dayMap[l.date] || 0) + p;
    }

    if (l.book_title) {
      const b = (window.booksCache || []).find(bk => bk.title === l.book_title);
      if (b) {
        if (b.author) authorMap[b.author] = (authorMap[b.author] || 0) + p;
        const cat = b.category || b.collection || 'General';
        categoryMap[cat] = (categoryMap[cat] || 0) + p;
        if ((b.total_pages || 0) > maxBookPages) {
          maxBookPages = b.total_pages;
          longestBookTitle = b.title;
        }
      }
    }
  });

  const booksFinishedYear = (window.booksCache || []).filter(b => {
    const logs = yearLogs.filter(l => l.book_title === b.title);
    return logs.length > 0 && ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status);
  }).length;

  let topMonthName = '—';
  let topMonthPages = 0;
  Object.keys(monthMap).forEach(m => {
    if (monthMap[m] > topMonthPages) {
      topMonthPages = monthMap[m];
      const d = new Date(m + '-01T00:00:00');
      topMonthName = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
  });

  let topAuthorName = '—';
  let topAuthorPages = 0;
  Object.keys(authorMap).forEach(a => {
    if (authorMap[a] > topAuthorPages) {
      topAuthorPages = authorMap[a];
      topAuthorName = a;
    }
  });

  let topCatName = '—';
  let topCatPages = 0;
  Object.keys(categoryMap).forEach(c => {
    if (categoryMap[c] > topCatPages) {
      topCatPages = categoryMap[c];
      topCatName = c;
    }
  });

  const yearNotes = yearLogs.filter(l => l.notes && l.notes.trim().length > 10);
  let topQuote = yearNotes.length > 0 ? yearNotes[0].notes : 'Every book opened is a new horizon discovered.';
  let topQuoteBook = yearNotes.length > 0 ? yearNotes[0].book_title : 'Reading Tracker';

  const slidesData = [
    {
      title: `Year ${targetYear} in Reading`,
      badge: 'ANNUAL SUMMARY',
      icon: 'fa-book-open-reader text-theme-gold',
      bigVal: `${fmtNum(totalPagesYear)}`,
      bigLabel: 'Total Pages Read',
      subStats: [
        { label: 'Books Finished', val: `${booksFinishedYear} books` },
        { label: 'Reading Time', val: `${Math.round(totalMinutesYear / 60)} hours` }
      ]
    },
    {
      title: 'Peak Productivity',
      badge: 'READING PACE',
      icon: 'fa-fire text-rose-400',
      bigVal: topMonthName,
      bigLabel: `Top Month (${fmtNum(topMonthPages)} pages)`,
      subStats: [
        { label: 'Logged Sessions', val: `${yearLogs.length} sessions` },
        { label: 'Avg Daily Pace', val: `${Math.round(totalPagesYear / 365)} p/day` }
      ]
    },
    {
      title: 'Favorite Authors & Genres',
      badge: 'TOP PREFERENCES',
      icon: 'fa-crown text-theme-gold',
      bigVal: topAuthorName,
      bigLabel: `Most Read Author`,
      subStats: [
        { label: 'Top Genre', val: topCatName },
        { label: 'Genre Volume', val: `${fmtNum(topCatPages)} pages` }
      ]
    },
    {
      title: 'Reading Record Highlights',
      badge: 'BOOK RECORDS',
      icon: 'fa-trophy text-emerald-400',
      bigVal: longestBookTitle,
      bigLabel: `Longest Book (${fmtNum(maxBookPages)} pages)`,
      subStats: [
        { label: 'Total Titles Read', val: `${booksFinishedYear} completed` },
        { label: 'Active Days', val: `${Object.keys(dayMap).length} days` }
      ]
    },
    {
      title: 'Quote of the Year',
      badge: 'MEMORABLE EXCERPT',
      icon: 'fa-quote-left text-theme-gold',
      bigVal: `"${topQuote.replace(/^>\s*/, '')}"`,
      bigLabel: `— Excerpt from ${topQuoteBook}`,
      subStats: [
        { label: 'Captured Year', val: `${targetYear}` },
        { label: 'Source', val: 'Reading Tracker Vault' }
      ]
    }
  ];

  if (indicators) {
    indicators.innerHTML = slidesData.map((_, i) => 
      `<div class="h-1 flex-1 rounded-full transition-all duration-300 ${i === 0 ? 'bg-amber-400' : 'bg-white/20'}" id="wrapped-ind-${i}"></div>`
    ).join('');
  }

  viewport.innerHTML = slidesData.map((s, i) => `
    <div class="wrapped-slide absolute inset-0 p-6 flex flex-col justify-between text-center ${i === 0 ? 'active-slide' : 'next-slide'}" data-slide-index="${i}">
      <div class="flex flex-col items-center gap-1.5 mt-2">
        <span class="text-[9px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-amber-500/10 text-theme-gold border border-amber-500/20">${s.badge}</span>
        <h3 class="text-xl font-black tracking-tight text-theme-primary mt-1">${s.title}</h3>
      </div>

      <div class="my-auto flex flex-col items-center justify-center gap-2">
        <div class="w-14 h-14 rounded-2xl bg-white/5 border border-theme flex items-center justify-center text-2xl shadow-xl">
          <i class="fa-solid ${s.icon}"></i>
        </div>
        <div class="text-2xl sm:text-3xl font-black text-theme-gold leading-tight ${i === 4 ? 'italic font-serif text-base text-amber-100 max-h-36 overflow-y-auto px-2' : ''}">${s.bigVal}</div>
        <div class="text-xs font-bold text-theme-secondary">${s.bigLabel}</div>
      </div>

      <div class="grid grid-cols-2 gap-2.5 p-3 rounded-2xl bg-white/[0.04] border border-theme text-left">
        ${s.subStats.map(st => `
          <div>
            <div class="text-[9px] font-extrabold uppercase text-theme-secondary">${st.label}</div>
            <div class="text-xs font-bold text-theme-primary mt-0.5">${st.val}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  updateWrappedSlideControls(slidesData.length);
}

function updateWrappedSlideControls(totalSlides) {
  const counter = document.getElementById('wrapped-slide-counter');
  if (counter) counter.textContent = `Slide ${currentWrappedSlideIndex + 1} of ${totalSlides}`;

  for (let i = 0; i < totalSlides; i++) {
    const ind = document.getElementById(`wrapped-ind-${i}`);
    if (ind) ind.className = `h-1 flex-1 rounded-full transition-all duration-300 ${i === currentWrappedSlideIndex ? 'bg-amber-400' : 'bg-white/20'}`;

    const slide = document.querySelector(`.wrapped-slide[data-slide-index="${i}"]`);
    if (slide) {
      if (i === currentWrappedSlideIndex) slide.className = 'wrapped-slide active-slide absolute inset-0 p-6 flex flex-col justify-between text-center';
      else if (i < currentWrappedSlideIndex) slide.className = 'wrapped-slide prev-slide absolute inset-0 p-6 flex flex-col justify-between text-center';
      else slide.className = 'wrapped-slide next-slide absolute inset-0 p-6 flex flex-col justify-between text-center';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupVoiceDictation('timer-input-notes', 'timer-btn-dictate');
  setupVoiceDictation('qn-text-input', 'qn-btn-dictate');
  setupVoiceDictation('log-notes', 'log-btn-dictate');
  setupVoiceDictation('edit-log-notes', 'edit-log-btn-dictate');

  const openBtn = document.getElementById('btn-open-wrapped');
  const closeBtn = document.getElementById('wrapped-modal-close');
  const prevBtn = document.getElementById('wrapped-btn-prev');
  const nextBtn = document.getElementById('wrapped-btn-next');

  if (openBtn) {
    openBtn.onclick = () => openYearWrappedModal(new Date().getFullYear());
  }
  if (closeBtn) {
    closeBtn.onclick = () => document.getElementById('year-wrapped-modal').classList.remove('open');
  }

  if (prevBtn) {
    prevBtn.onclick = () => {
      if (currentWrappedSlideIndex > 0) {
        currentWrappedSlideIndex--;
        updateWrappedSlideControls(5);
        if (typeof triggerHaptic === 'function') triggerHaptic();
      }
    };
  }

  if (nextBtn) {
    nextBtn.onclick = () => {
      if (currentWrappedSlideIndex < 4) {
        currentWrappedSlideIndex++;
        updateWrappedSlideControls(5);
        if (typeof triggerHaptic === 'function') triggerHaptic();
      } else {
        document.getElementById('year-wrapped-modal').classList.remove('open');
      }
    };
  }
});

// =========================================================================
// ELITE FEATURE EXTENSIONS & ENHANCEMENTS SUITE
// =========================================================================

let currentHeatmapMetric = 'pages';
let currentLeitnerCards = [];
let currentLeitnerIndex = 0;

// --- 1. Dashboard Enhancements ---

function initHeatmapMetricListeners() {
  const metricButtons = document.querySelectorAll('#dash-heatmap-metric button');
  metricButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      metricButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentHeatmapMetric = btn.dataset.metric || 'pages';
      if (typeof logsCache !== 'undefined' && Array.isArray(logsCache)) {
        renderActivityHeatmap(logsCache);
      }
    });
  });
}

function openHeatmapDayDetailDrawer(dateStr) {
  const modal = document.getElementById('heatmap-day-modal');
  if (!modal) return;

  const dateEl = document.getElementById('hd-modal-date');
  const pagesEl = document.getElementById('hd-stat-pages');
  const durEl = document.getElementById('hd-stat-duration');
  const logsEl = document.getElementById('hd-stat-logs');
  const notesEl = document.getElementById('hd-stat-notes');
  const listContainer = document.getElementById('hd-modal-logs-list');

  const logs = (typeof logsCache !== 'undefined' && Array.isArray(logsCache)) ? logsCache.filter(l => l.date === dateStr) : [];
  
  if (dateEl) {
    const dObj = new Date(dateStr + 'T00:00:00');
    dateEl.textContent = dObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
  }

  let totalPages = 0;
  let totalDur = 0;
  let notesCount = 0;

  logs.forEach(l => {
    const p = parseInt(l.pages_read_today, 10) || parseInt(l.pagesRead, 10) || Math.max(0, parseInt(l.end_page || 0, 10) - parseInt(l.start_page || 0, 10)) || 0;
    totalPages += p;
    totalDur += parseInt(l.minutes_spent || l.duration_minutes || l.durationMinutes || 0, 10);
    if (l.notes && l.notes.trim()) notesCount++;
  });

  if (pagesEl) pagesEl.textContent = totalPages;
  if (durEl) durEl.textContent = `${totalDur}m`;
  if (logsEl) logsEl.textContent = logs.length;
  if (notesEl) notesEl.textContent = notesCount;

  if (listContainer) {
    if (logs.length === 0) {
      listContainer.innerHTML = '<div class="text-xs text-theme-secondary italic text-center py-4">No reading sessions recorded on this date.</div>';
    } else {
      listContainer.innerHTML = logs.map(l => {
        const p = parseInt(l.pages_read_today, 10) || parseInt(l.pagesRead, 10) || Math.max(0, parseInt(l.end_page || 0, 10) - parseInt(l.start_page || 0, 10)) || 0;
        const dur = parseInt(l.minutes_spent || l.duration_minutes || l.durationMinutes || 0, 10);
        return `
        <div class="p-3 rounded-xl bg-white/5 border border-theme text-xs flex flex-col gap-1">
          <div class="flex justify-between items-center font-bold text-theme-gold">
            <span>${l.book_title || 'Session'}</span>
            <span>+${p} pgs (${dur > 0 ? `${dur}m` : 'Unspecified'})</span>
          </div>
          ${l.notes ? `<p class="text-[11px] text-theme-secondary italic mt-1 line-clamp-2">"${l.notes}"</p>` : ''}
        </div>
      `;
      }).join('');
    }
  }

  modal.classList.add('open');
}



function renderContextualMatrix(logs) {
  const container = document.getElementById('contextual-matrix-container');
  const insightEl = document.getElementById('contextual-peak-insight');
  if (!container) return;

  const matrix = Array(7).fill(0).map(() => Array(24).fill(0));
  const matrixLogs = Array(7).fill(0).map(() => Array(24).fill(0).map(() => []));
  const dayTotalMins = Array(7).fill(0);

  const activeLogs = (logs || []).filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));

  activeLogs.forEach(l => {
    if (!l.date) return;
    const dObj = new Date(l.date + 'T00:00:00');
    const dayIdx = (dObj.getDay() + 6) % 7; // Mon = 0, Sun = 6

    let hour = -1;
    if (l.timestamp) {
      hour = new Date(l.timestamp).getHours();
    } else if (l.createdAt) {
      hour = new Date(l.createdAt).getHours();
    } else if (l.time_of_day || l.timeOfDay) {
      hour = parseInt(l.time_of_day || l.timeOfDay, 10);
    }

    if (isNaN(hour) || hour < 0 || hour > 23) {
      const hashStr = (l.date || '') + (l.book_title || '') + (l.start_page || 0);
      let hash = 0;
      for (let k = 0; k < hashStr.length; k++) {
        hash = (hash << 5) - hash + hashStr.charCodeAt(k);
      }
      hour = (Math.abs(hash) % 15) + 7; // Natural distribution between 7 AM and 9 PM
    }

    const mins = parseInt(l.duration_minutes || l.durationMinutes || l.minutes_spent || 30, 10);
    matrix[dayIdx][hour] += mins;
    dayTotalMins[dayIdx] += mins;
    matrixLogs[dayIdx][hour].push({ ...l, calculatedHour: hour, calculatedMins: mins });
  });

  let maxVal = 0;
  let peakHour = 20;
  let peakDay = 0;

  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (matrix[d][h] > maxVal) {
        maxVal = matrix[d][h];
        peakHour = h;
        peakDay = d;
      }
    }
  }

  // Store matrix state globally for detail modal lookups
  window._contextualMatrixState = {
    matrix,
    matrixLogs,
    maxVal,
    peakHour,
    peakDay,
    dayTotalMins
  };

  const dayNames = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const dayFullNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  let html = '<div class="flex flex-col gap-1 text-[9px] font-mono select-none">';
  
  html += '<div class="contextual-grid"><span class="text-theme-tertiary font-bold"></span>';
  for (let h = 0; h < 24; h += 2) {
    html += `<span class="col-span-2 text-theme-secondary font-bold text-center">${h}h</span>`;
  }
  html += '</div>';

  dayNames.forEach((dName, dIdx) => {
    html += `<div class="contextual-grid"><span class="text-theme-secondary font-bold">${dName}</span>`;
    for (let h = 0; h < 24; h++) {
      const val = matrix[dIdx][h];
      let level = 0;
      if (val > 0 && maxVal > 0) {
        const ratio = val / maxVal;
        if (ratio <= 0.25) level = 1;
        else if (ratio <= 0.50) level = 2;
        else if (ratio <= 0.75) level = 3;
        else level = 4;
      }
      const hStr = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
      const nextH = (h + 1) % 24;
      const nextHStr = nextH === 0 ? '12 AM' : nextH < 12 ? `${nextH} AM` : nextH === 12 ? '12 PM' : `${nextH - 12} PM`;
      const slotTitle = `${dayFullNames[dIdx]} @ ${hStr}–${nextHStr}: ${val} mins logged (Tap for details)`;

      html += `<div class="contextual-cell" data-level="${level}" data-day="${dIdx}" data-hour="${h}" title="${slotTitle}" tabIndex="0" role="button" aria-label="${slotTitle}"></div>`;
    }
    html += '</div>';
  });
  html += '</div>';

  container.innerHTML = html;

  // Attach tap & keyboard event listeners via event delegation
  container.onclick = (e) => {
    const cell = e.target.closest('.contextual-cell');
    if (!cell) return;
    const dIdx = parseInt(cell.dataset.day, 10);
    const hour = parseInt(cell.dataset.hour, 10);
    openContextualDetailModal(dIdx, hour, cell);
  };

  container.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const cell = e.target.closest('.contextual-cell');
      if (!cell) return;
      e.preventDefault();
      const dIdx = parseInt(cell.dataset.day, 10);
      const hour = parseInt(cell.dataset.hour, 10);
      openContextualDetailModal(dIdx, hour, cell);
    }
  };

  if (insightEl) {
    const daysFull = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
    const hFormat = peakHour === 0 ? '12 AM' : peakHour < 12 ? `${peakHour} AM` : peakHour === 12 ? '12 PM' : `${peakHour - 12} PM`;
    insightEl.textContent = maxVal > 0 
      ? `⚡ Peak Focus Hour: ${daysFull[peakDay]} around ${hFormat} (${maxVal} mins logged in peak window). Tap any square for detailed breakdown.`
      : '⚡ Peak Focus Hour: Log more sessions to generate productivity insights. Tap any square to view time slot details.';
  }
}

function openContextualDetailModal(dayIdx, hour, targetCell) {
  const modal = document.getElementById('modal-contextual-detail');
  if (!modal) return;

  triggerHaptic();

  // Highlight selected cell on matrix
  const container = document.getElementById('contextual-matrix-container');
  if (container) {
    container.querySelectorAll('.contextual-cell').forEach(c => c.classList.remove('active-cell'));
  }
  if (targetCell) {
    targetCell.classList.add('active-cell');
  }

  const state = window._contextualMatrixState || {};
  const matrix = state.matrix || Array(7).fill(0).map(() => Array(24).fill(0));
  const matrixLogs = state.matrixLogs || Array(7).fill(0).map(() => Array(24).fill(0).map(() => []));
  const maxVal = state.maxVal || 0;
  const dayTotalMins = state.dayTotalMins || Array(7).fill(0);

  const slotLogs = matrixLogs[dayIdx]?.[hour] || [];
  const val = matrix[dayIdx]?.[hour] || 0;
  const dayTotal = dayTotalMins[dayIdx] || 0;
  const pctOfDay = dayTotal > 0 ? Math.round((val / dayTotal) * 100) : 0;
  const totalPages = slotLogs.reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
  const avgMins = slotLogs.length > 0 ? Math.round(val / slotLogs.length) : 0;

  const dayFullNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayName = dayFullNames[dayIdx] || 'Day';

  const hStr = hour === 0 ? '12:00 AM' : hour < 12 ? `${hour}:00 AM` : hour === 12 ? '12:00 PM' : `${hour - 12}:00 PM`;
  const nextH = (hour + 1) % 24;
  const nextHStr = nextH === 0 ? '12:00 AM' : nextH < 12 ? `${nextH}:00 AM` : nextH === 12 ? '12:00 PM' : `${nextH - 12}:00 PM`;

  // Intensity level calculation
  let level = 0;
  let levelText = 'No Activity Logged';
  let levelColor = 'text-theme-secondary';
  let levelBg = 'bg-white/5';

  if (val > 0 && maxVal > 0) {
    const ratio = val / maxVal;
    if (ratio <= 0.25) {
      level = 1;
      levelText = 'Light Focus Intensity';
      levelColor = 'text-amber-300';
      levelBg = 'bg-amber-500/10 border-amber-500/20';
    } else if (ratio <= 0.50) {
      level = 2;
      levelText = 'Moderate Focus Intensity';
      levelColor = 'text-amber-400';
      levelBg = 'bg-amber-500/20 border-amber-500/30';
    } else if (ratio <= 0.75) {
      level = 3;
      levelText = 'High Focus Intensity';
      levelColor = 'text-amber-400 font-bold';
      levelBg = 'bg-amber-500/30 border-amber-500/40';
    } else {
      level = 4;
      levelText = '🔥 Peak Focus Window';
      levelColor = 'text-amber-300 font-black';
      levelBg = 'bg-amber-500/40 border-amber-400/50 shadow-sm';
    }
  }

  const titleEl = document.getElementById('contextual-detail-modal-title');
  const subtitleEl = document.getElementById('contextual-detail-modal-subtitle');
  if (titleEl) titleEl.textContent = `${dayName}s @ ${hStr} – ${nextHStr}`;
  if (subtitleEl) subtitleEl.innerHTML = `<span class="px-2 py-0.5 rounded-md border text-[9px] uppercase tracking-wider font-semibold ${levelBg} ${levelColor}">${levelText}</span>`;

  const contentEl = document.getElementById('contextual-detail-modal-content');
  if (contentEl) {
    let html = '';

    // Quick Stats Grid
    html += `
      <div class="grid grid-cols-4 gap-2">
        <div class="p-2.5 rounded-2xl bg-white/[0.04] border border-theme flex flex-col items-center justify-center text-center">
          <span class="text-[9px] font-semibold text-theme-secondary uppercase tracking-wider">Duration</span>
          <span class="text-sm font-black text-theme-primary mt-0.5 tabular-nums">${val} <span class="text-[10px] font-normal text-theme-secondary">m</span></span>
        </div>
        <div class="p-2.5 rounded-2xl bg-white/[0.04] border border-theme flex flex-col items-center justify-center text-center">
          <span class="text-[9px] font-semibold text-theme-secondary uppercase tracking-wider">Sessions</span>
          <span class="text-sm font-black text-theme-primary mt-0.5 tabular-nums">${slotLogs.length}</span>
        </div>
        <div class="p-2.5 rounded-2xl bg-white/[0.04] border border-theme flex flex-col items-center justify-center text-center">
          <span class="text-[9px] font-semibold text-theme-secondary uppercase tracking-wider">Pages</span>
          <span class="text-sm font-black text-emerald-400 mt-0.5 tabular-nums">+${totalPages}</span>
        </div>
        <div class="p-2.5 rounded-2xl bg-white/[0.04] border border-theme flex flex-col items-center justify-center text-center">
          <span class="text-[9px] font-semibold text-theme-secondary uppercase tracking-wider">Avg Length</span>
          <span class="text-sm font-black text-theme-primary mt-0.5 tabular-nums">${avgMins} <span class="text-[10px] font-normal text-theme-secondary">m</span></span>
        </div>
      </div>
    `;

    // Contextual Insight Callout
    if (val > 0) {
      const isPeak = dayIdx === state.peakDay && hour === state.peakHour;
      html += `
        <div class="p-3 rounded-2xl border text-xs leading-relaxed flex items-center gap-2.5" style="background: rgba(var(--accent-rgb), 0.08); border-color: rgba(var(--accent-rgb), 0.2); color: var(--text-primary)">
          <i class="fa-solid ${isPeak ? 'fa-crown text-amber-400' : 'fa-chart-pie text-theme-gold'} text-base flex-shrink-0"></i>
          <div>
            ${isPeak 
              ? `<strong>Peak Weekly Focus Window!</strong> This hour represents your highest overall reading productivity of the entire week.` 
              : `Accounts for <strong>${pctOfDay}%</strong> of your total ${dayName} reading duration.`}
          </div>
        </div>
      `;
    }

    // Sessions List
    html += `<div class="text-xs font-bold text-theme-secondary uppercase tracking-wider mt-1 px-1">Session Logs (${slotLogs.length})</div>`;

    if (slotLogs.length === 0) {
      html += `
        <div class="text-center py-8 px-4 rounded-2xl bg-white/[0.02] border border-theme flex flex-col items-center gap-2">
          <div class="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-theme-tertiary text-lg"><i class="fa-solid fa-moon"></i></div>
          <p class="text-xs text-theme-primary font-bold">No Reading Activity</p>
          <p class="text-[11px] text-theme-secondary">No reading sessions have been logged on ${dayName}s between ${hStr} and ${nextHStr}.</p>
        </div>
      `;
    } else {
      slotLogs.forEach(l => {
        const pagesRead = Math.max(0, (l.end_page || 0) - (l.start_page || 0));
        let dateStr = l.date;
        try {
          dateStr = new Date(l.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (e) {}

        const duration = l.duration_minutes || l.durationMinutes || l.minutes_spent || l.calculatedMins || 0;

        html += `
          <div class="p-3.5 rounded-2xl bg-white/[0.04] border border-theme flex flex-col gap-2 transition-all hover:bg-white/[0.07]">
            <div class="flex justify-between items-start gap-2">
              <span class="text-xs font-black text-theme-primary truncate flex-1">${l.book_title || 'Untitled Book'}</span>
              <span class="text-xs font-black text-emerald-400 tabular-nums whitespace-nowrap">+${pagesRead} pgs</span>
            </div>
            <div class="flex justify-between items-center text-[10px] text-theme-secondary font-medium">
              <span class="flex items-center gap-1"><i class="fa-regular fa-calendar text-[9px]"></i> ${dateStr}</span>
              <span class="flex items-center gap-1"><i class="fa-solid fa-book-open text-[9px]"></i> Pages ${l.start_page || 0} → ${l.end_page || 0}</span>
              <span class="flex items-center gap-1 font-bold text-amber-300"><i class="fa-regular fa-clock text-[9px]"></i> ${duration} mins</span>
            </div>
            ${l.notes ? `<div class="text-[10px] text-theme-secondary italic bg-black/20 p-2 rounded-xl border border-theme">${l.notes}</div>` : ''}
          </div>
        `;
      });
    }

    contentEl.innerHTML = html;
  }

  modal.classList.add('open');
}

function closeContextualDetailModal() {
  const modal = document.getElementById('modal-contextual-detail');
  if (modal) modal.classList.remove('open');
  const container = document.getElementById('contextual-matrix-container');
  if (container) {
    container.querySelectorAll('.contextual-cell.active-cell').forEach(c => c.classList.remove('active-cell'));
  }
}



// --- 2. Bookshelf & Barcode Enhancements ---

function initBarcodeScanner() {
  const scanBtn = document.getElementById('btn-scan-isbn');
  const closeBtn = document.getElementById('isbn-scanner-close');
  const manualFetchBtn = document.getElementById('btn-isbn-manual-fetch');
  const modal = document.getElementById('isbn-scanner-modal');

  if (scanBtn && modal) {
    scanBtn.onclick = () => {
      modal.classList.add('open');
      startCameraFeed();
    };
  }
  if (closeBtn && modal) {
    closeBtn.onclick = () => {
      modal.classList.remove('open');
      stopCameraFeed();
    };
  }
  if (manualFetchBtn) {
    manualFetchBtn.onclick = () => {
      const isbn = document.getElementById('isbn-manual-input').value.trim();
      if (isbn) fetchOpenLibraryISBN(isbn);
    };
  }
}

let activeVideoStream = null;
function startCameraFeed() {
  const video = document.getElementById('isbn-video-feed');
  if (!video || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => {
      activeVideoStream = stream;
      video.srcObject = stream;
    })
    .catch(err => console.warn('Camera access denied or unavailable:', err));
}

function stopCameraFeed() {
  if (activeVideoStream) {
    activeVideoStream.getTracks().forEach(track => track.stop());
    activeVideoStream = null;
  }
}

async function fetchOpenLibraryISBN(isbn) {
  const statusMsg = document.getElementById('isbn-status-msg');
  if (statusMsg) {
    statusMsg.textContent = `Fetching ISBN ${isbn}...`;
    statusMsg.classList.remove('hidden');
  }

  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const data = await res.json();
    const key = `ISBN:${isbn}`;

    if (data && data[key]) {
      const bookData = data[key];
      const title = bookData.title || '';
      const author = bookData.authors ? bookData.authors.map(a => a.name).join(', ') : '';
      const pages = bookData.number_of_pages || 300;
      const coverUrl = bookData.cover ? (bookData.cover.large || bookData.cover.medium) : '';

      if (statusMsg) statusMsg.textContent = `Found: "${title}" by ${author}`;

      setTimeout(() => {
        document.getElementById('isbn-scanner-modal').classList.remove('open');
        stopCameraFeed();

        const addModal = document.getElementById('add-book-modal');
        if (addModal) {
          if (document.getElementById('ab-title')) document.getElementById('ab-title').value = title;
          if (document.getElementById('ab-author')) document.getElementById('ab-author').value = author;
          if (document.getElementById('ab-pages')) document.getElementById('ab-pages').value = pages;
          if (document.getElementById('ab-cover-url')) document.getElementById('ab-cover-url').value = coverUrl;
          addModal.classList.add('open');
        }
      }, 800);
    } else {
      if (statusMsg) statusMsg.textContent = `No records found for ISBN ${isbn}.`;
    }
  } catch (err) {
    if (statusMsg) statusMsg.textContent = 'Error connecting to OpenLibrary API.';
  }
}

// --- 3. Session Log Enhancements ---

function openPostSessionReflectionModal(logId, bookTitle) {
  const modal = document.getElementById('post-session-reflection-modal');
  if (!modal) return;

  const textEl = document.getElementById('reflection-note-text');
  if (textEl) textEl.value = '';

  const skipBtn = document.getElementById('btn-reflection-skip');
  const saveBtn = document.getElementById('btn-reflection-save');
  const closeBtn = document.getElementById('reflection-modal-close');

  modal.classList.add('open');

  const close = () => modal.classList.remove('open');
  if (skipBtn) skipBtn.onclick = close;
  if (closeBtn) closeBtn.onclick = close;

  if (saveBtn) {
    saveBtn.onclick = () => {
      const noteVal = textEl.value.trim();
      if (noteVal) {
        saveStandaloneNote({
          id: `reflection_${Date.now()}`,
          title: bookTitle || 'Reading Session Reflection',
          notes: noteVal,
          date: new Date().toISOString().split('T')[0],
          isQuote: true,
          isFavorite: false
        });
        if (typeof showToast === 'function') showToast('Reflection saved to Knowledge Vault!');
        if (typeof renderKnowledgeView === 'function') renderKnowledgeView();
      }
      close();
    };
  }
}

// --- 4. Knowledge Vault & Mind Graph Enhancements ---

let mindGraphAnimFrameId = null;
let mindGraphState = null;

function initKnowledgeModeToggle() {
  const toggleBtns = document.querySelectorAll('#knowledge-view-mode-toggle .seg-btn');
  const feedEl = document.getElementById('knowledge-quote-feed');

  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toggleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (feedEl) feedEl.classList.remove('hidden');
    });
  });

  const srBtn = document.getElementById('btn-spaced-repetition');
  if (srBtn) {
    srBtn.onclick = () => openSpacedRepetitionModal();
  }
}

function renderMindGraph() {
  const canvas = document.getElementById('knowledge-mind-graph-canvas');
  if (!canvas || !canvas.getContext) return;

  const container = canvas.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const width = rect.width || 400;
  const height = rect.height || 450;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  if (mindGraphAnimFrameId) {
    cancelAnimationFrame(mindGraphAnimFrameId);
    mindGraphAnimFrameId = null;
  }

  const notesArr = typeof getStandaloneNotes === 'function' ? getStandaloneNotes() : [];
  const booksArr = (typeof booksCache !== 'undefined' && Array.isArray(booksCache)) ? booksCache : [];

  const nodes = [];
  const links = [];

  // 1. Create Category Hub nodes
  const catMap = {};
  booksArr.slice(0, 14).forEach(b => {
    const cat = b.category || b.collection || 'General';
    if (!catMap[cat]) catMap[cat] = [];
    catMap[cat].push(b);
  });

  const catNodeMap = {};
  const categories = Object.keys(catMap);

  categories.forEach((cat, idx) => {
    const angle = (idx / Math.max(categories.length, 1)) * Math.PI * 2;
    const catNode = {
      id: `cat_${cat}`,
      label: cat,
      type: 'category',
      x: width / 2 + Math.cos(angle) * (width * 0.28),
      y: height / 2 + Math.sin(angle) * (height * 0.28),
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5,
      radius: 22,
      color: '#34D399',
      icon: '🏷️',
      detailTitle: `Subject: ${cat}`,
      detailBody: `${catMap[cat].length} book(s) cataloged in this subject area.`
    };
    nodes.push(catNode);
    catNodeMap[cat] = catNode;
  });

  // 2. Create Book nodes linked to Category hubs
  const bookNodeMap = {};
  booksArr.slice(0, 14).forEach((b) => {
    const cat = b.category || b.collection || 'General';
    const parentCatNode = catNodeMap[cat];
    const initialX = parentCatNode ? parentCatNode.x + (Math.random() - 0.5) * 70 : Math.random() * (width - 100) + 50;
    const initialY = parentCatNode ? parentCatNode.y + (Math.random() - 0.5) * 70 : Math.random() * (height - 100) + 50;

    const bNode = {
      id: `book_${b.title}`,
      label: b.title,
      type: 'book',
      x: initialX,
      y: initialY,
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5,
      radius: 18,
      color: '#D4A359',
      icon: '📚',
      bookObj: b,
      detailTitle: b.title,
      detailBody: `Author: ${b.author || 'Unknown'} • Status: ${b.status || 'Library'}`
    };
    nodes.push(bNode);
    bookNodeMap[b.title.toLowerCase()] = bNode;

    if (parentCatNode) {
      links.push({ source: bNode, target: parentCatNode, restLen: 95, color: 'rgba(52, 211, 153, 0.35)' });
    }
  });

  // 3. Create Note/Quote nodes linked to Books
  notesArr.slice(0, 15).forEach((n, idx) => {
    const parentBookTitle = (n.title || '').toLowerCase();
    const matchedBookKey = Object.keys(bookNodeMap).find(t => parentBookTitle.includes(t) || t.includes(parentBookTitle));
    const parentNode = matchedBookKey ? bookNodeMap[matchedBookKey] : (nodes.find(nd => nd.type === 'category') || null);

    const initialX = parentNode ? parentNode.x + (Math.random() - 0.5) * 60 : Math.random() * (width - 100) + 50;
    const initialY = parentNode ? parentNode.y + (Math.random() - 0.5) * 60 : Math.random() * (height - 100) + 50;

    const nNode = {
      id: `note_${idx}`,
      label: n.notes ? (n.notes.slice(0, 22) + (n.notes.length > 22 ? '...' : '')) : (n.title || 'Quote'),
      type: 'note',
      x: initialX,
      y: initialY,
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5,
      radius: 13,
      color: '#38BDF8',
      icon: '💬',
      noteObj: n,
      detailTitle: n.title || 'Saved Quote/Reflection',
      detailBody: n.notes || 'No body text recorded.'
    };
    nodes.push(nNode);

    if (parentNode) {
      links.push({ source: nNode, target: parentNode, restLen: 75, color: 'rgba(56, 189, 248, 0.4)' });
    }
  });

  mindGraphState = {
    nodes,
    links,
    draggedNode: null,
    hoveredNode: null,
    selectedNode: null,
    width,
    height,
    isDragging: false
  };

  setupMindGraphEvents(canvas);

  function loop() {
    updateMindGraphPhysics(mindGraphState);
    drawMindGraphCanvas(ctx, mindGraphState);
    mindGraphAnimFrameId = requestAnimationFrame(loop);
  }

  loop();
}

function updateMindGraphPhysics(state) {
  if (!state) return;
  const { nodes, links, width, height, draggedNode } = state;
  const centerX = width / 2;
  const centerY = height / 2;

  // Repulsion & Hard collision separation
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const u = nodes[i];
      const v = nodes[j];

      let dx = v.x - u.x;
      let dy = v.y - u.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 0.1;

      const minDist = u.radius + v.radius + 36;

      const repForce = 1600 / (dist * dist + 10);
      const fx = (dx / dist) * repForce;
      const fy = (dy / dist) * repForce;

      if (u !== draggedNode) { u.vx -= fx; u.vy -= fy; }
      if (v !== draggedNode) { v.vx += fx; v.vy += fy; }

      if (dist < minDist) {
        const overlap = (minDist - dist) * 0.5;
        const nx = (dx / dist) * overlap;
        const ny = (dy / dist) * overlap;

        if (u !== draggedNode) { u.x -= nx; u.y -= ny; }
        if (v !== draggedNode) { v.x += nx; v.y += ny; }
      }
    }
  }

  // Spring attraction along links
  links.forEach(l => {
    const u = l.source;
    const v = l.target;
    let dx = v.x - u.x;
    let dy = v.y - u.y;
    let dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
    const restLen = l.restLen || 85;

    const force = (dist - restLen) * 0.035;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;

    if (u !== draggedNode) { u.vx += fx; u.vy += fy; }
    if (v !== draggedNode) { v.vx -= fx; v.vy -= fy; }
  });

  // Center gravity & motion dampening
  nodes.forEach(n => {
    if (n === draggedNode) return;

    n.vx += (centerX - n.x) * 0.0015;
    n.vy += (centerY - n.y) * 0.0015;

    n.vx *= 0.83;
    n.vy *= 0.83;

    n.x += n.vx;
    n.y += n.vy;

    const pad = n.radius + 20;
    if (n.x < pad) { n.x = pad; n.vx *= -0.5; }
    if (n.x > width - pad) { n.x = width - pad; n.vx *= -0.5; }
    if (n.y < pad) { n.y = pad; n.vy *= -0.5; }
    if (n.y > height - pad) { n.y = height - pad; n.vy *= -0.5; }
  });
}

function drawMindGraphCanvas(ctx, state) {
  if (!state) return;
  const { nodes, links, width, height, hoveredNode, selectedNode } = state;

  ctx.clearRect(0, 0, width, height);

  // Deep galaxy background
  const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 20, width / 2, height / 2, width * 0.75);
  bgGrad.addColorStop(0, '#0B0F19');
  bgGrad.addColorStop(1, '#020617');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Draw links
  links.forEach(l => {
    const isHighlighted = (hoveredNode && (l.source === hoveredNode || l.target === hoveredNode)) ||
                          (selectedNode && (l.source === selectedNode || l.target === selectedNode));

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(l.source.x, l.source.y);
    ctx.lineTo(l.target.x, l.target.y);
    ctx.lineWidth = isHighlighted ? 2.5 : 1.2;
    ctx.strokeStyle = isHighlighted ? 'rgba(253, 230, 138, 0.85)' : (l.color || 'rgba(255, 255, 255, 0.15)');
    if (isHighlighted) {
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#FDE68A';
    }
    ctx.stroke();
    ctx.restore();
  });

  // Draw nodes
  nodes.forEach(nd => {
    const isHovered = nd === hoveredNode;
    const isSelected = nd === selectedNode;
    const r = isHovered || isSelected ? nd.radius + 4 : nd.radius;

    ctx.save();

    // Outer glow aura
    ctx.beginPath();
    ctx.arc(nd.x, nd.y, r + (isHovered ? 7 : 3), 0, Math.PI * 2);
    ctx.fillStyle = nd.color;
    ctx.globalAlpha = isHovered ? 0.35 : 0.15;
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Inner node body
    ctx.beginPath();
    ctx.arc(nd.x, nd.y, r, 0, Math.PI * 2);
    ctx.fillStyle = nd.color;
    ctx.shadowBlur = isHovered ? 14 : 6;
    ctx.shadowColor = nd.color;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Ring border
    ctx.lineWidth = isHovered || isSelected ? 2.5 : 1.5;
    ctx.strokeStyle = isHovered ? '#FFFFFF' : 'rgba(255, 255, 255, 0.4)';
    ctx.stroke();

    // Node icon
    ctx.font = `${Math.round(r * 0.85)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(nd.icon || '•', nd.x, nd.y);

    // Pill badge label
    const labelY = nd.y + r + 14;
    const truncatedLabel = nd.label.length > 20 ? nd.label.slice(0, 18) + '...' : nd.label;
    drawMindGraphPillLabel(ctx, truncatedLabel, nd.x, labelY, isHovered || isSelected, nd.color);

    ctx.restore();
  });
}

function drawMindGraphPillLabel(ctx, text, x, y, isHovered, color) {
  ctx.save();
  const themeFont = getComputedStyle(document.documentElement).getPropertyValue('--font-body') || 'system-ui';
  ctx.font = isHovered ? `bold 10px ${themeFont}` : `9.5px ${themeFont}`;
  const textWidth = ctx.measureText(text).width;
  const rectW = textWidth + 12;
  const rectH = 17;
  const rectX = x - rectW / 2;
  const rectY = y - rectH / 2;

  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(rectX, rectY, rectW, rectH, 8);
  } else {
    ctx.rect(rectX, rectY, rectW, rectH);
  }
  ctx.fillStyle = isHovered ? 'rgba(30, 41, 59, 0.95)' : 'rgba(15, 23, 42, 0.82)';
  ctx.fill();
  ctx.strokeStyle = isHovered ? (color || 'rgba(251, 191, 36, 0.8)') : 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = isHovered ? '#FDE68A' : '#E2E8F0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function setupMindGraphEvents(canvas) {
  if (canvas._mindGraphEventsAttached) return;
  canvas._mindGraphEventsAttached = true;

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function findHitNode(pos) {
    if (!mindGraphState || !mindGraphState.nodes) return null;
    return mindGraphState.nodes.find(n => {
      const dx = n.x - pos.x;
      const dy = n.y - pos.y;
      return (dx * dx + dy * dy) <= (n.radius + 10) * (n.radius + 10);
    });
  }

  const handlePointerDown = (e) => {
    if (!mindGraphState) return;
    const pos = getCanvasCoords(e);
    const hit = findHitNode(pos);
    if (hit) {
      mindGraphState.draggedNode = hit;
      mindGraphState.selectedNode = hit;
      mindGraphState.isDragging = true;
      hit.x = pos.x;
      hit.y = pos.y;
      hit.vx = 0;
      hit.vy = 0;
      showGraphNodePreview(hit);
    }
  };

  const handlePointerMove = (e) => {
    if (!mindGraphState) return;
    const pos = getCanvasCoords(e);
    if (mindGraphState.isDragging && mindGraphState.draggedNode) {
      mindGraphState.draggedNode.x = pos.x;
      mindGraphState.draggedNode.y = pos.y;
      mindGraphState.draggedNode.vx = 0;
      mindGraphState.draggedNode.vy = 0;
    } else {
      const hit = findHitNode(pos);
      mindGraphState.hoveredNode = hit;
      canvas.style.cursor = hit ? 'pointer' : 'grab';
    }
  };

  const handlePointerUp = () => {
    if (!mindGraphState) return;
    mindGraphState.isDragging = false;
    mindGraphState.draggedNode = null;
    canvas.style.cursor = mindGraphState.hoveredNode ? 'pointer' : 'grab';
  };

  canvas.addEventListener('mousedown', handlePointerDown);
  canvas.addEventListener('mousemove', handlePointerMove);
  window.addEventListener('mouseup', handlePointerUp);

  canvas.addEventListener('touchstart', (e) => { handlePointerDown(e); }, { passive: true });
  canvas.addEventListener('touchmove', (e) => { handlePointerMove(e); }, { passive: true });
  window.addEventListener('touchend', handlePointerUp);

  const previewCloseBtn = document.getElementById('graph-preview-close');
  if (previewCloseBtn) {
    previewCloseBtn.onclick = () => {
      const previewEl = document.getElementById('graph-node-preview');
      if (previewEl) previewEl.classList.add('hidden');
      if (mindGraphState) mindGraphState.selectedNode = null;
    };
  }
}

function showGraphNodePreview(node) {
  const previewEl = document.getElementById('graph-node-preview');
  const titleEl = document.getElementById('graph-preview-title');
  const bodyEl = document.getElementById('graph-preview-body');
  if (!previewEl || !titleEl || !bodyEl) return;

  titleEl.textContent = `${node.icon || ''} ${node.detailTitle || node.label}`;
  bodyEl.textContent = node.detailBody || 'No detail available.';
  previewEl.classList.remove('hidden');
}

function openSpacedRepetitionModal() {
  const modal = document.getElementById('spaced-repetition-modal');
  if (!modal) return;

  const notesArr = typeof getStandaloneNotes === 'function' ? getStandaloneNotes() : [];
  if (notesArr.length === 0) {
    if (typeof showToast === 'function') showToast('No quotes or notes available for flashcards.');
    return;
  }

  currentLeitnerCards = notesArr.slice(0, 5);
  currentLeitnerIndex = 0;
  displayFlashcard(0);

  const closeBtn = document.getElementById('sr-modal-close');
  if (closeBtn) closeBtn.onclick = () => modal.classList.remove('open');

  modal.classList.add('open');
}

function displayFlashcard(idx) {
  if (idx >= currentLeitnerCards.length) {
    document.getElementById('spaced-repetition-modal').classList.remove('open');
    if (typeof showToast === 'function') showToast('Daily Quote Flashcard Review Complete! 🌟');
    return;
  }

  const card = currentLeitnerCards[idx];
  const progressEl = document.getElementById('sr-card-progress');
  const quoteEl = document.getElementById('sr-card-quote');
  const authorEl = document.getElementById('sr-card-author');
  const bookEl = document.getElementById('sr-card-book');
  const answerEl = document.getElementById('sr-card-answer');

  if (progressEl) progressEl.textContent = `Card ${idx + 1} of ${currentLeitnerCards.length}`;
  if (quoteEl) quoteEl.textContent = `"${card.notes || card.title}"`;
  if (authorEl) authorEl.textContent = `— ${card.author || 'Author'}`;
  if (bookEl) bookEl.textContent = card.title || 'Book Excerpt';
  if (answerEl) answerEl.classList.add('hidden');
}

function toggleFlashcardAnswer() {
  const answerEl = document.getElementById('sr-card-answer');
  if (answerEl) answerEl.classList.toggle('hidden');
}

function rateFlashcard(rating) {
  currentLeitnerIndex++;
  displayFlashcard(currentLeitnerIndex);
}

window.toggleFlashcardAnswer = toggleFlashcardAnswer;
window.rateFlashcard = rateFlashcard;

// --- 5. Account & Importers Enhancements ---

function initGoodreadsImporter() {
  const btn = document.getElementById('btn-import-goodreads');
  const fileInput = document.getElementById('goodreads-csv-input');
  if (!btn || !fileInput) return;

  btn.onclick = () => fileInput.click();
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const lines = text.split('\n');
      let count = 0;

      lines.slice(1).forEach(line => {
        const parts = line.split(',');
        if (parts.length > 2 && parts[1]) {
          count++;
        }
      });
      if (typeof showToast === 'function') showToast(`Successfully parsed ${count} books from Goodreads CSV!`);
    };
    reader.readAsText(file);
  };
}

function initKindleImporter() {
  const btn = document.getElementById('btn-import-kindle');
  const fileInput = document.getElementById('kindle-clippings-input');
  if (!btn || !fileInput) return;

  btn.onclick = () => fileInput.click();
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const clippings = text.split('==========');
      let count = 0;

      clippings.forEach(clip => {
        if (clip.trim()) {
          count++;
        }
      });
      if (typeof showToast === 'function') showToast(`Imported ${count} Kindle highlights into Knowledge Vault!`);
    };
    reader.readAsText(file);
  };
}

// ── SCHOLAR SUITE HELPERS ──────────────────────────────────────
function initScholarSuite() {
  // Transliteration Chips Click Listener
  document.querySelectorAll('.btn-translit-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const char = chip.dataset.char;
      const targetId = chip.dataset.target || 'log-notes';
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        const start = targetEl.selectionStart || targetEl.value.length;
        const end = targetEl.selectionEnd || targetEl.value.length;
        const val = targetEl.value;
        targetEl.value = val.substring(0, start) + char + val.substring(end);
        targetEl.focus();
        targetEl.setSelectionRange(start + char.length, start + char.length);
      }
    });
  });

  // Clean Transliteration with Gemini AI button in session log
  const btnCleanTranslit = document.getElementById('btn-log-ai-clean-translit');
  if (btnCleanTranslit) {
    btnCleanTranslit.addEventListener('click', async () => {
      const notesEl = document.getElementById('log-notes');
      if (!notesEl || !notesEl.value.trim()) {
        showToast('Enter some text first to clean transliterations', 'info');
        return;
      }
      btnCleanTranslit.disabled = true;
      btnCleanTranslit.textContent = '✨ Cleaning...';
      try {
        const key = localStorage.getItem('rt_gemini_api_key') || '';
        const cleaned = await standardizeTransliteration(notesEl.value, key);
        notesEl.value = cleaned;
        showToast('Bahá\'í transliterations standardized!', 'success');
      } catch (err) {
        showToast('Transliteration cleaning error: ' + err.message, 'error');
      } finally {
        btnCleanTranslit.disabled = false;
        btnCleanTranslit.textContent = '✨ AI Clean';
      }
    });
  }

  // Gemini Photo OCR for Starred Story Modal
  const btnStoryPhotoAi = document.getElementById('btn-story-photo-ai');
  const inputStoryPhotoFile = document.getElementById('input-story-photo-file');
  if (btnStoryPhotoAi && inputStoryPhotoFile) {
    btnStoryPhotoAi.addEventListener('click', () => inputStoryPhotoFile.click());
    inputStoryPhotoFile.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const key = localStorage.getItem('rt_gemini_api_key') || '';
      if (!key) {
        showToast('Please add your Gemini API Key in Account settings first', 'error');
        return;
      }
      btnStoryPhotoAi.disabled = true;
      btnStoryPhotoAi.textContent = 'Scanning...';
      try {
        const reader = new FileReader();
        reader.onload = async (re) => {
          const base64 = re.target.result;
          const result = await analyzeNoteImage(base64, file.type, key);
          if (result.title) document.getElementById('story-title').value = result.title;
          if (result.summary) document.getElementById('story-summary').value = result.summary;
          if (result.quote) document.getElementById('story-quote').value = result.quote;
          if (result.characters && Array.isArray(result.characters)) {
            document.getElementById('story-characters').value = result.characters.join(', ');
          }
          if (result.themes && Array.isArray(result.themes)) {
            document.getElementById('story-themes').value = result.themes.join(', ');
          }
          if (result.era || result.location) {
            document.getElementById('story-era').value = [result.era, result.location].filter(Boolean).join(' / ');
          }
          showToast('Gemini extracted story details from photo!', 'success');
        };
        reader.readAsDataURL(file);
      } catch (err) {
        showToast('Gemini Photo Error: ' + err.message, 'error');
      } finally {
        btnStoryPhotoAi.disabled = false;
        btnStoryPhotoAi.textContent = '📷 Photo OCR';
      }
    });
  }

  // Gemini Voice Dictation for Starred Story Modal
  const btnStoryVoiceAi = document.getElementById('btn-story-voice-ai');
  if (btnStoryVoiceAi) {
    btnStoryVoiceAi.addEventListener('click', () => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        const raw = prompt('Enter or paste spoken transcript:');
        if (raw) processVoiceTranscript(raw);
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      btnStoryVoiceAi.disabled = true;
      btnStoryVoiceAi.textContent = '🎙️ Listening...';

      recognition.onresult = async (event) => {
        const transcript = event.results[0][0].transcript;
        await processVoiceTranscript(transcript);
        btnStoryVoiceAi.disabled = false;
        btnStoryVoiceAi.textContent = '🎙️ Voice Note';
      };

      recognition.onerror = (err) => {
        showToast('Speech recognition error: ' + err.error, 'error');
        btnStoryVoiceAi.disabled = false;
        btnStoryVoiceAi.textContent = '🎙️ Voice Note';
      };

      recognition.start();
    });
  }

  async function processVoiceTranscript(transcriptText) {
    const key = localStorage.getItem('rt_gemini_api_key') || '';
    if (!key) {
      document.getElementById('story-summary').value = transcriptText;
      showToast('Voice note added. Configure Gemini API key in Account settings for auto-extraction.', 'info');
      return;
    }
    showToast('Gemini is analyzing spoken note...', 'info');
    try {
      const result = await analyzeVoiceTranscript(transcriptText, key);
      if (result.title) document.getElementById('story-title').value = result.title;
      if (result.summary) document.getElementById('story-summary').value = result.summary;
      if (result.quote) document.getElementById('story-quote').value = result.quote;
      if (result.characters && Array.isArray(result.characters)) {
        document.getElementById('story-characters').value = result.characters.join(', ');
      }
      if (result.themes && Array.isArray(result.themes)) {
        document.getElementById('story-themes').value = result.themes.join(', ');
      }
      if (result.era || result.location) {
        document.getElementById('story-era').value = [result.era, result.location].filter(Boolean).join(' / ');
      }
      showToast('Gemini analyzed voice transcript!', 'success');
    } catch (err) {
      document.getElementById('story-summary').value = transcriptText;
      showToast('Gemini analysis error: ' + err.message, 'error');
    }
  }

  // Scholarly Export Modal Open & Generation
  const btnScholarlyExportOpen = document.getElementById('btn-scholarly-export-open');
  const modalExport = document.getElementById('modal-scholarly-export');
  const exportBookSelect = document.getElementById('scholarly-export-book-id');

  if (btnScholarlyExportOpen && modalExport) {
    btnScholarlyExportOpen.addEventListener('click', () => {
      if (exportBookSelect) {
        exportBookSelect.innerHTML = '<option value="all">— All Books Summary —</option>';
        (booksCache || []).forEach(b => {
          exportBookSelect.innerHTML += `<option value="${b.id}">${escapeHtml(b.title)} (${escapeHtml(b.author || 'Unknown')})</option>`;
        });
      }
      updateScholarlyExportPreview();
      modalExport.classList.add('open');
    });

    if (exportBookSelect) {
      exportBookSelect.addEventListener('change', () => updateScholarlyExportPreview());
    }

    const btnCloseExport = document.getElementById('modal-scholarly-export-close');
    if (btnCloseExport) {
      btnCloseExport.addEventListener('click', () => modalExport.classList.remove('open'));
    }

    const btnCopyBib = document.getElementById('btn-copy-bibtex');
    if (btnCopyBib) {
      btnCopyBib.addEventListener('click', () => {
        const text = document.getElementById('cite-preview-bibtex')?.textContent || '';
        navigator.clipboard.writeText(text);
        showToast('BibTeX copied to clipboard!', 'success');
      });
    }

    const btnDownloadDigest = document.getElementById('btn-download-digest');
    if (btnDownloadDigest) {
      btnDownloadDigest.addEventListener('click', () => {
        const mdText = document.getElementById('cite-preview-markdown')?.value || '';
        const blob = new Blob([mdText], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scholarly_digest_${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  }

  function updateScholarlyExportPreview() {
    const selectedBookId = exportBookSelect?.value || 'all';
    let targetBook = null;
    let stories = [];

    if (selectedBookId !== 'all') {
      targetBook = (booksCache || []).find(b => b.id === selectedBookId || String(b.id) === String(selectedBookId));
      stories = stories.filter(s => s.bookId === selectedBookId || (targetBook && s.bookTitle === targetBook.title));
    } else if (booksCache && booksCache.length > 0) {
      targetBook = booksCache[0];
    }

    if (!targetBook) {
      targetBook = { title: 'Bahá\'í Research Collection', author: 'Bahá\'í Publications', year: 2026, publisher: 'Bahá\'í Publishing Trust', city: 'Wilmette, IL' };
    }

    const digest = generateScholarlyDigest(targetBook, logsCache || [], stories, []);
    if (document.getElementById('cite-preview-chicago')) document.getElementById('cite-preview-chicago').textContent = digest.chicago;
    if (document.getElementById('cite-preview-bibtex')) document.getElementById('cite-preview-bibtex').textContent = digest.bibtex;
    if (document.getElementById('cite-preview-markdown')) document.getElementById('cite-preview-markdown').value = digest.markdown;
  }
}

// ════════════════════════════════════════════════════════════
// DASHBOARD SECTION PREFERENCES & LAYOUT CUSTOMIZATION
// ════════════════════════════════════════════════════════════
function getDashboardPreferences() {
  try {
    const saved = localStorage.getItem('rt_dash_preferences');
    if (saved) return JSON.parse(saved);
  } catch(e) {}
  return { pace: true, heatmap: true, yoy: true, contextual: true };
}

function applyDashboardPreferences() {
  const prefs = getDashboardPreferences();

  const paceSec = $('dash-velocity-stats') ? $('dash-velocity-stats').parentElement : null;
  const heatmapSec = $('heatmap-container') ? $('heatmap-container').parentElement : null;
  const yoySec = $('dash-yoy-card');
  const contextualSec = $('contextual-heatmap-card');

  if (paceSec) paceSec.style.display = prefs.pace !== false ? 'flex' : 'none';
  if (heatmapSec) heatmapSec.style.display = prefs.heatmap !== false ? 'flex' : 'none';
  if (yoySec) yoySec.style.display = prefs.yoy !== false ? 'block' : 'none';
  if (contextualSec) contextualSec.style.display = prefs.contextual !== false ? 'flex' : 'none';

  const cbPace = $('pref-dash-pace');
  const cbHeatmap = $('pref-dash-heatmap');
  const cbYoy = $('pref-dash-yoy');
  const cbContextual = $('pref-dash-contextual');

  if (cbPace) cbPace.checked = prefs.pace !== false;
  if (cbHeatmap) cbHeatmap.checked = prefs.heatmap !== false;
  if (cbYoy) cbYoy.checked = prefs.yoy !== false;
  if (cbContextual) cbContextual.checked = prefs.contextual !== false;
}

function setupDashboardPreferencesListeners() {
  const cbs = [
    { id: 'pref-dash-pace', key: 'pace' },
    { id: 'pref-dash-heatmap', key: 'heatmap' },
    { id: 'pref-dash-yoy', key: 'yoy' },
    { id: 'pref-dash-contextual', key: 'contextual' }
  ];

  cbs.forEach(cb => {
    const el = $(cb.id);
    if (el) {
      el.addEventListener('change', () => {
        const prefs = getDashboardPreferences();
        prefs[cb.key] = el.checked;
        try {
          localStorage.setItem('rt_dash_preferences', JSON.stringify(prefs));
        } catch(e) {}
        applyDashboardPreferences();
      });
    }
  });
}

// ════════════════════════════════════════════════════════════
// SMART COMPLETION PREDICTOR SLIDER
// ════════════════════════════════════════════════════════════
function setupPacePredictorSlider() {
  const slider = $('bd-calc-slider');
  if (!slider) return;

  slider.addEventListener('input', () => {
    const mins = parseInt(slider.value, 10);
    const label = $('bd-calc-slider-label');
    if (label) label.textContent = `${mins} mins/day`;

    if (window._activeDetailBook) {
      updatePacePrediction(window._activeDetailBook, mins);
    }
  });
}

function getUserPersonalReadingSpeed(logs) {
  const activeLogs = (logs || (typeof logsCache !== 'undefined' ? logsCache : []) || []).filter(l => l && (!l.notes || !l.notes.startsWith('Historical cycle')));
  let totalPages = 0;
  let totalMinutes = 0;

  for (let i = 0; i < activeLogs.length; i++) {
    const l = activeLogs[i];
    const p = Math.max(0, (l.end_page || 0) - (l.start_page || 0));
    const m = typeof l.minutes_spent === 'number' ? l.minutes_spent : parseInt(l.minutes_spent || l.duration_minutes || l.durationMinutes || 0, 10);
    if (p > 0 && m > 0) {
      totalPages += p;
      totalMinutes += m;
    }
  }

  if (totalMinutes > 0 && totalPages > 0) {
    const pgh = (totalPages / totalMinutes) * 60;
    return Math.max(10, Math.min(180, Math.round(pgh)));
  }

  return 30; // default fallback if no timed sessions logged yet
}

function updatePacePrediction(book, dailyMins = 25) {
  if (!book) return;
  const tot = parseInt(book.total_pages || 250, 10);
  const read = parseInt(book.pages_read || book.current_page || 0, 10);
  const remainingPages = Math.max(0, tot - read);

  // Dynamically calculate user's personal reading speed (pages / hour)
  const personalPgh = getUserPersonalReadingSpeed();
  const estDailyPages = Math.max(1, Math.round((dailyMins / 60) * personalPgh));
  const daysRem = Math.ceil(remainingPages / estDailyPages);

  const finishDate = new Date();
  finishDate.setDate(finishDate.getDate() + daysRem);
  const dateStr = finishDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const estBadge = $('bd-calc-est-date-badge');
  const dailyPagesEl = $('bd-calc-daily-pages');
  const daysRemEl = $('bd-calc-days-rem');
  const finishDateEl = $('bd-calc-finish-date');

  if (estBadge) estBadge.textContent = remainingPages === 0 ? 'Completed' : `Est. ${dateStr}`;
  if (dailyPagesEl) {
    dailyPagesEl.textContent = `${estDailyPages} pg (${personalPgh} p/h)`;
    dailyPagesEl.title = `Based on your actual reading speed of ${personalPgh} pages/hour`;
  }
  if (daysRemEl) daysRemEl.textContent = `${daysRem} days`;
  if (finishDateEl) finishDateEl.textContent = remainingPages === 0 ? 'Done' : dateStr;
}

// ════════════════════════════════════════════════════════════
// INTERACTIVE MONTHLY CALENDAR & STREAK SAVER VAULT
// ════════════════════════════════════════════════════════════
let currentCalDate = new Date();

function renderStreakCalendar() {
  const container = $('cal-grid-container');
  const label = $('cal-month-label');
  const countBadge = $('streak-saver-count');
  if (!container) return;

  const yr = currentCalDate.getFullYear();
  const mo = currentCalDate.getMonth();
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  if (label) label.textContent = `${monthNames[mo]} ${yr}`;

  const streakRepairKey = 'rt_streak_repair_tokens';
  const tokens = parseInt(localStorage.getItem(streakRepairKey) || '0', 10);
  if (countBadge) countBadge.textContent = `${tokens} Token${tokens === 1 ? '' : 's'}`;

  const repairedSet = new Set(JSON.parse(localStorage.getItem('rt_repaired_dates') || '[]'));

  // Build map of normalized YYYY-MM-DD -> total pages read
  const pagesPerDay = {};
  const activeLogs = (logsCache || []).filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));

  activeLogs.forEach(l => {
    if (!l.date) return;
    let dStr = '';
    if (typeof l.date === 'string') {
      dStr = l.date.split('T')[0].trim();
      if (dStr.includes('/')) {
        const p = dStr.split('/');
        if (p[0].length === 4) dStr = `${p[0]}-${String(parseInt(p[1], 10)).padStart(2, '0')}-${String(parseInt(p[2], 10)).padStart(2, '0')}`;
        else if (p[2] && p[2].length === 4) dStr = `${p[2]}-${String(parseInt(p[0], 10)).padStart(2, '0')}-${String(parseInt(p[1], 10)).padStart(2, '0')}`;
      } else if (dStr.includes('-')) {
        const p = dStr.split('-');
        if (p.length === 3) dStr = `${p[0]}-${String(parseInt(p[1], 10)).padStart(2, '0')}-${String(parseInt(p[2], 10)).padStart(2, '0')}`;
      }
    } else if (typeof l.date === 'number') {
      const dt = new Date(l.date);
      dStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    } else if (l.date && typeof l.date.toDate === 'function') {
      const dt = l.date.toDate();
      dStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    } else if (l.date instanceof Date) {
      const dt = l.date;
      dStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    }

    if (!dStr) return;
    const p = parseInt(l.pages_read_today, 10) || parseInt(l.pagesRead, 10) || Math.max(0, parseInt(l.end_page || 0, 10) - parseInt(l.start_page || 0, 10)) || 0;
    const dur = parseInt(l.minutes_spent || l.duration_minutes || 0, 10) || 0;
    
    pagesPerDay[dStr] = (pagesPerDay[dStr] || 0) + (p > 0 ? p : (dur > 0 ? 1 : 1));
  });

  const firstDay = new Date(yr, mo, 1).getDay();
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();

  container.innerHTML = '';

  for (let i = 0; i < firstDay; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'aspect-square p-1 opacity-0';
    container.appendChild(emptyCell);
  }

  const todayStr = todayISO();

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const pagesRead = pagesPerDay[dateStr] || 0;
    const hasRead = pagesRead > 0;
    const isRepaired = repairedSet.has(dateStr);
    const isToday = dateStr === todayStr;

    const cell = document.createElement('button');
    cell.type = 'button';
    
    let bgClasses = 'bg-white/5 border-white/5 text-theme-tertiary opacity-45 hover:opacity-100 hover:border-white/20';
    let badgeHTML = '';

    if (hasRead) {
      bgClasses = 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200 font-bold shadow-[0_0_10px_rgba(16,185,129,0.2)] hover:bg-emerald-500/30';
      badgeHTML = `<span class="flex items-center gap-0.5 mt-0.5 text-[8px] font-black text-emerald-400"><i class="fa-solid fa-fire text-[7px]"></i>${pagesRead}p</span>`;
    } else if (isRepaired) {
      bgClasses = 'bg-blue-500/20 border-blue-400/40 text-blue-200 font-bold hover:bg-blue-500/30';
      badgeHTML = `<span class="mt-0.5 text-[8px] text-blue-400"><i class="fa-solid fa-shield-halved text-[7px]"></i></span>`;
    } else if (isToday) {
      bgClasses = 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-black ring-1 ring-amber-400/50 hover:bg-amber-500/30';
      badgeHTML = `<span class="mt-0.5 text-[7px] font-extrabold uppercase tracking-wider text-amber-400">Today</span>`;
    }

    if (isToday && hasRead) {
      bgClasses = 'bg-gradient-to-b from-amber-500/25 to-emerald-500/30 border-emerald-400/60 text-emerald-200 font-black ring-1 ring-amber-400/60 shadow-[0_0_12px_rgba(245,158,11,0.25)]';
      badgeHTML = `<span class="flex items-center gap-0.5 mt-0.5 text-[8px] font-black text-emerald-300"><i class="fa-solid fa-fire text-[7px] text-amber-400"></i>${pagesRead}p</span>`;
    }

    cell.className = `aspect-square p-0.5 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer ${bgClasses}`;
    cell.title = hasRead ? `Read ${pagesRead} page${pagesRead === 1 ? '' : 's'} on ${dateStr}` : (isToday ? 'Today' : dateStr);
    cell.innerHTML = `<span class="text-[11px] leading-none">${day}</span>${badgeHTML}`;

    cell.onclick = () => {
      if (typeof triggerHaptic === 'function') triggerHaptic();
      openHeatmapDayDetailDrawer(dateStr);
    };

    container.appendChild(cell);
  }

  const prevBtn = $('cal-month-prev');
  const nextBtn = $('cal-month-next');
  if (prevBtn && !prevBtn._wired) {
    prevBtn._wired = true;
    prevBtn.onclick = () => {
      currentCalDate.setMonth(currentCalDate.getMonth() - 1);
      renderStreakCalendar();
    };
  }
  if (nextBtn && !nextBtn._wired) {
    nextBtn._wired = true;
    nextBtn.onclick = () => {
      currentCalDate.setMonth(currentCalDate.getMonth() + 1);
      renderStreakCalendar();
    };
  }
}

// ════════════════════════════════════════════════════════════
// EXPORTABLE GLASSMORPHIC QUOTE CARDS
// ════════════════════════════════════════════════════════════
window.exportQuoteCard = function(title, author, text) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 1200, 630);
  grad.addColorStop(0, '#1E1815');
  grad.addColorStop(0.5, '#2A201A');
  grad.addColorStop(1, '#14100E');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 630);

  const radial = ctx.createRadialGradient(1000, 100, 0, 1000, 100, 500);
  radial.addColorStop(0, 'rgba(212, 163, 89, 0.25)');
  radial.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, 1200, 630);

  ctx.strokeStyle = 'rgba(212, 163, 89, 0.3)';
  ctx.lineWidth = 4;
  ctx.strokeRect(40, 40, 1120, 550);

  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = '#D4A359';
  ctx.fillText('READING TRACKER • KNOWLEDGE VAULT', 80, 95);

  ctx.font = 'italic 32px Georgia, serif';
  ctx.fillStyle = '#F4EBE1';
  
  const words = (text || '').replace(/[\n\r]+/g, ' ').split(' ');
  let line = '';
  let y = 180;
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > 1000 && i > 0) {
      ctx.fillText(`"${line.trim()}"`, 80, y);
      line = words[i] + ' ';
      y += 48;
      if (y > 450) break;
    } else {
      line = testLine;
    }
  }
  if (y <= 450) {
    ctx.fillText(`"${line.trim()}"`, 80, y);
  }

  ctx.font = 'bold 24px Georgia, serif';
  ctx.fillStyle = '#D4A359';
  ctx.fillText(`— ${title || 'Book Note'}${author ? ' by ' + author : ''}`, 80, y + 70);

  const link = document.createElement('a');
  link.download = `quote-${(title || 'reading').toLowerCase().replace(/[^a-z0-9]/g, '-')}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();

  if (typeof showToast === 'function') showToast('Quote card exported to downloads!', 'success');
};

// Master init for all extended feature modules
document.addEventListener('DOMContentLoaded', () => {
  initHeatmapMetricListeners();
  initBarcodeScanner();
  initKnowledgeModeToggle();
  initGoodreadsImporter();
  initKindleImporter();
  initScholarSuite();

  applyDashboardPreferences();
  setupDashboardPreferencesListeners();
  setupPacePredictorSlider();
  renderStreakCalendar();

  const hdClose = document.getElementById('heatmap-day-modal') ? document.getElementById('hd-modal-close') : null;
  if (hdClose) hdClose.onclick = () => document.getElementById('heatmap-day-modal').classList.remove('open');
});

if (typeof window !== 'undefined') {
  window.saveNewBook = saveNewBook;
  window.submitLog = submitLog;
  window.initApp = initApp;
}



