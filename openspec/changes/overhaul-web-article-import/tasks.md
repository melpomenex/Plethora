## 1. Foundation: types, config, URL normalization

- [x] 1.1 Create `src/utils/articleImport/` module tree with `types.ts` (`ExtractionCandidate`, `PageMetadata`, `ScoredCandidate`, `ArticleImportErrorCode`, `ArticleImportDiagnostics`, `NormalizedArticle`, `RenderedCaptureResult`) and `extractor-config.ts` (weights, thresholds `HIGH/MEDIUM/ACCEPT_FLOOR`, `MIN_WORDS`, `EXTRACTOR_VERSION = 1`, lexicons) — all constants centralized, no randomness/clock inputs anywhere in scoring.
- [x] 1.2 Implement `urlNormalizer.ts` (scheme/host/port/fragment normalization, conservative tracking-param blocklist, original preserved verbatim) with unit tests.
- [x] 1.3 Add typed failure errors (`ArticleImportError` with code + cause + retryability) and the pipeline skeleton `importArticle(url, { signal, platformCaps })` with stage timings instrumentation points; wire `AbortSignal` threading through all stages.

## 2. Dependencies and bundle plumbing

- [x] 2.1 Add `defuddle` and `@mozilla/readability` to `package.json`; verify licenses, TS typings, and WebView compatibility; load all three pipeline libs (`defuddle`, `@mozilla/readability`, `dompurify`) via cached `dynamic import()` behind an engine-loader module.
- [x] 2.2 Add an `article-vendor` manual chunk for PWA builds in `vite.config.ts`; confirm no new top-level imports at app startup (grep test: module graph of entry chunk does not execute pipeline libs at load).
- [x] 2.3 Measure the Tauri entry-chunk delta after integration (task 8) and update `scripts/bundle-budgets.json` with a justification comment in this change (never silently over budget).

## 3. Backend: fetch extension and source snapshots

