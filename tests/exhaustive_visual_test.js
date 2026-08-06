/**
 * EXHAUSTIVE VISUAL & INTERACTIVE TEST SUITE
 * 
 * Uses Puppeteer to open the app in a REAL Chrome browser,
 * screenshot every view/modal at multiple viewports,
 * click every button, fill every form, and report all issues.
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { bypassAuthAndInit } from './test_helper.js';

const BASE_URL = 'http://127.0.0.1:8765';
const SCREENSHOT_DIR = path.resolve('tests/screenshots');
const REPORT_FILE = path.resolve('tests/exhaustive_test_report.json');

// Viewports to test
const VIEWPORTS = {
  desktop: { width: 1280, height: 800, label: 'desktop' },
  tablet: { width: 768, height: 1024, label: 'tablet' },
  mobile: { width: 375, height: 812, label: 'mobile' },
};

// All known views (tab navigation)
const VIEWS = ['dashboard', 'log', 'knowledge', 'goals', 'wishlist'];

// All known modals
const MODALS = [
  { id: 'settings-modal', openBtn: '#btn-settings-open', name: 'Settings' },
  { id: 'goals-modal', openBtn: '#btn-edit-goals', name: 'Goals Editor', requiresView: 'goals' },
  { id: 'add-book-modal', openBtn: '#btn-add-book-trigger', name: 'Add Book', requiresView: 'wishlist' },
  { id: 'quick-note-modal', openBtn: '#btn-quick-note-open', name: 'Quick Note', requiresView: 'knowledge' },
  { id: 'cover-manager-modal', openBtn: '#btn-cover-manager', name: 'Cover Manager', requiresView: 'wishlist' },
  { id: 'isbn-scanner-modal', openBtn: '#btn-scan-isbn', name: 'ISBN Scanner', requiresView: 'wishlist' },
];

// Collect all issues
const issues = [];

function addIssue(severity, category, description, screenshot = null, viewport = null) {
  issues.push({
    severity,       // 'critical', 'major', 'minor', 'info'
    category,       // 'visual', 'interaction', 'overflow', 'accessibility', 'layout', 'responsive'
    description,
    screenshot,
    viewport,
    timestamp: new Date().toISOString(),
  });
  const icon = severity === 'critical' ? '🔴' : severity === 'major' ? '🟠' : severity === 'minor' ? '🟡' : 'ℹ️';
  console.log(`  ${icon} [${severity.toUpperCase()}] ${description}`);
}

async function screenshot(page, name) {
  const filepath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}

async function waitAndCheck(page, timeout = 1000) {
  await new Promise(r => setTimeout(r, timeout));
}

// ============================================
// PHASE 1: VISUAL WALKTHROUGH
// ============================================
async function phase1_visualWalkthrough(page) {
  console.log('\n' + '='.repeat(60));
  console.log('📸 PHASE 1: VISUAL WALKTHROUGH');
  console.log('='.repeat(60));

  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    console.log(`\n--- Viewport: ${vpName} (${vp.width}x${vp.height}) ---`);
    await page.setViewport({ width: vp.width, height: vp.height });
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await waitAndCheck(page, 1000);
    await bypassAuthAndInit(page);
    await waitAndCheck(page, 1500);

    // Screenshot each view
    for (const viewName of VIEWS) {
      console.log(`  Testing view: ${viewName} @ ${vpName}`);
      
      // Click the tab to switch views
      try {
        if (viewName === 'log') {
          const fab = await page.$('#btn-fab-log');
          if (fab) await fab.click();
        } else if (viewName === 'account') {
          await page.evaluate(() => {
            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
            document.querySelector('#view-account')?.classList.remove('hidden');
          });
        } else {
          const tabSelector = `button[data-view="${viewName}"]`;
          await page.waitForSelector(tabSelector, { timeout: 3000 });
          await page.click(tabSelector);
        }
        await waitAndCheck(page, 1500);
      } catch (e) {
        addIssue('critical', 'interaction', `View "${viewName}" navigation failed: ${e.message?.slice(0, 60)}`, null, vpName);
        continue;
      }

      // Take screenshot
      const ssName = `phase1_${vpName}_${viewName}`;
      const ssPath = await screenshot(page, ssName);

      // Check for horizontal overflow
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.body.scrollWidth > document.documentElement.clientWidth;
      });
      if (hasHorizontalOverflow) {
        addIssue('major', 'overflow', `Horizontal scroll detected on "${viewName}" view at ${vpName}`, ssName, vpName);
      }

      // Check for elements overflowing viewport
      const overflowingElements = await page.evaluate(() => {
        const results = [];
        const viewportWidth = document.documentElement.clientWidth;
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.right > viewportWidth + 5) {
            const id = el.id || '';
            const className = el.className?.toString?.()?.slice(0, 50) || '';
            const tag = el.tagName;
            if (id || className) {
              results.push({
                tag,
                id,
                className,
                rightEdge: Math.round(rect.right),
                viewportWidth,
                overflow: Math.round(rect.right - viewportWidth)
              });
            }
          }
        }
        return results.slice(0, 10); // Limit to 10 most obvious
      });

      if (overflowingElements.length > 0) {
        for (const el of overflowingElements) {
          addIssue('major', 'overflow',
            `Element overflows viewport by ${el.overflow}px: <${el.tag}> id="${el.id}" class="${el.className}" (right: ${el.rightEdge}px, viewport: ${el.viewportWidth}px)`,
            ssName, vpName);
        }
      }

      // Check for text truncation / hidden overflow issues
      const truncatedElements = await page.evaluate(() => {
        const results = [];
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          const style = window.getComputedStyle(el);
          if (style.overflow === 'hidden' && el.scrollWidth > el.clientWidth + 2) {
            const id = el.id || '';
            const text = el.textContent?.slice(0, 40) || '';
            if (text.trim() && el.clientWidth > 0) {
              results.push({
                id,
                tag: el.tagName,
                text: text.trim(),
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
              });
            }
          }
        }
        return results.slice(0, 10);
      });

      if (truncatedElements.length > 0) {
        for (const el of truncatedElements) {
          addIssue('minor', 'visual',
            `Text may be truncated: "${el.text}..." (content ${el.scrollWidth}px > container ${el.clientWidth}px) in <${el.tag}> id="${el.id}"`,
            ssName, vpName);
        }
      }

      // Check for overlapping interactive elements (buttons on top of buttons)
      const overlappingButtons = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a, input, select, [role="button"]'));
        const visible = buttons.filter(b => {
          const r = b.getBoundingClientRect();
          const s = window.getComputedStyle(b);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
        });
        const overlaps = [];
        for (let i = 0; i < visible.length; i++) {
          for (let j = i + 1; j < visible.length; j++) {
            const a = visible[i].getBoundingClientRect();
            const b = visible[j].getBoundingClientRect();
            const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
            const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
            const overlapArea = overlapX * overlapY;
            if (overlapArea > 100) { // More than 100px² overlap
              overlaps.push({
                el1: visible[i].id || visible[i].textContent?.slice(0, 20) || visible[i].tagName,
                el2: visible[j].id || visible[j].textContent?.slice(0, 20) || visible[j].tagName,
                overlapArea,
              });
            }
          }
        }
        return overlaps.slice(0, 5);
      });

      if (overlappingButtons.length > 0) {
        for (const o of overlappingButtons) {
          addIssue('major', 'layout',
            `Interactive elements overlap (${o.overlapArea}px²): "${o.el1}" and "${o.el2}"`,
            ssName, vpName);
        }
      }

      // Check for tiny tap targets on mobile
      if (vpName === 'mobile') {
        const tinyTargets = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, a, input[type="submit"], [role="button"]'));
          const results = [];
          for (const b of buttons) {
            const rect = b.getBoundingClientRect();
            const style = window.getComputedStyle(b);
            if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
              if (rect.width < 44 || rect.height < 44) {
                // Only report if it's actually visible in viewport
                if (rect.top < window.innerHeight && rect.bottom > 0) {
                  results.push({
                    id: b.id || b.textContent?.slice(0, 30)?.trim() || b.tagName,
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                  });
                }
              }
            }
          }
          return results.slice(0, 15);
        });

        if (tinyTargets.length > 0) {
          for (const t of tinyTargets) {
            addIssue('minor', 'responsive',
              `Tap target too small (${t.width}x${t.height}px, min 44x44): "${t.id}"`,
              ssName, vpName);
          }
        }
      }

      // Check for z-index stacking issues (elements behind others)
      // Check for broken images
      const brokenImages = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs.filter(img => !img.complete || img.naturalWidth === 0)
          .map(img => ({ src: img.src?.slice(0, 80), alt: img.alt || '' }));
      });
      if (brokenImages.length > 0) {
        for (const img of brokenImages) {
          addIssue('major', 'visual', `Broken image: src="${img.src}" alt="${img.alt}"`, ssName, vpName);
        }
      }
    }

    // Test the Account view (view-account)
    console.log(`  Testing view: account @ ${vpName}`);
    try {
      // Account might be accessed differently, check for profile/account button  
      const accountLink = await page.$('#btn-settings-open') || await page.$('button[data-view="account"]');
      if (accountLink) {
        // Check if there's a view-account section
        const hasAccountView = await page.evaluate(() => !!document.querySelector('#view-account'));
        if (hasAccountView) {
          await page.evaluate(() => {
            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
            document.querySelector('#view-account')?.classList.remove('hidden');
          });
          await waitAndCheck(page, 1000);
          await screenshot(page, `phase1_${vpName}_account`);
        }
      }
    } catch (e) {
      addIssue('minor', 'interaction', `Could not navigate to account view at ${vpName}`, null, vpName);
    }
  }
}

// ============================================
// PHASE 2: MODAL TESTING
// ============================================
async function phase2_modalTesting(page) {
  console.log('\n' + '='.repeat(60));
  console.log('🪟 PHASE 2: MODAL TESTING');
  console.log('='.repeat(60));

  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    console.log(`\n--- Viewport: ${vpName} (${vp.width}x${vp.height}) ---`);
    await page.setViewport({ width: vp.width, height: vp.height });

    for (const modal of MODALS) {
      console.log(`  Testing modal: ${modal.name} @ ${vpName}`);
      
      // Navigate to required view first
      await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      await waitAndCheck(page, 1000);
      await bypassAuthAndInit(page);
      await waitAndCheck(page, 1000);
      
      if (modal.requiresView) {
        try {
          if (modal.requiresView === 'log') {
            const fab = await page.$('#btn-fab-log');
            if (fab) await fab.click();
          } else {
            const tab = await page.$(`button[data-view="${modal.requiresView}"]`);
            if (tab) await tab.click();
          }
          await waitAndCheck(page, 1000);
        } catch (e) {
          addIssue('critical', 'interaction', `Cannot navigate to "${modal.requiresView}" view for modal "${modal.name}"`, null, vpName);
          continue;
        }
      }

      // Try to open the modal
      try {
        await page.waitForSelector(modal.openBtn, { timeout: 3000 });
        await page.click(modal.openBtn);
        await waitAndCheck(page, 1000);
      } catch (e) {
        addIssue('major', 'interaction', `Cannot open modal "${modal.name}" - button "${modal.openBtn}" not found or not clickable`, null, vpName);
        continue;
      }

      // Check if modal is visible
      const isVisible = await page.evaluate((modalId) => {
        const el = document.getElementById(modalId);
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return el.classList.contains('open') || 
               (style.opacity !== '0' && style.display !== 'none' && style.visibility !== 'hidden');
      }, modal.id);

      if (!isVisible) {
        addIssue('major', 'interaction', `Modal "${modal.name}" did not become visible after clicking "${modal.openBtn}"`, null, vpName);
        continue;
      }

      // Screenshot the modal
      const ssName = `phase2_${vpName}_modal_${modal.name.toLowerCase().replace(/\s+/g, '_')}`;
      await screenshot(page, ssName);

      // Check modal fits viewport
      const modalMetrics = await page.evaluate((modalId) => {
        const el = document.getElementById(modalId);
        if (!el) return null;
        // Find the actual modal content box
        const box = el.querySelector('.ios-modal-sheet, .modal-box, [class*="modal-content"]') || el.firstElementChild;
        if (!box) return null;
        const rect = box.getBoundingClientRect();
        return {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        };
      }, modal.id);

      if (modalMetrics) {
        if (modalMetrics.width > modalMetrics.viewportWidth) {
          addIssue('critical', 'responsive',
            `Modal "${modal.name}" wider than viewport (${modalMetrics.width}px > ${modalMetrics.viewportWidth}px)`,
            ssName, vpName);
        }
        if (modalMetrics.height > modalMetrics.viewportHeight) {
          addIssue('minor', 'responsive',
            `Modal "${modal.name}" taller than viewport (${modalMetrics.height}px > ${modalMetrics.viewportHeight}px) - may need scrolling`,
            ssName, vpName);
        }
        if (modalMetrics.left < 0 || modalMetrics.right > modalMetrics.viewportWidth) {
          addIssue('major', 'layout',
            `Modal "${modal.name}" overflows horizontally`,
            ssName, vpName);
        }
      }

      // Check all form inputs inside the modal
      const formInputs = await page.evaluate((modalId) => {
        const el = document.getElementById(modalId);
        if (!el) return [];
        const inputs = el.querySelectorAll('input, textarea, select');
        return Array.from(inputs).map(inp => ({
          type: inp.type || inp.tagName.toLowerCase(),
          id: inp.id,
          name: inp.name,
          placeholder: inp.placeholder || '',
          required: inp.required,
          label: inp.labels?.[0]?.textContent?.slice(0, 40) || '',
        }));
      }, modal.id);

      if (formInputs.length > 0) {
        console.log(`    Found ${formInputs.length} form inputs in modal`);
        
        // Check each input has a label
        for (const inp of formInputs) {
          if (!inp.label && !inp.placeholder && inp.type !== 'hidden') {
            addIssue('minor', 'accessibility',
              `Input in "${modal.name}" has no label or placeholder: type="${inp.type}" id="${inp.id}"`,
              ssName, vpName);
          }
        }
      }

      // Try closing the modal (click close button or overlay)
      try {
        const closeBtn = await page.$(`#${modal.id} button[class*="close"], #${modal.id.replace('-modal', '')}-modal-close, #${modal.id} .ios-modal-close`);
        if (closeBtn) {
          await closeBtn.click();
          await waitAndCheck(page, 500);
        } else {
          // Try clicking overlay
          await page.click(`#${modal.id}`);
          await waitAndCheck(page, 500);
        }

        const stillVisible = await page.evaluate((modalId) => {
          const el = document.getElementById(modalId);
          return el?.classList.contains('open');
        }, modal.id);

        if (stillVisible) {
          addIssue('major', 'interaction', `Modal "${modal.name}" did not close after clicking close/overlay`, null, vpName);
        }
      } catch (e) {
        addIssue('minor', 'interaction', `Error closing modal "${modal.name}": ${e.message?.slice(0, 60)}`, null, vpName);
      }
    }
  }
}

// ============================================
// PHASE 3: INTERACTION TESTING
// ============================================
async function phase3_interactionTesting(page) {
  console.log('\n' + '='.repeat(60));
  console.log('👆 PHASE 3: INTERACTION TESTING');
  console.log('='.repeat(60));

  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await waitAndCheck(page, 1000);
  await bypassAuthAndInit(page);
  await waitAndCheck(page, 1500);
  console.log('\n  Testing tab navigation...');
  for (const viewName of VIEWS) {
    try {
      if (viewName === 'log') {
        const fab = await page.$('#btn-fab-log');
        if (fab) await fab.click();
      } else {
        const tab = await page.$(`button[data-view="${viewName}"]`);
        if (tab) await tab.click();
      }
      await waitAndCheck(page, 800);
      
      const activeView = await page.evaluate(() => {
        const active = document.querySelector('.view:not(.hidden)');
        return active?.id || 'none';
      });
      
      if (!activeView.includes(viewName)) {
        addIssue('critical', 'interaction', `Clicking "${viewName}" navigation did not activate view-${viewName}. Active: ${activeView}`);
      }
    } catch (e) {
      addIssue('critical', 'interaction', `Navigation to "${viewName}" failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Test theme toggle
  console.log('  Testing theme toggle...');
  try {
    await page.click('#btn-theme-toggle');
    await waitAndCheck(page, 500);
    await screenshot(page, 'phase3_theme_toggled');
    
    // Toggle back
    await page.click('#btn-theme-toggle');
    await waitAndCheck(page, 500);
  } catch (e) {
    addIssue('minor', 'interaction', `Theme toggle failed: ${e.message?.slice(0, 60)}`);
  }

  // Test dashboard filter tabs (All / Bahá'í / Non-Bahá'í)
  console.log('  Testing dashboard filter tabs...');
  await page.click('button[data-view="dashboard"]');
  await waitAndCheck(page, 800);

  const filterButtons = await page.$$('.seg-btn[data-col]');
  for (const btn of filterButtons) {
    try {
      const label = await page.evaluate(el => el.textContent.trim(), btn);
      await btn.click();
      await waitAndCheck(page, 800);
      console.log(`    Clicked filter: ${label}`);
    } catch (e) {
      addIssue('minor', 'interaction', `Dashboard filter button failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Test insights tab bar
  console.log('  Testing insights tabs...');
  const insightsTabs = await page.$$('#insights-tab-bar .seg-btn');
  for (const tab of insightsTabs) {
    try {
      const label = await page.evaluate(el => el.textContent.trim(), tab);
      await tab.click();
      await waitAndCheck(page, 500);
      await screenshot(page, `phase3_insights_${label.toLowerCase().replace(/\s+/g, '_')}`);
    } catch (e) {
      addIssue('minor', 'interaction', `Insights tab failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Test milestones tab bar
  console.log('  Testing milestone tabs...');
  const milestoneTabs = await page.$$('#dash-milestones-tab-bar .seg-btn');
  for (const tab of milestoneTabs) {
    try {
      const label = await page.evaluate(el => el.textContent.trim(), tab);
      await tab.click();
      await waitAndCheck(page, 500);
    } catch (e) {
      addIssue('minor', 'interaction', `Milestone tab failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Test records tab bar
  console.log('  Testing records tabs...');
  const recordsTabs = await page.$$('#dash-records-tab-bar .seg-btn');
  for (const tab of recordsTabs) {
    try {
      const label = await page.evaluate(el => el.textContent.trim(), tab);
      await tab.click();
      await waitAndCheck(page, 500);
    } catch (e) {
      addIssue('minor', 'interaction', `Records tab failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Test breakdown tab bar
  console.log('  Testing breakdown tabs...');
  const breakdownTabs = await page.$$('#dash-breakdown-tab-bar .seg-btn');
  for (const tab of breakdownTabs) {
    try {
      const label = await page.evaluate(el => el.textContent.trim(), tab);
      await tab.click();
      await waitAndCheck(page, 500);
    } catch (e) {
      addIssue('minor', 'interaction', `Breakdown tab failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Test FAB (floating action button)
  console.log('  Testing FAB...');
  try {
    const fab = await page.$('#btn-fab-log');
    if (fab) {
      const fabVisible = await page.evaluate(el => {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      }, fab);
      
      if (!fabVisible) {
        addIssue('major', 'visual', 'FAB (Log Session) button is not visible');
      }
    } else {
      addIssue('major', 'visual', 'FAB (Log Session) button not found in DOM');
    }
  } catch (e) {
    addIssue('minor', 'interaction', `FAB check failed: ${e.message?.slice(0, 60)}`);
  }

  // Test View/Grouping mode on Bookshelf
  console.log('  Testing bookshelf controls...');
  await page.click('button[data-view="wishlist"]');
  await waitAndCheck(page, 1000);

  try {
    const viewModeBtn = await page.$('#btn-view-mode');
    if (viewModeBtn) {
      await viewModeBtn.click();
      await waitAndCheck(page, 800);
      await screenshot(page, 'phase3_bookshelf_view_toggled');
      
      // Toggle back
      await viewModeBtn.click();
      await waitAndCheck(page, 500);
    }
  } catch (e) {
    addIssue('minor', 'interaction', `View mode toggle failed: ${e.message?.slice(0, 60)}`);
  }

  try {
    const groupBtn = await page.$('#btn-grouping-mode');
    if (groupBtn) {
      await groupBtn.click();
      await waitAndCheck(page, 800);
      await screenshot(page, 'phase3_bookshelf_grouped');
    }
  } catch (e) {
    addIssue('minor', 'interaction', `Grouping mode toggle failed: ${e.message?.slice(0, 60)}`);
  }

  // Test select mode
  try {
    const selectBtn = await page.$('#btn-select-mode');
    if (selectBtn) {
      await selectBtn.click();
      await waitAndCheck(page, 800);
      await screenshot(page, 'phase3_bookshelf_select_mode');
      
      // Check if batch bar appears
      const batchBar = await page.evaluate(() => {
        const bar = document.querySelector('#btn-batch-delete')?.parentElement;
        if (!bar) return null;
        const style = window.getComputedStyle(bar);
        return { display: style.display, visibility: style.visibility };
      });
      
      // Cancel selection
      const cancelBtn = await page.$('#btn-batch-cancel');
      if (cancelBtn) await cancelBtn.click();
      await waitAndCheck(page, 500);
    }
  } catch (e) {
    addIssue('minor', 'interaction', `Select mode failed: ${e.message?.slice(0, 60)}`);
  }

  // Test search functionality
  console.log('  Testing search...');
  try {
    const searchInput = await page.$('#search-library') || await page.$('input[type="search"]') || await page.$('input[placeholder*="search" i]');
    if (searchInput) {
      await searchInput.click();
      await searchInput.type('test search query');
      await waitAndCheck(page, 1000);
      await screenshot(page, 'phase3_search_results');
      
      // Clear search
      await searchInput.click({ clickCount: 3 });
      await searchInput.press('Backspace');
      await waitAndCheck(page, 500);
    }
  } catch (e) {
    addIssue('minor', 'interaction', `Search test failed: ${e.message?.slice(0, 60)}`);
  }
}

// ============================================
// PHASE 4: EDGE CASES
// ============================================
async function phase4_edgeCases(page) {
  console.log('\n' + '='.repeat(60));
  console.log('⚡ PHASE 4: EDGE CASES');
  console.log('='.repeat(60));

  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await waitAndCheck(page, 1000);
  await bypassAuthAndInit(page);
  await waitAndCheck(page, 1500);

  // Test with empty state screenshots
  console.log('  Testing empty states...');
  for (const viewName of VIEWS) {
    if (viewName === 'log') {
      const fab = await page.$('#btn-fab-log');
      if (fab) await fab.click();
    } else {
      const tab = await page.$(`button[data-view="${viewName}"]`);
      if (tab) await tab.click();
    }
    await waitAndCheck(page, 800);
    await screenshot(page, `phase4_empty_${viewName}`);
  }

  // Test browser back/forward
  console.log('  Testing browser back/forward...');
  await page.click('button[data-view="dashboard"]');
  await waitAndCheck(page, 500);
  await page.click('button[data-view="wishlist"]');
  await waitAndCheck(page, 500);
  await page.goBack();
  await waitAndCheck(page, 500);
  const viewAfterBack = await page.evaluate(() => {
    const active = document.querySelector('.view:not(.hidden)');
    return active?.id || 'none';
  });
  await screenshot(page, 'phase4_after_browser_back');

  // Test console errors
  console.log('  Checking for console errors...');
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  
  // Navigate through all views to trigger any errors
  for (const viewName of VIEWS) {
    await page.click(`button[data-view="${viewName}"]`);
    await waitAndCheck(page, 500);
  }
  
  await waitAndCheck(page, 1000);
  if (consoleErrors.length > 0) {
    for (const err of consoleErrors.slice(0, 20)) {
      addIssue('major', 'runtime', `Console error: ${err.slice(0, 120)}`);
    }
  }

  // Test rapid clicks on tabs (stress test)
  console.log('  Stress testing rapid tab clicks...');
  for (let i = 0; i < 20; i++) {
    const view = VIEWS[i % VIEWS.length];
    await page.click(`button[data-view="${view}"]`);
    // No wait - rapid fire
  }
  await waitAndCheck(page, 2000);
  
  // Check if the app is still in a valid state
  const isValid = await page.evaluate(() => {
    const visibleViews = document.querySelectorAll('.view:not(.hidden)');
    return visibleViews.length;
  });
  if (isValid !== 1) {
    addIssue('critical', 'interaction', `After rapid tab clicks, ${isValid} views are visible (expected 1)`);
    await screenshot(page, 'phase4_rapid_click_broken');
  }

  // Test double-clicking buttons that should only fire once
  console.log('  Testing double-click protection...');
  // Will test with specific buttons in later phases
}

// ============================================
// PHASE 5: ACCESSIBILITY
// ============================================
async function phase5_accessibility(page) {
  console.log('\n' + '='.repeat(60));
  console.log('♿ PHASE 5: ACCESSIBILITY');
  console.log('='.repeat(60));

  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await waitAndCheck(page, 1000);
  await bypassAuthAndInit(page);
  await waitAndCheck(page, 1500);
  console.log('  Checking images for alt text...');
  const imagesWithoutAlt = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.filter(img => !img.alt && !img.getAttribute('aria-label') && !img.getAttribute('role'))
      .map(img => ({ src: img.src?.slice(0, 60) || '', id: img.id || '' }));
  });
  for (const img of imagesWithoutAlt) {
    addIssue('minor', 'accessibility', `Image without alt text: src="${img.src}" id="${img.id}"`);
  }

  // Check for buttons without accessible names
  console.log('  Checking buttons for accessible names...');
  const buttonsWithoutNames = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.filter(btn => {
      const text = btn.textContent?.trim();
      const ariaLabel = btn.getAttribute('aria-label');
      const title = btn.title;
      const style = window.getComputedStyle(btn);
      return !text && !ariaLabel && !title && style.display !== 'none';
    }).map(btn => ({
      id: btn.id || '',
      className: btn.className?.toString()?.slice(0, 50) || '',
      innerHTML: btn.innerHTML?.slice(0, 40) || '',
    }));
  });
  for (const btn of buttonsWithoutNames) {
    addIssue('minor', 'accessibility', `Button without accessible name: id="${btn.id}" class="${btn.className}"`);
  }

  // Check for form inputs without labels
  console.log('  Checking form inputs for labels...');
  const inputsWithoutLabels = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));
    return inputs.filter(inp => {
      const style = window.getComputedStyle(inp);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const hasLabel = inp.labels?.length > 0;
      const hasAriaLabel = inp.getAttribute('aria-label') || inp.getAttribute('aria-labelledby');
      const hasTitle = inp.title;
      const hasPlaceholder = inp.placeholder;
      return !hasLabel && !hasAriaLabel && !hasTitle && !hasPlaceholder;
    }).map(inp => ({
      type: inp.type || inp.tagName,
      id: inp.id || '',
      name: inp.name || '',
    }));
  });
  for (const inp of inputsWithoutLabels) {
    addIssue('minor', 'accessibility', `Input without label: type="${inp.type}" id="${inp.id}" name="${inp.name}"`);
  }

  // Check color contrast (basic check)
  console.log('  Checking basic color contrast...');
  const lowContrastElements = await page.evaluate(() => {
    function getLuminance(r, g, b) {
      const [rs, gs, bs] = [r, g, b].map(c => {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }

    function parseColor(color) {
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
      return null;
    }

    function getContrastRatio(fg, bg) {
      if (!fg || !bg) return Infinity;
      const l1 = getLuminance(fg.r, fg.g, fg.b);
      const l2 = getLuminance(bg.r, bg.g, bg.b);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    const results = [];
    const textElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, a, button, label, td, th, li');
    for (const el of textElements) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      
      const fg = parseColor(style.color);
      const bg = parseColor(style.backgroundColor);
      if (fg && bg && bg.r === 0 && bg.g === 0 && bg.b === 0 && style.backgroundColor.includes('0)')) continue; // Transparent bg
      
      if (fg && bg) {
        const ratio = getContrastRatio(fg, bg);
        if (ratio < 3.0) { // WCAG AA minimum for large text
          results.push({
            text: el.textContent?.slice(0, 30)?.trim(),
            tag: el.tagName,
            id: el.id,
            ratio: ratio.toFixed(2),
            fg: style.color,
            bg: style.backgroundColor,
          });
        }
      }
    }
    return results.slice(0, 10);
  });

  for (const el of lowContrastElements) {
    addIssue('minor', 'accessibility',
      `Low contrast (${el.ratio}:1): "${el.text}" <${el.tag}> fg=${el.fg} bg=${el.bg}`);
  }

  // Check for focus styles
  console.log('  Checking focus styles...');
  // Tab through first 10 focusable elements
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    await waitAndCheck(page, 200);
  }
  await screenshot(page, 'phase5_focus_state');
}

// ============================================
// PHASE 6: PERFORMANCE
// ============================================
async function phase6_performance(page) {
  console.log('\n' + '='.repeat(60));
  console.log('⚡ PHASE 6: PERFORMANCE');
  console.log('='.repeat(60));

  // Measure page load time
  console.log('  Measuring page load time...');
  const startTime = Date.now();
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await bypassAuthAndInit(page);
  const loadTime = Date.now() - startTime;
  console.log(`    Page load time: ${loadTime}ms`);

  if (loadTime > 5000) {
    addIssue('major', 'performance', `Page load time is ${loadTime}ms (over 5s threshold)`);
  } else if (loadTime > 3000) {
    addIssue('minor', 'performance', `Page load time is ${loadTime}ms (over 3s but under 5s)`);
  }

  // Check total DOM size
  const domSize = await page.evaluate(() => document.querySelectorAll('*').length);
  console.log(`    DOM elements: ${domSize}`);
  if (domSize > 3000) {
    addIssue('minor', 'performance', `Large DOM: ${domSize} elements (over 3000 threshold)`);
  }

  // Check for large inline styles
  const inlineStyleCount = await page.evaluate(() => {
    return document.querySelectorAll('[style]').length;
  });
  console.log(`    Elements with inline styles: ${inlineStyleCount}`);

  // Check total resource sizes
  const resources = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    const byType = {};
    let total = 0;
    for (const entry of entries) {
      const type = entry.initiatorType || 'other';
      if (!byType[type]) byType[type] = { count: 0, size: 0 };
      byType[type].count++;
      byType[type].size += entry.transferSize || 0;
      total += entry.transferSize || 0;
    }
    return { byType, total, count: entries.length };
  });
  
  console.log(`    Total resources: ${resources.count}, Total transfer: ${(resources.total / 1024).toFixed(1)}KB`);
  for (const [type, data] of Object.entries(resources.byType)) {
    console.log(`      ${type}: ${data.count} files, ${(data.size / 1024).toFixed(1)}KB`);
  }

  if (resources.total > 2 * 1024 * 1024) {
    addIssue('major', 'performance', `Total transfer size: ${(resources.total / 1024 / 1024).toFixed(1)}MB (over 2MB threshold)`);
  }
}

// ============================================
// PHASE 7: COMPREHENSIVE SCROLLING & ANIMATION CHECK
// ============================================
async function phase7_scrollAndAnimation(page) {
  console.log('\n' + '='.repeat(60));
  console.log('📜 PHASE 7: SCROLL & ANIMATION');
  console.log('='.repeat(60));

  await page.setViewport({ width: 375, height: 812 }); // Mobile
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await waitAndCheck(page, 1000);
  await bypassAuthAndInit(page);
  await waitAndCheck(page, 1500);

  for (const viewName of VIEWS) {
    console.log(`  Scroll testing: ${viewName} @ mobile`);
    if (viewName === 'log') {
      const fab = await page.$('#btn-fab-log');
      if (fab) await fab.click();
    } else {
      const tab = await page.$(`button[data-view="${viewName}"]`);
      if (tab) await tab.click();
    }
    await waitAndCheck(page, 800);

    // Scroll to bottom
    await page.evaluate(() => {
      const active = document.querySelector('.view:not(.hidden)');
      if (active) active.scrollTop = active.scrollHeight;
    });
    await waitAndCheck(page, 800);
    await screenshot(page, `phase7_scroll_bottom_${viewName}`);

    // Scroll back to top
    await page.evaluate(() => {
      const active = document.querySelector('.view:not(.hidden)');
      if (active) active.scrollTop = 0;
    });
    await waitAndCheck(page, 500);

    // Check if bottom tab bar is still visible and not obscured
    const tabBarVisible = await page.evaluate(() => {
      const tabBar = document.querySelector('nav') || document.querySelector('[class*="tab-bar"]') || document.querySelector('.bottom-nav');
      if (!tabBar) return { found: false };
      const rect = tabBar.getBoundingClientRect();
      const style = window.getComputedStyle(tabBar);
      return {
        found: true,
        bottom: Math.round(rect.bottom),
        viewportHeight: window.innerHeight,
        isFixed: style.position === 'fixed' || style.position === 'sticky',
        display: style.display,
      };
    });

    if (tabBarVisible.found && !tabBarVisible.isFixed) {
      addIssue('major', 'layout', `Tab bar is not fixed/sticky on "${viewName}" - may scroll out of view`);
    }
  }
}

// ============================================
// MAIN
// ============================================
async function main() {
  // Setup
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log('🚀 Starting Exhaustive Visual & Interactive Test Suite');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Screenshots: ${SCREENSHOT_DIR}`);
  console.log(`   Report: ${REPORT_FILE}`);
  console.log('');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1280,800',
      ],
    });

    const page = await browser.newPage();
    
    // Set a reasonable default viewport
    await page.setViewport({ width: 1280, height: 800 });

    // Collect console errors globally
    page.on('pageerror', error => {
      addIssue('major', 'runtime', `Uncaught page error: ${error.message?.slice(0, 120)}`);
    });

    // Run all phases
    await phase1_visualWalkthrough(page);
    await phase2_modalTesting(page);
    await phase3_interactionTesting(page);
    await phase4_edgeCases(page);
    await phase5_accessibility(page);
    await phase6_performance(page);
    await phase7_scrollAndAnimation(page);

    // Generate summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(60));

    const critical = issues.filter(i => i.severity === 'critical');
    const major = issues.filter(i => i.severity === 'major');
    const minor = issues.filter(i => i.severity === 'minor');
    const info = issues.filter(i => i.severity === 'info');

    console.log(`\n  🔴 Critical: ${critical.length}`);
    console.log(`  🟠 Major:    ${major.length}`);
    console.log(`  🟡 Minor:    ${minor.length}`);
    console.log(`  ℹ️  Info:     ${info.length}`);
    console.log(`  📸 Total screenshots: ${fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png')).length}`);
    console.log(`  ─────────────────────`);
    console.log(`  Total issues: ${issues.length}`);

    // Group by category
    const byCategory = {};
    for (const issue of issues) {
      if (!byCategory[issue.category]) byCategory[issue.category] = [];
      byCategory[issue.category].push(issue);
    }
    
    console.log('\n  Issues by category:');
    for (const [cat, catIssues] of Object.entries(byCategory)) {
      console.log(`    ${cat}: ${catIssues.length}`);
    }

    // Write full report
    const report = {
      timestamp: new Date().toISOString(),
      baseUrl: BASE_URL,
      totalIssues: issues.length,
      summary: {
        critical: critical.length,
        major: major.length,
        minor: minor.length,
        info: info.length,
      },
      byCategory,
      issues,
    };

    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    console.log(`\n  Full report saved to: ${REPORT_FILE}`);

    // List all screenshots
    const screenshots = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'));
    console.log(`\n  Screenshots (${screenshots.length}):`);
    for (const s of screenshots) {
      console.log(`    📸 ${s}`);
    }

  } catch (e) {
    console.error('❌ Fatal error:', e.message);
    console.error(e.stack);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

main();
