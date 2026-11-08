import robotsParser from 'robots-parser';
import type { SourceId } from '@novelreader/shared';
import { enabled, safeUrl } from './source-registry.js';
export class SourceError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable = false,
    public status?: number,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}
const rulesCache = new Map<string, { rules: ReturnType<typeof robotsParser>; expires: number }>();
const gates = new Map<string, Promise<unknown>>();
const last = new Map<string, number>();
export async function raw(source: SourceId, url: string, redirects = 0): Promise<string> {
  const safe = safeUrl(source, url);
  let response: Response;
  try {
    response = await fetch(safe, {
      redirect: 'manual',
      signal: AbortSignal.timeout(25000),
      headers: {
        'User-Agent': 'NovelReaderBot/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    });
  } catch (e) {
    throw new SourceError(
      `Cannot reach ${new URL(safe).hostname}: ${e instanceof Error ? e.message : 'network error'}`,
      'NETWORK_ERROR',
      true,
    );
  }
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirects >= 3) throw new SourceError('Too many source redirects', 'REDIRECT_LIMIT');
    const location = response.headers.get('location');
    if (!location) throw new SourceError('Source redirect has no destination', 'BAD_REDIRECT');
    return raw(source, safeUrl(source, new URL(location, safe).toString()), redirects + 1);
  }
  if (response.status === 404 && new URL(safe).pathname === '/robots.txt') return '';
  if (!response.ok) {
    const body = (await response.text()).slice(0, 10000);
    const challenge = /just a moment|cf-chl-|challenge-platform|captcha/i.test(body);
    throw new SourceError(
      challenge
        ? `${new URL(safe).hostname} requires a browser challenge (HTTP ${response.status}). Use another source or retry when access is available.`
        : `Source returned HTTP ${response.status} for ${new URL(safe).pathname}`,
      challenge ? 'SOURCE_CHALLENGE' : response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR',
      !challenge && [408, 429, 500, 502, 503, 504].includes(response.status),
      response.status,
    );
  }
  const type = response.headers.get('content-type') || '';
  if (!/text\/|application\/(json|xml|xhtml\+xml)/i.test(type))
    throw new SourceError('Source did not return readable content', 'INVALID_CONTENT');
  const max = 8_000_000;
  if (Number(response.headers.get('content-length')) > max)
    throw new SourceError('Source response too large', 'RESPONSE_TOO_LARGE');
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new SourceError('Source response too large', 'RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function html(source: SourceId, path: string): Promise<string> {
  const url = safeUrl(source, path);
  if (!enabled(source))
    throw new SourceError('Source disabled in ENABLED_SOURCES', 'SOURCE_DISABLED');
  const origin = new URL(url).origin;
  const task = (gates.get(origin) || Promise.resolve()).then(async () => {
    let cached = rulesCache.get(origin);
    if (!cached || cached.expires < Date.now()) {
      cached = {
        rules: robotsParser(`${origin}/robots.txt`, await raw(source, `${origin}/robots.txt`)),
        expires: Date.now() + 3600000,
      };
      rulesCache.set(origin, cached);
    }
    if (cached.rules.isAllowed(url, 'NovelReaderBot') === false)
      throw new SourceError('Source robots.txt disallows this URL', 'ROBOTS_DISALLOWED');
    const delay = Math.max(
      1000,
      Number(process.env.SCRAPE_DELAY_MS) || 1500,
      (cached.rules.getCrawlDelay('NovelReaderBot') || 0) * 1000,
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((r) =>
        setTimeout(r, Math.max(0, (last.get(origin) || 0) + delay - Date.now())),
      );
      last.set(origin, Date.now());
      try {
        return await raw(source, url);
      } catch (e) {
        if (!(e instanceof SourceError) || !e.retryable || attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, Math.min(30000, 2000 * 2 ** attempt)));
      }
    }
    throw new SourceError('Source fetch failed', 'FETCH_FAILED');
  });
  gates.set(
    origin,
    task.then(
      () => {},
      () => {},
    ),
  );
  return task;
}
