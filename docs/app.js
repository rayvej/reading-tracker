// ─── Reading Tracker — app.js ────────────────────────────────────────────────
// Firebase v10 modular SDK via CDN
import { initializeApp }                           from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup,
         signInWithRedirect, getRedirectResult,
         signOut, onAuthStateChanged }             from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache,
         collection, doc, addDoc, setDoc, getDoc,
         getDocs, updateDoc, deleteDoc,
         query, where, orderBy, limit,
         onSnapshot, writeBatch,
         serverTimestamp }                         from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { firebaseConfig }                          from './firebase-config.js';

// ── Firebase Init ─────────────────────────────────────────────────────────────
const fbApp  = initializeApp(firebaseConfig);
const auth   = getAuth(fbApp);
const db     = initializeFirestore(fbApp, { localCache: persistentLocalCache() });
const gp     = new GoogleAuthProvider();

// ── State ─────────────────────────────────────────────────────────────────────
let uid        = null;
let booksCache = [];          // all book docs { id, ...data }
let goalsCache = {};
let currentView       = 'log';
let dashFilter        = 'all';
let wishlistFilter    = 'all';
let historySearchTerm = '';
let wishlistSearchTerm= '';
let pinBuffer = '';
const PIN_LENGTH = 4;
const SESSION_KEY = 'rt_session';
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

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
  t.textContent = msg;
  t.className = `toast toast-${type}`;
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
    d.classList.toggle('filled', i < pinBuffer.length);
    d.classList.remove('error');
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
    dots.forEach(d => { d.classList.remove('filled'); d.classList.add('error'); });
    const err = $('pin-error'); err.classList.remove('hidden');
    setTimeout(() => {
      renderPinDots();
      err.classList.add('hidden');
    }, 1200);
  }
}

// ── Seed Import ───────────────────────────────────────────────────────────────
async function initApp() {
  showScreen('app');
  // Check if books already exist
  const booksSnap = await getDocs(query(collection(db, `users/${uid}/books`), limit(1)));
  if (booksSnap.empty) {
    await runSeedImport();
  }
  await loadBooksCache();
  populateBookDropdown();
  setupNav();
  setupLogForm();
  setupDashboard();
  setupGoals();
  setupWishlist();
  setupHistory();
  showView('log');
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

// ── Navigation ────────────────────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });
}

function showView(name) {
  currentView = name;
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  // Refresh on tab open
  if (name === 'dashboard') renderDashboard();
  if (name === 'goals')     renderGoals();
  if (name === 'wishlist')  renderWishlist();
  if (name === 'history')   renderHistory();
  // Show/hide FAB
  $('wishlist-fab').classList.toggle('hidden', name !== 'wishlist');
}

// ── Log Form ──────────────────────────────────────────────────────────────────
function setupLogForm() {
  $('log-date').value = todayISO();

  $('log-book').addEventListener('change', async () => {
    const title = $('log-book').value;
    if (!title) { $('log-start').value = ''; $('log-start-hint').textContent = ''; return; }
    const lastPage = await getLastPage(title);
    if (lastPage !== null) {
      $('log-start').value = lastPage;
      $('log-start-hint').textContent = `↑ Auto-filled from last session`;
      $('log-start-hint').className = 'input-hint found';
    } else {
      $('log-start').value = '0';
      $('log-start-hint').textContent = 'Starting fresh';
      $('log-start-hint').className = 'input-hint';
    }
  });

  $('log-submit').addEventListener('click', submitLog);
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

async function getLastPage(title) {
  const q = query(
    collection(db, `users/${uid}/reading_logs`),
    where('book_title', '==', title),
    orderBy('date', 'desc'),
    orderBy('end_page', 'desc'),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].data().end_page;
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
    
    // Invalidate history cache so new entry shows up
    historyCache = [];

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
function setupDashboard() {
  $('dash-seg').addEventListener('click', e => {
    const btn = e.target.closest('[data-col]');
    if (!btn) return;
    dashFilter = btn.dataset.col;
    $('dash-seg').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.col === dashFilter));
    renderDashboard();
  });
}

