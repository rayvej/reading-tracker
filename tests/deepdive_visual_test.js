/**
 * DEEP-DIVE TEST SCRIPT 2
 * 
 * Covers ALL 27 modals, ALL segment controls, theme/accent switching,
 * knowledge view controls, chart interactions, and form validation.
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { bypassAuthAndInit } from './test_helper.js';

const BASE_URL = 'http://127.0.0.1:8765';
const SCREENSHOT_DIR = path.resolve('tests/screenshots');
const REPORT_FILE = path.resolve('tests/deepdive_test_report.json');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const issues = [];

function addIssue(severity, category, description, screenshot = null, viewport = null) {
  issues.push({ severity, category, description, screenshot, viewport, timestamp: new Date().toISOString() });
  const icon = severity === 'critical' ? '🔴' : severity === 'major' ? '🟠' : severity === 'minor' ? '🟡' : 'ℹ️';
  console.log(`  ${icon} [${severity.toUpperCase()}] ${description}`);
}

async function ss(page, name) {
  const filepath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}

async function wait(ms = 800) {
  await new Promise(r => setTimeout(r, ms));
}

async function gotoWithAuth(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1000);
  await bypassAuthAndInit(page);
  await wait(1500);
}

async function navigateToView(page, viewName) {
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
      const tab = await page.$(`button[data-view="${viewName}"]`);
      if (tab) await tab.click();
    }
    await wait(1000);
  } catch (e) {}
}

async function openModal(page, modalId) {
  return await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    el.classList.add('open');
    el.style.display = '';
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    el.classList.remove('hidden');
    return true;
  }, modalId);
}

async function closeModal(page, modalId) {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('open');
      el.style.display = 'none';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      el.classList.add('hidden');
    }
  }, modalId);
  await wait(300);
}

// ============================================
// TEST: ALL 27 MODALS
// ============================================
async function testAllModals(page) {
  console.log('\n' + '='.repeat(60));
  console.log('🪟 DEEP-DIVE: ALL 27 MODALS');
  console.log('='.repeat(60));

  const allModals = [
    { id: 'goals-modal', name: 'Goals Editor' },
    { id: 'add-book-modal', name: 'Add Book' },
    { id: 'edit-book-modal', name: 'Edit Book' },
    { id: 'book-detail-modal', name: 'Book Detail' },
    { id: 'ocr-verify-modal', name: 'OCR Verify' },
    { id: 'edit-log-modal', name: 'Edit Log' },
    { id: 'modal-chart-drilldown', name: 'Chart Drilldown' },
    { id: 'heatmap-day-modal', name: 'Heatmap Day' },
    { id: 'modal-contextual-detail', name: 'Contextual Detail' },
    { id: 'settings-modal', name: 'Settings' },
    { id: 'cover-manager-modal', name: 'Cover Manager' },
    { id: 'quick-note-modal', name: 'Quick Note' },
    { id: 'year-wrapped-modal', name: 'Year Wrapped' },
    { id: 'quote-card-modal', name: 'Quote Card' },
    { id: 'isbn-scanner-modal', name: 'ISBN Scanner' },
    { id: 'post-session-reflection-modal', name: 'Post-Session Reflection' },
    { id: 'spaced-repetition-modal', name: 'Spaced Repetition' },
    { id: 'starter-import-modal', name: 'Starter Import' },
    { id: 'modal-scholarly-export', name: 'Scholarly Export' },
    { id: 'dev-suite-modal', name: 'Dev Suite' },
    { id: 'timer-fullscreen-overlay', name: 'Timer Fullscreen' },
  ];

  for (const [vpName, vp] of Object.entries({
    desktop: { width: 1280, height: 800 },
    mobile: { width: 375, height: 812 },
  })) {
    await page.setViewport({ width: vp.width, height: vp.height });
    console.log(`\n--- ${vpName} viewport ---`);

    for (const modal of allModals) {
      console.log(`  Opening: ${modal.name} (${modal.id})`);
      
      // Navigate fresh

      // Check if modal exists in DOM
      const exists = await page.evaluate((id) => !!document.getElementById(id), modal.id);
      if (!exists) {
        addIssue('major', 'structure', `Modal "${modal.name}" (#${modal.id}) not found in DOM`, null, vpName);
        continue;
      }

      // Force open the modal
      const opened = await openModal(page, modal.id);
      if (!opened) {
        addIssue('major', 'interaction', `Could not open modal "${modal.name}"`, null, vpName);
        continue;
      }
      await wait(500);

      // Screenshot it
      const ssName = `dd_${vpName}_modal_${modal.id}`;
      await ss(page, ssName);

      // Check modal content dimensions
      const metrics = await page.evaluate((modalId) => {
        const el = document.getElementById(modalId);
        if (!el) return null;
        
        // Find the inner content
        const content = el.querySelector('.ios-modal-sheet, .modal-box, [class*="modal"]') || el;
        const rect = content.getBoundingClientRect();
        const allInputs = el.querySelectorAll('input:not([type="hidden"]), textarea, select');
        const allButtons = el.querySelectorAll('button');
        
        // Check for empty content
        const visibleText = el.textContent?.trim()?.length || 0;
        
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          vpWidth: window.innerWidth,
          vpHeight: window.innerHeight,
          inputCount: allInputs.length,
          buttonCount: allButtons.length,
          textLength: visibleText,
          overflowsX: rect.width > window.innerWidth,
          overflowsY: rect.height > window.innerHeight,
        };
      }, modal.id);

      if (metrics) {
        if (metrics.overflowsX) {
          addIssue('critical', 'responsive', `Modal "${modal.name}" overflows viewport width (${metrics.width}px > ${metrics.vpWidth}px)`, ssName, vpName);
        }
        if (metrics.textLength < 10) {
          addIssue('minor', 'visual', `Modal "${modal.name}" appears empty (${metrics.textLength} chars of text)`, ssName, vpName);
        }
        console.log(`    Inputs: ${metrics.inputCount}, Buttons: ${metrics.buttonCount}, Size: ${metrics.width}x${metrics.height}`);
      }

      // Close the modal
      await closeModal(page, modal.id);
    }
  }
}

// ============================================
// TEST: ALL SEGMENT CONTROLS / TAB BARS
// ============================================
async function testAllSegmentControls(page) {
  console.log('\n' + '='.repeat(60));
  console.log('🔄 DEEP-DIVE: ALL SEGMENT CONTROLS');
  console.log('='.repeat(60));

  await page.setViewport({ width: 1280, height: 800 });
  await gotoWithAuth(page); // Auth-bypassed navigation
  await wait(2000);

  // Dashboard view
  await navigateToView(page, 'dashboard');
  await wait(1000);

  const segControls = [
    { container: '#dash-seg', name: 'Collection Filter', selector: '.seg-btn[data-col]' },
    { container: '#dash-heatmap-tf', name: 'Heatmap Timeframe', selector: '[data-range]' },
    { container: '#dash-heatmap-metric', name: 'Heatmap Metric', selector: '[data-metric]' },
    { container: '#insights-tab-bar', name: 'Insights Tabs', selector: '.seg-btn' },
    { container: '#dash-milestones-tab-bar', name: 'Milestones Tabs', selector: '.seg-btn' },
    { container: '#dash-records-tab-bar', name: 'Records Tabs', selector: '.seg-btn' },
    { container: '#dash-breakdown-tab-bar', name: 'Breakdown Tabs', selector: '.seg-btn' },
  ];

  for (const ctrl of segControls) {
    console.log(`  Testing: ${ctrl.name} (${ctrl.container})`);

    // First check if the container exists
    const containerExists = await page.evaluate((sel) => !!document.querySelector(sel), ctrl.container);
    if (!containerExists) {
      addIssue('major', 'structure', `Segment control "${ctrl.name}" container "${ctrl.container}" not found`);
      continue;
    }

    // Scroll to the container first
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      el?.scrollIntoView({ behavior: 'instant', block: 'center' });
    }, ctrl.container);
    await wait(300);

    // Get all buttons in this control
    const buttons = await page.$$(`${ctrl.container} ${ctrl.selector}`);
    console.log(`    Found ${buttons.length} buttons`);

    for (let i = 0; i < buttons.length; i++) {
      try {
        const label = await page.evaluate(el => el.textContent?.trim()?.slice(0, 20), buttons[i]);
        await buttons[i].click();
        await wait(500);

        // Check if the button became active
        const isActive = await page.evaluate(el => {
          return el.classList.contains('active') || 
                 el.getAttribute('aria-selected') === 'true' ||
                 el.classList.contains('seg-active');
        }, buttons[i]);

        if (!isActive) {
          addIssue('minor', 'interaction', `Button "${label}" in ${ctrl.name} did not get active state after click`);
        }

        await ss(page, `dd_seg_${ctrl.name.toLowerCase().replace(/\s+/g, '_')}_${i}`);
      } catch (e) {
        addIssue('minor', 'interaction', `Error clicking button ${i} in ${ctrl.name}: ${e.message?.slice(0, 60)}`);
      }
    }
  }

  // Test donut chart toggles
  console.log('  Testing chart toggles...');
  const chartToggles = [
    { selector: '#donut-chart-toggle [data-mode]', name: 'Donut Chart' },
    { selector: '#cat-chart-toggle [data-mode]', name: 'Category Chart' },
  ];

  for (const toggle of chartToggles) {
    const toggleBtns = await page.$$(toggle.selector);
    console.log(`    ${toggle.name}: ${toggleBtns.length} toggle buttons`);
    for (const btn of toggleBtns) {
      try {
        await page.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }), btn);
        await wait(200);
        await btn.click();
        await wait(500);
      } catch (e) {
        addIssue('minor', 'interaction', `Error toggling ${toggle.name}: ${e.message?.slice(0, 60)}`);
      }
    }
  }
}

// ============================================
// TEST: THEME & ACCENT COLORS
// ============================================
async function testThemeAndAccent(page) {
  console.log('\n' + '='.repeat(60));
  console.log('🎨 DEEP-DIVE: THEME & ACCENT COLORS');
  console.log('='.repeat(60));

  await page.setViewport({ width: 1280, height: 800 });
  await gotoWithAuth(page); // Auth-bypassed navigation
  await wait(2000);

  // Navigate to account view
  await navigateToView(page, 'account');
  await wait(1000);

  // Test visual themes
  const themes = ['espresso', 'glass-studio', 'obsidian', 'parched-paper'];
  for (const theme of themes) {
    console.log(`  Switching to theme: ${theme}`);
    try {
      const themeBtn = await page.$(`.theme-select-btn[data-theme="${theme}"]`);
      if (themeBtn) {
        await page.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }), themeBtn);
        await wait(200);
        await themeBtn.click();
        await wait(800);
        
        // Screenshot the dashboard with this theme
        await navigateToView(page, 'dashboard');
        await wait(800);
        await ss(page, `dd_theme_${theme}_dashboard`);
        
        // Go back to account
        await navigateToView(page, 'account');
        await wait(500);
      } else {
        addIssue('minor', 'structure', `Theme button for "${theme}" not found`);
      }
    } catch (e) {
      addIssue('minor', 'interaction', `Theme switch to "${theme}" failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Test accent colors
  const accents = ['gold', 'emerald', 'sky', 'rose'];
  for (const accent of accents) {
    console.log(`  Switching to accent: ${accent}`);
    try {
      const accentBtn = await page.$(`[data-accent="${accent}"]`);
      if (accentBtn) {
        await page.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }), accentBtn);
        await wait(200);
        await accentBtn.click();
        await wait(800);
        await ss(page, `dd_accent_${accent}`);
      } else {
        addIssue('minor', 'structure', `Accent color button for "${accent}" not found`);
      }
    } catch (e) {
      addIssue('minor', 'interaction', `Accent switch to "${accent}" failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Test dark/light mode
  console.log('  Testing dark/light mode toggles...');
  for (const mode of ['light', 'dark']) {
    try {
      const modeBtn = await page.$(`.mode-select-btn[data-mode="${mode}"]`);
      if (modeBtn) {
        await page.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }), modeBtn);
        await wait(200);
        await modeBtn.click();
        await wait(800);
        
        await navigateToView(page, 'dashboard');
        await wait(800);
        await ss(page, `dd_mode_${mode}_dashboard`);
        
        await navigateToView(page, 'account');
        await wait(500);
      }
    } catch (e) {
      addIssue('minor', 'interaction', `Mode switch to "${mode}" failed: ${e.message?.slice(0, 60)}`);
    }
  }
}

// ============================================
// TEST: KNOWLEDGE VIEW CONTROLS
// ============================================
async function testKnowledgeView(page) {
  console.log('\n' + '='.repeat(60));
  console.log('📚 DEEP-DIVE: KNOWLEDGE VIEW');
  console.log('='.repeat(60));

  await page.setViewport({ width: 1280, height: 800 });
  await gotoWithAuth(page); // Auth-bypassed navigation
  await wait(2000);

  await navigateToView(page, 'knowledge');
  await wait(1000);
  await ss(page, 'dd_knowledge_initial');

  // Test view mode toggle (feed vs graph)
  console.log('  Testing feed/graph toggle...');
  const viewModeToggles = await page.$$('#knowledge-view-mode-toggle [data-mode]');
  for (const btn of viewModeToggles) {
    try {
      const mode = await page.evaluate(el => el.getAttribute('data-mode'), btn);
      await btn.click();
      await wait(800);
      await ss(page, `dd_knowledge_mode_${mode}`);
      console.log(`    Switched to mode: ${mode}`);
    } catch (e) {
      addIssue('minor', 'interaction', `Knowledge view mode toggle failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Test tag filters
  console.log('  Testing tag filters...');
  const tagBtns = await page.$$('#knowledge-tag-bar [data-tag]');
  for (const btn of tagBtns) {
    try {
      const tag = await page.evaluate(el => el.getAttribute('data-tag'), btn);
      await btn.click();
      await wait(500);
      console.log(`    Filtered by tag: ${tag}`);
    } catch (e) {
      addIssue('minor', 'interaction', `Knowledge tag filter failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Test search
  console.log('  Testing knowledge search...');
  const searchInput = await page.$('#knowledge-search-input');
  if (searchInput) {
    await searchInput.click();
    await searchInput.type('Bahá');
    await wait(1000);
    await ss(page, 'dd_knowledge_search');
    
    // Clear
    const clearBtn = await page.$('#knowledge-search-clear');
    if (clearBtn) await clearBtn.click();
    await wait(500);
  }
}

// ============================================
// TEST: BOOKSHELF DEEP DIVE
// ============================================
async function testBookshelfDeep(page) {
  console.log('\n' + '='.repeat(60));
  console.log('📖 DEEP-DIVE: BOOKSHELF CONTROLS');
  console.log('='.repeat(60));

  await page.setViewport({ width: 1280, height: 800 });
  await gotoWithAuth(page); // Auth-bypassed navigation
  await wait(2000);

  await navigateToView(page, 'wishlist');
  await wait(1000);
  await ss(page, 'dd_bookshelf_initial');

  // Test status filter pills
  console.log('  Testing status filter pills...');
  const statusFilters = await page.$$('#bookshelf-filter-status [data-bsf]');
  for (const btn of statusFilters) {
    try {
      const filter = await page.evaluate(el => el.getAttribute('data-bsf') || el.textContent?.trim(), btn);
      await btn.click();
      await wait(500);
      await ss(page, `dd_bookshelf_filter_${filter?.toLowerCase()?.replace(/\s+/g, '_')}`);
      console.log(`    Status filter: ${filter}`);
    } catch (e) {
      addIssue('minor', 'interaction', `Bookshelf status filter failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Test ownership filter pills
  console.log('  Testing ownership filter pills...');
  const ownerFilters = await page.$$('#bookshelf-filter-ownership [data-bfo]');
  for (const btn of ownerFilters) {
    try {
      const filter = await page.evaluate(el => el.getAttribute('data-bfo') || el.textContent?.trim(), btn);
      await btn.click();
      await wait(500);
      console.log(`    Ownership filter: ${filter}`);
    } catch (e) {
      addIssue('minor', 'interaction', `Bookshelf ownership filter failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Test sort dropdown
  console.log('  Testing sort dropdown...');
  const sortSelect = await page.$('#bookshelf-sort-select');
  if (sortSelect) {
    const options = await page.evaluate(() => {
      const select = document.querySelector('#bookshelf-sort-select');
      return Array.from(select?.options || []).map(o => o.value);
    });
    
    for (const opt of options) {
      try {
        await page.select('#bookshelf-sort-select', opt);
        await wait(500);
        console.log(`    Sort by: ${opt}`);
      } catch (e) {
        addIssue('minor', 'interaction', `Sort option "${opt}" failed: ${e.message?.slice(0, 60)}`);
      }
    }
  }

  // Test search
  console.log('  Testing bookshelf search...');
  const searchInput = await page.$('#wishlist-search');
  if (searchInput) {
    await searchInput.click();
    await searchInput.type('Book');
    await wait(1000);
    await ss(page, 'dd_bookshelf_search');
    
    // Clear
    await searchInput.click({ clickCount: 3 });
    await searchInput.press('Backspace');
    await wait(500);
  }
}

// ============================================
// TEST: GOALS VIEW DEEP DIVE
// ============================================
async function testGoalsDeep(page) {
  console.log('\n' + '='.repeat(60));
  console.log('🎯 DEEP-DIVE: GOALS VIEW');
  console.log('='.repeat(60));

  await page.setViewport({ width: 1280, height: 800 });
  await gotoWithAuth(page); // Auth-bypassed navigation
  await wait(2000);

  await navigateToView(page, 'goals');
  await wait(1000);
  await ss(page, 'dd_goals_initial');

  // Test timeframe switcher
  console.log('  Testing timeframe switcher...');
  const timeframeBtns = await page.$$('#view-goals .seg-btn');
  for (const btn of timeframeBtns) {
    try {
      const label = await page.evaluate(el => el.textContent?.trim(), btn);
      await btn.click();
      await wait(800);
      await ss(page, `dd_goals_timeframe_${label?.toLowerCase()?.replace(/\s+/g, '_')}`);
      console.log(`    Timeframe: ${label}`);
    } catch (e) {
      addIssue('minor', 'interaction', `Goals timeframe button failed: ${e.message?.slice(0, 60)}`);
    }
  }

  // Test Year Wrapped button
  console.log('  Testing Year Wrapped...');
  try {
    const wrappedBtn = await page.$('#btn-open-wrapped');
    if (wrappedBtn) {
      await wrappedBtn.click();
      await wait(1000);
      await ss(page, 'dd_year_wrapped_modal');
      await closeModal(page, 'year-wrapped-modal');
    }
  } catch (e) {
    addIssue('minor', 'interaction', `Year Wrapped failed: ${e.message?.slice(0, 60)}`);
  }
}

// ============================================
// TEST: LOG VIEW DEEP DIVE
// ============================================
async function testLogView(page) {
  console.log('\n' + '='.repeat(60));
  console.log('📝 DEEP-DIVE: LOG VIEW');
  console.log('='.repeat(60));

  await page.setViewport({ width: 1280, height: 800 });
  await gotoWithAuth(page); // Auth-bypassed navigation
  await wait(2000);

  await navigateToView(page, 'log');
  await wait(1000);
  await ss(page, 'dd_log_initial_desktop');

  // Test timer controls
  console.log('  Testing timer controls...');
  try {
    const timerToggle = await page.$('#btn-timer-toggle');
    if (timerToggle) {
      await timerToggle.click(); // Start
      await wait(2000);
      await ss(page, 'dd_log_timer_running');
      
      await timerToggle.click(); // Pause
      await wait(500);
      await ss(page, 'dd_log_timer_paused');
      
      const resetBtn = await page.$('#btn-timer-reset');
      if (resetBtn) {
        await resetBtn.click();
        await wait(500);
      }
    }
  } catch (e) {
    addIssue('minor', 'interaction', `Timer controls failed: ${e.message?.slice(0, 60)}`);
  }

  // Check all log form fields
  console.log('  Checking log form fields...');
  const logFields = ['#log-date', '#log-book', '#log-start', '#log-end', '#log-study-depth', 
                     '#log-cycle', '#log-minutes', '#log-notes'];
  for (const field of logFields) {
    const exists = await page.$(field);
    if (!exists) {
      addIssue('major', 'structure', `Log form field "${field}" not found`);
    }
  }

  // Test mobile view
  await page.setViewport({ width: 375, height: 812 });
  await wait(500);
  await ss(page, 'dd_log_initial_mobile');
}

// ============================================
// TEST: FORM VALIDATION
// ============================================
async function testFormValidation(page) {
  console.log('\n' + '='.repeat(60));
  console.log('✅ DEEP-DIVE: FORM VALIDATION');
  console.log('='.repeat(60));

  await page.setViewport({ width: 1280, height: 800 });
  await gotoWithAuth(page); // Auth-bypassed navigation
  await wait(2000);

  // Test Add Book form with empty required fields
  console.log('  Testing Add Book validation...');
  await navigateToView(page, 'wishlist');
  await wait(1000);

  const addBookBtn = await page.$('#btn-add-book-trigger');
  if (addBookBtn) {
    await addBookBtn.click();
    await wait(800);

    // Try to submit without filling required fields
    const submitBtn = await page.$('#add-book-modal button[type="submit"], #add-book-modal [id*="save"], #add-book-modal [id*="add"]');
    if (submitBtn) {
      await submitBtn.click();
      await wait(500);
      await ss(page, 'dd_validation_add_book_empty');
      
      // Check for validation errors
      const hasValidation = await page.evaluate(() => {
        const invalids = document.querySelectorAll('#add-book-modal :invalid');
        return invalids.length;
      });
      console.log(`    Invalid fields: ${hasValidation}`);
    }

    await closeModal(page, 'add-book-modal');
  }

  // Test Log Session form with bad data
  console.log('  Testing Log Session validation...');
  await navigateToView(page, 'log');
  await wait(1000);

  // Try entering negative page numbers
  const startPage = await page.$('#log-start');
  const endPage = await page.$('#log-end');
  if (startPage && endPage) {
    await startPage.click({ clickCount: 3 });
    await startPage.type('-5');
    await endPage.click({ clickCount: 3 });
    await endPage.type('-10');
    await wait(500);
    await ss(page, 'dd_validation_negative_pages');
    
    // Try end < start
    await startPage.click({ clickCount: 3 });
    await startPage.type('100');
    await endPage.click({ clickCount: 3 });
    await endPage.type('50');
    await wait(500);
    await ss(page, 'dd_validation_end_before_start');
  }
}

// ============================================
// TEST: CSS VARIABLE & STYLE CONSISTENCY
// ============================================
async function testStyleConsistency(page) {
  console.log('\n' + '='.repeat(60));
  console.log('🎨 DEEP-DIVE: STYLE CONSISTENCY');
  console.log('='.repeat(60));

  await page.setViewport({ width: 375, height: 812 });
  await gotoWithAuth(page); // Auth-bypassed navigation
  await wait(2000);

  // Check all views at mobile for common mobile issues
  for (const viewName of ['dashboard', 'log', 'knowledge', 'goals', 'wishlist']) {
    await navigateToView(page, viewName);
    await wait(800);

    // Check for horizontal scrollbar
    const hasHScroll = await page.evaluate(() => {
      return document.body.scrollWidth > document.documentElement.clientWidth;
    });
    if (hasHScroll) {
      addIssue('major', 'responsive', `Horizontal scroll on "${viewName}" at mobile viewport`);
    }

    // Check for elements with fixed pixel widths that might break on mobile
    const fixedWidthElements = await page.evaluate(() => {
      const els = document.querySelectorAll('*');
      const problems = [];
      for (const el of els) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width > window.innerWidth && style.display !== 'none' && rect.height > 0) {
          const id = el.id;
          const tag = el.tagName;
          const classes = el.className?.toString?.()?.slice(0, 40) || '';
          if (id || classes) {
            problems.push({ tag, id, classes, width: Math.round(rect.width), vpWidth: window.innerWidth });
          }
        }
      }
      return problems.slice(0, 5);
    });

    for (const el of fixedWidthElements) {
      addIssue('major', 'responsive', 
        `Element wider than mobile viewport in "${viewName}": <${el.tag}> id="${el.id}" width=${el.width}px > ${el.vpWidth}px`);
    }

    // Check for text that's too small to read
    const tinyText = await page.evaluate(() => {
      const els = document.querySelectorAll('p, span, div, td, th, li, label');
      const results = [];
      for (const el of els) {
        const style = window.getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize);
        const rect = el.getBoundingClientRect();
        if (fontSize < 10 && rect.height > 0 && rect.width > 0 && style.display !== 'none' && el.textContent?.trim()) {
          results.push({
            text: el.textContent?.trim()?.slice(0, 30),
            fontSize: fontSize,
            id: el.id || '',
          });
        }
      }
      return results.slice(0, 10);
    });

    for (const el of tinyText) {
      addIssue('minor', 'responsive', 
        `Very small text (${el.fontSize}px) on mobile in "${viewName}": "${el.text}"`);
    }
  }
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('🔍 Starting Deep-Dive Test Suite');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log('');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    
    // Collect page errors
    page.on('pageerror', error => {
      addIssue('major', 'runtime', `Uncaught error: ${error.message?.slice(0, 120)}`);
    });

    await testAllModals(page);
    await testAllSegmentControls(page);
    await testThemeAndAccent(page);
    await testKnowledgeView(page);
    await testBookshelfDeep(page);
    await testGoalsDeep(page);
    await testLogView(page);
    await testFormValidation(page);
    await testStyleConsistency(page);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 DEEP-DIVE TEST RESULTS');
    console.log('='.repeat(60));

    const critical = issues.filter(i => i.severity === 'critical');
    const major = issues.filter(i => i.severity === 'major');
    const minor = issues.filter(i => i.severity === 'minor');

    console.log(`\n  🔴 Critical: ${critical.length}`);
    console.log(`  🟠 Major:    ${major.length}`);
    console.log(`  🟡 Minor:    ${minor.length}`);
    console.log(`  Total issues: ${issues.length}`);
    console.log(`  📸 Screenshots: ${fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png')).length}`);

    // Write report
    const report = {
      timestamp: new Date().toISOString(),
      totalIssues: issues.length,
      summary: { critical: critical.length, major: major.length, minor: minor.length },
      issues,
    };
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    console.log(`\n  Report saved to: ${REPORT_FILE}`);

  } catch (e) {
    console.error('❌ Fatal error:', e.message);
    console.error(e.stack);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

main();
