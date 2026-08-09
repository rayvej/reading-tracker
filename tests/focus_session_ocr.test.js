import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('===============================================================');
console.log(' 🧪 FOCUS SESSION OCR SCAN INTEGRATION TEST SUITE ');
console.log('===============================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`✓ Test ${totalTests} Passed: ${message}`);
    passedTests++;
  } else {
    console.error(`❌ Test ${totalTests} FAILED: ${message}`);
    process.exitCode = 1;
  }
}

const htmlPath = path.join(rootDir, 'docs', 'index.html');
const jsPath = path.join(rootDir, 'docs', 'app.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

// 1. Structural Checks in HTML
console.log('▶ STEP 1: HTML Element Verification');

assert(
  htmlContent.includes('id="timer-btn-scan-ocr"'),
  'Focus session Scan Page OCR button (timer-btn-scan-ocr) exists in index.html'
);

assert(
  htmlContent.includes('id="timer-scan-page-file"'),
  'Focus session camera/file input (timer-scan-page-file) exists in index.html'
);

assert(
  htmlContent.includes('id="timer-ocr-loading-spinner"'),
  'Focus session AI transcribing overlay spinner (timer-ocr-loading-spinner) exists in index.html'
);

assert(
  htmlContent.includes('id="timer-btn-photo-ocr"'),
  'Focus session photo preview OCR button (timer-btn-photo-ocr) exists in index.html'
);

// 2. Logic & Context Checks in JS
console.log('\n▶ STEP 2: JS Handler & Functionality Verification');

assert(
  jsContent.includes('timer-scan-page-file') && jsContent.includes('timer-btn-scan-ocr'),
  'app.js binds timer-btn-scan-ocr to timer-scan-page-file'
);

assert(
  jsContent.includes('isTimerContext') && jsContent.includes('timer-input-notes'),
  'handlePageScan dynamically identifies timer context and targets timer-input-notes'
);

assert(
  jsContent.includes("modal.dataset.targetContext = isTimer ? 'timer'") || jsContent.includes("modal.dataset.targetContext = 'timer'"),
  'openVerificationModal preserves timer context on modal dataset'
);

assert(
  jsContent.includes('commitVerifiedScan') && jsContent.includes('timer-input-end-page'),
  'commitVerifiedScan correctly updates timer-input-notes and timer-input-end-page when in timer context'
);

assert(
  jsContent.includes('newQuoteSnippet = `[Scanned Page Quote]:\\n"${textVal}"`'),
  'commitVerifiedScan formats page quote transcriptions cleanly'
);

assert(
  jsContent.includes('photoOcrBtn') && jsContent.includes('timer-btn-photo-ocr'),
  'app.js handles OCR transcription directly from focus session attached photo'
);

console.log(`\n===============================================================`);
console.log(` RESULTS: ${passedTests} / ${totalTests} Tests Passed`);
console.log(`===============================================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}
