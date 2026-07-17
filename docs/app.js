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
let librarySearchTerm = '';
let libraryStatusFilter = 'all';
let wishlistSearchTerm= '';
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
  const alert = t.querySelector('.alert');
  alert.textContent = msg;
  alert.className = `alert shadow-xl border border-white/10 bg-slate-900/95 backdrop-blur-md rounded-2xl py-3 px-5 text-sm font-semibold flex items-center gap-2 ${
    type === 'success' ? 'border-emerald-500/20 text-emerald-400' : type === 'error' ? 'border-rose-500/20 text-rose-400' : 'text-slate-200'
  }`;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
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
  
  // 1. Initialize UI handlers immediately (synchronously) so the app remains fully responsive
  setupNav();
  setupLogForm();
  setupDashboard();
  setupLibrary();
  setupGoals();
  setupWishlist();
  showView('dashboard'); // Start on Dashboard
  
  // 2. Load database content asynchronously in the background
  loadDatabaseData();
}

async function loadDatabaseData() {
  try {
    // Check if books already exist
    const booksSnap = await getDocs(query(collection(db, `users/${uid}/books`), limit(1)));
    if (booksSnap.empty) {
      await runSeedImport();
    }
    await loadBooksCache();
    await loadLogsCache();
    populateBookDropdown();
    
    // Refresh active views if the user is already looking at them
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'goals')     renderGoals();
    if (currentView === 'wishlist')  renderWishlist();
    if (currentView === 'library')   renderLibrary();
  } catch (e) {
    console.error("Failed to load library database:", e);
    showToast("Database connection offline. Showing local data.", "error");
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

// ── Navigation ────────────────────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.btm-nav button').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });
}

function showView(name) {
  currentView = name;
  document.querySelectorAll('.btm-nav button').forEach(b => {
    const isCur = b.dataset.view === name;
    b.classList.toggle('active', isCur);
    b.classList.toggle('text-gold', isCur);
    b.classList.toggle('text-slate-400', !isCur);
  });
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('hidden', v.id !== `view-${name}`);
  });
  // Refresh on tab open
  if (name === 'dashboard') renderDashboard();
  if (name === 'goals')     renderGoals();
  if (name === 'wishlist')  renderWishlist();
  if (name === 'library')   renderLibrary();
  if (name === 'log')       renderLogView();
  // Show/hide FAB
  $('wishlist-fab').classList.toggle('hidden', name !== 'wishlist');
}

// ── Log Form ──────────────────────────────────────────────────────────────────
function setupLogForm() {
  $('log-date').value = todayISO();

  $('log-book').addEventListener('change', async () => {
    const title = $('log-book').value;
    if (!title) {
      $('log-start').value = '';
      $('log-cycle').value = '1';
      $('log-start-hint').textContent = '';
      return;
    }
    
    // Show loading state
    $('log-start').value = '';
    $('log-start-hint').textContent = 'Fetching reading status...';
    $('log-start-hint').className = 'input-hint';

    try {
      const { cycle, startPage } = await determineActiveCycleAndPage(title);
      $('log-start').value = startPage;
      $('log-cycle').value = cycle;
      
      if (startPage > 0) {
        $('log-start-hint').textContent = `↑ Auto-filled from last session (Cycle ${cycle})`;
        $('log-start-hint').className = 'input-hint found';
      } else {
        $('log-start-hint').textContent = cycle > 1 ? `Starting Cycle ${cycle} fresh` : 'Starting fresh';
        $('log-start-hint').className = 'input-hint';
      }
    } catch (e) {
      console.error(e);
      $('log-start').value = '0';
      $('log-cycle').value = '1';
      $('log-start-hint').textContent = 'Offline fallback loaded';
    }
  });

  $('log-submit').addEventListener('click', submitLog);
  setupStopwatch();
}

