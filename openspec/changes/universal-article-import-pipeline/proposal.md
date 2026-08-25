## Why

Plethora's web article import pipeline (`overhaul-web-article-import`) handles generic pages well, but structured scholarly sources—especially arXiv HTML—and low-confidence static extractions still fail typed when rendered-page fallback is unavailable. The regression URL `https://arxiv.org/html/2410.07524v1` hits generic Defuddle/Readability + rendered capture instead of deterministic LaTeXML extraction, producing "could not be rendered for extraction." This change extends the existing canonical pipeline rather than replacing it.

## What Changes

- Add **source classification** and a **structured adapter interface** on top of the existing `importArticle()` pipeline.
- Implement a first-class **arXiv HTML adapter** (LaTeXML `.ltx_document`) with URL normalization for `/abs/`, `/html/`, `/pdf/`, bare IDs, and versioned IDs.
- Add a **semantic DOM fallback candidate** (`<article>`, `<main>`, JSON-LD `articleBody`) competing in the existing scorer.
- Change **rendered-fallback failure semantics**: when static extraction is emergency-usable, import with diagnostics instead of hard-failing on `rendered_failed` / `rendered_unavailable`.
- Unify **arXiv URL routing** so share sheet, command palette, and Import URL converge on `importArticle()` with source resolution (dedicated Arxiv dialog keeps `importFromArxiv` for explicit PDF/HTML picker flows).
- Extend **Plethora-native article reader styles** for `inc-article` imports (figures, tables, math, captions, responsive layout).
- Add a **deterministic regression fixture** for arXiv HTML `2410.07524v1` and static-usable + render-fails cases.
- Bump `EXTRACTOR_VERSION` to 2.

## Capabilities

### New Capabilities

- `source-adapters`: Source classification, arXiv identity normalization, structured adapter contract, fetch URL rewriting (`abs` → `html`).
- `semantic-fallback-extraction`: Generic semantic-DOM candidate in the scorer pool.
- `rendered-fallback-degradation`: Emergency usability thresholds when rendered capture fails.
- `article-reader-presentation`: Plethora-native `inc-article` styling in the HTML viewer.
- `arxiv-html-regression`: Fixture corpus and assertions for arXiv HTML imports.

### Modified Capabilities

- `web-article-import`: Extends the canonical pipeline with source adapters and graceful rendered-fallback degradation (delta in `specs/web-article-import/spec.md`).

## Impact

- `src/utils/articleImport/` — resolver, arXiv adapter, semantic extractor, pipeline, config, types, diagnostics.
- `src/stores/documentStore.ts` — arXiv `/html/` ID extraction parity (via shared resolver).
- `src/utils/documentImport.ts` — `/html/` URL parsing for Arxiv picker validation.
- `src/components/viewer/DocumentViewer.tsx` — `inc-article` reader CSS.
- Fixture corpus under `src/utils/articleImport/__tests__/fixtures/`.
- `EXTRACTOR_VERSION` bump affects persisted `webArticle` provenance only (additive).
