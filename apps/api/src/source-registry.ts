import { createHash } from 'node:crypto';
import type { SourceId, Source } from '@novelreader/shared';
export type LiveSource = Exclude<SourceId, 'demo'>;
export const sourceIds = [
  'freewebnovel',
  'empirenovel',
  'freewebnovel-net',
  'readnovelfull',
] as const;
export const registry: Record<
  LiveSource,
  { name: string; host: string; aliases: string[]; catalog: string; note: string }
> = {
  freewebnovel: {
    name: 'FreeWebNovel.com',
    host: 'freewebnovel.com',
    aliases: [],
    catalog: '/sort/latest-novel',
    note: 'Cloudflare challenge observed. Availability depends on source access.',
  },
  empirenovel: {
    name: 'EmpireNovel',
    host: 'www.empirenovel.com',
    aliases: ['empirenovel.com'],
    catalog: '/novel-list',
    note: 'Cloudflare challenge observed. HTML adapter needs live validation.',
  },
  'freewebnovel-net': {
    name: 'FreeWebNovel.net',
    host: 'freewebnovel.net',
    aliases: [],
    catalog: '/most-popular',
    note: 'Separate source from FreeWebNovel.com. Live catalogue and paginated chapter HTML available.',
  },
  readnovelfull: {
    name: 'ReadNovelFull',
    host: 'readnovelfull.com',
    aliases: ['www.readnovelfull.com'],
    catalog: '/novel-list/most-popular-novel',
    note: 'Live catalogue HTML; chapter archive endpoint supported.',
  },
};
export const stableId = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);
export function enabled(source: SourceId) {
  return (
    source === 'demo' ||
    (process.env.ENABLED_SOURCES || 'demo,freewebnovel-net,readnovelfull')
      .split(',')
      .map((s) => s.trim())
      .includes(source)
  );
}
export function safeUrl(source: SourceId, value: string) {
  if (source === 'demo') throw new Error('Demo does not accept URLs');
  const config = registry[source];
  const url = new URL(value, `https://${config.host}`);
  if (
    url.protocol !== 'https:' ||
    ![config.host, ...config.aliases].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password
  )
    throw new Error('URL must be HTTPS on the selected source host');
  url.hostname = config.host;
  url.hash = '';
  return url.toString();
}
export function sourceFromUrl(value: string): LiveSource {
  const url = new URL(value);
  const entry = sourceIds.find((id) =>
    [registry[id].host, ...registry[id].aliases].includes(url.hostname),
  );
  if (!entry) throw new Error('Unsupported novel source host');
  safeUrl(entry, value);
  return entry;
}
export function sources(): Source[] {
  return [
    {
      id: 'demo',
      name: 'NovelReader Originals',
      enabled: true,
      note: 'Included original stories.',
    },
    ...sourceIds.map((id) => ({
      id,
      name: registry[id].name,
      enabled: enabled(id),
      note: registry[id].note,
    })),
  ];
}
export function catalogUrl(source: LiveSource, page: number) {
  const config = registry[source];
  return `https://${config.host}${config.catalog}${page === 1 ? '' : source === 'freewebnovel' ? `/${page}` : `?page=${page}`}`;
}
