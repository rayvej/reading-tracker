/**
 * Unit Test Suite: UI/UX Enhancements & v124 Release (tests/ui_ux_enhancements_v124.test.js)
 */

import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log('\n═══ UI/UX Enhancements & v124 Release Tests ═══\n');

const appJs = fs.readFileSync(path.resolve('./docs/app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.resolve('./docs/index.html'), 'utf8');
const styleCss = fs.readFileSync(path.resolve('./docs/style.css'), 'utf8');
const swJs = fs.readFileSync(path.resolve('./docs/sw.js'), 'utf8');

// 1. Collapsible 3D Bookshelf
assert(indexHtml.includes('id="bookshelf-3d-wrapper"'), 'index.html has #bookshelf-3d-wrapper');
assert(indexHtml.includes('id="bookshelf-3d-toggle-btn"'), 'index.html has #bookshelf-3d-toggle-btn');
assert(indexHtml.includes('id="bookshelf-3d-chevron"'), 'index.html has #bookshelf-3d-chevron');
assert(styleCss.includes('.bookshelf-3d-container.collapsed'), 'style.css defines .bookshelf-3d-container.collapsed transition state');
assert(styleCss.includes('#bookshelf-3d-chevron.collapsed'), 'style.css defines #bookshelf-3d-chevron.collapsed rotation');
assert(appJs.includes('setup3DSpineBookshelfToggle'), 'app.js defines setup3DSpineBookshelfToggle');
assert(appJs.includes('rt_3d_shelf_collapsed'), 'app.js persists 3D shelf collapsed state in localStorage');

// 2. Grid-View Micro-Action Icons & Quick Action Handlers
assert(appJs.includes('data-action="complete"'), 'app.js renders quick complete button');
assert(appJs.includes('data-action="re-read"'), 'app.js renders quick re-read button');
assert(appJs.includes('data-action="edit"'), 'app.js renders quick edit button');
assert(appJs.includes('data-action="start-reading"'), 'app.js renders quick start-reading button');
assert(appJs.includes('function bindCardActions'), 'app.js defines bindCardActions handler');
assert(appJs.includes('async function startReadingBook'), 'app.js defines startReadingBook');

// 3. Historical Date Finished in Add Book Modal
assert(indexHtml.includes('id="ab-finish-date-container"'), 'index.html has #ab-finish-date-container');
assert(indexHtml.includes('id="ab-finish-date"'), 'index.html has #ab-finish-date input');
assert(appJs.includes('ab-finish-date-container'), 'app.js toggles ab-finish-date-container on status change');
assert(appJs.includes('finish_date: finishDateVal'), 'app.js saves finish_date from date picker in saveNewBook');

// 4. Smart Contextual Empty States
assert(appJs.includes('resetBookshelfFilters()'), 'app.js provides resetBookshelfFilters helper');
assert(appJs.includes('No books match current filter'), 'app.js has contextual message for active filters');

// 5. Theme Gold Utilities & Light Mode Spine Fallbacks
assert(styleCss.includes('.text-gold'), 'style.css defines .text-gold');
assert(styleCss.includes('.bg-gold\\/10'), 'style.css defines .bg-gold/10');
assert(styleCss.includes('.border-gold\\/30'), 'style.css defines .border-gold/30');
assert(styleCss.includes('body.light-mode .book-spine-fallback'), 'style.css defines high-contrast light mode spine fallback');

// 6. Release Version Bump to v125
assert(swJs.includes("const CACHE_NAME = 'reading-tracker-v125';"), 'sw.js CACHE_NAME bumped to v125');
assert(swJs.includes("style.css?v=125"), 'sw.js caches style.css?v=125');
assert(swJs.includes("app.js?v=125"), 'sw.js caches app.js?v=125');
assert(indexHtml.includes('style.css?v=125'), 'index.html references style.css?v=125');
assert(indexHtml.includes('app.js?v=125'), 'index.html references app.js?v=125');
assert(indexHtml.includes('>v125</span>'), 'index.html displays v125 badges');
assert(appJs.includes("'v125'"), 'app.js reports v125 in update check');
assert(appJs.includes("let bookshelfSortOrder"), 'app.js defines bookshelfSortOrder');

console.log(`\n══════════════════════════════\nResults: ${passed} passed, ${failed} failed\n══════════════════════════════\n`);

if (failed > 0) process.exit(1);
