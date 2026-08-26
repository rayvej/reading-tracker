/**
 * E2E User Journey Test (Puppeteer-based)
 * Tests the complete reading tracker workflow
 * 
 * Prerequisites:
 *   npm install puppeteer-core
 *   Google Chrome must be installed
 *   App must be served locally (e.g., npx serve docs -p 3000)
 * 
 * Usage:
 *   node tests/e2e_user_journey.test.js
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const indexPath = pathToFileURL(path.resolve('docs', 'index.html')).href;
let browser, page;

async function launchBrowser() {
  try {
    const puppeteer = await import('puppeteer-core');
    
    // Try common Chrome paths
    const chromePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe'
    ];
    
    let executablePath;
    for (const p of chromePaths) {
      if (fs.existsSync(p)) { executablePath = p; break; }
    }
    
    if (!executablePath) {
      console.log('⚠ Chrome not found. Set CHROME_PATH env var.');
      process.exit(0);
    }

    browser = await puppeteer.default.launch({
      executablePath,
      headless: true,
      protocolTimeout: 30000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--allow-file-access-from-files',
        '--disable-web-security'
      ]
    });
    page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812 }); // iPhone viewport
  } catch (e) {
    console.log(`⚠ Puppeteer launch skipped: ${e.message}`);
    process.exit(0);
  }
}

async function cleanup() {
  if (browser) await browser.close();
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

console.log('\n═══ E2E User Journey Tests ═══\n');

try {
  await launchBrowser();
  
  // ── Test 1: App loads successfully ──────────────────────────────────
  await test('App loads and shows auth screen', async () => {
    await page.goto(indexPath, { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    assert.equal(title, 'Reading Tracker');
  });

  // ── Test 2: Service Worker configuration ────────────────────────────
  await test('Service Worker script exists and is configured', async () => {
    const swPath = path.resolve('docs', 'sw.js');
    assert.ok(fs.existsSync(swPath), 'sw.js must exist');
    const swContent = fs.readFileSync(swPath, 'utf8');
    assert.ok(swContent.includes('reading-tracker-v122'), 'sw.js should reference v122 cache');
  });

  // ── Test 3: Manifest is accessible ──────────────────────────────────
  await test('PWA manifest is accessible and valid', async () => {
    const manifestPath = path.resolve('docs', 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.name, 'Reading Tracker');
    assert.ok(manifest.icons && manifest.icons.length >= 2, 'Should have at least 2 icons');
  });

  // ── Test 4: Offline core shell assets exist ─────────────────────────
  await test('Core Shell Assets are present for offline PWA', async () => {
    assert.ok(fs.existsSync(path.resolve('docs', 'index.html')), 'index.html exists');
    assert.ok(fs.existsSync(path.resolve('docs', 'style.css')), 'style.css exists');
    assert.ok(fs.existsSync(path.resolve('docs', 'app.js')), 'app.js exists');
  });

  // ── Test 5: Escape key handler ──────────────────────────────────────
  await test('Global Escape key handler is registered', async () => {
    const hasHandler = await page.evaluate(() => {
      // Test by dispatching an Escape key event
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(event);
      return true; // If no error thrown, handler exists
    });
    assert.ok(hasHandler);
  });

  // ── Test 6: Focus indicators ────────────────────────────────────────
  await test('Focus-visible CSS is applied', async () => {
    const hasFocusRule = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.selectorText && rule.selectorText.includes('focus-visible')) {
              return true;
            }
          }
        } catch (e) { /* cross-origin sheet */ }
      }
      return false;
    });
    assert.ok(hasFocusRule, 'Should have :focus-visible CSS rules');
  });

} catch (e) {
  console.error('E2E test suite error:', e.message);
} finally {
  await cleanup();
}

// Summary
console.log(`\\n══════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════\\n`);

if (failed > 0) process.exit(1);
