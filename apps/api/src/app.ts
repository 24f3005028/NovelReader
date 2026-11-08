import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { Store } from './db.js';
import {
  sources,
  browse,
  enabled,
  safeUrl,
  stableId,
  sourceIds,
  sourceFromUrl,
  registry,
  SourceError,
} from './sources.js';
import { CatalogCrawler } from './catalog.js';
import { Community } from './community.js';
import { RedditSync } from './reddit.js';

export function createApp(store: Store) {
  const app = express();
  const community = new Community(store),
    reddit = new RedditSync(store);
  app.locals.reddit = reddit;
  const catalog = new CatalogCrawler(store);
  app.locals.catalog = catalog;
  app.use(
    helmet(),
    cors({
      origin: (process.env.CORS_ORIGINS || 'http://localhost:8081,http://localhost:19006').split(
        ',',
      ),
    }),
    express.json({ limit: '512kb' }),
  );
  app.use(rateLimit({ windowMs: 60000, limit: 240 }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use((req, res, next) => {
    const token = process.env.API_TOKEN;
    if (!token) return next();
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.status(401).json({ error: 'Invalid API token' });
      return;
    }
    next();
  });
  app.get('/sources', (_req, res) => res.json(sources()));
  app.get('/stats', (_req, res) => res.json(store.stats()));
  app.get('/discover', (req, res) =>
    res.json(
      community.feed(
        String(req.query.genres || '')
          .split(',')
          .filter(Boolean)
          .slice(0, 8),
      ),
    ),
  );
  app.get('/community/reddit/status', (_req, res) => res.json(reddit.status()));
  app.post('/community/reddit/sync', (_req, res) => {
    void reddit.sync();
    res.status(202).json({ status: 'refreshing' });
  });
  app.post('/community/reddit/import-feed', (req, res) => {
    const { xml } = z.object({ xml: z.string().min(1).max(500000) }).parse(req.body);
    res.json(reddit.ingestFeed(xml));
  });
  app.get('/novels/:id/ratings', (req, res) => {
    if (!store.novel(req.params.id)) {
      res.status(404).json({ error: 'Novel not found' });
      return;
    }
    res.json(
      community.rating(
        req.params.id,
        req.query.readerId ? z.string().min(16).max(128).parse(req.query.readerId) : undefined,
      ),
    );
  });
  app.put('/novels/:id/rating', (req, res) => {
    if (!store.novel(req.params.id)) {
      res.status(404).json({ error: 'Novel not found' });
      return;
    }
    const data = z
      .object({ readerId: z.string().min(16).max(128), value: z.number().int().min(1).max(5) })
      .parse(req.body);
    res.json(community.rate(req.params.id, data.readerId, data.value));
  });
  app.get('/novels/:id/discussions', (req, res) => {
    if (!store.novel(req.params.id)) {
      res.status(404).json({ error: 'Novel not found' });
      return;
    }
    res.json(community.discussions(req.params.id));
  });
  app.post('/activity', (req, res) => {
    const data = z
      .object({
        novelId: z.string(),
        readerId: z.string().min(16).max(128),
        action: z.enum(['open', 'read']),
      })
      .parse(req.body);
    if (!store.novel(data.novelId)) {
      res.status(404).json({ error: 'Novel not found' });
      return;
    }
    community.record(data.novelId, data.readerId, data.action);
    res.status(204).end();
  });
  app.post('/sources/:source/probe', async (req, res) => {
    const source = z.enum(sourceIds).parse(req.params.source);
    const started = Date.now();
    try {
      const result = await browse(source, 1);
      res.json({
        source,
        status: 'available',
        novels: result.items.length,
        covers: result.items.filter((n) => n.cover).length,
        hasNext: result.hasNext,
        sample: result.items.slice(0, 3),
        durationMs: Date.now() - started,
      });
    } catch (e) {
      if (e instanceof SourceError) {
        res.status(503).json({
          source,
          status: 'unavailable',
          code: e.code,
          error: e.message,
          retryable: e.retryable,
          durationMs: Date.now() - started,
        });
        return;
      }
      throw e;
    }
  });
  app.post('/imports', (req, res) => {
    const data = z
      .object({
        url: z.string().url(),
        title: z.string().min(1).max(300).optional(),
        mode: z.enum(['index', 'all']).default('index'),
      })
      .parse(req.body);
    const source = sourceFromUrl(data.url);
    if (!enabled(source)) {
      res.status(403).json({ error: 'Source disabled in backend configuration' });
      return;
    }
    const url = safeUrl(source, data.url),
      id = stableId(url);
    let novel = store.novel(id);
    if (!novel) {
      novel = {
        id,
        source,
        url,
        title:
          data.title ||
          decodeURIComponent(
            new URL(url).pathname.split('/').filter(Boolean).pop() || 'Novel',
          ).replace(/\.html$|[-_]/g, ' '),
        author: 'Unknown',
        description: '',
        cover: '',
        genres: [],
        chapterCount: 0,
      };
      store.saveNovel(novel);
    }
    res.status(202).json({ novel, job: store.enqueue(id, data.mode) });
  });
  app.get('/catalog', (_req, res) => res.json(catalog.all()));
  app.post('/catalog/:source/start', (req, res) => {
    const source = z.enum(sourceIds).parse(req.params.source);
    if (!enabled(source)) {
      res.status(403).json({ error: 'Enable this source in backend configuration first.' });
      return;
    }
    catalog.start(source);
    res.status(202).json(catalog.all());
  });
  app.post('/catalog/:source/cancel', (req, res) => {
    catalog.cancel(z.enum(sourceIds).parse(req.params.source));
    res.json(catalog.all());
  });
  app.get('/novels', (req, res) => {
    const q = z
      .string()
      .max(300)
      .parse(req.query.q || '')
      .toLowerCase();
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .parse(req.query.page || 1);
    const source = z
      .string()
      .max(80)
      .parse(req.query.source || '');
    const genre = z
      .string()
      .max(80)
      .parse(req.query.genre || '');
    const result = store.search(q, source, genre, page);
    res.json({ ...result, items: result.items.map((n) => community.decorate(n)) });
  });
  app.post('/sources/:source/sync', async (req, res) => {
    const source = z.enum(sourceIds).parse(req.params.source);
    const { page } = z
      .object({ page: z.number().int().min(1).max(10000).default(1) })
      .parse(req.body || {});
    if (!enabled(source)) {
      res.status(403).json({ error: 'Source is disabled in backend configuration' });
      return;
    }
    const { items, hasNext } = await browse(source, page);
    for (const novel of items) {
      const existing = store.novel(novel.id);
      store.saveNovel(
        existing
          ? {
              ...novel,
              ...existing,
              cover: novel.cover || existing.cover,
              popularityRank: novel.popularityRank,
              communityRating: novel.communityRating || existing.communityRating,
            }
          : novel,
      );
    }
    res.json({ items, page, hasMore: hasNext });
  });
  app.post('/novels', (req, res) => {
    const data = z
      .object({
        source: z.enum(sourceIds),
        url: z.string().url(),
        title: z.string().min(1).max(300),
      })
      .parse(req.body);
    const url = safeUrl(data.source, data.url);
    const id = stableId(url);
    if (!store.novel(id))
      store.saveNovel({
        id,
        ...data,
        url,
        author: 'Unknown',
        description: 'Import this novel to fetch chapters.',
        cover: '',
        genres: [],
        chapterCount: 0,
      });
    res.status(201).json(store.novel(id));
  });
  app.get('/novels/:id', (req, res) => {
    const novel = store.novel(req.params.id);
    if (!novel) {
      res.status(404).json({ error: 'Novel not found' });
      return;
    }
    res.json({
      novel: community.decorate(novel),
      chapters: store.chapters(novel.id),
      job: store.latestJob(novel.id),
    });
  });
  app.post('/novels/:id/import', (req, res) => {
    const novel = store.novel(req.params.id);
    if (!novel) {
      res.status(404).json({ error: 'Novel not found' });
      return;
    }
    if (!enabled(novel.source)) {
      res.status(403).json({ error: 'Source disabled. Enable it in backend configuration.' });
      return;
    }
    const { mode } = z
      .object({ mode: z.enum(['index', 'all']).default('index') })
      .parse(req.body || {});
    res.status(202).json(store.enqueue(novel.id, mode));
  });
  app.get('/jobs/:id', (req, res) => {
    const job = store.job(req.params.id);
    res.status(job ? 200 : 404).json(job || { error: 'Job not found' });
  });
  app.get('/jobs/:id/failures', (req, res) => {
    if (!store.job(req.params.id)) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(store.failures(req.params.id));
  });
  app.post('/jobs/:id/cancel', (req, res) => {
    const job = store.job(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    if (['running', 'queued'].includes(job.status))
      store.updateJob(job.id, 'cancelled', job.total, job.completed);
    res.json(store.job(job.id));
  });
  app.get('/chapters/:id', (req, res) => {
    const chapter = store.chapter(req.params.id);
    if (!chapter) {
      res.status(404).json({ error: 'Chapter not found' });
      return;
    }
    if (!chapter.paragraphs) {
      res.status(409).json({
        error: 'Chapter text has not been fetched yet. Select it to import.',
        code: 'CHAPTER_NOT_CACHED',
      });
      return;
    }
    res.json(chapter);
  });
  app.post('/chapters/:id/import', (req, res) => {
    const chapter = store.chapter(req.params.id);
    if (!chapter) {
      res.status(404).json({ error: 'Chapter metadata not found' });
      return;
    }
    if (chapter.paragraphs) {
      res.json({ chapter, job: null });
      return;
    }
    const novel = store.novel(chapter.novelId)!;
    if (!enabled(novel.source)) {
      res.status(403).json({ error: 'Source disabled in backend configuration' });
      return;
    }
    res.status(202).json({ chapter: null, job: store.enqueue(novel.id, 'chapter', chapter.id) });
  });
  app.get('/novels/:id/download', (req, res) => {
    if (!store.novel(req.params.id)) {
      res.status(404).json({ error: 'Novel not found' });
      return;
    }
    const offset = z.coerce.number().int().min(0).default(0).parse(req.query.offset);
    const limit = z.coerce.number().int().min(1).max(50).default(20).parse(req.query.limit);
    const all = store.chapters(req.params.id),
      slice = all.slice(offset, offset + limit);
    res.json({
      items: slice.filter((c) => c.downloaded).map((c) => store.chapter(c.id)),
      pending: slice.filter((c) => !c.downloaded).map((c) => c.id),
      nextOffset: offset + slice.length,
      hasMore: offset + slice.length < all.length,
      total: all.length,
    });
  });
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error instanceof z.ZodError ? 400 : 502).json({
        error: error instanceof Error ? error.message : 'Request failed',
        ...(error instanceof SourceError ? { code: error.code, retryable: error.retryable } : {}),
      });
    },
  );
  return app;
}
