import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('===============================================================');
console.log(' 🧪 PWA UPDATE FLOW & PIN UNLOCK PROMPT AUDIT TEST SUITE ');
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

const htmlPath = path.join(rootDir, 'docs', 'index.html');
const firebasePath = path.join(rootDir, 'firebase.json');
const swPath = path.join(rootDir, 'docs', 'sw.js');
const appPath = path.join(rootDir, 'docs', 'app.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const firebaseContent = fs.readFileSync(firebasePath, 'utf8');
const swContent = fs.readFileSync(swPath, 'utf8');
const appContent = fs.readFileSync(appPath, 'utf8');

// 1. Check index.html elements
console.log('▶ 1. PWA Update Prompt Modal & Settings UI Elements');
assert(
  htmlContent.includes('id="pwa-update-modal"') &&
  htmlContent.includes('id="btn-pwa-update-now"') &&
  htmlContent.includes('id="btn-pwa-update-dismiss"'),
  'index.html contains #pwa-update-modal with Update Now and Dismiss buttons'
);

assert(
  htmlContent.includes('id="btn-check-sw-update"') &&
  htmlContent.includes('id="app-version-badge"'),
  'Settings modal contains #btn-check-sw-update button and version badge'
);

// 2. Check Service Worker Message Listener
console.log('\n▶ 2. Service Worker SKIP_WAITING Handler');
assert(
  swContent.includes("event.data.type === 'SKIP_WAITING'") &&
  swContent.includes("self.skipWaiting()"),
  'sw.js contains message event listener for SKIP_WAITING'
);

// 3. Check App.js Update System Functions
console.log('\n▶ 3. App JavaScript Update Manager & PIN Prompt Controller');
assert(
  appContent.includes('function showUpdateModal') &&
  appContent.includes('function setupServiceWorkerUpdateSystem') &&
  appContent.includes('function setupSettingsUpdateInspector'),
  'app.js defines showUpdateModal, setupServiceWorkerUpdateSystem, and setupSettingsUpdateInspector'
);

assert(
  appContent.includes('proceedAfterPinVerification') &&
  appContent.includes('window.swWaitingWorker'),
  'verifyPin flow checks for waiting Service Worker before app initialization'
);

// 4. Check Firebase Hosting Cache Headers
console.log('\n▶ 4. Firebase Hosting Cache-Control Headers');
assert(
  firebaseContent.includes('**/sw.js') &&
  firebaseContent.includes('**/index.html') &&
  firebaseContent.includes('no-cache, no-store, must-revalidate'),
  'firebase.json specifies no-cache, no-store, must-revalidate headers for sw.js and index.html'
);

console.log('\n===============================================================');
console.log(` 🏆 PWA UPDATE FLOW RESULT: ${passedTests} / ${totalTests} TESTS PASSED`);
console.log('===============================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
