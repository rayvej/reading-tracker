import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('===============================================================');
console.log(' 🧪 UNIVERSAL DICTATION, PHOTO UPLOAD, SCANNING & NOTES EDIT/DELETE TEST SUITE ');
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

// 1. Check Voice Dictation in all logging interfaces
console.log('▶ STEP 1: Universal Voice Dictation Verification');
const dictationPairs = [
  { input: 'timer-input-notes', btn: 'timer-btn-dictate', label: 'Focus Timer' },
  { input: 'log-notes', btn: 'log-btn-dictate', label: 'Quick Log' },
  { input: 'edit-log-notes', btn: 'edit-log-btn-dictate', label: 'Edit Log Modal' },
  { input: 'qn-text-input', btn: 'qn-btn-dictate', label: 'Quick Note Modal' },
  { input: 'reflection-note-text', btn: 'reflection-btn-dictate', label: 'Post-Session Reflection Modal' },
  { input: 'edit-note-text', btn: 'edit-note-btn-dictate', label: 'Edit Note Modal' },
  { input: 'ab-notes', btn: 'ab-btn-dictate', label: 'Add Book Modal' },
  { input: 'eb-notes', btn: 'eb-btn-dictate', label: 'Edit Book Modal' }
];

dictationPairs.forEach(({ input, btn, label }) => {
  assert(
    htmlContent.includes(`id="${input}"`) && htmlContent.includes(`id="${btn}"`),
    `${label} has both input (#${input}) and dictate button (#${btn}) in index.html`
  );
  assert(
    jsContent.includes(`setupVoiceDictation('${input}', '${btn}')`),
    `${label} dictation is wired in app.js setupVoiceDictation`
  );
});

// 2. Check Photo Upload & OCR in all logging interfaces
console.log('\n▶ STEP 2: Universal Photo Upload & OCR Verification');
const photoUploadInterfaces = [
  {
    label: 'Quick Log',
    btn: 'log-btn-add-photo',
    file: 'log-photo-file',
    preview: 'log-photo-preview-box',
    ocrBtn: 'log-btn-photo-ocr'
  },
  {
    label: 'Edit Log Modal',
    btn: 'edit-log-btn-add-photo',
    file: 'edit-log-photo-file',
    preview: 'edit-log-photo-preview-box',
    ocrBtn: 'edit-log-btn-photo-ocr'
  },
  {
    label: 'Focus Timer',
    btn: 'timer-btn-add-photo',
    file: 'timer-photo-file-input',
    preview: 'timer-photo-preview-box',
    ocrBtn: 'timer-btn-photo-ocr'
  },
  {
    label: 'Quick Note Modal',
    btn: 'qn-photo-trigger',
    file: 'qn-photo-file',
    preview: 'qn-photo-preview-box',
    ocrBtn: 'qn-btn-ocr'
  },
  {
    label: 'Post-Session Reflection Modal',
    btn: 'reflection-btn-add-photo',
    file: 'reflection-photo-file',
    preview: 'reflection-photo-preview-box',
    ocrBtn: 'reflection-btn-photo-ocr'
  },
  {
    label: 'Edit Note Modal',
    btn: 'edit-note-btn-add-photo',
    file: 'edit-note-photo-file',
    preview: 'edit-note-photo-preview-box',
    ocrBtn: 'edit-note-btn-photo-ocr'
  }
];

photoUploadInterfaces.forEach(({ label, btn, file, preview, ocrBtn }) => {
  assert(
    htmlContent.includes(`id="${btn}"`) &&
    htmlContent.includes(`id="${file}"`) &&
    htmlContent.includes(`id="${preview}"`) &&
    htmlContent.includes(`id="${ocrBtn}"`),
    `${label} has complete photo upload markup (btn, file, preview, OCR)`
  );
});

// 3. Check Page Scanning in all logging interfaces
console.log('\n▶ STEP 3: Universal Page Scanning Verification');
const scanInterfaces = [
  { label: 'Quick Log', btn: 'scan-page-trigger', file: 'scan-page-file' },
  { label: 'Focus Timer', btn: 'timer-btn-scan-ocr', file: 'timer-scan-page-file' },
  { label: 'Edit Log Modal', btn: 'edit-log-btn-scan-page', file: 'edit-log-scan-page-file' },
  { label: 'Quick Note Modal', btn: 'qn-btn-scan-page', file: 'qn-scan-page-file' },
  { label: 'Post-Session Reflection Modal', btn: 'reflection-btn-scan-page', file: 'reflection-scan-page-file' },
  { label: 'Edit Note Modal', btn: 'edit-note-btn-scan-page', file: 'edit-note-scan-page-file' },
  { label: 'Add Book Modal', btn: 'ab-btn-scan-page', file: 'ab-scan-page-file' },
  { label: 'Edit Book Modal', btn: 'eb-btn-scan-page', file: 'eb-scan-page-file' }
];

scanInterfaces.forEach(({ label, btn, file }) => {
  assert(
    htmlContent.includes(`id="${btn}"`) && htmlContent.includes(`id="${file}"`),
    `${label} has scan trigger (#${btn}) and file input (#${file})`
  );
});

// 4. Check Notes Tab Edit and Delete Capabilities
console.log('\n▶ STEP 4: Notes Tab Edit & Delete Verification');

assert(
  htmlContent.includes('id="edit-note-modal"'),
  'Edit Note Modal (#edit-note-modal) exists in index.html'
);

assert(
  htmlContent.includes('id="edit-note-save-btn"') && htmlContent.includes('id="edit-note-delete-btn"'),
  'Edit Note Modal has Save (#edit-note-save-btn) and Delete (#edit-note-delete-btn) buttons'
);

assert(
  jsContent.includes('data-action="edit"') && jsContent.includes('data-action="delete"'),
  'Knowledge view cards render edit and delete action buttons'
);

assert(
  jsContent.includes('openEditNoteModal') &&
  jsContent.includes('closeEditNoteModal') &&
  jsContent.includes('saveEditedNote') &&
  jsContent.includes('deleteNoteFromKnowledgeView'),
  'app.js defines openEditNoteModal, closeEditNoteModal, saveEditedNote, and deleteNoteFromKnowledgeView'
);

assert(
  jsContent.includes('getStandaloneNotes()') &&
  jsContent.includes('rt_standalone_notes') &&
  jsContent.includes('reading_logs') &&
  jsContent.includes('books'),
  'saveEditedNote and deleteNoteFromKnowledgeView handle standalone, log, and book note types'
);

console.log(`\n===============================================================`);
console.log(` RESULTS: ${passedTests} / ${totalTests} Tests Passed`);
console.log(`===============================================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}
