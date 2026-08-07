/**
 * Unit Test Suite: Core Business Logic (business_logic.test.js)
 */

import {
  calculateBookProgress,
  determineBookStatus,
  formatReadingTime,
  calculateReadingPace,
  estimateCompletionDays
} from '../docs/js/modules/business-logic.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log('\n═══ Core Business Logic Unit Tests ═══\n');

console.log('Book Progress Calculations:');
const p1 = calculateBookProgress(50, 200);
assert(p1.percentage === 25, 'Calculates 25% progress correctly');
assert(p1.remaining === 150, 'Calculates 150 pages remaining');
assert(p1.isComplete === false, 'Identifies incomplete book');

const p2 = calculateBookProgress(200, 200);
assert(p2.percentage === 100, 'Calculates 100% progress correctly');
assert(p2.remaining === 0, 'Calculates 0 pages remaining');
assert(p2.isComplete === true, 'Identifies completed book');

const p3 = calculateBookProgress(250, 200);
assert(p3.percentage === 100, 'Caps percentage at 100% when current > total');
assert(p3.remaining === 0, 'Caps remaining pages at 0 when current > total');

console.log('\nBook Status Determination:');
assert(determineBookStatus(0, 300, 0) === 'Not Started', 'Zero progress returns Not Started');
assert(determineBookStatus(45, 300, 0) === 'In Progress', 'Partial progress returns In Progress');
assert(determineBookStatus(300, 300, 0) === 'Finished', 'Full page progress returns Finished');
assert(determineBookStatus(0, 300, 1) === 'Finished', 'Read count > 0 returns Finished');

console.log('\nReading Time Formatting:');
assert(formatReadingTime(0) === '0m', 'Formats 0 mins as 0m');
assert(formatReadingTime(45) === '45m', 'Formats 45 mins as 45m');
assert(formatReadingTime(60) === '1h', 'Formats 60 mins as 1h');
assert(formatReadingTime(135) === '2h 15m', 'Formats 135 mins as 2h 15m');

console.log('\nReading Pace & Completion Estimates:');
assert(calculateReadingPace(30, 60) === 30, '30 pages in 60 mins is 30 pages/hr');
assert(calculateReadingPace(15, 30) === 30, '15 pages in 30 mins is 30 pages/hr');
assert(calculateReadingPace(0, 30) === 0, '0 pages returns 0 pace');
assert(estimateCompletionDays(100, 25) === 4, '100 pages at 25/day is 4 days');
assert(estimateCompletionDays(10, 25) === 1, '10 pages at 25/day rounds up to 1 day');
assert(estimateCompletionDays(0, 25) === 0, '0 remaining pages is 0 days');

console.log('\n══════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
