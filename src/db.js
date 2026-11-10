// Thin hand-rolled IndexedDB wrapper. No external dependency so the app ships
// with zero runtime deps and the service worker can cache every byte it needs.
// Stores plain objects; engine.js never imports this file, keeping the engine
// pure and unit-testable without a browser.

const DB_NAME = 'wardrobe';
const DB_VERSION = 1;
const STORES = ['items', 'photos', 'combos', 'wearLog', 'rejections', 'settings'];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('combos')) db.createObjectStore('combos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('wearLog')) db.createObjectStore('wearLog', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('rejections')) db.createObjectStore('rejections', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(storeName) {
  const store = await tx(storeName, 'readonly');
  return wrap(store.getAll());
}

export async function get(storeName, id) {
  const store = await tx(storeName, 'readonly');
  return wrap(store.get(id));
}

export async function put(storeName, value) {
  const store = await tx(storeName, 'readwrite');
  await wrap(store.put(value));
  return value;
}

export async function putAll(storeName, values) {
  const store = await tx(storeName, 'readwrite');
  await Promise.all(values.map((v) => wrap(store.put(v))));
}

export async function remove(storeName, id) {
  const store = await tx(storeName, 'readwrite');
  await wrap(store.delete(id));
}

export async function clearStore(storeName) {
  const store = await tx(storeName, 'readwrite');
  await wrap(store.clear());
}

export async function clearAll() {
  await Promise.all(STORES.map((s) => clearStore(s)));
}

// --- Settings is a single-row store -----------------------------------------
const SETTINGS_ID = 'app-settings';
const DEFAULT_SETTINGS = {
  id: SETTINGS_ID,
  laundryMode: 'off', // 'off' | 'auto' | 'full'
  autoResetDays: 3,
  location: { lat: 1.35, lon: 103.82, label: 'Singapore' },
  weatherCache: null, // { fetchedAt, rain }
};

export async function getSettings() {
  const existing = await get('settings', SETTINGS_ID);
  return existing || { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings) {
  return put('settings', { ...settings, id: SETTINGS_ID });
}

// --- Photos ------------------------------------------------------------------
// Downscales an image file/blob to max 800px on its longest side before storing,
// so IndexedDB never holds full-resolution camera photos.
export async function storePhoto(blobOrFile) {
  const downscaled = await downscaleImage(blobOrFile, 800);
  const id = 'photo_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  await put('photos', { id, blob: downscaled });
  return id;
}

export async function getPhotoUrl(photoId) {
  if (!photoId) return null;
  const record = await get('photos', photoId);
  if (!record) return null;
  return URL.createObjectURL(record.blob);
}

export async function deletePhoto(photoId) {
  if (!photoId) return;
  await remove('photos', photoId);
}

function downscaleImage(blobOrFile, maxSize) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blobOrFile);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width >= height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// --- Export / Import ----------------------------------------------------------
export async function exportAllData() {
  const [items, combos, wearLog, rejections, settings] = await Promise.all([
    getAll('items'),
    getAll('combos'),
    getAll('wearLog'),
    getAll('rejections'),
    getSettings(),
  ]);
  // Photos are intentionally excluded from export — they're local blobs, and
  // bundling them would make the export file large and awkward to diff/share.
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    items,
    combos,
    wearLog,
    rejections,
    settings,
  };
}

export async function importAllData(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid import file');
  await clearStore('items');
  await clearStore('combos');
  await clearStore('wearLog');
  await clearStore('rejections');
  if (Array.isArray(data.items)) await putAll('items', data.items);
  if (Array.isArray(data.combos)) await putAll('combos', data.combos);
  if (Array.isArray(data.wearLog)) await putAll('wearLog', data.wearLog);
  if (Array.isArray(data.rejections)) await putAll('rejections', data.rejections);
  if (data.settings) await saveSettings(data.settings);
}

export async function wipeAllData() {
  const photos = await getAll('photos');
  await Promise.all(photos.map((p) => remove('photos', p.id)));
  await clearAll();
}
