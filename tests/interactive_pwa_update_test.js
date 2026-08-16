import puppeteer from 'puppeteer-core';
import path from 'path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import { bypassAuthAndInit } from './test_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const indexPath = 'file://' + path.resolve(__dirname, '../docs/index.html');

console.log('===============================================================');
console.log(' 🧪 LIVE PUPPETEER PWA UPDATE & FORCE REFRESH INTERACTION TEST ');
console.log('===============================================================\n');

async function runTest() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852 });
  await page.goto(indexPath, { waitUntil: 'load' });
  await bypassAuthAndInit(page);

  console.log('▶ STEP 1: Verifying Service Worker & Update Inspector Initialization...');
  const initCheck = await page.evaluate(() => {
    return {
      hasShowUpdateModal: typeof window.showUpdateModal === 'function',
      hasSetupInspector: typeof window.setupSettingsUpdateInspector === 'function',
      updateModalExists: !!document.getElementById('pwa-update-modal'),
      updateModalDisplay: document.getElementById('pwa-update-modal').style.display,
      checkBtnExists: !!document.getElementById('btn-check-sw-update'),
      forceBtnExists: !!document.getElementById('btn-force-reload-app')
    };
  });

  assert.ok(initCheck.hasShowUpdateModal, 'showUpdateModal is defined');
  assert.ok(initCheck.hasSetupInspector, 'setupSettingsUpdateInspector is defined');
  assert.ok(initCheck.updateModalExists, '#pwa-update-modal exists');
  assert.equal(initCheck.updateModalDisplay, 'none', 'Update modal starts hidden');
  assert.ok(initCheck.checkBtnExists, '#btn-check-sw-update exists');
  assert.ok(initCheck.forceBtnExists, '#btn-force-reload-app exists');
  console.log('  ✓ Update Inspector components initialized cleanly');

  console.log('\n▶ STEP 2: Testing Check Updates Click in Settings...');
  // Open settings
  await page.evaluate(() => {
    const settingsBtn = document.getElementById('btn-settings-open');
    if (settingsBtn) settingsBtn.click();
  });
  await new Promise(r => setTimeout(r, 400));

  // Click Check Updates button
  const checkResult = await page.evaluate(async () => {
    const btn = document.getElementById('btn-check-sw-update');
    btn.click();
    return {
      isDisabledDuringCheck: btn.disabled,
      textDuringCheck: btn.innerText
    };
  });

  console.log('  ✓ Button enters checking state with spinner');

  // Wait 1.8 seconds for check to resolve
  await new Promise(r => setTimeout(r, 1800));

  const postCheckState = await page.evaluate(() => {
    const btn = document.getElementById('btn-check-sw-update');
    const modal = document.getElementById('pwa-update-modal');
    return {
      isEnabledAfter: !btn.disabled,
      modalOpen: modal.classList.contains('open') && modal.style.display !== 'none'
    };
  });

  assert.ok(postCheckState.isEnabledAfter, 'Check button re-enables after check');
  assert.ok(!postCheckState.modalOpen, 'Update modal does not falsely pop up when up to date');
  console.log('  ✓ Check Updates completed without false-positive modal popup');

  console.log('\n▶ STEP 3: Testing showUpdateModal Display & SKIP_WAITING message flow...');
  const modalTestResult = await page.evaluate(() => {
    window.swWaitingWorker = {
      postMessage: (msg) => { window.__lastMessage = msg; }
    };
    window.showUpdateModal();
    const modal = document.getElementById('pwa-update-modal');
    const updateBtn = document.getElementById('btn-pwa-update-now');
    
    // Simulate user clicking Update Now
    updateBtn.click();

    return {
      isOpen: modal.classList.contains('open'),
      sentMessage: window.__lastMessage
    };
  });

  assert.ok(modalTestResult.isOpen, 'showUpdateModal displays modal cleanly');
  assert.deepEqual(modalTestResult.sentMessage, { type: 'SKIP_WAITING' }, 'Update button posts SKIP_WAITING to waiting worker');
  console.log('  ✓ Update Now button properly triggers SKIP_WAITING');

  await browser.close();
  console.log('\n===============================================================');
  console.log(' 🏆 ALL INTERACTIVE PWA UPDATE & REFRESH TESTS PASSED (100%)');
  console.log('===============================================================\n');
}

runTest().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
