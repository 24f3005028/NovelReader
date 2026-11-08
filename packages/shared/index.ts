export type SourceId =
  'demo' | 'freewebnovel' | 'empirenovel' | 'freewebnovel-net' | 'readnovelfull';
export interface Novel {
  catalogKey?: string;
  popularityRank?: number;
  communityRating?: number;
  communityRatingCount?: number;
  ratingAverage?: number | null;
  ratingCount?: number;
  redditMentions?: number;
  reportedChapterCount?: number;
  id: string;
  source: SourceId;
  url: string;
  title: string;
  author: string;
  description: string;
  cover: string;
  genres: string[];
  chapterCount: number;
}
export interface Chapter {
  // Ordinal is reading order; source chapter numbering stays in title.
  id: string;
  novelId: string;
  ordinal: number;
  number?: number | null;
  title: string;
  url: string;
  downloaded: boolean;
}
export interface ChapterContent extends Chapter {
  paragraphs: string[];
}
export function normalizeNovelTitle(title: string): string {
  const normalized =
    title
      .normalize('NFKC')
      .toLowerCase()
      .replace(/&amp;/g, '&')
      .replace(/\((?:web\s*|light\s*)?novel\)\s*$/i, '')
      .replace(/['’‘`´]/g, '')
      .replace(/&/g, ' and ')
      .match(/[\p{L}\p{N}]+/gu)
      ?.join(' ') || '';
  return normalized === 'lord of the mysteries' ? 'lord of mysteries' : normalized;
}
export function sourceChapterNumber(title: string): number | null {
  const match = title.match(/(?:chapter|ch\.?|c\.)\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}
export function deduplicateNovels(items: Novel[]): Novel[] {
  const seen = new Set<string>();
  return items.filter((n) => {
    const key = normalizeNovelTitle(n.title) || n.catalogKey || n.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export interface ImportJob {
  mode: 'index' | 'all' | 'chapter';
  chapterId: string | null;
  id: string;
  novelId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  completed: number;
  error: string | null;
}
export interface ChapterImportResponse {
  chapter: ChapterContent | null;
  job: ImportJob | null;
}
export interface Source {
  id: SourceId;
  name: string;
  enabled: boolean;
  note: string;
}
export interface NovelDetail {
  novel: Novel;
  chapters: Chapter[];
  job: ImportJob | null;
}
export interface RatingSummary {
  average: number | null;
  count: number;
  userRating: number | null;
}
export interface RedditDiscussion {
  id: string;
  title: string;
  url: string;
  subreddit: string;
  score: number | null;
  kind: 'curated' | 'rss';
}
export interface DiscoveryFeed {
  top10: Novel[];
  reddit: Novel[];
  forYou: Novel[];
  redditMode: 'curated' | 'rss';
}
