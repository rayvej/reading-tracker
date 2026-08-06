/**
 * Calculation Regression Test Suite
 * Tests the modulo bug fix and edge cases in stats calculations
 */

import assert from 'node:assert/strict';
import { calculateReconciledMetrics, calculateReadingStreaks } from '../docs/js/modules/stats.js';

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

console.log('\\n═══ Calculation Regression Tests ═══\\n');

// ── Modulo Bug Regression ─────────────────────────────────────────────
console.log('Modulo Bug Regression (Critical Fix):');

test('Book read to EXACTLY last page should NOT return 0 active pages', () => {
  const books = [{
    title: 'Test Book',
    total_pages: 200,
    read_count: 0,
    status: 'In Progress'
  }];
  const logs = [{
    book_title: 'Test Book',
    read_cycle: 1,
    end_page: 200,
    start_page: 0
  }];
  const result = calculateReconciledMetrics(books, logs);
  // Before fix: activeCyclesPages was 200 % 200 = 0 (BUG!)
  // After fix:  activeCyclesPages should be Math.min(200, 200) = 200
  assert.ok(result.activeCyclesPages > 0, `Expected >0 active pages, got ${result.activeCyclesPages}`);
  assert.equal(result.activeCyclesPages, 200);
});

test('Book read past total pages should cap at total_pages', () => {
  const books = [{
    title: 'Overflow Book',
    total_pages: 100,
    read_count: 0,
    status: 'In Progress'
  }];
  const logs = [{
    book_title: 'Overflow Book',
    read_cycle: 1,
    end_page: 150,
    start_page: 0
  }];
  const result = calculateReconciledMetrics(books, logs);
  assert.equal(result.activeCyclesPages, 100, 'Should cap at total_pages');
});

// ── Edge Cases ────────────────────────────────────────────────────────
console.log('\\nEdge Cases:');

test('Empty books array', () => {
  const result = calculateReconciledMetrics([], []);
  assert.equal(result.totalCatalogTitles, 0);
  assert.equal(result.grandTotalPages, 0);
});

test('Books with no logs', () => {
  const books = [{
    title: 'Unread',
    total_pages: 300,
    read_count: 0,
    status: 'Not Started'
  }];
  const result = calculateReconciledMetrics(books, []);
  assert.equal(result.unreadTitles, 1);
  assert.equal(result.activeCyclesPages, 0);
});

test('Book with 0 total pages', () => {
  const books = [{
    title: 'No Pages',
    total_pages: 0,
    read_count: 0,
    status: 'In Progress'
  }];
  const logs = [{
    book_title: 'No Pages',
    read_cycle: 1,
    end_page: 50,
    start_page: 0
  }];
  const result = calculateReconciledMetrics(books, logs);
  // With 0 total pages, should fall through to maxEndPage directly
  assert.equal(result.activeCyclesPages, 50);
});

test('Finished book counts correctly', () => {
  const books = [{
    title: 'Done',
    total_pages: 200,
    read_count: 1,
    status: 'Finished'
  }];
  const result = calculateReconciledMetrics(books, []);
  assert.equal(result.finishedTitles, 1);
  assert.equal(result.totalCompletedReads, 1);
  assert.equal(result.finishedCyclesPages, 200);
});

test('Multiple read cycles accumulate correctly', () => {
  const books = [{
    title: 'Re-read',
    total_pages: 100,
    read_count: 2,
    status: 'Finished'
  }];
  const result = calculateReconciledMetrics(books, []);
  assert.equal(result.totalCompletedReads, 2);
  assert.equal(result.finishedCyclesPages, 200);
});

// ── Streak Calculations ───────────────────────────────────────────────
console.log('\\nStreak Calculations:');

test('Empty logs return 0 streaks', () => {
  const result = calculateReadingStreaks([]);
  assert.equal(result.currentStreak, 0);
  assert.equal(result.longestStreak, 0);
});

test('Consecutive days form a streak', () => {
  const logs = [
    { date: '2026-07-28' },
    { date: '2026-07-29' },
    { date: '2026-07-30' },
    { date: '2026-07-31' }
  ];
  const result = calculateReadingStreaks(logs);
  assert.equal(result.longestStreak, 4);
});

test('Gap in dates breaks the streak', () => {
  const logs = [
    { date: '2026-07-25' },
    { date: '2026-07-26' },
    // gap
    { date: '2026-07-28' },
    { date: '2026-07-29' }
  ];
  const result = calculateReadingStreaks(logs);
  assert.equal(result.longestStreak, 2);
});

test('Duplicate dates do not inflate streak', () => {
  const logs = [
    { date: '2026-07-30' },
    { date: '2026-07-30' },
    { date: '2026-07-31' }
  ];
  const result = calculateReadingStreaks(logs);
  assert.equal(result.longestStreak, 2);
});

test('Single log day has streak of 1', () => {
  const logs = [{ date: '2026-07-15' }];
  const result = calculateReadingStreaks(logs);
  assert.equal(result.longestStreak, 1);
});

test('Log duration resolves correctly with minutes_spent field', () => {
  const log = { date: '2026-08-06', minutes_spent: 45, start_page: 10, end_page: 30 };
  const dur = parseInt(log.minutes_spent || log.duration_minutes || log.durationMinutes || 0, 10);
  assert.equal(dur, 45, 'Should resolve minutes_spent to 45');
});

// Summary
console.log(`\n══════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════\n`);

if (failed > 0) process.exit(1);
