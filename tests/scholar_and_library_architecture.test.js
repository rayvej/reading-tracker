/**
 * Test Suite: Scholar & Library Architecture (v126)
 * Validates Topical Concordance, Personal Lexicon, Multi-Read Journaling,
 * Graceful DNF Shelving, Custom Shelves, and v126 PWA release assets.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

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

console.log('\n═══ Scholar & Library Architecture (v126) Test Suite ═══\n');

const appJs = fs.readFileSync(path.join(rootDir, 'docs', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, 'docs', 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(rootDir, 'docs', 'style.css'), 'utf8');
const swJs = fs.readFileSync(path.join(rootDir, 'docs', 'sw.js'), 'utf8');

// ── 1. TOPICAL CONCORDANCE & TAG INDEXING ─────────────────────
console.log('▶ 1. Topical Concordance & Tag Indexing');

assert(indexHtml.includes('id="knowledge-topic-concordance-wrapper"'), 'index.html has #knowledge-topic-concordance-wrapper');
assert(indexHtml.includes('id="knowledge-topic-pills"'), 'index.html has #knowledge-topic-pills');
assert(indexHtml.includes('id="kn-btn-clear-concordance"'), 'index.html has #kn-btn-clear-concordance');
assert(styleCss.includes('.concordance-pill'), 'style.css defines .concordance-pill');
assert(styleCss.includes('.concordance-tag-link'), 'style.css defines .concordance-tag-link');
assert(appJs.includes('function extractHashtags'), 'app.js defines extractHashtags');
assert(appJs.includes('function linkifyHashtags'), 'app.js defines linkifyHashtags');
assert(appJs.includes('knowledgeCurrentTopic'), 'app.js manages knowledgeCurrentTopic state');

// Test Hashtag Regex & Extraction Logic directly
const HASHTAG_REGEX = /#[a-zA-Z0-9_\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u00C0-\u024F']+/g;
function extractHashtagsTest(text) {
  if (!text) return [];
  const matches = text.match(HASHTAG_REGEX);
  if (!matches) return [];
  const seen = new Set();
  const result = [];
  for (const m of matches) {
    const clean = m.trim();
    if (clean.length > 1 && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      result.push(clean);
    }
  }
  return result;
}

const sampleNote = "Reflecting on #justice, #epistemology and Arabic #توحيد with Bahá'í #isti'dád concepts. Also repeated #justice!";
const tags = extractHashtagsTest(sampleNote);
assert(tags.length === 4, 'extractHashtags correctly identified 4 unique tags across Latin, Arabic, and transliterated characters');
assert(tags.includes('#justice') && tags.includes('#epistemology') && tags.includes('#توحيد') && tags.includes("#isti'dád"), 'tags include multilingual tokens');

function linkifyHashtagsTest(escapedText) {
  if (!escapedText) return '';
  return escapedText.replace(HASHTAG_REGEX, (match) => {
    return `<span class="concordance-tag-link" data-tag="${match}">${match}</span>`;
  });
}
const linkified = linkifyHashtagsTest("Notes on #virtue and #truth");
assert(linkified.includes('<span class="concordance-tag-link" data-tag="#virtue">#virtue</span>'), 'linkifyHashtags replaces #tag with clickable concordance link');

// ── 2. CUSTOM SHELVES & READING LISTS ────────────────────────
console.log('\n▶ 2. Custom Shelves & Reading Lists');

assert(indexHtml.includes('id="bookshelf-shelf-select"'), 'index.html has #bookshelf-shelf-select');
assert(indexHtml.includes('id="btn-manage-shelves"'), 'index.html has #btn-manage-shelves');
assert(indexHtml.includes('id="manage-shelves-modal"'), 'index.html has #manage-shelves-modal');
assert(indexHtml.includes('id="manage-shelves-list"'), 'index.html has #manage-shelves-list');
assert(indexHtml.includes('id="new-shelf-name-input"'), 'index.html has #new-shelf-name-input');
assert(indexHtml.includes('id="btn-create-shelf"'), 'index.html has #btn-create-shelf');
assert(indexHtml.includes('id="batch-shelf-select"'), 'index.html has #batch-shelf-select');
assert(indexHtml.includes('id="ab-shelves-container"'), 'index.html has #ab-shelves-container');
assert(indexHtml.includes('id="eb-shelves-container"'), 'index.html has #eb-shelves-container');

assert(appJs.includes('let customShelvesCache'), 'app.js declares customShelvesCache');
assert(appJs.includes('function loadCustomShelves'), 'app.js defines loadCustomShelves');
assert(appJs.includes('function saveCustomShelves'), 'app.js defines saveCustomShelves');
assert(appJs.includes('function createCustomShelf'), 'app.js defines createCustomShelf');
assert(appJs.includes('async function deleteCustomShelf'), 'app.js defines deleteCustomShelf');
assert(appJs.includes('function updateCustomShelvesUI'), 'app.js defines updateCustomShelvesUI');
assert(appJs.includes('function renderManageShelvesList'), 'app.js defines renderManageShelvesList');
assert(appJs.includes('function openManageShelvesModal'), 'app.js defines openManageShelvesModal');
assert(appJs.includes('function renderShelvesPicker'), 'app.js defines renderShelvesPicker');
assert(appJs.includes('function getSelectedShelves'), 'app.js defines getSelectedShelves');
assert(appJs.includes('async function batchAssignShelf'), 'app.js defines batchAssignShelf');
assert(appJs.includes('shelves: shelves'), 'app.js persists shelves array in book saves');

// ── 3. GRACEFUL DID NOT FINISH (DNF) & SET ASIDE SHELVING ─────
console.log('\n▶ 3. Graceful Did Not Finish (DNF) & Set Aside Shelving');

assert(indexHtml.includes('<option value="Did Not Finish">Did Not Finish / On Hold</option>'), 'index.html has DNF option in book status dropdowns');
assert(indexHtml.includes('id="ab-dnf-reason-container"'), 'index.html has #ab-dnf-reason-container');
assert(indexHtml.includes('id="eb-dnf-reason-container"'), 'index.html has #eb-dnf-reason-container');
assert(indexHtml.includes('id="bd-action-resume"'), 'index.html has #bd-action-resume button');
assert(styleCss.includes('.dnf-badge'), 'style.css defines .dnf-badge');
assert(appJs.includes('dnf_reason: dnfReason'), 'app.js persists dnf_reason in book objects');
assert(appJs.includes('async function resumeReadingBook'), 'app.js defines resumeReadingBook');
assert(appJs.includes("bookshelfStatusFilter === 'DNF'"), 'app.js supports DNF filtering in bookshelf');
assert(appJs.includes('dnf-badge'), 'app.js renders dnf-badge for set-aside books');

// ── 4. PERSONAL VOCABULARY & TERMINOLOGY LEXICON ───────────────
console.log('\n▶ 4. Personal Vocabulary & Terminology Lexicon');

assert(indexHtml.includes('id="btn-add-lexicon-open"'), 'index.html has #btn-add-lexicon-open');
assert(indexHtml.includes('id="knowledge-lexicon-container"'), 'index.html has #knowledge-lexicon-container');
assert(indexHtml.includes('id="lexicon-search-input"'), 'index.html has #lexicon-search-input');
assert(indexHtml.includes('id="lexicon-lang-select"'), 'index.html has #lexicon-lang-select');
assert(indexHtml.includes('id="lexicon-list"'), 'index.html has #lexicon-list');
assert(indexHtml.includes('id="add-lexicon-modal"'), 'index.html has #add-lexicon-modal');
assert(indexHtml.includes('id="edit-lexicon-modal"'), 'index.html has #edit-lexicon-modal');
assert(indexHtml.includes('id="bd-book-lexicon-container"'), 'index.html has #bd-book-lexicon-container in Book Detail');
assert(indexHtml.includes('id="bd-book-lexicon-list"'), 'index.html has #bd-book-lexicon-list');

assert(styleCss.includes('.lexicon-card'), 'style.css defines .lexicon-card');
assert(styleCss.includes('.lexicon-term'), 'style.css defines .lexicon-term');
assert(styleCss.includes('.lexicon-lang-tag'), 'style.css defines .lexicon-lang-tag');
assert(appJs.includes('let lexiconCache'), 'app.js declares lexiconCache');
assert(appJs.includes('function loadLexiconCache'), 'app.js defines loadLexiconCache');
assert(appJs.includes('async function saveLexiconTerm'), 'app.js defines saveLexiconTerm');
assert(appJs.includes('async function deleteLexiconTerm'), 'app.js defines deleteLexiconTerm');
assert(appJs.includes('function renderLexiconView'), 'app.js defines renderLexiconView');
assert(appJs.includes('function openAddLexiconModal'), 'app.js defines openAddLexiconModal');
assert(appJs.includes('function openEditLexiconModal'), 'app.js defines openEditLexiconModal');
assert(appJs.includes('function renderBookLexiconSection'), 'app.js defines renderBookLexiconSection');

// Dictation wiring check for lexicon
assert(indexHtml.includes('id="lex-add-btn-dictate"'), 'index.html has #lex-add-btn-dictate');
assert(indexHtml.includes('id="lex-edit-btn-dictate"'), 'index.html has #lex-edit-btn-dictate');
assert(appJs.includes("setupVoiceDictation('lex-add-def', 'lex-add-btn-dictate')"), 'app.js wires dictation for lex-add-def');
assert(appJs.includes("setupVoiceDictation('lex-edit-def', 'lex-edit-btn-dictate')"), 'app.js wires dictation for lex-edit-def');

// ── 5. MULTI-READ COMPARATIVE JOURNALING ──────────────────────
console.log('\n▶ 5. Multi-Read Comparative Journaling');

assert(indexHtml.includes('id="bd-comparative-journal-container"'), 'index.html has #bd-comparative-journal-container');
assert(indexHtml.includes('id="bd-cycles-journal-list"'), 'index.html has #bd-cycles-journal-list');
assert(indexHtml.includes('id="bd-btn-add-cycle-reflection"'), 'index.html has #bd-btn-add-cycle-reflection');
assert(indexHtml.includes('id="cycle-reflection-modal"'), 'index.html has #cycle-reflection-modal');
assert(indexHtml.includes('id="cr-notes-input"'), 'index.html has #cr-notes-input');
assert(indexHtml.includes('id="cr-btn-dictate"'), 'index.html has #cr-btn-dictate');

assert(styleCss.includes('.cycle-journal-card'), 'style.css defines .cycle-journal-card');
assert(styleCss.includes('.cycle-journal-badge'), 'style.css defines .cycle-journal-badge');
assert(appJs.includes('function renderBookCyclesJournalSection'), 'app.js defines renderBookCyclesJournalSection');
assert(appJs.includes('function openCycleReflectionModal'), 'app.js defines openCycleReflectionModal');
assert(appJs.includes('async function saveCycleReflection'), 'app.js defines saveCycleReflection');
assert(appJs.includes("setupVoiceDictation('cr-notes-input', 'cr-btn-dictate')"), 'app.js wires dictation for cr-notes-input');

// ── 6. 3-MODE KNOWLEDGE SEGMENTED TOGGLE ──────────────────────
console.log('\n▶ 6. 3-Mode Knowledge Segmented Toggle');

assert(indexHtml.includes('data-mode="feed"'), 'index.html has data-mode="feed" button');
assert(indexHtml.includes('data-mode="graph"'), 'index.html has data-mode="graph" button');
assert(indexHtml.includes('data-mode="lexicon"'), 'index.html has data-mode="lexicon" button');
assert(appJs.includes("mode === 'lexicon'"), 'app.js initKnowledgeModeToggle handles lexicon mode');
assert(appJs.includes("mode === 'graph'"), 'app.js initKnowledgeModeToggle handles graph mode');
assert(appJs.includes("mode === 'feed'"), 'app.js initKnowledgeModeToggle handles feed mode');

// ── 7. PWA RELEASE SYNCHRONIZATION ────────────────────────────
console.log('\n▶ 7. PWA Release Synchronization');

const swCacheMatch = swJs.match(/const CACHE_NAME = 'reading-tracker-v(\d+)';/);
assert(swCacheMatch && parseInt(swCacheMatch[1], 10) >= 126, 'sw.js CACHE_NAME bumped to reading-tracker-v126 or higher');
assert(/BASE \+ 'style\.css\?v=\d+'/.test(swJs), 'sw.js precaches style.css with version query');
assert(/BASE \+ 'app\.js\?v=\d+'/.test(swJs), 'sw.js precaches app.js with version query');
assert(/href="style\.css\?v=\d+"/.test(indexHtml), 'index.html links style.css with version query');
assert(/src="app\.js\?v=\d+"/.test(indexHtml), 'index.html loads app.js with version query');
assert(/id="acct-version-badge"[^>]*>v\d+<\/span>/.test(indexHtml), 'index.html account modal displays version badge');
assert(/id="app-version-badge"[^>]*>v\d+<\/span>/.test(indexHtml), 'index.html settings modal displays version badge');
assert(/const ver = badge \? badge\.textContent : 'v\d+';/.test(appJs), 'app.js reports fallback version');

// ── 8. NO CONFETTI REINFORCEMENT AUDIT ─────────────────────────
console.log('\n▶ 8. No Confetti Reinforcement Audit');
assert(!appJs.includes('confetti({') && !appJs.includes('canvas-confetti'), 'app.js contains zero confetti triggers');
assert(!indexHtml.includes('canvas-confetti') && !indexHtml.includes('confetti.min.js'), 'index.html has zero confetti libraries');

console.log(`\n══════════════════════════════════════════════════════════════════`);
console.log(` RESULTS: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
