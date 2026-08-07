import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('\n═══ Performance & Visual Integrity Audit Test Suite ═══\n');

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✕ ${name}`);
    console.error(`    Error: ${err.message}`);
  }
}

const htmlPath = path.resolve('docs/index.html');
const cssPath = path.resolve('docs/style.css');
const appJsPath = path.resolve('docs/app.js');
const swJsPath = path.resolve('docs/sw.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const cssContent = fs.readFileSync(cssPath, 'utf8');
const appJsContent = fs.readFileSync(appJsPath, 'utf8');
const swJsContent = fs.readFileSync(swJsPath, 'utf8');

// 1. Image Lazy Loading & Async Decoding Attributes
test('Book cover HTML generation includes loading="lazy" and decoding="async"', () => {
  assert.ok(appJsContent.includes('loading="lazy"'), 'app.js should contain loading="lazy" for cover images');
  assert.ok(appJsContent.includes('decoding="async"'), 'app.js should contain decoding="async" for off-thread image rendering');
});

// 2. CSS Content Visibility & Containment
test('style.css defines content-visibility: auto for card items', () => {
  assert.ok(cssContent.includes('content-visibility: auto'), 'style.css should specify content-visibility: auto');
  assert.ok(cssContent.includes('contain-intrinsic-size: 110px'), 'style.css should specify contain-intrinsic-size fallback');
});

// 3. Non-blocking Font Awesome & Optimized Font Loading
test('index.html uses non-blocking preload for Font Awesome stylesheet', () => {
  assert.ok(htmlContent.includes('rel="preload"'), 'index.html should preload external icon CSS');
  assert.ok(htmlContent.includes('onload="this.onload=null;this.rel=\'stylesheet\'"'), 'index.html should convert preload to stylesheet on load');
});

// 4. Service Worker Pre-caching & Cache Matching
test('sw.js specifies precaching array and cache-first strategies for static assets', () => {
  assert.ok(swJsContent.includes('STATIC_ASSETS'), 'sw.js should contain STATIC_ASSETS array');
  assert.ok(swJsContent.includes('CACHE_NAME'), 'sw.js should define versioned CACHE_NAME');
});

console.log(`\n══════════════════════════════`);
console.log(`Results: ${passed} passed, ${total - passed} failed`);
console.log(`══════════════════════════════\n`);

if (passed !== total) {
  process.exit(1);
}
