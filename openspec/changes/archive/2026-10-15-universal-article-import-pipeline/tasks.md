## 1. Implementation

- [x] 1.1 Add `arxivResolver.ts` with identity parsing and fetch URL rewriting
- [x] 1.2 Implement arXiv LaTeXML site adapter (`engines/site-specific/arxiv.ts`)
- [x] 1.3 Register `arxiv.org` in site-specific registry
- [x] 1.4 Add semantic-DOM extractor candidate
- [x] 1.5 Integrate source resolution + emergency static acceptance in `importPipeline.ts`
- [x] 1.6 Bump `EXTRACTOR_VERSION` and emergency thresholds in `extractor-config.ts`
- [x] 1.7 Extend `documentImport` arXiv ID parsing for `/html/` URLs
- [x] 1.8 Add `inc-article` reader styles in `DocumentViewer.tsx`

## 2. Testing

- [x] 2.1 Add `arxiv-html-regression` fixture for `2410.07524v1`
- [x] 2.2 Add `static-usable-render-fails` emergency degradation fixture
- [x] 2.3 Add `arxivResolver.test.ts`
- [x] 2.4 Update `renderedFallback.test.ts` for emergency acceptance
- [x] 2.5 Extend fixture corpus required categories

## 3. Validation

- [x] 3.1 Run article import unit/fixture tests
- [x] 3.2 Run typecheck on changed surfaces
- [x] 3.3 Run `npm run bench:check` (update baselines if intentional regression)
