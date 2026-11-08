import { load } from 'cheerio';
import { normalizeNovelTitle } from '@novelreader/shared';
import { Store } from './db.js';
import { setupCommunity } from './community.js';
export function parseRedditFeed(xml: string) {
  const d = load(xml, { xmlMode: true });
  return d('entry')
    .toArray()
    .map((entry) => {
      const el = d(entry);
      const url =
        el.find('link[rel="alternate"]').attr('href') || el.find('link').attr('href') || '';
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      if (
        parsed.protocol !== 'https:' ||
        !['www.reddit.com', 'reddit.com', 'old.reddit.com'].includes(parsed.hostname) ||
        !/^\/r\/[^/]+\/comments\/([a-z0-9]+)\//i.test(parsed.pathname)
      )
        return null;
      const id = parsed.pathname.match(/\/comments\/([a-z0-9]+)\//i)![1];
      const title = el.find('title').first().text().trim();
      const text = load(el.find('content').text())('body').text();
      return {
        id,
        title,
        url: `https://www.reddit.com${parsed.pathname}`,
        subreddit: parsed.pathname.split('/')[2],
        text,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
}
export class RedditSync {
  private busy = false;
  private nextRequest = 0;
  constructor(private store: Store) {
    setupCommunity(store);
  }
  configured() {
    return process.env.REDDIT_RSS_ENABLED !== 'false';
  }
  status() {
    const row = this.store.db
      .prepare("SELECT value FROM community_state WHERE key='reddit_sync'")
      .get();
    return {
      enabled: this.configured(),
      method: 'public-rss',
      ...(row ? JSON.parse(String(row.value)) : { status: 'curated', updatedAt: null }),
      syncing: this.busy,
    };
  }
  private state(value: unknown) {
    this.store.db
      .prepare(
        "INSERT INTO community_state VALUES ('reddit_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(value));
  }
  ingestFeed(xml: string) {
    const entries = parseRedditFeed(xml);
    const keys = new Set(
      this.store.novels().map((n) => n.catalogKey || normalizeNovelTitle(n.title)),
    );
    let matched = 0;
    this.store.db.exec('BEGIN');
    try {
      for (const post of entries) {
        if (
          !/recommend|favorite|favourite|best|top|read|tier|review/i.test(
            `${post.title} ${post.text}`,
          )
        )
          continue;
        const text = ` ${normalizeNovelTitle(`${post.title} ${post.text}`).replace(/\blord of the mysteries\b/g, 'lord of mysteries')} `;
        const mentions = [...keys].filter(
          (key) => key.length >= 8 && key.includes(' ') && text.includes(` ${key} `),
        );
        if (!mentions.length) continue;
        this.store.db
          .prepare(
            "INSERT INTO reddit_threads VALUES (?,?,?,?,NULL,'rss',?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,url=excluded.url,kind='rss',synced_at=excluded.synced_at,expires_at=excluded.expires_at",
          )
          .run(
            post.id,
            post.title.slice(0, 300),
            post.url,
            post.subreddit,
            Date.now(),
            Date.now() + 24 * 3600000,
          );
        this.store.db.prepare('DELETE FROM reddit_mentions WHERE thread_id=?').run(post.id);
        for (const key of mentions)
          this.store.db
            .prepare('INSERT OR IGNORE INTO reddit_mentions VALUES (?,?)')
            .run(post.id, key);
        matched++;
      }
      this.store.db.exec('COMMIT');
    } catch (e) {
      this.store.db.exec('ROLLBACK');
      throw e;
    }
    this.state({ status: 'synced', updatedAt: Date.now(), threads: matched, error: null });
    return { entries: entries.length, matched };
  }
  async tick() {
    this.store.db
      .prepare("DELETE FROM reddit_threads WHERE kind='rss' AND expires_at<?")
      .run(Date.now());
    const status = this.status();
    if (
      this.configured() &&
      !this.busy &&
      (!status.updatedAt || Date.now() - status.updatedAt > 6 * 3600000)
    )
      await this.sync();
  }
  async sync() {
    if (this.busy || !this.configured()) return;
    this.busy = true;
    let total = 0;
    try {
      const subs = (
        process.env.REDDIT_SUBREDDITS || 'noveltranslations,LightNovels,ProgressionFantasy'
      )
        .split(',')
        .filter((s) => /^[A-Za-z0-9_]{2,40}$/.test(s))
        .slice(0, 5);
      for (const sub of subs) {
        await new Promise((r) => setTimeout(r, Math.max(0, this.nextRequest - Date.now())));
        this.nextRequest = Date.now() + 65000;
        const response = await fetch(`https://www.reddit.com/r/${sub}/top/.rss?t=month`, {
          redirect: 'error',
          headers: {
            'User-Agent': 'NovelReader/1.0 public RSS reader',
            Accept: 'application/atom+xml,application/rss+xml,application/xml',
          },
          signal: AbortSignal.timeout(25000),
        });
        if (!response.ok) {
          if (response.status === 429)
            this.nextRequest =
              Date.now() +
              Math.max(65000, (Number(response.headers.get('retry-after')) || 900) * 1000);
          throw new Error(`Public Reddit feed returned HTTP ${response.status}`);
        }
        if (!/xml/.test(response.headers.get('content-type') || ''))
          throw new Error('Reddit feed did not return XML');
        const xml = await response.text();
        if (xml.length > 2_000_000) throw new Error('Reddit feed too large');
        total += this.ingestFeed(xml).matched;
      }
      this.state({ status: 'synced', updatedAt: Date.now(), threads: total, error: null });
    } catch (e) {
      this.state({
        status: 'using-curated-picks',
        updatedAt: Date.now(),
        error: e instanceof Error ? e.message : 'Public feed unavailable',
      });
    } finally {
      this.busy = false;
    }
  }
}
