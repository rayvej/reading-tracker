/**
 * Account View Daily Reminders & Settings Integration Test Suite
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

console.log('\n═══ Account & Settings View Daily Reminders Integration Suite ═══\n');

const htmlContent = fs.readFileSync(path.resolve('docs/index.html'), 'utf-8');
const appJsContent = fs.readFileSync(path.resolve('docs/app.js'), 'utf-8');

// ── 1. HTML Markup in view-account ───────────────────────────────────────────
console.log('1. Verification of Elements inside Account & Settings Tab (#view-account):');

test('Daily Morning Reminders glass panel card exists in #view-account', () => {
  const acctPos = htmlContent.indexOf('id="view-account"');
  const reminderPos = htmlContent.indexOf('Daily Morning Reminders', acctPos);
  assert.ok(acctPos > 0, '#view-account must exist in index.html');
  assert.ok(reminderPos > acctPos, 'Daily Morning Reminders card must exist inside #view-account section');
});

test('All Daily Reminder inputs and buttons are present in #view-account', () => {
  assert.ok(htmlContent.includes('id="acct-setting-reminder-enable"'), '#acct-setting-reminder-enable must exist');
  assert.ok(htmlContent.includes('id="acct-setting-reminder-time"'), '#acct-setting-reminder-time must exist');
  assert.ok(htmlContent.includes('id="acct-setting-reminder-quote"'), '#acct-setting-reminder-quote must exist');
  assert.ok(htmlContent.includes('id="acct-setting-reminder-custom-text"'), '#acct-setting-reminder-custom-text must exist');
  assert.ok(htmlContent.includes('id="acct-btn-request-notification-permission"'), '#acct-btn-request-notification-permission must exist');
  assert.ok(htmlContent.includes('id="acct-btn-test-notification"'), '#acct-btn-test-notification must exist');
});

test('Dashboard Layout & Sections preference checkboxes exist in #view-account', () => {
  assert.ok(htmlContent.includes('id="acct-pref-dash-pace"'), '#acct-pref-dash-pace must exist');
  assert.ok(htmlContent.includes('id="acct-pref-dash-heatmap"'), '#acct-pref-dash-heatmap must exist');
  assert.ok(htmlContent.includes('id="acct-pref-dash-yoy"'), '#acct-pref-dash-yoy must exist');
  assert.ok(htmlContent.includes('id="acct-pref-dash-contextual"'), '#acct-pref-dash-contextual must exist');
});

// ── 2. JavaScript Logic & Synchronization in app.js ──────────────────────────
console.log('\n2. Verification of JavaScript Multi-Target Synchronization in app.js:');

test('setupNotificationSettingsUI targets both modal and account view reminder elements', () => {
  assert.ok(appJsContent.includes('#setting-reminder-enable, #acct-setting-reminder-enable'), 'Syncs enable toggle');
  assert.ok(appJsContent.includes('#setting-reminder-time, #acct-setting-reminder-time'), 'Syncs reminder time');
  assert.ok(appJsContent.includes('#setting-reminder-quote, #acct-setting-reminder-quote'), 'Syncs quote toggle');
  assert.ok(appJsContent.includes('#setting-reminder-custom-text, #acct-setting-reminder-custom-text'), 'Syncs custom text input');
  assert.ok(appJsContent.includes('#btn-request-notification-permission, #acct-btn-request-notification-permission'), 'Wires push permission buttons');
  assert.ok(appJsContent.includes('#btn-test-notification, #acct-btn-test-notification'), 'Wires test notification buttons');
});

test('Dashboard preferences synchronizes across both modal and account view controls', () => {
  assert.ok(appJsContent.includes('#pref-dash-pace, #acct-pref-dash-pace'), 'Pace toggle mapped across views');
  assert.ok(appJsContent.includes('#pref-dash-heatmap, #acct-pref-dash-heatmap'), 'Heatmap toggle mapped across views');
  assert.ok(appJsContent.includes('#pref-dash-yoy, #acct-pref-dash-yoy'), 'YoY toggle mapped across views');
  assert.ok(appJsContent.includes('#pref-dash-contextual, #acct-pref-dash-contextual'), 'Contextual toggle mapped across views');
});

import { generateDailyReminderPayload } from '../scripts/send_daily_reminders.mjs';

// ── 3. Latest Book Selection & Accurate Progress Calculation ──────────────────
console.log('\n3. Verification of Latest Book Selection & Accurate Page Calculation:');

test('generateDailyReminderPayload prioritizes the most recently read in-progress book', () => {
  const books = [
    { id: 'b1', title: 'A short history about everything', status: 'In Progress', total_pages: 500, current_page: 0 },
    { id: 'b2', title: 'The Dawn-Breakers', status: 'In Progress', total_pages: 668, current_page: 0 }
  ];

  const logs = [
    { book_id: 'b1', book_title: 'A short history about everything', start_page: 0, end_page: 15, pages_read: 15, date: '2026-05-10' },
    { book_id: 'b2', book_title: 'The Dawn-Breakers', start_page: 240, end_page: 280, pages_read: 40, date: '2026-08-26', notes: 'Inspiring history' }
  ];

  const payload = generateDailyReminderPayload(books, logs);
  assert.ok(payload, 'Payload must be returned');
  assert.strictEqual(payload.bookId, 'b2', 'Must pick b2 (The Dawn-Breakers) as it has the most recent reading log');
  assert.strictEqual(payload.currentPage, 280, 'Must compute current page 280 from active log end_page');
  assert.strictEqual(payload.totalPages, 668, 'Must match total pages');
  assert.strictEqual(payload.progressPct, 42, '280/668 = 42%');
  assert.ok(payload.body.includes('Page 280 of 668'), 'Body must mention Page 280 of 668');
  assert.ok(payload.body.includes('Inspiring history'), 'Body must include latest note');
});

test('generateDailyReminderPayload computes progress correctly when pages_read is in book or logs', () => {
  const books = [
    { id: 'b1', title: 'Atomic Habits', status: 'In Progress', total_pages: 300, pages_read: 120 }
  ];
  const logs = [];

  const payload = generateDailyReminderPayload(books, logs);
  assert.ok(payload);
  assert.strictEqual(payload.currentPage, 120);
  assert.strictEqual(payload.progressPct, 40);
  assert.ok(payload.body.includes('Page 120 of 300'));
});

console.log('\n═══════════════════════════════════════════════════');
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}

