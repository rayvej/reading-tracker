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

console.log('\n═══════════════════════════════════════════════════');
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