function populateBookDropdown() {
  const sel = $('log-book');
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
  if (cur) sel.value = cur;
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

  const completedCycles = Object.values(cycleMaxes).filter(m => m >= tot).length;
  const maxCurrentCycle = cycleMaxes[cycle] ?? 0;
  const isCurrentComplete = maxCurrentCycle >= tot;

  let newStatus, newPagesRead;
  if (isCurrentComplete) {
    newStatus    = 'Finished';
    newPagesRead = tot * completedCycles;
  } else if (Object.values(cycleMaxes).some(m => m > 0)) {
    newStatus    = 'In Progress';
    const prevCompleted = Object.entries(cycleMaxes)
      .filter(([c, m]) => parseInt(c) !== cycle && m >= tot).length;
    newPagesRead = tot * prevCompleted + maxCurrentCycle;
  } else {
    newStatus    = 'Not Started';
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
  $('dash-seg').addEventListener('click', e => {
    const btn = e.target.closest('[data-col]');
    if (!btn) return;
    dashFilter = btn.dataset.col;
    $('dash-seg').querySelectorAll('button').forEach(b => {
      const isCur = b.dataset.col === dashFilter;
      b.classList.toggle('active', isCur);
      b.classList.toggle('bg-white/10', isCur);
      b.classList.toggle('text-white', isCur);
      b.classList.toggle('font-bold', isCur);
    });
    renderDashboard();
  });

  $('dash-year-select').addEventListener('change', e => {
    dashYearFilter = e.target.value;
    renderDashboard();
  });

  const chartTypeSel = $('chart-type');
  if (chartTypeSel) {
    chartTypeSel.addEventListener('change', () => {
      renderCharts();
    });
  }
}

async function renderDashboard() {
  await loadLogsCache();
  populateYearDropdown(logsCache);
  
  const selectedYear = $('dash-year-select').value;
  
  // Filter active logs (actual logs from user, excluding synthesized historical completions)
  const activeLogs = logsCache.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));
  
  // Filter logs by selected year
  let filteredLogs = logsCache;
  let filteredActiveLogs = activeLogs;
  if (selectedYear !== 'all') {
    filteredLogs = logsCache.filter(l => l.date.startsWith(selectedYear));
    filteredActiveLogs = activeLogs.filter(l => l.date.startsWith(selectedYear));
  }
  
  // Filter books by category tab
  const books = dashFilter === 'all' ? booksCache : booksCache.filter(b => b.collection === dashFilter);
  
  // Build a precise list of completions (both historical and logged)
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
          pages: tot,
          collection: book.collection
        });
      }
    }
  });

  // Filter completions by book category tab
  const filteredCompletions = completions.filter(c => dashFilter === 'all' || c.collection === dashFilter);

  // ── 1. Overall Summary ─────────────────────────────────────────
  let totalReads = 0;
  let pagesRead = 0;
  let titlesCount = 0;
  let finishedCount = 0;
  let progressCount = 0;

  if (selectedYear === 'all') {
    // Total Reads: Sum of b.read_count across filtered books
    totalReads = books.reduce((s, b) => s + (b.read_count || 0), 0);
    
    // Total Titles: unique books
    titlesCount = books.length;
    finishedCount = books.filter(b => b.status === 'Finished').length;
    progressCount = books.filter(b => b.status === 'In Progress').length;
    
    // Pages Read G5 Formula: completed pages + active pages + re-reads in progress
    let pagesReadG5 = 0;
    books.forEach(b => {
      pagesReadG5 += (b.read_count || 0) * b.total_pages;
      if (b.status === 'In Progress') {
        pagesReadG5 += (b.pages_read || 0);
      }
    });
    
    let rereadsInProgress = 0;
    activeLogs.forEach(l => {
      const book = books.find(b => b.title === l.book_title);
      if (book) {
        const rc = book.read_count || 0;
        if (l.read_cycle > rc && l.read_cycle > 1) {
          rereadsInProgress += Math.max(0, l.end_page - l.start_page);
        }
      }
    });
    pagesRead = pagesReadG5 + rereadsInProgress;
  } else {
    // Specific Year stats based on completions in that year
    const completionsInYear = filteredCompletions.filter(c => c.date.startsWith(selectedYear));
    totalReads = completionsInYear.length;
    pagesRead = completionsInYear.reduce((s, c) => s + c.pages, 0);

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

  // Avg pages/book
  const finishedBooks = books.filter(b => b.status === 'Finished');
  const finishedPagesSum = finishedBooks.reduce((s, b) => s + (b.total_pages || 0), 0);
  const avgPagesPerBook = finishedBooks.length > 0 ? Math.round(finishedPagesSum / finishedBooks.length) : 0;
  
  $('stat-reads').textContent = totalReads;
  $('detail-reads').textContent = `Avg pages/book: ${avgPagesPerBook}`;
  $('stat-titles').textContent = titlesCount;
  $('detail-titles').textContent = `Finished: ${finishedCount} · Active: ${progressCount}`;
  $('stat-pages').textContent = fmtNum(pagesRead);
  $('detail-pages').textContent = `Logged in ${selectedYear === 'all' ? 'total' : selectedYear}`;
  
  // Progress %
  const totalPagesInLib = books.reduce((s, b) => s + (b.total_pages || 0), 0);
  const overallPct = totalPagesInLib > 0 ? Math.round((pagesRead / totalPagesInLib) * 100) : 0;
  const pagesRemaining = Math.max(0, totalPagesInLib - pagesRead);
  
  $('stat-pct').textContent = overallPct + '%';
  $('detail-pct').textContent = `Pages left: ${fmtNum(pagesRemaining)}`;
  
  // ── 2. Streaks & Activity ──────────────────────────────────────
  const streaks = calculateStreaks(activeLogs);
  $('stat-streak-cur').textContent = `${streaks.current} days`;
  $('stat-streak-max').textContent = `${streaks.longest} days`;
  
  const allUniqueDays = [...new Set(activeLogs.map(l => l.date))].length;
  $('stat-days-total').textContent = `${allUniqueDays} days`;
  
  const logPagesSum = activeLogs.reduce((s, l) => s + Math.max(0, l.end_page - l.start_page), 0);
  const avgPagesPerActiveDay = allUniqueDays > 0 ? (logPagesSum / allUniqueDays).toFixed(1) : 0;
  $('stat-pages-active-avg').textContent = avgPagesPerActiveDay;
  
  // % Days Read (Month)
  const today = new Date();
  const yearNum = today.getFullYear();
  const monthNum = today.getMonth() + 1;
  const monthDaysCount = new Date(yearNum, monthNum, 0).getDate();
  const currentMonthLogs = activeLogs.filter(l => l.date.startsWith(`${yearNum}-${String(monthNum).padStart(2, '0')}`));
  const monthUniqueDays = [...new Set(currentMonthLogs.map(l => l.date))].length;
  const monthPct = monthDaysCount > 0 ? Math.round((monthUniqueDays / monthDaysCount) * 100) : 0;
  $('stat-days-month-pct').textContent = `${monthPct}%`;
  
  // % Days Read (YTD)
  const startOfYear = new Date(`${yearNum}-01-01T00:00:00`);
  const diffTimeYtd = Math.abs(today - startOfYear);
  const ytdDaysElapsed = Math.floor(diffTimeYtd / (86400000)) + 1;
  const currentYearLogs = activeLogs.filter(l => l.date.startsWith(String(yearNum)));
  const ytdUniqueDays = [...new Set(currentYearLogs.map(l => l.date))].length;
  const ytdPct = ytdDaysElapsed > 0 ? Math.round((ytdUniqueDays / ytdDaysElapsed) * 100) : 0;
  $('stat-days-ytd-pct').textContent = `${ytdPct}%`;
  
  // ── 3. Year-Over-Year YTD Comparison ───────────────────────────
  const lastYear = yearNum - 1;
  const todayMonthDay = todayISO().slice(5); // e.g. "07-17"
  
  const countCompletedYTD = (y) => {
    return completions.filter(c => c.date.startsWith(String(y)) && c.date.slice(5) <= todayMonthDay).length;
  };
  const sumPagesCompletedYTD = (y) => {
    return completions.filter(c => c.date.startsWith(String(y)) && c.date.slice(5) <= todayMonthDay).reduce((s, c) => s + c.pages, 0);
  };
  
  const thisYearYTDBooks = countCompletedYTD(yearNum);
  const lastYearYTDBooks = countCompletedYTD(lastYear);
  const thisYearYTDPages = sumPagesCompletedYTD(yearNum);
  const lastYearYTDPages = sumPagesCompletedYTD(lastYear);
  
  $('yoy-books').textContent = `${thisYearYTDBooks} vs ${lastYearYTDBooks}`;
  $('yoy-pages').textContent = `${fmtNum(thisYearYTDPages)} vs ${fmtNum(lastYearYTDPages)}`;
  
  $('dash-yoy-card').classList.toggle('hidden', selectedYear !== 'all' && selectedYear !== String(yearNum));
  
  // ── 4. Weekly Velocity ─────────────────────────────────────────
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
  
  // ── 5. Next Milestones ─────────────────────────────────────────
  const booksYTD = thisYearYTDBooks;
  const pagesYTD = thisYearYTDPages;
  const booksToMilestone = Math.max(0, 75 - booksYTD);
  const pagesToMilestone = Math.max(0, 20000 - pagesYTD);
  
  const booksPerDay = ytdDaysElapsed > 0 ? booksYTD / ytdDaysElapsed : 0;
  const pagesPerDay = ytdDaysElapsed > 0 ? pagesYTD / ytdDaysElapsed : 0;
  
  const calculateETA = (needed, rate) => {
    if (rate <= 0) return 'Never';
    const daysNeeded = needed / rate;
    const etaDate = new Date();
    etaDate.setDate(etaDate.getDate() + daysNeeded);
    return etaDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };
  const booksETA = calculateETA(booksToMilestone, booksPerDay);
  const pagesETA = calculateETA(pagesToMilestone, pagesPerDay);
  
  $('dash-milestones').innerHTML = `
    <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400">⏰ Targets & Milestones</div>
    
    <!-- Books Milestone -->
    <div class="flex flex-col gap-1">
      <div class="flex justify-between text-xs font-semibold text-slate-200">
        <span>📚 Next Books Milestone</span>
        <span>${booksYTD} / 75 Books</span>
      </div>
      <div class="w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden border border-white/5 mt-0.5">
        <div class="bg-gradient-to-r from-gold to-yellow-500 h-full transition-all" style="width: ${Math.min(100, (booksYTD/75)*100)}%"></div>
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
        <span>${fmtNum(pagesYTD)} / 20k Pages</span>
      </div>
      <div class="w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden border border-white/5 mt-0.5">
        <div class="bg-gradient-to-r from-blue-400 to-emerald-400 h-full transition-all" style="width: ${Math.min(100, (pagesYTD/20000)*100)}%"></div>
      </div>
      <div class="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>To go: <b>${fmtNum(pagesToMilestone)} pages</b></span>
        <span>ETA: <b>${pagesETA}</b></span>
      </div>
    </div>
  `;
  
  // ── 6. Year Progress ───────────────────────────────────────────
  const daysRemainingInYear = 365 - ytdDaysElapsed;
  const pagesPerCalendarDay = (pagesYTD / ytdDaysElapsed).toFixed(1);
  const booksPerMonthYTD = (booksYTD / (ytdDaysElapsed / 30)).toFixed(2);
  
  $('dash-year-progress').innerHTML = `
    <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400">📅 Current Year Progress (${yearNum})</div>
    <div class="grid grid-cols-2 gap-y-2 gap-x-4 mt-2 text-xs border-t border-white/5 pt-2">
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
  
  // ── 7. Currently Reading List ──────────────────────────────────
  const active = books.filter(b => b.status === 'In Progress');
  const activeEl = $('dash-active-books');
  activeEl.innerHTML = '';
  if (active.length === 0) {
    activeEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-2 font-medium">No books currently in progress</p>';
  } else {
    active.forEach(b => {
      const left = Math.max(0, b.total_pages - b.pages_read);
      const estDays = Math.ceil(left / 10);
      const pct = Math.min(100, Math.round((b.pages_read / b.total_pages) * 100));
      
      const card = el('div', 'glass-panel p-3.5 rounded-2xl flex flex-col gap-2 border border-white/5');
      card.innerHTML = `
        <div class="flex justify-between items-start gap-3">
          <div class="min-w-0">
            <div class="text-xs font-bold text-slate-100 truncate">${b.title}</div>
            <div class="text-[9px] text-slate-400 truncate mt-0.5">${b.author || ''}</div>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-blue-500/10 text-blue-400 border border-blue-500/10 uppercase">${pct}%</span>
        </div>
        <div class="flex justify-between text-[9px] text-slate-400 mt-1 border-t border-white/5 pt-1.5">
          <span>Pages Left: <b>${left}</b></span>
          <span>ETA @ 10pg/day: <b>${estDays} days</b></span>
        </div>
      `;
      activeEl.appendChild(card);
    });
  }
  
  // ── 8. Up Next List ────────────────────────────────────────────
  const notStarted = books.filter(b => b.status === 'Not Started');
  const prioOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
  const upNext = [...notStarted].sort((a,b) => (prioOrder[a.priority] ?? 2) - (prioOrder[b.priority] ?? 2)).slice(0, 5);
  
  const upNextEl = $('dash-up-next-books');
  upNextEl.innerHTML = '';
  if (upNext.length === 0) {
    upNextEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-2 font-medium">No upcoming books</p>';
  } else {
    upNext.forEach(b => {
      const prioColor = b.priority === 'High' ? 'bg-rose-500/10 text-rose-400 border-rose-500/10' : b.priority === 'Medium' ? 'bg-amber-500/10 text-amber-400 border-amber-500/10' : 'bg-slate-800/40 text-slate-400 border-white/5';
      const card = el('div', 'glass-panel p-3.5 rounded-2xl flex justify-between items-center gap-3 border border-white/5');
      card.innerHTML = `
        <div class="min-w-0">
          <div class="text-xs font-bold text-slate-100 truncate">${b.title}</div>
          <div class="text-[9px] text-slate-400 truncate mt-0.5">${b.author || ''}</div>
        </div>
        <span class="px-2 py-0.5 rounded-full text-[8px] font-black border uppercase ${prioColor}">${b.priority || 'Low'}</span>
      `;
      upNextEl.appendChild(card);
    });
  }
  
  // ── 9. Recently Finished ───────────────────────────────────────
  const pastYearTime = today.getTime() - 365 * 86400000;
  const finishedLogs = logsCache.filter(l => {
    const book = booksCache.find(b => b.title === l.book_title);
    return book && l.end_page >= book.total_pages && new Date(l.date + 'T00:00:00').getTime() >= pastYearTime;
  });
  
  // Sort descending by completion date
  finishedLogs.sort((a, b) => b.date.localeCompare(a.date));
  
  const recentEl = $('dash-recent-books');
  recentEl.innerHTML = '';
  if (finishedLogs.length === 0) {
    recentEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-2 font-medium">No books finished recently</p>';
  } else {
    const seenTitles = new Set();
    finishedLogs.forEach(l => {
      if (seenTitles.has(l.book_title)) return;
      seenTitles.add(l.book_title);
      
      const book = booksCache.find(b => b.title === l.book_title);
      const pages = book ? book.total_pages : 0;
      
      const card = el('div', 'glass-panel p-3.5 rounded-2xl flex justify-between items-center gap-3 border border-white/5');
      card.innerHTML = `
        <div class="min-w-0">
          <div class="text-xs font-bold text-slate-100 truncate">${l.book_title}</div>
          <div class="text-[9px] text-slate-400 mt-0.5">${pages} pg · Finished: ${fmtDate(l.date)}</div>
        </div>
        <span class="px-2 py-0.5 rounded-full text-[8px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/10 uppercase">Done</span>
      `;
      recentEl.appendChild(card);
    });
  }
  
  // Render Chart
  renderCharts();
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
function renderCharts() {
  const ctx = $('dash-chart');
  if (!ctx) return;
  
  if (activeChart) {
    activeChart.destroy();
  }
  
  const selectedYear = $('dash-year-select').value;
  const chartType = $('chart-type').value;
  const activeLogs = logsCache.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));
  
  const yearLogs = selectedYear === 'all' ? activeLogs : activeLogs.filter(l => l.date.startsWith(selectedYear));
  const filteredLogs = yearLogs.filter(l => {
    const book = booksCache.find(b => b.title === l.book_title);
    return !book || dashFilter === 'all' || book.collection === dashFilter;
  });
  
  if (chartType === 'pages' || chartType === 'minutes') {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlySum = new Array(12).fill(0);
    
    filteredLogs.forEach(l => {
      const monthIdx = parseInt(l.date.slice(5, 7)) - 1;
      if (monthIdx >= 0 && monthIdx < 12) {
        if (chartType === 'pages') {
          monthlySum[monthIdx] += Math.max(0, l.end_page - l.start_page);
        } else {
          monthlySum[monthIdx] += (l.minutes_spent || 0);
        }
      }
    });
    
    const label = chartType === 'pages' ? 'Pages Read' : 'Reading Minutes';
    const color = chartType === 'pages' ? '#38bdf8' : '#eab308';
    
    activeChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: months,
        datasets: [{
          label: label,
          data: monthlySum,
          borderColor: color,
          backgroundColor: color + '15',
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: color
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, ticks: { color: '#94a3b8', font: { size: 9 } } },
          y: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, ticks: { color: '#94a3b8', font: { size: 9 } } }
        }
      }
    });
  } else if (chartType === 'genres') {
    let bahaiPages = 0;
    let nonBahaiPages = 0;
    
    booksCache.forEach(b => {
      const completed = (b.read_count || 0) * b.total_pages;
      const active = b.status === 'In Progress' ? (b.pages_read || 0) : 0;
      const tot = completed + active;
      if (b.collection === 'Bahai') bahaiPages += tot;
      else nonBahaiPages += tot;
    });
    
    activeChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ["Baha'i Books", "Non-Baha'i"],
        datasets: [{
          data: [bahaiPages, nonBahaiPages],
          backgroundColor: ['#eab308', '#38bdf8'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#e2e8f0', font: { size: 9 } }
          }
        }
      }
    });
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
      // Pause timer
      clearInterval(timerInterval);
      timerRunning = false;
      toggleBtn.textContent = 'Resume';
      toggleBtn.className = 'btn btn-sm rounded-xl bg-gold/10 hover:bg-gold/25 border border-gold/20 text-gold text-xs font-bold px-4 h-9';
      display.classList.remove('timer-running');
      resetBtn.classList.remove('hidden');
      
      // Auto-populate input
      $('log-minutes').value = Math.ceil(timerSeconds / 60);
    } else {
      // Start timer
      timerRunning = true;
      toggleBtn.textContent = 'Pause';
      toggleBtn.className = 'btn btn-sm rounded-xl bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/20 text-rose-400 text-xs font-bold px-4 h-9';
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
    toggleBtn.className = 'btn btn-sm rounded-xl bg-gold/10 hover:bg-gold/25 border border-gold/20 text-gold text-xs font-bold px-4 h-9';
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

// ── Book Library Manager ──────────────────────────────────────────────────────
function setupLibrary() {
  $('lib-search').addEventListener('input', e => {
    librarySearchTerm = e.target.value.toLowerCase();
    renderLibrary();
  });
  
  $('lib-filter-status').querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      libraryStatusFilter = btn.dataset.status;
      $('lib-filter-status').querySelectorAll('button').forEach(b => {
        const isCur = b.dataset.status === libraryStatusFilter;
        b.classList.toggle('active', isCur);
        b.classList.toggle('bg-white/10', isCur);
        b.classList.toggle('text-white', isCur);
        b.classList.toggle('font-bold', isCur);
      });
      renderLibrary();
    });
  });
  
  $('btn-add-book-trigger').addEventListener('click', () => {
    $('add-book-modal').classList.add('open');
  });
  $('add-book-close').addEventListener('click', () => {
    $('add-book-modal').classList.remove('open');
  });
  $('add-book-save').addEventListener('click', saveNewBook);
  
  $('edit-book-close').addEventListener('click', () => {
    $('edit-book-modal').classList.remove('open');
  });
  $('edit-book-save').addEventListener('click', saveEditBook);
}

async function renderLibrary() {
  await loadBooksCache();
  
  const container = $('lib-books-list');
  if (!container) return;
  container.innerHTML = '';
  
  let items = booksCache;
  if (librarySearchTerm) {
    items = items.filter(b => b.title.toLowerCase().includes(librarySearchTerm) || (b.author && b.author.toLowerCase().includes(librarySearchTerm)));
  }
  if (libraryStatusFilter !== 'all') {
    items = items.filter(b => b.status === libraryStatusFilter);
  }
  
  if (items.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-500 text-center py-6 font-medium">No books match your criteria</p>';
    return;
  }
  
  items.forEach(b => {
    const card = el('div', 'glass-panel p-4.5 rounded-3xl border border-white/5 flex flex-col gap-3.5 relative');
    const isFin = b.status === 'Finished';
    const isAct = b.status === 'In Progress';
    const badgeColor = isFin ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10' : isAct ? 'bg-blue-500/10 text-blue-400 border-blue-500/10' : 'bg-slate-800/40 text-slate-400 border-white/5';
    
    let activeProgress = 0;
    if (b.status === 'In Progress') {
      activeProgress = b.pages_read || 0;
    }
    const progressPct = b.total_pages > 0 ? Math.min(100, Math.round((activeProgress / b.total_pages) * 100)) : 0;
    
    card.innerHTML = `
      <div class="flex justify-between items-start gap-4">
        <div class="min-w-0">
          <div class="text-sm font-bold text-slate-100 truncate">${b.title}</div>
          <div class="text-[10px] text-slate-400 truncate mt-0.5">${b.author || 'Unknown Author'} · ${b.total_pages} pg</div>
        </div>
        <span class="px-2 py-0.5 rounded-full text-[8px] font-black border uppercase shrink-0 ${badgeColor}">${b.status}</span>
      </div>
      
      ${isAct ? `
        <div class="flex flex-col gap-1.5">
          <div class="flex justify-between text-[9px] text-slate-400 font-bold uppercase tracking-wider">
            <span>Reading Progress</span>
            <span>${activeProgress} / ${b.total_pages} pg (${progressPct}%)</span>
          </div>
          <div class="w-full bg-slate-900/40 border border-white/5 rounded-full h-2 overflow-hidden">
            <div class="bg-gradient-to-r from-blue-400 to-emerald-400 h-full transition-all" style="width: ${progressPct}%"></div>
          </div>
        </div>
      ` : ''}
      
      <div class="flex justify-between items-center text-[10px] text-slate-400 border-t border-white/5 pt-3 font-semibold mt-1">
        <span>Reads: <b class="text-slate-200">${b.read_count || 0}</b></span>
        <div class="flex gap-2">
          ${isAct ? `<button class="btn btn-xs rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-[9px] font-extrabold h-6 min-h-6 px-2.5" data-action="complete">Mark Complete</button>` : ''}
          <button class="btn btn-xs rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 text-[9px] font-bold h-6 min-h-6 px-2.5" data-action="edit">Edit</button>
        </div>
      </div>
    `;
    
    const compBtn = card.querySelector('[data-action="complete"]');
    if (compBtn) {
      compBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (confirm(`Mark "${b.title}" completed? This adds a final cycle log session.`)) {
          await markBookComplete(b);
        }
      });
    }
    
    card.querySelector('[data-action="edit"]').addEventListener('click', e => {
      e.stopPropagation();
      openEditBookModal(b);
    });
    
    container.appendChild(card);
  });
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
    await renderLibrary();
    populateBookDropdown();
  } catch (e) {
    showToast('Failed to complete book: ' + e.message, 'error');
  }
}

async function saveNewBook() {
  const title = $('ab-title').value.trim();
  const author = $('ab-author').value.trim() || null;
  const coll = $('ab-collection').value;
  const group = $('ab-group').value.trim() || '';
  const pages = parseInt($('ab-pages').value);
  const prio = $('ab-priority').value;
  const status = $('ab-status').value;
  
  if (!title) { showToast('Please enter a book title.', 'error'); return; }
  if (isNaN(pages) || pages <= 0) { showToast('Please enter a valid page length.', 'error'); return; }
  
  try {
    const isFinished = status === 'Finished';
    const newBook = {
      title,
      author,
      collection: coll,
      group_name: group,
      total_pages: pages,
      priority: prio,
      status: status,
      pages_read: isFinished ? pages : 0,
      read_count: isFinished ? 1 : 0
    };
    
    await addDoc(collection(db, `users/${uid}/books`), newBook);
    
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
    
    $('ab-title').value = '';
    $('ab-author').value = '';
    $('ab-group').value = '';
    $('ab-pages').value = '';
    $('ab-priority').value = 'Low';
    $('ab-status').value = 'Not Started';
    
    $('add-book-modal').classList.remove('open');
    showToast(`✓ Book "${title}" successfully registered!`, 'success');
    await loadBooksCache();
    await renderLibrary();
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
  $('edit-book-modal').classList.add('open');
}

async function saveEditBook() {
  const id = $('eb-book-id').value;
  const pages = parseInt($('eb-pages').value);
  const rc = parseInt($('eb-read-count').value) || 0;
  const status = $('eb-status').value;
  const prog = parseInt($('eb-progress').value) || 0;
  
  if (isNaN(pages) || pages <= 0) { showToast('Please enter a valid page length.', 'error'); return; }
  
  try {
    const updates = {
      total_pages: pages,
      read_count: rc,
      status: status,
      pages_read: status === 'Finished' ? (pages * (rc || 1)) : status === 'In Progress' ? prog : 0
    };
    
    await updateDoc(doc(db, `users/${uid}/books/${id}`), updates);
    $('edit-book-modal').classList.remove('open');
    showToast('✓ Book details successfully updated!', 'success');
    await loadBooksCache();
    await renderLibrary();
    populateBookDropdown();
  } catch (e) {
    showToast('Failed to update book: ' + e.message, 'error');
  }
}

// ── Log Detail Modal ─────────────────────────────────────────────────────────
function openLogDetailModal(l) {
  $('detail-log-title').textContent = l.book_title;
  $('detail-log-date').textContent = fmtDate(l.date);
  $('detail-log-cycle').textContent = `Cycle ${l.read_cycle || 1}`;
  
  const pages = (l.end_page || 0) - (l.start_page || 0);
  $('detail-log-pages').textContent = `pp. ${l.start_page} → ${l.end_page} (${pages} pages)`;
  $('detail-log-minutes').textContent = l.minutes_spent ? `${l.minutes_spent} min` : '—';
  $('detail-log-notes').textContent = l.notes || 'No notes recorded for this session.';
  $('log-detail-modal').classList.add('open');
}

function goalRows(rows) {
  return rows.map(([label, val]) =>
    `<div class="flex justify-between items-center py-3 text-sm"><span class="text-slate-400 font-medium">${label}</span><span class="text-slate-200 font-semibold">${val}</span></div>`
  ).join('');
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

function setupWishlist() {
  // Filter chips
  $('wishlist-filters').addEventListener('click', e => {
    const chip = e.target.closest('[data-status]');
    if (!chip) return;
    wishlistFilter = chip.dataset.status;
    $('wishlist-filters').querySelectorAll('button').forEach(c => {
      const isCur = c.dataset.status === wishlistFilter;
      c.classList.toggle('active', isCur);
      c.classList.toggle('bg-gold/15', isCur);
      c.classList.toggle('text-gold', isCur);
      c.classList.toggle('font-bold', isCur);
    });
    renderWishlist();
  });

  // Search
  $('wishlist-search').addEventListener('input', e => {
    wishlistSearchTerm = e.target.value.toLowerCase();
    renderWishlist();
  });

  // FAB
  $('wishlist-fab').addEventListener('click', () => $('wishlist-modal').classList.add('open'));
  $('wishlist-modal-close').addEventListener('click', () => $('wishlist-modal').classList.remove('open'));
  $('wishlist-modal').addEventListener('click', e => { if (e.target === $('wishlist-modal')) $('wishlist-modal').classList.remove('open'); });
  $('wishlist-modal-save').addEventListener('click', addWishlistItem);
}

async function renderWishlist() {
  // Load if cache empty
  if (wishlistCache.length === 0) {
    const snap = await getDocs(collection(db, `users/${uid}/wishlist`));
    wishlistCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    wishlistCache.sort((a, b) => a.title.localeCompare(b.title));
  }

  let items = wishlistCache;
  if (wishlistFilter !== 'all') items = items.filter(w => w.status === wishlistFilter);
  if (wishlistSearchTerm) items = items.filter(w =>
    w.title.toLowerCase().includes(wishlistSearchTerm) ||
    (w.author || '').toLowerCase().includes(wishlistSearchTerm)
  );

  const container = $('wishlist-list');
  container.innerHTML = '';
  if (items.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center p-12 text-center text-slate-500 gap-3">
        <span class="text-4xl">📚</span>
        <div class="text-sm font-bold text-slate-400">No items found</div>
        <p class="text-xs text-slate-500">Try a different filter or add a new book</p>
      </div>`;
    return;
  }

  items.forEach(w => {
    const card = el('div', 'glass-panel p-4 rounded-2xl flex items-center justify-between gap-4 border border-white/5 hover:bg-slate-900/40 transition-all');
    const info = el('div', 'flex-1 min-w-0 flex flex-col gap-2');
    const title  = el('div', 'text-sm font-semibold text-slate-100 truncate', w.title);
    const author = el('div', 'text-xs text-slate-400 truncate -mt-1', w.author || '');
    const tags   = el('div', 'flex flex-wrap gap-1.5');

    const statusTag = el('span', 'px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-slate-800/40 text-slate-300 border border-white/5', w.status || '');
    const catTag    = el('span', 'px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-slate-800/40 text-slate-300 border border-white/5', w.category || '');
    
    const prioClasses = {
      'High': 'bg-rose-500/10 text-rose-400 border border-rose-500/10',
      'Medium': 'bg-amber-500/10 text-amber-400 border border-amber-500/10',
      'Low': 'bg-slate-800/40 text-slate-400 border border-white/5'
    };
    const prioTag   = el('span', `px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ${prioClasses[w.priority] || prioClasses['Low']}`, w.priority || '');
    tags.append(statusTag, catTag, prioTag);
    info.append(title, author, tags);

    const costVal = w.est_cost > 0 ? `$${w.est_cost.toFixed(2)}` : (w.est_pages > 0 ? `${fmtNum(w.est_pages)} pp` : '');
    const cost = el('div', 'text-xs font-bold text-slate-200 shrink-0', costVal);

    card.append(info, cost);
    container.appendChild(card);
  });
}

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



// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('SW registered'))
      .catch(e => console.warn('SW failed:', e));
  });
}
