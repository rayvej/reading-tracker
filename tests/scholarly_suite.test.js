/**
 * Test Suite for Scholar Suite & Gemini AI Integration
 * Verifies Bahá'í Transliterations, Scholarly Digests, BibTeX Generation, and Story Models.
 */

import assert from 'assert';
import { fallbackTransliterate, generateScholarlyDigest } from '../docs/js/modules/gemini-service.js';

console.log('🧪 Running Scholarly Suite Test Suite...\n');

// 1. Test Fallback Bahá'í Transliteration Engine
console.log('Test 1: Fallback Bahá\'í Transliteration Rules...');
const rawText = "Baha'u'llah wrote to Abdul-Baha in Tahirih's memory about Kitab-i-Iqan and Mulla Husayn.";
const cleaned = fallbackTransliterate(rawText);
console.log('  Raw input:', rawText);
console.log('  Cleaned output:', cleaned);

assert.strictEqual(cleaned.includes("Bahá'u'lláh"), true, "Baha'u'llah should be transliterated to Bahá'u'lláh");
assert.strictEqual(cleaned.includes("‘Abdu’l-Bahá"), true, "Abdul-Baha should be transliterated to ‘Abdu’l-Bahá");
assert.strictEqual(cleaned.includes("Táhirih"), true, "Tahirih should be transliterated to Táhirih");
assert.strictEqual(cleaned.includes("Kitáb-i-Íqán"), true, "Kitab-i-Iqan should be transliterated to Kitáb-i-Íqán");
assert.strictEqual(cleaned.includes("Mullá Husayn"), true, "Mulla Husayn should be transliterated to Mullá Husayn");
console.log('  ✅ Transliteration engine verified!\n');

// 2. Test Scholarly Digest & Citation Generator
console.log('Test 2: Scholarly Digest & Citation Generator...');
const book = {
  title: 'The Dawn-Breakers',
  author: 'Nabíl-i-A‘ẓam',
  year: 1932,
  publisher: 'Bahá\'í Publishing Trust',
  city: 'Wilmette, IL'
};

const stories = [
  {
    title: 'Mullá Husayn at the Gate of Shiraz',
    summary: 'Mullá Husayn arrives in Shiraz in May 1844 and meets the Báb.',
    quote: 'He who was to fulfill the longing of his heart was standing before him.',
    page: 52,
    paragraph: '§14',
    characters: ['Mullá Husayn', 'The Báb'],
    themes: ['Heroism', 'Search for Truth'],
    era: 'Heroic Age (1844)'
  }
];

const digest = generateScholarlyDigest(book, [], stories, []);

assert.ok(digest.bibtex.includes('@book{'), 'BibTeX should contain @book block');
assert.ok(digest.bibtex.includes('author = {Nabíl-i-A‘ẓam}'), 'BibTeX should include author');
assert.ok(digest.chicago.includes('Nabíl-i-A‘ẓam. *The Dawn-Breakers*'), 'Chicago citation should format author and title');
assert.ok(digest.markdown.includes('# Scholarly Digest: The Dawn-Breakers'), 'Markdown digest header should match title');

console.log('  Chicago Citation:', digest.chicago);
console.log('  BibTeX:\n' + digest.bibtex);
console.log('  ✅ Citation Generator verified!\n');

// 3. Test Package JSON Scripts Check
console.log('Test 3: Package Integrity & Test Runners...');
assert.strictEqual(typeof generateScholarlyDigest, 'function', 'generateScholarlyDigest is exportable');
assert.strictEqual(typeof fallbackTransliterate, 'function', 'fallbackTransliterate is exportable');
console.log('  ✅ Module exports verified!\n');

console.log('🎉 ALL SCHOLARLY SUITE TESTS PASSED SUCCESSFULLY!');
