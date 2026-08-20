## Why

Browser-extension imports can appear in the library as a dense, unreadable dump of navigation labels and page text instead of a readable article. At the same time, the extension can submit pages from passive browser activity even when automatic capture is disabled, flooding the library with visited pages and making the rendering problem much more visible.

The import path needs one explicit contract: user-triggered saves create readable, durable documents, while navigation, history, and bookmark events do nothing unless the user has deliberately enabled those capture modes.

## What Changes

- Normalize browser page imports into readable document content, preferring extension-captured article text and rich HTML and using a bounded readable extraction fallback for link-only imports.
- Preserve sanitized, structured article content for the document reader and text consumers instead of presenting raw page shells or a single unformatted text blob.
- Ensure imported document summaries are hydrated before the reader, assistant, search, or Q&A treats their body as available, including after restart or restored-tab navigation.
- Keep page saves and explicit text extracts separate; a page save must not become an extract containing the whole page.
- Make history sync, bookmark sync, and navigation auto-save strictly opt-in and disabled by default.
- Make the extension fail closed while settings are loading or unavailable, so startup races cannot save visited pages using temporary defaults.
- Align options-page defaults, persisted settings, background-worker state, and generated extension artifacts so “disabled” has the same meaning in every path.
- Add regression coverage for readable imported documents, restart/reopen behavior, passive navigation with capture disabled, explicit capture with capture enabled, and settings-load races.

## Capabilities

### New Capabilities

- `browser-import-document-readability`: Defines readable, durable browser-imported document content, page-versus-extract semantics, safe fallback extraction, and full-document hydration for reader and text consumers.
- `browser-extension-capture-policy`: Defines opt-in behavior for automatic page/history/bookmark capture, disabled defaults, initialization safety, and explicit-save behavior.

### Modified Capabilities

None.

## Impact

- `browser_extension/background.js`, `options.js`, option labels/defaults, manifests, and extension tests.
- `src-tauri/src/browser_sync_server.rs` and HTML processing/document repository paths for extraction, persistence, deduplication, and enrichment.
- React document stores, document viewer/reader surfaces, and assistant/Q&A hydration paths.
- No new external dependency or wire-format break is intended; existing explicit page, link, and extract requests remain supported.
