## 1. Source resolution

- **WHEN** a user imports `https://arxiv.org/html/2410.07524v1` from any web-article entry point
- **THEN** `resolveImportSource` classifies the URL as `arxiv`, fetches structured HTML, sets asset base `https://arxiv.org/html/2410.07524v1/`, and canonical `https://arxiv.org/abs/2410.07524v1`.

- **WHEN** a user imports an `/abs/` arXiv URL
- **THEN** the pipeline fetches the corresponding `/html/` representation instead of the abstract chrome page.

## 2. Structured extraction

- **WHEN** fetched HTML contains `article.ltx_document`
- **THEN** the `site:arxiv.org` adapter produces a candidate preserving title, authors, abstract, sections, math, figures, tables, and references.

- **WHEN** multiple extractors run on arXiv HTML
- **THEN** selection is by score; the arXiv adapter wins when it captures substantially more structure than generic engines.

## 3. Generic extraction

- **WHEN** importing a non-arXiv article
- **THEN** Defuddle and Readability still run on independent clones and compete with the semantic-DOM candidate via `selectBestCandidate`.

## 4. Rendered fallback degradation

- **WHEN** rendered capture fails or is unavailable AND the best static candidate has ≥ 80 words and score ≥ 25
- **THEN** the pipeline imports the static candidate with `importWarnings` instead of `rendered_failed` / `rendered_unavailable`.

- **WHEN** rendered capture fails AND no static candidate meets the emergency floor
- **THEN** the pipeline fails typed as before.

## 5. Security

- **WHEN** arXiv or semantic adapter output is normalized
- **THEN** it passes through `sanitizeArticleHtml` with no script/inline-handler survivors.

## 6. Presentation

- **WHEN** an imported article uses `inc-article` markup
- **THEN** the HTML viewer applies Plethora-native typography, responsive figures/tables, and math overflow handling.

## 7. Regression

- **WHEN** CI runs the fixture corpus
- **THEN** `arxiv-html-regression` passes with extractor `site:arxiv.org` and without arXiv chrome phrases.
