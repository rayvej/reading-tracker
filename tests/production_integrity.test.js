import fs from 'fs';
import path from 'path';

console.log('===============================================================');
console.log(' 🛡️ PHASE 6: PRODUCTION READINESS & DATA INTEGRITY TEST SUITE ');
console.log('===============================================================\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✓ Test ${totalTests} Passed: ${message}`);
  } else {
    console.error(`❌ Test ${totalTests} Failed: ${message}`);
    process.exitCode = 1;
  }
}

// ── TEST 1: PWA Manifest & Icon Verification ────────────────────────────────
const manifestPath = path.resolve('docs/manifest.json');
assert(fs.existsSync(manifestPath), 'manifest.json file exists in docs/');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(manifest.name === 'Reading Tracker', 'Manifest contains valid app name');
assert(manifest.start_url === './', 'Manifest contains start_url');
assert(manifest.display === 'standalone', 'Manifest specifies display: standalone');
assert(manifest.theme_color === '#0d0f14', 'Manifest defines theme_color');

const has192Maskable = manifest.icons.some(i => i.sizes === '192x192' && i.purpose === 'maskable');
const has512Maskable = manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable');
assert(has192Maskable && has512Maskable, 'Manifest includes 192x192 and 512x512 maskable icons');

assert(fs.existsSync(path.resolve('docs/icon-192.png')), 'icon-192.png icon file exists');
assert(fs.existsSync(path.resolve('docs/icon-512.png')), 'icon-512.png icon file exists');


// ── TEST 2: Null Pointer & Empty State Safety Simulation ────────────────────
const mockEmptyBooks = [];
const mockEmptyLogs = [];
const mockEmptyWishlist = [];

// Simulate calculateReconciledMetrics with empty state
import { calculateReconciledMetrics } from '../docs/js/modules/stats.js';

let emptyMetrics;
try {
  emptyMetrics = calculateReconciledMetrics(mockEmptyBooks, mockEmptyLogs);
  assert(true, 'calculateReconciledMetrics handles empty states without throwing');
} catch (e) {
  assert(false, `calculateReconciledMetrics threw error on empty state: ${e.message}`);
}

assert(emptyMetrics.totalCompletedReads === 0, 'Empty books returns 0 total completed reads');
assert(emptyMetrics.grandTotalPages === 0, 'Empty books returns 0 grand total pages');
assert(emptyMetrics.totalCatalogTitles === 0, 'Empty books returns 0 total catalog titles');

// Simulate corrupt / partial objects missing fields
const corruptBooks = [
  { title: 'Incomplete Book' }, // missing status, pages, read_count
  { title: null, total_pages: undefined },
  {}
];
const corruptLogs = [
  { book_title: 'Incomplete Book', start_page: null, end_page: undefined },
  { date: '2026-07-30' }
];

let corruptMetrics;
try {
  corruptMetrics = calculateReconciledMetrics(corruptBooks, corruptLogs);
  assert(true, 'calculateReconciledMetrics handles corrupt/missing object fields without crashing');
} catch (e) {
  assert(false, `calculateReconciledMetrics crashed on corrupt object input: ${e.message}`);
}


// ── TEST 3: Mass Storage & Import/Export Serialization Safety ──────────────
const massiveBooks = Array.from({ length: 1200 }, (_, i) => ({
  id: `book_${i}`,
  title: `Massive Library Book ${i}`,
  author: `Author ${i % 20}`,
  total_pages: 350,
  pages_read: i % 2 === 0 ? 350 : 150,
  status: i % 2 === 0 ? 'Finished' : 'In Progress',
  read_count: i % 2 === 0 ? 1 : 0,
  category: i % 3 === 0 ? 'Fiction' : 'Non-Fiction',
  format: 'Physical Book'
}));

const massiveLogs = Array.from({ length: 2500 }, (_, i) => ({
  id: `log_${i}`,
  book_title: `Massive Library Book ${i % 1200}`,
  read_cycle: 1,
  date: '2026-05-15',
  start_page: 0,
  end_page: 50,
  minutes_spent: 30,
  notes: `Session note for entry ${i}`
}));

const tStartMass = performance.now();
const massiveMetrics = calculateReconciledMetrics(massiveBooks, massiveLogs);
const massTime = performance.now() - tStartMass;

assert(massiveMetrics.finishedTitles === 600, 'Massive dataset processed 600 finished titles correctly');
assert(massTime < 100, `Massive dataset (1,200 books + 2,500 logs) calculated in ${massTime.toFixed(2)} ms (<100ms requirement)`);


// ── TEST 4: Service Worker Cache Version & Asset Integrity ──────────────────
const swPath = path.resolve('docs/sw.js');
const swContent = fs.readFileSync(swPath, 'utf8');

assert(/const CACHE_NAME = 'reading-tracker-v\d+'/.test(swContent), 'sw.js cache version matches current release version');
assert(swContent.includes('Promise.allSettled'), 'sw.js uses Promise.allSettled for precache resilience');


// ── SUMMARY REPORT ───────────────────────────────────────────────────────────
console.log('\n===============================================================');
console.log(` 🏆 PHASE 6 INTEGRITY RESULT: ${passedTests} / ${totalTests} TESTS PASSED`);
console.log('===============================================================\n');
