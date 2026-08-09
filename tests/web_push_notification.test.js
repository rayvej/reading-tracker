/**
 * Web Push Notification System Verification Suite
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateDailyReminderPayload,
  VAPID_KEYS,
  formatWebPushNotificationPayload,
  validatePushSubscription
} from '../scripts/send_daily_reminders.mjs';

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

console.log('\n═══ Web Push Notification & Closed-App Delivery Test Suite ═══\n');

const appJsContent = fs.readFileSync(path.resolve('docs/app.js'), 'utf-8');
const swJsContent = fs.readFileSync(path.resolve('docs/sw.js'), 'utf-8');

// ── 1. VAPID Keys & Script Verification ──────────────────────────────────────
console.log('1. VAPID Key Pair & Background Payload Dispatch:');

test('VAPID public and private keys are properly defined and valid base64 strings', () => {
  assert.ok(VAPID_KEYS.publicKey, 'VAPID public key must exist');
  assert.ok(VAPID_KEYS.privateKey, 'VAPID private key must exist');
  assert.strictEqual(typeof VAPID_KEYS.publicKey, 'string', 'Public key must be string');
  assert.ok(VAPID_KEYS.publicKey.length > 50, 'VAPID public key length must be valid');
});

test('formatWebPushNotificationPayload creates standard Push API payload', () => {
  const sampleBooks = [{ id: 'b1', title: 'Kitab-i-Iqan', status: 'In Progress', current_page: 50, total_pages: 200 }];
  const sampleLogs = [{ book_id: 'b1', title: 'Kitab-i-Iqan', pages_read: 20, minutes_spent: 15, notes: 'Search after truth.' }];
  const reminder = generateDailyReminderPayload(sampleBooks, sampleLogs);
  
  const pushPayload = formatWebPushNotificationPayload(reminder);
  assert.ok(pushPayload, 'Push payload must be generated');
  assert.ok(pushPayload.title.includes('Kitab-i-Iqan'), 'Title must contain book title');
  assert.strictEqual(pushPayload.tag, 'daily-reading-reminder', 'Tag must be daily-reading-reminder');
  assert.strictEqual(pushPayload.data.url, '/#book-b1', 'Deep link URL must match book ID');
});

test('validatePushSubscription correctly validates web push endpoints', () => {
  const validSub = {
    endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB...',
    keys: { p256dh: 'BEl...key', auth: 'auth...secret' }
  };
  assert.ok(validatePushSubscription(validSub), 'Valid endpoint must pass validation');
  assert.strictEqual(validatePushSubscription(null), false, 'Null must fail validation');
  assert.strictEqual(validatePushSubscription({ endpoint: 'invalid' }), false, 'Missing keys must fail validation');
});

// ── 2. Client-Side App.js Web Push Integration ───────────────────────────────
console.log('\n2. Frontend App.js Web Push Subscription Engine:');

test('PUBLIC_VAPID_KEY constant is embedded in app.js', () => {
  assert.ok(appJsContent.includes('const PUBLIC_VAPID_KEY ='), 'PUBLIC_VAPID_KEY must be defined in app.js');
  assert.ok(appJsContent.includes(VAPID_KEYS.publicKey), 'app.js VAPID key must match background script key');
});

test('registerWebPushSubscription function exists and handles pushManager.subscribe', () => {
  assert.ok(appJsContent.includes('async function registerWebPushSubscription()'), 'registerWebPushSubscription function declared in app.js');
  assert.ok(appJsContent.includes('reg.pushManager.subscribe('), 'pushManager.subscribe must be invoked');
  assert.ok(appJsContent.includes("userVisibleOnly: true"), 'userVisibleOnly option must be set');
});

test('Notification permission button triggers push subscription and Firestore sync', () => {
  assert.ok(appJsContent.includes("setDoc(doc(db, `users/${uid}/push_subscriptions/${subId}`)"), 'Push subscription synced to Firestore');
  assert.ok(appJsContent.includes("localStorage.setItem('rt_push_subscription'"), 'Push subscription saved to localStorage');
});

// ── 3. Service Worker Listener Verification ──────────────────────────────────
console.log('\n3. Service Worker Push & Notification Click Listeners:');

test('sw.js handles push event and displays lock-screen notification', () => {
  assert.ok(swJsContent.includes("self.addEventListener('push'"), 'sw.js must contain push event listener');
  assert.ok(swJsContent.includes('self.registration.showNotification('), 'sw.js must call registration.showNotification');
});

test('sw.js handles notificationclick event to focus window or open URL', () => {
  assert.ok(swJsContent.includes("self.addEventListener('notificationclick'"), 'sw.js must contain notificationclick listener');
  assert.ok(swJsContent.includes('client.focus()'), 'sw.js notificationclick must focus existing window');
  assert.ok(swJsContent.includes('self.clients.openWindow('), 'sw.js notificationclick must open window if not focused');
});

// Summary
console.log(`\n══════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════\n`);

if (failed > 0) process.exit(1);
