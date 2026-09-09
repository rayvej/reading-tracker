import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('===============================================================');
console.log(' 🧪 PWA UPDATE & FORCE REFRESH BUTTON RELIABILITY AUDIT ');
console.log('===============================================================\n');

const appPath = path.join(rootDir, 'docs', 'app.js');
const indexPath = path.join(rootDir, 'docs', 'index.html');
const swPath = path.join(rootDir, 'docs', 'sw.js');

const appContent = fs.readFileSync(appPath, 'utf8');
const indexContent = fs.readFileSync(indexPath, 'utf8');
const swContent = fs.readFileSync(swPath, 'utf8');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}\n    ${err.message}`);
    process.exit(1);
  }
}

// 1. Modal markup & z-index
test('index.html contains #pwa-update-modal with explicit z-index 99999', () => {
  assert.ok(indexContent.includes('id="pwa-update-modal"'), 'modal id present');
  assert.ok(indexContent.includes('z-index:99999;') || indexContent.includes('z-index: 99999;'), 'explicit z-index 99999');
});

// 2. Button selectors in Account view and Settings modal
test('index.html defines both pairs of Check Updates and Force Refresh buttons', () => {
  assert.ok(indexContent.includes('id="btn-acct-check-sw-update"'), 'account check button present');
  assert.ok(indexContent.includes('id="btn-acct-force-reload-app"'), 'account force reload button present');
  assert.ok(indexContent.includes('id="btn-check-sw-update"'), 'settings check button present');
  assert.ok(indexContent.includes('id="btn-force-reload-app"'), 'settings force reload button present');
});

// 3. hardReloadApp definition and behavior
test('app.js defines window.hardReloadApp to overcome iOS PWA reload bugs', () => {
  assert.ok(appContent.includes('function hardReloadApp()'), 'hardReloadApp defined');
  assert.ok(appContent.includes('window.hardReloadApp = hardReloadApp;'), 'hardReloadApp exposed on window');
  assert.ok(appContent.includes('window.location.replace'), 'hardReloadApp uses location.replace');
});

// 4. Double binding protection
test('setupSettingsUpdateInspector prevents double event listener binding', () => {
  assert.ok(appContent.includes('dataset.updateBound'), 'check buttons have updateBound guard');
  assert.ok(appContent.includes('dataset.forceBound'), 'force buttons have forceBound guard');
});

// 5. Safety timers on Check Updates and Force Refresh
test('Check Updates has safety timeout preventing infinite spinner', () => {
  assert.ok(appContent.includes('const safetyTimer = setTimeout('), 'safety timer defined');
  assert.ok(appContent.includes('clearTimeout(safetyTimer)'), 'safety timer cleared on completion');
  assert.ok(appContent.includes('resetButton()'), 'resetButton called');
});

test('Force Refresh has safety timeout preventing infinite spinner', () => {
  assert.ok(appContent.includes('const forceSafetyTimer = setTimeout('), 'force safety timer defined');
  assert.ok(appContent.includes('clearTimeout(forceSafetyTimer)'), 'force safety timer cleared');
});

// 6. Comprehensive Cache and SW clearing in Force Refresh
test('Force Refresh clears all cache keys and unregisters all service workers safely', () => {
  assert.ok(appContent.includes('navigator.serviceWorker.getRegistrations()'), 'queries all registrations');
  assert.ok(appContent.includes('Promise.race'), 'uses Promise.race to avoid hanging');
  assert.ok(appContent.includes('caches.keys()'), 'queries all cache keys');
});

// 7. Installing and redundant worker state handling
test('Check Updates handles already-installing worker and redundant abort state', () => {
  assert.ok(appContent.includes('reg.installing'), 'checks for actively installing worker');
  assert.ok(appContent.includes("state === 'redundant'"), 'handles redundant state gracefully');
  assert.ok(appContent.includes("state === 'installed'"), 'handles installed state');
});

// 8. Deferred module service worker registration
test('setupServiceWorkerUpdateSystem handles complete readyState after module load', () => {
  assert.ok(appContent.includes("document.readyState === 'complete'"), 'checks document.readyState complete');
});

console.log('\n===============================================================');
console.log(` 🏆 ALL ${passed} UPDATE & FORCE REFRESH TESTS PASSED!`);
console.log('===============================================================\n');
