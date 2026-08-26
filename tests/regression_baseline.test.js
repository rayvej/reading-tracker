/**
 * Regression Baseline Tests
 */

import assert from 'node:assert/strict';
import { escapeHtml } from '../docs/js/modules/ui.js';
import {
  calculateBookProgress,
  determineBookStatus,
  formatReadingTime,
  calculateReadingPace,
  estimateCompletionDays
} from '../docs/js/modules/business-logic.js';
import {
  calculateReconciledMetrics,
  calculateReadingStreaks
} from '../docs/js/modules/stats.js';
import { fallbackTransliterate } from '../docs/js/modules/gemini-service.js';
import {
  generateDailyReminderPayload,
  validatePushSubscription,
  getMillisecondsUntilNextReminder
} from '../scripts/send_daily_reminders.mjs';

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(error);
    failed++;
  }
}

console.log('\n═══ Regression Baseline Tests ═══\n');

runTest('escapeHtml: verify \'<script>\' becomes \'&lt;script&gt;\'', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});

runTest('calculateBookProgress(50, 100) returns correctly', () => {
  const result = calculateBookProgress(50, 100);
  assert.deepEqual(result, { current: 50, total: 100, remaining: 50, percentage: 50, isComplete: false });
});

runTest('calculateBookProgress(100, 100) returns isComplete: true', () => {
  const result = calculateBookProgress(100, 100);
  assert.equal(result.isComplete, true);
});

runTest('determineBookStatus(0, 100, 0) returns Not Started', () => {
  assert.equal(determineBookStatus(0, 100, 0), 'Not Started');
});

runTest('determineBookStatus(50, 100, 0) returns In Progress', () => {
  assert.equal(determineBookStatus(50, 100, 0), 'In Progress');
});

runTest('determineBookStatus(100, 100, 0) returns Finished', () => {
  assert.equal(determineBookStatus(100, 100, 0), 'Finished');
});

runTest('formatReadingTime(90) returns 1h 30m', () => {
  assert.equal(formatReadingTime(90), '1h 30m');
});

runTest('formatReadingTime(0) returns 0m', () => {
  assert.equal(formatReadingTime(0), '0m');
});

runTest('calculateReadingPace(60, 60) returns 60', () => {
  assert.equal(calculateReadingPace(60, 60), 60);
});

runTest('estimateCompletionDays(100, 25) returns 4', () => {
  assert.equal(estimateCompletionDays(100, 25), 4);
});

runTest('calculateReconciledMetrics with empty arrays returns zeros', () => {
  const result = calculateReconciledMetrics([], []);
  assert.equal(result.totalCatalogTitles, 0);
  assert.equal(result.activeTitles, 0);
  assert.equal(result.finishedTitles, 0);
  assert.equal(result.totalCompletedReads, 0);
  assert.equal(result.grandTotalPages, 0);
});

runTest('calculateReconciledMetrics with a finished book returns finishedTitles=1, totalCompletedReads=1', () => {
  const books = [{ id: '1', status: 'Finished', pages_read: 100, total_pages: 100, read_count: 1 }];
  const logs = [{ book_title: '1', start_page: 0, end_page: 100, minutes_spent: 60, date: '2026-08-01' }];
  const result = calculateReconciledMetrics(books, logs);
  assert.equal(result.finishedTitles, 1);
  assert.equal(result.totalCompletedReads, 1);
});

runTest('calculateReadingStreaks with empty logs returns {currentStreak: 0, longestStreak: 0}', () => {
  const result = calculateReadingStreaks([]);
  assert.equal(result.currentStreak, 0);
  assert.equal(result.longestStreak, 0);
});

runTest('fallbackTransliterate(\'Bahaullah\') contains "Bahá\'u\'lláh"', () => {
  assert.ok(fallbackTransliterate('Bahaullah').includes("Bahá'u'lláh"));
});

runTest('fallbackTransliterate(\'Tahirih\') returns \'Táhirih\'', () => {
  assert.equal(fallbackTransliterate('Tahirih'), 'Táhirih');
});

runTest('generateDailyReminderPayload([], []) returns null', () => {
  assert.equal(generateDailyReminderPayload([], []), null);
});

runTest('generateDailyReminderPayload with a valid in-progress book returns an object with title, body, progressPct', () => {
  const books = [{ id: '1', title: 'Test Book', author: 'Author', status: 'In Progress', current_page: 50, total_pages: 100 }];
  const logs = [];
  const result = generateDailyReminderPayload(books, logs);
  assert.ok(result);
  assert.ok(result.title);
  assert.ok(result.body);
  assert.equal(result.progressPct, 50);
});

runTest('validatePushSubscription(null) returns false', () => {
  assert.equal(validatePushSubscription(null), false);
});

runTest('validatePushSubscription valid obj returns true', () => {
  const sub = { endpoint: 'https://example.com', keys: { p256dh: 'x', auth: 'y' } };
  assert.equal(validatePushSubscription(sub), true);
});

runTest('getMillisecondsUntilNextReminder returns a positive number', () => {
  assert.ok(getMillisecondsUntilNextReminder() > 0);
});

console.log('\n══════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
