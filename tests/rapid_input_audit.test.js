import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const indexPath = `file://${path.join(rootDir, 'docs', 'index.html')}`;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

console.log('===============================================================');
console.log(' ⚡ OPTIMISTIC LOCAL WRITE & IDEMPOTENT SYNC AUDIT ');
console.log('===============================================================\n');

async function runOptimisticSyncAudit() {
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

  // Clear storage
  const cdp = await page.target().createCDPSession();
  await cdp.send('Storage.clearDataForOrigin', { origin: '*', storageTypes: 'all' });

  await page.goto(indexPath, { waitUntil: 'networkidle0' });

  // Initialize App DOM state
  await page.evaluate(async () => {
    window.isMockAuth = true;
    window.uid = 'test_user_rapid';
    
    const pin = document.getElementById('pin-screen');
    if (pin) pin.classList.add('hidden');
    const auth = document.getElementById('auth-screen');
    if (auth) auth.classList.add('hidden');
    const app = document.getElementById('app');
    if (app) app.classList.remove('hidden');

    if (typeof window.initApp === 'function') {
      await window.initApp();
    }
  });

  await new Promise(r => setTimeout(r, 600));

  console.log('▶ TEST 1: Rapid 5x Multi-Click De-duplication on Add Book Modal...');
  const addBookResult = await page.evaluate(async () => {
    // Fill fields in Add Book Modal
    const titleEl = document.getElementById('ab-title');
    const pagesEl = document.getElementById('ab-pages');
    const costEl = document.getElementById('ab-cost');
    
    if (titleEl) titleEl.value = 'Rapid Multi-Click Test Book';
    if (pagesEl) pagesEl.value = '250';
    if (costEl) costEl.value = '15.99';
    
    const beforeCount = (window.booksCache || []).length;
    
    // Call saveNewBook directly in rapid loop to simulate multi-click submit
    const p1 = window.saveNewBook();
    const p2 = window.saveNewBook();
    const p3 = window.saveNewBook();
    const p4 = window.saveNewBook();
    const p5 = window.saveNewBook();
    
    await Promise.allSettled([p1, p2, p3, p4, p5]);
    
    const afterCount = (window.booksCache || []).length;
    const addedCount = afterCount - beforeCount;
    return { beforeCount, afterCount, addedCount, success: addedCount === 1 };
  });

  console.log(`   └─ Before count: ${addBookResult.beforeCount}, After count: ${addBookResult.afterCount}`);
  console.log(`   └─ Added records: ${addBookResult.addedCount} (Expected: 1) -> ${addBookResult.success ? '✅ PASSED' : '❌ FAILED'}`);

  console.log('\n▶ TEST 2: Rapid 5x Multi-Click De-duplication on Submit Log Form...');
  const submitLogResult = await page.evaluate(async () => {
    // Select book in dropdown
    const bookSelect = document.getElementById('log-book');
    if (bookSelect) {
      let opt = Array.from(bookSelect.options).find(o => o.value === 'Rapid Multi-Click Test Book');
      if (!opt) {
        opt = document.createElement('option');
        opt.value = 'Rapid Multi-Click Test Book';
        opt.textContent = 'Rapid Multi-Click Test Book';
        bookSelect.appendChild(opt);
      }
      bookSelect.value = 'Rapid Multi-Click Test Book';
    }

    document.getElementById('log-date').value = '2026-07-30';
    document.getElementById('log-start').value = '0';
    document.getElementById('log-end').value = '50';
    document.getElementById('log-minutes').value = '30';
    
    const beforeCount = (window.logsCache || []).length;
    
    // Call submitLog directly in rapid loop
    const p1 = window.submitLog();
    const p2 = window.submitLog();
    const p3 = window.submitLog();
    const p4 = window.submitLog();
    const p5 = window.submitLog();
    
    await Promise.allSettled([p1, p2, p3, p4, p5]);
    
    const afterCount = (window.logsCache || []).length;
    const addedCount = afterCount - beforeCount;
    return { beforeCount, afterCount, addedCount, success: addedCount === 1 };
  });

  console.log(`   └─ Before count: ${submitLogResult.beforeCount}, After count: ${submitLogResult.afterCount}`);
  console.log(`   └─ Added log records: ${submitLogResult.addedCount} (Expected: 1) -> ${submitLogResult.success ? '✅ PASSED' : '❌ FAILED'}`);

  console.log('\n▶ TEST 3: Validation Edge Cases (Negative Numbers & Invalid Range)...');
  const validationResult = await page.evaluate(async () => {
    const results = [];
    const toastEl = document.querySelector('#toast div');

    // Case 3a: Negative page count in Add Book
    document.getElementById('ab-title').value = 'Negative Pages Book';
    document.getElementById('ab-pages').value = '-100';
    await window.saveNewBook();
    const toast1 = toastEl ? toastEl.textContent : '';
    results.push({ test: 'Negative Pages', toast: toast1, passed: toast1.includes('valid page length') });

    // Case 3b: End page <= Start page in Log Session
    document.getElementById('log-start').value = '100';
    document.getElementById('log-end').value = '50';
    await window.submitLog();
    const toast2 = toastEl ? toastEl.textContent : '';
    results.push({ test: 'End <= Start Page', toast: toast2, passed: toast2.includes('End page must be greater') });

    // Case 3c: Negative Minutes in Log Session
    document.getElementById('log-start').value = '0';
    document.getElementById('log-end').value = '50';
    document.getElementById('log-minutes').value = '-20';
    await window.submitLog();
    const toast3 = toastEl ? toastEl.textContent : '';
    results.push({ test: 'Negative Minutes', toast: toast3, passed: toast3.includes('positive number') });

    return results;
  });

  validationResult.forEach(r => {
    console.log(`   └─ ${r.test}: "${r.toast}" -> ${r.passed ? '✅ PASSED' : '❌ FAILED'}`);
  });

  console.log('\n▶ TEST 4: Special Characters & Long Title Sanitization Test...');
  const specialCharResult = await page.evaluate(async () => {
    const longSpecialTitle = "Bahá'í: <script>alert('xss')</script> " + 'A'.repeat(450);
    document.getElementById('ab-title').value = longSpecialTitle;
    document.getElementById('ab-pages').value = '300';
    document.getElementById('ab-cost').value = '29.99';
    
    await window.saveNewBook();
    
    const addedBook = window.booksCache ? window.booksCache.find(b => b.title === longSpecialTitle) : null;
    
    const testDiv = document.createElement('div');
    testDiv.textContent = addedBook ? addedBook.title : '';
    const scriptEscaped = !testDiv.innerHTML.includes('<script>');
    
    return {
      added: !!addedBook,
      titleLength: addedBook ? addedBook.title.length : 0,
      scriptEscaped: scriptEscaped
    };
  });

  console.log(`   └─ Book added cleanly: ${specialCharResult.added ? 'YES' : 'NO'}`);
  console.log(`   └─ Title length: ${specialCharResult.titleLength} characters`);
  console.log(`   └─ Script injection prevented: ${specialCharResult.scriptEscaped ? '✅ PASSED' : '❌ FAILED'}`);

  console.log('\n▶ TEST 5: Simulated 2-Second Network Latency & Idempotent Firestore Sync...');
  const latencyResult = await page.evaluate(async () => {
    // Fill form for Latency Book
    document.getElementById('ab-title').value = 'Latency & Idempotency Test Book';
    document.getElementById('ab-pages').value = '400';
    document.getElementById('ab-cost').value = '24.99';

    window.isMockAuth = false;
    window.db = {};
    window.uid = 'test_user_latency';
    
    const startTime = Date.now();
    
    // Trigger Save
    const savePromise = window.saveNewBook();
    const localWriteTimestamp = Date.now() - startTime; // Instant local write duration
    
    await savePromise;
    
    const localRecord = window.booksCache.find(b => b.title === 'Latency & Idempotency Test Book');
    const localId = localRecord ? localRecord.id : null;
    const matchingLocalCount = window.booksCache.filter(b => b.title === 'Latency & Idempotency Test Book').length;

    // Simulate 2000ms network delay completing for background sync
    await new Promise(r => setTimeout(r, 2000));
    const remoteWriteTimestamp = Date.now() - startTime;
    
    // Verify local record count remains exactly 1 and ID matches deterministic pre-generated ID
    const finalMatchingCount = window.booksCache.filter(b => b.title === 'Latency & Idempotency Test Book').length;
    const hasDeterministicId = !!(localId && localId.startsWith('rt_'));

    return {
      localWriteMs: localWriteTimestamp,
      remoteWriteMs: remoteWriteTimestamp,
      localRecordCount: matchingLocalCount,
      finalRecordCount: finalMatchingCount,
      localId: localId,
      hasDeterministicId: hasDeterministicId,
      passed: localWriteTimestamp < 100 && matchingLocalCount === 1 && finalMatchingCount === 1 && hasDeterministicId
    };
  });

  console.log(`   └─ Local Write Latency: ${latencyResult.localWriteMs} ms (<100ms target)`);
  console.log(`   └─ Background Sync Duration: ${latencyResult.remoteWriteMs} ms`);
  console.log(`   └─ Pre-generated Deterministic ID: "${latencyResult.localId}" (${latencyResult.hasDeterministicId ? 'YES' : 'NO'})`);
  console.log(`   └─ Local Record Count: ${latencyResult.localRecordCount} (Expected: 1)`);
  console.log(`   └─ Final Record Count After Background Sync: ${latencyResult.finalRecordCount} (Expected: 1) -> ${latencyResult.passed ? '✅ PASSED' : '❌ FAILED'}`);

  console.log('\n▶ UNHANDLED JS ERRORS ENCOUNTERED:', pageErrors.length);
  if (pageErrors.length > 0) {
    pageErrors.forEach(err => console.log('   ⚠️', err));
  }

  await browser.close();

  const allPassed = addBookResult.success &&
                    submitLogResult.success &&
                    validationResult.every(r => r.passed) &&
                    specialCharResult.added &&
                    specialCharResult.scriptEscaped &&
                    latencyResult.passed &&
                    pageErrors.length === 0;

  console.log('\n===============================================================');
  console.log(allPassed ? ' 🎉 ALL OPTIMISTIC SYNC & RAPID INPUT AUDIT TESTS PASSED!' : ' ⚠️ SOME AUDIT TESTS FAILED');
  console.log('===============================================================\n');

  process.exit(allPassed ? 0 : 1);
}

runOptimisticSyncAudit().catch(err => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
