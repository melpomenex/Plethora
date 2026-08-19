## Why

Two gaps break the X capture experience today:

1. **Quoted/embedded posts lose their author.** When a captured post quotes another post, the quote frequently renders as `Unknown (@unknown)` — the quote's text, media, and timestamp resolve, but the author doesn't (restricted/unavailable users, rotated payload shapes). Meanwhile the quoting post's ThreadReaderApp HTML contains the author's handle inside the status link (`x.com/<user>/status/<id>`), and `extract_ref_ids` (src-tauri/src/threadreader.rs:663) throws that handle away, keeping only the id. Commit fc668733 added guards so posts and thread authors are never clobbered by the Unknown fallback — the quoted-post path was left uncovered.
2. **The browser extension can't capture X.** Plethora Capture (browser_extension/, Manifest V3, Firefox + Chromium) has zero X-specific routing: saving an x.com/twitter.com tab produces a generic `FileType::Html` page document and never enters the ThreadReaderApp-first thread pipeline. Extension users must paste URLs into the app by hand.

## What Changes

- **Preserve URL-derived quote handles.** `extract_ref_ids` also captures the `<user>` segment of each status link; the normalized `TwitterPost` carries an id→handle map alongside the existing `ref_ids` (additive, backward-compatible with persisted threads).
- **Never display `@Unknown` for quotes when a handle is derivable.** The quote-resolution paths (phase-1 `parse_quoted_post`, phase-2 ref fetch in `enrich_twitter_thread_with`) substitute the URL-derived handle whenever the fetched payload yields the Unknown author, mirroring the existing guards — and rebuild the quote's permalink from the recovered handle.
- **Graceful quote fallback in the viewer.** When an author is genuinely unknowable, `XQuoteCard` shows a neutral label ("Quoted post") instead of `Unknown (@unknown)`.
- **Extension captures X posts/threads.** The extension classifies x.com/twitter.com status URLs (current tab, save-all-tabs, context menu) and sends a typed URL-only `x-thread` capture to the local capture server — no DOM scraping, since the app's retrieval pipeline is authoritative. Uses only cross-browser MV3 APIs so Firefox and Chromium behave identically.
- **Capture server routes X requests through the thread pipeline.** `browser_sync_server.rs` gains an `x-thread` branch that resolves the thread via the same ThreadReaderApp-first path as `get_twitter_thread`, persists it exactly like `import_twitter_thread` (category "X Threads", tags, `structuredContent`), dedupes by URL, runs enrichment server-side so extension captures persist with full quote/media data, and emits the existing `browser-sync://document-saved` event.

## Capabilities

### New Capabilities
- `x-thread-quote-attribution`: Quoted/embedded posts in captured X threads resolve author identity from every available signal (quote payload, quoting post's status-link URL); `Unknown (@unknown)` never surfaces when a handle is derivable, and the viewer degrades gracefully when it is not.
- `browser-extension-x-capture`: The Plethora Capture extension captures X post/thread URLs into the app's X thread pipeline on both Firefox and Chromium.

### Modified Capabilities
<!-- None — no existing specs in openspec/specs/ cover the X pipeline or the extension. -->

## Impact

- **Rust backend**: `src-tauri/src/threadreader.rs` (`extract_ref_ids` returns handles too), `src-tauri/src/twitter.rs` (`TwitterPost` model + serde, `parse_author`/`parse_quoted_post` fallback handling, phase-2 quote resolution, `build_single_post_thread`-style URL-derived author helper reuse).
- **Capture server**: `src-tauri/src/browser_sync_server.rs` (new `x-thread` request type + routing, server-side enrichment + persist).
- **Extension**: `browser_extension/shared.js` (X URL classifier), `background.js` (routing at save time), possibly `popup.js` copy; tests in `browser_extension/tests/`.
- **Frontend**: `src/types/document.ts` (optional mirror field, tolerant restore of old threads), `src/components/viewer/XQuoteCard.tsx` (neutral fallback label).
- **Tests**: Rust unit tests for handle extraction and quote fallback; extension node tests for classification/routing; existing X-thread store/viewer tests keep passing.
- **No breaking changes**: persisted `structuredContent` from older versions remains valid (`ref_ids` unchanged, new field optional).
