# Coolify on OVH

The API runs on the VPS, independently of the development computer. Once deployed over HTTPS, the mobile app works over home Wi-Fi and mobile data. Downloaded chapter text remains available offline.

## Application

1. Point a DNS **A record** for `novelsapi.brewwithcrew.com` to the OVH VPS public IPv4 address. Add an AAAA record only if IPv6 routing is configured. Allow inbound 80/443 to the Coolify proxy.
2. In Coolify, create an application from the public repository `https://github.com/24f3005028/NovelReader`, branch `main`.
3. Select **Dockerfile**, repository base directory `/`, Dockerfile location `/Dockerfile`. Use the repository root as the build context.
4. Set **Ports Exposes** to `4000`. Leave host port mappings empty; the Coolify proxy is the public entry point.
5. Set the domain to `https://novelsapi.brewwithcrew.com` and enable HTTPS redirects. Coolify handles the certificate through its proxy.
6. Add persistent storage: a named volume with destination path **`/data`**. This holds the catalogue, jobs, ratings, and cached chapters. Keep this volume on redeployment.
7. Set the runtime variables below, then deploy. The Dockerfile supplies a health check against `/health`.

```dotenv
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
DATABASE_PATH=/data/novelreader.db
TRUST_PROXY_HOPS=1
API_TOKEN=REPLACE_WITH_A_RANDOM_TOKEN
CORS_ORIGINS=https://novelsapi.brewwithcrew.com
ENABLED_SOURCES=demo,freewebnovel-net,readnovelfull
SCRAPE_DELAY_MS=1500
AUTO_INDEX_CATALOG=true
REDDIT_RSS_ENABLED=true
REDDIT_SUBREDDITS=noveltranslations,LightNovels,ProgressionFantasy
```

Generate a token locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Enter it in Coolify as a runtime secret, never in Git. Native mobile requests do not require a CORS origin; add the actual web-reader origin if hosting a web build later. `TRUST_PROXY_HOPS=1` assumes one direct Coolify proxy and no exposed container host port. Reassess it if adding another proxy such as Cloudflare.

Use **one replica**. SQLite and the embedded queue workers share a single persistent volume; horizontal replicas are not supported. A new volume starts a fresh catalogue crawl, fetching names/covers first. An existing local catalogue can be migrated by stopping its API, copying the database to the server volume, and then starting the VPS API. Do not copy a live WAL database as a single file.

## Mobile endpoint and APK

Before building, set these in the local ignored `apps/mobile/.env` (or the corresponding EAS build environment):

```dotenv
EXPO_PUBLIC_API_URL=https://novelsapi.brewwithcrew.com
EXPO_PUBLIC_API_TOKEN=THE_SAME_TOKEN_AS_THE_API
```

Restart Expo after changing these values. Standalone builds embed these values, so rebuild the APK after changing them. This shared token supports a personal/trusted-client deployment and is extractable from the client; it does not provide individual user accounts.

From `apps/mobile`, sign in with `npx eas-cli@latest login`, link the project with `npx eas-cli@latest init`, and run `npx eas-cli@latest build --platform android --profile preview`. Install the resulting APK on the paired phone.

## Verify and maintain

- `https://novelsapi.brewwithcrew.com/health` must return `{"status":"ok"}` with a valid HTTPS certificate.
- `/stats` without a token must return 401; with the configured bearer token it must return catalogue counts.
- Read a chapter on mobile data, download it, then enable airplane mode and reopen it from Downloads.
- Back up `/data` separately from Coolify configuration. Stop the application before copying the database, or use SQLite's online backup facility. Preserve the backup outside this VPS and verify restoration.
- Source sites may respond differently to an OVH IP. Check catalogue/import job results on the VPS after deployment; a working adapter does not guarantee a source accepts every hosting network.

References: [Coolify application routing](https://coolify.io/docs/applications/how-applications-work), [health checks](https://coolify.io/docs/applications/configuration/health-checks), [persistent storage and configuration](https://coolify.io/docs/applications/configuration/overview).
