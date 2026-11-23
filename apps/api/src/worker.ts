import { Store } from './db.js';
import { html, chapterIndex, parseBody, SourceError } from './sources.js';
import type { ImportJob } from '@novelreader/shared';
import { enabled, sourceIds } from './source-registry.js';
export class Worker {
  private busy = new Set<'novel' | 'chapter'>();
  private nextIndexScan = 0;
  private nextSource = 0;
  constructor(private store: Store) {
    store.db.prepare("UPDATE jobs SET status='queued' WHERE status='running'").run();
  }
  async tick() {
    await Promise.all(
      (['chapter', 'novel'] as const).map(async (lane) => {
        if (this.busy.has(lane)) return;
        let row = this.store.db
          .prepare(
            `SELECT id FROM jobs WHERE status='queued' AND chapter_id IS ${lane === 'chapter' ? 'NOT ' : ''}NULL ORDER BY priority DESC,created_at,rowid LIMIT 1`,
          )
          .get();
        if (
          !row &&
          lane === 'novel' &&
          process.env.AUTO_INDEX_CHAPTERS !== 'false' &&
          Date.now() >= this.nextIndexScan
        ) {
          for (let attempt = 0; attempt < sourceIds.length; attempt++) {
            const source = sourceIds[this.nextSource];
            this.nextSource = (this.nextSource + 1) % sourceIds.length;
            if (!enabled(source)) continue;
            const novel = this.store.nextUnindexedNovel(source);
            if (!novel) continue;
            row = { id: this.store.enqueue(novel).id };
            break;
          }
          if (!row) this.nextIndexScan = Date.now() + 5000;
        }
        if (!row) return;
        this.busy.add(lane);
        try {
          await this.run(String(row.id));
        } finally {
          this.busy.delete(lane);
        }
      }),
    );
  }
  private cancelled(id: string) {
    return this.store.job(id)?.status === 'cancelled';
  }
  private async fetchChapter(job: ImportJob, chapterId: string) {
    const chapter = this.store.chapter(chapterId),
      novel = this.store.novel(job.novelId)!;
    if (!chapter) throw new SourceError('Chapter metadata was not found', 'CHAPTER_NOT_FOUND');
    if (chapter.paragraphs || chapter.locked) return;
    try {
      const paragraphs = parseBody(await html(novel.source, chapter.url), novel.source);
      this.store.saveBody(chapterId, paragraphs);
    } catch (error) {
      if (error instanceof SourceError && error.code === 'CHAPTER_LOCKED')
        this.store.saveChapter({ ...chapter, locked: true });
      throw error;
    }
    this.store.clearFailure(chapterId);
  }
  private async run(id: string) {
    const job = this.store.job(id)!;
    let total = 0,
      completed = 0;
    try {
      this.store.updateJob(id, 'running', job.mode === 'chapter' ? 1 : 0, 0);
      if (job.mode === 'chapter') {
        total = 1;
        try {
          await this.fetchChapter(job, job.chapterId!);
        } catch (e) {
          this.store.saveFailure(
            id,
            job.chapterId!,
            e instanceof Error ? e.message : 'Chapter fetch failed',
          );
          throw e;
        }
        if (!this.cancelled(id)) this.store.updateJob(id, 'completed', 1, 1);
        return;
      }
      const novel = this.store.novel(job.novelId)!;
      if (novel.source !== 'demo') {
        const parsed = await chapterIndex(
          novel,
          async (metadata, chapters) => {
            if (this.cancelled(id)) return;
            this.store.saveNovel(metadata);
            for (const c of chapters) this.store.saveChapter(c);
            total = metadata.chapterCount;
            completed = chapters.length;
            if (this.store.job(id)?.mode === 'all' && chapters[0]) {
              try {
                await this.fetchChapter(job, chapters[0].id);
              } catch {
                /* The body pass records a specific failure. */
              }
            }
            if (!this.cancelled(id)) this.store.updateJob(id, 'running', total, completed);
          },
          () => this.cancelled(id),
        );
        this.store.saveNovel(parsed.novel);
        for (const c of parsed.chapters) this.store.saveChapter(c);
      }
      if (this.cancelled(id)) return;
      const all = this.store.job(id)?.mode === 'all';
      const chapters = this.store.chapters(novel.id).filter((c) => !all || !c.locked);
      total = chapters.length;
      if (!all) {
        this.store.updateJob(id, 'completed', total, total);
        return;
      }
      completed = chapters.filter((c) => c.downloaded).length;
      this.store.updateJob(id, 'running', total, completed);
      const failures: string[] = [];
      for (const c of chapters) {
        if (this.cancelled(id)) return;
        if (c.downloaded) continue;
        try {
          await this.fetchChapter(job, c.id);
          completed++;
        } catch (e) {
          const error = e instanceof Error ? e.message : 'Chapter fetch failed';
          this.store.saveFailure(id, c.id, error);
          failures.push(`${c.title}: ${error}`);
          if (
            e instanceof SourceError &&
            ['SOURCE_CHALLENGE', 'ROBOTS_DISALLOWED', 'SOURCE_DISABLED'].includes(e.code)
          )
            throw e;
        }
        if (!this.cancelled(id)) this.store.updateJob(id, 'running', total, completed);
      }
      if (!this.cancelled(id))
        this.store.updateJob(
          id,
          failures.length ? 'failed' : 'completed',
          total,
          completed,
          failures.length
            ? `${failures.length} chapters failed. Retry to fetch only missing bodies. ${failures[0]}`
            : null,
        );
    } catch (e) {
      if (!this.cancelled(id))
        this.store.updateJob(
          id,
          'failed',
          total,
          completed,
          e instanceof Error ? e.message : 'Import failed',
        );
    }
  }
}
