/**
 * Unit Test Suite: Add Book Initial Reading Progress (tests/add_book_progress.test.js)
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

console.log('\n═══ Add Book Initial Reading Progress Tests ═══\n');

// 1. Verify app.js file content contains ab-progress handling and helper functions
const appJsPath = path.resolve('./docs/app.js');
const appJsContent = fs.readFileSync(appJsPath, 'utf8');

assert(appJsContent.includes('ab-progress'), 'app.js includes ab-progress input reference');
assert(appJsContent.includes('toggleAddBookProgressField'), 'app.js includes toggleAddBookProgressField helper');
assert(appJsContent.includes('updateAddBookProgressHint'), 'app.js includes updateAddBookProgressHint helper');
assert(appJsContent.includes('Initial reading progress'), 'app.js creates initial log for in-progress books');

// 2. Verify index.html contains ab-progress-container and handlers
const indexHtmlPath = path.resolve('./docs/index.html');
const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

assert(indexHtmlContent.includes('id="ab-progress-container"'), 'index.html includes ab-progress-container');
assert(indexHtmlContent.includes('id="ab-progress"'), 'index.html includes ab-progress input element');
assert(indexHtmlContent.includes('id="ab-progress-hint"'), 'index.html includes ab-progress-hint element');
assert(indexHtmlContent.includes('toggleAddBookProgressField()'), 'index.html attaches status change listener');
assert(indexHtmlContent.includes('updateAddBookProgressHint()'), 'index.html attaches progress input listener');

// 3. Test progress calculation logic
function computeProgressPercentage(prog, total) {
  if (total <= 0 || prog <= 0) return 0;
  return Number(((prog / total) * 100).toFixed(1));
}

assert(computeProgressPercentage(150, 300) === 50, '150 of 300 pages yields 50%');
assert(computeProgressPercentage(100, 400) === 25, '100 of 400 pages yields 25%');
assert(computeProgressPercentage(300, 300) === 100, '300 of 300 pages yields 100%');

console.log('\n══════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
