/**
 * Reading Tracker Offline Storage (IndexedDB)
 * Enables zero-cost offline logging and image note capture.
 */

const DB_NAME = 'reading_tracker_offline_db';
const DB_VERSION = 2;
const STORE_LOGS = 'pending_logs';
const STORE_IMAGES = 'offline_images';
const STORE_SABBATICALS = 'sabbatical_logs';
const STORE_ROLLUPS = 'daily_rollups';

let dbInstance = null;

export async function initOfflineDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_LOGS)) {
        db.createObjectStore(STORE_LOGS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SABBATICALS)) {
        db.createObjectStore(STORE_SABBATICALS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ROLLUPS)) {
        db.createObjectStore(STORE_ROLLUPS, { keyPath: 'date' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Save a reading session log locally while offline
 */
export async function savePendingLog(logData) {
  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LOGS, 'readwrite');
    const store = tx.objectStore(STORE_LOGS);
    const record = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      createdAt: new Date().toISOString(),
      synced: false,
      ...logData
    };
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Get all pending logs queued for sync
 */
export async function getPendingLogs() {
  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LOGS, 'readonly');
    const store = tx.objectStore(STORE_LOGS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Remove synced log from local queue
 */
export async function removePendingLog(id) {
  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LOGS, 'readwrite');
    const store = tx.objectStore(STORE_LOGS);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Save image Blob for offline notes
 */
export async function saveOfflineImage(imageId, imageBlob) {
  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    const store = tx.objectStore(STORE_IMAGES);
    const record = {
      id: imageId,
      blob: imageBlob,
      createdAt: new Date().toISOString()
    };
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Retrieve offline image Blob by ID
 */
export async function getOfflineImage(imageId) {
  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const store = tx.objectStore(STORE_IMAGES);
    const req = store.get(imageId);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = (e) => reject(e.target.error);
  });
}
