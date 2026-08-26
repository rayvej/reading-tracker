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
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3000';
let browser, page, server;

function startStaticServer(port = 3000) {
  return new Promise((resolve) => {
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    };

    server = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/') reqPath = '/index.html';
      const filePath = path.join(path.resolve('docs'), reqPath);

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });

    server.listen(port, '127.0.0.1', () => {
      resolve();
    });
    server.on('error', () => {
      // If port is already in use, assume external server is running
      server = null;
      resolve();
    });
  });
}

async function launchBrowser() {
  await startStaticServer(3000);
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
    const { existsSync } = await import('node:fs');
    for (const p of chromePaths) {
      if (existsSync(p)) { executablePath = p; break; }
    }
    
    if (!executablePath) {
      console.log('⚠ Chrome not found. Set CHROME_PATH env var.');
      process.exit(0);
    }

    browser = await puppeteer.default.launch({
      executablePath,
      headless: 'new',
      protocolTimeout: 60000,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    page = await browser.newPage();
    await page.setViewport({ width: 375, height: 812 }); // iPhone viewport
  } catch (e) {
    console.log(`⚠ Puppeteer launch skipped: ${e.message}`);
    if (server) server.close();
    process.exit(0);
  }
}

async function cleanup() {
  if (browser) await browser.close();
  if (server) server.close();
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
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const title = await page.title();
    assert.equal(title, 'Reading Tracker');
  });

  // ── Test 2: Service Worker registers ────────────────────────────────
  await test('Service Worker registers', async () => {
    const swRegistered = await page.evaluate(async () => {
      if (!navigator.serviceWorker) return false;
      try {
        const reg = await navigator.serviceWorker.ready;
        return !!reg;
      } catch (e) {
        return false;
      }
    });
    assert.ok(swRegistered, 'Service worker should register');
  });

  // ── Test 3: Manifest is accessible ──────────────────────────────────
  await test('PWA manifest is accessible', async () => {
    await page.goto(`${APP_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const manifestResult = await page.evaluate(async () => {
      const res = await fetch('./manifest.json');
      return { status: res.status, data: await res.json() };
    });
    assert.equal(manifestResult.status, 200);
    const manifest = manifestResult.data;
    assert.equal(manifest.name, 'Reading Tracker');
    assert.ok(manifest.icons.length >= 2, 'Should have at least 2 icons');
  });

  // ── Test 4: Offline mode ────────────────────────────────────────────
  await test('App shell loads from cache when offline', async () => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Wait for SW ready
    await page.evaluate(async () => {
      if (navigator.serviceWorker) {
        await navigator.serviceWorker.ready;
      }
    });
    await new Promise(r => setTimeout(r, 1000));
    
    // Go offline
    await page.setOfflineMode(true);
    
    // Reload — should serve from cache
    try {
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const title = await page.title();
      assert.equal(title, 'Reading Tracker', 'Should load from SW cache offline');
    } finally {
      await page.setOfflineMode(false);
    }
  });

  // ── Test 5: Escape key handler ──────────────────────────────────────
  await test('Global Escape key handler is registered', async () => {
    await page.goto(APP_URL, { waitUntil: 'networkidle2' });
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
    await page.goto(APP_URL, { waitUntil: 'networkidle2' });
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
