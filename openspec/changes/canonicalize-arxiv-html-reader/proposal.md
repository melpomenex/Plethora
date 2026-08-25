## Why

Plethora has a canonical article pipeline that can extract arXiv LaTeXML into `<article class="inc-article">`, but the dedicated arXiv **HTML** importer intentionally bypasses it and persists a generically processed copy of the source page. Recent viewer-only fixes force a dark-theme foreground and a 68ch limit, but they leave two import representations and depend on a destructive iframe-wide typography reset that flattens scholarly semantics and is not protected by rendering or import-parity tests.

## What Changes

- Route every dedicated arXiv HTML import through the existing `importArticle()` extraction, normalization, sanitization, deduplication, and web-article persistence flow; keep the existing arXiv PDF download behavior unchanged.
- Retire the HTML branch of the legacy `documentImport.importFromArxiv()` path instead of maintaining a second arXiv HTML implementation. Dedicated imports may add research category/tags and arXiv metadata, but their canonical title/body/section structure must match generic URL imports of the same paper.
- Harden the arXiv extractor and canonical normalizer so abstract, section hierarchy, equations/MathML, theorem-like blocks, figures/captions, tables, citations, footnotes, bibliography links, lists, emphasis, and super/subscripts survive as safe semantic HTML. Presentation-only LaTeXML classes and all publisher CSS remain excluded.
- Formalize a canonical article rendering contract identified primarily by persisted `metadata.webArticle` provenance and validated by the `.inc-article` / `.inc-body` structure. Raw HTML, browser captures, OCR/PDF HTML, and legacy arXiv HTML remain separate reader kinds and do not accidentally inherit canonical rules.
- Extract canonical reader token/style construction from `DocumentViewer.tsx`. Canonical articles receive explicit, contrast-checked reader tokens, deliberate semantic typography, a 66ch prose measure, responsive padding, local overflow for wide scholarly content, visible links/focus, and live theme updates without iframe reload or scroll reset.
- Stop applying `font-size`, `font-weight`, `font-style`, text decoration, and related `inherit !important` resets to canonical article descendants. Retain a compatibility stylesheet for non-canonical HTML modes until their independent contracts can be changed safely.
- Add deterministic extractor, sanitizer, store-level parity, renderer/computed-style, width/overflow, theme-switch, and Playwright visual regressions using an expanded local arXiv fixture. No live arxiv.org dependency is introduced.

## Scope and Non-Goals

This change owns future arXiv HTML routing, scholarly normalization, and canonical article presentation. It does not reproduce arxiv.org styling, convert scholarly HTML to plain text or Markdown, reroute arXiv PDFs, redesign arbitrary HTML/OCR/browser-extension readers, weaken iframe/sanitizer security, or automatically rewrite stored article bodies.

Existing legacy arXiv HTML documents are detected from `metadata.arxivId` / `metadata.htmlUrl` when `metadata.webArticle` is absent and receive the existing best-effort theme/readable-width compatibility treatment. They are not silently re-extracted because changing persisted DOM/text order could invalidate highlights, text anchors, TTS positions, extracts, search locations, and reading position. A destructive bulk migration is out of scope; an explicit future reprocess action may use `htmlUrl` or a raw-source snapshot.

## User Impact and Compatibility

Future arXiv HTML imports will read as Plethora-native scholarly articles in light, dark, glass, wide, and narrow layouts, independent of import entry point. Existing canonical articles keep their persisted representation, existing legacy arXiv HTML remains readable without data migration, arXiv PDF behavior is unchanged, and non-canonical HTML readers retain separately scoped compatibility styling.

## Capabilities

### New Capabilities

- `scholarly-article-normalization`: Converts arXiv LaTeXML presentation markup into safe canonical scholarly semantics while preserving rich academic structures and intra-document references.
- `canonical-article-reader`: Defines canonical article identification, theme-token propagation, semantic typography, readable measure, responsive/wide-content behavior, accessibility, and isolation from other HTML reader kinds.

### Modified Capabilities

- `web-article-import`: Requires the dedicated arXiv HTML importer and generic arXiv URL importer to share one canonical pipeline, persisted representation, deduplication boundary, and body structure.
- `article-sanitization`: Extends the safe canonical allowlist/remapping contract for scholarly structures, fragment targets, and accessible MathML without admitting publisher styles, scripts, unsafe URLs, or arbitrary classes.

## Impact

- Import orchestration and persistence: `src/stores/documentStore.ts`, `src/utils/documentImport.ts`, `src/api/arxiv.ts`, `src/components/import/ArxivImportDialog.tsx`, and store/import tests.
- Canonical extraction and security: `src/utils/articleImport/engines/site-specific/arxiv.ts`, `articleNormalizer.ts`, `sanitizer.ts`, related types/config, fixtures, and unit tests.
- Reader presentation: `src/components/viewer/DocumentViewer.tsx`, a focused `src/components/viewer/htmlReader/` module set, theme/color utilities, HTML settings integration, and renderer tests.
- Visual coverage: a deterministic scholarly reader harness/fixture under the existing `src/visual` and Vite-served harness infrastructure, with committed Playwright baselines.
- No database migration or new production dependency is required. `WebArticleProvenance.extractionVersion` must be bumped for newly normalized scholarly articles; existing records remain readable and unchanged.
