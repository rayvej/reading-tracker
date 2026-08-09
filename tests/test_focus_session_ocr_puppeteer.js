import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const docsDir = path.join(rootDir, 'docs');

// Create local HTTP server
const server = http.createServer((req, res) => {
  let filePath = path.join(docsDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(docsDir, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading file');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

const PORT = 8766;
server.listen(PORT, async () => {
  console.log(`Server running at http://localhost:${PORT}`);

  try {
    const browser = await puppeteer.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Enable console log tracking from browser
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
    page.on('pageerror', err => console.error('BROWSER ERROR:', err));

    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0' });

    console.log('Navigated to app');

    // Create test image file
    const sampleImgPath = path.join(__dirname, 'sample_page.png');
    // Simple 1x1 transparent PNG base64 decoded
    const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(sampleImgPath, pngBuffer);

    // Set mock Gemini API Key in localStorage
    await page.evaluate(() => {
      localStorage.setItem('rt_gemini_api_key', 'AIzaSyTEST_MOCK_KEY_FOR_OCR');
    });

    // Mock fetch for Gemini API to return sample OCR text
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = async function(url, options) {
        if (url.includes('generativelanguage.googleapis.com')) {
          console.log('MOCK GEMINI API CALLED');
          return {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          text: "The journey of a thousand miles begins with a single step. Focus deeply and master your time.",
                          pageNumber: 142
                        })
                      }
                    ]
                  }
                }
              ]
            })
          };
        }
        return originalFetch.apply(this, arguments);
      };
    });

    // Open Focus Session Modal (timer-fullscreen-overlay)
    console.log('Opening Focus Session overlay...');
    await page.evaluate(() => {
      const overlay = document.getElementById('timer-fullscreen-overlay');
      if (overlay) {
        overlay.classList.add('active');
      }
      if (typeof window.setupTimerEvents === 'function') {
        window.setupTimerEvents();
      }
    });

    const screenshotsDir = path.join(rootDir, 'tests', 'screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

    await page.screenshot({ path: path.join(screenshotsDir, '1_focus_session_open.png') });
    console.log('Saved Screenshot 1: 1_focus_session_open.png');

    // Select test image file on #timer-scan-page-file
    console.log('Uploading sample photo to #timer-scan-page-file...');
    const fileInput = await page.$('#timer-scan-page-file');
    await fileInput.uploadFile(sampleImgPath);

    // Trigger change event
    await page.evaluate(() => {
      const input = document.getElementById('timer-scan-page-file');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Wait a brief moment for async scan process
    await new Promise(r => setTimeout(r, 1000));

    await page.screenshot({ path: path.join(screenshotsDir, '2_ocr_scanning_modal.png') });
    console.log('Saved Screenshot 2: 2_ocr_scanning_modal.png');

    // Inspect Notes field and modal state
    const notesValue = await page.evaluate(() => {
      const notes = document.getElementById('timer-input-notes');
      return notes ? notes.value : null;
    });

    const endPageValue = await page.evaluate(() => {
      const endPage = document.getElementById('timer-input-end-page');
      return endPage ? endPage.value : null;
    });

    const modalOpen = await page.evaluate(() => {
      const modal = document.getElementById('ocr-verify-modal');
      return modal ? modal.classList.contains('open') : false;
    });

    const modalZIndex = await page.evaluate(() => {
      const modal = document.getElementById('ocr-verify-modal');
      return modal ? window.getComputedStyle(modal).zIndex : null;
    });

    console.log('\n--- VERIFICATION RESULTS ---');
    console.log('Timer Input Notes Value:', JSON.stringify(notesValue));
    console.log('Timer Input End Page Value:', JSON.stringify(endPageValue));
    console.log('OCR Verification Modal Open:', modalOpen);
    console.log('OCR Verification Modal z-index:', modalZIndex);

    // Click Confirm & Append on OCR Verification Modal if open
    if (modalOpen) {
      await page.evaluate(() => {
        if (typeof window.commitVerifiedScan === 'function') {
          window.commitVerifiedScan();
        }
      });
      await new Promise(r => setTimeout(r, 500));
    }

    const finalNotesValue = await page.evaluate(() => {
      const notes = document.getElementById('timer-input-notes');
      return notes ? notes.value : null;
    });

    await page.screenshot({ path: path.join(screenshotsDir, '3_notes_populated.png') });
    console.log('Saved Screenshot 3: 3_notes_populated.png');

    console.log('Final Timer Notes Value:', JSON.stringify(finalNotesValue));

    await browser.close();
    server.close();

    if (finalNotesValue && finalNotesValue.includes("The journey of a thousand miles begins with a single step")) {
      console.log('\n✅ TEST PASSED: Photo OCR successfully populated Focus Session Notes!');
      process.exit(0);
    } else {
      console.error('\n❌ TEST FAILED: Focus Session Notes were not populated correctly.');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    server.close();
    process.exit(1);
  }
});