- [x] 3.1 Extend `fetch_url_content` (or add `fetch_web_article`) in `src-tauri/src/commands/document.rs` to also return final redirect-resolved URL, HTTP status, header content type, redirect hop count, and enforce a response size cap (reject > ~15 MB with a typed error); keep the existing SSRF guard and temp-file behavior; register the command.
- [x] 3.2 Add `store_source_snapshot(document_id, bytes)` Rust command: gzip raw HTML to `{app_data}/source-snapshots/{id}.html.gz`, skip + report when raw > 5 MB, return `{ path, sha256, rawBytes, gzipBytes }`; add `delete_source_snapshots` for retention/cleanup. *(Implementation note: the command takes `source_path` — the temp file `fetch_url_content` already wrote — instead of inlining the bytes over IPC, because Android's Tauri IPC is JSON-only and a multi-MB byte array would hang/OOM it; the snapshot still captures the exact fetched bytes, server-side.)*
- [x] 3.3 Rust unit tests for both commands (redirect resolution, size caps, snapshot round-trip and digest).

## 4. Metadata extraction

- [x] 4.1 Implement `metadataExtractor.ts`: OpenGraph, JSON-LD graph walk (Article/NewsArticle/BlogPosting/TechArticle), Twitter fallbacks, meta author, `og:locale`/`<html lang>`, canonical link — with the deterministic field precedence from design D7 and conflict diagnostics.
- [x] 4.2 Unit tests: precedence matrix (JSON-LD vs OG vs meta vs engine), title-suffix cleaning, multi-author JSON-LD, missing-metadata fallbacks, malicious/malformed JSON-LD tolerated.

## 5. Extraction engines and scorer

- [x] 5.1 Implement `engines/defuddleExtractor.ts` and `engines/readabilityExtractor.ts`: each takes a deep-cloned `Document`, returns a normalized `ExtractionCandidate` (engine, contentHtml, title, byline, publishedTime, textContent, stats: words/paragraphs/images/headings/linkChars); engine exceptions become `no-candidate` results, not pipeline aborts.
- [x] 5.2 Implement `engines/site-specific/` registry (domain → extractor returning a standard candidate; scored like any engine) — ship empty or with a Wikipedia adapter ported from the proven `.mw-parser-output` logic; registry lookup is the first extractor in the chain.
- [x] 5.3 Implement `scorer.ts` per design D3 (prose volume/quality, link-density penalty, chrome lexicon + tiny-link-fragment + repeated-block penalties, structure bonus, metadata agreement, completeness signal; score + confidence + reason codes); pure and deterministic.
- [x] 5.4 Unit tests: determinism (same fixture → identical score), clone isolation between engines, chrome-heavy candidate loses to prose candidate, completeness penalty for tiny extractions of large sources, confidence bucket boundaries, tie-break order.

## 6. Normalization, images, sanitization

- [x] 6.1 Implement `articleNormalizer.ts`: canonical `<article>` shape (publication/title/dek/byline header, hero figure, body), single-`h1` enforcement, title-duplicate removal, layout-wrapper unwrapping, empty-node cleanup, stable reading order (no reordering), plain-text derivative generation.
- [x] 6.2 Implement `imageNormalizer.ts`: lazy-attribute resolution (`data-src`, `data-lazy-src`, `data-original`, `data-ll-src`), `srcset`/`<picture>` best-source selection (largest ≤ 2400px), absolute-URL resolution against canonical URL, alt preservation, tracking-pixel (≤ 2px) and repeated-source (logo) rejection, `referrerpolicy=no-referrer` + `loading=eager` + `decoding=async`.
- [x] 6.3 Implement `sanitizer.ts`: DOMPurify with the explicit tag/attribute allowlist from design D6, after-sanitize URL policy hook (http/https/mailto/fragment for links; http/https for media; strip `javascript:`/`data:`/`vbscript:`), no class/style/data-* passthrough, per-import dropped-item counts as diagnostics.
- [x] 6.4 Unit tests: normalizer shape/dedup/unwrap cases; image normalizer lazy/srcset/relative/pixel/logo cases; sanitizer XSS battery (`script`, `img onerror`, `javascript:`/`data:` URLs, SVG-with-script, form/iframe/style, `noscript` mXSS, attribute smuggling) asserting persisted HTML is inert; degenerate-sanitization thresholds (warn < 60%, fail < 25%).

## 7. Rendered-page fallback

- [x] 7.1 Define the `RenderedDomCapture` interface + registry (platform dispatch), the shared DOM-stability script (readyState + sampled node/text/image counters, 750 ms stability window, 6 s stabilization cap, 20 s overall budget), and an injectable fake for tests.
- [x] 7.2 Android: add `captureRenderedDom(url, timeoutMs)` to `FolderImportPlugin.kt` — offscreen bare `WebView` (no Tauri bridge), JavaScript enabled, injected stability script, `evaluateJavascript` DOM capture, single-flight queue, guaranteed `destroy()` in finally, cancellation + timeout handling; expose via the Rust plugin bridge (`src-tauri/plugins/folder-import/src/lib.rs`) with permissions/capabilities updated.
- [x] 7.3 Desktop: add `capture_rendered_dom` Rust command creating a hidden `WebviewWindow` labeled `article-capture-*` that matches no capability, initialization-script stability capture posting the DOM back, and guaranteed window destruction on success/timeout/cancel; return typed `unavailable` where the platform refuses (WebKitGTK fallback behavior).
- [x] 7.4 PWA: best-effort hidden-iframe capture client detecting load failure/inaccessible document → `rendered_unavailable`.
- [x] 7.5 Integrate fallback into the pipeline: trigger only on low confidence / below-min words / no candidates / degenerate sanitization; re-run engines + scorer on rendered DOM; rendered candidates compete by score; add a guard test asserting no capability file ever matches `article-capture-*` and unit tests with the fake renderer (JS-shell fixture → fallback success; timeout → `rendered_failed`; cancel → clean abort + cleanup assertions).

## 8. Pipeline assembly and persistence

- [x] 8.1 Implement the full `importArticle` orchestration: normalize → fetch → parse → metadata → site-specific + Defuddle + Readability on clones → score → (fallback if needed) → normalize → sanitize → degeneracy check → `NormalizedArticle` + diagnostics; every stage timed and failure-mapped to `ArticleImportErrorCode`.
- [x] 8.2 Extend `DocumentMetadata` (TS `src/types/document.ts` + Rust `models/document.rs`, additive optional `serde(default)`) with the `webArticle` provenance object (URLs, extractor, score, confidence, version, fallback usage, bounded candidates, diagnostics, snapshot reference); verify old records without it load unchanged.
- [x] 8.3 Reroute `documentStore.importFromUrl` through `importArticle`: build the document (fileType `html`, `content` = sanitized article HTML, `source_url` = canonical URL, tags/category as today, `coverImageUrl` from hero image), call `store_source_snapshot` after creation, and persist metadata; direct-file URL imports (`.pdf`/`.epub`/`.md`/`.txt`) keep their existing non-article path.
- [x] 8.4 Implement canonical-URL dedupe: pre-create lookup by `source_url` (canonical → normalized original) plus an in-flight URL set; duplicates surface the existing document; keep `useShareTarget` single-flight semantics.
- [x] 8.5 Add the `webImportKeepRawSource` setting (default on; off deletes existing snapshots and skips new ones) plus a 180-day snapshot cleanup pass; document the backup-exclusion trade-off in the settings UI copy/help.
- [x] 8.6 Store-level tests with mocked APIs: happy-path mapping, failure codes produce no document, dedupe (existing + in-flight), snapshot skip on oversize, raw-fallback marker path.

## 9. UX: share sheet and import dialog

- [x] 9.1 Update `useShareTarget` failure handling: typed error toasts with retry action, "Open original" where applicable, no document on failure; keep success toast + Open tab behavior.
- [x] 9.2 Update `WebArticleImportDialog`: pipeline progress states (fetching/extracting/rendered fallback), typed error display with retry, and the explicit labeled "Import full page anyway" escape hatch (extractor `raw-fallback` + visible `inc-raw-notice` banner in the stored document); cancel aborts via the pipeline signal.
- [x] 9.3 Confirm the reader renders new articles with existing typography/theme/e-ink settings and that highlight/extract/TTS flows anchor correctly (char-offset stability) on a freshly imported article; keep the legacy `processHtmlContent` render-repair path for pre-existing documents.

## 10. Regression corpus, benchmarks, validation

- [ ] 10.1 Create the fixture corpus under `src/utils/articleImport/__tests__/fixtures/` covering every category in the regression spec (news, WordPress, Mother Jones-style, Substack, Medium-style, Wikipedia, blog, docs, heavy-nav, recommendations, newsletter CTAs, donation prompts, embedded modal, multi-image/captions, tables, blockquotes, code, lazy images, relative URLs, malformed HTML, JS-rendered shell, JSON-LD-rich, defuddle-wins, readability-wins, both-static-fail) with `expected.json` assertions (title/author/date/site, minWords, mustContain/mustNotContain, expectedExtractor/confidence range, image/figure counts); add a fixtures README documenting the crafted-replica capture policy.
- [ ] 10.2 Add the Mother Jones regression fixture with the exact metadata assertions (Mother Jones / title / Sophie Hurwitz / August 15, 2026), hero figure/caption presence, and absence of the reported chrome strings; assert no site-specific rule fires.
- [ ] 10.3 Build the fixture-driven suite runner (mocked fetch from fixtures; fake rendered capture for the JS-shell case) and make it pass; verify zero network usage (`src/utils/articleImport/__tests__` offline run).
- [x] 10.4 Add `src/utils/articleImport/importPipeline.bench.ts` per the bench gate rules (seeded PRNG synthetic pages, sink-consumed results); run `npm run bench:check` and record/update `scripts/perf-baselines.json` and `scripts/bundle-budgets.json` per protocol.
- [ ] 10.5 Full validation *(automated portion complete this session: `npm run test` 3411 passed, `npm run test:scripts` 103 passed, `cargo test` 823 passed, `npm run bench:check` OK with new baselines, eslint clean on new code, `cargo fmt` applied incl. pre-existing drift in src-tauri/pdf/*; remaining: the manual platform matrix below, which needs real Android/desktop/PWA devices)*: `npm run test` (unit + fixtures), `npm run test:scripts`, `cargo test` in `src-tauri`, `npm run bench:check`, lint/format (`cargo fmt` included); manual matrix — Android share of a standard article, a JS-rendered article, a paywalled page, and a duplicate re-share; desktop dialog import incl. failure/retry/raw fallback; PWA share target incl. blocked-iframe degradation; verify old web imports still render.
