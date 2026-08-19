# X Thread Retrieval (ThreadReaderApp dependency) & GraphQL Query IDs

> Applies to the native X thread reader (`XThreadViewer`) and the backend
> pipeline in `src-tauri/src/threadreader.rs` / `src-tauri/src/twitter.rs`.

## Retrieval pipeline (as of 2026-08-19, re-verified during the
`fix-x-thread-retrieval-and-reader-ux` change)

X thread documents are unrolled through **ThreadReaderApp**, not X GraphQL:

1. `GET https://threadreaderapp.com/api/v0/ping/{id}.json`
   - Alive. Any in-thread id resolves to the canonical thread root:
     `{"code":200,"pong":"<root id>"}`. Missing threads:
     `{"code":404,"message":"Thread not found"}`.
2. `GET https://threadreaderapp.com/thread/{root_id}.html`
   - Alive. Server-renders the complete authored thread in document order:
     `<div class="content-tweet" data-tweet="{id}" data-screenname="...">`
     blocks with `<br />`-separated text, `entity-image` spans
     (`https://pbs.twimg.com/media/...`), and `entity-embed` blockquotes for
     quoted posts. Works for mid-thread ids too.
3. `GET https://threadreaderapp.com/api/v0/thread/{id}.json`
   - **DEAD as of 2026-08-19** (returns an HTML 404 page for every id). The
     Rust adapter keeps a compatibility probe: if the documented
     `{"code":200,"content":[...]}` contract ever returns, it is used
     instead of the HTML page (the `xcom.py` reference contract).
4. X GraphQL `TweetResultByRestId` / syndication is used ONLY for optional
   per-post enrichment (timestamps, engagement, video URLs, avatars, quoted
   posts; bounded at 4 concurrent, failure-isolated) and as the single-post
   fallback when TRA has no thread.

TRA has no auth and no observed rate limiting; the adapter still handles
429s as a typed error with Retry.

## Enrichment (optional X GraphQL layer)

Per-post enrichment (timestamps, engagement, video URLs, avatars, quoted
posts) runs in the background at 4 concurrent requests and merges into the
in-memory document (`metadata.xThread`). It is NOT persisted back to
`structured_content` — after an app restart the restored thread carries the
unrolled text/images (always complete) and enrichment simply doesn't apply
until a fresh open. This is intentional: enrichment is an optional upgrade,
never a requirement for reading or AI.

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
is handled automatically.
