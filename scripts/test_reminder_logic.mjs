import { generateDailyReminderPayload, getMillisecondsUntilNextReminder, VAPID_KEYS, formatWebPushNotificationPayload, validatePushSubscription } from './send_daily_reminders.mjs';
import assert from 'assert';

console.log("=== Testing Daily Reminder Notification System ===");

// Sample Data
const sampleBooks = [
  {
    id: "book-101",
    title: "The Dawn-Breakers",
    status: "In Progress",
    current_page: 280,
    total_pages: 668,
    notes: "Historical text note"
  }
];

const sampleLogs = [
  {
    book_id: "book-101",
    title: "The Dawn-Breakers",
    pages_read: 40,
    minutes_spent: 30, // 40 pages / 30 mins = 1.33 pages/min. Remaining: 388 pages -> ~291 mins (~4h 51m)
    notes: "The devotion and spirit of sacrifice shown during this period remains a constant source of inspiration.",
    date: "2026-07-29"
  }
];

// Test 1: Payload Generation Accuracy
console.log("\n[Test 1] Testing Payload Generation...");
const payload = generateDailyReminderPayload(sampleBooks, sampleLogs, { includeQuote: true });

assert.ok(payload, "Payload should be generated");
assert.strictEqual(payload.title, "The Dawn-Breakers (42% Complete)");
assert.ok(payload.body.includes("Page 280 of 668"), "Body must state current page and total pages");
assert.ok(payload.body.includes("Est. 4h 51m remaining"), `Body must contain estimated time remaining, got: ${payload.body}`);
assert.ok(payload.body.includes("Recent Note:"), "Body must contain Recent Note header");
assert.ok(payload.body.includes('"The devotion and spirit of sacrifice'), "Body must contain the quote");
assert.ok(!/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/u.test(payload.title), "Title must contain no emojis");
assert.ok(!/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/u.test(payload.body), "Body must contain no emojis");

console.log("✓ Test 1 Passed! Generated Payload:");
console.log("  Title:", payload.title);
console.log("  Body:\n" + payload.body.split('\n').map(l => "    " + l).join('\n'));

// Test 2: Time Until Next 7:00 AM Reminder
console.log("\n[Test 2] Testing 7:00 AM Countdown Logic...");
const nowMorning = new Date('2026-07-30T06:00:00'); // 6:00 AM
const msUntil7AM = getMillisecondsUntilNextReminder("07:00", nowMorning);
const hoursUntil7AM = msUntil7AM / (1000 * 60 * 60);
assert.strictEqual(hoursUntil7AM, 1, "Should be exactly 1 hour until 7:00 AM if current time is 6:00 AM");

const nowAfter7AM = new Date('2026-07-30T08:00:00'); // 8:00 AM (past 7:00 AM)
const msUntilNextDay7AM = getMillisecondsUntilNextReminder("07:00", nowAfter7AM);
const hoursUntilNextDay7AM = msUntilNextDay7AM / (1000 * 60 * 60);
assert.strictEqual(hoursUntilNextDay7AM, 23, "Should be 23 hours until 7:00 AM tomorrow if current time is 8:00 AM");

console.log("✓ Test 2 Passed! 7:00 AM Countdown verified accurately.");

// Test 3: Quote Exclude Toggle
console.log("\n[Test 3] Testing Quote Exclusion Option...");
const payloadNoQuote = generateDailyReminderPayload(sampleBooks, sampleLogs, { includeQuote: false });
assert.ok(!payloadNoQuote.body.includes("Recent Note:"), "Body should exclude quote when includeQuote is false");
console.log("✓ Test 3 Passed!");

// Test 4: Web Push Payload Formatting & Subscription Validation
console.log("\n[Test 4] Testing Web Push Payload & Subscription Validation...");
assert.ok(VAPID_KEYS.publicKey && VAPID_KEYS.privateKey, "VAPID keys must be configured");

const webPushPayload = formatWebPushNotificationPayload(payload);
assert.ok(webPushPayload, "Web Push payload must be generated");
assert.strictEqual(webPushPayload.title, payload.title);
assert.strictEqual(webPushPayload.body, payload.body);
assert.strictEqual(webPushPayload.tag, 'daily-reading-reminder');
assert.strictEqual(webPushPayload.data.url, '/#book-book-101');

const validSub = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/sample-token-xyz',
  keys: {
    p256dh: 'BNcZ...sample...',
    auth: 'authSecret123'
  }
};
assert.ok(validatePushSubscription(validSub), "Valid push subscription must pass validation");
assert.ok(!validatePushSubscription(null), "Null subscription must fail validation");
assert.ok(!validatePushSubscription({ endpoint: 'invalid' }), "Invalid subscription must fail validation");
console.log("✓ Test 4 Passed! Web Push payload formatting and validation verified.");

console.log("\n=== ALL TESTS PASSED SUCCESSFULLY! ===");

