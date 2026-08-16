import puppeteer from 'puppeteer-core';
import { bypassAuthAndInit } from './test_helper.js';

async function run() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852 });
  await page.goto('file://' + process.cwd() + '/docs/index.html', { waitUntil: 'load' });
  await bypassAuthAndInit(page);
  
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
    const vk = document.getElementById('view-knowledge');
    if (vk) vk.scrollTop = 1000;
  });
  await new Promise(r => setTimeout(r, 600));

  await page.evaluate(() => {
    const card = document.querySelector('.quote-card');
    if (card) {
      const vk = document.getElementById('view-knowledge');
      if (vk) vk.scrollTop = card.offsetTop - 50;
    }
  });
  await new Promise(r => setTimeout(r, 400));

  const card = await page.$('.quote-card');
  if (card) {
    await card.screenshot({ path: 'tests/screenshots/quote_card_element.png' });
  }

  await browser.close();
  console.log('Quote card element screenshot saved!');
}
run();
