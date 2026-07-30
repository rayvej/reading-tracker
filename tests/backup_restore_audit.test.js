import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const indexPath = `file://${path.join(rootDir, 'docs', 'index.html')}`;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

console.log('===============================================================');
console.log(' 🛡️ DATA RESILIENCE & BACKUP / RESTORE AUDIT TEST SUITE ');
console.log('===============================================================\n');

async function runBackupRestoreAudit() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--allow-file-access-from-files',
      '--disable-web-security'
    ]
  });

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', err => {
    const errStr = err.toString();
    if (!errStr.includes('Transition was skipped') && !errStr.includes('insufficient permissions')) {
      pageErrors.push(errStr);
    }
  });

  await page.setViewport({ width: 1280, height: 800 });

  const cdp = await page.target().createCDPSession();
  await cdp.send('Storage.clearDataForOrigin', { origin: '*', storageTypes: 'all' });

  await page.goto(indexPath, { waitUntil: 'networkidle0' });

  await page.evaluate(async () => {
    window.isMockAuth = true;
    window.uid = 'test_user_backup';
    const pin = document.getElementById('pin-screen');
    if (pin) pin.classList.add('hidden');
    const auth = document.getElementById('auth-screen');
    if (auth) auth.classList.add('hidden');
    const app = document.getElementById('app');
    if (app) app.classList.remove('hidden');
    if (typeof window.initApp === 'function') await window.initApp();
  });

  await new Promise(r => setTimeout(r, 600));

  // ─── TEST 1: Clean Import/Export Round-Trip ────────────────────────────────
  console.log('▶ TEST 1: Clean Import/Export Round-Trip Data Integrity...');
  const roundTripResult = await page.evaluate(async () => {
    const sampleBooks = [
      {
        id: 'bk_001', title: "The Dawn-Breakers (Nabíl's Narrative)",
        author: "Nabíl-i-A'zam", total_pages: 685, status: 'Finished',
        pages_read: 685, est_cost: 35.00, notes: "Diacritics: Ṭáhirih, Quddús, Ḥusayn",
        date_added: "2026-01-15"
      },
      {
        id: 'bk_002', title: "Gleanings from the Writings of Bahá'u'lláh",
        author: "Bahá'u'lláh", total_pages: 346, status: 'In Progress',
        pages_read: 150, est_cost: 22.50, notes: "Passage LXXI on the soul",
        date_added: "2026-02-01"
      },
      {
        id: 'bk_003', title: "Sapiens: A Brief History of Humankind",
        author: "Yuval Noah Harari", total_pages: 443, status: 'Wishlist',
        pages_read: 0, est_cost: 18.99, notes: "", date_added: "2026-03-10"
      }
    ];
    const sampleLogs = [
      { id: 'log_001', book_title: "The Dawn-Breakers (Nabíl's Narrative)",
        date: "2026-01-20", start_page: 0, end_page: 300, minutes_spent: 120,
        notes: "The Mission of the Báb" },
      { id: 'log_002', book_title: "The Dawn-Breakers (Nabíl's Narrative)",
        date: "2026-01-25", start_page: 300, end_page: 685, minutes_spent: 180,
        notes: "Martyrdom of the Báb" },
      { id: 'log_003', book_title: "Gleanings from the Writings of Bahá'u'lláh",
        date: "2026-02-05", start_page: 0, end_page: 150, minutes_spent: 65,
        notes: "Passages on the soul and immortality" }
    ];

    window.booksCache = [...sampleBooks];
    window.logsCache = [...sampleLogs];
    const originalBooksCount = window.booksCache.length;
    const originalLogsCount = window.logsCache.length;

    // Export
    const exportPayload = {
      app: "Reading Tracker", version: "2.5.0",
      exportDate: new Date().toISOString(),
      books: JSON.parse(JSON.stringify(window.booksCache)),
      logs: JSON.parse(JSON.stringify(window.logsCache))
    };
    const jsonStr = JSON.stringify(exportPayload);

    // Wipe
    window.booksCache = [];
    window.logsCache = [];
    const wipedBooksCount = window.booksCache.length;
    const wipedLogsCount = window.logsCache.length;

    // Re-import (await the returned Promise)
    const file = new File([new Blob([jsonStr])], 'backup.json', { type: 'application/json' });
    await window.importFromJSON(file);

    const restoredBooksCount = window.booksCache.length;
    const restoredLogsCount = window.logsCache.length;

    const rb1 = window.booksCache.find(b => b.id === 'bk_001');
    const rb2 = window.booksCache.find(b => b.id === 'bk_002');
    const rb3 = window.booksCache.find(b => b.id === 'bk_003');
    const rl1 = window.logsCache.find(l => l.id === 'log_001');
    const rl2 = window.logsCache.find(l => l.id === 'log_002');
    const rl3 = window.logsCache.find(l => l.id === 'log_003');

    const checks = {
      book1_title:   rb1 && rb1.title === "The Dawn-Breakers (Nabíl's Narrative)",
      book1_author:  rb1 && rb1.author === "Nabíl-i-A'zam",
      book1_pages:   rb1 && rb1.total_pages === 685,
      book1_diacritics: rb1 && rb1.notes.includes('Ṭáhirih'),
      book2_status:  rb2 && rb2.status === 'In Progress',
      book2_cost:    rb2 && rb2.est_cost === 22.50,
      book3_wishlist: rb3 && rb3.status === 'Wishlist',
      log1_minutes:  rl1 && rl1.minutes_spent === 120,
      log2_endPage:  rl2 && rl2.end_page === 685,
      log3_notes:    rl3 && rl3.notes === 'Passages on the soul and immortality'
    };
    const allChecksPass = Object.values(checks).every(Boolean);

    return {
      originalBooksCount, originalLogsCount,
      wipedBooksCount, wipedLogsCount,
      restoredBooksCount, restoredLogsCount,
      checks, allChecksPass,
      passed: originalBooksCount === 3 && wipedBooksCount === 0 &&
              restoredBooksCount === 3 && restoredLogsCount === 3 && allChecksPass
    };
  });

  console.log(`   └─ Original Data: ${roundTripResult.originalBooksCount} books, ${roundTripResult.originalLogsCount} logs`);
  console.log(`   └─ Wiped State: ${roundTripResult.wipedBooksCount} books, ${roundTripResult.wipedLogsCount} logs`);
  console.log(`   └─ Restored Data: ${roundTripResult.restoredBooksCount} books, ${roundTripResult.restoredLogsCount} logs`);
  console.log(`   └─ Deep Attribute Checks:`);
  for (const [key, val] of Object.entries(roundTripResult.checks)) {
    console.log(`       • ${key}: ${val ? '✅' : '❌'}`);
  }
  console.log(`   └─ Round-Trip Data Integrity: ${roundTripResult.passed ? '✅ PASSED' : '❌ FAILED'}`);

  // ─── TEST 2: Corrupt / Malformed Import Resilience ─────────────────────────
  console.log('\n▶ TEST 2: Corrupt & Malformed JSON Import Resilience...');

  // 2a: Invalid JSON syntax
  console.log('   ── 2a: Invalid JSON Syntax ──');
  const res2a = await page.evaluate(async () => {
    window.booksCache = [{ id: 'bk_safe', title: 'Protected Book', total_pages: 200 }];
    window.logsCache = [{ id: 'log_safe', book_title: 'Protected Book', date: '2026-07-01' }];
    const toastEl = document.querySelector('#toast div');
    if (toastEl) toastEl.textContent = '';

    const file = new File([new Blob(['{ not valid json !!!'])], 'bad.json', { type: 'application/json' });
    await window.importFromJSON(file);

    const toast = toastEl ? toastEl.textContent : '';
    return {
      toast,
      caughtError: toast.includes('Failed to import backup'),
      booksIntact: window.booksCache.length === 1 && window.booksCache[0].id === 'bk_safe',
      logsIntact: window.logsCache.length === 1 && window.logsCache[0].id === 'log_safe',
      passed: toast.includes('Failed to import backup') &&
              window.booksCache.length === 1 && window.booksCache[0].id === 'bk_safe'
    };
  });
  console.log(`   └─ Toast: "${res2a.toast}"`);
  console.log(`   └─ Error Caught: ${res2a.caughtError ? 'YES' : 'NO'}, Books Intact: ${res2a.booksIntact ? 'YES' : 'NO'}, Logs Intact: ${res2a.logsIntact ? 'YES' : 'NO'}`);
  console.log(`   └─ Result: ${res2a.passed ? '✅ PASSED' : '❌ FAILED'}`);

  // 2b: Missing books array
  console.log('   ── 2b: Missing Books Array ──');
  const res2b = await page.evaluate(async () => {
    const toastEl = document.querySelector('#toast div');
    if (toastEl) toastEl.textContent = '';
    const payload = JSON.stringify({ app: "Reading Tracker", logs: [] });
    const file = new File([new Blob([payload])], 'no_books.json', { type: 'application/json' });
    await window.importFromJSON(file);
    const toast = toastEl ? toastEl.textContent : '';
    return {
      toast,
      caughtError: toast.includes('missing books array'),
      booksIntact: window.booksCache.length === 1 && window.booksCache[0].id === 'bk_safe',
      passed: toast.includes('missing books array') && window.booksCache.length === 1
    };
  });
  console.log(`   └─ Toast: "${res2b.toast}"`);
  console.log(`   └─ Error Caught: ${res2b.caughtError ? 'YES' : 'NO'}, Data Preserved: ${res2b.booksIntact ? 'YES' : 'NO'}`);
  console.log(`   └─ Result: ${res2b.passed ? '✅ PASSED' : '❌ FAILED'}`);

  // 2c: Books is wrong type
  console.log('   ── 2c: Books Is Wrong Type (string) ──');
  const res2c = await page.evaluate(async () => {
    const toastEl = document.querySelector('#toast div');
    if (toastEl) toastEl.textContent = '';
    const payload = JSON.stringify({ books: "not an array", logs: [] });
    const file = new File([new Blob([payload])], 'bad_type.json', { type: 'application/json' });
    await window.importFromJSON(file);
    const toast = toastEl ? toastEl.textContent : '';
    return {
      toast,
      caughtError: toast.includes('missing books array'),
      booksIntact: window.booksCache.length === 1 && window.booksCache[0].id === 'bk_safe',
      passed: toast.includes('missing books array') && window.booksCache.length === 1
    };
  });
  console.log(`   └─ Toast: "${res2c.toast}"`);
  console.log(`   └─ Error Caught: ${res2c.caughtError ? 'YES' : 'NO'}, Data Preserved: ${res2c.booksIntact ? 'YES' : 'NO'}`);
  console.log(`   └─ Result: ${res2c.passed ? '✅ PASSED' : '❌ FAILED'}`);

  // 2d: Empty books array (valid edge case)
  console.log('   ── 2d: Empty Books Array (valid edge case) ──');
  const res2d = await page.evaluate(async () => {
    const toastEl = document.querySelector('#toast div');
    if (toastEl) toastEl.textContent = '';
    const payload = JSON.stringify({ books: [], logs: [] });
    const file = new File([new Blob([payload])], 'empty.json', { type: 'application/json' });
    await window.importFromJSON(file);
    const toast = toastEl ? toastEl.textContent : '';
    return {
      toast,
      importSucceeded: toast.includes('Import completed successfully'),
      booksCount: window.booksCache.length,
      logsCount: window.logsCache.length,
      passed: toast.includes('Import completed successfully') && window.booksCache.length === 0
    };
  });
  console.log(`   └─ Toast: "${res2d.toast}"`);
  console.log(`   └─ Import Succeeded: ${res2d.importSucceeded ? 'YES' : 'NO'}, State: ${res2d.booksCount} books, ${res2d.logsCount} logs`);
  console.log(`   └─ Result: ${res2d.passed ? '✅ PASSED' : '❌ FAILED'}`);

  console.log('\n▶ UNHANDLED JS ERRORS:', pageErrors.length);
  if (pageErrors.length > 0) pageErrors.forEach(e => console.log('   ⚠️', e));

  await browser.close();

  const allPassed = roundTripResult.passed && res2a.passed && res2b.passed && res2c.passed && res2d.passed && pageErrors.length === 0;
  console.log('\n===============================================================');
  console.log(allPassed ? ' 🎉 ALL BACKUP / RESTORE AUDIT TESTS PASSED!' : ' ⚠️ SOME AUDIT TESTS FAILED');
  console.log('===============================================================\n');
  process.exit(allPassed ? 0 : 1);
}

runBackupRestoreAudit().catch(err => { console.error('Test script crashed:', err); process.exit(1); });
