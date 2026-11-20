/** Shared IndexedDB connection for legacy and animated theme image records. */

export const THEME_IMAGE_STORE_NAME = "images";

const DB_NAME = "plethora-theme-images";
const DB_VERSION = 1;

export function openThemeImageDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (database: IDBDatabase | null) => {
      if (settled) {
        database?.close();
        return;
      }
      settled = true;
      resolve(database);
    };

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(THEME_IMAGE_STORE_NAME)) {
          database.createObjectStore(THEME_IMAGE_STORE_NAME);
        }
      };
      request.onsuccess = () => finish(request.result);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
}