function renderDashboard() {
  const books = dashFilter === 'all' ? booksCache : booksCache.filter(b => b.collection === dashFilter);

  // Stats
  const totalPages  = books.reduce((s, b) => s + (b.total_pages || 0), 0);
  const pagesRead   = books.reduce((s, b) => s + (b.pages_read  || 0), 0);
  const totalReads  = books.reduce((s, b) => s + (b.read_count  || 0), 0);
  const finished    = books.filter(b => b.status === 'Finished').length;
  const pct         = totalPages > 0 ? Math.round((pagesRead / totalPages) * 100) : 0;

  $('stat-reads').textContent  = fmtNum(totalReads);
  $('stat-titles').textContent = fmtNum(books.length);
  $('stat-pages').textContent  = fmtNum(pagesRead);
  $('stat-pct').textContent    = pct + '%';

  // Currently reading
  const active = books.filter(b => b.status === 'In Progress');
  const activeEl = $('dash-active-books');
  activeEl.innerHTML = '';
  if (active.length === 0) {
    activeEl.innerHTML = '<p style="color:var(--text-3);font-size:14px;text-align:center;padding:16px 0">No books currently in progress</p>';
  } else {
    active.forEach(b => activeEl.appendChild(bookCard(b, true)));
  }

  // All books (sorted: in-progress → finished → not started)
  const allEl = $('dash-all-books');
  allEl.innerHTML = '';
  const sorted = [...books].sort((a, b) => {
    const o = { 'In Progress': 0, 'Finished': 1, 'Not Started': 2 };
    return (o[a.status] || 0) - (o[b.status] || 0) || a.title.localeCompare(b.title);
  });
  sorted.forEach(b => allEl.appendChild(bookCard(b, false)));
}

function bookCard(b, large) {
  const tot = b.total_pages || 1;
  const pr  = b.pages_read  || 0;
  const pct = Math.min(100, Math.round((pr / tot) * 100));

  const card = el('div', 'book-card');
  const header = el('div', 'book-card-header');
  const info   = el('div', 'book-info');
  const title  = el('div', 'book-title', b.title);
  const meta   = el('div', 'book-meta', `${b.author || ''}${b.group_name ? ' • ' + b.group_name : ''}`);
  info.append(title, meta);

  const badgeClass = { 'Finished': 'badge-finished', 'In Progress': 'badge-progress', 'Not Started': 'badge-not-started' };
  const badge = el('span', `status-badge ${badgeClass[b.status] || 'badge-not-started'}`, b.status);

  header.append(info, badge);

  const prog = el('div', 'progress-wrap');
  const bar  = el('div', 'progress-bar');
  const fill = el('div', `progress-fill${b.status === 'Finished' ? ' gold' : ''}`);
  fill.style.width = pct + '%';
  bar.appendChild(fill);
  const labels = el('div', 'progress-labels');
  labels.innerHTML = `<span>${fmtNum(pr)} / ${fmtNum(tot)} pages</span><span>${pct}%</span>`;
  prog.append(bar, labels);

  card.append(header, prog);
  return card;
}

// ── Goals ─────────────────────────────────────────────────────────────────────
function setupGoals() {
  $('btn-edit-goals').addEventListener('click', openGoalsModal);
  $('goals-modal-close').addEventListener('click', closeGoalsModal);
  $('goals-modal').addEventListener('click', e => { if (e.target === $('goals-modal')) closeGoalsModal(); });
  $('goals-modal-save').addEventListener('click', saveGoals);
}

