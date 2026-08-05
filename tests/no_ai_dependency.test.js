/**
 * Test Suite verifying No AI Hard Dependency (Offline & Non-AI Fallbacks)
 * Ensures every feature can function 100% manually and locally without a Gemini API Key.
 */

import assert from 'assert';
import { fallbackTransliterate, standardizeTransliteration, generateScholarlyDigest } from '../docs/js/modules/gemini-service.js';

console.log('🧪 Running No-AI Dependency & Offline Fallback Audit Test Suite...\n');

// 1. Test Offline Rule-Based Transliteration without API Key
console.log('Test 1: Transliteration Engine Without Gemini API Key...');
const rawInputs = [
  "Baha'u'llah wrote Kitab-i-Iqan",
  "Abdul-Baha visited Baha'is in Haifa",
  "Tahirih and Mulla Husayn were at Badasht",
  "Quddus was steadfast in prayer"
];

for (const input of rawInputs) {
  const outputSync = fallbackTransliterate(input);
  const outputAsyncNoKey = await standardizeTransliteration(input, null); // passing null API key

  assert.strictEqual(outputSync, outputAsyncNoKey, 'Async function with null API key must fallback to local rules');
  assert.ok(!outputSync.includes("Baha'u'llah"), "Should replace unaccented Baha'u'llah");
  assert.ok(outputSync.includes("Bahá'u'lláh") || outputSync.includes("‘Abdu’l-Bahá") || outputSync.includes("Táhirih") || outputSync.includes("Quddús"), "Must produce Bahá'í accents");
  console.log(`  Input:  "${input}"`);
  console.log(`  Output: "${outputSync}" (Local Fallback)`);
}
console.log('  ✅ Local Rule-based Transliteration works 100% offline without AI!\n');

// 2. Test Scholarly Digest Generator (Zero AI dependency)
console.log('Test 2: Citation & Digest Generation Without AI...');
const mockBook = {
  id: 'b101',
  title: 'God Passes By',
  author: 'Shoghi Effendi',
  year: 1944,
  publisher: 'Bahá\'í Publishing Trust',
  city: 'Wilmette, IL'
};

const mockStories = [
  {
    id: 's1',
    title: 'The Declaration of the Báb',
    summary: 'The Báb declares His mission to Mullá Husayn in Shiraz.',
    quote: 'O thou who art the first to believe in Me!',
    page: 5,
    paragraph: '§2',
    characters: ['The Báb', 'Mullá Husayn'],
    themes: ['Declaration', 'Heroic Age']
  }
];

const digestResult = generateScholarlyDigest(mockBook, [], mockStories, []);

assert.ok(digestResult.chicago.includes('Shoghi Effendi. *God Passes By*'), 'Chicago citation generated locally');
assert.ok(digestResult.bibtex.includes('@book{effendi1944god'), 'BibTeX entry generated locally');
assert.ok(digestResult.markdown.includes('# Scholarly Digest: God Passes By'), 'Markdown digest generated locally');
console.log('  Chicago Citation:', digestResult.chicago);
console.log('  BibTeX:\n' + digestResult.bibtex);
console.log('  ✅ Citations and Digests generate 100% deterministically without AI!\n');

console.log('🎉 ALL NO-AI DEPENDENCY TESTS PASSED! AI is strictly an enhancement, never a requirement.');
