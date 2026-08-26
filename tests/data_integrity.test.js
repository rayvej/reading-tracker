/**
 * Data Integrity & Calculation Verification Suite
 */

import assert from 'node:assert/strict';
import { calculateReconciledMetrics, invalidateStatsCache } from '../docs/js/modules/stats.js';
import { calculateBookProgress, determineBookStatus } from '../docs/js/modules/business-logic.js';

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

console.log('\n═══ Data Integrity & Calculation Verification Suite ═══\n');

test('Stats cache invalidation works when invalidateStatsCache is called', () => {
  const books1 = [{ id: 'b1', title: 'Book 1', status: 'Finished', total_pages: 100, read_count: 1 }];
  const logs1 = [];
  const metrics1 = calculateReconciledMetrics(books1, logs1);
  assert.equal(metrics1.finishedTitles, 1);

  invalidateStatsCache();
  const books2 = [{ id: 'b1', title: 'Book 1', status: 'In Progress', total_pages: 100, current_page: 50 }];
  const metrics2 = calculateReconciledMetrics(books2, logs1);
  assert.equal(metrics2.finishedTitles, 0);
  assert.equal(metrics2.activeTitles, 1);
});

test('Stats cache invalidates when array lengths change', () => {
  const books = [{ id: 'b1', title: 'Book 1', status: 'In Progress', total_pages: 100, current_page: 50 }];
  const logs = [];
  const m1 = calculateReconciledMetrics(books, logs);
  assert.equal(m1.totalCatalogTitles, 1);

  // Add book to array
  const booksExtended = [...books, { id: 'b2', title: 'Book 2', status: 'Finished', total_pages: 200, read_count: 1 }];
  const m2 = calculateReconciledMetrics(booksExtended, logs);
  assert.equal(m2.totalCatalogTitles, 2);
  assert.equal(m2.finishedTitles, 1);
});

test('calculateBookProgress handles boundary conditions safely', () => {
  assert.deepEqual(calculateBookProgress(0, 100), { current: 0, total: 100, remaining: 100, percentage: 0, isComplete: false });
  assert.deepEqual(calculateBookProgress(100, 100), { current: 100, total: 100, remaining: 0, percentage: 100, isComplete: true });
  assert.deepEqual(calculateBookProgress(120, 100), { current: 120, total: 100, remaining: 0, percentage: 100, isComplete: true });
  assert.deepEqual(calculateBookProgress(-5, 100), { current: 0, total: 100, remaining: 100, percentage: 0, isComplete: false });
});

test('determineBookStatus handles multi-cycle status correctly', () => {
  assert.equal(determineBookStatus(0, 100, 0), 'Not Started');
  assert.equal(determineBookStatus(10, 100, 0), 'In Progress');
  assert.equal(determineBookStatus(100, 100, 0), 'Finished');
  assert.equal(determineBookStatus(0, 100, 1), 'Finished');
});

console.log(`\n══════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════\n`);

if (failed > 0) process.exit(1);