async function renderGoals() {
  // Load goals
  const gSnap = await getDoc(doc(db, `users/${uid}/goals/config`));
  goalsCache  = gSnap.exists() ? gSnap.data() : { annual_books_target:12, annual_pages_target:3000, monthly_books_target:1, monthly_pages_target:300 };

  const today = new Date();
  const year  = today.getFullYear();

  // Compute year-to-date stats from logs
  const yearLogsSnap = await getDocs(query(
    collection(db, `users/${uid}/reading_logs`),
    where('date', '>=', `${year}-01-01`),
    where('date', '<=', `${year}-12-31`)
  ));

  const yearLogs = yearLogsSnap.docs.map(d => d.data());
  const yearPages = yearLogs.reduce((s, l) => s + Math.max(0, (l.end_page||0) - (l.start_page||0)), 0);

  // Books finished this year = books with a log entry in this year where end_page >= total_pages
  const finishedThisYear = new Set();
  for (const l of yearLogs) {
    const book = booksCache.find(b => b.title === l.book_title);
    if (book && l.end_page >= book.total_pages) finishedThisYear.add(l.book_title);
  }
  const yearBooks = finishedThisYear.size;

  // Month stats
  const mn = String(today.getMonth() + 1).padStart(2, '0');
  const monthLogs = yearLogs.filter(l => l.date >= `${year}-${mn}-01`);
  const monthPages = monthLogs.reduce((s, l) => s + Math.max(0, (l.end_page||0) - (l.start_page||0)), 0);
  const finishedThisMonth = new Set();
  for (const l of monthLogs) {
    const book = booksCache.find(b => b.title === l.book_title);
    if (book && l.end_page >= book.total_pages) finishedThisMonth.add(l.book_title);
  }
  const monthBooks = finishedThisMonth.size;

  const aBT = goalsCache.annual_books_target  || 12;
  const aPT = goalsCache.annual_pages_target  || 3000;
  const mBT = goalsCache.monthly_books_target || 1;
  const mPT = goalsCache.monthly_pages_target || 300;

  // Rings
  const CIRC = 289;
  const bPct = Math.min(1, yearBooks / aBT);
  const pPct = Math.min(1, yearPages / aPT);
  $('ring-books-fill').style.strokeDashoffset = CIRC - CIRC * bPct;
  $('ring-pages-fill').style.strokeDashoffset = CIRC - CIRC * pPct;
  $('ring-books-val').textContent = yearBooks;
  $('ring-pages-val').textContent = yearPages >= 1000 ? Math.round(yearPages/100)/10 + 'k' : yearPages;
  $('ring-books-lbl').textContent = `/ ${aBT} books`;
  $('ring-pages-lbl').textContent = `/ ${aPT >= 1000 ? Math.round(aPT/100)/10 + 'k' : aPT} pages`;

  // Annual stat rows
  const daysLeft = Math.ceil((new Date(`${year}-12-31`) - today) / 86400000);
  const booksLeft = Math.max(0, aBT - yearBooks);
  const pagesLeft = Math.max(0, aPT - yearPages);
  $('goal-annual-stats').innerHTML = goalRows([
    ['Books Finished', `${yearBooks} of ${aBT}`],
    ['Pages Read', `${fmtNum(yearPages)} of ${fmtNum(aPT)}`],
    ['Books Remaining', booksLeft > 0 ? `${booksLeft} left` : '✓ Goal reached!'],
    ['Pages Remaining', pagesLeft > 0 ? `${fmtNum(pagesLeft)} left` : '✓ Goal reached!'],
    ['Days Left in Year', daysLeft],
  ]);

  // Monthly stat rows
  $('goal-monthly-stats').innerHTML = goalRows([
    ['Books This Month', `${monthBooks} of ${mBT}`],
    ['Pages This Month', `${fmtNum(monthPages)} of ${fmtNum(mPT)}`],
  ]);

  // Pace
  const dayOfYear = Math.floor((today - new Date(`${year}-01-01`)) / 86400000) + 1;
  const avgPagesPerDay = dayOfYear > 0 ? Math.round(yearPages / dayOfYear) : 0;
  const projPages = avgPagesPerDay * 365;
  const projBooks = dayOfYear > 0 ? Math.round(yearBooks / dayOfYear * 365) : 0;
  $('goal-pace-stats').innerHTML = goalRows([
    ['Avg Pages/Day', fmtNum(avgPagesPerDay)],
    ['Projected Pages (Year)', fmtNum(projPages)],
    ['Projected Books (Year)', projBooks],
  ]);
}

