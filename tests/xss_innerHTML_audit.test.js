/**
 * XSS innerHTML Injection Audit Test Suite
 * Asserts that malicious HTML payloads injected via book titles or notes
 * are properly escaped and do not execute JavaScript in the DOM.
 */

import assert from 'node:assert/strict';
import { escapeHtml } from '../docs/js/modules/ui.js';

let passed = 0;
let failed = 0;

function test(name, passedCondition, errMsg = '') {
  if (passedCondition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} — ${errMsg}`);
  }
}

console.log('\n═══ XSS innerHTML Injection Audit Suite ═══\n');

const maliciousPayloads = [
  '<script>window.__XSS_FIRED = true;</script>',
  '<img src="invalid" onerror="window.__XSS_FIRED = true;">',
  '<svg onload="window.__XSS_FIRED = true;">',
  '"><script>window.__XSS_FIRED = true;</script>',
  '\' onclick=\'window.__XSS_FIRED = true;\'',
  '<a href="javascript:alert(1)">link</a>'
];

for (const payload of maliciousPayloads) {
  const escaped = escapeHtml(payload);
  test(`Payload safely escaped: ${payload.slice(0, 25)}...`, 
    !escaped.includes('<script') && !escaped.includes('<img') && !escaped.includes('<svg') && !escaped.includes('<a') && !escaped.includes('<iframe'),
    `Escaped output contained unescaped tag: ${escaped}`
  );
}

console.log(`\n══════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════\n`);

if (failed > 0) process.exit(1);
