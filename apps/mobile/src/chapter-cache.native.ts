import { openDatabaseAsync } from 'expo-sqlite';
import type { ChapterContent, NovelDetail } from '@novelreader/shared';
const database = (async () => {
  const db = await openDatabaseAsync('novelreader-offline.db');
  await db.execAsync(
    'CREATE TABLE IF NOT EXISTS offline_chapters(id TEXT PRIMARY KEY, content TEXT NOT NULL); CREATE TABLE IF NOT EXISTS offline_novels(id TEXT PRIMARY KEY, detail TEXT NOT NULL);',
  );
  return db;
})();
export async function getNovelDetail(id: string): Promise<NovelDetail | null> {
  const row = await (
    await database
  ).getFirstAsync<{ detail: string }>('SELECT detail FROM offline_novels WHERE id=?', id);
  return row ? JSON.parse(row.detail) : null;
}
export async function putNovelDetail(detail: NovelDetail) {
  await (
    await database
  ).runAsync(
    'INSERT INTO offline_novels(id,detail) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET detail=excluded.detail',
    detail.novel.id,
    JSON.stringify(detail),
  );
}
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
  if (!ids.length) return;
  const db = await database;
  await db.runAsync(
    'DELETE FROM offline_chapters WHERE id IN (SELECT value FROM json_each(?))',
    JSON.stringify(ids),
  );
}
