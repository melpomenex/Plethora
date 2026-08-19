# Design — Fix X Thread Retrieval & Reader UX

## Context

Plethora (Tauri 2 / React 19 / Rust / SQLite / TailwindCSS) already recognizes X/Twitter status URLs (Command Palette, mobile share sheet), fetches them via `src-tauri/src/twitter.rs`, wraps the result as an HTML document, and renders it through the generic HTML iframe in `DocumentViewer.tsx`. The runtime result is broken in two independent ways (see proposal.md "Current Implementation Diagnosis"):

1. Threads are never actually unrolled — `resolve_twitter_thread` scans a timeline that `TweetResultByRestId` never returns, so `posts` always contains the single root post.
2. The presentation is generated HTML inside a generic article iframe — inline styles neutralized, CSS variables unresolved (white regions), no thread structure, generic document look, no mobile layout.

The root-level `xcom.py` reference shows the intended strategy: ThreadReaderApp unrolls the full authored thread with a single no-auth request; X GraphQL is only an optional enrichment layer and single-post fallback. Live verification (2026-08-19) established ThreadReaderApp's current surface: the `/api/v0/thread/{id}.json` route is dead (404 for all ids); `/api/v0/ping/{id}.json` is alive and resolves any in-thread id to the thread root (`{"code":200,"pong":"<root>"}`); `/thread/{id}.html` server-renders the full ordered thread with per-post `data-tweet` ids, text, and `pbs.twimg.com` images.

## Goals / Non-Goals

**Goals**
- Reliably retrieve complete authored X threads (text, media, quotes, order) with a ThreadReaderApp-first pipeline and X GraphQL/syndication as enrichment + fallback.
- Present threads in a dedicated native Plethora reader on desktop and mobile: theme-native, centered reading column, thread spine, embedded media, distinct quoted posts, skeleton loading, native error states.
- One canonical normalized `TwitterThread` model drives viewer, AI context, extracts, and flashcards — persisted so it survives restarts.
- Keep everything that works: URL detection, palette/share routing, AI scoped actions, extract/flashcard flows, video import, existing model types and command names.
- Progressive loading: render the thread from the unrolled data immediately; enrich metadata (timestamps, engagement, video, avatars, quote details) asynchronously without blocking reading or AI.

**Non-Goals**
- Becoming an X client (timeline, compose, likes, follows, notifications, DMs, arbitrary reply-tree browsing).
- Bundling Python or invoking `xcom.py` from Tauri — the behavior is ported to Rust using the existing `reqwest` infrastructure.
- Embedding/iframing ThreadReaderApp, x.com, or any third-party page as the reading surface.
- Rebuilding the working routing, AI, extract, or flashcard layers.

## Decisions

### 1. ThreadReaderApp-first retrieval pipeline (port of `xcom.py.thread()`)

Replace the dead timeline branch in `resolve_twitter_thread` with:

```
status URL → extract_tweet_id (existing, twitter.rs:145)
   │
   ▼
TRA ping  GET /api/v0/ping/{id}.json
   │  {"code":200,"pong":"<root id>"}          {"code":404,...} / network error
   ▼                                             ▼
TRA unroll GET /thread/{root_id}.html     X GraphQL TweetResultByRestId
   │  parse div.content-tweet[data-tweet]       (existing) / syndication
   ▼  ordered posts: id, text, images,          ▼
Normalize → TwitterThread (posts ordered)   Single-post TwitterThread
   │                                            (NOT an error)
   ▼
Optional enrichment (async, bounded concurrency 4)
   per post: X GraphQL → timestamps, engagement, video URLs,
   avatar, quoted-post detail; syndication fallback
   ▼
Canonical TwitterThread → viewer + AI + extracts + flashcards
```

