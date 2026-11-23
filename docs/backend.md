# Backend and scraping

The backend stores a shared novel catalogue, chapter index records, cached chapter bodies, import jobs, chapter failures, and catalogue page checkpoints in SQLite. Source adapters are separated into `source-registry.ts`, `transport.ts`, `parsers.ts`, and `sources.ts`.

## Background chapter lists and on-demand reading

The worker backfills chapter lists for enabled sources in the existing catalogue and picks up newly discovered novels automatically. It resumes interrupted jobs after a restart, rotates through sources, and can revisit failed indexes or refresh titles when the catalogue advertises more chapters. Set `AUTO_INDEX_CHAPTERS=false` to disable automatic backfill and refresh.

Paste a book URL to add a specific title and queue its chapter list immediately.

```http
POST /imports
Content-Type: application/json

{"url":"https://freewebnovel.net/renegade-immortal.html"}
```

Returns `{ novel, job }` with a persistent `index` job. The worker follows chapter-list pagination, normalizes URLs, and stores chapter numbers and titles without requesting chapter text. Metadata is persisted as index pages arrive, so a reader can select an already discovered chapter while indexing continues.

```http
GET /novels/NOVEL_ID
```

Returns `{ novel, chapters, job, chapterIndexPending }`. A chapter's `downloaded` field means its body is cached **on the backend**; device-local download status is managed separately by the mobile app. Webnovel chapters marked `locked` open on Webnovel.

```http
POST /novels/NOVEL_ID/chapter-batches
Content-Type: application/json

{"chapterId":"CHAPTER_ID","prioritize":true}
```

Queues up to 100 chapter bodies by reading order, aligned to the block containing the requested chapter. It skips cached or locked chapters. Returns the requested chapter immediately if cached, or HTTP 202 with its job. The reader starts as soon as that chapter is ready. Repeated calls share queued jobs, and `prioritize` moves the requested chapter ahead of background work. The content queue runs separately from chapter-list indexing.

```http
GET /jobs/JOB_ID
GET /chapters/CHAPTER_ID
```

The app polls the job, then reads the cached body. The chapter GET returns HTTP 409 with `CHAPTER_NOT_CACHED` before the text is available. Opening the same chapter again serves the database copy.

## Explicit bulk import

```http
POST /novels/NOVEL_ID/import
Content-Type: application/json

{"mode":"all"}
```

This fetches the index and all available chapter bodies. Already cached bodies are skipped. Individual failures are recorded while the worker continues with other chapters; retrying imports only the missing bodies. A source challenge or robots prohibition stops the import instead of repeatedly hitting an inaccessible source. The first chapter can be made available before a large bulk index finishes. To refresh only chapter metadata, use `{ "mode": "index" }` or omit the body.

Source chapter numbers can contain gaps, repeated numbered parts, prologues, and epilogues. `ordinal` is the app's sequential reading order, `number` stores the parsed source number (including decimals), and `title` preserves the source's chapter label. `reportedChapterCount` records a differing advertised count when a verified archive exposes a different number of unique chapter URLs. Nothing is fabricated to fill missing source chapters.

## Catalogue crawling

```http
POST /catalog/freewebnovel-net/start
POST /catalog/readnovelfull/start
POST /catalog/webnovel/start
GET /catalog
POST /catalog/freewebnovel-net/cancel
```

Every completed page has a fingerprint, record count, and timestamp. Starting a failed/cancelled crawl resumes the pending page; starting a completed crawl begins a refresh. A repeated page fingerprint at a different page number fails with a pagination diagnostic. Existing novel records do not prematurely end a refresh.

The default routes are FreeWebNovel.net `/most-popular?page=N` and ReadNovelFull `/novel-list/most-popular-novel?page=N`. FreeWebNovel.net chapter indexes expose page counts and ordinary server-rendered `?page=N` navigation. ReadNovelFull initially shows only a small chapter sample; its public JavaScript uses `/ajax/chapter-archive?novelId=ID`, which robots.txt explicitly allows. The adapter reads the novel ID from the page and uses that same public archive.

Webnovel indexes its featured and genre pages under `/stories/novel`. Genre pages may list the same titles. The public `/book/BOOK_ID/catalog` archive supplies chapter metadata.

## Other endpoints

| Method | Route                                    | Purpose                                                          |
| ------ | ---------------------------------------- | ---------------------------------------------------------------- |
| GET    | `/health`                                | API health                                                       |
| GET    | `/sources`                               | Source names, enabled flags, notes                               |
| POST   | `/sources/:source/probe`                 | Live catalogue diagnostic: record/cover counts and access errors |
| GET    | `/novels?q=&genre=&source=&page=1`       | Search stored novel metadata, 30 per page                        |
| GET    | `/genres`                                | Genre names available in the catalogue                           |
| POST   | `/novels`                                | Add metadata using `{ source, url, title }`                      |
| POST   | `/sources/:source/sync`                  | Fetch a single catalogue page using `{ page }`                   |
| GET    | `/jobs/:id/failures`                     | Failed chapter IDs and errors                                    |
| POST   | `/jobs/:id/cancel`                       | Cancel queued/running job                                        |
| GET    | `/novels/:id/download?offset=0&limit=20` | Batch of stored bodies and pending chapter IDs; limit up to 50   |

All content and mutation routes use a bearer token if `API_TOKEN` is configured. `/health` remains public. This is a personal-reader API; add per-user authentication and ownership before running a multi-user service.

`/novels` also accepts `completed=true`, `reddit=true`, and `sort=chapters` or `sort=title`. Sorting applies across the matching catalogue before pagination.

## Adding a source

1. Add its ID to the shared `SourceId` type and the registry's `sourceIds`.
2. Register its exact HTTPS host, aliases, listing route, and source note.
3. Inspect real listing, detail, chapter-list, and chapter HTML. Add explicit source selectors or a public archive loader where needed.
4. Verify robots.txt, paging, title/cover extraction, chapter ordering, and a real chapter read with `probe` and an index import.
5. Add fixtures and regression tests; enable the source only after live validation.

Source HTML is untrusted. The reader renders extracted plain text rather than source HTML. The API rejects off-host scrape URLs, credentials in URLs, arbitrary ports, non-HTTPS URLs, and unsafe redirects. Fetches are paced per source, capped at 8 MB, and use 25-second timeouts with exponential retry for transient network/HTTP failures. Robots rules are cached for one hour. There is no challenge-solving service, proxy rotation, source account-cookie extraction, or paywall handling.
