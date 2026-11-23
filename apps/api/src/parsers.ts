import { load } from 'cheerio';
import type { Chapter, Novel, NovelStatus } from '@novelreader/shared';
import {
  novelId,
  safeUrl,
  stableId,
  registry,
  webnovelBookId,
  type LiveSource,
} from './source-registry.js';
import { SourceError } from './transport.js';
const imageUrl = (value: string | undefined, base: string) => {
  try {
    if (!value) return '';
    const url = new URL(value, base);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
};
function novelStatus(value: string): NovelStatus | undefined {
  if (/^(?:completed|complete|full|finished)$/i.test(value.trim())) return 'completed';
  if (/^(?:ongoing|updating|in progress)$/i.test(value.trim())) return 'ongoing';
}
export function parseCatalog(source: LiveSource, body: string, base: string): Novel[] {
  const d = load(body),
    result = new Map<string, Novel>();
  // Restrict to listing containers so sidebar recommendations cannot distort page coverage.
  const selector =
    source === 'webnovel'
      ? 'h3 a[href^="/book/"]'
      : source === 'readnovelfull'
        ? '#list-page .list-novel .novel-title a, #list-page .list .novel-title a'
        : source === 'freewebnovel-net'
          ? '#list-page .fwn-rank-list .li-row h3 a'
          : 'h3 a[href], .novel-title a[href], .book-title a[href], .tit a[href], .post-title a[href]';
  const nodes = d(selector).length ? d(selector) : d('h3 a[href], .novel-title a[href]');
  nodes.each((_, el) => {
    const a = d(el);
    try {
      const url = safeUrl(source, new URL(a.attr('href')!, base).toString()),
        path = new URL(url).pathname,
        title = a.text().trim();
      if (!title || /\/chapter[-/\d]/i.test(path)) return;
      if (source === 'webnovel' && !/^\/book\/[^/]+_\d+$/.test(path)) return;
      if (source === 'freewebnovel' && !/^\/novel\/[^/]+\/?$/.test(path)) return;
      if (['freewebnovel-net', 'readnovelfull'].includes(source) && !/^\/[^/]+\.html$/.test(path))
        return;
      let card = a.closest(
        source === 'readnovelfull'
          ? '.row'
          : '.li-row, .novel-item, .book-item, .page-item-detail, article, li',
      );
      if (!card.length) {
        card = a.parent();
        for (let i = 0; i < 3 && !card.find('img').length; i++) card = card.parent();
      }
      const img = card.find('img').first();
      let cover = imageUrl(
        img.attr('data-src') || img.attr('data-original') || img.attr('src'),
        base,
      );
      if (source === 'readnovelfull')
        cover = cover.replace('/thumb/t-200x89/', '/thumb/t-300x439/');
      const id = novelId(source, url);
      const genres = card
        .find('a[href*="/genre/"], a[href*="/genres/"], a[href^="/tags/"]')
        .toArray()
        .map((a) => d(a).text().replace(/^#\s*/, '').trim())
        .filter(Boolean);
      const count =
        source === 'webnovel'
          ? card
              .find('strong span')
              .filter((_, el) => /chapters?$/i.test(d(el).text().trim()))
              .first()
              .text()
              .match(/(\d[\d,]*)\s+chapters?/i)
          : card
              .find('.chapter,.chr-text')
              .text()
              .match(/(?:chapter\s*)?(\d[\d,]*)/i);
      const status = card.find('.label-full').length
        ? 'completed'
        : novelStatus(card.find('.chapter .s2').first().text());
      const old = result.get(id);
      const rated = Number(
        (card.find('.core').attr('title') || '').match(/([\d.]+)\s*\/\s*5/)?.[1],
      );
      result.set(id, {
        id,
        source,
        url,
        title,
        author: card.find('.author').text().trim() || old?.author || 'Unknown',
        description: source === 'webnovel' ? card.find('h3 + p').first().text().trim() : '',
        cover: cover || old?.cover || '',
        genres: genres.length ? [...new Set(genres)] : old?.genres || [],
        chapterCount: count ? Number(count[1].replaceAll(',', '')) : old?.chapterCount || 0,
        status: status || old?.status,
        ...(rated > 0 && rated <= 5 ? { communityRating: rated } : {}),
      });
    } catch {}
  });
  return [...result.values()];
}
export function parseNovel(novel: Novel, body: string): { novel: Novel; chapters: Chapter[] } {
  const d = load(body),
    seen = new Set<string>(),
    chapters: Chapter[] = [];
  if (novel.source === 'webnovel') {
    const header = d('.det-info').first();
    const detail = (label: string) => header.find(`svg[title="${label}"] + span`).first().text();
    const bookId = webnovelBookId(novel.url);
    d('.volume-item li[data-cid] > a[href]').each((_, el) => {
      const a = d(el);
      const url = safeUrl('webnovel', a.attr('href')!);
      const path = new URL(url).pathname.split('/');
      if (!bookId || !path[2]?.endsWith(`_${bookId}`) || !path[3] || seen.has(url)) return;
      const title = a.attr('title') || a.find('strong').first().text().trim();
      if (!title) return;
      seen.add(url);
      chapters.push({
        id: stableId(url),
        novelId: novel.id,
        ordinal: chapters.length + 1,
        number: Number(a.find('._num').first().text()) || null,
        title,
        url,
        locked: a.find('use[href="#i-lock"]').length > 0,
        downloaded: false,
      });
    });
    const genre = detail('Genre').trim();
    return {
      novel: {
        ...novel,
        title: header.find('h1').first().text().trim() || novel.title,
        author: header.find('address strong + span').first().text().trim() || novel.author,
        cover: imageUrl(header.find('img').first().attr('src'), novel.url) || novel.cover,
        status: novelStatus(detail('Status')) || novel.status,
        genres: [
          ...new Map(
            [...novel.genres, genre].filter(Boolean).map((g) => [g.toLowerCase(), g]),
          ).values(),
        ],
        chapterCount:
          Number(
            detail('Chapters')
              .match(/\d[\d,]*/)?.[0]
              .replaceAll(',', ''),
          ) || chapters.length,
      },
      chapters,
    };
  }
  const scope = d('#list-chapter').length
    ? d('#list-chapter')
    : d('.chapter-list,.wp-manga-chapter,.m-newest2');
  let links = scope.find('a[href]');
  if (!links.length) links = d('a[href*="/chapter-"]');
  links.each((_, el) => {
    const a = d(el);
    try {
      const url = safeUrl(novel.source, new URL(a.attr('href')!, novel.url).toString());
      const parsed = new URL(url),
        base = new URL(novel.url);
      if (
        parsed.pathname === base.pathname ||
        a.closest('.pagination,.page,.chapter-pagination,.chapter-list-pagination').length ||
        seen.has(url)
      )
        return;
      if (!/\.html$|\/chapter[-/\d]/i.test(parsed.pathname)) return;
      const title = (a.text() || a.attr('title') || '').trim();
      if (!title) return;
      seen.add(url);
      chapters.push({
        id: stableId(url),
        novelId: novel.id,
        url,
        title,
        ordinal: chapters.length + 1,
        downloaded: false,
      });
    } catch {}
  });
  chapters.sort((a, b) => {
    const x = a.title.match(/(?:chapter|ch\.?)\s*(\d+)/i),
      y = b.title.match(/(?:chapter|ch\.?)\s*(\d+)/i);
    return x && y ? Number(x[1]) - Number(y[1]) : 0;
  });
  chapters.forEach((c, i) => (c.ordinal = i + 1));
  if (!chapters.length && novel.source !== 'readnovelfull')
    throw new SourceError(
      'No chapter links found in the chapter-list container',
      'CHAPTER_INDEX_MISSING',
    );
  const title =
    d('h1.tit,h3.title,h1[itemprop=name],.novel-title h1,h1').first().text().trim() || novel.title;
  const description = d(
    '#novel-summary-inner,.desc-text,.summary__content,.m-desc .txt,.description',
  )
    .first()
    .text()
    .trim();
  const author = d(
    '.m-imgtxt a[href*="/author/"],.info a[itemprop=author],.info a[href*="/author/"]',
  )
    .toArray()
    .map((a) => d(a).text().trim())
    .filter(Boolean)
    .join(', ');
  const genres = d('.m-imgtxt a[href*="/genre/"],.info a[href*="/genre"],.info a[href*="/genres/"]')
    .toArray()
    .map((a) => d(a).text().trim())
    .filter(Boolean);
  const img = d('.m-imgtxt .pic img,.book img,img[itemprop=image]').first();
  const rawRating =
    Number(
      d('[itemprop=ratingValue]').first().text() || d('[itemprop=ratingValue]').attr('content'),
    ) || Number(d('#novel-score').attr('data-avg'));
  const scale =
    Number(
      d('[itemprop=bestRating]').first().text() || d('[itemprop=bestRating]').attr('content'),
    ) || (novel.source === 'readnovelfull' ? 10 : 5);
  const communityRating =
    rawRating > 0 && rawRating <= scale ? Math.round((rawRating / scale) * 500) / 100 : 0;
  const status = novelStatus(
    d('.m-imgtxt [title="Status"] + .right').first().text() ||
      d('.info-meta li')
        .filter((_, el) => /^status\s*:/i.test(d(el).text().trim()))
        .find('a')
        .first()
        .text(),
  );
  return {
    novel: {
      ...novel,
      status: status || novel.status,
      title,
      description: description || novel.description,
      author: author || novel.author,
      genres: genres.length ? [...new Set(genres)] : novel.genres,
      cover: imageUrl(img.attr('data-src') || img.attr('src'), novel.url) || novel.cover,
      ...(communityRating
        ? {
            communityRating,
            communityRatingCount:
              Number(
                d('[itemprop=reviewCount]').first().text() ||
                  d('[itemprop=reviewCount]').attr('content'),
              ) || undefined,
          }
        : {}),
      chapterCount: Math.max(
        chapters.length,
        Number(d('#list-chapter').attr('data-total-chapters')) || 0,
      ),
    },
    chapters,
  };
}
export function parseBody(body: string, source?: Novel['source']): string[] {
  const d = load(body);
  if (source === 'webnovel' && d('[data-islock="1"], .cha-content._lock').length)
    throw new SourceError('Open this locked chapter on Webnovel', 'CHAPTER_LOCKED');
  d(
    'script,style,iframe,.ads,.adsbygoogle,ins,.chapter-nav,.report,.chr-title,.chapter-title,.chapter-end,.unlock-content',
  ).remove();
  const content = d(
    source === 'webnovel'
      ? '.cha-words .cha-paragraph'
      : '#chapter-content,#chr-content,.reading-content .text-left,.chapter-content,.txt #content,.txt',
  );
  const readable = source === 'webnovel' ? content : content.first();
  readable.find('br').replaceWith('\n');
  const blocks = readable
    .find('p')
    .toArray()
    .map((p) =>
      d(p)
        .text()
        .replace(/\u00a0/g, ' ')
        .trim(),
    )
    .filter(Boolean);
  const result = blocks.length
    ? blocks
    : readable
        .text()
        .split(/\n+/)
        .map((s) => s.replace(/\u00a0/g, ' ').trim())
        .filter(Boolean);
  if (result.join('').length < 80)
    throw new SourceError('Chapter content missing, blocked, or too short', 'CHAPTER_BODY_MISSING');
  return result;
}
export function nextCatalogPage(source: LiveSource, body: string, current: number, base: string) {
  const d = load(body);
  let next: number | null = null;
  d('a[href]').each((_, el) => {
    try {
      const url = new URL(safeUrl(source, new URL(d(el).attr('href')!, base).toString()));
      if (!url.pathname.startsWith(registry[source].catalog)) return;
      const n =
        source === 'freewebnovel'
          ? Number(url.pathname.match(/\/(\d+)\/?$/)?.[1])
          : Number(url.searchParams.get('page'));
      if (n === current + 1) next = n;
    } catch {}
  });
  return next;
}
