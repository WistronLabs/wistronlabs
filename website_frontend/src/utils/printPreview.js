const DB_NAME = "wistron-print-preview";
const STORE = "documents";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore(mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

async function purgeExpired() {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const request = transaction.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (Date.now() - cursor.value.createdAt >= MAX_AGE_MS) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function readPrintPreview(id) {
  const record = await withStore("readonly", (store) => store.get(id));
  if (!record) return null;
  if (Date.now() - record.createdAt >= MAX_AGE_MS) {
    await withStore("readwrite", (store) => store.delete(id));
    return null;
  }
  return record;
}

export async function createPrintPreview(blob, kind, title) {
  await purgeExpired();
  const id = crypto.randomUUID();
  await withStore("readwrite", (store) => store.put({ id, blob, kind, title, createdAt: Date.now() }));
  return `/print-preview/${encodeURIComponent(id)}`;
}

export async function openPrintPreview(blob, kind, title) {
  const url = await createPrintPreview(blob, kind, title);
  const popup = window.open(url, "_blank");
  if (!popup) window.location.assign(url);
}
