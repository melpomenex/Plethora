## 1. Lock Down Fixtures and Shared Contracts

- [x] 1.1 Expand the deterministic arXiv LaTeXML fixture under `src/utils/articleImport/__tests__/fixtures/arxiv-html-regression/` with an abstract, h2–h4 hierarchy, strong/emphasis, nested and definition lists, theorem/proof, inline and numbered block MathML, wide table with caption/headers, figure/caption, citations, bidirectional footnotes, bibliography, sup/sub, publisher CSS, and active-content attack cases; keep all assets local and deterministic.
- [x] 1.2 Add a centralized scholarly hook/generated-ID contract in `src/utils/articleImport/` covering every `inc-*` class, `inc-ref-*` identifier, and scoped accessibility attribute emitted, sanitized, and styled; export types or predicates that make unrecognized hooks fail closed.
- [x] 1.3 Extend the article-import test helpers so the expanded fixture can be run through source extraction, generic normalization, and final `sanitizeArticleHtml`, and so tests can compare final text order and heading sequences without relying on live arxiv.org.

## 2. Unify arXiv HTML Import Orchestration

- [x] 2.1 Extract the canonical/in-flight dedupe, retention, `importArticle`, and `persistWebArticleOutcome` work in `src/stores/documentStore.ts` into one private canonical-article orchestration that accepts a typed new-document-only persistence policy.
- [x] 2.2 Make the orchestration resolve an arXiv canonical abs URL before registering its in-flight key, retain the existing post-fetch canonical check, and ensure concurrent `/abs/`, `/html/`, and dedicated identifier imports share one promise and create at most one document/snapshot.
- [x] 2.3 Route `importFromUrl` through the shared orchestration after its existing direct-file decision, preserving non-arXiv URL behavior and raw-fallback provenance.
- [x] 2.4 Route only the HTML case of `documentStore.importFromArxiv` through the shared orchestration, applying optional research category/tags/priority and safe arXiv metadata only when a new document is created; never mutate an existing deduped document.
- [x] 2.5 Update `ArxivImportDialog.tsx` and store action types to pass its already-fetched `ArxivPaper` for metadata enrichment, and make non-dialog metadata lookup best-effort so enrichment failure cannot select a legacy HTML fallback.
- [x] 2.6 Refactor `src/utils/documentImport.ts` to expose the legacy arXiv utility as PDF-only, remove its HTML download/`processHtmlContent`/HTML-document construction branch, and preserve existing default-format and direct-PDF behavior.
- [x] 2.7 Bump the canonical article extraction version for newly imported articles and confirm `updateWebArticle` remains the only persistence path for new arXiv HTML canonical bodies and `metadata.webArticle` provenance.
- [x] 2.8 Add store-level tests for dedicated/generic clean-store parity, dialog metadata enrichment, no mutation on dedupe, `/abs/`–`/html/` concurrency, failure cleanup, invalid input, absence of legacy HTML utility calls, and unchanged PDF routing.

## 3. Normalize Scholarly Semantics

- [x] 3.1 Extend `engines/site-specific/arxiv.ts` to remove arXiv chrome and duplicate source title/authors while mapping abstract, section levels, paragraphs, equations, theorem/proof, figures, tables, bibliography, citations, footnotes, lists, and inline semantics to semantic HTML plus only the centralized Plethora hooks.
- [x] 3.2 Add deterministic source-ID collection/remapping before generic normalization so retained citation, bibliography, footnote, and return links use matching restricted generated fragment identifiers independent of source identifier spelling.
- [x] 3.3 Preserve inline versus display MathML, equation numbering, and reading order, and convert LaTeXML equation alternative text into the approved accessible representation without copying source-only attributes generically.
- [x] 3.4 Update `articleNormalizer.ts` so recognized scholarly containers are never treated as disposable layout wrappers, while unknown presentation-only wrappers are unwrapped without changing safe descendant order.
- [x] 3.5 Ensure the arXiv site-specific candidate remains structurally complete and wins normal score-based selection for the representative fixture without adding a domain-forced bypass.
- [x] 3.6 Add final-DOM tests asserting one title/byline, one `h1`, h2–h4 hierarchy, one abstract label, semantic figures/tables/theorems/lists, visible emphasis/sup/sub, MathML accessibility, matching citation/footnote targets, resolved figure assets, stable text order, and removal of publisher chrome/classes.

## 4. Harden Canonical Sanitization

- [x] 4.1 Extend `sanitizer.ts` only with semantic tags, centralized scholarly hooks, restricted generated IDs/fragments, and element-scoped accessibility attributes required by canonical output; do not add a generic `id`, class, ARIA, or attribute pass-through.
- [x] 4.2 Add post-sanitization validation for generated target/link pairs so removed or malformed targets cannot leave a trusted fragment relationship, while retaining safe visible text and recording a normalization warning.
- [x] 4.3 Expand sanitizer security tests with publisher classes, arbitrary IDs/fragments/ARIA references, CSS, style attributes, scripts, handlers, SVG/forms/iframes/objects/embeds, and unsafe URL/data schemes mixed into otherwise valid scholarly markup.
- [x] 4.4 Assert all scholarly preservation and security properties against final sanitized/persisted-shape HTML rather than only the arXiv extractor candidate.

## 5. Establish the Canonical HTML Reader Boundary

