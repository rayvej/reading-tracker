import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('===============================================================');
console.log(' 🧪 BOOKSHELF ZOOM PREVENTION & NATIVE LAYOUT INTEGRITY AUDIT ');
console.log('===============================================================\n');

const indexHtml = fs.readFileSync(path.join(rootDir, 'docs', 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(rootDir, 'docs', 'style.css'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'docs', 'app.js'), 'utf8');
const swJs = fs.readFileSync(path.join(rootDir, 'docs', 'sw.js'), 'utf8');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}\n    ${err.message}`);
    process.exit(1);
  }
}

// 1. Viewport Meta Configuration
test('Viewport meta tag prevents user scaling and enforces maximum-scale 1.0', () => {
  assert.ok(
    indexHtml.includes('name="viewport"') &&
    indexHtml.includes('maximum-scale=1.0') &&
    indexHtml.includes('user-scalable=no') &&
    indexHtml.includes('viewport-fit=cover'),
    'Viewport meta tag must contain maximum-scale=1.0, user-scalable=no, and viewport-fit=cover'
  );
});

// 2. Viewport & Container Overflow Containment
test('#view-wishlist section specifies overflow-x-hidden', () => {
  const wishlistMatch = indexHtml.match(/<section id="view-wishlist"[^>]*class="([^"]*)"/);
  assert.ok(wishlistMatch, 'Found #view-wishlist section');
  assert.ok(wishlistMatch[1].includes('overflow-x-hidden'), '#view-wishlist class includes overflow-x-hidden');
});

test('#view-wishlist inner container has max-w-full and overflow-x-hidden', () => {
  const innerMatch = indexHtml.match(/<section id="view-wishlist"[\s\S]*?<div class="([^"]*)"/);
  assert.ok(innerMatch, 'Found #view-wishlist inner wrapper div');
  assert.ok(innerMatch[1].includes('overflow-x-hidden'), 'inner div includes overflow-x-hidden');
  assert.ok(innerMatch[1].includes('max-w-full') || innerMatch[1].includes('w-full'), 'inner div constrained with max-w-full / w-full');
});

// 3. Header Controls Row Responsiveness
test('#bookshelf-controls-bar includes flex-wrap to prevent horizontal blowout', () => {
  const controlsMatch = indexHtml.match(/<div id="bookshelf-controls-bar"[^>]*class="([^"]*)"/);
  assert.ok(controlsMatch, 'Found #bookshelf-controls-bar');
  assert.ok(controlsMatch[1].includes('flex-wrap'), '#bookshelf-controls-bar contains flex-wrap');
  assert.ok(controlsMatch[1].includes('w-full'), '#bookshelf-controls-bar contains w-full');
});

test('Search, shelf and sort row wraps safely on narrow screens', () => {
  assert.ok(indexHtml.includes('id="bookshelf-shelf-select"'), 'shelf select present');
  assert.ok(indexHtml.includes('id="bookshelf-sort-select"'), 'sort select present');
  assert.ok(indexHtml.includes('id="wishlist-search"'), 'wishlist search present');
  const searchRowMatch = indexHtml.match(/<!-- Search, Shelf & Sort -->\s*<div class="([^"]*)"/);
  assert.ok(searchRowMatch, 'Found search row wrapper');
  assert.ok(searchRowMatch[1].includes('max-w-full') || searchRowMatch[1].includes('w-full'), 'Search row has max-w-full or w-full');
});

// 4. CSS Touch Action and Layout Constraints
test('style.css assigns touch-action: pan-y and overflow-x: hidden to .view and #view-wishlist', () => {
  assert.ok(styleCss.includes('.view, #view-wishlist') || styleCss.includes('#view-wishlist'), 'Rule exists targeting #view-wishlist');
  assert.ok(styleCss.includes('touch-action: pan-y;'), 'touch-action: pan-y defined');
});

test('style.css applies touch-action: pan-y to body', () => {
  assert.ok(styleCss.includes('body {') && styleCss.includes('touch-action: pan-y;'), 'body has touch-action: pan-y');
});

test('style.css assigns touch-action: pan-x and max-width 100% to .bookshelf-3d-container', () => {
  assert.ok(styleCss.includes('.bookshelf-3d-container {'), '.bookshelf-3d-container defined');
  const containerChunk = styleCss.slice(styleCss.indexOf('.bookshelf-3d-container {'), styleCss.indexOf('.bookshelf-3d-container {') + 1200);
  assert.ok(containerChunk.includes('touch-action: pan-x'), '3D shelf has touch-action: pan-x');
  assert.ok(containerChunk.includes('max-width: 100%'), '3D shelf has max-width: 100%');
});

test('style.css assigns touch-action: pan-y, min-width: 0, and max-width: 100% to .bookshelf-card-item', () => {
  const cardChunk = styleCss.slice(styleCss.indexOf('.bookshelf-card-item {'), styleCss.indexOf('.bookshelf-card-item {') + 600);
  assert.ok(cardChunk.includes('touch-action: pan-y'), 'card item has touch-action: pan-y');
  assert.ok(cardChunk.includes('max-width: 100%'), 'card item has max-width: 100%');
  assert.ok(cardChunk.includes('min-width: 0'), 'card item has min-width: 0');
});

test('style.css assigns width: 100% and max-width: 100% to .bookshelf-grid', () => {
  const gridChunk = styleCss.slice(styleCss.indexOf('.bookshelf-grid {'), styleCss.indexOf('.bookshelf-grid {') + 600);
  assert.ok(gridChunk.includes('max-width: 100%'), 'bookshelf-grid has max-width: 100%');
  assert.ok(gridChunk.includes('width: 100%'), 'bookshelf-grid has width: 100%');
});

// 5. JavaScript Gesture Suppression
test('app.js prevents iOS WebKit gesture pinch-zoom (gesturestart, gesturechange, gestureend)', () => {
  assert.ok(appJs.includes("addEventListener('gesturestart'"), 'gesturestart listener registered');
  assert.ok(appJs.includes("addEventListener('gesturechange'"), 'gesturechange listener registered');
  assert.ok(appJs.includes("addEventListener('gestureend'"), 'gestureend listener registered');
});

test('app.js prevents multi-touch pinch zoom on touchmove', () => {
  assert.ok(appJs.includes("touches.length > 1"), 'multi-touch length check present');
});

// 6. Release Synchronization (v128)
test('sw.js CACHE_NAME is bumped to v128', () => {
  assert.ok(swJs.includes("const CACHE_NAME = 'reading-tracker-v128';"), 'sw.js CACHE_NAME is reading-tracker-v128');
  assert.ok(swJs.includes("style.css?v=128"), 'sw.js precaches style.css?v=128');
  assert.ok(swJs.includes("app.js?v=128"), 'sw.js precaches app.js?v=128');
});

test('index.html links style.css?v=128 and app.js?v=128 and displays v128 badges', () => {
  assert.ok(indexHtml.includes('href="style.css?v=128"'), 'index.html links style.css?v=128');
  assert.ok(indexHtml.includes('src="app.js?v=128"'), 'index.html loads app.js?v=128');
  assert.ok(indexHtml.includes('id="acct-version-badge"') && indexHtml.includes('>v128</span>'), 'acct badge is v128');
  assert.ok(indexHtml.includes('id="app-version-badge"') && indexHtml.includes('>v128</span>'), 'app badge is v128');
});

test('app.js reports v128 in update helper', () => {
  assert.ok(appJs.includes("'v128'"), 'app.js includes v128 string');
});

// 7. Strict Confetti Exclusion Invariant
test('Zero confetti triggers across all modified code', () => {
  assert.ok(!appJs.includes('confetti('), 'app.js contains zero confetti calls');
  assert.ok(!indexHtml.includes('canvas-confetti'), 'index.html contains zero confetti libraries');
});

console.log('\n===============================================================');
console.log(` 🏆 ALL ${passed} BOOKSHELF ZOOM PREVENTION TESTS PASSED!`);
console.log('===============================================================\n');
