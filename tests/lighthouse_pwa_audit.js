#!/usr/bin/env node
/**
 * Lighthouse PWA Audit Script
 * Runs Lighthouse programmatically and asserts minimum scores.
 * 
 * Prerequisites:
 *   npm install -g lighthouse chrome-launcher
 *   Google Chrome must be installed
 *   App must be served locally (e.g., npx serve docs -p 3000)
 * 
 * Usage:
 *   node tests/lighthouse_pwa_audit.js [URL]
 */

const APP_URL = process.argv[2] || process.env.APP_URL || 'http://localhost:3000';

const THRESHOLDS = {
  performance: 90,
  accessibility: 95,
  'best-practices': 95,
  pwa: 90
};

async function runAudit() {
  console.log('\\n═══ Lighthouse PWA Audit ═══\\n');
  console.log(`Target: ${APP_URL}`);
  console.log(`Thresholds: Performance>${THRESHOLDS.performance}, A11y>${THRESHOLDS.accessibility}, Best Practices>${THRESHOLDS['best-practices']}, PWA>${THRESHOLDS.pwa}\\n`);

  let lighthouse, chromeLauncher;
  try {
    lighthouse = (await import('lighthouse')).default;
    chromeLauncher = await import('chrome-launcher');
  } catch (e) {
    console.log('⚠ lighthouse and/or chrome-launcher not installed.');
    console.log('  Install with: npm install -g lighthouse chrome-launcher');
    console.log('  Then re-run this script.');
    process.exit(0);
  }

  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });

  try {
    const result = await lighthouse(APP_URL, {
      port: chrome.port,
      output: 'json',
      onlyCategories: Object.keys(THRESHOLDS)
    });

    const { categories } = result.lhr;
    let allPassed = true;

    for (const [key, threshold] of Object.entries(THRESHOLDS)) {
      const category = categories[key];
      if (!category) {
        console.log(`  ⚠ Category "${key}" not found in results`);
        continue;
      }
      const score = Math.round(category.score * 100);
      const pass = score >= threshold;
      const icon = pass ? '✓' : '✗';
      console.log(`  ${icon} ${category.title}: ${score}/100 (threshold: ${threshold})`);
      if (!pass) allPassed = false;
    }

    console.log(`\\n══════════════════════════════`);
    if (allPassed) {
      console.log('All Lighthouse thresholds passed! ✓');
    } else {
      console.log('Some thresholds not met. See above. ✗');
    }
    console.log(`══════════════════════════════\\n`);

    if (!allPassed) process.exit(1);
  } finally {
    await chrome.kill();
  }
}

runAudit().catch(err => {
  console.error('Lighthouse audit error:', err.message);
  process.exit(1);
});
