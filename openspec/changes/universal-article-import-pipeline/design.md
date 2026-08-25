## Context

`overhaul-web-article-import` established `importArticle()` as the canonical web-article pipeline. This change extends it with source classification and structured adapters without forking entry points or replacing Defuddle/Readability scoring.

## Goals

1. **Source resolution** — classify URLs (generic vs arXiv) and rewrite fetch/canonical/asset bases before fetch.
2. **Structured adapters** — site-specific extractors return `ExtractionCandidate` and compete on score.
3. **Generic extraction** — Defuddle + Readability + new semantic-DOM candidate, unchanged selection model.
4. **Rendered fallback degradation** — emergency static acceptance when capture fails but static content is readable.
5. **Regression** — offline fixture for `https://arxiv.org/html/2410.07524v1`.

## Architecture

```text
importArticle(url)
  → normalizeArticleUrl
  → resolveImportSource (classification + fetchUrl + assetBaseUrl)
  → fetchArticleSource
  → metadata
  → extraction chain:
       site-specific (arxiv.org)
       semantic DOM
       Defuddle
       Readability
  → score / select
  → rendered fallback (if needed)
  → emergency static accept (if capture fails + usable static)
  → normalizeArticle (inc-article)
  → sanitize
  → diagnostics + warnings
```

### Source adapters (`engines/site-specific/`)

- Registry keyed by domain suffix.
- arXiv adapter targets `article.ltx_document`, strips arXiv chrome, preserves LaTeXML semantics (sections, math, figures, tables, bibliography).
- Adapters never bypass sanitization.

### arXiv identity (`arxivResolver.ts`)

| Input | Fetch URL | Asset base | Canonical |
|-------|-----------|------------|-----------|
| `/html/2410.07524v1` | same | `.../v1/` | `/abs/2410.07524v1` |
| `/abs/2410.07524` | `/html/2410.07524` | `.../2410.07524/` | `/abs/2410.07524` |
| bare `2410.07524v1` | `/html/2410.07524v1` | trailing slash | `/abs/2410.07524v1` |
| `/pdf/*.pdf` | unchanged (legacy direct-file path in store) | — | abs URL |

### Semantic fallback (`engines/semanticExtractor.ts`)

Deterministic probes: `article`, `main article`, `main`, JSON-LD `articleBody`. Engine id: `semantic`. Competes on score only.

### Rendered fallback degradation

| Threshold | Words | Score | When |
|-----------|-------|-------|------|
| Normal | ≥ 120 | ≥ 35 | Default acceptance |
| Emergency | ≥ 80 | ≥ 25 | After render attempt fails/unavailable |

Emergency imports attach `importWarnings` diagnostics; users see non-blocking warnings instead of hard failure.

### Rendering

`DocumentViewer` injects `inc-article` styles: publication line, title/dek/byline, responsive figures/tables, math overflow scroll. No publisher CSS retained post-sanitization.

### Security

All adapter output passes through existing DOMPurify allowlist (including MathML). No new privileged WebView paths.

### Diagnostics

`sourceClassification`, `importWarnings`, existing candidate/render fields unchanged and additive.

## Non-Goals

- Browser extension Rust Readability path unification (separate transport stack).
- arXiv PDF import via article pipeline (remains legacy/`importFromArxiv`).
- LLM-assisted extraction.

## Compatibility

- `EXTRACTOR_VERSION` bumped to 2.
- Existing documents/highlights/TTS unaffected.
- Dedicated ArxivImportDialog keeps `importFromArxiv`; share/palette URL imports use extended resolver.

## Testing

- Fixture: `arxiv-html-regression` (2410.07524v1 structure).
- Fixture: `static-usable-render-fails` (emergency degradation).
- Unit: `arxivResolver.test.ts`.
- Updated `renderedFallback.test.ts` and fixture corpus gate.
