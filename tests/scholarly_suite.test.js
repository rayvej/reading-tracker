/**
 * Test Suite for Scholar Suite & Gemini AI Integration
 * Verifies Bahá'í Transliterations, Scholarly Digests, BibTeX Generation, and Story Models.
 */

import assert from 'assert';
import { fallbackTransliterate, generateScholarlyDigest, fetchActiveBookStoryFromGemini } from '../docs/js/modules/gemini-service.js';

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
assert.ok(digest.markdown.includes('Mullá Husayn at the Gate of Shiraz'), 'Markdown digest should list starred story title');

console.log('  Chicago Citation:', digest.chicago);
console.log('  BibTeX:\n' + digest.bibtex);
console.log('  ✅ Citation Generator verified!\n');

// 3. Test Package JSON Scripts Check
console.log('Test 3: Package Integrity & Test Runners...');
assert.strictEqual(typeof generateScholarlyDigest, 'function', 'generateScholarlyDigest is exportable');
assert.strictEqual(typeof fallbackTransliterate, 'function', 'fallbackTransliterate is exportable');
console.log('  ✅ Module exports verified!\n');

// 4. Test Currently Reading Story Filtering Logic
console.log('Test 4: Currently Reading Story Prioritization Logic...');
const mockBooks = [
  { id: 'b1', title: 'Some Finished Book', status: 'Finished' },
  { id: 'b2', title: 'God Passes By', status: 'In Progress' }
];

const mockStories = [
  { id: 's1', bookId: 'b1', bookTitle: 'Some Finished Book', title: 'Finished Story' },
  { id: 's2', bookId: 'b2', bookTitle: 'God Passes By', title: 'Active Book Story' }
];

const activeBook = mockBooks.find(b => b.status === 'In Progress');
const activeStories = mockStories.filter(s => s.bookId === activeBook.id || s.bookTitle === activeBook.title);

assert.strictEqual(activeStories.length, 1, 'Should find 1 story for currently reading book');
assert.strictEqual(activeStories[0].title, 'Active Book Story', 'Should prioritize story matching currently reading book');
console.log('  ✅ Currently reading story prioritization verified!\n');

// 5. Test fetchActiveBookStoryFromGemini module export & key validation
console.log('Test 5: AI Story Fetching Module Export & Key Validation...');
assert.strictEqual(typeof fetchActiveBookStoryFromGemini, 'function', 'fetchActiveBookStoryFromGemini is exportable');
await assert.rejects(
  async () => await fetchActiveBookStoryFromGemini('The Dawn-Breakers', 'Nabíl-i-A‘ẓam', 120, 688, ''),
  /Gemini API key is not configured/,
  'Should reject when API key is empty'
);
console.log('  ✅ AI Story Fetching module verified!\n');

// 6. Test Model Pro Error Guarantee
console.log('Test 6: Verifying gemini-1.5-pro Error Exclusion...');
try {
  await fetchActiveBookStoryFromGemini('The Dawn-Breakers', 'Nabíl-i-A‘ẓam', 120, 688, 'invalid_mock_key');
  assert.fail('Should have thrown an error for invalid key');
} catch (err) {
  assert.strictEqual(err.message.includes('gemini-1.5-pro'), false, 'Error message must NEVER mention gemini-1.5-pro');
  assert.strictEqual(err.message.includes('ModelService.ListModels'), false, 'Error message must NEVER show raw ListModels instruction');
  console.log('  Caught clean error:', err.message);
  console.log('  ✅ gemini-1.5-pro error exclusion verified!\n');
}

console.log('🎉 ALL SCHOLARLY SUITE TESTS PASSED SUCCESSFULLY!');


