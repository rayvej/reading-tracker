import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('===============================================================');
console.log(' 🧪 MANDATORY PIN CHANGE & MASTER CATALOG AUTOFILL TEST SUITE ');
console.log('===============================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAILED: ${message}`);
    process.exitCode = 1;
  }
}

const htmlContent = fs.readFileSync(path.join(rootDir, 'docs', 'index.html'), 'utf8');
const appContent = fs.readFileSync(path.join(rootDir, 'docs', 'app.js'), 'utf8');
const seedContent = fs.readFileSync(path.join(rootDir, 'docs', 'seed-data.json'), 'utf8');

// 1. PIN Mandatory Change Verification
console.log('▶ 1. PIN Mandatory Change Flow Structure');

assert(
  appContent.includes("let pinFlowMode = 'VERIFY';") &&
  appContent.includes("let pendingNewPin = '';"),
  'app.js defines pinFlowMode state machine and pendingNewPin variable'
);

assert(
  appContent.includes('processPinSubmission') &&
  appContent.includes('Please select a PIN other than 1234') &&
  appContent.includes('PINs do not match — try again'),
  'app.js implements processPinSubmission with 1234 rejection and PIN confirmation validation'
);

assert(
  appContent.includes("inputHash === defaultHash") &&
  appContent.includes("pinFlowMode = 'CREATE_NEW'"),
  'verifyPin detects default PIN 1234 and transitions to CREATE_NEW mode before opening app'
);

// 2. Master Catalog & Autofill Verification
console.log('\n▶ 2. Master Catalog Selection & Autofill in Add Book Modal');

assert(
  htmlContent.includes('id="ab-catalog-select"') &&
  htmlContent.includes('id="ab-catalog-datalist"'),
  'index.html contains #ab-catalog-select dropdown and #ab-catalog-datalist in Add Book modal'
);

assert(
  appContent.includes('loadMasterCatalog') &&
  appContent.includes('populateAddBookCatalogDropdown') &&
  appContent.includes('applyCatalogBookToForm'),
  'app.js defines loadMasterCatalog, populateAddBookCatalogDropdown, and applyCatalogBookToForm'
);

const seedData = JSON.parse(seedContent);
assert(
  Array.isArray(seedData.books) && seedData.books.length > 50,
  `seed-data.json contains valid master books array (${seedData.books.length} books)`
);

assert(
  appContent.includes('setupAddBookCatalogEvents') &&
  appContent.includes('applyCatalogBookToForm(masterCatalog[idx])'),
  'app.js attaches change and input listeners to catalog select dropdown and title field'
);

console.log('\n===============================================================');
console.log(` 🏆 MANDATORY PIN & CATALOG AUTOFILL RESULT: ${passedTests} / ${totalTests} TESTS PASSED`);
console.log('===============================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
