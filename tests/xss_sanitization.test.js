/**
 * XSS Sanitization Test Suite
 * Tests the escapeHtml() function against all XSS attack vectors
 */

import assert from 'node:assert/strict';
import { escapeHtml } from '../docs/js/modules/ui.js';

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
    console.log(`    Expected: ${e.expected}`);
    console.log(`    Actual:   ${e.actual}`);
  }
}

console.log('\\n═══ XSS Sanitization Tests ═══\\n');

// Basic HTML Entity Encoding
console.log('Basic HTML Entities:');
test('Escapes ampersand', () => {
  assert.equal(escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry');
});
test('Escapes less-than', () => {
  assert.equal(escapeHtml('a < b'), 'a &lt; b');
});
test('Escapes greater-than', () => {
  assert.equal(escapeHtml('a > b'), 'a &gt; b');
});
test('Escapes double quotes', () => {
  assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
});
test('Escapes single quotes', () => {
  assert.equal(escapeHtml("it's"), "it&#039;s");
});

// Script Injection
console.log('\\nScript Injection:');
test('Blocks basic script tag', () => {
  const input = '<script>alert(1)</script>';
  const result = escapeHtml(input);
  assert.ok(!result.includes('<script>'), 'Should not contain raw script tag');
  assert.equal(result, '&lt;script&gt;alert(1)&lt;/script&gt;');
});

// Event Handler Injection
console.log('\\nEvent Handler Injection:');
test('Blocks img onerror injection', () => {
  const input = '<img src=x onerror=alert(1)>';
  const result = escapeHtml(input);
  assert.ok(!result.includes('<img'), 'Should not contain raw img tag');
});
test('Blocks svg onload injection', () => {
  const input = '<svg onload=alert(1)>';
  const result = escapeHtml(input);
  assert.ok(!result.includes('<svg'), 'Should not contain raw svg tag');
});
test('Blocks iframe injection', () => {
  const input = '<iframe src="javascript:alert(1)">';
  const result = escapeHtml(input);
  assert.ok(!result.includes('<iframe'), 'Should not contain raw iframe tag');
});

// Nested and Complex Attacks
console.log('\\nNested/Complex Attacks:');
test('Handles nested entities', () => {
  const input = '&lt;script&gt;';
  const result = escapeHtml(input);
  assert.equal(result, '&amp;lt;script&amp;gt;');
});
test('Handles all 5 entities in one string', () => {
  const input = `<div class="test" data-val='a&b'>`;
  const result = escapeHtml(input);
  assert.ok(!result.includes('<div'), 'Should escape all angle brackets');
  assert.ok(result.includes('&amp;'), 'Should escape ampersands');
});

// Non-String Inputs
console.log('\\nNon-String Inputs:');
test('Returns null for null input', () => {
  assert.equal(escapeHtml(null), null);
});
test('Returns undefined for undefined input', () => {
  assert.equal(escapeHtml(undefined), undefined);
});
test('Returns number for number input', () => {
  assert.equal(escapeHtml(42), 42);
});
test('Returns empty string for empty string', () => {
  assert.equal(escapeHtml(''), '');
});

// Unicode and Emoji Preservation
console.log('\\nUnicode & Emoji Preservation:');
test('Preserves emoji characters', () => {
  assert.equal(escapeHtml('📚 Book 🎉'), '📚 Book 🎉');
});
test('Preserves Arabic text', () => {
  assert.equal(escapeHtml('كتاب'), 'كتاب');
});
test('Preserves accented characters', () => {
  const input = 'Bahá' + "'" + 'í';
  const result = escapeHtml(input);
  assert.ok(result.includes('Bahá'), 'Should preserve accented chars');
  assert.ok(result.includes('í'), 'Should preserve accented i');
});

// Long Strings
console.log('\\nLong Strings:');
test('Handles very long strings (10000 chars)', () => {
  const longStr = '<script>'.repeat(1250);
  const result = escapeHtml(longStr);
  assert.ok(!result.includes('<script>'), 'Should escape all script tags');
  assert.ok(result.length > longStr.length, 'Escaped string should be longer');
});

// Summary
console.log(`\\n══════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════\\n`);

if (failed > 0) process.exit(1);
