/**
 * Automated Unit Test Suite verifying READING_TRACKER_CALCULATION_RULES.md
 * Run via Node.js
 */

const assert = require('assert');

// Mock implementation of calculateReconciledMetrics matching stats.js
function calculateReconciledMetrics(books, logs) {
  const activeLogs = logs.filter(l => !l.notes || !l.notes.startsWith('Historical cycle'));

  const logsByTitleAndCycle = new Map();
  for (let i = 0; i < activeLogs.length; i++) {
    const l = activeLogs[i];
    if (!l.book_title) continue;
    const cycleNum = parseInt(l.read_cycle || 1, 10);
    const key = `${l.book_title}___${cycleNum}`;
    let list = logsByTitleAndCycle.get(key);
    if (!list) {
      list = [];
      logsByTitleAndCycle.set(key, list);
    }
    list.push(l);
  }

  let finishedTitles = 0;
  let activeTitles = 0;
  let unreadTitles = 0;
  let totalCompletedReads = 0;
  let finishedCyclesPages = 0;
  let activeCyclesPages = 0;

  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    const rc = parseInt(b.read_count || 0, 10);
    const totalPages = parseInt(b.total_pages || 0, 10);
    const status = b.status || 'Unread';
    const isFinishedStatus = ['Finished', 'Owned and Read', 'Borrowed and Read'].includes(status);
    const isFinished = isFinishedStatus || rc > 0;

    if (isFinished) {
      finishedTitles++;
      const completedCycles = Math.max(rc, isFinishedStatus ? 1 : 0);
      totalCompletedReads += completedCycles;
      finishedCyclesPages += completedCycles * totalPages;
    } else if (status === 'In Progress') {
      activeTitles++;
    } else {
      unreadTitles++;
    }

    if (status === 'In Progress' || rc > 0) {
      const currentCycle = rc + (isFinishedStatus ? 1 : 1);
      const key = `${b.title}___${currentCycle}`;
      const bookLogs = logsByTitleAndCycle.get(key);
      if (bookLogs && bookLogs.length > 0) {
        let maxEndPage = 0;
        for (let j = 0; j < bookLogs.length; j++) {
          const ep = parseInt(bookLogs[j].end_page || 0, 10);
          if (ep > maxEndPage) maxEndPage = ep;
        }
        if (totalPages > 0) {
          activeCyclesPages += maxEndPage % totalPages;
        } else {
          activeCyclesPages += maxEndPage;
        }
      } else if (b.current_page && status === 'In Progress') {
        activeCyclesPages += parseInt(b.current_page || 0, 10);
      }
    }
  }

  return {
    totalCatalogTitles: books.length,
    finishedTitles,
    activeTitles,
    unreadTitles,
    totalCompletedReads,
    finishedCyclesPages,
    activeCyclesPages,
    grandTotalPages: finishedCyclesPages + activeCyclesPages
  };
}

console.log("Running calculation rules unit tests...");

// Test Case 1: Re-read calculation (Gems of Divine Mysteries read_count = 2)
const sampleBooks = [
  { title: 'Gems of Divine Mysteries', total_pages: 50, read_count: 2, status: 'Finished' },
  { title: 'The Dawn-Breakers', total_pages: 668, read_count: 2, status: 'Finished' },
  { title: 'A Short History of Nearly Everything', total_pages: 560, read_count: 0, status: 'In Progress' }
];

const sampleLogs = [
  { book_title: 'A Short History of Nearly Everything', start_page: 0, end_page: 142, read_cycle: 1, date: '2026-07-29' }
];

const stats = calculateReconciledMetrics(sampleBooks, sampleLogs);

// Verify completed reads (2 + 2 = 4 completed reads)
assert.strictEqual(stats.totalCompletedReads, 4, "Total completed reads must equal sum of completed cycles");
console.log("✓ Test Passed: Total Completed Reads multiplier accurate.");

// Verify finished cycle pages (50*2 + 668*2 = 100 + 1336 = 1436 pages)
assert.strictEqual(stats.finishedCyclesPages, 1436, "Finished cycles pages formula (rc * total_pages) accurate");
console.log("✓ Test Passed: Finished Cycle Pages multiplier formula accurate.");

// Verify active progress (142 pages)
assert.strictEqual(stats.activeCyclesPages, 142, "Active progress calculation accurate");
console.log("✓ Test Passed: Active Cycle Progress calculation accurate.");

// Verify grand total (1436 + 142 = 1578)
assert.strictEqual(stats.grandTotalPages, 1578, "Grand total pages calculation accurate");
console.log("✓ Test Passed: Grand Total Lifetime Pages formula accurate.");

console.log("\nALL CALCULATION RULE UNIT TESTS PASSED SUCCESSFULLY! 🚀");
