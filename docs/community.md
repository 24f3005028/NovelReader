# Ratings, discovery, and Reddit

## Ratings

Reader ratings are integers from 1 to 5. A device receives a persisted anonymous reader ID in local storage. Its vote can be updated without increasing the count. Votes are stored against a normalized novel key, so duplicate copies of the same title share one rating aggregate.

```http
GET /novels/NOVEL_ID/ratings?readerId=READER_ID
PUT /novels/NOVEL_ID/rating
Content-Type: application/json

{"readerId":"reader-example-00001","value":5}
```

The response is `{ average, count, userRating }`. A novel with no reader votes has a null average, not a fake score. Source-provided community scores are separate optional metadata and never create reader votes. A production multi-user deployment should bind reader identities to authenticated accounts; this project currently supports personal/trusted-client use with a shared API token.

## Top 10 and discovery

`GET /discover?genres=Fantasy,Adventure` returns `top10`, `reddit`, and `forYou`. Popularity uses the catalogue's real popularity-list positions plus deduplicated recent reading activity. Repeated activity from the same reader for the same novel/action/day counts once. It does not invent global reader totals or pretend these are weekly worldwide rankings.

```http
POST /activity
Content-Type: application/json

{"novelId":"NOVEL_ID","readerId":"reader-example-00001","action":"read"}
```

`open` and `read` are supported. The app submits them when opening novels/chapters. Discovery shelves and search results deduplicate by normalized title. Known title punctuation/case differences and the Lord of Mysteries title variant are normalized. Different translated titles not covered by normalization may still need explicit alias mappings; unrelated titles are not fuzzy-merged automatically.

## Reddit without the Data API

The project uses public Atom/RSS feeds and a small curated collection of verified recommendation discussions. There are **no Reddit OAuth credentials**, Data API calls, automatic posts, or votes.

Default feeds use `https://www.reddit.com/r/SUBREDDIT/top/.rss?t=month`. They expose post content rather than a complete comment archive. The importer matches catalogue titles mentioned in recommendation/review discussions, stores the discussion link and title, and does not retain Reddit authors or post bodies. RSS does not supply vote counts, so the app does not display invented Reddit votes or convert mentions into star ratings.

The public noveltranslations feed was verified live and imported successfully. Other feeds can throttle requests; refreshes are at least 65 seconds apart, respect a Retry-After cooldown on HTTP 429, and run every six hours. Feed-derived records expire after 24 hours. Curated discussion links remain available if a feed is blocked or unavailable.

Backend configuration:

```dotenv
REDDIT_RSS_ENABLED=true
REDDIT_SUBREDDITS=noveltranslations,LightNovels,ProgressionFantasy
```

Administration endpoints:

- `GET /community/reddit/status`
- `POST /community/reddit/sync`
- `POST /community/reddit/import-feed` with `{ "xml": "ATOM_XML" }`
- `GET /novels/:id/discussions`

These controls stay out of the consumer reader interface. Discussion links are available from novel details so readers can see the original context. A discussion mentioning a novel is a community-discovery signal, not a claim of unanimous endorsement.
