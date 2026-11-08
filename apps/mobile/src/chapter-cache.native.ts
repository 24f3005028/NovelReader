import { openDatabaseAsync } from 'expo-sqlite';
import type { ChapterContent } from '@novelreader/shared';
const database = (async () => {
  const db = await openDatabaseAsync('novelreader-offline.db');
  await db.execAsync(
    'CREATE TABLE IF NOT EXISTS offline_chapters(id TEXT PRIMARY KEY, content TEXT NOT NULL)',
  );
  return db;
})();
export async function getChapter(id: string): Promise<ChapterContent | null> {
  const row = await (
    await database
  ).getFirstAsync<{ content: string }>('SELECT content FROM offline_chapters WHERE id=?', id);
  return row ? JSON.parse(row.content) : null;
}
export async function putChapter(chapter: ChapterContent) {
  await (
    await database
  ).runAsync(
    'INSERT INTO offline_chapters(id,content) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content',
    chapter.id,
    JSON.stringify(chapter),
  );
}
export async function removeChapters(ids: string[]) {
  const db = await database;
  await db.withTransactionAsync(async () => {
    for (const id of ids) await db.runAsync('DELETE FROM offline_chapters WHERE id=?', id);
  });
}
