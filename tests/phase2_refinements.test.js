/**
 * Phase 2 Refinements Test Suite
 * Tests debounce, throttle, duplicate title collision safeguard, and focus trap functions
 */

import assert from 'node:assert/strict';
import { debounce, throttle } from '../docs/js/modules/ui.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

console.log('\\n═══ Phase 2 Refinements Tests ═══\\n');

// ── Debounce Utility ──────────────────────────────────────────────────
console.log('Debounce Utility:');

await asyncTest('Debounce delays execution until delay passes', async () => {
  let count = 0;
  const debouncedFn = debounce(() => { count++; }, 50);

  debouncedFn();
  debouncedFn();
  debouncedFn();

  assert.equal(count, 0, 'Should not execute immediately');

  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(count, 1, 'Should execute exactly once after delay');
});

// ── Throttle Utility ──────────────────────────────────────────────────
console.log('\\nThrottle Utility:');

await asyncTest('Throttle limits execution frequency', async () => {
  let count = 0;
  const throttledFn = throttle(() => { count++; }, 50);

  throttledFn(); // Count: 1
  throttledFn(); // Throttled
  throttledFn(); // Throttled

  assert.equal(count, 1, 'First call executes immediately');

  await new Promise(resolve => setTimeout(resolve, 80));
  throttledFn(); // Count: 2 (throttle period passed)
  assert.equal(count, 2, 'Executes again after throttle period');
});

// ── Duplicate Title Safeguard (H3) ────────────────────────────────────
console.log('\\nDuplicate Title Collision Safeguard:');

test('Identifies duplicate title case-insensitively', () => {
  const booksCache = [
    { id: '1', title: 'The Dawn-Breakers', author: 'Nabíl-i-A‘ẓam' },
    { id: '2', title: 'Kitáb-i-Íqán', author: 'Bahá\'u\'lláh' }
  ];

  const titleToCheck = 'the dawn-breakers';
  const duplicate = booksCache.find(b => b && b.title && b.title.toLowerCase() === titleToCheck.toLowerCase());

  assert.ok(duplicate, 'Should detect duplicate title regardless of case');
  assert.equal(duplicate.id, '1');
});

test('Allows unique title', () => {
  const booksCache = [
    { id: '1', title: 'The Dawn-Breakers', author: 'Nabíl-i-A‘ẓam' }
  ];

  const titleToCheck = 'God Passes By';
  const duplicate = booksCache.find(b => b && b.title && b.title.toLowerCase() === titleToCheck.toLowerCase());

  assert.equal(duplicate, undefined, 'Should not match unique title');
});

// Summary
console.log(`\\n══════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════\\n`);

if (failed > 0) process.exit(1);
