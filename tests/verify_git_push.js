/**
 * Automated Git Commit & Push Verification Audit
 * Empirically verifies that GitHub remote origin/main matches local HEAD hash.
 */

import { execSync } from 'child_process';
import assert from 'node:assert/strict';

console.log('===============================================================');
console.log(' 🚀 AUTOMATED GIT COMMIT & PUSH VERIFICATION AUDIT ');
console.log('===============================================================\n');

function runVerification() {
  // 1. Get local HEAD commit hash and message
  const localHash = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  const localMsg = execSync('git log -1 --pretty=%B', { encoding: 'utf-8' }).trim();
  
  console.log(`📌 Local HEAD Commit:  [${localHash.slice(0, 8)}] "${localMsg.split('\n')[0]}"`);

  // 2. Fetch latest remote references
  console.log('📡 Querying GitHub remote origin/main via git ls-remote...');
  const lsRemoteOutput = execSync('git ls-remote origin refs/heads/main', { encoding: 'utf-8' }).trim();
  const remoteHash = lsRemoteOutput.split(/\s+/)[0];

  console.log(`🌐 GitHub Remote HEAD: [${remoteHash.slice(0, 8)}]`);

  // 3. Verify equality
  assert.equal(localHash, remoteHash, `CRITICAL: Local HEAD (${localHash}) does not match GitHub Remote HEAD (${remoteHash})!`);

  console.log('\n===============================================================');
  console.log(' 🏆 PUSH VERIFICATION SUCCESS: GitHub origin/main is 100% in sync!');
  console.log('===============================================================\n');
}

try {
  runVerification();
} catch (err) {
  console.error('\n❌ PUSH VERIFICATION FAILURE:', err.message);
  process.exit(1);
}
