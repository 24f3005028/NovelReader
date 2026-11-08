import {
  normalizeNovelTitle,
  deduplicateNovels,
  type Novel,
  type RatingSummary,
  type RedditDiscussion,
  type DiscoveryFeed,
} from '@novelreader/shared';
import { Store } from './db.js';

const picks = [
  {
    id: '1nr5flu',
    subreddit: 'noveltranslations',
    title: 'Reader tier-list discussion',
    url: 'https://www.reddit.com/r/noveltranslations/comments/1nr5flu/',
    novels: [
      'The Mirror Legacy',
      'Reverend Insanity',
      'Shadow Slave',
      'Lord of Mysteries',
      'The Perfect Run',
      'A Record of a Mortal’s Journey to Immortality',
      'Soul of Negary',
      'Deep Sea Embers',
      'Tai Sui',
    ],
  },
  {
    id: '1vsz1wh',
    subreddit: 'ReverendInsanity',
    title: 'What to read next',
    url: 'https://www.reddit.com/r/ReverendInsanity/comments/1vsz1wh/novels_to_read_after_reverend_insanity/',
    novels: [
      'Omniscient Reader’s Viewpoint',
      'A Regressor’s Tale of Cultivation',
      'Pursuit of the Truth',
      'The Perfect Run',
      'Mother of Learning',
      'The Beginning After the End',
      'Shadow Slave',
    ],
  },
  {
    id: '1vb4xnn',
    subreddit: 'Webnovel',
    title: 'First webnovel recommendations',
    url: 'https://www.reddit.com/r/Webnovel/comments/1vb4xnn/first_webnovel_recommendation/',
    novels: ['Lord of Mysteries', 'Shadow Slave', 'Reverend Insanity'],
  },
];
export function setupCommunity(store: Store) {
  store.db.exec(`
  CREATE TABLE IF NOT EXISTS reader_ratings(novel_key TEXT NOT NULL,reader_id TEXT NOT NULL,value INTEGER NOT NULL CHECK(value BETWEEN 1 AND 5),updated_at INTEGER NOT NULL,PRIMARY KEY(novel_key,reader_id));
  CREATE TABLE IF NOT EXISTS reddit_threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,subreddit TEXT NOT NULL,score INTEGER,kind TEXT NOT NULL,synced_at INTEGER NOT NULL,expires_at INTEGER);
  CREATE TABLE IF NOT EXISTS reddit_mentions(thread_id TEXT NOT NULL REFERENCES reddit_threads(id) ON DELETE CASCADE,novel_key TEXT NOT NULL,PRIMARY KEY(thread_id,novel_key));
  CREATE TABLE IF NOT EXISTS community_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS reading_events(novel_key TEXT NOT NULL,reader_id TEXT NOT NULL,day TEXT NOT NULL,action TEXT NOT NULL,PRIMARY KEY(novel_key,reader_id,day,action));
`);
  const insert = store.db.prepare(
    "INSERT INTO reddit_threads VALUES (?,?,?,?,NULL,'curated',?,NULL) ON CONFLICT(id) DO NOTHING",
  );
  for (const p of picks) {
    insert.run(p.id, p.title, p.url, p.subreddit, Date.now());
    for (const title of p.novels)
      store.db
        .prepare('INSERT OR IGNORE INTO reddit_mentions VALUES (?,?)')
        .run(p.id, normalizeNovelTitle(title));
  }
}
export class Community {
  constructor(private store: Store) {
    setupCommunity(store);
  }
  key(id: string) {
    const n = this.store.novel(id);
    if (!n) throw new Error('Novel not found');
    return n.catalogKey || normalizeNovelTitle(n.title);
  }
  rating(id: string, readerId?: string): RatingSummary {
    return this.ratingForKey(this.key(id), readerId);
  }
  private ratingForKey(key: string, readerId?: string): RatingSummary {
    const row = this.store.db
      .prepare(
        'SELECT AVG(value) AS average,COUNT(*) AS count FROM reader_ratings WHERE novel_key=?',
      )
      .get(key)!;
    const own = readerId
      ? this.store.db
          .prepare('SELECT value FROM reader_ratings WHERE novel_key=? AND reader_id=?')
          .get(key, readerId)
      : null;
    return {
      average: row.average === null ? null : Math.round(Number(row.average) * 100) / 100,
      count: Number(row.count),
      userRating: own ? Number(own.value) : null,
    };
  }
  rate(id: string, readerId: string, value: number) {
    this.store.db
      .prepare(
        'INSERT INTO reader_ratings VALUES (?,?,?,?) ON CONFLICT(novel_key,reader_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
      )
      .run(this.key(id), readerId, value, Date.now());
    return this.rating(id, readerId);
  }
  decorate(n: Novel): Novel {
    const key = n.catalogKey || normalizeNovelTitle(n.title),
      rating = this.ratingForKey(key);
    const mentions = Number(
      this.store.db.prepare('SELECT COUNT(*) AS n FROM reddit_mentions WHERE novel_key=?').get(key)!
        .n,
    );
    const copies = this.store.db
      .prepare("SELECT data FROM novels WHERE json_extract(data,'$.catalogKey')=?")
      .all(key)
      .map((row) => JSON.parse(String(row.data)) as Novel);
    const rated = copies
      .filter((copy) => copy.communityRating)
      .sort((a, b) => (b.communityRatingCount || 0) - (a.communityRatingCount || 0))[0];
    return {
      ...n,
      cover: n.cover || copies.find((copy) => copy.cover)?.cover || '',
      genres: n.genres.length ? n.genres : [...new Set(copies.flatMap((copy) => copy.genres))],
      communityRating: n.communityRating || rated?.communityRating,
      communityRatingCount: n.communityRatingCount || rated?.communityRatingCount,
      ratingAverage: rating.average,
      ratingCount: rating.count,
      redditMentions: mentions,
    };
  }
  discussions(id: string): RedditDiscussion[] {
    return this.store.db
      .prepare(
        'SELECT t.id,t.title,t.url,t.subreddit,t.score,t.kind FROM reddit_threads t JOIN reddit_mentions m ON m.thread_id=t.id WHERE m.novel_key=? ORDER BY t.kind DESC,t.score DESC',
      )
      .all(this.key(id)) as unknown as RedditDiscussion[];
  }
  record(id: string, readerId: string, action: string) {
    this.store.db
      .prepare('INSERT OR IGNORE INTO reading_events VALUES (?,?,?,?)')
      .run(this.key(id), readerId, new Date().toISOString().slice(0, 10), action);
  }
  feed(genres: string[] = []): DiscoveryFeed {
    const all = this.store.novels();
    // Preserve the same cached-copy preference used by the main catalogue.
    const cached = new Set(
      this.store.db
        .prepare('SELECT DISTINCT novel_id FROM chapters WHERE body IS NOT NULL')
        .all()
        .map((r) => String(r.novel_id)),
    );
    all.sort(
      (a, b) =>
        Number(cached.has(b.id)) - Number(cached.has(a.id)) ||
        (a.source === 'readnovelfull' ? 0 : 1) - (b.source === 'readnovelfull' ? 0 : 1),
    );
    const books = deduplicateNovels(all),
      byKey = new Map(books.map((n) => [n.catalogKey || normalizeNovelTitle(n.title), n]));
    const ranks = new Map<string, number>();
    for (const n of all)
      if (n.popularityRank) {
        const key = n.catalogKey || normalizeNovelTitle(n.title);
        ranks.set(key, Math.min(ranks.get(key) || Infinity, n.popularityRank));
      }
    const reads = new Map(
      this.store.db
        .prepare(
          'SELECT novel_key,COUNT(*) AS n FROM reading_events WHERE day>=? GROUP BY novel_key',
        )
        .all(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
        .map((r) => [String(r.novel_key), Number(r.n)]),
    );
    const top = books
      .filter((n) => ranks.has(n.catalogKey || normalizeNovelTitle(n.title)))
      .sort((a, b) => {
        const score = (n: Novel) => {
          const key = n.catalogKey || normalizeNovelTitle(n.title);
          return 1 / (ranks.get(key) || 10000) + Math.log1p(reads.get(key) || 0) * 0.02;
        };
        return score(b) - score(a);
      })
      .slice(0, 10)
      .map((n) => this.decorate(n));
    const mentioned = this.store.db
      .prepare(
        'SELECT m.novel_key,COUNT(*) AS mentions,SUM(COALESCE(t.score,0)) AS votes FROM reddit_mentions m JOIN reddit_threads t ON t.id=m.thread_id GROUP BY m.novel_key ORDER BY mentions DESC,votes DESC',
      )
      .all();
    const reddit = mentioned
      .map((r) => byKey.get(String(r.novel_key)))
      .filter((n): n is Novel => Boolean(n))
      .slice(0, 12)
      .map((n) => this.decorate(n));
    const requested = genres.map((g) => g.toLowerCase());
    const candidates = books.filter((n) =>
      requested.length
        ? n.genres.some((g) => requested.includes(g.toLowerCase()))
        : Boolean(n.redditMentions) || ranks.has(n.catalogKey || normalizeNovelTitle(n.title)),
    );
    const forYou = (candidates.length ? candidates : books)
      .sort(
        (a, b) =>
          (ranks.get(a.catalogKey || normalizeNovelTitle(a.title)) || 10000) -
          (ranks.get(b.catalogKey || normalizeNovelTitle(b.title)) || 10000),
      )
      .slice(0, 12)
      .map((n) => this.decorate(n));
    const live = this.store.db
      .prepare("SELECT COUNT(*) AS n FROM reddit_threads WHERE kind='rss'")
      .get()!.n;
    return { top10: top, reddit, forYou, redditMode: Number(live) > 0 ? 'rss' : 'curated' };
  }
}
