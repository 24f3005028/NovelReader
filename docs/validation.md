# Verification — 8 November 2026

## OVH / Coolify deployment

- Created a separate NovelReader project, production environment, and API resource on the existing VPS.
- Docker deployment passed its health check; generated sslip.io domain has valid HTTPS and redirects HTTP to HTTPS.
- `/health` returned 200; unauthenticated `/stats` returned 401; authenticated catalogue requests returned 200.
- The VPS independently completed Renegade Immortal's 2,093-entry chapter index. Selecting Chapter 1 fetched and cached 100 text paragraphs while the remaining index was still running.
- Remote discovery returned ten unique Top 10 entries and twelve Reddit discussion picks.
- Configured a named volume mounted at `/data`; database backup/restore has not yet been exercised.
- Expo account was verified on the Free plan with 0/15 Android builds used before starting the APK build. No plan upgrade or new hosting subscription was selected.

## Live source checks

- Completed FreeWebNovel.net's exposed 320-page catalogue crawl; local database contains **7,030** novel records from that source.
- Completed ReadNovelFull's exposed 123-page catalogue crawl; local database contains **2,450** records from that source.
- Across both sources: **9,480** live novel records and **9,460** usable cover URLs. Twenty catalogue records did not expose usable artwork; inspected examples used the source's `no-thumbnail.jpg` placeholder. The app provides a title fallback.
- Indexed all **2,093** chapter entries exposed for _Renegade Immortal_ with no chapter bodies fetched in index mode.
- Indexed **3,816** unique chapter URLs exposed by _World Defying Dan God_'s complete public archive. Its advertised latest number differs from the number of unique archive entries; the application stores actual indexed entries and retains the reported count separately.
- Selected one chapter of _World Defying Dan God_: the single-chapter job completed and exactly one body became cached for that novel. A subsequent request uses the cached body.
- Explicit bulk-mode validation completed all **45** available chapters of _The Solar Heretic_ before the default was changed to index-only, matching the user's later preference.
- FreeWebNovel.com and EmpireNovel returned Cloudflare browser challenge pages and remain disabled by default. The working `.net` source is labelled separately from `.com`.

These counts describe this local database and this verification run; the source catalogues can change. After cross-source title grouping, the reader catalogue contains **7,818 unique entries**, including the three original samples. Live data is not committed to the public repository. Catalogue refreshes are managed through the backend CLI.

## Automated checks

`npm run check`: TypeScript for API/mobile, mobile ESLint, and **19 passing backend tests**. Tests cover stored chapter reads, job deduplication/restart/cancellation, input validation, title/cover parsing, plain-text extraction, API token checks, catalogue paging, bulk imports, index-only behavior, single-chapter on-demand fetching and caching, partial failures/retries, robots restrictions, lossless legacy chapter-order migration, cross-source title grouping, rating updates/aggregation, public RSS recommendations, and unique Top 10/activity counts.

`expo export --platform all`: Android, iOS, and web JavaScript/assets exported successfully. This is bundle validation, not native device or app-store testing.

The web preview was inspected for discovery, reader, settings, chapter downloads, Top 10, Reddit shelves, and the black/neon-blue branding. An Android phone was paired through wireless debugging and Expo Go SDK 58 loaded the Android bundle; no Expo JavaScript/runtime errors appeared in the captured logs. Full interactive native-screen testing remains to be completed while Expo Go is in the foreground. iOS device testing remains outstanding.

The public Reddit Atom feed returned usable content without API credentials; the importer matched real discussions to catalogue titles. Additional public feeds can throttle requests, so the worker paces refreshes and retains curated discussion links as fallback. Source star scores and Reddit mentions never create app reader votes.

The dependency audit reported moderate transitive advisories in Expo/lint tooling. No forced SDK downgrade or incompatible major override was applied.