- [x] 5.1 Create `src/components/viewer/htmlReader/documentKind.ts` with a pure `HtmlReaderKind` classifier for canonical article, canonical raw fallback, legacy arXiv, browser capture, OCR HTML, and raw HTML; require provenance plus validated structure for canonical classification and expose mismatch diagnostics.
- [x] 5.2 Create `prepareHtmlDocument.ts` to wrap canonical fragments with an explicit canonical base URL and image policy, defensively strip unexpected active/presentation content, and leave canonical DOM/text order intact; route legacy/raw kinds through the existing `processHtmlContent` compatibility path.
- [x] 5.3 Extract the current non-canonical iframe rules into a reader-kind-scoped compatibility stylesheet, retaining required browser/OCR/raw/MediaWiki behavior while preventing those rules from entering the canonical cascade.
- [x] 5.4 Integrate kind classification and preparation into `DocumentViewer.tsx` without changing selection, search, highlights, extracts, TTS, keyboard handlers, scroll restoration, editable preview, PDF OCR, or other document renderers; verify whether canonical content needs `allow-scripts`, remove it only if viewer-owned behavior does not, and never broaden the sandbox.
- [x] 5.5 Add classifier/preparation unit tests for valid canonical provenance, spoofed classes, malformed canonical structure, raw fallback, legacy arXiv, browser capture, OCR, MediaWiki/raw HTML, canonical base/image handling, and DOM/text preservation.

## 6. Build the Token-Driven Canonical Reader

- [x] 6.1 Create `readerThemeTokens.ts` using `src/themes/color.ts` parsing, compositing, and contrast helpers to resolve background/surfaces/foreground/muted/border/link/accent/focus tokens from applied CSS variables and theme fallback values, including transparent/custom theme handling.
- [x] 6.2 Enforce measured 4.5:1 contrast for body, link, caption, and muted text and 3:1 for focus/non-text affordances, prefer the theme link token over primary, and add unit coverage for every built-in theme variant plus low-contrast translucent fixtures and Biolume Abyss.
- [x] 6.3 Create `articleReaderStyles.ts` with a 66ch centered article measure, responsive body padding, user-controlled font size/family/line height, semantic heading/body/abstract/theorem/figure/table/citation/footnote/bibliography/MathML rules, visible link/focus/selection states, explicit bold/italic/small/sup/sub behavior, and no destructive descendant typography reset.
- [x] 6.4 Add local overflow rules for `inc-wide`, table wrappers, block equations, and `pre`; constrain images/figures/tables/MathML; retain inline math flow; wrap long tokens; guarantee article/body/root widths cannot be expanded by scholarly content; and make only actually overflowing regions keyboard-focusable with an accessible label.
- [x] 6.5 Update `DocumentViewer.tsx` to maintain one stable `#html-viewer-styles` element and refresh its tokens/rules in place for HTML settings, committed theme, and `previewThemeId` changes without changing `srcDoc`, iframe key, article nodes, selection, or scroll.
- [x] 6.6 Implement the scoped legacy-arXiv compatibility rules for foreground, readable measure, media, emphasis/sup/sub, and known LaTeXML wide blocks without modifying stored content or adding canonical provenance.

## 7. Verify Rendering and Non-Regression

- [x] 7.1 Add a deterministic Vite-served scholarly reader harness under `src/visual/` that mounts the production classifier, canonical preparation, token resolver, stylesheet, and expanded local fixture in the same iframe shape used by the viewer.
- [x] 7.2 Add computed-style browser assertions for effective background/foreground/link/muted contrast, theme link-token selection, bold/italic semantics, h2–h4 scale, figure containment/caption readability, 66ch desktop geometry, responsive narrow geometry, 200-percent zoom, visible keyboard focus, and absence of root horizontal overflow.
- [x] 7.3 Add local-overflow assertions proving an oversized equation and table each have `scrollWidth > clientWidth` in their own wrapper while the article, body, and document element remain within the viewport and the table remains semantic.
- [x] 7.4 Add committed Playwright screenshots for Biolume Abyss desktop, a light desktop theme, dark Assistant-equivalent reduced width, and tablet/narrow width; mask or eliminate all nondeterminism and review baselines for semantic hierarchy and figure/equation/table behavior.
- [x] 7.5 Add a theme-switch integration test that records iframe document/article identity, text, selection-safe DOM, and scroll; switches committed theme and preview theme; and proves token changes occur in place without navigation, replacement, content loss, or material scroll reset.
- [x] 7.6 Add focused non-regression tests proving raw fallback, browser capture, raw HTML, MediaWiki, OCR HTML, and PDF-generated `.page` HTML remain on compatibility rules, and that a legacy arXiv document is rendered readably without content/metadata/highlight-anchor writes.

## 8. Run Repository Gates and Audit the Contract

- [x] 8.1 Run the targeted article-import, sanitizer, store, theme-token, classifier, preparation, and computed-style test suites and resolve every failure without weakening the spec assertions.
- [ ] 8.2 Run `npm run test:visual`, inspect all four scholarly reader baselines at their actual sizes, and confirm no unrelated snapshot changes.
- [ ] 8.3 Run `npx tsc --noEmit`, `npm run build:check`, `npm run test:scripts`, and `npm run bench:check`; do not update performance or bundle baselines unless the change is intentional and documented under the repository gate protocol.
- [x] 8.4 Audit the final diff against every scenario in the four delta specs, confirm the arXiv PDF path and existing stored bodies are unchanged, and record any intentionally deferred canonical-reprocess or non-canonical-reader work as a separate future change rather than expanding this one.
