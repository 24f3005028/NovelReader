import { Store } from './db.js';
import { browse, stableId, SourceError } from './sources.js';
import type { SourceId } from '@novelreader/shared';
import type { LiveSource } from './source-registry.js';
export class CatalogCrawler {
  private busy = new Set<string>();
  constructor(private store: Store) {
    store.db
      .exec(`CREATE TABLE IF NOT EXISTS catalog_runs(source TEXT PRIMARY KEY,status TEXT NOT NULL,page INTEGER NOT NULL DEFAULT 1,discovered INTEGER NOT NULL DEFAULT 0,error TEXT);
      CREATE TABLE IF NOT EXISTS catalog_pages(source TEXT NOT NULL,page INTEGER NOT NULL,fingerprint TEXT NOT NULL,records INTEGER NOT NULL,synced_at INTEGER NOT NULL,PRIMARY KEY(source,page));
      UPDATE catalog_runs SET status='queued' WHERE status='running';`);
  }
  all() {
    return this.store.db
      .prepare(
        'SELECT catalog_runs.*, (SELECT COUNT(*) FROM catalog_pages WHERE catalog_pages.source=catalog_runs.source) AS completedPages FROM catalog_runs',
      )
      .all();
  }
  start(source: SourceId) {
    const prior = this.store.db
      .prepare('SELECT status FROM catalog_runs WHERE source=?')
      .get(source);
    if (prior && ['running', 'queued'].includes(String(prior.status))) return;
    if (prior?.status === 'completed') {
      this.store.db.prepare('DELETE FROM catalog_pages WHERE source=?').run(source);
      this.store.db
        .prepare(
          "UPDATE novels SET data=json_remove(data,'$.popularityRank') WHERE json_extract(data,'$.source')=?",
        )
        .run(source);
    }
    this.store.db
      .prepare(
        "INSERT INTO catalog_runs(source,status) VALUES (?,'queued') ON CONFLICT(source) DO UPDATE SET status='queued',error=NULL,page=CASE WHEN catalog_runs.status='completed' THEN 1 ELSE catalog_runs.page END,discovered=CASE WHEN catalog_runs.status='completed' THEN 0 ELSE catalog_runs.discovered END",
      )
      .run(source);
  }
  cancel(source: SourceId) {
    this.store.db.prepare("UPDATE catalog_runs SET status='cancelled' WHERE source=?").run(source);
  }
  async tick() {
    const runs = this.all().filter(
      (r) => ['queued', 'running'].includes(String(r.status)) && !this.busy.has(String(r.source)),
    );
    await Promise.all(
      runs.map((run) => this.process(String(run.source) as LiveSource, Number(run.page))),
    );
  }
  private async process(source: LiveSource, page: number) {
    this.busy.add(source);
    this.store.db.prepare("UPDATE catalog_runs SET status='running' WHERE source=?").run(source);
    try {
      const { items, hasNext } = await browse(source, page);
      const fingerprint = stableId(
        items
          .map((n) => n.id)
          .sort()
          .join(','),
      );
      const duplicate = this.store.db
        .prepare('SELECT page FROM catalog_pages WHERE source=? AND fingerprint=? AND page<>?')
        .get(source, fingerprint, page);
      if (duplicate)
        throw new SourceError(
          `Source repeated page ${duplicate.page} at page ${page}. Pagination stopped to prevent an endless crawl.`,
          'CATALOG_PAGINATION_STALLED',
        );
      const current = this.store.db
        .prepare('SELECT status FROM catalog_runs WHERE source=?')
        .get(source);
      if (current?.status === 'cancelled') return;
      let added = 0;
      this.store.db.exec('BEGIN');
      try {
        for (const n of items) {
          const existing = this.store.novel(n.id);
          if (!existing) added++;
          this.store.saveNovel(
            existing
              ? {
                  ...existing,
                  title: n.title,
                  cover: n.cover || existing.cover,
                  author: n.author === 'Unknown' ? existing.author : n.author,
                  genres: n.genres.length ? n.genres : existing.genres,
                  chapterCount: Math.max(existing.chapterCount, n.chapterCount),
                  popularityRank: Math.min(
                    existing.popularityRank || Infinity,
                    n.popularityRank || Infinity,
                  ),
                  communityRating: n.communityRating || existing.communityRating,
                }
              : n,
          );
        }
        this.store.db
          .prepare(
            'INSERT INTO catalog_pages VALUES (?,?,?,?,?) ON CONFLICT(source,page) DO UPDATE SET fingerprint=excluded.fingerprint,records=excluded.records,synced_at=excluded.synced_at',
          )
          .run(source, page, fingerprint, items.length, Date.now());
        this.store.db
          .prepare(
            "UPDATE catalog_runs SET status=?,page=?,discovered=discovered+?,error=NULL WHERE source=? AND status='running'",
          )
          .run(hasNext ? 'queued' : 'completed', hasNext ? page + 1 : page, added, source);
        this.store.db.exec('COMMIT');
      } catch (e) {
        this.store.db.exec('ROLLBACK');
        throw e;
      }
    } catch (e) {
      this.store.db
        .prepare(
          "UPDATE catalog_runs SET status='failed',error=? WHERE source=? AND status='running'",
        )
        .run(e instanceof Error ? e.message : 'Catalogue crawl failed', source);
    } finally {
      this.busy.delete(source);
    }
  }
}
