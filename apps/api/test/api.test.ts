import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDatabase, Store, migrateDatabase } from '../src/db.js';
import { DatabaseSync } from 'node:sqlite';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { Worker } from '../src/worker.js';
import { parseBody, parseCatalog, parseNovel, safeUrl } from '../src/sources.js';
import { CatalogCrawler } from '../src/catalog.js';
import { html, SourceError } from '../src/transport.js';
import { normalizeNovelTitle } from '@novelreader/shared';
import { RedditSync, parseRedditFeed } from '../src/reddit.js';
let store: Store;
beforeEach(() => {
  process.env.ENABLED_SOURCES = 'demo,freewebnovel,freewebnovel-net,readnovelfull';
  store = new Store(openDatabase(':memory:'));
  seed(store);
});
afterEach(() => store.db.close());
test('catalogue search and chapter bodies are served from the database', async () => {
  const app = createApp(store);
  const result = await request(app).get('/novels?q=star');
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 1);
  const id = result.body.items[0].id;
  const detail = await request(app).get(`/novels/${id}`);
  assert.equal(detail.body.chapters.length, 3);
  const content = await request(app).get(`/chapters/${detail.body.chapters[0].id}`);
  assert.equal(content.status, 200);
  assert.ok(content.body.paragraphs.length > 3);
});
test('imports deduplicate active jobs and complete stored demo chapters', async () => {
  const app = createApp(store);
  const id = store.novels()[0].id;
  const a = await request(app).post(`/novels/${id}/import`);
  const b = await request(app).post(`/novels/${id}/import`);
  assert.equal(a.status, 202);
  assert.equal(a.body.id, b.body.id);
  await new Worker(store).tick();
  const job = store.job(a.body.id)!;
  assert.equal(job.status, 'completed');
  assert.equal(job.completed, 3);
});
test('cancelled jobs do not run; restarted workers resume running jobs', async () => {
  const app = createApp(store);
  const job = store.enqueue(store.novels()[0].id);
  await request(app).post(`/jobs/${job.id}/cancel`);
  await new Worker(store).tick();
  assert.equal(store.job(job.id)?.status, 'cancelled');
  const resumed = store.enqueue(job.novelId);
  store.updateJob(resumed.id, 'running', 3, 0);
  await new Worker(store).tick();
  assert.equal(store.job(resumed.id)?.status, 'completed');
});
test('input validation rejects unknown sources, invalid pages, and external URLs', async () => {
  const app = createApp(store);
  assert.equal((await request(app).get('/novels?page=-1')).status, 400);
  assert.equal((await request(app).post('/catalog/unknown/start')).status, 400);
  for (const url of [
    'http://freewebnovel.com/novel/test',
    'https://localhost/test',
    'https://freewebnovel.com:444/test',
    'https://user:secret@freewebnovel.com/test',
    'https://freewebnovel.com.evil.test/',
  ])
    assert.throws(() => safeUrl('freewebnovel', url));
  assert.equal(
    (
      await request(app)
        .post('/novels')
        .send({ source: 'freewebnovel', url: 'https://localhost/test', title: 'Test' })
    ).status,
    502,
  );
});
test('HTML parser extracts lazy cover URLs and deduplicates chapters in reading order', () => {
  const items = parseCatalog(
    'freewebnovel',
    '<ul><li><img data-src="/covers/sky.jpg"><h3><a href="/novel/sky">Sky</a></h3></li></ul>',
    'https://freewebnovel.com/sort/latest-novel',
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].cover, 'https://freewebnovel.com/covers/sky.jpg');
  const parsed = parseNovel(
    items[0],
    '<h1>Sky</h1><div class="chapter-list"><a href="/novel/sky/chapter-2">Chapter 2</a><a href="/novel/sky/chapter-1">Chapter 1</a><a href="/novel/sky/chapter-1">Chapter 1</a></div>',
  );
  assert.deepEqual(
    parsed.chapters.map((c) => c.title),
    ['Chapter 1', 'Chapter 2'],
  );
  assert.equal(parsed.chapters[0].ordinal, 1);
});
test('reader parser removes executable markup and detects source failures', () => {
  const p =
    'An original story paragraph with enough meaningful text to demonstrate chapter extraction and safe rendering.';
  assert.deepEqual(
    parseBody(`<div id="chapter-content"><script>alert(1)</script><p>${p}</p></div>`),
    [p],
  );
  assert.throws(() => parseBody('<h1>Access denied</h1>'));
});
test('missing chapters return 404; unimported chapters return 409', async () => {
  const app = createApp(store);
  assert.equal((await request(app).get('/chapters/missing')).status, 404);
  const n = store.novels()[0];
  store.saveChapter({
    id: 'waiting',
    novelId: n.id,
    ordinal: 4,
    title: 'Waiting',
    url: 'demo://waiting',
    downloaded: false,
  });
  assert.equal((await request(app).get('/chapters/waiting')).status, 409);
});
test('configured API token protects content and mutations', async () => {
  const previous = process.env.API_TOKEN;
  process.env.API_TOKEN = 'test-token';
  try {
    const app = createApp(store);
    assert.equal((await request(app).get('/health')).status, 200);
    assert.equal((await request(app).get('/novels')).status, 401);
    assert.equal(
      (await request(app).get('/novels').set('Authorization', 'Bearer test-token')).status,
      200,
    );
  } finally {
    if (previous === undefined) delete process.env.API_TOKEN;
    else process.env.API_TOKEN = previous;
  }
});
test('catalogue crawler follows next pages even when the first page is already indexed', async () => {
  const original = globalThis.fetch;
  const previous = process.env.SCRAPE_DELAY_MS;
  process.env.SCRAPE_DELAY_MS = '1000';
  const card = (slug: string) =>
    `<li><img data-src="/covers/${slug}.jpg"><h3><a href="/novel/${slug}">${slug}</a></h3></li>`;
  const first = card('existing');
  store.saveNovel(parseCatalog('freewebnovel', first, 'https://freewebnovel.com')[0]);
  globalThis.fetch = async (input) =>
    new Response(
      String(input).endsWith('robots.txt')
        ? 'User-agent: *\nDisallow:'
        : String(input).endsWith('/2')
          ? card('new-title')
          : `${first}<a href="/sort/latest-novel/2">Next</a>`,
      { headers: { 'content-type': 'text/html' } },
    );
  try {
    const crawler = new CatalogCrawler(store);
    crawler.start('freewebnovel');
    await crawler.tick();
    assert.equal(crawler.all()[0].status, 'queued');
    assert.equal(crawler.all()[0].page, 2);
    await crawler.tick();
    assert.equal(crawler.all()[0].status, 'completed');
    assert.ok(
      store.novels().some((n) => n.title === 'new-title' && n.cover.endsWith('new-title.jpg')),
    );
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.SCRAPE_DELAY_MS;
    else process.env.SCRAPE_DELAY_MS = previous;
  }
});
test('source worker imports a paginated chapter index and stores plain-text chapter bodies', async () => {
  const original = globalThis.fetch;
  const previous = process.env.SCRAPE_DELAY_MS;
  process.env.SCRAPE_DELAY_MS = '1000';
  const n = {
    ...store.novels()[0],
    id: 'source-fixture',
    source: 'freewebnovel' as const,
    url: 'https://freewebnovel.com/novel/source-fixture',
  };
  store.saveNovel(n);
  const p =
    'A sufficiently long original fixture paragraph for verifying the complete fetch, extraction, persistence, and chapter-serving pipeline.';
  globalThis.fetch = async (input) => {
    const url = String(input);
    const body = url.endsWith('robots.txt')
      ? 'User-agent: *\nDisallow:'
      : url.includes('/chapter-')
        ? `<div id="chapter-content"><p>${p}</p></div>`
        : url.includes('?page=2')
          ? '<div class="chapter-list"><a href="/novel/source-fixture/chapter-2">Chapter 2</a></div>'
          : '<h1>Source fixture</h1><div class="chapter-list"><a href="/novel/source-fixture/chapter-1">Chapter 1</a></div><div class="chapter-pagination"><a href="?page=2">2</a></div>';
    return new Response(body, { headers: { 'content-type': 'text/html' } });
  };
  try {
    const job = store.enqueue(n.id, 'all');
    await new Worker(store).tick();
    assert.equal(store.job(job.id)?.status, 'completed');
    assert.equal(store.job(job.id)?.completed, 2);
    assert.deepEqual(
      store.chapters(n.id).map((c) => c.ordinal),
      [1, 2],
    );
    assert.deepEqual(store.chapter(store.chapters(n.id)[0].id).paragraphs, [p]);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.SCRAPE_DELAY_MS;
    else process.env.SCRAPE_DELAY_MS = previous;
  }
});
test('default import indexes titles only; selecting one chapter fetches only that body and reuses cache', async () => {
  const original = globalThis.fetch;
  const n = {
    ...store.novels()[0],
    id: 'demand',
    source: 'freewebnovel' as const,
    url: 'https://freewebnovel.com/novel/demand',
  };
  store.saveNovel(n);
  const body =
    'This original chapter fixture is long enough to verify on-demand extraction and caching without requesting another chapter.';
  let bodyRequests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/chapter-')) bodyRequests++;
    return new Response(
      url.endsWith('robots.txt')
        ? 'User-agent: *\nDisallow:'
        : url.includes('/chapter-')
          ? `<div id="chapter-content"><p>${body}</p></div>`
          : '<h1>Demand</h1><div class="chapter-list"><a href="/novel/demand/chapter-1">Chapter 1 First</a><a href="/novel/demand/chapter-2">Chapter 2 Second</a></div>',
      { headers: { 'content-type': 'text/html' } },
    );
  };
  try {
    const app = createApp(store);
    const indexed = await request(app).post(`/novels/${n.id}/import`);
    assert.equal(indexed.body.mode, 'index');
    const worker = new Worker(store);
    await worker.tick();
    assert.equal(store.job(indexed.body.id)?.status, 'completed');
    assert.equal(bodyRequests, 0);
    const chapters = store.chapters(n.id);
    assert.equal(chapters.length, 2);
    assert.ok(chapters.every((c) => !c.downloaded));
    const queued = await request(app).post(`/chapters/${chapters[0].id}/import`);
    const duplicate = await request(app).post(`/chapters/${chapters[0].id}/import`);
    assert.equal(queued.status, 202);
    assert.equal(queued.body.job.mode, 'chapter');
    assert.equal(duplicate.body.job.id, queued.body.job.id);
    await worker.tick();
    assert.equal(bodyRequests, 1);
    assert.equal(store.job(queued.body.job.id)?.status, 'completed');
    assert.equal(store.chapter(chapters[1].id).paragraphs, null);
    const cached = await request(app).post(`/chapters/${chapters[0].id}/import`);
    assert.equal(cached.status, 200);
    assert.equal(cached.body.job, null);
    assert.deepEqual(cached.body.chapter.paragraphs, [body]);
    assert.equal(bodyRequests, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test('bulk imports continue past a missing chapter and retry only missing bodies', async () => {
  const original = globalThis.fetch;
  const n = {
    ...store.novels()[0],
    id: 'retry',
    source: 'freewebnovel' as const,
    url: 'https://freewebnovel.com/novel/retry',
  };
  store.saveNovel(n);
  let broken = true;
  const counts = new Map<string, number>();
  const p =
    'A complete original fixture paragraph for checking partial imports, source errors, retry behavior, and body persistence.';
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/chapter-')) counts.set(url, (counts.get(url) || 0) + 1);
    if (url.endsWith('/chapter-2') && broken)
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(
      url.endsWith('robots.txt')
        ? 'User-agent: *\nDisallow:'
        : url.includes('/chapter-')
          ? `<div id="chapter-content"><p>${p}</p></div>`
          : `<div class="chapter-list">${[1, 2, 3].map((i) => `<a href="/novel/retry/chapter-${i}">Chapter ${i}</a>`).join('')}</div>`,
      { headers: { 'content-type': 'text/html' } },
    );
  };
  try {
    const worker = new Worker(store);
    const first = store.enqueue(n.id, 'all');
    await worker.tick();
    assert.equal(store.job(first.id)?.status, 'failed');
    assert.equal(store.job(first.id)?.completed, 2);
    assert.equal(store.failures(first.id).length, 1);
    broken = false;
    const retry = store.enqueue(n.id, 'all');
    await worker.tick();
    assert.equal(store.job(retry.id)?.status, 'completed');
    assert.equal(store.job(retry.id)?.completed, 3);
    assert.equal(counts.get('https://freewebnovel.com/novel/retry/chapter-3'), 1);
    assert.equal(store.failures(first.id).length, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test('robots restrictions prevent chapter fetches before a source page is requested', async () => {
  const original = globalThis.fetch;
  process.env.ENABLED_SOURCES = 'demo,empirenovel';
  const seen: string[] = [];
  globalThis.fetch = async (input) => {
    seen.push(String(input));
    return new Response('User-agent: *\nDisallow: /novel/', {
      headers: { 'content-type': 'text/plain' },
    });
  };
  try {
    await assert.rejects(
      html('empirenovel', 'https://www.empirenovel.com/novel/blocked'),
      (e) => e instanceof SourceError && e.code === 'ROBOTS_DISALLOWED',
    );
    assert.deepEqual(seen, ['https://www.empirenovel.com/robots.txt']);
  } finally {
    globalThis.fetch = original;
  }
});
test('legacy ordinal constraint migration preserves cached bodies and allows source reordering', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE novels(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE chapters(id TEXT PRIMARY KEY,novel_id TEXT NOT NULL REFERENCES novels(id),ordinal INTEGER NOT NULL,data TEXT NOT NULL,body TEXT,UNIQUE(novel_id,ordinal));',
  );
  const n = store.novels()[0];
  db.prepare('INSERT INTO novels VALUES (?,?)').run(n.id, JSON.stringify(n));
  for (let i = 1; i <= 2; i++) {
    const c = {
      id: `legacy-${i}`,
      novelId: n.id,
      ordinal: i,
      title: `Chapter ${i}`,
      url: `demo://${i}`,
      downloaded: true,
    };
    db.prepare('INSERT INTO chapters VALUES (?,?,?,?,?)').run(
      c.id,
      n.id,
      i,
      JSON.stringify(c),
      JSON.stringify(['Preserved body']),
    );
  }
  try {
    migrateDatabase(db);
    const migrated = new Store(db);
    const chapters = migrated.chapters(n.id);
    migrated.saveChapter({ ...chapters[0], ordinal: 2 });
    migrated.saveChapter({ ...chapters[1], ordinal: 1 });
    assert.equal(migrated.chapters(n.id).length, 2);
    assert.equal(migrated.chapters(n.id)[0].id, 'legacy-2');
    assert.deepEqual(migrated.chapter('legacy-1').paragraphs, ['Preserved body']);
  } finally {
    db.close();
  }
});
test('catalogue groups duplicate titles across sources and keeps the cached copy', async () => {
  const base = {
    ...store.novels()[0],
    title: 'Reader’s Journey — A New World',
    source: 'freewebnovel-net' as const,
    id: 'same-net',
    url: 'https://freewebnovel.net/journey.html',
    genres: ['Fantasy'],
  };
  store.saveNovel(base);
  store.saveNovel({
    ...base,
    id: 'same-full',
    source: 'readnovelfull',
    title: "Reader's Journey - A New World",
    url: 'https://readnovelfull.com/journey.html',
    cover: 'https://covers.example/journey.jpg',
    genres: [],
    communityRating: 4.5,
  });
  const app = createApp(store);
  const before = await request(app).get('/novels?q=journey');
  assert.equal(before.body.total, 1);
  assert.equal(before.body.items[0].id, 'same-full');
  assert.deepEqual(before.body.items[0].genres, ['Fantasy']);
  store.saveChapter({
    id: 'cached-journey',
    novelId: 'same-net',
    ordinal: 1,
    title: 'Chapter 1',
    url: 'https://freewebnovel.net/journey/chapter-1.html',
    downloaded: true,
  });
  store.saveBody('cached-journey', ['Cached body']);
  const cached = await request(app).get('/novels?q=journey');
  assert.equal(cached.body.total, 1);
  assert.equal(cached.body.items[0].id, 'same-net');
  assert.equal(cached.body.items[0].cover, 'https://covers.example/journey.jpg');
  assert.equal(cached.body.items[0].communityRating, 4.5);
  assert.equal(cached.body.items[0].ratingCount, 0);
  assert.equal(normalizeNovelTitle('Lord of the Mysteries'), 'lord of mysteries');
});
test('ratings update one vote per reader and aggregate across duplicate source entries', async () => {
  const n = store.novels()[0];
  const alias = {
    ...n,
    id: 'rating-alias',
    source: 'freewebnovel-net' as const,
    url: 'https://freewebnovel.net/alias.html',
  };
  store.saveNovel(alias);
  const app = createApp(store);
  const first = 'reader-example-00001',
    second = 'reader-example-00002';
  let response = await request(app)
    .put(`/novels/${n.id}/rating`)
    .send({ readerId: first, value: 5 });
  assert.equal(response.body.average, 5);
  assert.equal(response.body.count, 1);
  response = await request(app)
    .put(`/novels/${alias.id}/rating`)
    .send({ readerId: second, value: 3 });
  assert.equal(response.body.average, 4);
  assert.equal(response.body.count, 2);
  response = await request(app).put(`/novels/${n.id}/rating`).send({ readerId: first, value: 3 });
  assert.equal(response.body.average, 3);
  assert.equal(response.body.count, 2);
  assert.equal(response.body.userRating, 3);
  assert.equal(
    (await request(app).put(`/novels/${n.id}/rating`).send({ readerId: first, value: 6 })).status,
    400,
  );
  assert.equal(
    (await request(app).put(`/novels/${n.id}/rating`).send({ readerId: first, value: 0 })).status,
    400,
  );
});
test('public RSS recommendations match catalogue titles without invented ratings or vote counts', () => {
  const novel = { ...store.novels()[0], id: 'rss-novel', title: 'Lord of the Mysteries' };
  store.saveNovel(novel);
  const sync = new RedditSync(store);
  const xml =
    '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>t3_example123</id><title>My favourite novels</title><link rel="alternate" href="https://www.reddit.com/r/noveltranslations/comments/example123/recommendations/"/><content type="html">&lt;p&gt;I recommend Lord of the Mysteries for a mystery adventure.&lt;/p&gt;</content></entry></feed>';
  assert.equal(sync.ingestFeed(xml).matched, 1);
  const thread = store.db
    .prepare("SELECT score,kind FROM reddit_threads WHERE id='example123'")
    .get()!;
  assert.equal(thread.score, null);
  assert.equal(thread.kind, 'rss');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM reader_ratings').get()!.n, 0);
  assert.equal(parseRedditFeed(xml.replace('www.reddit.com', 'evil.example')).length, 0);
});
test('top ten has unique titles and activity is deduplicated per reader and day', async () => {
  for (let i = 0; i < 12; i++)
    store.saveNovel({
      ...store.novels()[0],
      id: `popular-${i}`,
      title: `Popular novel ${i}`,
      popularityRank: i + 1,
      source: 'readnovelfull',
      url: `https://readnovelfull.com/book-${i}.html`,
    });
  const app = createApp(store);
  let feed = await request(app).get('/discover');
  assert.equal(feed.body.top10.length, 10);
  assert.equal(new Set(feed.body.top10.map((n: { catalogKey: string }) => n.catalogKey)).size, 10);
  const payload = { novelId: 'popular-0', readerId: 'reader-example-00003', action: 'read' };
  await request(app).post('/activity').send(payload);
  await request(app).post('/activity').send(payload);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM reading_events').get()!.n, 1);
});
test('source chapter numbers remain separate from sequential reading order', () => {
  const n = store.novels()[0];
  store.saveChapter({
    id: 'numbered-special',
    novelId: n.id,
    ordinal: 4,
    title: 'Chapter 12.5 — Interlude',
    url: 'demo://special',
    downloaded: false,
  });
  const chapter = store.chapter('numbered-special');
  assert.equal(chapter.ordinal, 4);
  assert.equal(chapter.number, 12.5);
  assert.equal(chapter.title, 'Chapter 12.5 — Interlude');
});
