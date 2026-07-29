/**
 * Offline Sync Engine & BackgroundSync Registration
 */

import { showToast } from './ui.js';
import { getPendingLogs, removePendingLog } from '../offline-db.js';

export function registerBackgroundSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then(reg => {
      return reg.sync.register('sync-reading-logs');
    }).catch(err => {
      console.warn('Background sync registration warning:', err);
    });
  }
}

export async function flushPendingOfflineLogs(saveLogFunction) {
  if (!navigator.onLine) return;
  try {
    const pending = await getPendingLogs();
    if (pending && pending.length > 0) {
      showToast(`Syncing ${pending.length} offline reading log${pending.length === 1 ? '' : 's'}…`, 'info');
      for (const item of pending) {
        if (typeof saveLogFunction === 'function') {
          await saveLogFunction(item);
        }
        await removePendingLog(item.id);
      }
      showToast('✓ All offline reading logs synchronized!', 'success');
    }
  } catch (err) {
    console.error('Error flushing offline logs:', err);
  }
}

export function initOfflineNetworkStatusListeners(syncCallback) {
  window.addEventListener('online', () => {
    showToast('Network connection restored. Syncing…', 'info');
    registerBackgroundSync();
    if (typeof syncCallback === 'function') {
      syncCallback();
    }
  });

  window.addEventListener('offline', () => {
    showToast('Offline mode active. Logs will be saved locally & synced automatically when online.', 'info');
  });
}
