import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const indexPath = `file://${path.join(rootDir, 'docs', 'index.html')}`;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

console.log('===============================================================');
console.log(' 🚀 ZERO-STATE ONBOARDING & STARTER IMPORTER AUDITOR ');
console.log('===============================================================\n');

async function runOnboardingAudit() {
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
  page.on('pageerror', err => pageErrors.push(err.toString()));

  const viewports = [
    { name: 'Mobile (375px)', width: 375, height: 812 },
    { name: 'Desktop (1280px)', width: 1280, height: 800 }
  ];

  const auditReport = [];

  for (const vp of viewports) {
    console.log(`\n▶ TESTING VIEWPORT: ${vp.name} (${vp.width}x${vp.height})...`);
    await page.setViewport({ width: vp.width, height: vp.height });

    // Step 1: Navigate to page
    await page.goto(indexPath, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Bypass PIN screen for test
    await page.evaluate(() => {
      const pinOverlay = document.getElementById('pin-screen');
      if (pinOverlay) pinOverlay.classList.add('hidden');
      const authOverlay = document.getElementById('auth-screen');
      if (authOverlay) authOverlay.classList.add('hidden');
      const app = document.getElementById('app');
      if (app) app.classList.remove('hidden');
    });

    // Wait for app.js module to assign openStarterImportModal
    await page.waitForFunction(() => typeof window.openStarterImportModal === 'function', { timeout: 5000 });

    // Open starter import modal directly
    await page.evaluate(() => window.openStarterImportModal());
    await new Promise(r => setTimeout(r, 500));

    // STEP 1: Verify Starter Modal Layout & Touch Targets
    const modalState = await page.evaluate((vpWidth, vpHeight) => {
      const modal = document.getElementById('starter-import-modal');
      if (!modal) return { exists: false };
      const isOpen = modal.classList.contains('open');

      const card = modal.querySelector('.ios-modal-card');
      if (!card) return { exists: true, isOpen, cardExists: false };

      const cardRect = card.getBoundingClientRect();
      const closeBtn = document.getElementById('starter-modal-close');
      const closeRect = closeBtn ? closeBtn.getBoundingClientRect() : null;

      const saveBtn = document.getElementById('starter-modal-save-done');
      const saveRect = saveBtn ? saveBtn.getBoundingClientRect() : null;

      const saveAnotherBtn = document.getElementById('starter-modal-save-another');
      const saveAnotherRect = saveAnotherBtn ? saveAnotherBtn.getBoundingClientRect() : null;

      const precYearBtn = document.getElementById('btn-starter-prec-year');
      const precYearRect = precYearBtn ? precYearBtn.getBoundingClientRect() : null;

      const titleInput = document.getElementById('starter-book-title');
      const inputRect = titleInput ? titleInput.getBoundingClientRect() : null;

      return {
        exists: true,
        isOpen: isOpen,
        cardExists: true,
        cardRect: {
          left: Math.round(cardRect.left),
          right: Math.round(cardRect.right),
          width: Math.round(cardRect.width),
          height: Math.round(cardRect.height),
          top: Math.round(cardRect.top),
          bottom: Math.round(cardRect.bottom)
        },
        offscreenRight: cardRect.right > vpWidth + 2,
        offscreenLeft: cardRect.left < -2,
        closeTouchTarget: closeRect ? { width: Math.round(closeRect.width), height: Math.round(closeRect.height) } : null,
        saveTouchTarget: saveRect ? { width: Math.round(saveRect.width), height: Math.round(saveRect.height) } : null,
        saveAnotherTouchTarget: saveAnotherRect ? { width: Math.round(saveAnotherRect.width), height: Math.round(saveAnotherRect.height) } : null,
        precYearTouchTarget: precYearRect ? { width: Math.round(precYearRect.width), height: Math.round(precYearRect.height) } : null,
        inputVisible: inputRect ? (inputRect.width > 0 && inputRect.height > 0) : false
      };
    }, vp.width, vp.height);

    console.log(`  [Step 1] Starter Modal Verification Result:`, modalState);

    auditReport.push({
      viewport: vp.name,
      step: 'Step 1: Modal Layout & Bounding Rects',
      modalState
    });

    // STEP 2: Test Settings Tab "Quick-Add Past Books" Trigger
    // First close the modal
    await page.evaluate(() => {
      const closeBtn = document.getElementById('starter-modal-close');
      if (closeBtn) closeBtn.click();
    });
    await new Promise(r => setTimeout(r, 300));

    // Open Settings Modal
    await page.evaluate(() => {
      const btnSettings = document.getElementById('btn-settings-open');
      if (btnSettings) btnSettings.click();
      const settingsModal = document.getElementById('settings-modal');
      if (settingsModal) settingsModal.classList.add('open');
    });
    await new Promise(r => setTimeout(r, 300));

    // Click "Quick-Add Past Books" inside Settings Modal
    const settingsTriggerResult = await page.evaluate(() => {
      const triggerBtn = document.getElementById('btn-open-starter-importer');
      if (!triggerBtn) return { triggerFound: false };

      triggerBtn.click();
      const modal = document.getElementById('starter-import-modal');
      const settingsModal = document.getElementById('settings-modal');
      return {
        triggerFound: true,
        starterModalOpen: modal ? modal.classList.contains('open') : false,
        settingsModalClosed: settingsModal ? !settingsModal.classList.contains('open') : true
      };
    });

    console.log(`  [Step 2] Settings Tab Trigger Result:`, settingsTriggerResult);

    auditReport.push({
      viewport: vp.name,
      step: 'Step 2: Settings Tab Trigger',
      settingsTriggerResult
    });
  }

  await browser.close();

  console.log('\n===============================================================');
  console.log(' 📋 AUDIT SUMMARY & VERIFICATION REPORT');
  console.log('===============================================================');
  console.log('Page JavaScript Errors:', pageErrors.length === 0 ? '0 Errors' : pageErrors);

  auditReport.forEach(r => {
    console.log(`\nViewport: ${r.viewport} | ${r.step}`);
    console.log(JSON.stringify(r.modalState || r.settingsTriggerResult, null, 2));
  });
}

runOnboardingAudit().catch(err => {
  console.error('Audit Runner Failure:', err);
  process.exit(1);
});
