# X Thread Retrieval (ThreadReaderApp dependency) & GraphQL Query IDs

> Applies to the native X thread reader (`XThreadViewer`) and the backend
> pipeline in `src-tauri/src/threadreader.rs` / `src-tauri/src/twitter.rs`.
>
> Updated 2026-08-19 by the `x-thread-retrieval-reliability` change
> (requirement #13): error-type parity, URL normalization, and behavioral
> alignment with the `xcom.py` reference.

## Retrieval pipeline (ThreadReaderApp-first, with live fallback)

X thread documents are unrolled through **ThreadReaderApp**, not X GraphQL.
The provider order is the one proven by the `xcom.py` reference, adapted to
Rust with an HTML fallback that `xcom.py` lacks:

1. `GET https://threadreaderapp.com/api/v0/ping/{id}.json`
   - Alive. Any in-thread id resolves to the canonical thread root:
     `{"code":200,"pong":"<root id>"}`. Missing threads:
     `{"code":404,"message":"Thread not found"}`. A failed ping is
     **not** fatal — the unroll is attempted with the raw id anyway.
2. `GET https://threadreaderapp.com/api/v0/thread/{id}.json`
   - **DEAD as of 2026-08-19** (returns an HTML 404 page for every id). Kept
     as a compatibility probe exactly like `xcom.py.thread()`: if the
     documented `{"code":200,"content":[...]}` contract returns, the JSON
     `content[]` array is preferred over the HTML page.
3. `GET https://threadreaderapp.com/thread/{root_id}.html`
   - Alive. Server-renders the complete authored thread in document order:
     `<div class="content-tweet" data-tweet="{id}" data-screenname="...">`
     blocks with `<br />`-separated text (paragraph breaks preserved),
     `entity-image` spans (`https://pbs.twimg.com/media/...`), and
     `entity-embed` blockquotes for quoted posts.
   - **This is the live path and MUST NOT be regressed** — `xcom.py` itself
     is currently broken because it has no HTML fallback for its dead JSON
     route. The Rust pipeline keeps it and is therefore strictly more robust.
4. X GraphQL `TweetResultByRestId` (guest-token auth, same query id
   `oZDZmKdLaZObfAE9qC17Lg` as `xcom.py`) for the single-post fallback and
   per-post enrichment.
5. Syndication (`https://cdn.syndication.twimg.com/tweet-result?id=...`) as
   the last single-post fallback (survives GraphQL query-id rotation).

All of this runs in Rust (`src-tauri/src/threadreader.rs` + `twitter.rs`);
`xcom.py` is a behavioral reference, not the runtime — no Python is invoked.

## URL normalization & root identification

- `extract_tweet_id` (Rust) and `extractXStatusId` (frontend,
  `src/lib/xthreadUrl.ts`) accept optional scheme, `www.`/`mobile.`
  subdomains, `x.com`/`twitter.com`, `/<user>/status/<id>` and
  `/i/status/<id>`, query strings, trailing slashes, and `photo/N` suffixes.
  Non-X hosts (e.g. `example.com/status/123`) are rejected — an invalid URL
  surfaces the typed `invalid_url` error **before** any provider is invoked.
- `extract_screen_name_from_url` / `extractXScreenName` recover the @handle
  for the single-post fallback; `/i/status/` and bare-host links carry none.
- In-thread ids resolve to the root via the TRA `ping`; the canonical output
  URL is `https://x.com/<screen_name>/status/<root_id>` (`rootUrl` on
  `TwitterThread`). The store dedupes mid-thread URLs against the canonical
  root document.
- The `openTwitterThread` flow in `src/stores/documentStore.ts` uses the same
  shared detector so the placeholder-id / dedupe logic never disagrees with
  the backend.

## Typed errors & frontend parity (the concrete bug this change fixes)

The Rust backend serializes `ThreadError` as a snake_case `{type, message}`
envelope:

| Rust variant | serialized `type` | UI key (`xthreadError.ts`) |
|---|---|---|
| `InvalidUrl` | `invalid_url` | `invalidUrl` |
| `ThreadUnavailable` | `thread_unavailable` | `threadUnavailable` |
| `ThreadReaderUnavailable` | `thread_reader_unavailable` | `threadReaderUnavailable` |
| `RateLimited` | `rate_limited` | `rateLimited` |
| `NetworkError` | `network_error` | `networkError` |
| `Auth` | `auth` | `auth` |

The frontend `src/lib/xthreadError.ts` is the single source of truth for the
copy map and `normalizeThreadErrorType`, which maps snake_case/kebab-case/
camelCase (and the plain-object `metadata.xThreadError` shape, and
`coerceError`-wrapped rejections) to the canonical camelCase key. Previously
the viewer indexed its copy map with camelCase keys while the backend sent
snake_case — every typed error fell through to the generic fallback and
surfaced the raw Rust message as the primary UX. Now each case renders its
intended title/detail, with the raw message as **secondary** detail only,
plus Retry / Open-on-X affordances (`invalid_url` hides Open-on-X — the URL is
not openable). Parity is pinned by:
- Rust: `thread_error_serializes_as_snake_case_type_message` (threadreader.rs)
- Frontend: `src/lib/__tests__/xthreadError.test.ts`
  (every Rust snake_case type → distinct non-generic copy)
- `src/components/viewer/XThreadViewer.test.tsx` (typed copy per representative
  error through the viewer).

## Reference capabilities ported from `xcom.py`

Ported (cheap + valuable):
- **Structured entities on `TwitterPost`**: `hashtags: string[]`,
  `mentions: {screenName, name}[]`, and `expandedUrls: {url, expandedUrl,
  displayUrl}[]` parsed from the tweet payload's `entities` in `parse_post`
  (mirrors `xcom.py._parse_tweet`). Populated by the single-post path and
  enrichment. The viewer renders the expanded URL targets (instead of useless
  `t.co/...` shortlinks) in the post card. Fields are additive/optional —
  legacy persisted threads deserialize unchanged.
- Guest-token caching with rotation handling (2h TTL, same as `xcom.py`).
- Quoted-post fetch/merge (bounded at 4 concurrent; TRA text authoritative).

Documented as out of scope:
- **Authenticated search** (`SearchTimeline` with user cookies) — not needed
  for in-app reading.
- **Media embedded as base64** in `html_content` — the native viewer renders
  allow-listed remote URLs (`pbs.twimg.com`/`video.twimg.com`).
- **`t.co` → expanded replacement inside `full_text`** — `xcom.py`'s thread
  path also keeps the raw text; expanded targets are exposed via
  `expandedUrls` instead.

## Enrichment (optional X GraphQL layer)

Per-post enrichment (timestamps, engagement, video URLs, avatars, quoted
posts, structured entities) runs in the background at 4 concurrent requests
and merges into the in-memory document (`metadata.xThread`). It is NOT
persisted back to `structured_content` — after an app restart the restored
thread carries the unrolled text/images (always complete) and enrichment
simply doesn't apply until a fresh open. Enrichment is an optional upgrade,
never a requirement for reading or AI. Per-post failures are isolated — the
thread is never lost because enrichment failed.

## X GraphQL query-id re-verification procedure

X rotates GraphQL query ids (`QID_TWEET_RESULT` in
`src-tauri/src/twitter.rs`). When `TweetResultByRestId` starts failing with
`Could not find query`-style errors:

1. Open x.com in a browser, open DevTools → Network, and trigger a tweet
   detail request (open any post).
2. Find the `graphql/<id>/TweetResultByRestId` request; the `<id>` segment
   is the current query id.
3. Update `QID_TWEET_RESULT` in `src-tauri/src/twitter.rs` (and the same
   constant in the `xcom.py` reference if still used).
4. The syndication fallback
   (`https://cdn.syndication.twimg.com/tweet-result?id=...`) keeps single
   posts and enrichment working in the meantime.

Guest tokens (`/1.1/guest/activate.json`) are cached for 2 hours; rotation
is handled automatically. `401`/`403` guest-token or GraphQL failures are
classified as the typed `auth` error (frontend copy: "X API credentials
unavailable") rather than a generic failure.
