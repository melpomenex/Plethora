# Tasks — Fix X Thread Retrieval & Reader UX

> Scope note: the previous change (`tag-editor-readability-and-x-thread-analysis`) stays as-is; this change replaces its retrieval (2.x) and display (4.x/6.x) work. Everything not listed here (URL detection, routing, AI actions, extracts, flashcards, video import) is assumed working and must NOT be re-implemented.

## 1. Backend — ThreadReaderApp adapter (Rust)

- [x] 1.1 Add a `threadreader` module in `src-tauri/src/twitter.rs` (or `src-tauri/src/threadreader.rs`): `ping_thread(tweet_id) -> Result<Option<String /*root id*/>, String>` calling `GET https://threadreaderapp.com/api/v0/ping/{id}.json`, returning `Some(pong)` on `code == 200` and `None` on `code == 404`; typed errors otherwise (network/parse).
- [x] 1.2 Implement `fetch_unrolled_thread(root_id) -> Result<Vec<TraPost>, String>`: `GET https://threadreaderapp.com/thread/{root_id}.html`; parse `div.content-tweet[data-tweet]` blocks in document order with the `scraper` crate (or an equivalent bounded parser): post id, `data-screenname`, text (tags stripped, entities decoded, `<br>` → newline, whitespace preserved), images (`pbs.twimg.com/media/...` from `img[data-src]`/`a[href]`), and quoted/ref status-link ids (excluding the thread's own ids).
- [x] 1.3 Keep a JSON compatibility path: if `GET /api/v0/thread/{root_id}.json` returns the documented `{"code":200,...}` contract, parse `content[]` exactly like `xcom.py.thread()` (tag-strip text, `pbs.twimg.com/media/` regex, status-link regex) and skip the HTML parse.
- [x] 1.4 Add fixture-based Rust unit tests for the parser: multi-post page, single post, 1/2/4-image layouts, `<br>` paragraph preservation, entity decoding, quoted-ref extraction, malformed page (no `content-tweet` blocks → empty result), and dedupe of repeated post ids.
- [x] 1.5 Add unit tests for `ping_thread`: `code 200` + `pong`, `code 404`, malformed JSON, network error (mock HTTP layer or injectable client).

## 2. Backend — pipeline rewrite and enrichment

- [x] 2.1 Rewrite `resolve_twitter_thread(url)` in `src-tauri/src/twitter.rs`:
  1. `extract_tweet_id(url)` (existing);
  2. `ping_thread(id)` → root id (or id itself when `None`);
  3. `fetch_unrolled_thread(root_id)` → normalize into `TwitterThread` (posts ordered, `post_index` 1..N, `root_id`/`root_url` from the root id, author from `data-screenname` + placeholder avatar, `html_content`/`structured_text` via the existing builders);
  4. unrolled empty → single-post path via existing `fetch_tweet_result`/`parse_post` (NOT an error);
  5. both fail → typed error (`ThreadUnavailable` / `ThreadReaderUnavailable` / `RateLimited` / `NetworkError`).
- [x] 2.2 Remove the dead `threaded_conversation_with_injections_v2` / `timeline.instructions` branch (twitter.rs L930-982) and the single-post-only fallback path it forced.
- [x] 2.3 Add `#[tauri::command] async fn enrich_twitter_thread(thread: TwitterThread) -> Result<TwitterThread, String>`: per-post X GraphQL fetch (`TweetResultByRestId`) merged by post id — `created_at`, engagement counts, video mp4/HLS URLs, `media_url` upgrade to `extended_entities` URLs, avatar, quoted-post resolution (status-link refs), `urls`/`hashtags`/`mentions`; bounded concurrency (4) via `futures::stream::iter(...).buffered(4)`; per-post failures logged and skipped; also try syndication when GraphQL fails for a post.
- [x] 2.4 Sync `QID_TWEET_RESULT` to the id verified in `xcom.py` (`oZDZmKdLaZObfAE9qC17Lg`, verified 2026-08-07) with a comment that X rotates query ids; keep syndication fallback.
- [x] 2.5 Register `enrich_twitter_thread` in `src-tauri/src/lib.rs`.
- [x] 2.6 Rust tests: pipeline with fixtures (thread available → ordered/deduped posts; ping 404 → single post; both fail → typed error; enrichment merge by id incl. video/quote/engagement; enrichment failure isolation — thread intact).

## 3. Frontend — API and store

- [x] 3.1 `src/api/documents.ts`: add `enrichTwitterThread(thread)` → `invokeCommand("enrich_twitter_thread", { thread })`; update `mapDocument` to restore `metadata.xThread` from `metadata.structured_content` when `xThread` is absent (survives restart).
- [x] 3.2 `src/stores/documentStore.ts` `openTwitterThread`: after opening the document, fire background `enrichTwitterThread` and merge the result into the stored doc's `metadata.xThread` (zustand set; no refetch when the assistant opens/closes). Add an in-memory `root_id → TwitterThread` cache (TTL ~30 min) reused by the duplicate guard.
- [x] 3.3 Unit tests: `mapDocument` restoration, progressive open (thread renders from unrolled data; enrichment merges later), duplicate-open guard (same URL and mid-thread URL of same root).

## 4. Frontend — native X thread viewer (desktop)

- [x] 4.1 Create `src/components/viewer/XThreadViewer.tsx`: props `{ document, embedded? }`; renders author header (avatar, name, verified badge, @handle, "X thread · N posts", date, Open on X, Save to Documents, overflow menu), centered reading column (`max-width: min(720px, 100% - 2*clamp(16px,4vw,32px))`), theme tokens only.
- [x] 4.2 Add `XPostCard.tsx`: avatar/name/handle/verified, `N / M` position, timestamp, full body (`whitespace-pre-wrap`, preserved paragraphs, styled links/hashtags/mentions), overflow menu (Extract Post, Create Flashcard, Copy post text, Open on X), engagement row only when values exist (never 0-for-unknown), stable `id="x-post-{post.id}"`.
- [x] 4.3 Add thread spine: left rail with per-post nodes + thin `bg-border` connector, theme-aware, subtle hover, reduced-motion friendly.
- [x] 4.4 Add `XThreadMediaGrid.tsx`: 1/2/3-4 layouts, aspect-ratio boxes, lazy loading, alt text, zoom/inspect via existing image infrastructure; video via existing player components when mp4 exists, else poster + "Open video on X" preview card.
- [x] 4.5 Add `XQuoteCard.tsx`: subdued secondary surface, avatar/name/handle, clamped text, media thumbnail, Open on X; fallback "View quoted post on X" card.
- [x] 4.6 Add `XThreadSkeleton.tsx` (post-shaped skeleton with spine) and `XThreadErrorState.tsx` (typed errors: thread unavailable / single-post note / rate limit; Retry + Open on X + copy URL).
- [x] 4.7 Wire dispatch in `DocumentViewer.tsx`: in the HTML-document branch, when `metadata.xThread` exists render `XThreadViewer`; remove the X-specific iframe fallback error page (L5059-5071). Non-X HTML documents keep the existing iframe path.
- [x] 4.8 Selection adapter: per-post selection → existing `SelectionPopup`/`SelectionActionsSheet` with offsets relative to the post container; store post provenance on the extract metadata.

## 5. Frontend — mobile UX and assistant integration

- [x] 5.1 `XThreadViewer` mobile layout: full-width surface, 16–20px horizontal padding + safe-area insets, compact sticky header (back, avatar/name/@handle, save/share, overflow), no horizontal overflow.
- [x] 5.2 Mobile bottom learning toolbar (Summary / Insights / Ask / More), safe-area padded, `scroll-padding-bottom` so the final post is never covered; hidden while the sheet is open.
- [x] 5.3 Native assistant bottom sheet (peek ~30% / half / full): reuse `SelectionActionsSheet` mechanics or the app's sheet primitive; content mounted while open (no reader unmount/refetch); scroll position preserved on close; scope chip "Scope: This X thread"; Ask input.
- [x] 5.4 Assistant integration via `DocumentViewerWrapper`/`AssistantPanel` stays as-is (Summary/Insights/Ask/Flashcards actions) — verify `resolveTwitterThreadAssistantContext` reads the same `metadata.xThread` the viewer renders; add scroll-to-post: citation "Post N" → `x-post-{id}` scrollIntoView + temporary highlight.

## 6. Persistence, sanitization, accessibility, performance

- [x] 6.1 Confirm/implement `Save to Documents` in the new header overflow (promote/locate in collection); keep auto-persist-on-open behavior explicit in code comments; ensure extracts/cards carry `rootUrl` + post id + author provenance.
- [x] 6.2 Sanitization: verify no `dangerouslySetInnerHTML` in the viewer path; Rust parser strips all tags/scripts; media URLs allow-listed to `pbs.twimg.com` / `video.twimg.com`; other links `rel="noopener noreferrer"`.
- [x] 6.3 Accessibility: post `aria-label="Post N of M by @handle"`, alt text policy, keyboard tab order + focus rings, Escape handling, reduced-motion gating, screen-reader labels for engagement row and verified badge.
- [x] 6.4 Performance: memoized post cards, lazy media, reserved aspect-ratio boxes, cache reuse, no TRA request per post, enrichment bounded at 4 concurrent and fired once per root id.

## 7. Testing and visual acceptance

- [x] 7.1 Frontend unit tests (Vitest): `XThreadViewer` (ordering, spine, media grids, quote distinction, engagement omission, skeleton→content, error states, theme classes), mobile toolbar/sheet open-close preserving scroll, selection offsets, scroll-to-post, `mapDocument` restore.
- [x] 7.2 AI tests: summary/insights/Ask context contains ALL loaded posts with boundaries; post-specific question resolves; reader and AI share the same posts array; AI unavailable does not break reading.
- [x] 7.3 Extract/card tests: selection extract provenance, whole-post extract, flashcard prefill, generation flow unchanged.
- [x] 7.4 Rust test suite runs: `cargo test` in `src-tauri` (parser, ping, pipeline, enrichment, existing tests).
- [x] 7.5 Frontend checks: `npm run typecheck` (or the project's TS check), targeted `npm test` for touched suites; `npm run bench:check` unaffected (no perf baseline change expected).
- [ ] 7.6 **Visual acceptance — desktop (1440×900, dark + light + one glass theme):** open a real multi-post thread (e.g. a 10+ post thread) and verify: full theme background (no white region anywhere), clearly centered reading column, consistent margins, readable line length, author header, obvious chronological spine, media integrated at correct aspect ratios, quoted posts visually distinct, assistant pane opens/collapses without disturbing scroll, no iframe artifact, no off-center content, no generic HTML framing.
- [ ] 7.7 **Visual acceptance — mobile (390×844 and 320×568, dark + light):** same thread: full-width native surface, safe-area padding, no horizontal scroll, readable typography, spine visible, media fits viewport, compact native controls, bottom toolbar does not cover the last post, assistant bottom sheet opens/closes restoring position, selection/extract actions work, no browser-page appearance, no desktop layout squeezed onto mobile.
- [ ] 7.8 **Functional acceptance — retrieval matrix:** single post (renders as single-post thread), multi-post thread, long thread (25+ posts), thread with images, thread with quoted posts, NoteTweet/long-form post (full text, no truncation), thread with video (enriched player or preview card), private/deleted post (native error + Retry/Open on X), ThreadReaderApp unavailable but post alive (single post + dismissible note), repeated open of same URL (no duplicate document).
- [x] 7.9 Run `npm run bench:check` and `npm run test:scripts` (project gates) before declaring done.

## 8. Wrap-up

- [x] 8.1 Update `docs/` with a short note: ThreadReaderApp dependency (ping + `/thread/{id}.html`; JSON route dead as of 2026-08-19), query-id re-verification procedure for X GraphQL.
- [ ] 8.2 After acceptance: archive this change and the previous `tag-editor-readability-and-x-thread-analysis` change together (or re-open/amend per team preference — see proposal.md "Decision: New Change vs. Amend").
