# Change: Overhaul Web Article Import (Canonical Reader-Mode Ingestion)

## Why

Sharing a web article URL into Incrementum (Android Share Sheet, PWA share target, or the toolbar's Import URL dialog) today imports the **entire flattened webpage** — navigation, topic menus, share controls, donation buttons, newsletter prompts, subscription ads, "Related"/"We Recommend"/"Latest" modules, footers, and ad-block/consent modals — with the actual article buried inside. The current `processHtmlContent` path in `src/utils/documentImport.ts` only sanitizes the full page; it performs no article extraction at all. This produces unreadable, un-studyable documents (a recent Mother Jones import is the canonical failure) and is unacceptable for Incrementum's reading experience. The importer must answer "what is the article?" while Incrementum's reader answers "how should it be displayed?"

## What Changes

- Add a **canonical Web Article Import Pipeline** that runs on every URL import: URL normalization → fetch (existing Rust `fetch_url_content`, extended to report the final redirect URL/status/content type) → structured metadata extraction (OpenGraph, JSON-LD/schema.org, Twitter, canonical link) → **competing extraction candidates from Defuddle and Mozilla Readability run against independent DOM clones** → deterministic quality scoring → best-candidate selection.
- Add a **deterministic extraction scorer** producing a comparable score plus a confidence level; low confidence triggers a **rendered-page fallback** (offscreen native WebView on Android, hidden Tauri WebviewWindow on desktop, best-effort iframe in PWA) that captures the rendered DOM and re-runs candidate extraction/scoring, with DOM-stability detection, timeouts, cancellation, and guaranteed WebView cleanup.
- Add an **article normalizer** (canonical semantic HTML, figure/figcaption preservation, lazy-load and `srcset` image normalization, relative-URL resolution, chrome-image rejection) and a **strict DOMPurify sanitization boundary** so only allowlisted semantic HTML is ever persisted or rendered.
- **Persist articles as first-class Incrementum documents**: sanitized semantic HTML in `content`, plain-text derivative, extended `DocumentMetadata` (canonical/original URL, extractor, extraction score/confidence, extraction version), and a **gzip raw-source snapshot** stored outside the DB for future re-extraction; canonical-URL duplicate detection; typed failure states with retry instead of silent garbage imports.
- Keep the Share Sheet entry points unchanged (Android `FolderImportPlugin`, PWA share target, toolbar dialog); only the pipeline behind `documentStore.importFromUrl` changes.
- Add a **deterministic fixture-based regression suite** (no live-site CI dependency) including the Mother Jones failure as an explicit regression case, plus an extraction benchmark wired into the existing bench gate, and bundle-budget accounting for the new dependencies.

No breaking changes: existing documents render exactly as before; all schema changes are additive.

## Capabilities

### New Capabilities

- `web-article-import`: Core pipeline — URL normalization, fetch, structured metadata extraction, competing Defuddle/Readability candidates, deterministic scoring/selection, failure taxonomy, and the requirement that successful engine execution alone is not acceptance.
- `rendered-page-fallback`: Rendered-DOM fallback for low-confidence static extraction — platform matrix (Android offscreen WebView, desktop hidden WebviewWindow, PWA iframe limitation), DOM stability detection, timeouts, cancellation, cleanup, and fallback-not-default cost policy.
- `article-sanitization`: Security boundary for untrusted internet HTML — DOMPurify allowlist sanitization, URL scheme validation, script/event-handler/iframe stripping, Tauri privilege isolation, and degenerate-sanitization detection.
- `article-persistence`: Canonical persisted article model — semantic HTML + text derivative, extraction engine/version/score metadata, raw-source snapshots with retention setting, canonical-URL dedupe, migration/backward compatibility for existing web imports.
- `article-import-regression-suite`: Deterministic HTML fixture corpus and assertions (title/author/body/figures/captions present; nav/footer/subscribe/donation text absent), the Mother Jones regression case, CI hermeticity, and benchmark/bundle-budget integration.

### Modified Capabilities

- `toolbar-url-import-modal`: The manual Import URL dialog now routes through the article pipeline and gains pipeline-aware progress, typed error states, retry, and an explicitly-labeled raw-page fallback action; existing open-in-tab and dialog behaviors are unchanged.

## Impact

- **Frontend**: new `src/utils/articleImport/` module tree (normalizer, scorer, engines, sanitizer, diagnostics, rendered-fallback client); `src/utils/documentImport.ts` `importFromUrl` rerouted through the pipeline; `src/hooks/useShareTarget.ts` error/UX states; `src/components/import/WebArticleImportDialog.tsx`; `src/types/document.ts` (`DocumentMetadata` extension); `src/stores/documentStore.ts` import orchestration and dedupe.
- **Backend (Rust)**: `src-tauri/src/commands/document.rs` (`fetch_url_content` extension: final URL, status, header content type, size cap); new `store_source_snapshot` command (gzip raw HTML to app-data dir); new rendered-DOM capture command for desktop (hidden `WebviewWindow`); Android: offscreen WebView capture added to the folder-import plugin (`src-tauri/plugins/folder-import/android/.../FolderImportPlugin.kt`) plus its Rust bridge/permissions; additive SQLite migration if a column is needed for dedupe/source reference.
- **Dependencies (add)**: `defuddle`, `@mozilla/readability`; reuse existing `dompurify`. All lazily imported; bundle budgets updated in the same change per repo protocol.
- **Tests**: new fixture suite under `src/utils/articleImport/__tests__/`; `src/**/*.bench.ts` entry for the bench gate; `scripts/bundle-budgets.json` / `scripts/perf-baselines.json` updates.
- **Unaffected**: PDF/EPUB/file imports, browser-extension enrichment (`browser_sync_server.rs` Readability path stays as-is), reader typography engine, extracts/highlights/TTS/AI features (articles render through the existing HTML viewer and therefore inherit them).
