import { DB_NAME, DB_VERSION, OBJECT_STORES } from '../../lib/constants';

let db: IDBDatabase | null = null;

export const initializeDB = async (): Promise<IDBDatabase> => {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open IndexedDB');
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create object stores if they don't exist
      const stores = [
        OBJECT_STORES.PROJECTS,
        OBJECT_STORES.SOURCE_IMAGES,
        OBJECT_STORES.DATASET_ITEMS,
        OBJECT_STORES.CLEANUP_OVERLAYS,
        OBJECT_STORES.EMBEDDINGS,
        OBJECT_STORES.SIMILARITY_CACHE,
      ];

      stores.forEach((store) => {
        if (!database.objectStoreNames.contains(store)) {
          database.createObjectStore(store, { keyPath: 'id' });
        }
      });
    };
  });
};

export const getDB = async (): Promise<IDBDatabase> => {
  if (db) return db;
  return initializeDB();
};

// Generic get operation
export const dbGet = async <T>(storeName: string, key: string): Promise<T | undefined> => {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
};

// Generic put operation
export const dbPut = async <T>(storeName: string, data: T): Promise<string> => {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(data);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as string);
  });
};

// Generic delete operation
export const dbDelete = async (storeName: string, key: string): Promise<void> => {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
};

// Get all from store
export const dbGetAll = async <T>(storeName: string): Promise<T[]> => {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
};

// Clear entire store
export const dbClear = async (storeName: string): Promise<void> => {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
};

// Batch operations
export const dbBatchPut = async <T>(storeName: string, items: T[]): Promise<void> => {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);

    items.forEach((item) => {
      store.put(item);
    });

    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
};
