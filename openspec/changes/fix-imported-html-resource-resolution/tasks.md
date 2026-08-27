## 1. Shared resource-base utility

- [x] 1.1 Add `resolveEffectiveResourceBase({ requestedUrl, finalUrl, docBaseHref })` to `src/utils/articleImport/` (new `resourceBase.ts` or alongside `arxivResolver.ts`), implementing design D1 precedence (safe doc `<base href>` absolutized against the anchor → final URL verbatim → requested URL), returning `{ base, source }`; reject non-http(s) or relative-only base hrefs.
- [x] 1.2 Add a `docBaseHref(doc)` reader (first `<base href>` in the fetched document) and strip `<base>` elements from documents/fragments before engine extraction and persistence.
- [x] 1.3 Unit-test the utility in `src/utils/articleImport/__tests__/`: version-prefixed arXiv srcs (`2410.07524v1/upcycle.png` vs no-slash document URL), bare/`./`/`../`/root-relative/protocol-relative/absolute URLs, query/fragment/encoded paths, safe cross-origin `<base href>`, `javascript:`/relative-only `<base href>` rejection, final-URL-over-requested-URL redirect precedence, http→https scheme normalization of protocol-relative URLs.

## 2. Fixtures before behavior (regression first)

- [x] 2.1 Update `fixtures/arxiv-html-regression/` to current live markup: version-prefixed figure srcs (`2410.07524v1/…`), `ltx_*` structure, a root-absolute chrome image, an `onerror` handler img, a `data:text/html` img, MathML stub, no `<base>`; set fixture URL **without** trailing slash and `mustContainImageUrls` to `https://arxiv.org/html/2410.07524v1/…` asset URLs; add a versionless variant page whose figures reference `…v2/` paths.
- [x] 2.2 Extend `fixtures/relative-image-urls/` (and add a sibling fixture) for: canonical link whose path differs from the document URL, safe cross-origin `<base href>`, malicious `<base href>`.
- [x] 2.3 Add an end-to-end pipeline test (fixtures, hermetic) asserting the exact ArXiv chain: fetch URL → parse → resource base → image normalization → article normalization → sanitization → persisted `src` values, including zero relative/scheme-relative media `src` in persisted HTML (design D7 scan).

## 3. Pipeline and fallback adoption

- [x] 3.1 `importPipeline.ts`: compute `assetBaseUrl` via D1/D2 after fetch (requested `source.fetchUrl`, `fetched.finalUrl`, doc `<base href>`); use it for engine clones, rendered-fallback re-run, `normalizeArticle({ baseUrl })`, and hero-image absolutization; keep `canonicalUrl` identity-only; record `diagnostics.resourceBase` and media counts (design D9).
- [x] 3.2 `arxivResolver.ts`: stop exporting slash-appended bases for the import path — `resolveImportSource` returns the verbatim fetch URL as `assetBaseUrl` (helper retained only for the legacy reader repair in task 5.3); update `arxivResolver.test.ts` expectations.
- [x] 3.3 `rawFallback.ts`: resolve the raw-page image base through the same helper (finalUrl/doc-base aware) instead of `arxivHtmlAssetBase`/canonical URL.
- [x] 3.4 `extractor-config.ts`: bump `EXTRACTOR_VERSION` 4 → 5; extend `ArticleImportDiagnostics` types (`resourceBase`, media outcome counts) additively.
- [x] 3.5 Update pipeline/diagnostics tests for the new fields and base behavior; keep all existing non-base assertions green.

## 4. Asset ingestion degradation

- [x] 4.1 `articleAssetIngestor.ts`: on ingest failure, retain the absolute remote `src` (still dropping `srcset`/`sizes`), add `degradedToRemote` to asset diagnostics, keep cancellation fatal and limits/MIME/concurrency unchanged.
- [x] 4.2 Tests: stubbed registry failure (404/timeout/too-large/aggregate) → remote URL retained, import succeeds, diagnostics counts correct; cancel path still aborts; `preserveImages=false` unchanged.

## 5. Reader-side repair

- [x] 5.1 `prepareHtmlDocument.ts`: `safeImageUrl` returns null for empty/whitespace/missing `src` → img removed; never resolve an empty source to the reader base; apply the same removal rule in the non-canonical branch.
- [x] 5.2 `documentImport.ts` `resolveDocumentHtmlBaseUrl`: reorder to `webArticle.resolvedUrl → htmlUrl → source → filePath` with `canonicalUrl` as last fallback; generic candidates pass through verbatim (no slash mutation).
- [x] 5.3 Keep the historical `arxivHtmlAssetBase(htmlUrl)` repair **only** for documents classified `legacy-arxiv`: thread the reader kind from `DocumentViewer.tsx` into base selection; add classification-aware tests (legacy keeps slash base; canonical/raw/browser-capture use verbatim resolved URL).
- [x] 5.4 `processHtmlContent`: remove imgs with no usable candidate after lazy-attribute resolution instead of leaving a source-less img; unit-test via the compat path.

## 6. Import UI parity and repair action

- [x] 6.1 `WebArticleImportDialog.tsx`: replace the `origin + '/'` preview base with `resolveEffectiveResourceBase` over the dialog's fetched document; relative figures preview correctly; keep the rest of preview behavior unchanged.
- [x] 6.2 `documentStore.reimportCanonicalArticle`: correct repair-URL precedence to `resolvedUrl → canonicalUrl → htmlUrl → arxivUrl` (design D6); keep identity/category/tags; refresh provenance and asset references.
- [x] 6.3 Surface "Re-import from source" in the reader/document menu for eligible documents (canonical provenance, or `legacy-arxiv` with stored source URL); disabled/unavailable states and failure toast for offline; no automatic invocation anywhere.
- [x] 6.4 Store + component tests: re-import replaces body/assets for a broken-fixture document; legacy arXiv document becomes canonical after re-import; offline failure leaves the stored document unchanged.

## 7. Validation and gates

- [x] 7.1 Run the article-import, sanitizer, store, reader-preparation, and ingestor test suites; resolve every failure without weakening the new spec assertions.
- [ ] 7.2 Manual smoke (desktop): import a live arXiv HTML paper (e.g. `https://arxiv.org/html/2410.07524v1`) — all figures render; toggle `webImportPreserveImages` off — figures still resolve remotely; break one asset URL — degraded figure renders or is omitted, never a `?`-on-page artifact; verify diagnostics in persisted provenance. *(Partially verified: a live-pipeline run over the real `2410.07524v1` page confirmed all 18 figures absolutize to verbatim-base URLs with live HTTP 200s and no doubled-version URLs; the remaining GUI-specific checks — WebView rendering, settings toggle, provenance inspection in-app — still need a desktop session.)*
- [x] 7.3 Run `npx tsc --noEmit`, `npm run build:check`, `npm run test:scripts`, and `npm run bench:check`; update `scripts/perf-baselines.json`/`scripts/bundle-budgets.json` only if the change is intentional and documented under the repository gate protocol. *(tsc: 25 pre-existing errors at HEAD, zero new from this change. build:check: `docs-validate` fails at HEAD on unrelated Apple-docs files; `build-help-index`, `vite build` pass; bundle budget not reachable past the pre-existing docs failure. test:scripts: 184 pass; 2 failures (`plutil` iOS-override, darwin environment-shape) reproduce identically on the clean tree — environmental. bench:check: 11–12 failures reproduce identically on the clean tree (host noise, unrelated suites); this change's own benchmark `article-import-static-small-40p` measured faster than baseline. No baseline updates warranted by this diff.)*
