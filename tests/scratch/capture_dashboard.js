import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { bypassAuthAndInit } from '../test_helper.js';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  
  const indexPath = 'file://' + path.resolve('./docs/index.html');
  await page.goto(indexPath, { waitUntil: 'networkidle0' });
  await bypassAuthAndInit(page);
  
  await page.evaluate(() => {
    // Ensure in-progress book exists in booksCache
    let b = window.booksCache.find(x => x.status === 'In Progress');
    if (!b) {
      b = window.booksCache[0];
      b.status = 'In Progress';
      b.pages_read = 45;
      b.total_pages = 300;
    }
    window.renderLiveSessionBanner(window.booksCache, window.logsCache);
  });

  await new Promise(r => setTimeout(r, 600));
  
  const outDir = path.resolve('./tests/screenshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  const banner = await page.$('#dash-live-session');
  if (banner) {
    const bannerPath390 = path.join(outDir, 'banner_390.png');
    await banner.screenshot({ path: bannerPath390 });
    console.log('Saved 390px banner screenshot to:', bannerPath390);
  }

  await page.setViewport({ width: 375, height: 667, deviceScaleFactor: 2 });
  await new Promise(r => setTimeout(r, 400));
  if (banner) {
    const bannerPath375 = path.join(outDir, 'banner_375.png');
    await banner.screenshot({ path: bannerPath375 });
    console.log('Saved 375px banner screenshot to:', bannerPath375);
  }

  const fullPath = path.join(outDir, 'dashboard_full_390.png');
  await page.screenshot({ path: fullPath, fullPage: false });
  console.log('Saved full dashboard screenshot to:', fullPath);

  await browser.close();
})();
