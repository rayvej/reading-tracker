import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('🚀 Running Exhaustive Visual Test Suite...');
try {
  execSync('node tests/exhaustive_visual_test.js', { stdio: 'inherit' });
} catch (e) {
  console.error('Exhaustive visual test exited with errors.');
}

console.log('\n🚀 Running Deep-Dive Visual Test Suite...');
try {
  execSync('node tests/deepdive_visual_test.js', { stdio: 'inherit' });
} catch (e) {
  console.error('Deep-dive visual test exited with errors.');
}

console.log('\n✅ All test suites complete!');
