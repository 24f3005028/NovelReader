import { load } from 'cheerio';
import type { Novel, Chapter } from '@novelreader/shared';
import { html, SourceError } from './transport.js';
import { catalogUrl, safeUrl, type LiveSource } from './source-registry.js';
import { parseCatalog, parseNovel, nextCatalogPage } from './parsers.js';
export { html, SourceError } from './transport.js';
export {
  enabled,
  sources,
  safeUrl,
  stableId,
  sourceFromUrl,
  sourceIds,
  registry,
} from './source-registry.js';
export { parseCatalog, parseNovel, parseBody } from './parsers.js';
export async function browse(source: LiveSource, page: number) {
  const url = catalogUrl(source, page);
  const body = await html(source, url);
  const items = parseCatalog(source, body, url).map((n, i) => ({
    ...n,
    popularityRank: (page - 1) * (source === 'readnovelfull' ? 20 : 22) + i + 1,
  }));
  if (!items.length)
    throw new SourceError(
      'No novel metadata found. The source layout may have changed.',
      'CATALOG_EMPTY',
    );
  return { items, hasNext: nextCatalogPage(source, body, page, url) !== null };
}
export async function chapterIndex(
  novel: Novel,
  onPage?: (novel: Novel, chapters: Chapter[]) => void | Promise<void>,
  shouldCancel?: () => boolean,
) {
  const pending = [novel.url],
    seen = new Set<string>(),
    chapters = new Map<string, Chapter>();
  let metadata = novel;
  let expected = 0;
  let exactExpected = 0;
  while (pending.length) {
    if (shouldCancel?.()) throw new SourceError('Import cancelled', 'CANCELLED');
    const url = pending.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const body = await html(novel.source, url);
    const parsed = parseNovel({ ...novel, url }, body);
    const d = load(body);
    if (seen.size === 1) {
      metadata = { ...parsed.novel, url: novel.url };
      expected = metadata.chapterCount;
      exactExpected = Number(d('#list-chapter').attr('data-total-chapters')) || 0;
    }
    for (const c of parsed.chapters) chapters.set(c.id, c);
    const links = d(
      '.chapter-pagination a[href], .chapter-list-pagination a[href], #list-chapter .pagination a[href], #list-chapter .page a[href], #barcon a[href]',
    );
    links.each((_, a) => {
      try {
        const next = safeUrl(novel.source, new URL(d(a).attr('href')!, url).toString());
        const nextUrl = new URL(next);
        if (
          nextUrl.pathname === new URL(novel.url).pathname &&
          !seen.has(next) &&
          !pending.includes(next)
        )
          pending.push(next);
      } catch {}
    });
    const pages = Number(d('#list-chapter').attr('data-total-page')) || 0;
    if (pages > 0 && seen.size === 1) {
      for (let page = 2; page <= pages; page++) {
        const next = new URL(novel.url);
        next.searchParams.set('page', String(page));
        pending.push(next.toString());
      }
    }
    if (novel.source === 'readnovelfull' && seen.size === 1) {
      const id = d('[data-novel-id]').first().attr('data-novel-id');
      if (!id) throw new SourceError('Novel ID missing for chapter archive', 'ARCHIVE_ID_MISSING');
      const archive = await html(
        novel.source,
        `https://readnovelfull.com/ajax/chapter-archive?novelId=${encodeURIComponent(id)}`,
      );
      const indexed = parseNovel(novel, `<div id="list-chapter">${archive}</div>`);
      for (const c of indexed.chapters) chapters.set(c.id, c);
    }
    // Persist each page, so already discovered chapters survive interruptions.
    const partial = [...chapters.values()];
    partial.forEach((c, i) => (c.ordinal = i + 1));
    await onPage?.({ ...metadata, chapterCount: Math.max(expected, partial.length) }, partial);
  }
  const ordered = [...chapters.values()];
  ordered.sort((a, b) => {
    const num = (c: Chapter) => {
      const m = c.title.match(/(?:chapter|ch\.?|c\.)\s*(\d+(?:\.\d+)?)/i);
      return m
        ? Number(m[1])
        : /prologue/i.test(c.title)
          ? -1
          : /epilogue|postscript|afterword/i.test(c.title)
            ? Infinity
            : Number.NaN;
    };
    const x = num(a),
      y = num(b);
    return Number.isNaN(x) || Number.isNaN(y) ? 0 : x - y;
  });
  ordered.forEach((c, i) => (c.ordinal = i + 1));
  if (!ordered.length)
    throw new SourceError('No chapters found in source archive', 'CHAPTER_INDEX_MISSING');
  if (exactExpected > 0 && ordered.length < exactExpected)
    throw new SourceError(
      `Incomplete chapter index: found ${ordered.length} of ${exactExpected} advertised chapters. Discovered chapters were saved; retry to continue.`,
      'INCOMPLETE_INDEX',
      true,
    );
  return {
    novel: {
      ...metadata,
      chapterCount: ordered.length,
      ...(expected !== ordered.length ? { reportedChapterCount: expected } : {}),
    },
    chapters: ordered,
  };
}
