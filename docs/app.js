// ─── Reading Tracker — app.js ────────────────────────────────────────────────
// Global Error Handler for debugging
window.addEventListener('error', e => {
  const errDiv = document.createElement('div');
  errDiv.className = 'fixed top-0 inset-x-0 bg-red-600 text-white text-xs p-4 z-[9999] overflow-auto max-h-40';
  errDiv.textContent = `JS Error: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`;
  document.body.appendChild(errDiv);
});
window.addEventListener('unhandledrejection', e => {
  const reasonStr = String(e.reason || '');
  if (reasonStr.includes('ServiceWorker') || reasonStr.includes('sw.js') || reasonStr.includes('Failed to fetch') || reasonStr.includes('unknown error occurred when fetching')) {
    console.warn('Suppressed ServiceWorker update rejection:', e.reason);
    return;
  }
  const errDiv = document.createElement('div');
  errDiv.className = 'fixed top-0 inset-x-0 bg-red-600 text-white text-xs p-4 z-[9999] overflow-auto max-h-40';
  errDiv.textContent = `Promise Reject: ${e.reason}`;
  document.body.appendChild(errDiv);
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

window.categoryChartMode = 'pages';

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

// ── Helpers ───────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; };

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtNum(n) { return (n ?? 0).toLocaleString(); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
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
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem('rt_editorial_theme', themeName);
  const isLight = (themeName === 'parched-paper' || themeName === 'light');
  localStorage.setItem('rt_theme', isLight ? 'light' : 'dark');

  if (isLight) {
    document.body.classList.add('light-mode');
  } else {
    document.body.classList.remove('light-mode');
  }

  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.classList.toggle('fa-sun', isLight);
    icon.classList.toggle('fa-moon', !isLight);
  }

  const metaTheme = document.getElementById('theme-color-meta');
  if (metaTheme) {
    metaTheme.content = isLight ? '#F8F5EE' : (themeName === 'obsidian' ? '#070709' : '#181412');
  }

  document.querySelectorAll('.theme-select-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === themeName);
  });
}
window.setEditorialTheme = setEditorialTheme;

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
  const saved = localStorage.getItem('rt_editorial_theme') || (localStorage.getItem('rt_theme') === 'light' ? 'parched-paper' : 'espresso');
  setEditorialTheme(saved);
  initFont();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'espresso';
  const nextTheme = (current === 'espresso' || current === 'obsidian' || current === 'glass-studio') ? 'parched-paper' : 'espresso';
  setEditorialTheme(nextTheme);
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

// Handle redirect result (mobile auth)
getRedirectResult(auth).catch(() => {});

onAuthStateChanged(auth, async user => {
  if (window.isMockAuth) return;
  if (!user) { showScreen('auth-screen'); return; }
  uid = user.uid;
  const hasSession = sessionStorage.getItem(SESSION_KEY) === uid;
  if (hasSession) {
    await initApp();
  } else {
    await checkAndShowPin();
  }
});

// ── PIN ───────────────────────────────────────────────────────────────────────
async function checkAndShowPin() {
  // Ensure PIN exists in Firestore (set default '1234' if first time)
  const settingsRef = doc(db, `users/${uid}/settings/app`);
  const snap = await getDoc(settingsRef);
  if (!snap.exists() || !snap.data().pin_hash) {
    const defaultHash = await hashPin('1234');
    await setDoc(settingsRef, { pin_hash: defaultHash }, { merge: true });
  }
  showScreen('pin-screen');
  pinBuffer = '';
  renderPinDots();
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
    await verifyPin(pinBuffer);
  }
});

async function verifyPin(pin) {
  const settingsRef = doc(db, `users/${uid}/settings/app`);
  const snap = await getDoc(settingsRef);
  const storedHash = snap.data()?.pin_hash;
  const inputHash  = await hashPin(pin);
  if (inputHash === storedHash) {
    sessionStorage.setItem(SESSION_KEY, uid);
    showScreen('app');
    await initApp();
  } else {
    pinBuffer = '';
    const dots = $('pin-dots').querySelectorAll('span');
    dots.forEach(d => {
      d.classList.remove('bg-gold', 'border-gold', 'scale-110', 'shadow-lg', 'shadow-gold/20');
      d.classList.add('bg-rose-500', 'border-rose-500', 'animate-shake');
    });
    const err = $('pin-error');
    err.classList.remove('opacity-0');
    setTimeout(() => {
      renderPinDots();
      err.classList.add('opacity-0');
    }, 1200);
  }
}

// ── Seed Import ───────────────────────────────────────────────────────────────
async function initApp() {
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
  setupAccountView();
  showView('dashboard'); // Start on Dashboard
  
  // 2. Load database content asynchronously in the background
  loadDatabaseData();
}

async function loadDatabaseData() {
  try {
    // Try to load cache first so it works offline/online instantly!
    await loadBooksCache();
    await loadLogsCache();

    // Startup Correction: remap mislabeled New Era logs from cycle 2 to 1
    const mislabeledLogs = logsCache.filter(l => l.book_title === 'Bahá’u’lláh and the New Era' && parseInt(l.read_cycle || 1, 10) === 2);
    if (mislabeledLogs.length > 0) {
      console.log(`[Startup-Correction] Correcting ${mislabeledLogs.length} mislabeled log cycles for New Era`);
      for (const l of mislabeledLogs) {
        await updateDoc(doc(db, `users/${uid}/reading_logs/${l.id}`), { read_cycle: 1 });
        l.read_cycle = 1;
      }
    }

    populateBookDropdown();
    if (typeof populateGroupDatalist === 'function') populateGroupDatalist(booksCache);
    
    // Refresh active views immediately from cache
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'goals')     renderGoals();
    if (currentView === 'wishlist')  renderBookshelf();

    // Run background self-healing for any data status inconsistencies
    healBookStatuses();

    // Ensure default goals config exists for user
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
    console.error("Failed to load library database:", e);
    // Only alert if we have no cached data at all
    if (booksCache.length === 0) {
      showToast("Database connection offline. Showing local data.", "error");
    }
  }
}

async function runSeedImport() {
  showScreen('seed-screen');
  $('seed-status').textContent = 'Loading your reading history…';
  $('seed-bar').style.width = '5%';

  const resp = await fetch('./seed-data.json');
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
}

// ── Settings & Data Management ────────────────────────────────────────────────
function setupSettingsModal() {
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

// ── Account View & Management ────────────────────────────────────────────────
function syncAccountThemeSwitch() {
  const switchEl = $('acct-theme-toggle-switch');
  const textEl = $('acct-theme-status-text');
  const iconEl = $('acct-theme-icon');
  const isDark = document.body.classList.contains('light-mode');
  
  if (switchEl) switchEl.checked = isDark;
  if (textEl) textEl.textContent = isDark ? 'Dark Mode Active' : 'Light Mode Active';
  if (iconEl) {
    iconEl.className = isDark ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
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
  const prefFormat = localStorage.getItem('rt_pref_format') || 'Physical';
  const prefPages = localStorage.getItem('rt_pref_pages') || '25';
  const prefMins = localStorage.getItem('rt_pref_mins') || '30';

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
      $('gemini-key-status').className = 'font-bold text-amber-400';
    }
  }
}

