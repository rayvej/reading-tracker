import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  const indexPath = 'file://' + path.resolve('./docs/index.html');
  await page.goto(indexPath, { waitUntil: 'networkidle0' });

  await page.evaluate(() => {
    document.getElementById('auth-screen')?.classList.add('hidden');
    document.getElementById('pin-screen')?.classList.add('hidden');
    document.getElementById('seed-screen')?.classList.add('hidden');
    
    const app = document.getElementById('app');
    if (app) app.classList.remove('hidden');

    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const dash = document.getElementById('view-dashboard');
    if (dash) {
      dash.classList.remove('hidden');
      dash.classList.add('active');
    }

    const session = document.getElementById('dash-live-session');
    if (session) {
      session.style.display = 'flex';
      session.style.opacity = '1';
      session.style.visibility = 'visible';
      session.classList.remove('hidden');
      session.classList.add('is-visible');
    }

    const title = document.getElementById('dash-live-title');
    if (title) title.textContent = 'The Republic';

    const author = document.getElementById('dash-live-author');
    if (author) author.textContent = 'Plato · Non-Bahai';

    const bar = document.getElementById('dash-live-bar');
    if (bar) bar.style.width = '4%';

    const pages = document.getElementById('dash-live-pages-label');
    if (pages) pages.textContent = '14 / 368 pages (4%)';

    const vel = document.getElementById('dash-live-velocity-label');
    if (vel) vel.textContent = 'Pace: 15.0 p/d';

    const line1 = document.getElementById('dash-live-eta-line1');
    if (line1) {
      line1.textContent = '8H 38M LEFT (41 P/H)';
      line1.className = 'px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap';
    }

    const line2 = document.getElementById('dash-live-eta-line2');
    if (line2) {
      line2.textContent = '~14 days left (15.0 p/d)';
      line2.className = 'text-[9px] font-bold text-amber-400/90 mt-0.5 whitespace-nowrap';
    }

    const actions = document.getElementById('dash-live-actions');
    if (actions) actions.classList.remove('hidden');
  });

  const outDir = path.resolve('./tests/screenshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // 1. iPhone 390px
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await new Promise(r => setTimeout(r, 400));
  const banner390 = await page.$('#dash-live-session');
  if (banner390) {
    await banner390.screenshot({ path: path.join(outDir, 'live_banner_390.png') });
    console.log('Captured 390px banner screenshot');
  }

  // 2. iPhone SE 375px
  await page.setViewport({ width: 375, height: 667, deviceScaleFactor: 2 });
  await new Promise(r => setTimeout(r, 400));
  const banner375 = await page.$('#dash-live-session');
  if (banner375) {
    await banner375.screenshot({ path: path.join(outDir, 'live_banner_375.png') });
    console.log('Captured 375px banner screenshot');
  }

  await browser.close();
})();
