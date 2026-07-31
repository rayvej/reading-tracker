/**
 * Input Validation Test Suite
 * Tests boundary conditions for book creation and log submission
 * Uses pure validation functions extracted from app.js logic
 */

import assert from 'node:assert/strict';

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

// ── Pure validation functions matching app.js logic ──────────────────

function validateNewBook({ title, author, notes, pages, cost }) {
  const errors = [];
  if (!title || !title.trim()) errors.push('Title required');
  if (title && title.length > 300) errors.push('Title too long');
  if (author && author.length > 200) errors.push('Author too long');
  if (notes && notes.length > 5000) errors.push('Notes too long');
  if (isNaN(pages) || pages <= 0) errors.push('Invalid page count');
  if (pages > 99999) errors.push('Page count unrealistic');
  if (cost < 0) errors.push('Negative cost');
  return errors;
}

function validateLogSubmission({ title, date, start, end, mins, bookTotalPages }) {
  const errors = [];
  if (!title) errors.push('No book selected');
  if (!date) errors.push('No date');
  if (isNaN(start) || start < 0) errors.push('Invalid start page');
  if (isNaN(end) || end <= 0) errors.push('Invalid end page');
  if (end <= start) errors.push('End must be > start');
  if (bookTotalPages && end > bookTotalPages) errors.push('End exceeds total');
  if (mins !== null && (isNaN(mins) || mins <= 0)) errors.push('Invalid minutes');
  return errors;
}

console.log('\\n═══ Input Validation Tests ═══\\n');

// ── Book Creation Validation ──────────────────────────────────────────
console.log('Book Creation — Title:');
test('Rejects empty title', () => {
  const errs = validateNewBook({ title: '', pages: 100, cost: 0 });
  assert.ok(errs.includes('Title required'));
});
test('Accepts normal title', () => {
  const errs = validateNewBook({ title: 'The Great Gatsby', pages: 200, cost: 10 });
  assert.equal(errs.length, 0);
});
test('Rejects title > 300 chars', () => {
  const errs = validateNewBook({ title: 'A'.repeat(301), pages: 100, cost: 0 });
  assert.ok(errs.includes('Title too long'));
});
test('Accepts title at exactly 300 chars', () => {
  const errs = validateNewBook({ title: 'A'.repeat(300), pages: 100, cost: 0 });
  assert.ok(!errs.includes('Title too long'));
});
test('Accepts title with emoji and unicode', () => {
  const errs = validateNewBook({ title: '📖 Kitáb-i-Íqán 🌟', pages: 200, cost: 0 });
  assert.equal(errs.length, 0);
});
test('Accepts title with special characters', () => {
  const errs = validateNewBook({ title: '<script>alert("xss")</script>', pages: 200, cost: 0 });
  assert.equal(errs.length, 0, 'Validation should allow; escapeHtml handles display');
});

console.log('\\nBook Creation — Pages:');
test('Rejects 0 pages', () => {
  const errs = validateNewBook({ title: 'Test', pages: 0, cost: 0 });
  assert.ok(errs.includes('Invalid page count'));
});
test('Rejects negative pages', () => {
  const errs = validateNewBook({ title: 'Test', pages: -5, cost: 0 });
  assert.ok(errs.includes('Invalid page count'));
});
test('Rejects NaN pages', () => {
  const errs = validateNewBook({ title: 'Test', pages: NaN, cost: 0 });
  assert.ok(errs.includes('Invalid page count'));
});
test('Accepts 99999 pages', () => {
  const errs = validateNewBook({ title: 'Test', pages: 99999, cost: 0 });
  assert.ok(!errs.includes('Page count unrealistic'));
});
test('Rejects 100000 pages', () => {
  const errs = validateNewBook({ title: 'Test', pages: 100000, cost: 0 });
  assert.ok(errs.includes('Page count unrealistic'));
});
test('Rejects negative cost', () => {
  const errs = validateNewBook({ title: 'Test', pages: 100, cost: -5 });
  assert.ok(errs.includes('Negative cost'));
});

// ── Log Submission Validation ─────────────────────────────────────────
console.log('\\nLog Submission — Page Bounds:');
test('Rejects end page <= start page', () => {
  const errs = validateLogSubmission({ title: 'Book', date: '2026-01-01', start: 50, end: 50, mins: null });
  assert.ok(errs.includes('End must be > start'));
});
test('Rejects negative start page', () => {
  const errs = validateLogSubmission({ title: 'Book', date: '2026-01-01', start: -1, end: 50, mins: null });
  assert.ok(errs.includes('Invalid start page'));
});
test('Rejects end page exceeding book total', () => {
  const errs = validateLogSubmission({
    title: 'Book', date: '2026-01-01',
    start: 0, end: 999,
    mins: null, bookTotalPages: 100
  });
  assert.ok(errs.includes('End exceeds total'));
});
test('Accepts end page equal to book total', () => {
  const errs = validateLogSubmission({
    title: 'Book', date: '2026-01-01',
    start: 90, end: 100,
    mins: null, bookTotalPages: 100
  });
  assert.ok(!errs.includes('End exceeds total'));
});
test('Rejects zero end page', () => {
  const errs = validateLogSubmission({ title: 'Book', date: '2026-01-01', start: 0, end: 0, mins: null });
  assert.ok(errs.includes('Invalid end page'));
});
test('Rejects missing book selection', () => {
  const errs = validateLogSubmission({ title: '', date: '2026-01-01', start: 0, end: 50, mins: null });
  assert.ok(errs.includes('No book selected'));
});
test('Rejects missing date', () => {
  const errs = validateLogSubmission({ title: 'Book', date: '', start: 0, end: 50, mins: null });
  assert.ok(errs.includes('No date'));
});

// Summary
console.log(`\\n══════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════\\n`);

if (failed > 0) process.exit(1);
