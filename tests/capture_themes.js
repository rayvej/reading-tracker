import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { bypassAuthAndInit } from './test_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const indexPath = 'file://' + path.resolve(__dirname, '../docs/index.html');
const outDir = path.resolve(__dirname, 'screenshots/theme_deep_dive');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const themes = ['espresso', 'glass-studio', 'obsidian', 'parched-paper'];
const modes = ['dark', 'light'];

async function captureAllThemes() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(indexPath, { waitUntil: 'load' });
  await bypassAuthAndInit(page);

  // Populate data
  await page.evaluate(() => {
    const seedBooks = [
      {
        id: 'book_1',
        title: 'Atomic Habits',
        author: 'James Clear',
        pages: 320,
        currentPage: 180,
        status: 'reading',
        category: 'Personal Development',
        coverUrl: '',
        rating: 5,
        notes: 'Tiny changes, remarkable results.'
      },
      {
        id: 'book_2',
        title: 'The Dawn-Breakers',
        author: 'Nabíl-i-A\'zam',
        pages: 685,
        currentPage: 685,
        status: 'completed',
        category: 'Bahá\'í History',
        coverUrl: '',
        rating: 5,
        notes: 'Masterpiece chronicle of the early heroes.'
      }
    ];
    window.booksCache = seedBooks;
    localStorage.setItem('rt_books', JSON.stringify(seedBooks));
  });

  for (const theme of themes) {
    for (const mode of modes) {
      await page.evaluate((t, m) => {
        if (typeof window.setEditorialTheme === 'function') window.setEditorialTheme(t);
        if (typeof window.setEditorialMode === 'function') window.setEditorialMode(m);
        if (typeof window.renderDashboard === 'function') window.renderDashboard();
      }, theme, mode);

      await new Promise(r => setTimeout(r, 400));

      // 1. Dashboard
      await page.evaluate(() => {
        const btn = document.querySelector('button[data-view="dashboard"]');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 400));
      await page.screenshot({ path: path.join(outDir, `${theme}_${mode}_dashboard.png`) });

      // 2. Knowledge
      await page.evaluate(() => {
        const btn = document.querySelector('button[data-view="knowledge"]');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 400));
      await page.screenshot({ path: path.join(outDir, `${theme}_${mode}_knowledge.png`) });

      // 3. Bookshelf
      await page.evaluate(() => {
        const btn = document.querySelector('button[data-view="wishlist"]');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 400));
      await page.screenshot({ path: path.join(outDir, `${theme}_${mode}_bookshelf.png`) });

      // 4. Goals
      await page.evaluate(() => {
        const btn = document.querySelector('button[data-view="goals"]');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 400));
      await page.screenshot({ path: path.join(outDir, `${theme}_${mode}_goals.png`) });

      // 5. Settings Modal
      await page.evaluate(() => {
        const settingsBtn = document.getElementById('btn-settings-open');
        if (settingsBtn) settingsBtn.click();
      });
      await new Promise(r => setTimeout(r, 400));
      await page.screenshot({ path: path.join(outDir, `${theme}_${mode}_settings.png`) });

      // Close Settings Modal
      await page.evaluate(() => {
        const closeBtn = document.getElementById('settings-modal-close');
        if (closeBtn) closeBtn.click();
      });
      await new Promise(r => setTimeout(r, 200));
    }
  }

  await browser.close();
  console.log('All theme deep dive screenshots captured successfully in', outDir);
}

captureAllThemes();
