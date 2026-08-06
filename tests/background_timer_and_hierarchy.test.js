/**
 * Background Timer & Information Architecture Verification Suite
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

console.log('\n═══ Background Timer & Information Architecture Tests ═══\n');

const htmlContent = fs.readFileSync(path.resolve('docs/index.html'), 'utf-8');
const appJsContent = fs.readFileSync(path.resolve('docs/app.js'), 'utf-8');
const cssContent = fs.readFileSync(path.resolve('docs/style.css'), 'utf-8');

// ── 1. Information Architecture Test ──────────────────────────────────────────
console.log('1. Dashboard Information Hierarchy:');

test('Reading Pace & Momentum is positioned above Heatmap and YoY card', () => {
  const pacePos = htmlContent.indexOf('Reading Pace & Momentum');
  const heatmapPos = htmlContent.indexOf('id="heatmap-container"');
  const yoyPos = htmlContent.indexOf('id="dash-yoy-card"');

  assert.ok(pacePos > 0, 'Pace & Momentum section must exist in index.html');
  assert.ok(heatmapPos > 0, 'Heatmap container must exist in index.html');
  assert.ok(yoyPos > 0, 'YoY card must exist in index.html');

  assert.ok(pacePos < heatmapPos, 'Pace & Momentum section must come BEFORE heatmap-container');
  assert.ok(pacePos < yoyPos, 'Pace & Momentum section must come BEFORE dash-yoy-card');
});

test('Contextual Productivity Matrix is positioned lower in Chapter 4 breakdown section', () => {
  const contextualPos = htmlContent.indexOf('id="contextual-heatmap-card"');
  const chapter4Pos = htmlContent.indexOf('Collection &amp; Historical Breakdown');
  const pacePos = htmlContent.indexOf('Reading Pace & Momentum');

  assert.ok(contextualPos > 0, 'Contextual Productivity Matrix must exist in index.html');
  assert.ok(chapter4Pos > 0, 'Chapter 4 label must exist in index.html');

  assert.ok(contextualPos > chapter4Pos, 'Contextual matrix must come AFTER Chapter 4 label');
  assert.ok(contextualPos > pacePos, 'Contextual matrix must come AFTER Pace & Momentum section');
});

// ── 2. Background Timer & MediaSession Tests ─────────────────────────────────
console.log('\n2. Background Timer & Lock Screen MediaSession Controls:');

test('startBackgroundTimerSession and stopBackgroundTimerSession exist in app.js', () => {
  assert.ok(appJsContent.includes('function startBackgroundTimerSession('), 'startBackgroundTimerSession function must be declared');
  assert.ok(appJsContent.includes('function stopBackgroundTimerSession('), 'stopBackgroundTimerSession function must be declared');
});

test('MediaSession metadata and playback handlers are registered in app.js', () => {
  assert.ok(appJsContent.includes('navigator.mediaSession.metadata'), 'navigator.mediaSession.metadata must be set');
  assert.ok(appJsContent.includes("navigator.mediaSession.playbackState = 'playing'"), 'Playback state playing must be set');
  assert.ok(appJsContent.includes("navigator.mediaSession.setActionHandler('play'"), 'MediaSession play handler registered');
  assert.ok(appJsContent.includes("navigator.mediaSession.setActionHandler('pause'"), 'MediaSession pause handler registered');
});

test('Wall-clock timestamp delta calculation on visibilitychange is active', () => {
  assert.ok(appJsContent.includes("document.addEventListener('visibilitychange'"), 'visibilitychange listener must be attached');
  assert.ok(appJsContent.includes('Math.floor((Date.now() - fullTimerState.startMs) / 1000)'), 'Wall-clock timestamp delta calculation must exist');
});

// ── 3. GPU Acceleration & Tactile Interactivity Tests ─────────────────────────
console.log('\n3. GPU Acceleration & Tactile Micro-Interactions:');

test('GPU acceleration and tactile active scale CSS rules are declared', () => {
  assert.ok(cssContent.includes('.gpu-accelerated'), '.gpu-accelerated class declared in CSS');
  assert.ok(cssContent.includes('transform: scale(0.97) translateZ(0);'), 'Tactile scale feedback rule exists in CSS');
  assert.ok(cssContent.includes('.interactive-ring-container'), '.interactive-ring-container class declared in CSS');
});

test('Activity Rings click handler is wired to trigger haptics and progress summary', () => {
  assert.ok(appJsContent.includes("svgRingContainer.classList.add('interactive-ring-container')"), 'Activity ring container elevated to interactive');
  assert.ok(appJsContent.includes('Activity Rings:'), 'Activity ring click handler presents ring progress info');
});

// ── 4. Dashboard Customization & Extended Features Tests ─────────────────────
console.log('\n4. Dashboard Customization & Extended Features:');

test('Dashboard Layout Preferences controls exist in Settings modal and app.js', () => {
  assert.ok(htmlContent.includes('id="pref-dash-pace"'), 'pref-dash-pace checkbox exists in Settings modal');
  assert.ok(htmlContent.includes('id="pref-dash-heatmap"'), 'pref-dash-heatmap checkbox exists in Settings modal');
  assert.ok(htmlContent.includes('id="pref-dash-yoy"'), 'pref-dash-yoy checkbox exists in Settings modal');
  assert.ok(htmlContent.includes('id="pref-dash-contextual"'), 'pref-dash-contextual checkbox exists in Settings modal');

  assert.ok(appJsContent.includes('function applyDashboardPreferences()'), 'applyDashboardPreferences function declared in app.js');
  assert.ok(appJsContent.includes('localStorage.getItem(\'rt_dash_preferences\')'), 'Dashboard preferences saved to localStorage');
});

test('Smart Completion Predictor Slider exists in Book Detail Modal and app.js', () => {
  assert.ok(htmlContent.includes('id="bd-calc-slider"'), 'bd-calc-slider range input exists in Book Detail modal');
  assert.ok(htmlContent.includes('id="bd-calc-est-date-badge"'), 'Est completion date badge exists');
  assert.ok(appJsContent.includes('function updatePacePrediction('), 'updatePacePrediction function declared in app.js');
});

test('Interactive Monthly Calendar & Streak Saver Vault exists in Goals tab', () => {
  assert.ok(htmlContent.includes('id="goals-calendar-card"'), 'goals-calendar-card exists in Goals tab');
  assert.ok(htmlContent.includes('id="streak-saver-vault-badge"'), 'streak-saver-vault-badge exists');
  assert.ok(appJsContent.includes('function renderStreakCalendar()'), 'renderStreakCalendar function declared in app.js');
});

test('Glassmorphic Quote Card exporter is registered globally', () => {
  assert.ok(appJsContent.includes('window.exportQuoteCard = function('), 'exportQuoteCard function registered on window');
  assert.ok(appJsContent.includes('READING TRACKER • KNOWLEDGE VAULT'), 'Quote card canvas branding header set');
});

// Summary
console.log(`\n══════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════\n`);

if (failed > 0) process.exit(1);
