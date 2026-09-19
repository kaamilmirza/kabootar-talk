'use client';

/**
 * The one place the local database is opened.
 *
 * Both the vault and the prekey store live in it, so they have to agree on a
 * version and a set of object stores — opening the same database at two
 * different versions from two modules is a race that fails on whichever one
 * loses.
 */

const DB_NAME = 'kabootar';
const DB_VERSION = 1;

export const STORES = {
  vault: 'vault',
  prekeys: 'prekeys',
  letters: 'letters',
  places: 'places',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close this app in your other tabs and retry.'));
  });
}

export function idb<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = run(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/**
 * Delete everything this device has stored, for good.
 *
 * The whole database, not a keyed row inside it. "Erase this device" promises
 * that the letters here are gone, and only clearing the vault left every
 * decrypted letter and every prekey secret sitting in storage — which is worse
 * than not offering the button, because somebody would believe it.
 *
 * It also has to work while the app is locked, when there is no identity in
 * memory to look rows up by, so dropping the database is the only honest
 * implementation.
 */
export function wipeEverything(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    try {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = done;
      request.onerror = done;
      // Another tab holding the database open would block this indefinitely;
      // failing to erase must not leave the person stuck on a dead screen.
      request.onblocked = done;
      setTimeout(done, 3000);
    } catch {
      done();
    }
  });
}
