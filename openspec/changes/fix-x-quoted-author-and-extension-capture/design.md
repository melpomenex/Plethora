## Context

The X thread pipeline is ThreadReaderApp-first (`src-tauri/src/threadreader.rs` parses the unrolled HTML page; `src-tauri/src/twitter.rs` enriches via guest-token GraphQL with syndication fallback). Quoted posts are discovered two ways: embedded in a fetched payload (`parse_quoted_post`, twitter.rs:611) or by scanning the TRA post HTML for status links (`extract_ref_ids`, threadreader.rs:663) which are fetched during enrichment phase 2. `parse_author` (twitter.rs:350) returns a hardcoded `Unknown`/`unknown` fallback when the payload's user shape can't be parsed; commit fc668733 added guards for posts and thread authors, but quoted posts still surface `@unknown`.

The browser extension (browser_extension/, MV3, cross-browser) POSTs JSON captures to an axum server inside the Tauri app (`src-tauri/src/browser_sync_server.rs`, 127.0.0.1:8766) via `handle_extension_request`, which classifies by `type` and URL; only YouTube is special-cased today.

## Goals / Non-Goals

**Goals:**
- Quoted posts never display `Unknown (@unknown)` when the author's handle is derivable from any signal the pipeline already sees.
- Graceful, neutral display when the author is genuinely unknowable.
- Extension save (current tab, save-all-tabs, context menu) on an X status URL captures the full thread through the app's existing retrieval pipeline, identically on Firefox and Chromium.
- Extension-originated X captures persist as complete thread documents (with enrichment applied), dedupe against existing docs, and notify the app like other captures.
- Backward compatibility with already-persisted thread `structuredContent`.

**Non-Goals:**
- Authenticated/paid X API support; profile pages (non-status X URLs); quote chains deeper than one level; X search/timelines.
- Changing the in-app `openTwitterThread` flow or the viewer's data flow beyond the quote-card fallback.
- Video download from the extension (existing import dialog covers it).

## Decisions

### D1: Additive `ref_handles` map instead of reshaping `ref_ids`
`extract_ref_ids` already walks `x.com|twitter.com/<user>/status/<id>` and validates `<user>` — it starts returning `(id, Option<screen_name>)` pairs. `TwitterPost` gains an optional `ref_handles: Vec<TwitterPostRef { id, screen_name }>` (serialized `refHandles`, camelCase, `#[serde(default, skip_serializing_if)]`) populated by `build_tra_thread`; `ref_ids` remains as-is.
- *Why:* old persisted threads have `ref_ids: Vec<String>`; reshaping it (e.g. untagged serde enum) risks breaking the TS type guard (`isTwitterThreadShape`, src/api/documents.ts:30) and every reader for cosmetic gain. The TS mirror (`src/types/document.ts`) adds an optional field and tolerates its absence.
- *Alternative rejected:* derive handles lazily from persisted `html_content` during enrichment — enrichment wouldn't run for already-imported docs, and TRA HTML isn't guaranteed present in every path.

### D2: Central helpers + call-site fallback (no `Option<TwitterAuthor>` refactor)
Add `fn is_unknown_author(a: &TwitterAuthor) -> bool` (name "Unknown" && screen_name "unknown") and `fn author_from_screen_name(handle: &str) -> TwitterAuthor` (display name `@handle`, `profile_url` via `build_profile_url`, no avatar). Substitution is applied at three call sites:
1. Enrichment phase 2 (twitter.rs:1312-1361): after `parse_quoted_post`/minimal-quote build, if `is_unknown_author(&qp.author)` and a `ref_handles` entry exists for the quote id → substitute and rebuild `qp.url` with `build_status_url`.
2. Enrichment phase 1: if the merged post's embedded `quoted_post` author is unknown and a `ref_handles` entry matches `quoted_post.id` → same substitution.
3. `XQuoteCard.tsx`: when `screen_name` is "unknown", render a neutral "Quoted post" header (no name/avatar) instead of `Unknown (@unknown)`.
- *Why:* keeps `parse_author`'s contract stable, concentrates the fix where merges happen (same pattern as the fc668733 guards), avoids rippling `Option` through every parser caller.
- *Alternative rejected:* return `Option<TwitterAuthor>` from `parse_author` — mechanically larger, and callers still need the fallback handle, so the logic lands in the same places.

