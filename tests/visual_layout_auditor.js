import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const indexPath = `file://${path.join(rootDir, 'docs', 'index.html')}`;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

console.log('===============================================================');
console.log(' 🔍 REAL PUPPETEER VISUAL & BOUNDING-BOX LAYOUT AUDITOR ');
console.log('===============================================================\n');

async function runVisualAudit() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Test across Mobile (375px) and Desktop (1280px)
  const viewports = [
    { name: 'Mobile (375px)', width: 375, height: 812 },
    { name: 'Desktop (1280px)', width: 1280, height: 800 }
  ];

  const auditFindings = [];

  for (const vp of viewports) {
    console.log(`\n▶ AUDITING VIEWPORT: ${vp.name} (${vp.width}x${vp.height})...`);
    await page.setViewport({ width: vp.width, height: vp.height });
    await page.goto(indexPath, { waitUntil: 'domcontentloaded' });

    // Ensure PIN is bypassed or cleared for audit
    await page.evaluate(() => {
      localStorage.removeItem('rt_pin_hash');
      const pinOverlay = document.getElementById('pin-overlay');
      if (pinOverlay) pinOverlay.style.display = 'none';
      const appContent = document.getElementById('app-content');
      if (appContent) appContent.style.display = 'block';
    });

    // List of tabs & views to audit
    const viewsToAudit = [
      { id: 'view-dashboard', name: 'Dashboard Tab' },
      { id: 'view-knowledge', name: 'Knowledge Tab' },
      { id: 'view-goals', name: 'Goals Tab' },
      { id: 'view-wishlist', name: 'Bookshelf Tab' },
      { id: 'view-account', name: 'Account Tab' }
    ];

    for (const view of viewsToAudit) {
      // Switch view
      await page.evaluate((viewId) => {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        const target = document.getElementById(viewId);
        if (target) target.classList.remove('hidden');
        window.dispatchEvent(new Event('resize'));
      }, view.id);

      await new Promise(r => setTimeout(r, 200));

      // Click through sub-tabs in view if any exist
      const subTabs = await page.evaluate((viewId) => {
        const viewElem = document.getElementById(viewId);
        if (!viewElem) return [];
        return Array.from(viewElem.querySelectorAll('.seg-control button, [role="tab"], [data-tab], [data-timeframe], [data-bsf], [data-bfo]'))
          .map((b, idx) => ({ index: idx, text: b.textContent.trim(), tag: b.tagName }));
      }, view.id);

      // Audit current state + click sub-tabs
      const iterations = subTabs.length > 0 ? subTabs.slice(0, 10) : [{ index: -1, text: 'Main View' }];

      for (const sub of iterations) {
        if (sub.index >= 0) {
          await page.evaluate((viewId, idx) => {
            const viewElem = document.getElementById(viewId);
            const btns = viewElem.querySelectorAll('.seg-control button, [role="tab"], [data-tab], [data-timeframe], [data-bsf], [data-bfo]');
            if (btns[idx]) btns[idx].click();
          }, view.id, sub.index);
          await new Promise(r => setTimeout(r, 100));
        }

        // Run Bounding Box & Layout Diagnostics on active DOM
        const errors = await page.evaluate((vpWidth, vpHeight, viewName, subName) => {
          const results = [];

          // 1. Check for Text Truncation (scrollWidth > clientWidth without ellipsis/scroll)
          const allTextElems = Array.from(document.querySelectorAll('span, p, h1, h2, h3, h4, button, label, td, th'));
          allTextElems.forEach(el => {
            if (el.offsetWidth === 0 || el.offsetHeight === 0) return; // Ignore hidden
            const style = window.getComputedStyle(el);

            if (el.scrollWidth > el.clientWidth + 3) {
              const overflowX = style.overflowX;
              const textOverflow = style.textOverflow;
              const isScrollable = overflowX === 'auto' || overflowX === 'scroll' || el.closest('.overflow-x-auto') || el.closest('.seg-control');

              if (!isScrollable && textOverflow !== 'ellipsis' && style.whiteSpace === 'nowrap') {
                const parent = el.parentElement;
                results.push({
                  type: 'TEXT_TRUNCATION',
                  selector: el.id ? `#${el.id}` : (el.className ? `.${el.className.split(' ').join('.')}` : el.tagName),
                  text: el.textContent.trim().slice(0, 30),
                  scrollWidth: el.scrollWidth,
                  clientWidth: el.clientWidth,
                  detail: `Text content scrollWidth (${el.scrollWidth}px) exceeds clientWidth (${el.clientWidth}px) without ellipsis`
                });
              }
            }
          });

          // 2. Check for Horizontal Off-Screen Overflow without Scroll Container
          const allVisible = Array.from(document.querySelectorAll('div, section, article, table, svg, canvas'));
          allVisible.forEach(el => {
            if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
            const rect = el.getBoundingClientRect();
            if (rect.right > vpWidth + 2) {
              const style = window.getComputedStyle(el);
              const parentScroll = el.closest('.overflow-x-auto, .seg-control, .no-scrollbar');
              if (!parentScroll && style.overflowX !== 'auto' && style.overflowX !== 'scroll') {
                const tagInfo = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ').slice(0, 3).join('.') : ''}`;
                const parentInfo = el.parentElement ? `${el.parentElement.tagName.toLowerCase()}${el.parentElement.id ? '#' + el.parentElement.id : ''}${el.parentElement.className ? '.' + el.parentElement.className.split(' ').slice(0, 2).join('.') : ''}` : 'root';
                results.push({
                  type: 'OFFSCREEN_CLIPPING',
                  selector: tagInfo,
                  rectRight: Math.round(rect.right),
                  vpWidth: vpWidth,
                  detail: `Bounding box right edge (${Math.round(rect.right)}px) clips off-screen beyond viewport width (${vpWidth}px) [Parent: ${parentInfo}]`
                });
              }
            }
          });

          // 3. Check for Touch Target Bounds (< 40px height/width on Mobile)
          if (vpWidth <= 414) {
            const buttons = Array.from(document.querySelectorAll('button, input[type="button"], a.btn'));
            buttons.forEach(btn => {
              if (btn.offsetWidth === 0 || btn.offsetHeight === 0) return;
              const rect = btn.getBoundingClientRect();
              if (rect.top >= 0 && rect.bottom <= vpHeight) {
                if (rect.width < 32 || rect.height < 32) {
                  results.push({
                    type: 'TOUCH_TARGET_TOO_SMALL',
                    selector: btn.id ? `#${btn.id}` : (btn.className ? `.${btn.className.split(' ')[0]}` : 'button'),
                    text: btn.textContent.trim().slice(0, 20),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    detail: `Touch target size (${Math.round(rect.width)}x${Math.round(rect.height)}px) is smaller than recommended minimum (32x32px)`
                  });
                }
              }
            });
          }

          return results;
        }, vp.width, vp.height, view.name, sub.text);

        if (errors.length > 0) {
          auditFindings.push({
            viewport: vp.name,
            view: view.name,
            subTab: sub.text,
            errors: errors
          });
        }
      }
    }
  }

  await browser.close();

  console.log('\n===============================================================');
  console.log(' 🚨 ACTUAL VISUAL & BOUNDING-BOX LAYOUT AUDIT FINDINGS');
  console.log('===============================================================');

  if (auditFindings.length === 0) {
    console.log('✨ 0 Layout Violations Detected across all viewports!');
  } else {
    console.log(`Found ${auditFindings.length} layout anomaly groups:\n`);
    auditFindings.forEach((finding, idx) => {
      console.log(`[Group ${idx + 1}] Viewport: ${finding.viewport} | View: ${finding.view} | SubTab: ${finding.subTab}`);
      finding.errors.slice(0, 5).forEach(err => {
        console.log(`  ❌ [${err.type}] Element: ${err.selector}`);
        console.log(`     • ${err.detail}`);
        if (err.text) console.log(`     • Text: "${err.text}"`);
      });
      console.log('');
    });
  }
}

runVisualAudit().catch(err => {
  console.error('Audit Runner Error:', err);
  process.exit(1);
});
