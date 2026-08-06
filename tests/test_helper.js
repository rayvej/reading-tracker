/**
 * Test helper: Bypasses authentication and loads seed data
 * into the app's in-memory caches for Puppeteer testing.
 */

import fs from 'fs';
import path from 'path';

const SEED_DATA_PATH = path.resolve('docs/seed-data.json');

/**
 * Bypasses the auth screen and initializes the app with seed data.
 * Must be called after page.goto() and waiting for page load.
 */
export async function bypassAuthAndInit(page) {
  // Read seed data from file system
  const seedData = JSON.parse(fs.readFileSync(SEED_DATA_PATH, 'utf-8'));

  // Inject seed data and bypass auth
  await page.evaluate((seed) => {
    // Set mock auth flag
    window.isMockAuth = true;

    // Set fake user ID
    window.uid = 'test-user-id';

    // Inject books into cache with fake IDs
    const books = (seed.books || []).map((b, i) => ({ id: `book-${i}`, ...b }));
    const logs = (seed.reading_logs || []).map((l, i) => ({ id: `log-${i}`, ...l }));
    const wishlist = (seed.wishlist || []).map((w, i) => ({ id: `wish-${i}`, ...w }));
    
    // Combine books and wishlist
    const allBooks = [...books, ...wishlist];

    // Set the caches
    try {
      Object.defineProperty(window, 'booksCache', { 
        value: allBooks, writable: true, configurable: true 
      });
    } catch(e) {
      window.booksCache = allBooks;
    }
    
    try {
      Object.defineProperty(window, 'logsCache', { 
        value: logs, writable: true, configurable: true 
      });
    } catch(e) {
      window.logsCache = logs;
    }

    // Show the main app and hide auth screens
    const authScreen = document.getElementById('auth-screen');
    const pinScreen = document.getElementById('pin-screen');
    const seedScreen = document.getElementById('seed-screen');
    const app = document.getElementById('app');

    if (authScreen) authScreen.classList.add('hidden');
    if (pinScreen) pinScreen.classList.add('hidden');
    if (seedScreen) seedScreen.classList.add('hidden');
    if (app) app.classList.remove('hidden');

    // Return counts for logging
    return { books: allBooks.length, logs: logs.length };
  }, seedData);

  // Wait for DOM update
  await new Promise(r => setTimeout(r, 500));

  // Now call initApp to set up all event handlers and render
  const initResult = await page.evaluate(() => {
    try {
      // Prevent the starter import modal from auto-opening
      localStorage.setItem('rt_starter_dismissed_test-user-id', 'true');
      localStorage.setItem('rt_starter_dismissed_undefined', 'true');
      
      // The app exposes initApp globally
      if (typeof window.initApp === 'function') {
        window.initApp();
        return 'initApp called successfully';
      } else {
        // Manual initialization fallback
        const app = document.getElementById('app');
        if (app) app.classList.remove('hidden');

        // Show dashboard
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        const dashboard = document.getElementById('view-dashboard');
        if (dashboard) {
          dashboard.classList.remove('hidden');
          dashboard.classList.add('active');
        }
        return 'Manual init (initApp not found)';
      }
    } catch (e) {
      return `Init error: ${e.message}`;
    }
  });

  console.log(`  🔑 Auth bypass: ${initResult}`);

  // Wait for async rendering
  await new Promise(r => setTimeout(r, 2000));

  // Close ALL modals that might have auto-opened
  await page.evaluate(() => {
    // Close all ios-modal-overlay modals
    document.querySelectorAll('.ios-modal-overlay').forEach(m => {
      m.classList.remove('open');
    });
    // Close all modal-overlay modals
    document.querySelectorAll('.modal-overlay').forEach(m => {
      m.classList.add('hidden');
    });
    // Close starter import modal specifically
    const starter = document.getElementById('starter-import-modal');
    if (starter) starter.classList.remove('open');
    
    // Close settings modal
    const settings = document.getElementById('settings-modal');
    if (settings) settings.classList.remove('open');
    
    // Close any toast
    const toast = document.getElementById('toast');
    if (toast) {
      toast.classList.remove('show');
      toast.style.display = 'none';
    }
    
    // Close install prompt and update banners
    document.querySelectorAll('#install-prompt, #update-banner, [id*="install"], [id*="update"]').forEach(el => {
      el.style.display = 'none';
      el.classList.add('hidden');
    });
  });

  await new Promise(r => setTimeout(r, 500));

  // Verify the app is visible
  const appState = await page.evaluate(() => {
    const app = document.getElementById('app');
    const authScreen = document.getElementById('auth-screen');
    const visibleViews = document.querySelectorAll('.view:not(.hidden)');
    const tabs = document.querySelectorAll('button[data-view]');
    
    return {
      appVisible: app && !app.classList.contains('hidden'),
      authHidden: authScreen?.classList.contains('hidden'),
      visibleViewCount: visibleViews.length,
      visibleViewIds: Array.from(visibleViews).map(v => v.id),
      tabCount: tabs.length,
    };
  });

  console.log(`  📊 App state: app=${appState.appVisible}, auth_hidden=${appState.authHidden}, views=${appState.visibleViewCount} (${appState.visibleViewIds.join(',')}), tabs=${appState.tabCount}`);

  if (!appState.appVisible) {
    throw new Error('App did not become visible after auth bypass');
  }

  return appState;
}
