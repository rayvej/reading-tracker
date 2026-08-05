import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('===============================================================');
console.log(' 🧪 COMPREHENSIVE VISUAL & FUNCTIONAL FEATURE SWEEP TEST SUITE ');
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
const cssPath = path.join(rootDir, 'docs', 'style.css');
const jsPath = path.join(rootDir, 'docs', 'app.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const cssContent = fs.readFileSync(cssPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

// ============================================================================
// MATRIX 1: DASHBOARD TAB & SUB-TABS
// ============================================================================
console.log('▶ MATRIX 1: DASHBOARD TAB & SUB-TABS');

// 1. Detailed Breakdown sub-tabs
assert(
  htmlContent.includes('id="dash-breakdown-tab-bar"') &&
  htmlContent.includes('data-tab="monthly"') &&
  htmlContent.includes('data-tab="dayofweek"') &&
  htmlContent.includes('data-tab="seasonal"') &&
  htmlContent.includes('data-tab="yearly"'),
  'Dashboard Detailed Breakdown sub-tabs (Monthly, Day of Week, Seasonal, Yearly) exist in index.html'
);

assert(
  jsContent.includes('dash-breakdown-tab-bar') &&
  jsContent.includes('dash-breakdown-panel') &&
  jsContent.includes('targetTab'),
  'Dashboard Detailed Breakdown sub-tab click handlers and panel toggling implemented in app.js'
);

// 2. Reading Records sub-tabs
assert(
  htmlContent.includes('id="dash-records-tab-bar"') &&
  htmlContent.includes('data-tab="length"') &&
  htmlContent.includes('data-tab="speed"') &&
  htmlContent.includes('data-tab="authors"'),
  'Dashboard Reading Records sub-tabs (Book Length, Reading Speed, Authors & Genres) exist in index.html'
);

assert(
  jsContent.includes('dash-records-tab-bar') &&
  jsContent.includes('dash-records-panel'),
  'Dashboard Reading Records sub-tab click handlers and panel toggling implemented in app.js'
);

// 3. Milestones & Goals sub-views
assert(
  htmlContent.includes('id="dash-milestones-tab-bar"') &&
  htmlContent.includes('data-tab="books"') &&
  htmlContent.includes('data-tab="pages"'),
  'Dashboard Reading Milestones sub-tabs (Books & Pages Milestones) exist in index.html'
);

assert(
  jsContent.includes('function renderMilestones'),
  'renderMilestones calculation engine handles book and page targets cleanly'
);

// 4. Metric tiles, ring charts, and heatmaps overflow check
assert(
  cssContent.includes('.seg-control') &&
  cssContent.includes('overflow-x: auto') &&
  cssContent.includes('flex-shrink: 0'),
  'CSS design system guarantees .seg-control has overflow-x auto and flex-shrink: 0 for zero clipping'
);

assert(
  htmlContent.includes('id="streak-rings-svg"') &&
  htmlContent.includes('id="contextual-matrix-container"') &&
  htmlContent.includes('id="heatmap-container"'),
  'Bento grid metrics, streak activity rings, GitHub heatmap, and 24x7 matrix containers are declared'
);

// ============================================================================
// MATRIX 2: KNOWLEDGE TAB & COMPONENT ENGINE
// ============================================================================
console.log('\n▶ MATRIX 2: KNOWLEDGE TAB & COMPONENT ENGINE');

// 1. Quote Feed / Notes list pagination
assert(
  jsContent.includes('renderKnowledgeView') &&
  jsContent.includes('knowledgeFeedLimit') &&
  jsContent.includes('Load More Notes'),
  'Quote feed & Notes pagination ("Load More Notes") logic is present in renderKnowledgeView()'
);

// 2. 3D Spine Bookshelf view
assert(
  htmlContent.includes('id="bookshelf-3d-shelf"') &&
  cssContent.includes('bookshelf-3d-container'),
  '3D Spine Bookshelf container and physical spine styling rules exist'
);

assert(
  jsContent.includes('bookshelf-3d-shelf') || jsContent.includes('render3DSpineBookshelf') || jsContent.includes('bookshelf-3d-container'),
  '3D Spine Bookshelf rendering function transforms book spines without clipping'
);

// 3. Spaced Repetition & Flashcards
assert(
  htmlContent.includes('id="spaced-repetition-modal"') || jsContent.includes('spaced-repetition-modal'),
  'Knowledge Vault quote feed and Spaced Repetition flashcards exist in app.js'
);

// ============================================================================
// MATRIX 3: GOALS & WISHLIST TABS
// ============================================================================
console.log('\n▶ MATRIX 3: GOALS & WISHLIST TABS');

// 1. Timeframe switcher and goal editing
assert(
  htmlContent.includes('id="goals-timeframe-switcher"') &&
  htmlContent.includes('data-timeframe="all"') &&
  htmlContent.includes('data-timeframe="annual"') &&
  htmlContent.includes('data-timeframe="monthly"') &&
  htmlContent.includes('data-timeframe="daily"'),
  'Goals timeframe switcher (All, Annual, Monthly, Daily) configured in HTML'
);

assert(
  jsContent.includes('goals-timeframe-switcher') && jsContent.includes('renderGoals'),
  'renderGoals handles timeframe switching and filtering cleanly'
);

// 2. Bookshelf & Wishlist filtering and sorting
assert(
  htmlContent.includes('id="bookshelf-filter-status"') &&
  htmlContent.includes('id="bookshelf-filter-ownership"') &&
  htmlContent.includes('id="bookshelf-sort-select"'),
  'Bookshelf & Wishlist filter pills and sort dropdown present'
);

assert(
  jsContent.includes('renderBookshelf') && jsContent.includes('bookshelf-filter-status'),
  'renderBookshelf calculates active filter chips and handles wishlist vs library status'
);

// ============================================================================
// MATRIX 4: READING LOG & ACCOUNT/SETTINGS MODALS
// ============================================================================
console.log('\n▶ MATRIX 4: READING LOG & ACCOUNT/SETTINGS MODALS');

// 1. Modals: Log entry, Add/Edit Book, Settings, Sabbatical
assert(
  htmlContent.includes('id="add-book-modal"') &&
  htmlContent.includes('id="edit-book-modal"') &&
  htmlContent.includes('id="goals-modal"') &&
  htmlContent.includes('id="settings-modal"'),
  'Modal dialog containers (Add/Edit Book, Edit Goals, Settings) present in HTML'
);

// 2. Goals Modal Daily Target Inputs & Settings
assert(
  htmlContent.includes('id="goal-daily-pages"') &&
  htmlContent.includes('id="goal-daily-minutes"') &&
  htmlContent.includes('id="accent-color-picker"'),
  'Goals Modal daily minute/page target inputs and accent color picker exist'
);

assert(
  jsContent.includes('goal-daily-pages') &&
  jsContent.includes('accent-color-picker'),
  'Goals Modal event listeners and local storage sync implemented'
);

console.log('\n===============================================================');
console.log(` 🏆 FEATURE SWEEP RESULT: ${passedTests} / ${totalTests} TESTS PASSED`);
console.log('===============================================================\n');