### D3: Extension classifies the URL; server does all retrieval (URL-only capture)
`shared.js` exports `isXStatusURL(url)` matching `^(https?://)?(www\.|mobile\.)?(x|twitter)\.com/<user>/status/<digits>` (query/photo-suffix tolerant). `background.js` checks it in the save path (single-tab save, save-all-tabs, context-menu save) **before** requesting page content from the content script and sends `{ type: "x-thread", url, title }` — no DOM scraping, no content-script involvement.
- *Why:* x.com's DOM is JS-rendered and useless for parsing; the app's TRA-first pipeline is authoritative; URL-only payloads are tiny (budget/degradation helpers irrelevant); behavior is byte-identical across Firefox/Chromium (plain `fetch` + existing MV3 APIs); works from every save entry point.
- *Alternative rejected:* content-script scrape of the open tweet → fragile against X DOM churn and unnecessary given the retrieval pipeline.
- Unreachable server → reuse the existing offline queue mechanism so x-thread captures flush when the app starts; success/failure notifications reuse the existing extension notification plumbing.

### D4: Capture server routes by URL first, then type; enriches inline before persisting
In `handle_extension_request` (browser_sync_server.rs:772), classification gains an early branch: request URL matches an X status URL → `handle_x_thread_request`, regardless of `type` (so an older extension sending `type: "page"` for x.com still routes correctly; non-status x.com URLs stay generic). The handler:
1. Extracts the status id + canonical URL (reuse `extract_screen_name_from_url` / URL parsing already in twitter.rs).
2. Calls a shared `resolve_twitter_thread` inner function — refactor the body of the `get_twitter_thread` command (twitter.rs:1551) into a callable taking the app state so command and server share one implementation.
3. Runs `enrich_twitter_thread_with` **inline** before persisting, then persists exactly like `import_twitter_thread` (FileType::Html, category "X Threads", tags `[x, twitter, thread]`, `article_html` + `structured_content`), deduping by normalized status URL (`find_document_by_url`, same as `handle_import_request`) into the active collection (`resolve_browser_import_collection_id`).
4. Emits the existing `browser-sync://document-saved` event and returns the same ack shape as `handle_import_request`; `ThreadError` maps to a typed error response so the extension notification can say why (unavailable/rate-limited).
- *Why inline enrichment:* extension captures have no open viewer to run the non-blocking frontend `enrichTwitterThread` step; persisting after enrichment makes one capture = one complete document (quotes, media, counts) with no new background-update machinery.
- *Trade-off:* capture ack waits for TRA + bounded enrichment (seconds). Acceptable for an explicit user-initiated save; failure still persists the TRA-only thread (enrichment failures are already per-post-skipped).

## Risks / Trade-offs

- [GraphQL/syndication shape rotations re-break author parsing] → `is_unknown_author` + handle substitution is itself the resilience mechanism; add fixture tests for restricted-user payloads (`UserUnavailable`, missing `legacy`).
- [Handle from URL is stale after a rename → quote permalink 404s] → same behavior as X's own renamed-quote cards; text/media still captured.
- [Old extension + new app, or new extension + old app] → URL-based server routing covers the old-extension case; new extension + old app degrades to a generic page save of x.com (harmless).
- [Inline enrichment slows the capture ack] → bounded 4-concurrency, per-post failure tolerance; worst case the ack is a few seconds.
- [Persisted JSON grows by `refHandles`] → negligible (a handful of small entries per thread).
- [Duplicate captures] → existing URL dedupe covers; status URL normalization must strip query params/photo indexes.

## Migration Plan

Additive only — no data migration. Old `structuredContent` parses unchanged (`refHandles` absent → `Vec::new()` via serde default; TS optional). Rollback = revert; previously saved enriched docs remain valid.

## Open Questions

- None blocking. Extension capture follows the app's existing open-on-save behavior for notifications/navigation (no new setting).
