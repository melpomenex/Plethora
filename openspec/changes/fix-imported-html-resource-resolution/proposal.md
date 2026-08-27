## Why

Importing the HTML version of an arXiv paper produces text but shows the WebView's broken-image placeholder (`?`) for every figure, and the same class of bug silently breaks relative images on generic sites whose canonical URL differs from the real document URL. Verified root cause: arXiv now emits **version-prefixed relative asset paths** (`<img src="2410.07524v1/upcycle.png">`, confirmed live on `arxiv.org/html/2410.07524v1`), which resolve correctly under plain standards URL semantics against the fetched document URL — but Plethora resolves imported resources against (a) a legacy arXiv trailing-slash base that now **doubles the version directory** (`…/2410.07524v1/2410.07524v1/upcycle.png` → 404, confirmed live) and (b) the page's **canonical URL** for generic sites, which is an identity, not a resource base. Failed asset ingestion then strips `img src` entirely, and the reader resolves the empty `src` back into the document base URL — pointing `<img>` at an HTML page and producing the `?` icon. Resource resolution is currently spread across several ad-hoc implementations (pipeline, raw fallback, legacy importer, dialog preview, reader repair) that disagree on the base.

## What Changes

- **One effective-resource-base rule** with standards precedence — safe document-declared `<base href>` → redirect-resolved final URL → requested URL — replacing all ad-hoc bases. Metadata canonical/og/JSON-LD URLs are never used as resource bases (they remain canonical-identity metadata).
- **Remove the arXiv trailing-slash hack** (`arxivHtmlAssetBase`) from all import-path resolution: current arXiv markup resolves correctly against the verbatim document URL, exactly as the source browser does. Historical `legacy-arxiv` reader repair is intentionally retained for pre-canonical documents whose markup relied on the slash base.
- **Graceful ingestion degradation**: a figure whose download fails keeps its absolute remote URL (`https:` images are already CSP-allowed) instead of losing `src`; the reader never assigns the document base URL to a missing/empty `src` (it drops the image), eliminating the `?`-on-an-HTML-page artifact.
- **Persistence invariant**: persisted canonical article HTML references media only via absolute `http(s)` URLs or `plethora-asset://` logical URLs — never relative paths that would depend on the reader iframe's base.
- **Consistent bases across entry points**: canonical pipeline, raw-page fallback, rendered fallback, WebArticleImportDialog preview (fixes its `origin + '/'` `<base>` bug that discards the page path), and reader-side repair all use the shared base resolution; reader repair prefers `webArticle.resolvedUrl` over `canonicalUrl`.
- **Diagnostics**: article import diagnostics record the effective resource base plus absolutized/dropped/failed media counts (already persisted inside `webArticle` provenance), so future asset failures are inspectable without touching the database.
- **Explicit repair for already-broken imports**: surface the existing store-only `reimportCanonicalArticle` action as a user-visible "Re-import from source" action for eligible HTML documents. No silent rewriting of stored documents (preserves highlights, anchors, TTS positions).
- **`EXTRACTOR_VERSION` 4 → 5** for newly normalized articles.
- **Regression fixtures**: a structurally faithful current-arXiv fixture (version-prefixed figure paths; versioned and versionless document URLs), a generic fixture with canonical-URL/path mismatch, `<base href>` (safe and malicious) cases, and ingestion-failure degradation — all hermetic, no live arXiv dependency.

## Capabilities

### New Capabilities

(none — this change tightens existing import/asset/reader capabilities)

### Modified Capabilities

- `web-article-import`: Imported-resource URL resolution now follows a single effective-resource-base contract (doc `<base href>` → final URL → requested URL) across the canonical pipeline, raw fallback, rendered fallback, and import UI previews; canonical/og URLs are excluded as bases; persisted HTML must not contain relative media `src`.
- `durable-article-assets`: Asset-ingestion failures degrade to the retained absolute remote URL instead of stripping `src`; diagnostics gain resource-base and per-outcome media counts; explicit re-import remains the repair path for previously imported documents.
- `canonical-article-reader`: Reader-side base selection prefers the persisted resolved URL over the canonical URL, empty/missing image `src` never falls back to the document base URL, and an explicit re-import action is available for eligible canonical articles.

## Impact

- **Import pipeline**: `src/utils/articleImport/arxivResolver.ts` (retire `arxivHtmlAssetBase` from import paths), `importPipeline.ts`, `rawFallback.ts`, `types.ts` (diagnostics fields), `extractor-config.ts` (version bump), `articleAssetIngestor.ts` (failure degradation).
- **Legacy/reader repair**: `src/utils/documentImport.ts` (`resolveHtmlReaderBaseUrl`/`resolveDocumentHtmlBaseUrl` kind-aware precedence), `src/components/viewer/htmlReader/prepareHtmlDocument.ts` (empty-src handling), `src/components/viewer/DocumentViewer.tsx` (base passing, re-import action).
- **Import UI**: `src/components/import/WebArticleImportDialog.tsx` (preview base fix, shared utility).
- **Tests/fixtures**: `src/utils/articleImport/__tests__/` (new current-arXiv regression fixture, base-resolution unit tests, ingestor degradation tests, reader-preparation tests); existing `arxiv-html-regression` fixture updated to current markup shape.
- No database migration, no CSP change, no sanitizer allowlist expansion; existing documents are untouched except through explicit user-initiated re-import.