function goalRows(rows) {
  return rows.map(([label, val]) =>
    `<div class="goal-stat-row"><span class="goal-stat-label">${label}</span><span class="goal-stat-value">${val}</span></div>`
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

// ── Wishlist ──────────────────────────────────────────────────────────────────
let wishlistCache = [];

function setupWishlist() {
  // Filter chips
  $('wishlist-filters').addEventListener('click', e => {
    const chip = e.target.closest('[data-status]');
    if (!chip) return;
    wishlistFilter = chip.dataset.status;
    $('wishlist-filters').querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c.dataset.status === wishlistFilter));
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
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📚</div><div class="empty-title">No items found</div><div class="empty-body">Try a different filter or add a new book</div></div>`;
    return;
  }

  items.forEach(w => {
    const card = el('div', 'wishlist-card');
    const info = el('div', 'wishlist-info');
    const title  = el('div', 'wishlist-title', w.title);
    const author = el('div', 'wishlist-author', w.author || '');
    const tags   = el('div', 'wishlist-tags');

    const statusTag = el('span', 'tag', w.status || '');
    const catTag    = el('span', 'tag', w.category || '');
    const prioClass = w.priority === 'High' ? 'priority-high' : w.priority === 'Medium' ? 'priority-med' : '';
    const prioTag   = el('span', `tag ${prioClass}`, w.priority || '');
    tags.append(statusTag, catTag, prioTag);
    info.append(title, author, tags);

    const cost = el('div', 'wishlist-cost',
      w.est_cost > 0 ? `$${w.est_cost.toFixed(2)}` : (w.est_pages > 0 ? `${fmtNum(w.est_pages)} pp` : ''));

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

// ── History ───────────────────────────────────────────────────────────────────
let historyCache = [];

function setupHistory() {
  $('history-search').addEventListener('input', e => {
    historySearchTerm = e.target.value.toLowerCase();
    renderHistory();
  });
}

async function renderHistory() {
  if (historyCache.length === 0) {
    const q = query(
      collection(db, `users/${uid}/reading_logs`),
      orderBy('date', 'desc')
    );
    const snap = await getDocs(q);
    historyCache = snap.docs.map(d => d.data());
  }

  let items = historyCache;
  if (historySearchTerm) {
    items = items.filter(l => l.book_title.toLowerCase().includes(historySearchTerm));
  }

  const container = $('history-list');
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><div class="empty-title">No entries yet</div><div class="empty-body">Log your first reading session to get started</div></div>`;
    return;
  }

  items.forEach(l => {
    const entry = el('div', 'log-entry');
    const d = new Date(l.date + 'T00:00:00');
    const dateBlock = el('div', 'log-date-block');
    dateBlock.innerHTML = `<span class="log-date-day">${d.getDate()}</span><span class="log-date-mon">${d.toLocaleDateString('en-US',{month:'short'})}</span>`;
    const info = el('div', 'log-info');
    const pages = (l.end_page || 0) - (l.start_page || 0);
    info.innerHTML = `<div class="log-book">${l.book_title}</div><div class="log-pages">pp. ${l.start_page} → ${l.end_page} · ${pages} page${pages===1?'':'s'}${l.read_cycle > 1 ? ` · Cycle ${l.read_cycle}` : ''}</div>`;
    const mins = el('div', 'log-minutes', l.minutes_spent ? `${l.minutes_spent} min` : '');
    entry.append(dateBlock, info, mins);
    container.appendChild(entry);
  });
}

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('SW registered'))
      .catch(e => console.warn('SW failed:', e));
  });
}
