// ─── Reading Tracker — app.js ────────────────────────────────────────────────
// Global Error Handler for debugging
window.addEventListener('error', e => {
  const errDiv = document.createElement('div');
  errDiv.className = 'fixed top-0 inset-x-0 bg-red-600 text-white text-xs p-4 z-[9999] overflow-auto max-h-40';
  errDiv.textContent = `JS Error: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`;
  document.body.appendChild(errDiv);
});
window.addEventListener('unhandledrejection', e => {
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

// ── State ─────────────────────────────────────────────────────────────────────
let uid        = null;
let booksCache = [];          // all book docs { id, ...data }
let wishlistCache = [];       // all wishlist items
let logsCache = [];           // cached reading logs
let goalsCache = {};
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

function initTheme() {
  const saved = localStorage.getItem('rt_theme') || 'light';
  const isDark = saved === 'dark'; // saved is 'dark' -> class 'light-mode' active
  if (isDark) {
    document.body.classList.add('light-mode');
  } else {
    document.body.classList.remove('light-mode');
  }
  const icon = $('theme-icon');
  if (icon) {
    icon.classList.toggle('fa-moon', !isDark);
    icon.classList.toggle('fa-sun', isDark);
  }
  updateMetaThemeColor(!isDark);
}

function toggleTheme() {
  const isDark = document.body.classList.toggle('light-mode'); // true means light-mode class added -> Dark Theme
  localStorage.setItem('rt_theme', isDark ? 'dark' : 'light');
  const icon = $('theme-icon');
  if (icon) {
    icon.classList.toggle('fa-moon', !isDark);
    icon.classList.toggle('fa-sun', isDark);
  }
  updateMetaThemeColor(!isDark);
  
  if (currentView === 'dashboard') {
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
    if (isMobile) {
      await signInWithRedirect(auth, gp);
    } else {
      await signInWithPopup(auth, gp);
    }
  } catch (e) {
    showToast('Sign-in failed: ' + e.message, 'error');
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

    // Check if database needs seeding
    const booksSnap = await getDocs(query(collection(db, `users/${uid}/books`), limit(1)));
    if (booksSnap.empty) {
      await runSeedImport();
      await loadBooksCache();
      await loadLogsCache();
      populateBookDropdown();
      if (typeof populateGroupDatalist === 'function') populateGroupDatalist(booksCache);
      
      if (currentView === 'dashboard') renderDashboard();
      if (currentView === 'goals')     renderGoals();
      if (currentView === 'wishlist')  renderWishlist();
      if (currentView === 'library')   renderLibrary();
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

// ── Books Cache ───────────────────────────────────────────────────────────────
async function loadBooksCache() {
  const snap = await getDocs(collection(db, `users/${uid}/books`));
  booksCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  booksCache.sort((a, b) => a.title.localeCompare(b.title));
}

async function loadLogsCache() {
  if (logsCache.length === 0) {
    const snap = await getDocs(query(collection(db, `users/${uid}/reading_logs`), orderBy('date', 'desc')));
    logsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
}

async function getMergedBooks() {
  await loadBooksCache();
  if (wishlistCache.length === 0) {
    const snap = await getDocs(collection(db, `users/${uid}/wishlist`));
    wishlistCache = snap.docs.map(d => ({ id: d.id, ...d.data(), _isWishlist: true }));
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
      group: b.group || 'Other',
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
        group: w.category || w.group || 'Other',
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

  return [...libraryItems, ...wishlistOnly];
}

// ── Navigation ────────────────────────────────────────────────────────────────
function setupNav() {
  // Wire iOS tab bar
  document.querySelectorAll('#tab-bar .tab-item').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

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
  if (name === 'goals')     renderGoals();
  if (name === 'wishlist')  renderBookshelf();
  if (name === 'log')       renderLogView();

  // Show/hide wishlist FAB (now always hidden — add book is in header)
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
  // Get all logs for this book
  const logsSnap = await getDocs(query(
    collection(db, `users/${uid}/reading_logs`),
    where('book_title', '==', title)
  ));

  // Group by cycle → max end_page per cycle
  const cycleMaxes = {};
  for (const d of logsSnap.docs) {
    const { read_cycle, end_page } = d.data();
    if (cycleMaxes[read_cycle] === undefined || end_page > cycleMaxes[read_cycle]) {
      cycleMaxes[read_cycle] = end_page;
    }
  }

  // Find this book in cache
  const book = booksCache.find(b => b.title === title);
  if (!book) return;
  const tot = book.total_pages;

  const logs = logsSnap.docs.map(d => d.data());
  const newStatus = evaluateBookReadingProgress(book, logs);

  const completedCycles = Object.values(cycleMaxes).filter(m => m >= tot).length;
  const maxCurrentCycle = cycleMaxes[cycle] ?? 0;

  let newPagesRead;
  if (newStatus === 'Finished') {
    newPagesRead = tot * completedCycles;
  } else if (newStatus === 'In Progress') {
    const prevCompleted = Object.entries(cycleMaxes)
      .filter(([c, m]) => parseInt(c) !== cycle && m >= tot).length;
    newPagesRead = tot * prevCompleted + maxCurrentCycle;
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
      read_count: completedCycles
    });
    // Update local cache too
    const cached = booksCache.find(b => b.title === title);
    if (cached) { cached.status = newStatus; cached.pages_read = newPagesRead; cached.read_count = completedCycles; }
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function populateYearDropdown(logs) {
  const sel = $('dash-year-select');
  if (sel.options.length > 1) return; // already populated
  const years = [...new Set(logs.map(l => l.date.slice(0, 4)))].sort((a,b) => b - a);
  sel.innerHTML = '<option value="all">All Time</option>';
  years.forEach(y => {
    const opt = el('option', '', y);
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  });
  sel.value = dashYearFilter;
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
    renderDashboard();
  });

  // Year filter
  $('dash-year-select').addEventListener('change', e => {
    dashYearFilter = e.target.value;
    renderDashboard();
  });

  // Category toggle (Pages vs Books)
  const catToggle = document.getElementById('cat-chart-toggle');
  if (catToggle) {
    catToggle.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        categoryChartMode = btn.dataset.mode;
        catToggle.querySelectorAll('button').forEach(b => {
          const isActive = b.dataset.mode === categoryChartMode;
          b.classList.toggle('text-white', isActive);
          b.classList.toggle('bg-white/10', isActive);
          b.classList.toggle('text-slate-400', !isActive);
        });
        renderBarChart(); // Re-render Category pie chart
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

function renderMilestones(completions, ytdDaysElapsed) {
  const bookThresholds = [10, 25, 50, 100];
  const booksList = $('ms-books-list');
  if (booksList) {
    booksList.innerHTML = '';
    bookThresholds.forEach(t => {
      let completedDate = null;
      if (completions.length >= t) {
        completedDate = completions[t - 1].date;
      }
      const item = el('div', 'flex justify-between border-b border-white/5 pb-1.5 last:border-0 last:pb-0');
      if (completedDate) {
        item.innerHTML = `<span class="text-slate-400">${t} Books Finished</span><span class="text-emerald-400 font-bold">${completedDate === '2020-01-01' ? 'Completed' : fmtDate(completedDate)}</span>`;
      } else {
        const needed = t - completions.length;
        const rate = completions.length / (ytdDaysElapsed || 1);
        const eta = calculateETA(needed, rate > 0 ? rate : 0.05);
        item.innerHTML = `<span class="text-slate-400">${t} Books Milestone</span><span class="text-amber-400 font-bold">ETA: ${eta}</span>`;
      }
      booksList.appendChild(item);
    });
  }

  const pageThresholds = [1000, 5000, 10000, 15000, 25000];
  const pagesList = $('ms-pages-list');
  if (pagesList) {
    pagesList.innerHTML = '';
    
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
    const milestoneReachedDates = {};
    
    pageEvents.forEach(evt => {
      runningPages += evt.pages;
      pageThresholds.forEach(t => {
        if (runningPages >= t && !milestoneReachedDates[t]) {
          milestoneReachedDates[t] = evt.date;
        }
      });
    });

    pageThresholds.forEach(t => {
      const completedDate = milestoneReachedDates[t];
      const item = el('div', 'flex justify-between border-b border-white/5 pb-1.5 last:border-0 last:pb-0');
      if (completedDate) {
        item.innerHTML = `<span class="text-slate-400">${fmtNum(t)} Pages Read</span><span class="text-emerald-400 font-bold">${completedDate === '2020-01-01' ? 'Completed' : fmtDate(completedDate)}</span>`;
      } else {
        const needed = t - runningPages;
        const rate = runningPages / (ytdDaysElapsed || 1);
        const eta = calculateETA(needed, rate > 0 ? rate : 10);
        item.innerHTML = `<span class="text-slate-400">${fmtNum(t)} Pages Milestone</span><span class="text-amber-400 font-bold">ETA: ${eta}</span>`;
      }
      pagesList.appendChild(item);
    });
  }
}

function renderTimeBasedTables(logs, completions) {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthlyData = Array(12).fill(0).map((_, i) => ({ month: monthNames[i], sessions: 0, pages: 0 }));
  
  logs.forEach(l => {
    const m = new Date(l.date).getMonth();
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
    const d = new Date(l.date).getDay();
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
    const m = new Date(l.date).getMonth();
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
  
  const completions = [];
  const logsByBookCycle = {};
  logsCache.forEach(l => {
    const key = `${l.book_title}-${l.read_cycle || 1}`;
    if (!logsByBookCycle[key]) logsByBookCycle[key] = [];
    logsByBookCycle[key].push(l);
  });

  Object.keys(logsByBookCycle).forEach(key => {
    const parts = key.split('-');
    const title = parts.slice(0, -1).join('-');
    const cycle = parseInt(parts[parts.length - 1]);
    const book = mergedBooks.find(b => b.title === title);
    if (book) {
      const tot = book.total_pages;
      const cycleLogs = logsByBookCycle[key];
      const compLogs = cycleLogs.filter(l => l.end_page >= tot);
      if (compLogs.length > 0) {
        compLogs.sort((a,b) => a.date.localeCompare(b.date));
        completions.push({
          title,
          cycle,
          date: compLogs[0].date,
          pages: tot,
          collection: book.collection
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
          date: '2020-01-01',
          pages: b.total_pages,
          collection: b.collection
        });
      }
    }
  });

  completions.sort((a, b) => a.date.localeCompare(b.date));

  const filteredCompletions = completions.filter(c => dashFilter === 'all' || c.collection === dashFilter);

  let totalReads = 0;
  let pagesRead = 0;
  let titlesCount = 0;
  let finishedCount = 0;
  let progressCount = 0;

  if (selectedYear === 'all') {
    totalReads = books.reduce((s, b) => s + (b.read_count || 0), 0);
    titlesCount = books.length;
    finishedCount = books.filter(b => ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status)).length;
    progressCount = books.filter(b => b.status === 'In Progress').length;
    pagesRead = books.reduce((s, b) => s + ((b.read_count || 0) * (b.total_pages || 0)) + (b.status === 'In Progress' ? (b.pages_read || 0) : 0), 0);
  } else {
    const completionsInYear = filteredCompletions.filter(c => c.date.startsWith(selectedYear));
    totalReads = completionsInYear.length;
    pagesRead = filteredLogs.filter(l => l.date.startsWith(selectedYear)).reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);

    const activeTitles = new Set(filteredLogs.filter(l => {
      const book = books.find(b => b.title === l.book_title);
      return !!book;
    }).map(l => l.book_title));
    titlesCount = activeTitles.size;

    activeTitles.forEach(t => {
      const hasFinished = completionsInYear.some(c => c.title === t);
      if (hasFinished) finishedCount++;
      else progressCount++;
    });
  }

  const finishedBooks = books.filter(b => ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status));
  const finishedPagesSum = finishedBooks.reduce((s, b) => s + (b.total_pages || 0), 0);
  const avgPagesPerBook = finishedCount > 0 ? Math.round(finishedPagesSum / finishedCount) : 0;
  
  $('stat-reads').textContent = totalReads;
  $('detail-reads').textContent = `Avg pages/book: ${avgPagesPerBook}`;
  $('stat-titles').textContent = titlesCount;
  $('detail-titles').textContent = `Finished: ${finishedCount} · Active: ${progressCount}`;
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
  renderMilestones(filteredCompletions, ytdDaysElapsed);

  // ── Book Length Records ──
  const finishedInLib = booksCache.filter(b => ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(b.status) || b.read_count > 0);
  let longestBook = '—', shortestBook = '—';
  let longestTitle = '—', shortestTitle = '—';
  let medianLength = 0;
  let booksLarge = 0, booksSmall = 0;

  if (finishedInLib.length > 0) {
    const sortedByLen = [...finishedInLib].sort((a,b) => a.total_pages - b.total_pages);
    shortestBook = `${sortedByLen[0].title} (${sortedByLen[0].total_pages} pg)`;
    longestBook = `${sortedByLen[sortedByLen.length - 1].title} (${sortedByLen[sortedByLen.length - 1].total_pages} pg)`;
    medianLength = getMedian(finishedInLib.map(b => b.total_pages));
    booksLarge = booksCache.filter(b => b.total_pages > 500).length;
    booksSmall = booksCache.filter(b => b.total_pages < 100).length;
    
    const sortedByTitleLen = [...booksCache].sort((a,b) => a.title.length - b.title.length);
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
  booksCache.forEach(b => {
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
  const booksMultiReads = booksCache.filter(b => b.read_count > 1).length;

  $('rec-top-author').textContent = topAuthor;
  $('rec-top-author-reads').textContent = topAuthorReads;
  $('rec-authors-multi').textContent = authorsMulti;
  $('rec-books-multi-reads').textContent = booksMultiReads;

  // ── YOY Card Visibility ──
  $('dash-yoy-card').classList.toggle('hidden', selectedYear !== 'all' && selectedYear !== String(yearNum));

  // ── YTD vs Same Date Last Year (YOY Card calculation) ─────────────────────
  const todayMMDD = today.toISOString().slice(5, 10); // "MM-DD"
  const compYear = selectedYear === 'all' ? yearNum : parseInt(selectedYear);
  
  const targetYearStart = `${compYear}-01-01`;
  const targetYearEnd = `${compYear}-${todayMMDD}`;
  const prevYearStart = `${compYear - 1}-01-01`;
  const prevYearEnd = `${compYear - 1}-${todayMMDD}`;
  
  // Books completed in target year period
  const targetComp = completions.filter(c => c.date >= targetYearStart && c.date <= targetYearEnd && (dashFilter === 'all' || c.collection === dashFilter));
  // Books completed in prev year period
  const prevComp = completions.filter(c => c.date >= prevYearStart && c.date <= prevYearEnd && (dashFilter === 'all' || c.collection === dashFilter));
  
  // Pages read in target year period
  const targetPagesVal = activeLogs
    .filter(l => l.date >= targetYearStart && l.date <= targetYearEnd && (dashFilter === 'all' || (mergedBooks.find(b => b.title === l.book_title)?.collection === dashFilter)))
    .reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);
    
  // Pages read in prev year period
  const prevPagesVal = activeLogs
    .filter(l => l.date >= prevYearStart && l.date <= prevYearEnd && (dashFilter === 'all' || (mergedBooks.find(b => b.title === l.book_title)?.collection === dashFilter)))
    .reduce((s, l) => s + Math.max(0, (l.end_page || 0) - (l.start_page || 0)), 0);

  const bookDiff = targetComp.length - prevComp.length;
  const bookDiffStr = bookDiff >= 0 ? `+${bookDiff}` : `${bookDiff}`;
  
  const pageDiff = targetPagesVal - prevPagesVal;
  const pageDiffStr = pageDiff >= 0 ? `+${fmtNum(pageDiff)}` : `${fmtNum(pageDiff)}`;

  // Calculate percentages for the books comparative bar
  const maxBooksScale = Math.max(targetComp.length * 1.2, prevComp.length * 1.2, 5);
  const booksCurrPct = Math.min(100, (targetComp.length / maxBooksScale) * 100);
  const booksPrevPct = Math.min(100, (prevComp.length / maxBooksScale) * 100);

  // Calculate percentages for the pages comparative bar
  const maxPagesScale = Math.max(targetPagesVal * 1.2, prevPagesVal * 1.2, 500);
  const pagesCurrPct = Math.min(100, (targetPagesVal / maxPagesScale) * 100);
  const pagesPrevPct = Math.min(100, (prevPagesVal / maxPagesScale) * 100);

  $('yoy-books-curr').textContent = targetComp.length;
  $('yoy-books-prev').textContent = prevComp.length;
  $('yoy-books-badge').textContent = bookDiffStr;
  $('yoy-books-badge').className = `px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${bookDiff >= 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/10' : 'bg-rose-500/10 text-rose-400 border border-rose-500/10'}`;
  $('yoy-books-fill').style.width = `${booksCurrPct}%`;
  $('yoy-books-marker').style.left = `${booksPrevPct}%`;

  $('yoy-pages-curr').textContent = fmtNum(targetPagesVal);
  $('yoy-pages-prev').textContent = fmtNum(prevPagesVal);
  $('yoy-pages-badge').textContent = pageDiffStr;
  $('yoy-pages-badge').className = `px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${pageDiff >= 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/10' : 'bg-rose-500/10 text-rose-400 border border-rose-500/10'}`;
  $('yoy-pages-fill').style.width = `${pagesCurrPct}%`;
  $('yoy-pages-marker').style.left = `${pagesPrevPct}%`;

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
  const booksYTD = completions.filter(c => c.date.startsWith(String(yearNum))).length;
  const pagesYTD = completions.filter(c => c.date.startsWith(String(yearNum))).reduce((s, c) => s + c.pages, 0);
  
  const bookMilestones = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 1000];
  const nextBookMilestone = bookMilestones.find(m => m > totalReads) || 1000;
  
  const pageMilestones = [1000, 5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 200000];
  const nextPageMilestone = pageMilestones.find(m => m > pagesRead) || 200000;

  const booksToMilestone = Math.max(0, nextBookMilestone - totalReads);
  const pagesToMilestone = Math.max(0, nextPageMilestone - pagesRead);

  const booksPerDayRate = ytdDaysElapsed > 0 ? booksYTD / ytdDaysElapsed : 0.05;
  const pagesPerDayRate = ytdDaysElapsed > 0 ? targetPagesVal / ytdDaysElapsed : 10;

  const booksETA = calculateETA(booksToMilestone, booksPerDayRate > 0 ? booksPerDayRate : 0.05);
  const pagesETA = calculateETA(pagesToMilestone, pagesPerDayRate > 0 ? pagesPerDayRate : 10);

  // Update Year Progress Card
  const daysRemainingInYear = 365 - ytdDaysElapsed;
  const pagesPerCalendarDay = (targetPagesVal / ytdDaysElapsed).toFixed(1);
  const booksPerMonthYTD = (booksYTD / (ytdDaysElapsed / 30)).toFixed(2);

  $('dash-year-progress').innerHTML = `
    <div class="grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
      <div class="flex justify-between"><span class="text-slate-400 font-medium">Days Elapsed</span><span class="text-slate-200 font-bold">${ytdDaysElapsed}</span></div>
      <div class="flex justify-between"><span class="text-slate-400 font-medium">Days Remaining</span><span class="text-slate-200 font-bold">${daysRemainingInYear}</span></div>
      <div class="flex justify-between"><span class="text-slate-400 font-medium">Books Completed</span><span class="text-slate-200 font-bold">${booksYTD}</span></div>
      <div class="flex justify-between"><span class="text-slate-400 font-medium">Pages Read</span><span class="text-slate-200 font-bold">${fmtNum(targetPagesVal)}</span></div>
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
          <span>${totalReads} / ${nextBookMilestone} Books</span>
        </div>
        <div class="w-full bg-slate-900/50 rounded-full h-1.5 overflow-hidden border border-white/5 mt-0.5">
          <div class="bg-gradient-to-r from-gold to-yellow-500 h-full transition-all" style="width: ${Math.min(100, (totalReads/nextBookMilestone)*100)}%"></div>
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
          <span>${fmtNum(pagesRead)} / ${fmtNum(nextPageMilestone)} Pages</span>
        </div>
        <div class="w-full bg-slate-900/50 rounded-full h-1.5 overflow-hidden border border-white/5 mt-0.5">
          <div class="bg-gradient-to-r from-blue-400 to-emerald-400 h-full transition-all" style="width: ${Math.min(100, (pagesRead/nextPageMilestone)*100)}%"></div>
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
        <div class="flex justify-between items-start gap-3">
          <div class="min-w-0">
            <div class="text-xs font-bold text-slate-100 truncate">${b.title}</div>
            <div class="text-[9px] text-slate-400 truncate mt-0.5">${b.author || ''}</div>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-blue-500/10 text-blue-400 border border-blue-500/10 uppercase">${pct}%</span>
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

  // ── Up Next List ──
  const priorityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
  const upNext = books
    .filter(b => ['Not Started', 'Owned', 'Want to Buy', 'Gifted', 'Borrowed'].includes(b.status))
    .sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3))
    .slice(0, 10);
  const upNextEl = $('dash-up-next-books');
  upNextEl.innerHTML = '';
  if (upNext.length === 0) {
    upNextEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-2 font-medium">No upcoming books</p>';
  } else {
    upNext.forEach(b => {
      const card = el('div', 'glass-panel p-3.5 rounded-2xl flex flex-col gap-2 border border-white/5 active:scale-[0.99] transition-all cursor-pointer carousel-card');
      card.innerHTML = `
        <div class="flex justify-between items-start gap-3">
          <div class="min-w-0">
            <div class="text-xs font-bold text-slate-100 truncate">${b.title}</div>
            <div class="text-[9px] text-slate-400 truncate mt-0.5">${b.author || ''}</div>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-500/10 text-amber-400 border border-amber-500/10 uppercase">${b.priority} Prio</span>
        </div>
      `;
      card.addEventListener('click', () => openBookDetailModal(b));
      upNextEl.appendChild(card);
    });
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
        const book = mergedBooks.find(b => b.title === c.title);
        const card = el('div', 'glass-panel p-3.5 rounded-2xl flex flex-col gap-2 border border-white/5 active:scale-[0.99] transition-all cursor-pointer carousel-card');
        card.innerHTML = `
          <div class="flex justify-between items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="text-xs font-bold text-slate-100 truncate">${c.title}</div>
              <div class="text-[9px] text-slate-400 truncate mt-0.5">${book ? book.author || '' : ''}</div>
            </div>
            <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/10 uppercase">Finished</span>
          </div>
          <div class="flex justify-between text-[9px] text-slate-400 mt-1 border-t border-white/5 pt-1.5 font-semibold">
            <span>Date: <b>${fmtDate(c.date)}</b></span>
            <span>Pages: <b>${c.pages} pg</b></span>
          </div>
        `;
        if (book) {
          card.addEventListener('click', () => openBookDetailModal(book));
        }
        recentEl.appendChild(card);
      });
    }
  }

  // ── Render Charts ──
  renderCharts(completions);
}

// ── Goals & Projections ───────────────────────────────────────────────────────
function setupGoals() {
  $('btn-edit-goals').addEventListener('click', openGoalsModal);
  $('goals-modal-close').addEventListener('click', closeGoalsModal);
  $('goals-modal').addEventListener('click', e => { if (e.target === $('goals-modal')) closeGoalsModal(); });
  $('goals-modal-save').addEventListener('click', saveGoals);
}

async function renderGoals() {
  // Load goals config
  const gSnap = await getDoc(doc(db, `users/${uid}/goals/config`));
  goalsCache  = gSnap.exists() ? gSnap.data() : { annual_books_target:12, annual_pages_target:3000, monthly_books_target:1, monthly_pages_target:300 };

  const today = new Date();
  const year  = today.getFullYear();
  const startOfYearISO = `${year}-01-01`;
  const startOfMonthISO = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

  // Filter active logs (user session logs)
  const activeLogs = logsCache.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));

  // Year to Date stats
  const yearLogs = activeLogs.filter(l => l.date >= startOfYearISO && l.date <= `${year}-12-31`);
  const yearPages = yearLogs.reduce((s, l) => s + Math.max(0, l.end_page - l.start_page), 0);
  const yearSessions = yearLogs.length;
  const yearMinutes = yearLogs.reduce((s, l) => s + (l.minutes_spent || 0), 0);

  // Month to Date stats
  const monthLogs = yearLogs.filter(l => l.date >= startOfMonthISO);
  const monthPages = monthLogs.reduce((s, l) => s + Math.max(0, l.end_page - l.start_page), 0);
  const monthSessions = monthLogs.length;
  const monthMinutes = monthLogs.reduce((s, l) => s + (l.minutes_spent || 0), 0);

  // Build completions list
  const completions = [];
  const logsByBookCycle = {};
  logsCache.forEach(l => {
    const key = `${l.book_title}-${l.read_cycle || 1}`;
    if (!logsByBookCycle[key]) logsByBookCycle[key] = [];
    logsByBookCycle[key].push(l);
  });

  Object.keys(logsByBookCycle).forEach(key => {
    const parts = key.split('-');
    const title = parts.slice(0, -1).join('-');
    const cycle = parseInt(parts[parts.length - 1]);
    const book = booksCache.find(b => b.title === title);
    if (book) {
      const tot = book.total_pages;
      const cycleLogs = logsByBookCycle[key];
      const compLogs = cycleLogs.filter(l => l.end_page >= tot);
      if (compLogs.length > 0) {
        compLogs.sort((a,b) => a.date.localeCompare(b.date));
        completions.push({
          title,
          cycle,
          date: compLogs[0].date,
          pages: tot
        });
      }
    }
  });

  // Calculate books completed YTD and Month
  const yearBooks = completions.filter(c => c.date.startsWith(String(year))).length;
  const monthBooks = completions.filter(c => c.date.startsWith(String(year)) && c.date >= startOfMonthISO).length;

  const aBT = goalsCache.annual_books_target  || 12;
  const aPT = goalsCache.annual_pages_target  || 3000;
  const mBT = goalsCache.monthly_books_target || 1;
  const mPT = goalsCache.monthly_pages_target || 300;

  // Ring fills
  const CIRC = 289;
  const bPct = Math.min(1, yearBooks / aBT);
  const pPct = Math.min(1, yearPages / aPT);
  $('ring-books-fill').style.strokeDashoffset = CIRC - CIRC * bPct;
  $('ring-pages-fill').style.strokeDashoffset = CIRC - CIRC * pPct;
  $('ring-books-val').textContent = yearBooks;
  $('ring-pages-val').textContent = yearPages >= 1000 ? Math.round(yearPages/100)/10 + 'k' : yearPages;
  $('ring-books-lbl').textContent = `/ ${aBT} bks`;
  $('ring-pages-lbl').textContent = `/ ${aPT >= 1000 ? Math.round(aPT/100)/10 + 'k' : aPT} pgs`;

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
      <td class="text-center font-bold text-slate-300">10</td>
      <td class="text-center font-bold text-slate-300">${monthSessions}</td>
      <td>${progressStr(monthSessions, 10)}</td>
    </tr>
    <tr>
      <td>Minutes This Month</td>
      <td class="text-center font-bold text-slate-300">300</td>
      <td class="text-center font-bold text-slate-300">${fmtNum(monthMinutes)}</td>
      <td>${progressStr(monthMinutes, 300)}</td>
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
      <td class="text-center font-bold text-slate-300">100</td>
      <td class="text-center font-bold text-slate-300">${yearSessions}</td>
      <td>${progressStr(yearSessions, 100)}</td>
    </tr>
    <tr>
      <td>Minutes Reading YTD</td>
      <td class="text-center font-bold text-slate-300">${fmtNum(3000)}</td>
      <td class="text-center font-bold text-slate-300">${fmtNum(yearMinutes)}</td>
      <td>${progressStr(yearMinutes, 3000)}</td>
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

  const statusBadge = (cur, req) => {
    const ok = parseFloat(cur) >= parseFloat(req);
    return `<span class="px-2 py-0.5 rounded-full text-[8px] font-black border uppercase ${
      ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10' : 'bg-rose-500/10 text-rose-400 border-rose-500/10'
    }">${ok ? '✓ On Track' : 'Behind'}</span>`;
  };

  const estYearEnd = (curRate, unit) => {
    return Math.round(parseFloat(curRate) * unit);
  };

  $('pace-table-body').innerHTML = `
    <tr>
      <td>Books</td>
      <td class="text-center">1.0 /mo</td>
      <td class="text-center font-extrabold text-slate-200">${currentBooksPace} /mo</td>
      <td class="text-right">${statusBadge(currentBooksPace, 1.0)}</td>
    </tr>
    <tr class="text-[8px] text-slate-400">
      <td colspan="4" class="text-right border-none pt-0 pb-2">Year-End Est: <b>${estYearEnd(yearBooks/Math.max(1, dayOfYear), daysInYear)} books</b></td>
    </tr>
    <tr>
      <td>Pages</td>
      <td class="text-center">${(aPT/daysInYear).toFixed(1)} /day</td>
      <td class="text-center font-extrabold text-slate-200">${currentPagesPace} /day</td>
      <td class="text-right">${statusBadge(currentPagesPace, aPT/daysInYear)}</td>
    </tr>
    <tr class="text-[8px] text-slate-400">
      <td colspan="4" class="text-right border-none pt-0 pb-2">Year-End Est: <b>${fmtNum(estYearEnd(currentPagesPace, daysInYear))} pages</b></td>
    </tr>
    <tr>
      <td>Sessions</td>
      <td class="text-center">1.9 /wk</td>
      <td class="text-center font-extrabold text-slate-200">${currentSessionsPace} /wk</td>
      <td class="text-right">${statusBadge(currentSessionsPace, 1.9)}</td>
    </tr>
    <tr class="text-[8px] text-slate-400">
      <td colspan="4" class="text-right border-none pt-0 pb-2">Year-End Est: <b>${estYearEnd(yearSessions/Math.max(1, dayOfYear), daysInYear)} sessions</b></td>
    </tr>
    <tr>
      <td>Minutes</td>
      <td class="text-center">${(3000/daysInYear).toFixed(1)} /day</td>
      <td class="text-center font-extrabold text-slate-200">${currentMinutesPace} /day</td>
      <td class="text-right">${statusBadge(currentMinutesPace, 3000/daysInYear)}</td>
    </tr>
    <tr class="text-[8px] text-slate-400">
      <td colspan="4" class="text-right border-none pt-0 pb-2">Year-End Est: <b>${fmtNum(estYearEnd(currentMinutesPace, daysInYear))} minutes</b></td>
    </tr>
  `;

  // 3. Long-Term Milestones
  const pagesReadG5 = booksCache.reduce((s, b) => {
    let p = (b.read_count || 0) * b.total_pages;
    if (b.status === 'In Progress') p += (b.pages_read || 0);
    return s + p;
  }, 0);
  
  let rereadsPages = 0;
  activeLogs.forEach(l => {
    const book = booksCache.find(b => b.title === l.book_title);
    if (book) {
      const rc = book.read_count || 0;
      if (l.read_cycle > rc && l.read_cycle > 1) {
        rereadsPages += Math.max(0, l.end_page - l.start_page);
      }
    }
  });
  const totalPagesReadLifetime = pagesReadG5 + rereadsPages;
  const totalReadsLifetime = booksCache.reduce((s, b) => s + (b.read_count || 0), 0);

  const inProgressBooks = booksCache.filter(b => b.status === 'In Progress');
  const pagesLeftIP = inProgressBooks.reduce((s, b) => s + Math.max(0, b.total_pages - b.pages_read), 0);
  
  const calculateETA = (needed, dailyRate) => {
    if (needed <= 0) return '✓ Achieved!';
    if (dailyRate <= 0) return 'Never (Pace is 0)';
    const daysNeeded = needed / dailyRate;
    const eta = new Date();
    eta.setDate(eta.getDate() + daysNeeded);
    return eta.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
      const left = b.total_pages - b.pages_read;
      const pct = Math.round((b.pages_read / b.total_pages) * 100);
      
      const bookLogs = activeLogs.filter(l => l.book_title === b.title);
      let avgRate = 0.5;
      let lastReadStr = 'Not started';
      
      if (bookLogs.length > 0) {
        bookLogs.sort((a,b) => a.date.localeCompare(b.date));
        const oldestDate = new Date(bookLogs[0].date + 'T00:00:00');
        const newestDate = new Date(bookLogs[bookLogs.length - 1].date + 'T00:00:00');
        
        const daysDiff = Math.ceil(Math.abs(newestDate - oldestDate) / 86400000) + 1;
        const totalLoggedPages = bookLogs.reduce((s, l) => s + Math.max(0, l.end_page - l.start_page), 0);
        avgRate = totalLoggedPages / daysDiff;
        if (avgRate <= 0) avgRate = 0.5;
        
        lastReadStr = fmtDate(bookLogs[bookLogs.length - 1].date);
      }
      
      const bookETA = calculateETA(left, avgRate);
      
      const card = el('div', 'glass-panel p-3.5 rounded-2xl flex flex-col gap-2 border border-white/5');
      card.innerHTML = `
        <div class="flex justify-between items-start gap-3">
          <div class="min-w-0">
            <div class="text-xs font-bold text-slate-100 truncate">${b.title}</div>
            <div class="text-[9px] text-slate-400 mt-0.5">Last read: ${lastReadStr} · ${left} pages left (${pct}%)</div>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[8px] font-black bg-blue-500/10 text-blue-400 border border-blue-500/10 uppercase">Active</span>
        </div>
        <div class="flex justify-between items-center text-[10px] text-slate-400 mt-1 border-t border-white/5 pt-2 font-semibold">
          <span>Pace: <b class="text-slate-200">${avgRate.toFixed(1)} pg/day</b></span>
          <span>ETA: <b class="text-gold">${bookETA}</b></span>
        </div>
      `;
      etasContainer.appendChild(card);
    });
  }
}

function openGoalsModal() {
  $('goal-annual-books').value  = goalsCache.annual_books_target  || 12;
  $('goal-annual-pages').value  = goalsCache.annual_pages_target  || 3000;
  $('goal-monthly-books').value = goalsCache.monthly_books_target || 1;
  $('goal-monthly-pages').value = goalsCache.monthly_pages_target || 300;
  $('goals-modal').classList.add('open');
}
function closeGoalsModal() { $('goals-modal').classList.remove('open'); }

async function saveGoals() {
  const data = {
    annual_books_target:  parseInt($('goal-annual-books').value)  || 12,
    annual_pages_target:  parseInt($('goal-annual-pages').value)  || 3000,
    monthly_books_target: parseInt($('goal-monthly-books').value) || 1,
    monthly_pages_target: parseInt($('goal-monthly-pages').value) || 300,
  };
  await setDoc(doc(db, `users/${uid}/goals/config`), data, { merge: true });
  goalsCache = data;
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

  const total = bahaiVal + nonBahaiVal || 1;
  const r = 35, cx = 50, cy = 50, sw = 10;
  const circ = 2 * Math.PI * r; // ~219.91
  const bahaiDash = (bahaiVal / total) * circ;
  const nonBahaiDash = (nonBahaiVal / total) * circ;

  const isDark = document.body.classList.contains('light-mode');
  const c1 = isDark ? '#D6A85C' : '#FF9F0A'; // Bahai (Gold)
  const c2 = isDark ? '#38BDF8' : '#0A84FF'; // Non-Bahai (Sky Blue)
  const trackColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';

  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'w-28 h-28 shrink-0', style: 'display:block' });
  svg.appendChild(svgEl('circle', { cx, cy, r, fill: 'none', stroke: trackColor, 'stroke-width': sw }));

  const centerOverlay = el('div', 'absolute inset-0 flex flex-col items-center justify-center pointer-events-none');
  const overlayTotal = el('span', 'text-xl font-extrabold text-white');
  overlayTotal.textContent = fmtNum(total);
  const overlayLabel = el('span', 'text-[9px] uppercase tracking-wider text-neutral-400');
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
  const svgWrapper = el('div', 'relative w-28 h-28 shrink-0');
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
  
  activeLogs.slice(0, 5).forEach(l => {
    const card = el('div', 'glass-panel p-3.5 rounded-2xl flex items-center justify-between gap-3 border border-white/5 hover:bg-slate-900/30 transition-all cursor-pointer');
    const pages = l.end_page - l.start_page;
    card.innerHTML = `
      <div class="min-w-0 flex-1">
        <div class="text-xs font-bold text-slate-100 truncate">${l.book_title}</div>
        <div class="text-[9px] text-slate-400 mt-0.5">${pages} pg · Cycle ${l.read_cycle} · ${fmtDate(l.date)}</div>
      </div>
      <div class="text-xs font-bold text-slate-200">${l.minutes_spent ? `${l.minutes_spent}m` : '—'}</div>
    `;
    card.addEventListener('click', () => openLogDetailModal(l));
    container.appendChild(card);
  });
}

function openAddBookModal() {
  $('add-book-modal').classList.add('open');
}

function setupBookshelf() {
  const searchEl = $('wishlist-search');
  if (searchEl) {
    searchEl.addEventListener('input', e => {
      bookshelfSearchTerm = e.target.value; // Keep original diacritics for input (normalizer strips them internally!)
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
}

async function renderBookshelf() {
  const allItems = await getMergedBooks();

  const container = $('bookshelf-list');
  if (!container) return;

  const q = bookshelfSearchTerm;

  // Filter based on diacritic-insensitive search term, status tab, and ownership tab
  let filtered = allItems.filter(item => {
    if (q) {
      const normalizedQ = normalizeText(q);
      const matchTitle = normalizeText(item.title).includes(normalizedQ);
      const matchAuthor = normalizeText(item.author).includes(normalizedQ);
      const matchGroup = normalizeText(item.group).includes(normalizedQ);
      if (!matchTitle && !matchAuthor && !matchGroup) return false;
    }

    // 1. Status Filter
    if (bookshelfStatusFilter === 'Not Started') {
      if (!['Not Started', 'Owned', 'Gifted', 'Borrowed'].includes(item.status)) return false;
    } else if (bookshelfStatusFilter === 'In Progress') {
      if (item.status !== 'In Progress') return false;
    } else if (bookshelfStatusFilter === 'Finished') {
      if (!['Finished', 'Owned and Read', 'Borrowed and Read', 'Gifted and Read'].includes(item.status)) return false;
    } else if (bookshelfStatusFilter === 'Wishlist') {
      // Wishlist tab should ONLY include books that are not owned
      if (item.ownership !== 'Wishlist') return false;
    }

    // 2. Ownership Filter
    if (bookshelfOwnershipFilter !== 'All') {
      if (item.ownership !== bookshelfOwnershipFilter) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="flex flex-col items-center justify-center p-12 text-center text-slate-500 gap-3"><span class="text-4xl">📚</span><div class="text-sm font-bold text-slate-400">No books found</div><p class="text-xs text-slate-500">Try a different filter or add a new book</p></div>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(b => {
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

    const card = el('div', 'glass-panel p-5 rounded-3xl border border-white/5 flex flex-col gap-3 relative hover:bg-white/[0.01] active:scale-[0.99] transition-all cursor-pointer');

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
        <div class="min-w-0 flex-1">
          <div class="text-sm font-bold text-slate-100 leading-snug line-clamp-2">&#8203;${b.title}</div>
          <div class="text-[11px] text-slate-400 truncate mt-0.5">${b.author || 'Unknown Author'} · ${b.total_pages || 'N/A'} pg${costText}</div>
        </div>
        <span class="shrink-0 text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider border ${badgeColor}">${b.status}</span>
      </div>

      <div class="flex flex-wrap gap-1.5 mt-0.5">
        <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-slate-800/40 text-slate-350 border border-white/5">${b.collection === 'Bahai' ? "Bahá'í" : "Non-Bahá'í"}</span>
        <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-slate-800/40 text-slate-350 border border-white/5">${b.group || 'Other'}</span>
        <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider border ${prioBadge}">Priority: ${b.priority}</span>
        <span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider border ${ownBadgeColor}">${b.ownership}</span>
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

    // Click card to open Detail Modal
    card.addEventListener('click', e => {
      // Avoid modal if clicking action buttons
      if (e.target.closest('button') || e.target.closest('a')) return;
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

    container.appendChild(card);
  });
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

function openEditBookModal(b) {
  $('eb-book-id').value = b.id;
  $('eb-title').value = b.title;
  $('eb-pages').value = b.total_pages;
  $('eb-read-count').value = b.read_count || 0;
  $('eb-status').value = b.status;
  $('eb-progress').value = b.status === 'In Progress' ? (b.pages_read || 0) : 0;
  $('eb-priority').value = b.priority || 'Low';
  $('eb-cost').value = b.est_cost || 0;
  $('eb-where-to-buy').value = b.where_to_buy || '';
  $('eb-notes').value = b.notes || '';
  $('edit-book-modal').classList.add('open');
}

async function saveEditBook() {
  const id = $('eb-book-id').value;
  const pages = parseInt($('eb-pages').value);
  const rc = parseInt($('eb-read-count').value) || 0;
  const status = $('eb-status').value;
  const prog = parseInt($('eb-progress').value) || 0;
  const prio = $('eb-priority').value;
  const cost = parseFloat($('eb-cost').value) || 0;
  const buyLink = $('eb-where-to-buy').value.trim() || '';
  const notes = $('eb-notes').value.trim() || '';
  
  if (isNaN(pages) || pages <= 0) { showToast('Please enter a valid page length.', 'error'); return; }
  
  try {
    const updates = {
      total_pages: pages,
      read_count: rc,
      status: status,
      pages_read: status === 'Finished' ? (pages * (rc || 1)) : status === 'In Progress' ? prog : 0,
      priority: prio,
      est_cost: cost,
      where_to_buy: buyLink,
      notes: notes
    };
    
    await updateDoc(doc(db, `users/${uid}/books/${id}`), updates);

    // Sync with corresponding legacy wishlist items by title if they exist
    const bookTitle = $('eb-title').value;
    const wlSnap = await getDocs(query(collection(db, `users/${uid}/wishlist`), where('title', '==', bookTitle)));
    if (!wlSnap.empty) {
      for (const d of wlSnap.docs) {
        await updateDoc(doc(db, `users/${uid}/wishlist/${d.id}`), {
          priority: prio,
          status: status,
          est_pages: pages,
          est_cost: cost,
          where_to_buy: buyLink,
          notes: notes
        });
      }
    } else if (['Want to Buy', 'Owned', 'Gifted', 'Borrowed'].includes(status)) {
      // Create legacy wishlist entry if it is moved to a wishlist status
      await addDoc(collection(db, `users/${uid}/wishlist`), {
        title: bookTitle,
        author: '',
        category: 'Other',
        priority: prio,
        status: status,
        est_pages: pages,
        est_cost: cost,
        where_to_buy: buyLink,
        notes: notes,
        date_added: todayISO()
      });
    }
    
    $('edit-book-modal').classList.remove('open');
    showToast('✓ Book details successfully updated!', 'success');
    wishlistCache = [];
    await loadBooksCache();
    await renderBookshelf();
    populateBookDropdown();
  } catch (e) {
    showToast('Failed to update book: ' + e.message, 'error');
  }
}

// ── Log Detail — iOS Bottom Sheet ────────────────────────────────────────────
function openLogDetailModal(l) {
  // Populate sheet fields
  $('detail-log-title').textContent = l.book_title;
  $('detail-log-date').textContent = fmtDate(l.date);
  $('detail-log-cycle').textContent = `Cycle ${l.read_cycle || 1}`;
  const pages = (l.end_page || 0) - (l.start_page || 0);
  $('detail-log-pages').textContent = `pp. ${l.start_page} → ${l.end_page} (${pages} pgs)`;
  $('detail-log-minutes').textContent = l.minutes_spent ? `${l.minutes_spent} min` : '—';
  $('detail-log-notes').textContent = l.notes || 'No notes recorded.';
  // Open sheet
  $('log-detail-sheet').classList.add('open');
  $('sheet-backdrop').classList.add('open');
}

function closeLogDetailSheet() {
  $('log-detail-sheet').classList.remove('open');
  $('sheet-backdrop').classList.remove('open');
}

function setupLogDetailSheet() {
  $('log-detail-close').addEventListener('click', closeLogDetailSheet);
  $('sheet-backdrop').addEventListener('click', closeLogDetailSheet);
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

  books.forEach(book => {
    const groupVal = book.group || book.group_name || book.reading_group || book.category || 'Other';
    const normalized = normalizeGroup(groupVal);
    
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

  const circumference = 2 * Math.PI * 35; // r=35 -> ~219.91
  let cumulativePercent = 0;

  const chartFlex = el('div', 'flex flex-col items-center justify-center gap-6 py-3 w-full');
  const svgWrapper = el('div', 'relative w-32 h-32 shrink-0');
  
  const isDark = document.body.classList.contains('light-mode');
  const trackColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';

  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'w-full h-full', style: 'display:block' });
  svg.appendChild(svgEl('circle', { cx: '50', cy: '50', r: '35', fill: 'none', stroke: trackColor, 'stroke-width': '10' }));

  const centerOverlay = el('div', 'absolute inset-0 flex flex-col items-center justify-center pointer-events-none p-2');
  const overlayTotal = el('span', 'text-2xl font-black text-slate-100');
  overlayTotal.textContent = fmtNum(total);
  const overlayLabel = el('span', 'text-[8px] font-bold tracking-wider text-slate-400 uppercase text-center mt-0.5 max-w-[84px] leading-tight');
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
      cx: '50', cy: '50', r: '35',
      fill: 'none',
      stroke: colors[cat],
      'stroke-width': '10',
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
    if (bookLogs.length === 0) continue;
    
    const maxLogCycle = Math.max(...bookLogs.map(l => parseInt(l.read_cycle || 1, 10)));
    const rc = b.read_count || 0;
    let completedCycles = 0;
    const tot = parseInt(b.total_pages || 0, 10);
    if (tot <= 0) continue;
    
    // Calculate completed cycles
    for (let c = 1; c <= maxLogCycle + 1; c++) {
      const cycleLogs = bookLogs.filter(l => parseInt(l.read_cycle || 1, 10) === c);
      if (cycleLogs.length === 0) continue;
      const maxEnd = Math.max(...cycleLogs.map(l => parseInt(l.end_page || 0, 10)));
      if (maxEnd >= tot) {
        completedCycles = Math.max(completedCycles, c);
      }
    }
    
    const activeCycle = completedCycles + 1;
    const activeLogs = bookLogs.filter(l => parseInt(l.read_cycle || 1, 10) === activeCycle);
    const maxActiveEnd = activeLogs.length > 0 ? Math.max(...activeLogs.map(l => parseInt(l.end_page || 0, 10))) : 0;
    
    let correctStatus = 'Not Started';
    let currentPagesRead = 0;
    let correctReadCount = completedCycles;
    
    if (maxActiveEnd > 0) {
      correctStatus = 'In Progress';
      currentPagesRead = completedCycles * tot + maxActiveEnd;
    } else {
      if (completedCycles > 0) {
        correctStatus = 'Finished';
        currentPagesRead = completedCycles * tot;
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

  console.log(`[Heatmap Debug] input logs: ${logs.length}, map size: ${Object.keys(activityMap).length}`);
  
  const today = new Date();
  let activeCellsCount = 0;
  
  for (let i = 363; i >= 0; i--) {
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
      Haptics.click();
      
      const dayLogs = logs.filter(l => l.date === dateStr);
      const booksDone = dayLogs.filter(l => {
        const book = booksCache.find(b => b.title === l.book_title);
        return book && parseInt(l.end_page || 0, 10) >= parseInt(book.total_pages || 0, 10);
      });
      const minsTotal = dayLogs.reduce((s, l) => s + (l.minutes_spent || 0), 0);

      const tooltip = $('heatmap-tooltip');
      if (!tooltip) return;

      let html = `<div class="text-[10px] text-white font-extrabold mb-1">${dateFormatted}</div>`;
      html += `<div>📖 <b>${pagesRead}</b> pages read</div>`;
      if (booksDone.length > 0) {
        html += `<div class="text-amber-400 mt-0.5">🏆 <b>${booksDone.length}</b> book finished</div>`;
      }
      if (minsTotal > 0) {
        html += `<div class="text-blue-400 mt-0.5">⏱ <b>${minsTotal}</b> min logged</div>`;
      }

      tooltip.innerHTML = html;
      tooltip.classList.remove('hidden');

      const blockRect = block.getBoundingClientRect();
      const parentRect = container.parentElement.getBoundingClientRect();
      
      const left = blockRect.left - parentRect.left + (blockRect.width / 2) - 50;
      const top = blockRect.top - parentRect.top - 62;
      
      tooltip.style.left = `${Math.max(5, left)}px`;
      tooltip.style.top = `${top}px`;
    });
    
    container.appendChild(block);
  }
  console.log(`[Heatmap Debug] Rendered ${activeCellsCount} active cells out of 364`);
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
function normalizeGroup(groupName) {
  if (!groupName) return 'Other';
  
  const clean = groupName.toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (
    clean.includes('writing') || 
    clean.includes('bahaullah') || 
    clean.includes('thebab') || 
    clean.includes('abdulbaha') || 
    clean.includes('shoghieffendi') ||
    clean.includes('aqdas') ||
    clean.includes('iqan')
  ) {
    return 'Writings';
  }
  
  if (clean.includes('aboutthefaith') || clean.includes('about')) {
    return 'About the Faith';
  }
  
  if (clean.includes('compilation')) {
    return 'Compilations';
  }
  
  if (clean.includes('fiction') && !clean.includes('non')) {
    return 'Fiction';
  }
  
  if (clean.includes('nonfiction')) {
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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              window.location.reload();
            }
          });
        }
      });
    });
  });
}

// =========================================================================
// SECTION 10: OCR PAGE SCANNER INTEGRATION
// =========================================================================
const SCANNER_CONFIG = {
  dbName: "OfflineScanDB",
  storeName: "scans",
  dbVersion: 1,
  apiUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key="
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
  if (!notesField) return;

  const activeBook = document.getElementById('log-book') ? document.getElementById('log-book').value : 'Active Book';

  if (!navigator.onLine) {
    Haptics.nudge();
    try {
      const base64Data = await fileToBase64(file);
      await saveScanOffline(base64Data, file.type || "image/jpeg", activeBook);
      notesField.placeholder = "Offline: Page captured! Syncing automatically when back online.";
      showToastNotification("Captured offline! Quote was saved and queued for background transcription.");
    } catch (err) {
      console.error("Failed to queue scan offline: ", err);
    } finally {
      event.target.value = '';
    }
    return;
  }

  // Show loading spinner
  const spinner = document.getElementById('ocr-loading-spinner');
  if (spinner) spinner.classList.remove('hidden');
  
  notesField.disabled = true;
  const originalPlaceholder = notesField.placeholder;
  notesField.placeholder = "Scanning page layout, transcribing passages, and detecting corner page numbers... Please wait.";
  notesField.style.opacity = "0.7";
  Haptics.nudge();

  try {
    const base64Data = await fileToBase64(file);
    const result = await requestTranscriptionFromGemini(base64Data, file.type || "image/jpeg");
    openVerificationModal(result.text, result.pageNumber);
  } catch (error) {
    console.error("Transcribing service failed: ", error.message);
    notesField.placeholder = "Failed to transcribe. Tap camera icon to retry.";
    showToast("Failed to transcribe page photograph. Please try again.", "error");
    Haptics.nudge();
  } finally {
    notesField.disabled = false;
    notesField.placeholder = originalPlaceholder;
    notesField.style.opacity = "1";
    if (spinner) spinner.classList.add('hidden');
    event.target.value = '';
  }
}

async function requestTranscriptionFromGemini(base64Data, mimeType) {
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

  const response = await fetch(SCANNER_CONFIG.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Cloud parser rejected request with status: ${response.status}`);
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
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  Haptics.success();
}

function closeVerificationModal() {
  const modal = document.getElementById('ocr-verify-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
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

function bindScannerEvents() {
  const trigger = document.getElementById('scan-page-trigger');
  if (trigger) trigger.onclick = triggerPageScan;
  const fileInput = document.getElementById('scan-page-file');
  if (fileInput) fileInput.onchange = handlePageScan;
}

// Run scanner setup
(function initScannerOnRuntime() {
  bindScannerEvents();
  initIndexedDB();
  window.addEventListener('online', processOfflineSyncQueue);
  setTimeout(renderPendingShelfNotifiers, 1200);
})();
