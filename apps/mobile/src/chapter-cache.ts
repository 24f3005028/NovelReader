import type { ChapterContent, NovelDetail } from '@novelreader/shared';
// IndexedDB keeps web preview chapter content outside localStorage's small quota.
const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('novelreader-offline', 2);
    req.onupgradeneeded = ({ oldVersion }) => {
      if (oldVersion < 1) req.result.createObjectStore('chapters', { keyPath: 'id' });
      if (oldVersion < 2) req.result.createObjectStore('novels', { keyPath: 'novel.id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
async function transaction<T>(
  name: 'chapters' | 'novels',
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const req = action(tx.objectStore(name));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function getChapter(id: string): Promise<ChapterContent | null> {
  return (await transaction('chapters', 'readonly', (store) => store.get(id))) || null;
}
export async function putChapter(chapter: ChapterContent) {
  await transaction('chapters', 'readwrite', (store) => store.put(chapter));
}
export async function getNovelDetail(id: string): Promise<NovelDetail | null> {
  return (await transaction('novels', 'readonly', (store) => store.get(id))) || null;
}
export async function putNovelDetail(detail: NovelDetail) {
  await transaction('novels', 'readwrite', (store) => store.put(detail));
}
export async function removeChapters(ids: string[]) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('chapters', 'readwrite');
    for (const id of ids) tx.objectStore('chapters').delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
