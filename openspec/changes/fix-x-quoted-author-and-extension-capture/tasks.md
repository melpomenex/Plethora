## 1. Quote-handle capture (backend model + TRA parser)

- [x] 1.1 Add `is_unknown_author` and `author_from_screen_name` helpers in `src-tauri/src/twitter.rs`; unit-test both (pure functions)
- [x] 1.2 Extend `extract_ref_ids` in `src-tauri/src/threadreader.rs` to return `(id, Option<screen_name>)` pairs; keep own-thread filtering intact; update fixture tests to assert handles are captured
- [x] 1.3 Add `TwitterPost.ref_handles: Vec<TwitterPostRef { id, screen_name }>` (serde `default`, camelCase, skip when empty) in `src-tauri/src/twitter.rs`; populate it in `build_tra_thread`; keep `ref_ids` populated as before
- [x] 1.4 Mirror the optional `refHandles` field in `src/types/document.ts` (optional; absent on legacy docs) and confirm `mapDocument`/`isTwitterThreadShape` tolerate its absence

## 2. Quote author fallback (enrichment + viewer)

- [x] 2.1 In `enrich_twitter_thread_with` phase 2, after building a quote from a ref fetch: if `is_unknown_author` and a matching `ref_handles` entry exists, substitute `author_from_screen_name` and rebuild `url` via `build_status_url`
- [x] 2.2 In `enrich_twitter_thread_with` phase 1, apply the same substitution to an embedded `quoted_post` whose author is unknown when `ref_handles` matches `quoted_post.id`
- [x] 2.3 Rust tests: quote payload with unparseable author + URL handle → recovered author and permalink; parseable payload author → not overridden; no handle → Unknown retained (see spec `x-thread-quote-attribution`)
- [x] 2.4 `XQuoteCard.tsx`: when the quote author is the Unknown fallback, render a neutral "Quoted post" header (no name/avatar) instead of `Unknown (@unknown)`; update/extend `XThreadViewer` tests
- [x] 2.5 Regression: existing fc668733 tests (post/thread-author guards) still pass

## 3. Extension-side X routing

- [x] 3.1 Add `isXStatusURL(url)` to `browser_extension/shared.js` (x.com/twitter.com, `www.`/`mobile.`, `/status/<id>`, query/photo-suffix tolerant); add node tests in `browser_extension/tests/` (status/thread URLs, profile/search non-matches)
- [x] 3.2 Route saves in `background.js`: single-tab save, save-all-tabs, and context-menu save check `isXStatusURL(tab.url)` before page-content capture and send `{ type: "x-thread", url, title }` instead
- [x] 3.3 Route `x-thread` captures through the existing offline queue when the server is unreachable; success/failure notifications reuse the existing plumbing (failure message names the typed reason)

## 4. Capture-server X branch

- [x] 4.1 Refactor the `get_twitter_thread` command body (src-tauri/src/twitter.rs) into a shared callable over app state so the command and the capture server use one implementation
- [x] 4.2 Add URL-based early routing in `handle_extension_request`/`classify_extension_request` (browser_sync_server.rs): any X status URL → `handle_x_thread_request`, regardless of `type`; non-status X URLs stay generic
- [x] 4.3 Implement `handle_x_thread_request`: resolve thread → inline `enrich_twitter_thread_with` → persist like `import_twitter_thread` (category "X Threads", tags, `article_html`, `structured_content`), dedupe by normalized status URL via `find_document_by_url`, import into `resolve_browser_import_collection_id` collection
- [x] 4.4 Emit `browser-sync://document-saved` and return the same ack shape as `handle_import_request`; map `ThreadError` to a typed error response the extension can surface
- [x] 4.5 Rust tests for the server branch: x-thread capture persists a thread doc; duplicate URL dedupes; typed failure returns error (mock source)

## 5. Verification

- [x] 5.1 `cargo test` (twitter, threadreader, browser_sync_server suites) green
- [x] 5.2 Frontend vitest suites green (`documentStoreXThread`, `XThreadViewer`, `xthread-documents`); `npm run test:scripts` if scripts touched
- [x] 5.3 `node --test` in `browser_extension/tests/` green
- [ ] 5.4 Manual end-to-end: extension save of a post with an embedded quote shows the quoted author's real name/handle (e.g. the @PhillipAKennedy hobby-shop thread from the report); save-all-tabs and offline-queue paths spot-checked in both Firefox and Chromium