- **Ping first:** `ping` returns the canonical thread root id even when the pasted URL points to a mid-thread post (`pong`). Store `root_id = pong`.
- **Unroll via HTML page, not the dead JSON route:** parse the server-rendered `/thread/{root_id}.html` (see "ThreadReaderApp HTML parsing" below). Keep a small compatibility probe: if a future `GET /api/v0/thread/{root_id}.json` returns `{"code":200, ...}` (the `xcom.py` contract), use it — parse `content[]` exactly like `xcom.py.thread()` does (tag-strip text, `pbs.twimg.com/media/` regex for images, status-link regex for quoted refs). This keeps the design aligned with `xcom.py` if TRA re-enables the route.
- **Ordering:** document order on the TRA page is the authored chronological order. Do not reorder. Do not ingest third-party replies — TRA pages contain only the authored thread (verified: 34/34 posts, single `data-screenname`).
- **Dedupe:** drop duplicate post ids (defensive; TRA pages are already deduped).
- **Single-post fallback:** if ping 404s (no unrolled thread) or the page parse yields nothing, use the existing GraphQL/syndication single-tweet path and produce a 1-post `TwitterThread`. This is the common case for ordinary non-thread posts and must not look like an error.
- **Failure:** both paths fail → typed error (`ThreadUnavailable`, `ThreadReaderUnavailable`, `NetworkError`, `RateLimited`) surfaced natively in the reader (see Error states).

**Why this answers "why are we reconstructing threads ourselves?":** `xcom.py` exists precisely because X's GraphQL surface does not give anonymous clients a reliable full-thread endpoint; the previous Rust implementation tried to reconstruct threads from a single-tweet response (and its timeline branch never matched any real response shape). ThreadReaderApp does the unrolling for us with one no-auth request. The Rust code should consume that unrolled content, exactly as the reference does, and use X GraphQL only where it adds value (metadata, video, quotes) or as a last resort.

### 2. ThreadReaderApp HTML parsing (Rust)

