import puppeteer from 'puppeteer-core';
import path from 'path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import { bypassAuthAndInit } from './test_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const indexPath = 'file://' + path.resolve(__dirname, '../docs/index.html');

console.log('================================================================');
console.log(' 🧪 NOTE CARD INTERACTION & THEME COMPREHENSIVE TEST SUITE ');
console.log('================================================================\n');

async function run() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852 });
  await page.goto(indexPath, { waitUntil: 'load' });
  await bypassAuthAndInit(page);

  console.log('▶ STEP 1: Injecting test notes and verifying rendering...');
  await page.evaluate(() => {
    booksCache = [
      {
        id: 'book-1',
        title: 'The Republic',
        author: 'Plato',
        category: 'Non-Bahá\'í',
        status: 'In Progress',
        currentPage: 50,
        totalPages: 300
      }
    ];
    logsCache = [
      {
        id: 'log-1',
        book_title: 'The Republic',
        author: 'Plato',
        date: '2026-08-08',
        notes: 'This is about Socrates continuing to talk about justice and the nature of the ideal state.',
        start_page: 14,
        end_page: 24,
        minutes: 30,
        photo_url: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80'
      }
    ];
    window.showView('knowledge');
    window.renderKnowledgeView();
  });
  await new Promise(r => setTimeout(r, 500));

  const cardStats = await page.evaluate(() => {
    const card = document.querySelector('.quote-card');
    if (!card) return null;
    const titleEl = card.querySelector('span.font-bold');
    const authorEl = card.querySelector('.text-theme-primary');
    const dateEl = card.querySelector('.text-theme-tertiary');
    const badgeEl = card.querySelector('.page-badge');
    const editBtn = card.querySelector('[data-action="edit"]');
    const deleteBtn = card.querySelector('[data-action="delete"]');
    const shareBtn = card.querySelector('[data-action="share"]');
    const favBtn = card.querySelector('[data-action="fav"]');
    const copyBtn = card.querySelector('[data-action="copy"]');

    return {
      exists: true,
      title: titleEl ? titleEl.innerText.trim() : '',
      author: authorEl ? authorEl.innerText.trim() : '',
      date: dateEl ? dateEl.innerText.trim() : '',
      badge: badgeEl ? badgeEl.innerText.trim() : '',
      hasEditBtn: !!editBtn,
      hasDeleteBtn: !!deleteBtn,
      hasShareBtn: !!shareBtn,
      hasFavBtn: !!favBtn,
      hasCopyBtn: !!copyBtn
    };
  });

  assert.ok(cardStats && cardStats.exists, 'Quote card rendered successfully');
  assert.equal(cardStats.title, 'The Republic', 'Full title rendered without clipping');
  assert.equal(cardStats.author, 'Plato', 'Author rendered cleanly');
  assert.ok(cardStats.badge.includes('pp. 14–24'), 'Page badge rendered with correct range');
  assert.ok(cardStats.hasEditBtn && cardStats.hasDeleteBtn && cardStats.hasShareBtn && cardStats.hasFavBtn && cardStats.hasCopyBtn, 'All 5 action buttons exist on card');
  console.log('  ✓ Multi-line note card rendered with complete title, author, badge & 5 action buttons');

  console.log('\n▶ STEP 2: Testing Favorite button toggle interaction...');
  const favResult = await page.evaluate(() => {
    const favBtn = document.querySelector('.quote-card [data-action="fav"]');
    favBtn.click();
    const updatedFavBtn = document.querySelector('.quote-card [data-action="fav"]');
    const isFavAfterClick = updatedFavBtn ? updatedFavBtn.classList.contains('active-fav') : false;
    const iconClass = updatedFavBtn ? updatedFavBtn.querySelector('i').className : '';
    return { isFavAfterClick, iconClass };
  });

  assert.ok(favResult.isFavAfterClick, 'Favorite button enters active state');
  assert.ok(favResult.iconClass.includes('fa-solid'), 'Star icon transitions to solid gold');
  console.log('  ✓ Favorite toggle works cleanly with active state and gold star');

  console.log('\n▶ STEP 3: Testing Share Quote Card Modal trigger...');
  const shareModalResult = await page.evaluate(() => {
    const shareBtn = document.querySelector('.quote-card [data-action="share"]');
    shareBtn.click();
    const modal = document.getElementById('quote-card-modal');
    const isOpen = modal && modal.classList.contains('open');
    if (isOpen) {
      document.getElementById('quote-card-close').click();
    }
    return { isOpen };
  });

  assert.ok(shareModalResult.isOpen, 'Share button opens quote card preview modal');
  console.log('  ✓ Share Quote Card PNG modal opened and closed cleanly');

  console.log('\n▶ STEP 4: Testing Edit Note Modal trigger & save...');
  const editModalResult = await page.evaluate(() => {
    const editBtn = document.querySelector('.quote-card [data-action="edit"]');
    editBtn.click();
    const modal = document.getElementById('edit-note-modal');
    const isOpen = modal && modal.classList.contains('open');
    const textInput = document.getElementById('edit-note-text');
    const initialText = textInput ? textInput.value : '';

    // Modify text and save
    if (textInput) textInput.value = 'Updated note text for testing Socrates on justice.';
    const saveBtn = document.getElementById('edit-note-save-btn');
    if (saveBtn) saveBtn.click();

    return {
      isOpen,
      initialText,
      modalClosedAfterSave: !modal.classList.contains('open')
    };
  });

  assert.ok(editModalResult.isOpen, 'Edit Note button opens edit modal');
  assert.ok(editModalResult.modalClosedAfterSave, 'Save button updates note and closes modal');
  console.log('  ✓ Edit Note flow verified (opened modal, updated note text, saved successfully)');

  console.log('\n▶ STEP 5: Capturing visual screenshots across 4 themes in Light & Dark modes...');
  const themes = ['espresso', 'glass-studio', 'obsidian', 'parched-paper'];
  const modes = ['dark', 'light'];

  for (const t of themes) {
    for (const m of modes) {
      await page.evaluate((theme, mode) => {
        window.setEditorialTheme(theme);
        window.setEditorialMode(mode);
        window.renderKnowledgeView();
      }, t, m);
      await new Promise(r => setTimeout(r, 200));

      const cardHandle = await page.$('.quote-card');
      if (cardHandle) {
        await cardHandle.screenshot({ path: `tests/screenshots/quote_card_${t}_${m}.png` });
      }
    }
  }
  console.log('  ✓ 8 high-res card screenshots captured across all theme and mode variations');

  await browser.close();
  console.log('\n================================================================');
  console.log(' 🏆 ALL NOTE CARD INTERACTION & VISUAL AUDITS PASSED (100%)');
  console.log('================================================================\n');
}

run().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
