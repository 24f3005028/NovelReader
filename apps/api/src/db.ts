import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Novel, Chapter, ImportJob } from '@novelreader/shared';
import { normalizeNovelTitle, sourceChapterNumber } from '@novelreader/shared';

export function openDatabase(path = process.env.DATABASE_PATH || './data/novelreader.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  return migrateDatabase(db);
}
export function migrateDatabase(db: DatabaseSync) {
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS novels(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chapters(id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id), ordinal INTEGER NOT NULL, data TEXT NOT NULL, body TEXT);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id), status TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL,mode TEXT NOT NULL DEFAULT 'index',chapter_id TEXT);`);
  const columns = db
    .prepare('PRAGMA table_info(jobs)')
    .all()
    .map((c) => c.name);
  if (!columns.includes('mode'))
    db.exec("ALTER TABLE jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'all'");
  if (!columns.includes('chapter_id')) db.exec('ALTER TABLE jobs ADD COLUMN chapter_id TEXT');
  db.exec(
    "DROP INDEX IF EXISTS active_job; CREATE UNIQUE INDEX IF NOT EXISTS active_novel_job ON jobs(novel_id) WHERE status IN ('queued','running') AND chapter_id IS NULL; CREATE UNIQUE INDEX IF NOT EXISTS active_chapter_job ON jobs(chapter_id) WHERE status IN ('queued','running') AND chapter_id IS NOT NULL;",
  );
  db.exec("CREATE INDEX IF NOT EXISTS novels_source ON novels(json_extract(data,'$.source'))");
  const schema = String(
    db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chapters'").get()?.sql ||
      '',
  );
  if (/UNIQUE\s*\(\s*novel_id\s*,\s*ordinal\s*\)/i.test(schema)) {
    db.exec('BEGIN');
    try {
      db.exec(
        'CREATE TABLE chapters_migrated(id TEXT PRIMARY KEY,novel_id TEXT NOT NULL REFERENCES novels(id),ordinal INTEGER NOT NULL,data TEXT NOT NULL,body TEXT); INSERT INTO chapters_migrated SELECT id,novel_id,ordinal,data,body FROM chapters;',
      );
      const before = db.prepare('SELECT COUNT(*) AS n FROM chapters').get()!.n,
        after = db.prepare('SELECT COUNT(*) AS n FROM chapters_migrated').get()!.n;
      if (before !== after) throw new Error('Chapter migration row count mismatch');
      db.exec('DROP TABLE chapters; ALTER TABLE chapters_migrated RENAME TO chapters; COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS chapter_order ON chapters(novel_id,ordinal)');
  const oldChapters = db
    .prepare("SELECT id,data FROM chapters WHERE json_type(data,'$.number') IS NULL")
    .all();
  if (oldChapters.length) {
    db.exec('BEGIN');
    try {
      const update = db.prepare('UPDATE chapters SET data=? WHERE id=?');
      for (const row of oldChapters) {
        const c = JSON.parse(String(row.data)) as Chapter;
        c.number = sourceChapterNumber(c.title);
        update.run(JSON.stringify(c), String(row.id));
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  const missing = db
    .prepare('SELECT id,data FROM novels')
    .all()
    .filter((row) => {
      const n = JSON.parse(String(row.data)) as Novel;
      return n.catalogKey !== (normalizeNovelTitle(n.title) || n.id);
    });
  if (missing.length) {
    db.exec('BEGIN');
    try {
      const statement = db.prepare('UPDATE novels SET data=? WHERE id=?');
      for (const row of missing) {
        const n = JSON.parse(String(row.data)) as Novel;
        n.catalogKey = normalizeNovelTitle(n.title) || n.id;
        statement.run(JSON.stringify(n), String(row.id));
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS novel_catalog_key ON novels(json_extract(data,'$.catalogKey')); CREATE INDEX IF NOT EXISTS cached_chapters_per_novel ON chapters(novel_id) WHERE body IS NOT NULL;",
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS chapter_failures(job_id TEXT NOT NULL,chapter_id TEXT PRIMARY KEY,error TEXT NOT NULL,updated_at INTEGER NOT NULL)',
  );
  return db;
}
export class Store {
  saveFailure(jobId: string, chapterId: string, error: string) {
    this.db
      .prepare(
        'INSERT INTO chapter_failures VALUES (?,?,?,?) ON CONFLICT(chapter_id) DO UPDATE SET job_id=excluded.job_id,error=excluded.error,updated_at=excluded.updated_at',
      )
      .run(jobId, chapterId, error, Date.now());
  }
  clearFailure(chapterId: string) {
    this.db.prepare('DELETE FROM chapter_failures WHERE chapter_id=?').run(chapterId);
  }
  failures(jobId: string) {
    return this.db
      .prepare(
        'SELECT chapter_id AS chapterId,error,updated_at AS updatedAt FROM chapter_failures WHERE job_id=?',
      )
      .all(jobId);
  }
  constructor(public db: DatabaseSync) {}
  novel(id: string): Novel | undefined {
    const row = this.db.prepare('SELECT data FROM novels WHERE id=?').get(id);
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  novels(): Novel[] {
    return this.db
      .prepare('SELECT data FROM novels ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(String(r.data)));
  }
  search(q: string, source: string, genre: string, page: number) {
    const filters: string[] = [],
      params: SQLInputValue[] = [];
    if (q) {
      filters.push(
        "lower(json_extract(data,'$.title') || ' ' || json_extract(data,'$.author') || ' ' || json_extract(data,'$.genres')) LIKE ? ESCAPE '\\'",
      );
      params.push(`%${q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`);
    }
    if (source) {
      filters.push("json_extract(data,'$.source')=?");
      params.push(source);
    }
    if (genre) {
      filters.push("EXISTS (SELECT 1 FROM json_each(novels.data,'$.genres') WHERE lower(value)=?)");
      params.push(genre.toLowerCase());
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const grouped = `WITH ranked AS (SELECT data,rowid AS position,ROW_NUMBER() OVER(PARTITION BY json_extract(data,'$.catalogKey') ORDER BY CASE WHEN EXISTS(SELECT 1 FROM chapters WHERE chapters.novel_id=novels.id AND body IS NOT NULL) THEN 0 ELSE 1 END,CASE json_extract(data,'$.source') WHEN 'demo' THEN 0 WHEN 'readnovelfull' THEN 1 WHEN 'freewebnovel-net' THEN 2 ELSE 3 END,CASE WHEN json_extract(data,'$.cover')<>'' THEN 0 ELSE 1 END,rowid) AS duplicateRank FROM novels ${where})`;
    const total = Number(
      this.db
        .prepare(`${grouped} SELECT COUNT(*) AS total FROM ranked WHERE duplicateRank=1`)
        .get(...params)!.total,
    );
    const items = this.db
      .prepare(
        `${grouped} SELECT data FROM ranked WHERE duplicateRank=1 ORDER BY position DESC LIMIT 30 OFFSET ?`,
      )
      .all(...params, (page - 1) * 30)
      .map((r) => JSON.parse(String(r.data)) as Novel);
    return { items, total, page, hasMore: page * 30 < total };
  }
  stats() {
    return {
      uniqueNovels: Number(
        this.db
          .prepare("SELECT COUNT(DISTINCT json_extract(data,'$.catalogKey')) AS n FROM novels")
          .get()!.n,
      ),
      novels: Number(this.db.prepare('SELECT COUNT(*) AS n FROM novels').get()!.n),
      chaptersIndexed: Number(this.db.prepare('SELECT COUNT(*) AS n FROM chapters').get()!.n),
      chaptersCached: Number(
        this.db.prepare('SELECT COUNT(*) AS n FROM chapters WHERE body IS NOT NULL').get()!.n,
      ),
      bySource: this.db
        .prepare(
          "SELECT json_extract(data,'$.source') AS source,COUNT(*) AS novels,SUM(CASE WHEN json_extract(data,'$.cover')<>'' THEN 1 ELSE 0 END) AS covers FROM novels GROUP BY source",
        )
        .all(),
    };
  }
  saveNovel(n: Novel) {
    n = { ...n, catalogKey: normalizeNovelTitle(n.title) || n.id };
    this.db
      .prepare('INSERT INTO novels VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(n.id, JSON.stringify(n));
  }
  saveChapter(c: Chapter) {
    c = { ...c, number: c.number === undefined ? sourceChapterNumber(c.title) : c.number };
    this.db
      .prepare(
        'INSERT INTO chapters(id,novel_id,ordinal,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, ordinal=excluded.ordinal',
      )
      .run(c.id, c.novelId, c.ordinal, JSON.stringify(c));
  }
  chapters(id: string): Chapter[] {
    return this.db
      .prepare(
        'SELECT data,body IS NOT NULL AS cached FROM chapters WHERE novel_id=? ORDER BY ordinal',
      )
      .all(id)
      .map((r) => ({ ...JSON.parse(String(r.data)), downloaded: Boolean(r.cached) }));
  }
  chapter(id: string) {
    const r = this.db.prepare('SELECT data,body FROM chapters WHERE id=?').get(id);
    return r
      ? {
          ...JSON.parse(String(r.data)),
          downloaded: r.body !== null,
          paragraphs: r.body ? JSON.parse(String(r.body)) : null,
        }
      : undefined;
  }
  saveBody(id: string, paragraphs: string[]) {
    this.db.prepare('UPDATE chapters SET body=? WHERE id=?').run(JSON.stringify(paragraphs), id);
  }
  job(id: string): ImportJob | null {
    return (
      (this.db
        .prepare(
          'SELECT id, novel_id AS novelId,status,total,completed,error,mode,chapter_id AS chapterId FROM jobs WHERE id=?',
        )
        .get(id) as unknown as ImportJob) || null
    );
  }
  latestJob(novelId: string): ImportJob | null {
    const r = this.db
      .prepare(
        'SELECT id FROM jobs WHERE novel_id=? AND chapter_id IS NULL ORDER BY created_at DESC,rowid DESC LIMIT 1',
      )
      .get(novelId);
    return r ? this.job(String(r.id)) : null;
  }
  enqueue(
    novelId: string,
    mode: ImportJob['mode'] = 'index',
    chapterId: string | null = null,
  ): ImportJob {
    const active = chapterId
      ? this.db
          .prepare("SELECT id FROM jobs WHERE chapter_id=? AND status IN ('queued','running')")
          .get(chapterId)
      : this.db
          .prepare(
            "SELECT id FROM jobs WHERE novel_id=? AND chapter_id IS NULL AND status IN ('queued','running')",
          )
          .get(novelId);
    if (active) {
      if (mode === 'all')
        this.db.prepare("UPDATE jobs SET mode='all' WHERE id=?").run(String(active.id));
      return this.job(String(active.id))!;
    }
    const id = crypto.randomUUID();
    this.db
      .prepare(
        "INSERT INTO jobs(id,novel_id,status,created_at,mode,chapter_id) VALUES (?,?,'queued',?,?,?)",
      )
      .run(id, novelId, Date.now(), mode, chapterId);
    return this.job(id)!;
  }
  updateJob(
    id: string,
    status: ImportJob['status'],
    total: number,
    completed: number,
    error: string | null = null,
  ) {
    this.db
      .prepare('UPDATE jobs SET status=?,total=?,completed=?,error=? WHERE id=?')
      .run(status, total, completed, error, id);
  }
}