Parse `GET /thread/{root_id}.html` with a small HTML parser (e.g. `scraper` crate — or, to avoid a new dependency, a bounded regex/`html5ever`-free extractor mirroring `xcom.py`'s approach; prefer `scraper` for robustness since TRA markup is fixed):

- Locate each `<div class="content-tweet ..." data-tweet="{id}" data-screenname="{handle}" ...>` block in document order.
- Text: inner HTML → strip tags, decode entities, map `<br>` to newline (TRA uses `<br />` as line separator — do NOT collapse to single spaces; paragraph breaks matter for long-form posts). Keep raw per-post text for `full_text`.
- Images: `img[data-src]` / `a[href]` matching `https://pbs.twimg.com/media/...` (append `?name=large`-style sizing handled client-side; store the base URL + aspect ratio if parseable from the `entity-image` container). These are TRA-quality URLs — enrichment replaces them with GraphQL `extended_entities` URLs when available.
- Quoted/ref status links: extract `x.com|twitter.com/<user>/status/<id>` hrefs within the block → candidate quoted-post ids (exclude the thread's own post ids). Enrichment resolves them via GraphQL (see Quoted posts).
- Author: first block's `data-screenname` + the page's `twitter_name`/`twitter_screen_name` header. Avatar: not present on TRA pages — always from enrichment; if unavailable, render a themed initial avatar.
- Return an ordered `Vec<TraPost { id, text, media, ref_ids }>`.

### 3. Normalized data model

Keep the existing Rust/TS model (already serialized camelCase, already consumed by `assistantContext`):

```rust
TwitterThread { id, root_id, root_url, author, title, posts, total_posts,
                html_content, structured_text, created_at }
TwitterPost  { id, post_index, author, text, full_text, media, quoted_post,
               created_at, reply_count, retweet_count, favorite_count,
               bookmark_count, is_note_tweet, url }
TwitterAuthor { name, screen_name, avatar_url, verified, profile_url }
TwitterMedia { kind, media_url, thumbnail_url, alt_text, aspect_ratio }
TwitterQuotedPost { id, author, text, media, created_at, url }
```

Additions (optional, backward-compatible):
- `TwitterThread.source_kind: "threadreader" | "graphql" | "syndication" | "single"` (diagnostics/UX: "Full thread could not be retrieved" indicator).
- `TwitterThread.retrieved_at` (cache TTL).
- `TwitterMedia.original_url` — keep TRA URL until enrichment replaces it; never show broken images.
- `TwitterPost.urls: [{url, expanded_url, display_url}]` and `hashtags`/`mentions` (already parsed by `_parse_tweet` in xcom.py; useful for link rendering).

`html_content` stays (export/compat) but **ceases to be the primary display source**. `structured_text` stays for AI and export.

### 4. Backend / Tauri changes

- `twitter.rs`:
  - New `threadreader.rs` module (or `tra` section in `twitter.rs`): `ping_thread(root_id) -> Option<String /*root*/>`, `fetch_unrolled_thread_html(root_id) -> String`, `parse_unrolled_thread(html) -> Vec<TraPost>`; unit-testable with fixtures (no network in tests).
  - Rewrite `resolve_twitter_thread(url)` to the pipeline above. Keep `extract_tweet_id`, guest token cache, `fetch_tweet_graphql`, `fetch_tweet_syndication`, all `parse_*` fns unchanged.
  - New `#[tauri::command] async fn enrich_twitter_thread(thread: TwitterThread) -> Result<TwitterThread, String>` — per-post GraphQL merge (timestamps, counts, video URLs, avatars, quoted posts) with `futures::stream::iter(...).buffered(4)` bounded concurrency; individual failures logged and skipped (never fail the whole thread).
  - Remove the dead `threaded_conversation_with_injections_v2` branch.
  - Update `QID_TWEET_RESULT` to the id verified in `xcom.py` (`oZDZmKdLaZObfAE9qC17Lg`, verified 2026-08-07) and add a comment that query ids must be re-verified when X rotates them; keep syndication fallback.
- `lib.rs`: register `enrich_twitter_thread`.
- Persistence: `import_twitter_thread` already writes `structured_content` (full thread JSON) — keep. `mapDocument` (`src/api/documents.ts:24-30`) must map `metadata.structured_content` → `metadata.xThread` so the structured model survives restart (this also fixes AI context for saved threads).

### 5. Frontend architecture

```
DocumentViewerWrapper
 ├─ AssistantPanel (existing split-pane / bottom sheet)
 └─ BaseDocumentViewer
     └─ docType === "html" && metadata.xThread
             ├─ XThreadViewer (native)        ← NEW primary path
             └─ (else) existing HTML iframe    ← unchanged for other html docs
```

- Dispatch: in the HTML-document branch of `DocumentViewer`, if `currentDocument.metadata?.xThread` is present → render `<XThreadViewer document={currentDocument} />` (embedded mode support, mirroring how `MarkdownViewer` is dispatched by `docType`). The X-specific iframe fallback error page (`DocumentViewer.tsx:5059-5071`) is deleted — error states move into `XThreadViewer`.
- `XThreadViewer` owns: header, thread column, post cards, media, quotes, loading skeleton, error states, selection handling (see Extracts), scroll-to-post, and mobile toolbar integration. It is a normal React component using Plethora design tokens — no iframe, no `dangerouslySetInnerHTML` (see Security).
- Progressive open in `documentStore.openTwitterThread`:
  1. `fetchTwitterThread(url)` → normalized thread (fast, TRA-backed).
  2. Open document immediately (existing persistence/ephemeral flow unchanged).
  3. Fire `enrichTwitterThread(thread)` in the background; merge result into the store document's `metadata.xThread` when it resolves (zustand `set`; memoized re-render). Reader never blocks on enrichment.
- Caching: `get_twitter_thread` results cached in memory keyed by `root_id` (TTL e.g. 30 min) in a small module-level map or the store; `import_twitter_thread` skips re-fetch when a matching doc exists (dup guard already present).

### 6. Dedicated X thread viewer — desktop UX

- **Layout:** centered reading column, `max-width: min(720px, 100% - 2 * clamp(16px, 4vw, 32px))`, `margin-inline: auto`. Full Plethora theme background (`bg-background`) — no white surface, no iframe. When the assistant pane is open, the column stays centered within the remaining width (the existing `ResizableSplit` in `DocumentViewerWrapper` handles panes; the viewer must size to its container, not to the viewport).
- **Header (compact, not a webpage title):** `[avatar 40px] Name ✓ @handle · X thread · N posts · optional date` + actions `[Open on X] [Save to Documents] [...]` overflow (Extract post 1, Copy structured text, Refresh/Re-enrich, Open in browser). Uses existing `Avatar`/`Button`/`DropdownMenu`/`Lucide` components.
- **Thread spine:** left rail with per-post nodes: small avatar or dot at each post, thin (`2px`, `bg-border`) vertical connector between posts, `rounded-full`, subtle hover accent. Theme-aware; `border-border`-based; no heavy boxes. Posts are transparent/surface-soft (`bg-card/40` hover) rather than giant bordered boxes, or plain background with `divide-y` — pick the lightest editorial treatment consistent with the app's card language; **no per-post heavy bordered card** unless the design system dictates otherwise.
- **Post card:** `[avatar] Name @handle ✓ · 3/14 · <time>`; body at `text-[15px]/relaxed`, `whitespace-pre-wrap`, preserved paragraph breaks; `text-foreground`; links rendered as styled `<a>` (primary color, underline offset), hashtags/mentions as styled spans (no navigation outside app). Long-form/NoteTweet content renders in full (never truncated).
- **Engagement row (optional):** small muted `♡ 2.1K ↻ 183 💬 42` only when values exist (`Option`-driven; never render `0` for unknown). Below the fold of the post, subtle; not dominant.
- **Learning actions:** overflow menu per post (`...`) with `Extract Post`, `Create Flashcard`, `Copy post text`, `Open on X`; plus selection → existing `SelectionPopup` actions (Extract / Explain / Ask / Summarize Selection / Create Flashcard). No permanent 5-button row under every post.

### 7. Mobile UX — first class

- **Reading surface:** full-width native surface, `px-[16px]`-`20px` (safe-area aware via existing `env(safe-area-inset-*)` utilities used elsewhere), no horizontal overflow (`overflow-x: clip` on the column), theme background, no page margins, no iframe artifacts.
- **Header:** compact sticky header: `‹ back`, `[avatar] Name @handle`, `[Save/Share] [...]`, optional assistant toggle. No big webpage title. Reached via `DocumentViewer`'s existing mobile chrome.
- **Bottom learning toolbar:** fixed bottom bar (safe-area padded) with `Summary | Insights | Ask | More` (icons + labels per existing conventions; see `PwaAssistantButton` for precedent). It must not cover the last post — add `scroll-padding-bottom` / end padding equal to toolbar height. Toolbar hidden while the assistant sheet is open.
- **Assistant sheet:** tapping Summary/Insights/Ask opens a native bottom sheet (reuse `SelectionActionsSheet` sheet mechanics or the app's existing sheet primitive) with grabber, states: peek (~30%), half (~55%), expanded (90%). Content: scope chip (`Scope: This X thread`), the requested tool output, and an Ask input. Closing/minimizing **must not unmount or refetch the reader** (keep the sheet's content mounted, `transform`-based slide). Reader scroll position is preserved (existing position persistence utilities).
- **Post actions:** long-press/selection → existing `SelectionActionsSheet`; overflow button per post for Extract Post / Flashcard / Copy / Open on X.

### 8. Media handling

- **Images:** native `<img loading="lazy">` grid: 1 → single rounded image (`rounded-xl`), 2 → 2-col, 3-4 → 2×2 grid (existing grid conventions), `aspect-ratio` respected (use `aspect_ratio` from the model; `object-fit: cover` in grid cells, `contain` for single), no stretching, `alt` from alt text (fallback: "Attached image by @handle"). Tap → zoom/inspect via existing image-inspect infra (`ImageViewer`/`ImageSaveOverlay` if wiring exists; otherwise a simple full-screen lightbox using existing modal primitives).
- **Video:** if enrichment provided an mp4 URL → render existing `LocalVideoPlayer`/`<video controls preload="metadata" poster=...>` (respect the existing YouTube-style inline playback patterns); animated GIF → `<video loop muted autoplay playsinline>`. If no usable URL (TRA gives none) → attractive preview card: poster/thumbnail + play glyph + `Open video on X` link — never a broken player.
- **Alt text:** from `alt_text` (GraphQL `ext_alt_text`) — required for a11y.

### 9. Quoted posts

- TRA HTML does not structurally mark quotes; quoted posts are detected as status-link refs inside a post block (Decision 2) and resolved during enrichment via GraphQL (same logic as `xcom.py` `fetch_quotes`: fetch each ref id, attach as `quoted_post`; failures → render a subdued "View quoted post on X" link card).
- Visual: subdued secondary surface (`bg-muted/50`, `border-border`, smaller type, rounded, left accent bar), clearly nested inside the parent post — never styled like a main-thread post. Contains avatar, name, handle, text (clamped to ~4 lines with "Show more"), media thumbnail, `Open on X`.
- AI context keeps the distinction: `structured_text` already emits `[Quoting @handle]: "..."` — keep.

### 10. AI context integration

- Single source: `metadata.xThread` (restored from `structured_content` after restart — Decision 4). `resolveTwitterThreadAssistantContext` (`src/utils/assistantContext.ts:176-231`) keeps working unchanged; verify it always receives the same posts the viewer renders (both read `xThread.posts`).
- Post boundaries: existing `[Post N of M]` / `[Post N by @handle]` framing is retained; add stable per-post anchors: viewer renders `id="x-post-{post.id}"`; AI citation strings reference `Post N` and the client maps N → `post.id` → `scrollIntoView({block:"center"})` + temporary highlight ring. Reuse the existing jump/highlight plumbing (`DocumentInitialJump`, `mark` highlight styles) if adaptable, else a small viewer-local mechanism.
- "Explain post 4", "Where does the author support this claim?", "Summarize this thread" all work from the single context block; no separate hidden extraction pipeline for AI.

### 11. Extracts

- Selection → existing `SelectionPopup`/`SelectionActionsSheet` actions; `createExtract` records get `document_id` (the thread doc) + `metadata` with `source: rootUrl`, `post_id`, `post_index`, `author: @handle`, plus `start/end` offsets within the post body (selection measured against the post element; store `x-thread` provenance fields in the existing extract metadata schema).
- Whole-post extract: overflow `Extract Post` → creates extract with full `full_text` and same provenance.
- Selection mapping: selections are confined per post (each post body is a separate block; `SelectionPopup` computes offsets relative to the post container). If the existing selection plumbing is iframe-based, the native viewer needs a small selection adapter (the viewer registers a `selectionchange` handler on its own container — see `SelectionOverlay.tsx` patterns).

### 12. Flashcards

- From selection: existing "Create Flashcard" flow (unchanged).
- From post overflow: pre-fills the card form with the post text + provenance.
- From thread: assistant `Flashcards` action (existing `/20rules` + `ChatFlashcardCollection` preview/edit/approve) — unchanged, now guaranteed to receive the complete thread. No X-specific card records.

### 13. Persistence & provenance

- Keep current behavior: opening a thread persists a document immediately (Tauri) or ephemeral (web) — the previous design's "ephemeral until learning action" was not implemented; make the actual behavior explicit: **open = document created (deduped by URL/root id); extracts/cards always carry provenance; `Save to Documents` remains available for explicit library placement**. No duplicate permanent documents: existing dup guard (`documentStore.ts:1134-1158`) + Rust-side check by `root_url`.
- Persist the full normalized model: `structured_content` (already) + `mapDocument` restore (Decision 4). `xThread` in metadata is then durable.
- `Save to Documents` (task 4.3 of the previous change): verify it exists; if missing, implement as an explicit save/collection-assign action in the new header overflow.

### 14. Loading states

Progressive, native skeleton shaped like the real reader (posts with avatar/text/image placeholders, spine) shown while `fetchTwitterThread` runs. Text renders the moment the unrolled payload arrives; enrichment resolves in place (media thumbnails upgrade, timestamps appear) without layout jumps (reserve media space via aspect-ratio). AI tools enable as soon as `metadata.xThread` exists (i.e. immediately after normalization — never wait for enrichment). No full-page spinner.

### 15. Error / fallback states

Native error panel inside the reader surface (not the iframe fallback page):

- **Thread unavailable (private/deleted):** "Unable to load this X thread" + reason + `[Retry] [Open on X]`.
- **TRA unavailable but single post works:** render the single post normally; show a small inline note "Full thread could not be retrieved" (non-alarming, dismissible). `source_kind: "single"`.
- **Enrichment failed:** thread renders; engagement/video/quote enrichment simply absent.
- **AI unavailable:** reader unaffected; AI actions show their own unavailable state (existing toast pattern).
- **Rate limited / network:** typed error + `[Retry] [Open on X]`, plus `copy status URL`.
- Never: blank page, endless spinner, white page.

### 16. Theme integration

All surfaces use Plethora tokens: `bg-background`, `bg-card`, `bg-popover`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `text-primary`, `bg-primary/10` highlights — via Tailwind classes (the component lives in the React tree, so tokens resolve; no CSS variables in a detached document). No hard-coded `white`/`black`. Works in all 40+ themes incl. glass (opaque fallbacks per `makeColorOpaque` convention if needed for the spine/quote surfaces) and e-ink.

### 17. Accessibility

- Semantic structure: single `<article>` per post with `<h2 class="sr-only">Post N of M</h2>` (or `aria-label="Post N of M by @handle"`), `article` for the thread, `nav` for header actions.
- Keyboard: full tab order, focus rings (existing focus styles), `Enter` on post actions; `Escape` closes menus/sheet; scroll-to-post target receives `tabindex="-1"` focus on jump.
- Images: meaningful `alt` (alt text → else "Image in post N by @handle"); avatars `role="img" aria-label="@handle"` or `alt`.
- Contrast: tokens guarantee AA; no color-only info (verified badge has `title`/`aria-label`).
- Reduced motion: spine/scroll highlights use `transition` gated by `prefers-reduced-motion` (existing utilities).
- Screen readers: post numbering announced ("Post 3 of 12"); engagement row labeled (`aria-label="2.1K likes"`).

### 18. Performance

- One TRA request per thread (ping + page = 2 lightweight requests); enrichment N GraphQL requests bounded at 4 concurrent, only for posts lacking metadata, fired once per root id per session.
- Cache: in-memory `root_id → TwitterThread` (TTL 30 min) in the store; reuse on open/close of assistant (no refetch when the AI panel opens/closes — the viewer and sheet share the store object).
- Images: `loading="lazy"`, `decoding="async"`, `aspect-ratio` reserved boxes; no layout shift.
- Memoization: `React.memo` per post card; thread column virtualization **not** needed ≤ ~50 posts (explicit non-goal); cap enrichment queue and skip already-enriched posts.
- Avoid N+1: never re-request the TRA page per post.

### 19. Security / sanitization

- ThreadReaderApp HTML is parsed **in Rust** into structured text/media; the React viewer renders only structured data.
- Any rich inline fragment that must reach the client (none expected — TRA content is plain text + images) goes through DOMPurify (the project's established sanitizer, cf. `RichContentRenderer`); scripts/events stripped server-side by the parser (tags removed, entities decoded).
- No `dangerouslySetInnerHTML` in `XThreadViewer` or its children.
- Media URLs constrained to `https://pbs.twimg.com/` and `https://video.twimg.com/` origins at parse time (allow-list); other URLs rendered as plain links (`rel="noopener noreferrer"`, `target="_blank"`).
- Tauri command inputs: `extract_tweet_id` already validates digits; TRA/GraphQL ids are numeric strings — keep validation on all new command parameters.

### 20. Testing strategy

**Rust (fixtures, no network):**
- TRA HTML parser: multi-post page, single post, images (1/2/4), `<br>` paragraph preservation, entity decoding, quoted/ref link extraction, malformed page (missing blocks → empty), mid-thread root resolution (ping `pong` semantics).
- Pipeline: thread available → ordered posts, dedupe, no third-party replies; ping 404 → single-post fallback (GraphQL fixture); both fail → typed error; enrichment merge by post id (timestamps/counts/video/avatar), enrichment failure isolation.
- Existing parser/video tests keep passing.

**Frontend (Vitest):**
- `XThreadViewer`: renders posts in order, spine nodes, media grids, quote card distinction, engagement omission when unknown, skeleton → content, error states (thread unavailable / single-post note), theme classes (no hard-coded colors), mobile toolbar + sheet open/close preserving scroll, selection popup per-post offsets, scroll-to-post from citation, `mapDocument` restoring `xThread` from `structured_content`.
- Store: progressive open (enrich merge), duplicate open guard, cache hit.

**AI:** summary/insights/Ask receive the complete loaded thread (assert context string contains all N posts with boundaries); post-4 question works; reader and AI share the same posts array.

**Extracts/cards:** selection extract provenance (post id/url/author), whole-post extract, flashcard prefill, generation flow unchanged.

**Visual acceptance (manual + Playwright screenshots at desktop 1440×900, mobile 390×844):** see the checklist in tasks.md §7 — no white regions, centered column, correct line length, spine, theme parity dark/light, no iframe artifacts, mobile safe-area/no horizontal scroll.

### 21. Risks / external dependency considerations

| Risk | Mitigation |
|------|-----------|
| ThreadReaderApp availability/rate limits | Single-page fetch per thread + ping; typed errors with Retry/Open on X; single-post GraphQL fallback keeps the feature alive; cache per root id |
| TRA markup changes | Parser isolated in one module with fixtures; JSON compatibility probe kept; ping is a stable existence check; worst case falls back to single post |
| TRA JSON route returns (or a future API) | `xcom.py` contract (`code`, `content[]`) already implemented as the preferred parse path |
| X GraphQL guest-token rotation / query-id rotation | Query id synced to xcom.py's verified id; syndication fallback retained; enrichment failures non-fatal |
| TRA text quality (br-based paragraphs, t.co links) | Preserve `<br>` as newlines; expand `t.co` via GraphQL `urls` when enriched |
| Long threads vs. AI context | Existing `trimToTokenWindow` post-aware chunking (previous change) — keep; viewer always shows full thread regardless |
| Duplicate documents | Existing dup guards + root-id canonicalization via `pong` |

### 22. Backward compatibility

- Command names, model shapes, and the `fileType: "html"` document representation are unchanged — existing saved X-thread documents keep rendering (now via the native viewer once `xThread` is restored from `structured_content`; before any re-save, they render via the current iframe path as today, which is why the fallback page is replaced but the generic HTML path remains for non-X docs).
- `importTwitterVideo` / video import untouched.
- Non-X HTML documents are unaffected (viewer dispatch is keyed on `metadata.xThread`).
- `articleHtml` remains written (export/copy) but is no longer the primary display source.

## Component Architecture (target)

```
CommandCenter / useShareTarget / useURLImport (unchanged)
        │ openTwitterThread(url)
        ▼
useDocumentStore.openTwitterThread
        ├─ fetchTwitterThread(url) ──► Tauri get_twitter_thread
        │        ├─ TRA ping + /thread/{root}.html ─► normalize ─► TwitterThread
        │        └─ fallback: GraphQL/syndication single post
        ├─ open doc (persist/ephemeral, dup-guarded)
        └─ enrichTwitterThread(thread) (async, non-blocking) ─► merge into metadata.xThread
        ▼
DocumentViewerWrapper ─ ResizableSplit ─ AssistantPanel (unchanged)
        ▼
BaseDocumentViewer
   metadata.xThread ? XThreadViewer (native)
                    : existing HTML iframe path (other html docs)
XThreadViewer
 ├─ XThreadHeader (author, counts, Open on X, Save, overflow)
 ├─ ThreadColumn (max-width 720px, spine)
 │    └─ XPostCard (avatar/name/handle · N/M · time · body · media grid · quote · overflow)
 ├─ XThreadSkeleton / XThreadErrorState
 ├─ mobile: XThreadMobileToolbar + AssistantSheet (peek/half/full)
 └─ selection adapter → SelectionPopup / SelectionActionsSheet → extracts/flashcards
```

## Migration & Compatibility

- No DB schema change (`structured_content` already stores the model).
- Old saved threads: first open after this change runs the new pipeline and refreshes `structured_content`; until then they render through the existing iframe (unchanged behavior).
- The dead `threaded_conversation_with_injections_v2` code is removed; `get_twitter_thread` signature unchanged.