function setupAccountView() {
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

  // Gemini API Key Save Button
  const btnSaveGeminiKey = $('btn-save-gemini-key');
  const inputGeminiKey = $('acct-gemini-api-key');
  if (btnSaveGeminiKey && inputGeminiKey) {
    btnSaveGeminiKey.addEventListener('click', () => {
      const keyVal = inputGeminiKey.value.trim();
      if (keyVal) {
        localStorage.setItem('rt_gemini_api_key', keyVal);
        showToast('Gemini API Key saved successfully!', 'success');
      } else {
        localStorage.removeItem('rt_gemini_api_key');
        showToast('Gemini API Key removed.', 'info');
      }
      renderAccountView();
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
      localStorage.clear();
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

async function exportToExcelWorkbook() {
  if (typeof XLSX === 'undefined') {
    showToast('Excel exporter library is loading, please try again in a moment.', 'error');
    return;
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
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.books || !Array.isArray(data.books)) {
        throw new Error('Invalid backup file format: missing books array');
      }

      showToast(`Importing ${data.books.length} books and ${(data.logs || []).length} logs...`, 'info');

      if (db && uid) {
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
      }

      booksCache = [];
      logsCache = [];
      await loadBooksCache();
      await loadLogsCache();

      renderDashboard();
      renderAccountView();
      showToast('Import completed successfully!', 'success');
    } catch (err) {
      console.error('Import JSON error:', err);
      showToast('Failed to import backup: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
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
    }
  } catch (e) {
    console.warn('[Cache] Using cached logs array:', e.message);
  }
}

async function getMergedBooks() {
  await loadBooksCache();
  if (wishlistCache.length === 0) {
    try {
      if (db && uid) {
        const snap = await getDocs(collection(db, `users/${uid}/wishlist`));
        wishlistCache = snap.docs.map(d => ({ id: d.id, ...d.data(), _isWishlist: true }));
      }
    } catch (e) {
      console.warn('[Cache] Using cached wishlist array:', e.message);
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

  const wishlistOnly = wishlistCache
    .filter(w => !booksCache.some(b => b.title.toLowerCase() === w.title.toLowerCase()))
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

  // Update tab bar active state
  document.querySelectorAll('#tab-bar .tab-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });

  // Show/hide view sections
  document.querySelectorAll('.view').forEach(v => {
    const isActive = v.id === `view-${name}`;
    v.classList.toggle('active', isActive);
    v.classList.toggle('hidden', !isActive);
  });

  // Refresh content on tab open
  if (name === 'dashboard') renderDashboard();
  if (name === 'knowledge') renderKnowledgeView();
  if (name === 'goals')     renderGoals();
  if (name === 'wishlist')  renderBookshelf();
  if (name === 'log')       renderLogView();
  if (name === 'account')   renderAccountView();

  // Hide wishlist fab if present
  const fab = $('wishlist-fab');
  if (fab) fab.classList.add('hidden');
}

// ── Log Form ──────────────────────────────────────────────────────────────────
function setupLogForm() {
  $('log-date').value = todayISO();

  $('log-book').addEventListener('change', () => {
    const title = $('log-book').value;
    if (!title) {
      $('log-start').value = '';
      $('log-cycle').value = '1';
      $('log-start-hint').textContent = '';
      return;
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

function populateBookDropdown() {
  const sel = $('log-book');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select a book —</option>';

  // Sort: In Progress first, then Finished, then Not Started
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

  // If a selection exists, preserve it. Otherwise, default to the most recent entry from reading_logs.
  if (cur) {
    sel.value = cur;
  } else if (logsCache && logsCache.length > 0) {
    // Sort logs descending by date/time to find the absolute latest log
    const sortedLogs = [...logsCache].sort((a, b) => new Date(b.date) - new Date(a.date));
    const latestBookTitle = sortedLogs[0].book_title;
    if (latestBookTitle && booksCache.some(b => b.title === latestBookTitle)) {
      sel.value = latestBookTitle;
      // Trigger the page/cycle calculations and pre-population for the form
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

async function determineActiveCycleAndPage(title) {
  const book = booksCache.find(b => b.title === title);
  if (!book) return { cycle: 1, startPage: 0 };
  const tot = book.total_pages || 1;
  
  // Get all logs for this book
  const q = query(
    collection(db, `users/${uid}/reading_logs`),
    where('book_title', '==', title)
  );
  const snap = await getDocs(q);
  if (snap.empty) {
    return { cycle: 1, startPage: 0 };
  }
  
  const cycleLogs = {};
  snap.docs.forEach(doc => {
    const data = doc.data();
    const c = data.read_cycle || 1;
    if (!cycleLogs[c]) cycleLogs[c] = [];
    cycleLogs[c].push(data);
  });
  
  const cycles = Object.keys(cycleLogs).map(Number);
  const maxCycle = Math.max(...cycles);
  
  const logsInMaxCycle = cycleLogs[maxCycle];
  logsInMaxCycle.sort((a, b) => {
    return b.date.localeCompare(a.date) || (b.end_page - a.end_page);
  });
  
  const latestLog = logsInMaxCycle[0];
  const lastEndPage = latestLog.end_page || 0;
  
  if (lastEndPage >= tot) {
    return { cycle: maxCycle + 1, startPage: 0 };
  } else {
    return { cycle: maxCycle, startPage: lastEndPage };
  }
}

async function submitLog() {
  const title   = $('log-book').value;
  const date    = $('log-date').value;
  const start   = parseInt($('log-start').value) || 0;
  const end     = parseInt($('log-end').value);
  const cycle   = parseInt($('log-cycle').value) || 1;
  const mins    = parseInt($('log-minutes').value) || null;
  const notes   = $('log-notes').value.trim() || null;

  if (!title)          { showToast('Please select a book.', 'error'); return; }
  if (!date)           { showToast('Please enter a date.', 'error'); return; }
  if (isNaN(end) || end <= 0) { showToast('Please enter a valid end page.', 'error'); return; }
  if (end <= start)    { showToast('End page must be greater than start page.', 'error'); return; }

  const btn = $('log-submit');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    // Add log entry
    await addDoc(collection(db, `users/${uid}/reading_logs`), {
      date, book_title: title, read_cycle: cycle,
      start_page: start, end_page: end,
      minutes_spent: mins, notes,
      created_at: serverTimestamp()
    });

    // Recalculate book status
    await recalculateBook(title, cycle);

    // Reset form
    $('log-date').value = todayISO();
    $('log-end').value = '';
    $('log-minutes').value = '';
    $('log-notes').value = '';

    const pages = end - start;
    showToast(`✓ Logged ${pages} page${pages === 1 ? '' : 's'} in "${title.slice(0, 30)}${title.length > 30 ? '…' : ''}"`, 'success');

    // Refresh books cache so dropdown updates
    await loadBooksCache();
    populateBookDropdown();
    $('log-book').value = title;

    // Trigger start hint update
    $('log-start').value = end;
    $('log-start-hint').textContent = '↑ Auto-filled from last session';
    $('log-start-hint').className = 'input-hint found';
    
    // Invalidate logs cache so new entry shows up
    logsCache = [];

  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    console.error(e);
  } finally {
    btn.disabled = false; btn.textContent = 'Log Reading Session';
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
    newPagesRead = (tot > 0 && maxActiveEnd > tot) ? (maxActiveEnd % tot) : maxActiveEnd;
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
    const book = mergedBooks.find(b => b.title === title);
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
      }
    }
  });

  // Blend in finished books that don't have matching daily logs
  mergedBooks.forEach(b => {
    const rc = b.read_count || 0;
    const isFinished = ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status) || rc > 0;
    if (isFinished) {
      const existingCount = completions.filter(c => c.title === b.title).length;
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

  if (inProgress.length === 0) {
    if (titleEl) titleEl.textContent = 'No book currently in progress';
    if (authorEl) authorEl.textContent = 'Select a book from your bookshelf to begin';
    if (barEl) barEl.style.width = '0%';
    if (coverContainerEl) {
      coverContainerEl.innerHTML = `<div class="w-10 h-14 rounded-lg bg-slate-800 border border-white/10 flex items-center justify-center shadow-md overflow-hidden"><i class="fa-solid fa-book text-slate-500 text-lg"></i></div>`;
    }
    if (etaBadgeEl) {
      etaBadgeEl.textContent = 'Standby';
      etaBadgeEl.className = 'px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-slate-800 text-slate-400 border border-white/5';
    }
    return;
  }

  // Find the In Progress book that was last logged
  const bookLastLogMap = new Map();
  (logs || []).forEach(l => {
    if (!l.book_title || !l.date) return;
    const existing = bookLastLogMap.get(l.book_title);
    if (!existing || l.date.localeCompare(existing) > 0) {
      bookLastLogMap.set(l.book_title, l.date);
    }
  });

  const sortedInProgress = [...inProgress].sort((a, b) => {
    const dateA = bookLastLogMap.get(a.title) || '';
    const dateB = bookLastLogMap.get(b.title) || '';
    if (dateA && dateB) return dateB.localeCompare(dateA);
    if (dateA) return -1;
    if (dateB) return 1;
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

  if (coverContainerEl) {
    coverContainerEl.innerHTML = getCoverHTML(activeBook, 'w-11 h-16 shrink-0 shadow-md');
  }

  if (titleEl) titleEl.textContent = activeBook.title;
  if (authorEl) authorEl.textContent = `${activeBook.author || 'Unknown Author'} · ${remaining} pg left (${pct}%)`;
  if (barEl) {
    barEl.style.width = `${pct}%`;
    barEl.style.background = 'linear-gradient(90deg, var(--gold), var(--gold-light))';
  }

  const estDays = Math.max(1, Math.ceil(remaining / 15));
  if (etaBadgeEl) {
    etaBadgeEl.textContent = `Finish in ~${estDays} days`;
    etaBadgeEl.className = 'px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
  }
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
    listEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-4">No books found in this selection.</p>';
  } else {
    categoryBooksList.forEach(b => {
      const isFinished = ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status) || b.read_count > 0;
      const statusColor = isFinished ? 'emerald' : b.status === 'In Progress' ? 'blue' : 'amber';
      const row = el('div', 'p-3 rounded-2xl bg-white/[0.03] border border-white/5 flex justify-between items-center gap-3 active:scale-[0.99] cursor-pointer hover:bg-white/[0.06] transition-all');
      row.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="text-xs font-bold text-slate-200 truncate">${b.title}</div>
          <div class="text-[10px] text-slate-400 truncate mt-0.5">${b.author || 'Unknown'} · ${b.total_pages || 0} pg</div>
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
          <div class="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-slate-500 text-sm"><i class="fa-solid fa-moon"></i></div>
          <p class="text-xs text-slate-400 font-medium">No reading sessions recorded for this date.</p>
        </div>
      `;
    } else {
      dayLogs.forEach(l => {
        const pagesRead = Math.max(0, (l.end_page || 0) - (l.start_page || 0));
        const card = el('div', 'p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-1.5');
        card.innerHTML = `
          <div class="flex justify-between items-start">
            <span class="text-xs font-bold text-slate-100 truncate flex-1 pr-2">${l.book_title}</span>
            <span class="text-xs font-black text-emerald-400 tabular-nums">+${pagesRead} pg</span>
          </div>
          <div class="flex justify-between text-[10px] text-slate-400 font-semibold">
            <span>Pages ${l.start_page || 0} → ${l.end_page || 0}</span>
            <span>${l.minutes_spent ? `${l.minutes_spent} mins` : 'Unspecified duration'}</span>
          </div>
          ${l.notes ? `<div class="text-[10px] text-slate-300 italic bg-white/5 p-2 rounded-xl mt-1 border border-white/5">${l.notes}</div>` : ''}
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

async function renderDashboard() {
  await loadLogsCache();
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
  
  // Render Live Banner
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
  $('detail-reads').textContent = `Avg pages/book: ${avgPagesPerBook}`;
  $('stat-titles').textContent = titlesCount;
  $('detail-titles').textContent = `Finished: ${totalReads} · Active: ${progressCount}`;
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
    <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400">📊 Weekly Velocity (Last 7 Days)</div>
    <div class="grid grid-cols-3 gap-2.5 mt-2 text-center">
      <div class="bg-slate-900/30 p-2 rounded-xl border border-white/5">
        <div class="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Sessions</div>
        <div class="text-sm font-extrabold text-slate-200 mt-0.5">${thisWeekSessions}</div>
      </div>
      <div class="bg-slate-900/30 p-2 rounded-xl border border-white/5">
        <div class="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Pages Read</div>
        <div class="text-sm font-extrabold text-slate-200 mt-0.5">${fmtNum(thisWeekPages)}</div>
      </div>
      <div class="bg-slate-900/30 p-2 rounded-xl border border-white/5">
        <div class="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Minutes</div>
        <div class="text-sm font-extrabold text-slate-200 mt-0.5">${thisWeekMinutes}m</div>
      </div>
    </div>
    <div class="flex justify-between items-center text-[10px] text-slate-400 mt-2 border-t border-white/5 pt-2 font-medium">
      <span>vs. Previous 7 Days: <b class="${pageDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${pageDeltaStr}</b></span>
      <span>Avg Pages/Day: <b class="text-slate-200">${weekAvg}</b></span>
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
      <div class="flex justify-between"><span class="text-slate-400 font-medium">Days Elapsed</span><span class="text-slate-200 font-bold">${ytdDaysElapsed}</span></div>
      <div class="flex justify-between"><span class="text-slate-400 font-medium">Days Remaining</span><span class="text-slate-200 font-bold">${daysRemainingInYear}</span></div>
      <div class="flex justify-between"><span class="text-slate-400 font-medium">Books Completed</span><span class="text-slate-200 font-bold">${booksYTD}</span></div>
      <div class="flex justify-between"><span class="text-slate-400 font-medium">Pages Read</span><span class="text-slate-200 font-bold">${fmtNum(pagesYTD)}</span></div>
      <div class="flex justify-between col-span-2 border-t border-white/5 pt-2 mt-1">
        <span class="text-slate-400 font-medium">Pages/Calendar Day (YTD)</span>
        <span class="text-slate-200 font-bold">${pagesPerCalendarDay}</span>
      </div>
      <div class="flex justify-between col-span-2">
        <span class="text-slate-400 font-medium">Books Completed/Month</span>
        <span class="text-slate-200 font-bold">${booksPerMonthYTD}</span>
      </div>
    </div>
  `;

  // Update Milestone Projections Card
  $('dash-milestones').innerHTML = `
    <div class="flex flex-col gap-3.5">
      <!-- Books Milestone -->
      <div class="flex flex-col gap-1">
        <div class="flex justify-between text-xs font-semibold text-slate-200">
          <span>📚 Next Books Milestone</span>
          <span>${lifetimeReads} / ${nextBookMilestone} Books</span>
        </div>
        <div class="w-full bg-slate-900/50 rounded-full h-1.5 overflow-hidden border border-white/5 mt-0.5">
          <div class="bg-gradient-to-r from-gold to-yellow-500 h-full transition-all" style="width: ${Math.min(100, (lifetimeReads/nextBookMilestone)*100)}%"></div>
        </div>
        <div class="flex justify-between text-[10px] text-slate-400 mt-1">
          <span>To go: <b>${booksToMilestone} books</b></span>
          <span>ETA: <b>${booksETA}</b></span>
        </div>
      </div>
      
      <!-- Pages Milestone -->
      <div class="flex flex-col gap-1 border-t border-white/5 pt-3.5">
        <div class="flex justify-between text-xs font-semibold text-slate-200">
          <span>📄 Next Pages Milestone</span>
          <span>${fmtNum(lifetimePages)} / ${fmtNum(nextPageMilestone)} Pages</span>
        </div>
        <div class="w-full bg-slate-900/50 rounded-full h-1.5 overflow-hidden border border-white/5 mt-0.5">
          <div class="bg-gradient-to-r from-blue-400 to-emerald-400 h-full transition-all" style="width: ${Math.min(100, (lifetimePages/nextPageMilestone)*100)}%"></div>
        </div>
        <div class="flex justify-between text-[10px] text-slate-400 mt-1">
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
      activeEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-2 font-medium">No books currently in progress</p>';
    } else {
      active.forEach(b => {
        const pagesReadAccum = b.pages_read || 0;
        const currentCyclePages = pagesReadAccum % b.total_pages;
        const left = b.total_pages - currentCyclePages;
        const estDays = Math.ceil(left / 10);
        const pct = Math.min(100, Math.round((currentCyclePages / b.total_pages) * 100));
        
        const card = el('div', 'glass-panel p-3.5 rounded-2xl flex flex-col gap-2 border border-white/5 active:scale-[0.99] transition-all cursor-pointer carousel-card');
        card.innerHTML = `
          <div class="flex items-start gap-3 min-w-0">
            ${getCoverHTML(b, 'w-10 h-14 shrink-0 shadow-sm')}
            <div class="min-w-0 flex-1">
              <div class="flex justify-between items-start gap-2">
                <div class="text-xs font-bold text-slate-100 truncate">${b.title}</div>
                <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-blue-500/10 text-blue-400 border border-blue-500/10 uppercase shrink-0">${pct}%</span>
              </div>
              <div class="text-[9px] text-slate-400 truncate mt-0.5">${b.author || ''}</div>
            </div>
          </div>
          <div class="flex justify-between text-[9px] text-slate-400 mt-1 border-t border-white/5 pt-1.5 font-semibold">
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
      upNextEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-2 font-medium">No upcoming books</p>';
    } else {
      upNext.forEach(b => {
        const card = el('div', 'glass-panel p-3.5 rounded-2xl flex flex-col gap-2 border border-white/5 active:scale-[0.99] transition-all cursor-pointer carousel-card');
        card.innerHTML = `
          <div class="flex items-start gap-3 min-w-0">
            ${getCoverHTML(b, 'w-10 h-14 shrink-0 shadow-sm')}
            <div class="min-w-0 flex-1">
              <div class="flex justify-between items-start gap-2">
                <div class="text-xs font-bold text-slate-100 truncate">${b.title}</div>
                <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-500/10 text-amber-400 border border-amber-500/10 uppercase shrink-0">${b.priority} Prio</span>
              </div>
              <div class="text-[9px] text-slate-400 truncate mt-0.5">${b.author || ''}</div>
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
      recentEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-2 font-medium">No books recently finished</p>';
    } else {
      recentCompletions.forEach(c => {
        const book = mergedBooks.find(b => b.title === c.title) || { title: c.title, author: '' };
        const card = el('div', 'glass-panel p-3.5 rounded-2xl flex flex-col gap-2 border border-white/5 active:scale-[0.99] transition-all cursor-pointer carousel-card');
        card.innerHTML = `
          <div class="flex items-start gap-3 min-w-0">
            ${getCoverHTML(book, 'w-10 h-14 shrink-0 shadow-sm')}
            <div class="min-w-0 flex-1">
              <div class="flex justify-between items-start gap-2">
                <div class="text-xs font-bold text-slate-100 truncate">${c.title}</div>
                <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/10 uppercase shrink-0">Finished</span>
              </div>
              <div class="text-[9px] text-slate-400 truncate mt-0.5">${book.author || ''}</div>
              <div class="flex justify-between text-[9px] text-slate-400 mt-1 border-t border-white/5 pt-1.5 font-semibold">
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

  // ── Render Charts ──
  renderCharts(completions);
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
        <span class="text-[8px] font-bold text-slate-400 uppercase">${d.day}</span>
        <div class="w-5 h-5 rounded-full flex items-center justify-center transition-all ${
          d.active ? 'bg-gradient-to-tr from-amber-500 to-amber-300 text-slate-950 font-black shadow-sm shadow-amber-500/30 text-[10px]' : 
          (d.isToday ? 'border border-amber-400/50 bg-amber-400/10 text-amber-300 text-[8px]' : 'bg-white/5 border border-white/10 text-slate-600 text-[8px]')
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

  // Update status badge
  const currentActual = monthCumPages[curMonthIndex] || yearPages;
  const currentTargetReq = Math.round(((curMonthIndex + 1) / 12) * aPT);
  const statusLbl = $('trajectory-status-lbl');
  if (statusLbl) {
    const diff = currentActual - currentTargetReq;
    if (diff >= 0) {
      statusLbl.className = "text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
      statusLbl.textContent = `+${fmtNum(diff)} pgs Ahead`;
    } else {
      statusLbl.className = "text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20";
      statusLbl.textContent = `${fmtNum(Math.abs(diff))} pgs Behind`;
    }
  }

  container.innerHTML = `
    <svg class="w-full h-full" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="actualAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#34d399" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#34d399" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <!-- Grid lines -->
      <line x1="${padL}" y1="${padT}" x2="${width - padR}" y2="${padT}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="2,2" />
      <line x1="${padL}" y1="${padT + graphH/2}" x2="${width - padR}" y2="${padT + graphH/2}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="2,2" />
      <line x1="${padL}" y1="${padT + graphH}" x2="${width - padR}" y2="${padT + graphH}" stroke="rgba(255,255,255,0.1)" />
      
      <!-- Target Pace Line -->
      <path d="${targetPathStr}" fill="none" stroke="rgba(245, 158, 11, 0.4)" stroke-width="1.5" stroke-dasharray="4,3" />

      <!-- Actual Area Fill -->
      ${areaPathStr ? `<path d="${areaPathStr}" fill="url(#actualAreaGrad)" />` : ''}

      <!-- Actual Pace Line -->
      ${actualPathStr ? `<path d="${actualPathStr}" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" />` : ''}

      <!-- Data Dots -->
      ${actualPoints.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#10b981" stroke="#064e3b" stroke-width="1.5"/>`).join('')}

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
        ? 'bg-gradient-to-b from-amber-500/10 to-amber-500/5 border-amber-500/30 text-amber-300 shadow-md shadow-amber-500/5' 
        : 'bg-black/20 border-white/5 text-slate-500 opacity-60'
    }">
      <div class="w-8 h-8 rounded-xl flex items-center justify-center mb-1 text-sm ${
        b.unlocked ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-white/5 text-slate-600'
      }">
        <i class="fa-solid ${b.icon}"></i>
      </div>
      <div class="text-[10px] font-extrabold text-slate-200 truncate w-full leading-tight">${b.title}</div>
      <div class="text-[8px] font-semibold text-slate-400 mt-0.5">${b.unlocked ? '✓ Unlocked' : b.progress}</div>
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
        b.classList.toggle('text-amber-400', isActive);
        b.classList.toggle('bg-amber-500/10', isActive);
        b.classList.toggle('shadow-sm', isActive);
        b.classList.toggle('text-slate-400', !isActive);
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
          b.classList.toggle('text-amber-300', isSelected);
          b.classList.toggle('border-white/10', !isSelected);
          b.classList.toggle('bg-white/5', !isSelected);
          b.classList.toggle('text-slate-300', !isSelected);
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
  $('btn-edit-goals').addEventListener('click', openGoalsModal);
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
    return `<div class="text-right"><div class="font-extrabold text-slate-200">${pct}%</div><div class="text-[8px] text-slate-400 mt-0.5">${left} left</div></div>`;
  };

  $('goals-table-body').innerHTML = `
    <tr>
      <td>Books This Month</td>
      <td class="text-center font-bold text-slate-300">${mBT}</td>
      <td class="text-center font-bold text-slate-300">${monthBooks}</td>
      <td>${progressStr(monthBooks, mBT)}</td>
    </tr>
    <tr>
      <td>Pages This Month</td>
      <td class="text-center font-bold text-slate-300">${fmtNum(mPT)}</td>
      <td class="text-center font-bold text-slate-300">${fmtNum(monthPages)}</td>
      <td>${progressStr(monthPages, mPT)}</td>
    </tr>
    <tr>
      <td>Sessions This Month</td>
      <td class="text-center font-bold text-slate-300">${mST}</td>
      <td class="text-center font-bold text-slate-300">${monthSessions}</td>
      <td>${progressStr(monthSessions, mST)}</td>
    </tr>
    <tr>
      <td>Minutes This Month</td>
      <td class="text-center font-bold text-slate-300">${fmtNum(mMT)}</td>
      <td class="text-center font-bold text-slate-300">${fmtNum(monthMinutes)}</td>
      <td>${progressStr(monthMinutes, mMT)}</td>
    </tr>
    <tr class="border-t border-white/5 bg-white/2">
      <td>Books This Year</td>
      <td class="text-center font-bold text-slate-300">${aBT}</td>
      <td class="text-center font-bold text-slate-300">${yearBooks}</td>
      <td>${progressStr(yearBooks, aBT)}</td>
    </tr>
    <tr>
      <td>Pages This Year</td>
      <td class="text-center font-bold text-slate-300">${fmtNum(aPT)}</td>
      <td class="text-center font-bold text-slate-300">${fmtNum(yearPages)}</td>
      <td>${progressStr(yearPages, aPT)}</td>
    </tr>
    <tr>
      <td>Sessions This Year</td>
      <td class="text-center font-bold text-slate-300">${aST}</td>
      <td class="text-center font-bold text-slate-300">${yearSessions}</td>
      <td>${progressStr(yearSessions, aST)}</td>
    </tr>
    <tr>
      <td>Minutes Reading YTD</td>
      <td class="text-center font-bold text-slate-300">${fmtNum(aMT)}</td>
      <td class="text-center font-bold text-slate-300">${fmtNum(yearMinutes)}</td>
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
      <td class="text-center font-extrabold text-slate-200">${currentBooksPace} /mo</td>
      <td class="text-right">${statusBadge(currentBooksPace, reqBooksPace)}</td>
    </tr>
    <tr class="text-[8px] text-slate-400">
      <td colspan="4" class="text-right border-none pt-0 pb-2">Year-End Est: <b>${estYearEnd(yearBooks/Math.max(1, dayOfYear), daysInYear)} books</b></td>
    </tr>
    <tr>
      <td>Pages</td>
      <td class="text-center">${reqPagesPace} /day</td>
      <td class="text-center font-extrabold text-slate-200">${currentPagesPace} /day</td>
      <td class="text-right">${statusBadge(currentPagesPace, reqPagesPace)}</td>
    </tr>
    <tr class="text-[8px] text-slate-400">
      <td colspan="4" class="text-right border-none pt-0 pb-2">Year-End Est: <b>${fmtNum(estYearEnd(currentPagesPace, daysInYear))} pages</b></td>
    </tr>
    <tr>
      <td>Sessions</td>
      <td class="text-center">${reqSessionsPace} /wk</td>
      <td class="text-center font-extrabold text-slate-200">${currentSessionsPace} /wk</td>
      <td class="text-right">${statusBadge(currentSessionsPace, reqSessionsPace)}</td>
    </tr>
    <tr class="text-[8px] text-slate-400">
      <td colspan="4" class="text-right border-none pt-0 pb-2">Year-End Est: <b>${estYearEnd(yearSessions/Math.max(1, dayOfYear), daysInYear)} sessions</b></td>
    </tr>
    <tr>
      <td>Minutes</td>
      <td class="text-center">${reqMinutesPace} /day</td>
      <td class="text-center font-extrabold text-slate-200">${currentMinutesPace} /day</td>
      <td class="text-right">${statusBadge(currentMinutesPace, reqMinutesPace)}</td>
    </tr>
    <tr class="text-[8px] text-slate-400">
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
      <td class="text-right font-bold text-slate-200">${ipETA}</td>
    </tr>
    <tr>
      <td>Reach 50 Books Lifetime (Current: ${totalReadsLifetime})</td>
      <td class="text-right font-bold text-slate-200">${lifetime50ETA}</td>
    </tr>
    <tr>
      <td>Reach 100 Books Lifetime (Current: ${totalReadsLifetime})</td>
      <td class="text-right font-bold text-slate-200">${lifetime100ETA}</td>
    </tr>
    <tr>
      <td>Reach 30k Pages Lifetime (Current: ${fmtNum(totalPagesReadLifetime)})</td>
      <td class="text-right font-bold text-slate-200">${pages30kETA}</td>
    </tr>
  `;

  // 4. Currently Reading Projections List
  const etasContainer = $('goals-reading-etas');
  etasContainer.innerHTML = '';
  
  if (inProgressBooks.length === 0) {
    etasContainer.innerHTML = '<p class="text-xs text-slate-500 text-center py-2 font-medium">No books currently in progress</p>';
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
      
      const card = el('div', 'glass-panel p-4 rounded-2xl flex flex-col gap-2.5 border border-white/5');
      card.innerHTML = `
        <div class="flex justify-between items-start gap-3">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-extrabold text-slate-100 truncate">${b.title}</div>
            <div class="text-[9px] text-slate-400 mt-0.5">Last read: ${lastReadStr} · ${left} pages left (${pct}%)</div>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[8px] font-black bg-amber-500/10 text-amber-400 border border-amber-500/10 uppercase shrink-0">${pct}%</span>
        </div>
        <div class="w-full bg-slate-800/60 rounded-full h-1.5 overflow-hidden">
          <div class="h-full rounded-full transition-all duration-500" style="width: ${pct}%; background: linear-gradient(90deg, var(--gold), var(--gold-light))"></div>
        </div>
        <div class="flex justify-between items-center text-[10px] text-slate-400 mt-0.5 border-t border-white/5 pt-2 font-semibold">
          <span>Pace: <b class="text-slate-200">${effectiveRate.toFixed(1)} pg/day</b></span>
          <span>ETA: <b class="text-amber-300 font-bold">${bookETA}</b></span>
        </div>
      `;
      etasContainer.appendChild(card);
    });
  }
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

async function saveGoals() {
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
    if (raw && parseInt(raw, 10) <= 0) {
      showToast('Target goals must be positive numbers', 'error');
      return;
    }
  }

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
  }
  goalsCache = data;
  try {
    localStorage.setItem('goals_cache', JSON.stringify(goalsCache));
  } catch(e){}

  closeGoalsModal();
  showToast('Goals updated ✓', 'success');
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

  const isDark = document.body.classList.contains('light-mode');
  const c1 = isDark ? '#D6A85C' : '#FF9F0A'; // Bahai (Gold)
  const c2 = isDark ? '#38BDF8' : '#0A84FF'; // Non-Bahai (Sky Blue)
  const trackColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';

  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'w-full h-full', style: 'display:block' });
  svg.appendChild(svgEl('circle', { cx, cy, r, fill: 'none', stroke: trackColor, 'stroke-width': sw }));

  const centerOverlay = el('div', 'absolute inset-0 flex flex-col items-center justify-center pointer-events-none p-1');
  const overlayTotal = el('span', 'text-base font-black text-slate-100 tracking-tight');
  overlayTotal.textContent = fmtNum(total);
  const overlayLabel = el('span', 'text-[9px] font-bold uppercase tracking-wider text-slate-400 text-center mt-0.5 max-w-[80px] leading-tight');
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
        <div class="text-xs font-black text-slate-100">${pctBahai}% <span class="text-[9px] font-bold text-slate-400">(${fmtNum(bahaiVal)} ${unitStr})</span></div>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${c2}"></span>
      <div>
        <div class="text-[10px] font-bold text-slate-350">Non-Bahá'í</div>
        <div class="text-xs font-black text-slate-100">${pctNon}% <span class="text-[9px] font-bold text-slate-400">(${fmtNum(nonBahaiVal)} ${unitStr})</span></div>
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
  
  toggleBtn.addEventListener('click', () => {
    if (timerRunning) {
      clearInterval(timerInterval);
      timerRunning = false;
      toggleBtn.textContent = 'Resume';
      toggleBtn.style.cssText = 'background:rgba(var(--gold-rgb),0.1);border-color:rgba(var(--gold-rgb),0.25);color:var(--gold)';
      display.classList.remove('timer-running');
      resetBtn.classList.remove('hidden');
      $('log-minutes').value = Math.ceil(timerSeconds / 60);
    } else {
      timerRunning = true;
      toggleBtn.textContent = 'Pause';
      toggleBtn.style.cssText = 'background:rgba(var(--rose-rgb),0.1);border-color:rgba(var(--rose-rgb),0.25);color:var(--rose)';
      display.classList.add('timer-running');
      resetBtn.classList.add('hidden');
      timerInterval = setInterval(() => {
        timerSeconds++;
        const mins = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
        const secs = String(timerSeconds % 60).padStart(2, '0');
        display.textContent = `${mins}:${secs}`;
      }, 1000);
    }
  });

  resetBtn.addEventListener('click', () => {
    clearInterval(timerInterval);
    timerInterval = null;
    timerSeconds = 0;
    timerRunning = false;
    display.textContent = '00:00';
    display.classList.remove('timer-running');
    toggleBtn.textContent = 'Start';
    toggleBtn.style.cssText = 'background:rgba(var(--gold-rgb),0.1);border-color:rgba(var(--gold-rgb),0.25);color:var(--gold)';
    resetBtn.classList.add('hidden');
    $('log-minutes').value = '';
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
  for (let i = 83; i >= 0; i--) {
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
    container.appendChild(cell);
  });
}

function renderRecentLogs() {
  const container = $('log-recent-list');
  if (!container) return;
  container.innerHTML = '';
  
  const activeLogs = logsCache.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));
  if (activeLogs.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-500 text-center py-2 font-medium">No recent logs recorded</p>';
    return;
  }
  
  activeLogs.slice(0, 10).forEach(l => {
    const card = el('div', 'glass-panel p-3.5 rounded-2xl flex items-center justify-between gap-3 border border-white/5 hover:bg-slate-900/30 transition-all cursor-pointer group relative overflow-hidden');
    const pages = Math.max(0, (l.end_page || 0) - (l.start_page || 0));
    
    card.innerHTML = `
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-slate-100 truncate">${l.book_title}</span>
          <span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-gold/15 text-gold border border-gold/20 shrink-0">+${pages} pg</span>
        </div>
        <div class="text-[9px] text-slate-400 mt-0.5 flex items-center gap-2">
          <span>Cycle ${l.read_cycle || 1}</span>
          <span>•</span>
          <span>pp. ${l.start_page || 0} → ${l.end_page || 0}</span>
          <span>•</span>
          <span>${fmtDate(l.date)}</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div class="text-xs font-bold text-slate-200">${l.minutes_spent ? `${l.minutes_spent}m` : '—'}</div>
        <button data-edit-log-id="${l.id || ''}" class="w-7 h-7 rounded-lg bg-white/5 hover:bg-gold/20 hover:text-gold text-slate-400 border border-white/10 flex items-center justify-center transition-all shrink-0 active:scale-95" title="Edit Log">
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
}

function openAddBookModal() {
  if ($('ab-cover-url')) $('ab-cover-url').value = '';
  if ($('ab-cover-preview')) $('ab-cover-preview').innerHTML = `<i class="fa-solid fa-image"></i>`;
  const searchBtn = $('ab-btn-search-cover');
  if (searchBtn) searchBtn.onclick = () => autoFindSingleCover('ab-title', 'ab-author', 'ab-cover-url', 'ab-cover-preview');
  $('add-book-modal').classList.add('open');
}

function setupBookshelf() {
  const searchEl = $('wishlist-search');
  if (searchEl) {
    searchEl.addEventListener('input', e => {
      bookshelfSearchTerm = e.target.value;
      renderBookshelf();
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

async function renderBookshelf() {
  const allItems = await getMergedBooks();

  // 1. Calculate top stats summary
  const totalBooks = allItems.length;
  const totalPages = allItems.reduce((s, b) => s + (b.total_pages || 0), 0);
  const totalVal   = allItems.reduce((s, b) => s + (b.est_cost || 0), 0);

  if ($('st-total-books')) $('st-total-books').textContent = totalBooks;
  if ($('st-total-pages')) $('st-total-pages').textContent = fmtNum(totalPages);
  if ($('st-total-val'))   $('st-total-val').textContent   = `$${totalVal.toFixed(0)}`;

  if (typeof window.render3DSpineBookshelf === 'function') window.render3DSpineBookshelf(allItems);

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

  // View Transitions API
  if (document.startViewTransition) {
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
        <img src="${b.cover_url}" alt="${safeTitle}" class="book-cover-img w-full h-full object-cover rounded-lg shadow-sm" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.parentElement.innerHTML=\`<div class='book-spine-fallback'><div class='book-spine-fallback-title'>${safeTitle}</div><div class='book-spine-fallback-author'>${safeAuthor}</div></div>\`"/>
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
    const card = el('div', 'glass-panel p-3.5 rounded-2xl border border-white/5 flex flex-col gap-3');
    const isWl = b._isWishlist || false;
    const storeSearchUrl = `https://www.bahaibookstore.com/catalogsearch/result/?q=${encodeURIComponent((b.title||'').replace(/\/[A-Z0-9]+$/,''))}`;

    card.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="w-14 h-21 shrink-0" id="cover-preview-${b.id}">
          ${getCoverHTML(b, 'w-14 h-21 shadow-md')}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-bold text-slate-100 leading-snug line-clamp-2">${b.title}</div>
          <div class="text-[10px] text-slate-400 truncate mt-0.5">${b.author || 'Unknown Author'}</div>
          
          <div class="flex flex-wrap items-center gap-2 mt-2">
            ${b.cover_url ? `<span class="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"><i class="fa-solid fa-check text-[8px]"></i> Approved</span>` : `<span class="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">Needs Cover</span>`}
            
            <a href="${storeSearchUrl}" target="_blank" rel="noopener" class="text-[9px] font-bold text-amber-400 hover:underline flex items-center gap-1">
              <i class="fa-solid fa-arrow-up-right-from-square text-[8px]"></i> Find on Baha'i Bookstore
            </a>
          </div>
        </div>
      </div>

      <!-- Candidate Choices / Custom URL Bar -->
      <div class="flex flex-col gap-2 pt-2 border-t border-white/5" id="cover-candidates-${b.id}">
        <div class="flex items-center gap-2">
          <input type="text" class="input input-xs glass-input flex-1 text-[11px] px-2.5 h-8 py-0 rounded-xl" id="cover-url-input-${b.id}" placeholder="Paste Cover Image URL..." value="${b.cover_url || ''}">
          <button class="px-3 py-1 rounded-xl text-xs font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all h-8" onclick="saveCoverFromInput('${b.id}', ${isWl})">
            Save
          </button>
        </div>
        <div class="flex gap-2 items-center flex-wrap" id="cover-candidate-thumbs-${b.id}">
          <button class="text-[10px] font-bold text-slate-400 hover:text-amber-300 flex items-center gap-1" onclick="fetchAndDisplayCandidates('${b.id}', '${(b.title||'').replace(/'/g, "\\'")}', '${(b.author||'').replace(/'/g, "\\'")}', '${b.collection||''}', ${isWl})">
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
  if (container) container.innerHTML = `<span class="text-[10px] text-amber-400 animate-pulse"><i class="fa-solid fa-spinner fa-spin"></i> Fetching covers...</span>`;

  const { candidates } = await searchCoverCandidates(title, author, collection);
  if (!container) return;
  
  if (candidates.length === 0) {
    container.innerHTML = `<span class="text-[10px] text-slate-400">No candidates found automatically. Click "Find on Baha'i Bookstore" above and paste the image link!</span>`;
    return;
  }

  container.innerHTML = candidates.map(c => `
    <div class="relative group cursor-pointer border border-white/10 hover:border-gold rounded-lg overflow-hidden w-12 h-18 bg-black/40" onclick="applyCandidateCover('${id}', '${c.url}', ${isWishlist})">
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
      if (preview) preview.innerHTML = `<img src="${compressedDataUrl}" class="w-full h-full object-cover rounded-lg">`;
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
  if (preview) preview.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-amber-400 text-xs"></i>`;
  
  const { candidates } = await searchCoverCandidates(title, author);
  if (candidates && candidates.length > 0) {
    const coverUrl = candidates[0].url;
    const targetInput = $(targetInputId);
    if (targetInput) targetInput.value = coverUrl;
    if (preview) preview.innerHTML = `<img src="${coverUrl}" class="w-full h-full object-cover rounded-lg">`;
    showToast('Found candidate cover artwork!', 'success');
  } else {
    if (preview) preview.innerHTML = `<i class="fa-solid fa-image text-xs"></i>`;
    showToast('No cover found automatically. Try uploading a photo!', 'info');
  }
};

function renderBookshelfContent(container, filtered) {
  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = `<div class="flex flex-col items-center justify-center p-12 text-center text-slate-500 gap-3"><span class="text-4xl">📚</span><div class="text-sm font-bold text-slate-400">No books found</div><p class="text-xs text-slate-500">Try a different filter or add a new book</p></div>`;
    return;
  }

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
      const header = el('div', 'bookshelf-section-header flex items-center justify-between text-xs font-black tracking-tight text-slate-200');
      header.innerHTML = `
        <span class="flex items-center gap-2"><i class="fa-solid fa-folder text-amber-400 text-xs"></i> ${groupName}</span>
        <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-white/10 text-slate-300">${groupItems.length}</span>
      `;
      section.appendChild(header);

      const itemsContainer = el('div', bookshelfViewMode === 'grid' ? 'bookshelf-grid' : 'flex flex-col gap-3');
      groupItems.forEach(b => itemsContainer.appendChild(renderBookCard(b)));
      section.appendChild(itemsContainer);

      container.appendChild(section);
    });
  } else {
    container.className = bookshelfViewMode === 'grid' ? 'bookshelf-grid' : 'flex flex-col gap-3';
    filtered.forEach(b => container.appendChild(renderBookCard(b)));
  }
}

function renderBookCard(b) {
  const isFin = ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status);
  const isAct = b.status === 'In Progress';
  const isWl = ['Want to Buy', 'Gifted', 'Borrowed', 'Wishlist'].includes(b.status) || b._isWishlist;

  let badgeColor = 'bg-slate-800/40 text-slate-400 border-white/5';
  if (isFin) badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10';
  else if (isAct) badgeColor = 'bg-blue-500/10 text-blue-400 border-blue-500/10';
  else if (isWl) badgeColor = 'bg-violet-500/10 text-violet-400 border-violet-500/10';
  else if (b.status === 'Owned') badgeColor = 'bg-amber-500/10 text-amber-400 border-amber-500/10';

  let ownBadgeColor = 'bg-slate-800/40 text-slate-350 border-white/5';
  if (b.ownership === 'Owned') ownBadgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10';
  else if (b.ownership === 'Borrowed') ownBadgeColor = 'bg-blue-500/10 text-blue-400 border-blue-500/10';
  else if (b.ownership === 'Wishlist') ownBadgeColor = 'bg-violet-500/10 text-violet-400 border-violet-500/10';

  const prioClasses = {
    'High': 'bg-rose-500/10 text-rose-400 border-rose-500/10',
    'Medium': 'bg-amber-500/10 text-amber-400 border-amber-500/10',
    'Low': 'bg-slate-800/40 text-slate-400 border-white/5'
  };
  const prioBadge = prioClasses[b.priority] || prioClasses['Low'];

  const pagesReadAccum = b.pages_read || 0;
  const currentCyclePages = b.total_pages > 0 ? pagesReadAccum % b.total_pages : 0;
  const progressPct = b.total_pages > 0 ? Math.min(100, Math.round((currentCyclePages / b.total_pages) * 100)) : 0;
  const readCycle = (b.read_count || 0) + (isAct ? 1 : 0);

  const isChecked = bookshelfSelectedIds.has(b.id);

  if (bookshelfViewMode === 'grid') {
    // 2-Column Compact Grid Card
    const card = el('div', `bookshelf-card-item glass-panel p-3 rounded-2xl border border-white/5 flex flex-col justify-between gap-2.5 relative hover:bg-white/[0.01] active:scale-[0.98] transition-all cursor-pointer ${isChecked ? 'border-gold/50 bg-gold/5' : ''}`);
    card.dataset.id = b.id;

    card.innerHTML = `
      ${bookshelfSelectMode ? `
        <input type="checkbox" class="checkbox checkbox-xs checkbox-warning absolute top-3 right-3 z-10" ${isChecked ? 'checked' : ''}>
      ` : ''}
      <div class="flex items-start gap-2.5 min-w-0">
        ${getCoverHTML(b, 'w-12 h-18 shrink-0')}
        <div class="min-w-0 flex-1">
          <div class="text-xs font-bold text-slate-100 leading-tight line-clamp-2">${b.title}</div>
          <div class="text-[10px] text-slate-400 truncate mt-0.5">${b.author || 'Unknown'}</div>
          <div class="flex flex-wrap gap-1 mt-1.5">
            <span class="shrink-0 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase border ${badgeColor}">${b.status}</span>
            <span class="shrink-0 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full uppercase border ${prioBadge}">${b.priority}</span>
          </div>
        </div>
      </div>
      ${isAct ? `
        <div class="w-full bg-slate-900/40 border border-white/5 rounded-full h-1 overflow-hidden mt-0.5">
          <div class="bg-gradient-to-r from-blue-400 to-emerald-400 h-full transition-all" style="width: ${progressPct}%"></div>
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

  const card = el('div', `bookshelf-card-item glass-panel p-4 rounded-3xl border border-white/5 flex flex-col gap-3 relative hover:bg-white/[0.01] active:scale-[0.99] transition-all cursor-pointer ${isChecked ? 'border-gold/50 bg-gold/5' : ''}`);

  const costText = b.est_cost > 0 ? ` · $${b.est_cost.toFixed(2)}` : '';

  let buyHTML = '';
  if (b.where_to_buy) {
    const isUrl = b.where_to_buy.startsWith('http://') || b.where_to_buy.startsWith('https://');
    buyHTML = `
      <div class="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
        <i class="fa-solid fa-shopping-cart text-[10px] text-amber-400"></i>
        <span>Where to Buy:</span>
        ${isUrl ? `<a href="${b.where_to_buy}" target="_blank" class="text-amber-400 underline truncate hover:text-amber-300 font-semibold" onclick="event.stopPropagation()">${b.where_to_buy}</a>` : `<span class="text-slate-200 truncate font-semibold">${b.where_to_buy}</span>`}
      </div>
    `;
  }

  let notesHTML = '';
  if (b.notes) {
    notesHTML = `
      <div class="text-[11px] text-slate-300 italic px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04] mt-0.5 whitespace-pre-wrap leading-relaxed">
        <i class="fa-solid fa-quote-left text-[9px] text-slate-500 mr-1 align-top"></i>${b.notes}
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
        <div class="text-sm font-bold text-slate-100 leading-snug line-clamp-2">&#8203;${b.title}</div>
        <div class="text-[11px] text-slate-400 truncate mt-0.5">${b.author || 'Unknown Author'} · ${b.total_pages || 'N/A'} pg${costText}</div>
        <div class="flex flex-wrap gap-1.5 mt-2">
          <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-slate-800/40 text-slate-350 border border-white/5">${b.collection === 'Bahai' ? "Bahá'í" : "Non-Bahá'í"}</span>
          <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-slate-800/40 text-slate-350 border border-white/5">${b.group || 'Other'}</span>
          <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider border ${prioBadge}">Priority: ${b.priority}</span>
          <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider border ${ownBadgeColor}">${b.ownership}</span>
        </div>
      </div>
      <span class="shrink-0 text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider border ${badgeColor}">${b.status}</span>
    </div>

    ${isAct ? `
      <div class="flex flex-col gap-1.5 mt-0.5">
        <div class="flex justify-between text-[9px] text-slate-400 font-bold uppercase tracking-wider">
          <span>Reading Progress</span>
          <span>${currentCyclePages} / ${b.total_pages} pg (${progressPct}%)</span>
        </div>
        <div class="w-full bg-slate-900/40 border border-white/5 rounded-full h-1.5 overflow-hidden">
          <div class="bg-gradient-to-r from-blue-400 to-emerald-400 h-full transition-all" style="width: ${progressPct}%"></div>
        </div>
      </div>
    ` : ''}

    ${buyHTML}
    ${notesHTML}

    <div class="flex justify-between items-center text-[10px] text-slate-400 border-t border-white/5 pt-2.5 font-semibold mt-1">
      <div class="flex gap-3">
        <span>Cycle: <b class="text-slate-200">${isAct ? readCycle : (b.read_count || 0)}</b></span>
        <span>Reads: <b class="text-slate-200">${b.read_count || 0}</b></span>
      </div>
      <div class="flex gap-1.5">
        ${isFin ? `<button class="btn btn-xs rounded-lg bg-gold/10 hover:bg-gold/20 text-gold border border-gold/20 text-[9px] font-extrabold h-6 min-h-6 px-2.5" data-action="re-read">Re-Read</button>` : ''}
        ${isAct ? `<button class="btn btn-xs rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-[9px] font-extrabold h-6 min-h-6 px-2.5" data-action="complete">Complete</button>` : ''}
        <button class="btn btn-xs rounded-lg bg-white/5 hover:bg-white/10 text-slate-350 border border-white/10 text-[9px] font-bold h-6 min-h-6 px-2.5" data-action="edit">Edit</button>
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

async function saveNewBook() {
  const title = $('ab-title').value.trim();
  const author = $('ab-author').value.trim() || null;
  const coll = $('ab-collection').value;
  
  const selectVal = $('ab-group-select').value;
  const group = selectVal === 'Other' ? $('ab-group-custom').value.trim() : selectVal;
  
  if (!title) { showToast('Please enter a book title.', 'error'); return; }
  if (selectVal === 'Other' && !group) { showToast('Please type a custom group name.', 'error'); return; }
  
  const pages = parseInt($('ab-pages').value);
  const prio = $('ab-priority').value;
  const status = $('ab-status').value;
  const cost = parseFloat($('ab-cost').value) || 0;
  const buyLink = $('ab-where-to-buy').value.trim() || '';
  const notes = $('ab-notes').value.trim() || '';
  const coverUrl = $('ab-cover-url')?.value?.trim() || null;
  
  if (isNaN(pages) || pages <= 0) { showToast('Please enter a valid page length.', 'error'); return; }
  
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
    
    // Save to main books collection
    await addDoc(collection(db, `users/${uid}/books`), newBook);
    
    // If it's a wishlist item, also add to legacy wishlist collection for complete database safety
    if (isWishlistStatus) {
      await addDoc(collection(db, `users/${uid}/wishlist`), {
        title,
        author,
        category: group,
        priority: prio,
        status: status,
        est_pages: pages,
        est_cost: cost,
        where_to_buy: buyLink,
        notes: notes,
        cover_url: coverUrl,
        date_added: todayISO()
      });
      wishlistCache = []; // Reset wishlist cache to force reload
    }
    
    if (isFinished) {
      await addDoc(collection(db, `users/${uid}/reading_logs`), {
        date: todayISO(),
        book_title: title,
        read_cycle: 1,
        start_page: 0,
        end_page: pages,
        minutes_spent: null,
        notes: "Historical starting complete",
        created_at: serverTimestamp()
      });
      logsCache = [];
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
    await loadBooksCache();
    await renderBookshelf();
    populateBookDropdown();
  } catch (e) {
    showToast('Failed to add book: ' + e.message, 'error');
  }
}

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
    $('eb-cover-preview').innerHTML = b.cover_url ? `<img src="${b.cover_url}" class="w-full h-full object-cover rounded-lg">` : `<i class="fa-solid fa-image"></i>`;
  }
  const searchBtn = $('eb-btn-search-cover');
  if (searchBtn) searchBtn.onclick = () => autoFindSingleCover('eb-title', 'eb-author', 'eb-cover-url', 'eb-cover-preview');
  $('edit-book-modal').classList.add('open');
}

async function saveEditBook() {
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

async function saveLogEdit() {
  const logId = $('edit-log-id').value;
  if (!logId || !currentEditingLog) {
    showToast('Error: No log entry selected for editing', 'error');
    return;
  }

  const date = $('edit-log-date').value;
  const start = parseInt($('edit-log-start').value, 10) || 0;
  const end = parseInt($('edit-log-end').value, 10);
  const cycle = parseInt($('edit-log-cycle').value, 10) || 1;
  const mins = parseInt($('edit-log-minutes').value, 10) || null;
  const notes = $('edit-log-notes').value.trim() || null;

  if (!date) { showToast('Please enter a date.', 'error'); return; }
  if (isNaN(end) || end <= 0) { showToast('Please enter a valid end page.', 'error'); return; }
  if (end <= start) { showToast('End page must be greater than start page.', 'error'); return; }

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

async function addWishlistItem() {
  const title = $('wl-title').value.trim();
  if (!title) { showToast('Please enter a title', 'error'); return; }

  const item = {
    title,
    author:       $('wl-author').value.trim(),
    category:     $('wl-category').value,
    priority:     $('wl-priority').value,
    status:       $('wl-status').value,
    est_pages:    parseInt($('wl-pages').value) || 0,
    est_cost:     0,
    where_to_buy: '',
    date_added:   todayISO(),
    notes:        ''
  };

  await addDoc(collection(db, `users/${uid}/wishlist`), item);
  wishlistCache = []; // invalidate cache
  $('wishlist-modal').classList.remove('open');
  $('wl-title').value = ''; $('wl-author').value = ''; $('wl-pages').value = '';
  showToast('Added to wishlist ✓', 'success');
  renderWishlist();
}







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

  const isDark = document.body.classList.contains('light-mode');
  const labelColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

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
      style: `font-size: 8px; fill: ${labelColor}; font-weight: 600; font-family: -apple-system, sans-serif`
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
      style: `font-size: 8px; font-weight: 800; fill: var(--text-primary); font-family: -apple-system, sans-serif`
    });
    valText.textContent = val;
    svg.appendChild(valText);

    const yearText = svgEl('text', {
      x: x + barWidth / 2, y: height - 8,
      'text-anchor': 'middle',
      style: `font-size: 8px; fill: ${labelColor}; font-weight: 600; font-family: -apple-system, sans-serif`
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
      <p class="text-[10px] font-bold text-slate-400 mt-0.5">${completedBooksInYear.length} book${completedBooksInYear.length === 1 ? '' : 's'} read</p>
    </div>
    <button class="w-8 h-8 rounded-full flex items-center justify-center bg-slate-800/40 text-slate-450" id="close-year-popup">
      <i class="fa-solid fa-xmark text-sm"></i>
    </button>
  `;
  card.appendChild(header);
  
  // Books list
  const list = el('div', 'flex flex-col gap-2.5 mt-2 overflow-y-auto max-h-[60vh] safe-padding-bottom');
  if (completedBooksInYear.length === 0) {
    list.innerHTML = `<div class="text-xs text-slate-500 italic py-2 text-center">No completed books recorded for ${year}.</div>`;
  } else {
    // Sort chronologically ascending
    const sorted = [...completedBooksInYear].sort((a, b) => a.date.localeCompare(b.date));
    sorted.forEach((c, idx) => {
      const book = booksCache.find(b => b.title === c.title);
      const row = el('div', 'glass-panel p-3.5 rounded-2xl flex justify-between items-center border border-white/5 active:scale-[0.98] transition-all cursor-pointer');
      row.innerHTML = `
        <div class="min-w-0 pr-3 flex-1">
          <div class="text-xs font-bold text-slate-100 truncate">${idx + 1}. ${c.title}</div>
          <div class="text-[9px] text-slate-400 truncate mt-0.5">${book ? book.author || 'Unknown' : 'Unknown'}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-[10px] font-black text-emerald">${c.date}</div>
          <div class="text-[8px] text-slate-400 font-semibold mt-0.5">${c.pages || 0} pg</div>
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
  
  const isDark = document.body.classList.contains('light-mode');
  const trackColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';

  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'w-full h-full', style: 'display:block' });
  svg.appendChild(svgEl('circle', { cx: '50', cy: '50', r: '37', fill: 'none', stroke: trackColor, 'stroke-width': '8' }));

  const centerOverlay = el('div', 'absolute inset-0 flex flex-col items-center justify-center pointer-events-none p-1');
  const overlayTotal = el('span', 'text-base font-black text-slate-100 tracking-tight');
  overlayTotal.textContent = fmtNum(total);
  const overlayLabel = el('span', 'text-[9px] font-bold tracking-wider text-slate-400 uppercase text-center mt-0.5 max-w-[80px] leading-tight');
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
      <span class="font-semibold text-slate-200">${cat}</span>
      <span class="text-slate-450 font-bold ml-auto">${valLabel} (${pctVal}%)</span>
    `;
    legendGrid.appendChild(legendItem);

    segment.addEventListener('mouseenter', () => {
      segment.setAttribute('stroke-width', '12');
      overlayTotal.textContent = fmtNum(count);
      overlayLabel.textContent = cat;
      legendItem.classList.add('bg-white/5', 'border-white/10');
    });

    segment.addEventListener('mouseleave', () => {
      segment.setAttribute('stroke-width', '10');
      overlayTotal.textContent = fmtNum(total);
      overlayLabel.textContent = categoryChartMode === 'pages' ? 'Pages' : 'Books';
      legendItem.classList.remove('bg-white/5', 'border-white/10');
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

// =========================================================================
// SECTION 6: GITHUB-STYLE INTENSITY HEATMAP MATRIX (Interactive Tooltips & HSL Colors)
// =========================================================================
function renderActivityHeatmap(logs) {
  const container = document.getElementById('heatmap-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  const activityMap = {};
  logs.forEach(log => {
    const dStr = log.date;
    const start = parseInt(log.start_page || 0, 10);
    const end = parseInt(log.end_page || 0, 10);
    const pages = parseInt(log.pages_read_today, 10) || parseInt(log.pagesRead, 10) || Math.max(0, end - start) || 0;
    activityMap[dStr] = (activityMap[dStr] || 0) + pages;
  });

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
  
  for (let i = daysCount; i >= 0; i--) {
    const activeDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const year = activeDate.getFullYear();
    const month = String(activeDate.getMonth() + 1).padStart(2, '0');
    const day = String(activeDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    const pagesRead = activityMap[dateStr] || 0;
    
    const block = document.createElement('div');
    block.className = 'heatmap-day';
    
    if (pagesRead > 0) {
      activeCellsCount++;
      if (pagesRead <= 10) block.classList.add('heatmap-tier-1');
      else if (pagesRead <= 20) block.classList.add('heatmap-tier-2');
      else if (pagesRead <= 40) block.classList.add('heatmap-tier-3');
      else block.classList.add('heatmap-tier-4');
    }
    
    const dateFormatted = activeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    block.setAttribute('title', `${dateFormatted}: ${pagesRead} pages read`);
    
    block.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerHaptic();
      
      const dayLogs = logs.filter(l => l.date === dateStr);
      const booksDone = dayLogs.filter(l => {
        const book = booksCache.find(b => b.title === l.book_title);
        return book && parseInt(l.end_page || 0, 10) >= parseInt(book.total_pages || 0, 10);
      });

      openHeatmapDayModal(dateStr, dayLogs, booksDone);
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
  $('bd-title').textContent = b.title;
  $('bd-author').textContent = b.author ? `by ${b.author}` : 'Unknown Author';
  
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
  let badgeColor = 'bg-slate-800/40 text-slate-400 border-white/5';
  if (isFin) badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10';
  else if (isAct) badgeColor = 'bg-blue-500/10 text-blue-400 border-blue-500/10';
  else if (isWl) badgeColor = 'bg-violet-500/10 text-violet-400 border-violet-500/10';
  else if (b.status === 'Owned') badgeColor = 'bg-amber-500/10 text-amber-400 border-amber-500/10';
  
  let ownBadgeColor = 'bg-slate-800/40 text-slate-350 border-white/5';
  if (b.ownership === 'Owned') ownBadgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10';
  else if (b.ownership === 'Borrowed') ownBadgeColor = 'bg-blue-500/10 text-blue-400 border-blue-500/10';
  else if (b.ownership === 'Wishlist') ownBadgeColor = 'bg-violet-500/10 text-violet-400 border-violet-500/10';

  const prioClasses = {
    'High': 'bg-rose-500/10 text-rose-400 border-rose-500/10',
    'Medium': 'bg-amber-500/10 text-amber-400 border-amber-500/10',
    'Low': 'bg-slate-800/40 text-slate-400 border-white/5'
  };
  const prioBadge = prioClasses[b.priority] || prioClasses['Low'];
  
  $('bd-badges').innerHTML = `
    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${badgeColor}">${b.status}</span>
    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-slate-800/40 text-slate-350 border border-white/5">${b.collection === 'Bahai' ? "Bahá'í" : "Non-Bahá'í"}</span>
    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-slate-800/40 text-slate-350 border border-white/5">${b.group || 'Other'}</span>
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
        <div class="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
          <i class="fa-solid fa-shopping-cart text-[10px] text-amber-400"></i>
          <span>Where to Buy:</span>
          ${isUrl ? `<a href="${b.where_to_buy}" target="_blank" class="text-amber-400 underline truncate hover:text-amber-300 font-semibold">${b.where_to_buy}</a>` : `<span class="text-slate-200 truncate font-semibold">${b.where_to_buy}</span>`}
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
    timeline.innerHTML = `<div class="text-xs text-slate-500 italic py-2">No read sessions logged yet.</div>`;
  } else {
    // Sort chronologically ASCENDING
    const sortedLogs = [...bookLogs].sort((a, b) => new Date(a.date) - new Date(b.date));
    sortedLogs.forEach(l => {
      const addedPages = parseInt(l.end_page || 0, 10) - parseInt(l.start_page || 0, 10);
      const minutes = l.minutes_spent ? ` · ⏱ ${l.minutes_spent} min` : '';
      
      const item = el('div', 'flex flex-col gap-1 relative pl-4');
      // Timeline bullet indicator
      const bullet = el('div', 'absolute left-[-16px] top-[4px] w-2 h-2 rounded-full border bg-slate-950 border-white/20');
      if (l.notes && l.notes.includes('Historical')) bullet.classList.add('bg-emerald-500', 'border-emerald-500/20');
      else bullet.classList.add('bg-blue-500', 'border-blue-500/20');
      
      let notesHTML = '';
      if (l.notes) {
        notesHTML = `
          <div class="text-[11px] text-slate-350 italic px-2.5 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] mt-1 whitespace-pre-wrap leading-relaxed">
            <i class="fa-solid fa-quote-left text-[8px] text-slate-500 mr-1 align-top"></i>${l.notes}
          </div>
        `;
      }
      
      item.innerHTML = `
        <div class="flex justify-between items-center text-[10px] font-bold text-slate-400">
          <span>${l.date}</span>
          <span class="text-slate-300">Cycle ${l.read_cycle}</span>
        </div>
        <div class="text-xs font-bold text-slate-200">
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
    bookLogs.sort((a,b) => new Date(a.date) - new Date(b.date));
    
    const lastLog = bookLogs[bookLogs.length - 1];
    currentCycle = parseInt(lastLog.read_cycle || 1, 10);
    startPage = parseInt(lastLog.end_page || 0, 10);
    
    if (startPage >= parseInt(book.total_pages || 0, 10)) {
      currentCycle += 1;
      startPage = 0;
    }
  }
  
  document.getElementById('log-start').value = startPage;
  document.getElementById('log-cycle').value = currentCycle;
}

// =========================================================================
// SERVICE WORKER AUTO-UPDATE RELOAD
// =========================================================================
if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (window.isMockAuth) return;
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      if (reg && reg.update) {
        reg.update().catch(err => console.warn('SW update ignored error:', err));
      }
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              if (window.isMockAuth) return;
              if (!refreshing) {
                refreshing = true;
                window.location.reload();
              }
            }
          });
        }
      });
    }).catch(err => console.warn('SW register ignored error:', err));
  });
}

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

  const response = await fetch(SCANNER_CONFIG.getApiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errJson = await response.json().catch(() => ({}));
    const msg = errJson.error?.message || `Status ${response.status}`;
    if (response.status === 403 || msg.includes('disabled') || msg.includes('API key not valid')) {
      localStorage.removeItem('rt_gemini_api_key');
      openGeminiKeyModal();
      throw new Error("Invalid or disabled Gemini API Key. Please enter a free key from Google AI Studio.");
    }
    throw new Error(`Google Gemini AI Error: ${msg}`);
  }

  const resultData = await response.json();
  const textBody = resultData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textBody) {
    throw new Error("Transcribing algorithm returned an empty payload.");
  }
  return JSON.parse(textBody);
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
        <button onclick="discardScannedShelfItem(${idx})" class="text-neutral-400 hover:text-red-400 p-1.5 rounded-lg bg-white/5 border border-white/5 text-xs"><i class="fa-solid fa-trash"></i></button>
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
  if (typeof reconciledStatsCache !== 'undefined') reconciledStatsCache.clear(); 
  if (typeof window.render3DSpineBookshelf === 'function') window.render3DSpineBookshelf();
};
window.getLogsCache = () => logsCache;
window.setLogsCache = (arr) => { logsCache = arr; if (typeof reconciledStatsCache !== 'undefined') reconciledStatsCache.clear(); };
window.getWishlistCache = () => wishlistCache;
window.setWishlistCache = (arr) => { wishlistCache = arr; if (typeof reconciledStatsCache !== 'undefined') reconciledStatsCache.clear(); };

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
    return JSON.parse(localStorage.getItem('rt_standalone_notes') || '[]');
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

  const favIds = getFavoriteNoteIds();
  const standaloneNotes = getStandaloneNotes();
  const notesList = [];

  // 1. Extract non-empty notes from session logs
  logsCache.forEach((log, index) => {
    if (log.notes && log.notes.trim() && !log.notes.startsWith('Historical cycle')) {
      const noteId = log.id ? `log_${log.id}` : `log_${log.date}_${index}_${(log.book_title || '').slice(0, 10)}`;
      const isManualFav = favIds.includes(noteId);
      const isAutoFav = log.notes.includes('★') || log.notes.toLowerCase().includes('favorite');
      const startP = log.start_page || log.startPage || null;
      const endP = log.end_page || log.endPage || null;
      let pageLabel = null;
      if (startP != null && endP != null && endP > startP) {
        pageLabel = `pp. ${startP}–${endP}`;
      } else if (endP != null && endP > 0) {
        pageLabel = `p. ${endP}`;
      }

      notesList.push({
        id: noteId,
        type: 'log',
        title: log.book_title || 'Reading Session',
        author: log.author || '',
        date: log.date,
        cycle: log.read_cycle || 1,
        notes: log.notes,
        pageLabel: pageLabel,
        isQuote: log.notes.includes('">') || log.notes.includes('"') || log.notes.length > 30,
        isFavorite: isManualFav || isAutoFav
      });
    }
  });

  // 2. Extract notes attached directly to book items
  booksCache.forEach(b => {
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
        isQuote: true,
        isFavorite: isManualFav || true
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
      isFavorite: isManualFav || sn.isFavorite || false
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
    booksCache.filter(b => b.status === 'In Progress' || b.status === 'Reading').map(b => b.title)
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
    const currentVal = bookSelect.value || 'all';
    const bookTitles = Array.from(new Set(notesList.map(n => n.title))).sort();
    let optionsHTML = `<option value="all">📚 All Books & Notes</option><option value="standalone">📝 Standalone Notes</option>`;
    bookTitles.forEach(t => {
      if (t !== 'Quick Note' && t !== 'Standalone Note') {
        optionsHTML += `<option value="${t.replace(/"/g, '&quot;')}">📖 ${t}</option>`;
      }
    });
    bookSelect.innerHTML = optionsHTML;
    bookSelect.value = currentVal;

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
    filtered = filtered.filter(n => !n.isQuote || n.notes.length > 50);
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
    feed.innerHTML = `
      <div class="glass-panel p-8 text-center rounded-3xl flex flex-col items-center gap-3">
        <i class="fa-solid fa-quote-left text-3xl text-amber-400/40"></i>
        <p class="text-sm font-bold text-slate-200">No notes found for this filter</p>
        <p class="text-xs text-slate-400">Log a session with notes, click Quick Note, or clear your search query.</p>
      </div>
    `;
    return;
  }

  // 8. Render Quote Cards
  filtered.forEach(n => {
    const card = el('div', 'quote-card animate-fade-in flex flex-col gap-2 relative');
    
    let photoHTML = '';
    if (n.photoUrl) {
      photoHTML = `<div class="mb-2 rounded-xl overflow-hidden max-h-48 border border-white/10"><img src="${n.photoUrl}" class="w-full object-cover" alt="Note Photo Attachment" /></div>`;
    }

    let pageHTML = '';
    if (n.pageLabel) {
      pageHTML = `<span class="page-badge"><i class="fa-solid fa-bookmark text-[9px] text-amber-400 mr-1"></i>${n.pageLabel}</span>`;
    }

    card.innerHTML = `
      ${photoHTML}
      <blockquote class="italic text-sm font-medium leading-relaxed" style="color: var(--text-primary)">
        "${n.notes.replace(/^>\s*/, '')}"
      </blockquote>
      <div class="flex items-center justify-between text-xs mt-2 pt-2 border-t border-white/5">
        <div class="flex flex-col min-w-0 pr-2">
          <span class="font-bold truncate" style="color: var(--gold)">${n.title}</span>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="text-[10px] text-slate-400">${n.author ? n.author + ' • ' : ''}${fmtDate(n.date)}</span>
            ${pageHTML}
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
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

  // Wire Export Vault ZIP button
  const zipBtn = $('btn-export-markdown-zip');
  if (zipBtn) zipBtn.onclick = exportObsidianMarkdownVault;

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
    favIcon.className = qnModalFavorite ? 'fa-solid fa-star text-amber-400' : 'fa-regular fa-star';
  }
  if (favLabel) {
    favLabel.textContent = qnModalFavorite ? 'Favorited' : 'Mark Favorite';
    favLabel.className = qnModalFavorite ? 'text-amber-400 font-bold' : 'text-slate-400';
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
    photoFile.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        qnUploadedPhotoData = {
          dataUrl: evt.target.result,
          file: file
        };
        const previewBox = $('qn-photo-preview-box');
        const imgElem = $('qn-photo-img');
        if (imgElem) imgElem.src = evt.target.result;
        if (previewBox) previewBox.classList.remove('hidden');
        Haptics.success();
      };
      reader.readAsDataURL(file);
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

  if (saveBtn) {
    saveBtn.onclick = () => {
      const titleInput = $('qn-title-input') ? $('qn-title-input').value.trim() : '';
      const textInput = $('qn-text-input') ? $('qn-text-input').value.trim() : '';
      const bookSelect = $('qn-book-select') ? $('qn-book-select').value : '';

      if (!textInput && !qnUploadedPhotoData) {
        showToast('Please type a note or upload a photo', 'warning');
        return;
      }

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
    };
  }
}

/**
 * Export Obsidian-Compatible Markdown Vault ZIP Archive
 */
async function exportObsidianMarkdownVault() {
  if (typeof JSZip === 'undefined') {
    showToast('JSZip library loading... please try again in a moment');
    return;
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
   ══════════════════════════════════════════════════════════════ */
let sabbaticalSelectedReason = 'Vacation';

function initSabbaticalModule() {
  const modal = $('modal-sabbatical');
  const closeBtn = $('sabbatical-modal-close');
  const backdrop = $('sabbatical-modal-backdrop');
  const confirmBtn = $('btn-sabbatical-confirm');

  if (!modal) return;

  // Reason buttons
  document.querySelectorAll('#sabbatical-reasons-grid .reason-btn').forEach(btn => {
    btn.onclick = () => {
      if (navigator.vibrate) navigator.vibrate([8]);
      document.querySelectorAll('#sabbatical-reasons-grid .reason-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      sabbaticalSelectedReason = btn.dataset.reason;

      const customContainer = $('sabbatical-custom-container');
      if (customContainer) {
        customContainer.classList.toggle('hidden', sabbaticalSelectedReason !== 'Custom');
      }
    };
  });

  const closeModal = () => modal.classList.remove('open');
  if (closeBtn) closeBtn.onclick = closeModal;
  if (backdrop) backdrop.onclick = closeModal;

  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      let finalReason = sabbaticalSelectedReason;
      if (sabbaticalSelectedReason === 'Custom') {
        const customInput = $('sabbatical-custom-reason');
        finalReason = (customInput && customInput.value.trim()) ? customInput.value.trim() : 'Custom Sabbatical';
      }

      const daysInput = $('sabbatical-days');
      const daysCount = parseInt(daysInput ? daysInput.value : '7', 10) || 7;

      const sabbaticalRecord = {
        id: 'sab_' + Date.now(),
        reason: finalReason,
        days: daysCount,
        startDate: todayISO(),
        endDate: new Date(Date.now() + daysCount * 86400000).toISOString().slice(0, 10),
        created_at: new Date().toISOString()
      };

      if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
      showToast(`🛡️ Streak Freeze Activated for ${daysCount} Days (${finalReason})`);
      closeModal();
    };
  }
}

window.openSabbaticalModal = function() {
  const modal = $('modal-sabbatical');
  if (modal) {
    modal.classList.add('open');
    if (navigator.vibrate) navigator.vibrate([10]);
  }
};

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

/* Full-Screen Reading Timer Overlay State & Logic */
let fullTimerState = {
  seconds: 0,
  intervalId: null,
  book: null,
  startPage: 0,
  currentEndPage: 0
};

window.openFullTimerSession = function(book) {
  const overlay = document.getElementById('timer-fullscreen-overlay');
  if (!overlay) return;

  fullTimerState.book = book;
  fullTimerState.startPage = book ? (book.current_page || 0) : 0;
  fullTimerState.currentEndPage = fullTimerState.startPage;
  fullTimerState.seconds = 0;

  const titleEl = document.getElementById('timer-book-title');
  const startEl = document.getElementById('timer-start-page');
  const pagesReadEl = document.getElementById('timer-pages-read');
  const clockEl = document.getElementById('timer-clock-display');

  if (titleEl) titleEl.textContent = book ? book.title : 'Active Reading Session';
  if (startEl) startEl.textContent = fullTimerState.startPage;
  if (pagesReadEl) pagesReadEl.textContent = '+0';
  if (clockEl) clockEl.textContent = '00:00';

  overlay.classList.add('active');
  startTimerClock();
};

function startTimerClock() {
  if (fullTimerState.intervalId) clearInterval(fullTimerState.intervalId);
  fullTimerState.intervalId = setInterval(() => {
    fullTimerState.seconds++;
    const mins = Math.floor(fullTimerState.seconds / 60);
    const secs = fullTimerState.seconds % 60;
    const clockEl = document.getElementById('timer-clock-display');
    const paceEl = document.getElementById('timer-speed-pace');

    if (clockEl) clockEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    const elapsedHours = fullTimerState.seconds / 3600;
    const pagesRead = fullTimerState.currentEndPage - fullTimerState.startPage;
    if (paceEl) {
      paceEl.textContent = elapsedHours > 0.01 ? `${Math.round(pagesRead / elapsedHours)} p/hr` : '0 p/hr';
    }
  }, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  const minBtn = document.getElementById('timer-btn-minimize');
  const pauseBtn = document.getElementById('timer-btn-pause');
  const completeBtn = document.getElementById('timer-btn-complete');
  const overlay = document.getElementById('timer-fullscreen-overlay');

  if (minBtn) minBtn.onclick = () => overlay && overlay.classList.remove('active');
  if (pauseBtn) {
    pauseBtn.onclick = () => {
      if (fullTimerState.intervalId) {
        clearInterval(fullTimerState.intervalId);
        fullTimerState.intervalId = null;
        pauseBtn.innerHTML = '<i class="fa-solid fa-play mr-1"></i> Resume';
      } else {
        startTimerClock();
        pauseBtn.innerHTML = '<i class="fa-solid fa-pause mr-1"></i> Pause';
      }
    };
  }

  if (completeBtn) {
    completeBtn.onclick = () => {
      if (fullTimerState.intervalId) clearInterval(fullTimerState.intervalId);
      const minutesSpent = Math.max(1, Math.round(fullTimerState.seconds / 60));
      overlay && overlay.classList.remove('active');
      if (fullTimerState.book && typeof openQuickLogModal === 'function') {
        openQuickLogModal(fullTimerState.book, minutesSpent);
      } else if (typeof showToast === 'function') {
        showToast(`Focus session logged: ${minutesSpent} min`, 'success');
      }
    };
  }

  const hmClose = document.getElementById('heatmap-day-close-btn');
  const hmBackdrop = document.getElementById('heatmap-day-backdrop');
  if (hmClose) hmClose.onclick = closeHeatmapDayModal;
  if (hmBackdrop) hmBackdrop.onclick = closeHeatmapDayModal;
});

(function restoreEditorialTheme() {
  const savedTheme = localStorage.getItem('rt_editorial_theme') || (localStorage.getItem('rt_theme') === 'light' ? 'parched-paper' : 'espresso');
  if (typeof setEditorialTheme === 'function') setEditorialTheme(savedTheme);
})();

window.render3DSpineBookshelf = async function(items) {
  const shelfContainer = document.getElementById('bookshelf-3d-shelf');
  if (!shelfContainer) return;
  
  let list = items;
  if (!list || !list.length) {
    if (typeof getMergedBooks === 'function') {
      try {
        list = await getMergedBooks();
      } catch (err) {}
    }
  }
  if (!list || !list.length) {
    list = (typeof booksCache !== 'undefined' && Array.isArray(booksCache) && booksCache.length) 
      ? booksCache 
      : (Array.isArray(window.booksCache) ? window.booksCache : []);
  }

  const books = (list || []).slice(0, 24);
  if (!books.length) {
    shelfContainer.innerHTML = '<div class="text-xs text-slate-500 py-4 text-center w-full font-mono">No books loaded in shelf</div>';
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
  shelfContainer.innerHTML = books.map((b, i) => {
    const pages = parseInt(b.total_pages || b.pages || 250);
    const height = Math.min(210, Math.max(135, 135 + (pages % 75)));
    const grad = gradients[i % gradients.length];
    const safeTitle = (b.title || 'Untitled').replace(/"/g, '&quot;');
    const safeAuthor = (b.author || '').replace(/"/g, '&quot;');
    return `<div class="book-spine-item relative overflow-hidden shadow-lg border-x border-white/10" style="height: ${height}px; background: ${grad}; color: #F5EBE6;" title="${safeTitle}${safeAuthor ? ' by ' + safeAuthor : ''}">
      <div class="absolute top-1 left-0 right-0 h-0.5 bg-amber-400/70"></div>
      <div class="absolute bottom-1 left-0 right-0 h-0.5 bg-amber-400/70"></div>
      <span class="truncate font-serif text-xs font-semibold leading-none">${safeTitle}</span>
    </div>`;
  }).join('');
};

setTimeout(() => {
  if (typeof window.render3DSpineBookshelf === 'function') window.render3DSpineBookshelf();
}, 1000);


