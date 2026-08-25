## Context

### Confirmed current architecture

The architectural split is real and was an explicit compatibility choice in `universal-article-import-pipeline`: generic arXiv URLs were added to the canonical pipeline while the dedicated arXiv dialog was left on `importFromArxiv` for both PDF and HTML. Three current paths matter.

#### Dedicated arXiv HTML import

```text
DocumentsView
  → ArxivImportDialog.handleImport(paper)
  → useDocumentStore.importFromArxiv(paper.id, "html")
  → documentStore.importFromArxiv
  → documentImport.importFromArxiv(input, "html")
      → parseArxivInput
      → private fetchArxivMetadata (Atom API)
      → fetchUrlContent(identity.htmlUrl)
      → readDocumentFile
      → processHtmlContent(raw LaTeXML page)
  → documentsApi.createDocument
  → documentsApi.updateDocumentContent
  → documentsApi.updateDocument
  → stored fileType="html", metadata.arxivId/htmlUrl, no metadata.webArticle
  → DocumentViewer.htmlForDisplay
      → processHtmlContent again
      → generic iframe style injection
```

`src/routes/documents.tsx` and `EnhancedFilePicker` also expose `importFromArxiv`, but call it without a format and therefore take the existing PDF default. `ArxivImportDialog` is the reachable UI that explicitly exposes HTML.

This HTML branch downloads the full arXiv LaTeXML document and only applies the generic page processor. It does not invoke the arXiv extractor, competing scorer, article normalizer, DOMPurify canonical sanitizer, canonical-URL dedupe, source snapshots, `updateWebArticle`, or `WebArticleProvenance`. Its stored DOM is therefore not the canonical article representation.

#### Generic arXiv URL import

```text
WebArticleImportDialog / command-palette URL mode / toolbar URL import /
PWA or native share target
  → useDocumentStore.importFromUrl(arXiv abs or html URL)
  → normalizeArticleUrl
  → canonical/in-flight dedupe
  → importArticle
      → resolveImportSource
          → parseArxivInput
          → abs/html URL resolves to identity.htmlUrl for fetch
          → identity.absUrl is canonical; trailing-slash HTML URL is asset base
      → fetchArticleSource
      → parse + metadata
      → runExtractionChain
          → siteSpecificExtractorFor(arxiv.org)
          → extractArxivHtml
          → semantic / Defuddle / Readability candidates
      → score + select (+ rendered fallback if required)
      → normalizeArticle
          → <article class="inc-article">
          → <header>…</header>
          → <div class="inc-body">…</div>
      → sanitizeArticleHtml
  → persistWebArticleOutcome
      → createDocument
      → optional source snapshot
      → updateWebArticle(content + metadata.webArticle + canonical source URL)
      → updateDocument(tags/category/priority)
  → DocumentViewer
```

`URLType` has no arXiv-specific command-palette branch; an arXiv HTTP(S) URL is a `WebPage` and therefore uses `importFromUrl`. A shared URL received through `useShareTarget` also uses `importFromUrl`. Direct `.pdf` URLs deliberately use the legacy direct-file path and are outside this HTML change.

#### Current HTML rendering

All ordinary HTML and OCR-generated HTML share the 9,000-line `DocumentViewer.tsx` renderer. For stored HTML it chooses `metadata.articleHtml || content || loaded file content`, calls `processHtmlContent` at display time, assigns the result to an iframe `srcDoc`, and injects one large style string after load.

At HEAD, recent commits remove source `<style>`/stylesheet nodes and inline `style` attributes, identify an imported article by querying `.inc-article, .inc-body, .ltx_document, .inc-raw`, and choose a 68ch body limit. These commits partially mask the reported near-black text and viewport-wide prose, but they do not remove the split or establish a durable reader contract.

The injected stylesheet still applies this destructive reset to every HTML kind, including canonical articles:

```css
body * {
  color: inherit !important;
  background-color: transparent !important;
  font-family: inherit !important;
  font-size: inherit !important;
  font-weight: inherit !important;
  font-style: inherit !important;
  line-height: inherit !important;
  letter-spacing: inherit !important;
  text-align: inherit !important;
  text-decoration: inherit !important;
  text-transform: inherit !important;
}
```

Later rules reconstruct headings, tables, captions, code, and a few `inc-*` hooks, but do not comprehensively restore `strong`, `em`, `small`, citation markers, theorem emphasis, footnotes, or accessible MathML. Canonical and arbitrary HTML are selected by DOM sniffing inside the iframe instead of by the persisted document contract.

Theme values are read ad hoc from parent CSS variables. Links incorrectly use `primary` rather than the theme's `link` token. The callback depends on the committed `theme` object, so a live theme preview can update parent CSS variables without necessarily reinjecting iframe tokens. Transparent theme fallbacks are locally hardcoded and are not contrast-tested.

### Canonical normalization gap

`extractArxivHtml` already does useful source-specific work: it selects `article.ltx_document`, removes page chrome/title/authors, maps `.ltx_p` to `<p>`, maps section title levels to headings, and retains the remaining rich subtree. However, the following generic stages erase part of that semantic intent:

- `articleNormalizer.isLayoutWrapper` unconditionally unwraps every `span`, `div`, `section`, `article`, and `main`, including abstract, equation, theorem, footnote, and bibliography containers.
- `sanitizeArticleHtml` keeps only a small fixed set of `inc-*` class tokens; all `ltx_*` semantic hooks disappear.
- The sanitizer does not retain `id`, so safe in-document citation/footnote links can keep `href="#…"` while losing their target.
- MathML survives, but useful accessible text such as LaTeXML `alttext` is not in the attribute contract.
- The arXiv regression test currently proves only candidate title, word volume, one body phrase, chrome absence, and one image. It does not assert the final sanitized article DOM.

The result is better than raw HTML, but the current claim that equations, tables, bibliography, and other scholarly structures are preserved is under-specified and under-tested.

### Constraints

- The persisted canonical article remains sanitized semantic HTML; source CSS and source JavaScript never control presentation.
- PDF, EPUB, Markdown, browser-extension captures, raw HTML files, OCR/PDF HTML, MediaWiki imports, raw-fallback articles, highlights, extracts, TTS, search, and reading-position behavior must not regress.
- HTML reader settings currently expose only font size, line height, and font family. There is no existing HTML reader-width preference to reconcile.
- Tests must be hermetic. The existing Playwright harness supports Vite-served deterministic pages and committed screenshots.
- No second heavyweight DOM pipeline or new production dependency is needed.

## Goals / Non-Goals

**Goals:**

- Make the dedicated arXiv HTML UI and every URL-based arXiv HTML entry point invoke one canonical extraction/persistence path.
- Produce one sanitized `.inc-article` / `.inc-body` representation with stable, semantic scholarly structures.
- Give canonical articles a first-class, theme-token-driven Plethora reader rather than publisher emulation or a universal reset.
- Constrain prose to 66ch while keeping the layout fluid and preventing wide content from widening the document.
- Preserve user font size, line height, and font family controls.
- Update iframe theme tokens in place for committed changes and previews without replacing `srcDoc`, reloading content, or resetting scroll.
- Add tests that fail on the exact routing, semantic, contrast, width, overflow, emphasis, and visual regressions that escaped earlier changes.

**Non-Goals:**

- Reproduce arxiv.org or LaTeXML CSS.
- Change the arXiv PDF import contract or send PDFs through `importArticle`.
- Convert scholarly articles to Markdown/plain text or introduce an equation-rendering dependency.
- Redesign every arbitrary HTML/OCR/browser-extension reader in this change.
- Automatically re-extract or rewrite existing stored HTML bodies.
- Add a bulk migration or a new database column solely to identify canonical articles.
- Expand iframe privileges or permit source scripts, event handlers, arbitrary iframes, unsafe schemes, or source styles.

## Decisions

### D1. One store-level canonical article orchestration boundary

Introduce a private shared orchestration function (in `documentStore.ts` or a focused adjacent store helper) used by both `importFromUrl` and the HTML branch of `importFromArxiv`. It owns normalized/canonical in-flight keys, pre/post-fetch dedupe, retention sweep, `importArticle`, and `persistWebArticleOutcome`.

Conceptual flow:

```text
importFromArxiv(input, format, optionalPaperMetadata)
  → parseArxivInput(input)
  → if format === "pdf": existing PDF utility/persistence behavior
  → else:
       importCanonicalArticle(identity.absUrl, {
         sourceKind: "arxiv",
         extraTags/category/priority/metadata from optional paper metadata
       })

importFromUrl(url)
  → direct file? existing direct-file path
  → otherwise importCanonicalArticle(url, generic persistence policy)
```

For arXiv, the in-flight/dedupe key is `resolveImportSource(normalizedUrl).canonicalUrl` (the abs URL), not the raw `/abs/` versus `/html/` input. This prevents simultaneous dedicated and generic imports of the same paper from creating duplicates before the post-fetch canonical check.

`persistWebArticleOutcome` gains a typed persistence policy for additive tags, category, priority, and metadata augmentation. The policy applies only when a new document is created; surfacing an existing deduped document must not silently recategorize or rewrite it. Canonical HTML and `metadata.webArticle` always come from the pipeline outcome. Dedicated UI metadata may add `arxivId`, `arxivUrl`, `pdfUrl`, `htmlUrl`, subject categories, and research tags, but may not replace the normalized body.

`ArxivImportDialog` already owns an `ArxivPaper`; it passes the available metadata to avoid an unnecessary second Atom lookup. Non-dialog callers may resolve it through existing `getArxivPaper` on a best-effort basis. Metadata enrichment failure must not cause an otherwise valid canonical HTML import to fall back to the legacy HTML path.

**Rejected alternatives:** calling `get().importFromUrl()` and then mutating the returned document (dedupe can mutate an existing user's document); duplicating `importArticle`/persistence logic in `importFromArxiv`; or keeping the legacy HTML path as fallback (reintroduces representation drift).

### D2. Retire only the legacy arXiv HTML branch

Refactor `documentImport.importFromArxiv` into a PDF-only utility (for example `importArxivPdf`) or make its HTML branch unreachable and then remove it. Retain the metadata/download behavior needed by PDFs. The following legacy HTML steps are deleted, not deprecated indefinitely:

- fetching `identity.htmlUrl` in `documentImport.importFromArxiv`;
- reading the raw HTML into `processHtmlContent` there;
- constructing an HTML document without `metadata.webArticle`;
- persisting that HTML through `updateDocumentContent`/generic `updateDocument` in the store action.

`processHtmlContent` remains for direct HTML files, legacy content repair, browser captures, OCR-related surfaces, MediaWiki handling, WebBrowserTab, and editable HTML preview. It is not deleted as part of this change.

### D3. Make scholarly semantics canonical before the generic normalizer

The arXiv extractor converts source-specific LaTeXML into boring HTML plus a small, Plethora-owned scholarly hook vocabulary. Publisher presentation classes never pass through unchanged.

| LaTeXML source structure | Canonical result / policy |
| --- | --- |
| document title and `.ltx_authors` | Extract as header metadata, remove from body |
| page header/footer/nav/TOC/dialog/scripts/styles | Remove |
| `.ltx_p` / `.ltx_para` | `<p>`; unwrap paragraph-only wrapper |
| section/subsection/subsubsection title | `h2` / `h3` / `h4`; lower levels map through `h6` |
| `.ltx_abstract` | `<section class="inc-abstract">` with one semantic Abstract heading |
| `.ltx_equationgroup` / block `.ltx_equation` | `<div class="inc-equation-group">` / `<div class="inc-equation inc-wide">`; retain MathML and equation number text |
| inline MathML | retain inline `<math>` without a wide wrapper |
| `.ltx_theorem*` / proof | `<section class="inc-theorem">` / `<section class="inc-proof">`; retain title/emphasis and reading order |
| figure / caption / graphics | semantic `<figure>` / `<figcaption>` / normalized `<img>` |
| tabular material | semantic `<table>` inside `<div class="inc-table-wrap inc-wide">` |
| citation/reference anchors | semantic `<cite>`/`<a>` with safe fragment links |
| bibliography / bib list / bib item | `<section class="inc-bibliography">`, semantic list, `inc-reference` item hooks |
| footnotes/notes | semantic super-scripted reference and `inc-footnotes`/`inc-footnote` targets |
| lists, `strong`/`b`, `em`/`i`, `small`, `sup`, `sub`, code/pre | retain their semantic elements |
| unknown `ltx_*` presentation wrappers | unwrap if layout-only; otherwise retain semantic children and drop the class |

The canonical normalizer changes `isLayoutWrapper` so it never unwraps recognized `inc-*` scholarly structures. It may still unwrap generic presentation-only wrappers. Heading normalization still enforces one document `h1` and stable reading order.

Source IDs required by citations/footnotes are deterministically remapped to a restricted namespace such as `inc-ref-<stable-index>`; matching same-document `href` fragments are rewritten in the same pass. Arbitrary source IDs are not retained. MathML `alttext` is converted to a safe accessible name (or retained under an element-scoped allowlist) when no equivalent semantic annotation exists.

The exact hook list is centralized and shared by normalizer, sanitizer, and reader styles so a hook cannot be emitted but silently stripped.

### D4. Extend sanitization narrowly, not generically

`sanitizeArticleHtml` remains the sole persistence security boundary. Extend it only for canonical output emitted by D3:

- semantic container tags required by the mapping (for example `section`);
- the explicit new `inc-*` scholarly class tokens;
- generated safe `id` values and matching fragment URLs;
- narrowly filtered accessibility attributes such as `aria-label`/`aria-labelledby` where generated by the canonicalizer;
- MathML accessible text/attributes required by the fixture.

The DOMPurify post-hook validates class tokens, generated ID format, URL scheme, and fragment format. It continues to reject style/data/event attributes, source JavaScript, SVG, forms, iframes, objects, embeds, unsafe URLs, and arbitrary publisher classes. Source stylesheets are never re-enabled.

### D5. Identify the reader kind from the document contract

Add a testable `HtmlReaderKind` classifier outside the iframe. Its primary inputs are persisted metadata and the active viewer surface; DOM structure is a validation guard, not the sole signal.

| Kind | Authoritative signal |
| --- | --- |
| `canonical-article` | `fileType="html"` + `metadata.webArticle` + valid `.inc-article > .inc-body` structure |
| `canonical-raw-fallback` | canonical signal + extractor `raw-fallback` / `.inc-raw` |
| `legacy-arxiv` | `metadata.arxivId` and `metadata.htmlUrl` with no `metadata.webArticle` |
| `browser-capture` | `metadata.source === "browser_extension"` |
| `ocr-html` | active PDF OCR HTML view |
| `raw-html` | remaining HTML files/documents |

If provenance claims canonical content but the required structure is malformed, fail closed to `raw-html` styling and emit a diagnostic warning; do not grant source content canonical hooks based only on a spoofed class. No database migration is needed because all pipeline articles already have `metadata.webArticle` and all legacy dedicated arXiv HTML imports already have arXiv metadata.

### D6. Prepare canonical iframe documents separately

Canonical content is already sanitized at persistence. A small kind-aware preparation function wraps it in a complete HTML document, sets the canonical `<base>` URL, respects the preserve-images setting, and defensively removes any unexpected style/script/event content without running the legacy page-shaping logic. Raw and legacy reader kinds continue through `processHtmlContent`.

This keeps canonical presentation owned by the reader stylesheet and avoids repeatedly treating the canonical fragment as an arbitrary publisher page. It also makes preparation independently testable and keeps source URL resolution (including the arXiv trailing-slash asset base) explicit.

### D7. Separate canonical CSS and theme token construction from `DocumentViewer`

Create a focused module set matching current component conventions, conceptually:

```text
src/components/viewer/htmlReader/
  documentKind.ts
  readerThemeTokens.ts
  articleReaderStyles.ts
  legacyReaderStyles.ts (only if needed to isolate the existing rules)
  prepareHtmlDocument.ts
```

`DocumentViewer` retains iframe lifecycle, selection, search, scroll restoration, settings controls, and event wiring. The modules own classification, token resolution, canonical CSS, and compatibility CSS selection. This extraction is justified by testability and by the need to prevent canonical and arbitrary HTML rules from sharing one cascade; it is not a general viewer rewrite.

Canonical CSS MUST NOT contain a descendant reset that assigns inherited `font-weight`, `font-style`, font size, text decoration, or text transform to every element. It explicitly styles semantic elements. A legacy compatibility reset may remain scoped to the reader kinds that currently depend on it.

### D8. Use an explicit, contrast-checked reader token contract

Resolve parent theme values into iframe-local variables:

```css
:root {
  --reader-background: …;
  --reader-surface: …;
  --reader-muted-surface: …;
  --reader-foreground: …;
  --reader-muted-foreground: …;
  --reader-border: …;
  --reader-link: …;
  --reader-accent: …;
  --reader-focus: …;
  --reader-measure: 66ch;
}
```

The resolver consumes the applied parent CSS variables, including `--color-link`, with `Theme.colors` as fallback. It uses existing `src/themes/color.ts` parsing/compositing/contrast helpers. For translucent/transparent themes it composites a stable readable reader surface from the theme's surface/card/background and variant rather than relying on an unknown animated backdrop. Normal prose, links, small captions, and muted metadata resolve to at least WCAG AA 4.5:1 against the effective reader background; borders/non-text focus affordances target 3:1. When a custom theme token fails, the resolver moves toward the theme foreground and ultimately chooses black/white by measured contrast. Link underline/focus treatment remains visible even when hue contrast is limited.

The injected `<style id="html-viewer-styles">` is updated in place when settings, committed theme, or `previewThemeId` changes. Updating tokens/styles must not change iframe `srcDoc`, the iframe React key, DOM text, selection, or scroll position. Biolume Abyss must resolve body copy from its light foreground (`#e0f2fe` at HEAD), never source-site near-black ink.

### D9. Canonical typography and layout contract

The iframe body owns viewport padding, not prose measure:

```css
html, body { margin: 0; min-inline-size: 0; }
body { box-sizing: border-box; padding: clamp(1rem, 4vw, 2rem); }
.inc-article {
  inline-size: min(100%, var(--reader-measure, 66ch));
  margin-inline: auto;
}
```

At the default 16px serif setting, desktop prose therefore measures approximately 64–68 characters and is centered. `ch` follows the user's selected HTML font and font size. The article becomes `100%` of the available content box at narrow widths, with safe side padding. Opening the Assistant only reduces the iframe viewport; it does not introduce a conflicting fixed width. There is no existing reader-width control, so this change adds no competing setting.

The canonical stylesheet explicitly owns:

- publication, title, dek, byline, date, and header spacing;
- abstract surface and label;
- body paragraphs and h2–h6 hierarchy;
- links, visited/focus/hover states, selection, `strong`/`b`, `em`/`i`, `small`, `sup`, and `sub`;
- ordered/unordered/definition lists;
- blockquotes, inline code, `pre`, horizontal rules;
- tables/captions/header cells;
- figures/images/figcaptions;
- citations, footnotes, bibliography/reference lists;
- theorem/proof blocks;
- inline and display MathML/equations.

Suggested scale: paragraphs end with about `1.1em`; h2 is about `1.5em` with `2.1em` leading space; h3 is about `1.25em`; lower headings remain distinct. `strong`/`b` explicitly use 700, `em`/`i` italic, and captions never fall below an accessible relative size (about `0.875em`). Exact values are centralized and protected by computed-style/visual tests.

### D10. Wide content scrolls locally and never widens prose

Canonical normalization supplies wrappers for block tables/equations. The reader applies:

- `max-inline-size: 100%` to figures, images, MathML, `pre`, and tables;
- local `overflow-x: auto` and touch momentum scrolling to `.inc-wide`, `.inc-table-wrap`, block equation containers, and `pre`;
- normal inline behavior to inline MathML;
- responsive image sizing with intrinsic aspect ratio;
- overflow wrapping for long URLs and unbroken prose tokens.

The document root and iframe body must not gain horizontal scrolling. A wide table/equation may have `scrollWidth > clientWidth` inside its own wrapper, while the `.inc-article` and document remain within the viewport. A wrapper retains the table's native semantic element rather than changing the table itself into a generic block.

### D11. Existing-document policy is display-only compatibility

Do not automatically re-run old arXiv imports through `importArticle`. Those documents may already have anchors based on their current DOM/text order, and most lack a canonical raw-source snapshot. `metadata.htmlUrl` makes a future explicit reimport possible, but not safe to run invisibly.

`legacy-arxiv` receives a scoped compatibility stylesheet that preserves its stored DOM/text order while ensuring theme foreground, readable measure, responsive media, semantic bold/italic/sup/sub, and local overflow for known LaTeXML wide blocks. It may continue to hide already-hidden arXiv chrome. It is not relabeled as canonical and does not acquire `metadata.webArticle` at display time.

### D12. Accessibility and security remain first-class

- Keep semantic headings, lists, tables, captions, figures, citations, and MathML in the persisted DOM.
- Keep title hierarchy at one h1, then normalized lower levels without skipping levels where the source provides enough information.
- Links remain underlined, keyboard reachable, and visibly focused; local scroll regions are keyboard reachable only when they actually overflow and have an accessible label, avoiding gratuitous tab stops.
- Text selection, search marks, highlights, and existing viewer keyboard listeners remain functional in the same same-origin sandboxed `srcDoc` iframe.
- User zoom/font-size/line-height/family controls continue to work, and layout remains readable at 200% zoom.
- The canonical iframe does not require publisher scripts. This change does not add sandbox permissions; implementation should remove `allow-scripts` for canonical content if viewer-owned iframe scripts are confirmed unnecessary, but must not broaden the shared sandbox as part of this scope.

### D13. Deterministic regression strategy

1. **Extractor/final DOM fixture** — expand `arxiv-html-regression/page.html` with multiple heading levels, abstract, strong/emphasis, lists, theorem/proof, inline and block MathML, numbered equation/reference, wide table, figure/caption, citations, footnotes, bibliography, sup/sub. Assert page chrome/title/author duplicates are removed and the final sanitized output retains semantic elements, generated hooks, safe fragment targets, MathML accessibility, and no style/script/event/publisher-class leakage.
2. **Import parity** — store tests invoke dedicated HTML and generic `/abs/` or `/html/` routes against the same mocked outcome/fixture. Assert both call the shared canonical helper/`importArticle`, persist `.inc-article`/`.inc-body`, have equivalent body text and heading sequence, dedupe to the same canonical abs URL, and never call the legacy HTML utility. Assert PDF still calls the PDF path.
3. **Renderer units** — test `HtmlReaderKind`, theme token resolution (all built-in variants plus transparent/custom fixtures), canonical style output, and preparation. Assert 4.5:1 text contrast, theme link token use, explicit strong/em/sup/sub rules, 66ch measure, local overflow rules, and absence of the destructive canonical reset.
4. **Computed-style integration** — a deterministic Vite-served reader harness mounts production canonical CSS and the scholarly fixture in an iframe. Assert computed foreground/background/link/muted colors, bold weight, heading scale, article geometry, local wide overflow, no root horizontal overflow, figure containment, keyboard focus, and in-place theme updates.
5. **Visual regression** — add Playwright screenshots for Biolume Abyss desktop, a light desktop theme, dark with Assistant-equivalent reduced reader width, and a tablet/narrow viewport. Screenshot the deterministic reader fixture, not the full backend-dependent application.
6. **Theme switch** — record iframe DOM identity/text, scroll position, and computed tokens; switch committed theme and preview; assert token changes without iframe navigation, body replacement, content loss, or material scroll reset.
7. **Non-regression** — retain/add focused tests proving browser captures, raw HTML, MediaWiki, OCR HTML, PDF-generated `.page` HTML, and raw fallback are classified away from canonical rules and keep their compatibility styles.
8. **Validation** — targeted Vitest, `npm run test:visual`, `npx tsc --noEmit`, `npm run build:check`, `npm run bench:check`, and existing script tests when affected. No performance baseline changes are expected; any intentional change follows the repository gate protocol.

## Risks / Trade-offs

- **[Canonicalizing more scholarly wrappers changes new-import DOM shape]** → Bump `EXTRACTOR_VERSION` from 2 to 3, apply only to future imports, preserve text order, and never rewrite old bodies automatically.
- **[Equation numbering or citation targets are lost while classes are stripped]** → Perform deterministic semantic mapping and fragment remapping before generic normalization; assert final sanitized links and targets, not extractor intermediates.
- **[A wider sanitizer allowlist creates an injection path]** → Admit only generated class/id/ARIA patterns, keep DOMPurify as the final boundary, and extend the XSS/URL/attribute-smuggling suite.
- **[The arXiv site extractor loses to a generic candidate]** → Keep score-based selection, but enrich the fixture and scorer assertions so the structurally complete site candidate wins for representative LaTeXML; do not bypass scoring by domain fiat.
- **[Generic articles accidentally receive scholarly rules]** → Require both provenance and canonical structure; fail closed to compatibility styling on a mismatch.
- **[Removing the broad reset regresses browser/OCR/raw HTML]** → Remove it only from canonical CSS. Preserve and test a separately scoped compatibility stylesheet for those kinds.
- **[Theme changes reload or jump the iframe]** → Update a stable style element in place; never include theme/settings in `srcDoc` or iframe key; integration-test scroll and DOM identity.
- **[Custom or glass themes yield low contrast]** → Composite the effective background and resolve contrast with existing color math, with measured foreground fallbacks.
- **[Dedicated and generic imports race]** → Compute the arXiv canonical abs URL before in-flight registration so both entry points share one promise/key.
- **[Visual tests become brittle]** → Use a local font stack, local fixture assets, disabled animation, a dedicated harness, geometry assertions, and the existing 2% screenshot threshold.

## Rejected Approaches

- **Force a light foreground with a global `!important` rule.** This can hide the dark-theme symptom while flattening semantic emphasis, captions, code, MathML, and other reader kinds.
- **Accumulate more arXiv/LaTeXML selectors in `DocumentViewer.tsx`.** Publisher vocabulary belongs at the extraction boundary; the reader styles only Plethora-owned canonical semantics.
- **Keep a dedicated canonical-looking arXiv importer beside the URL pipeline.** Two persistence/orchestration implementations will drift even if both happen to emit `.inc-article` today.
- **Reproduce arxiv.org CSS or retain source widths/colors.** The product contract is a Plethora reader, not a website renderer.
- **Use an 850px or other pixel-only prose maximum.** Prose measure is character-based and responsive; wide scholarly blocks receive local overflow.
- **Strip every `ltx_*` class before semantic conversion.** Some source classes identify equations, theorems, citations, references, and footnotes, so they are mapped before presentation classes are discarded.
- **Flatten the result to text or Markdown.** That would discard rich structure required for equations, figures, tables, citations, footnotes, and accessibility.
- **Display-time re-extract every stored legacy article.** Silent DOM/text changes can invalidate user anchors and reading state; compatibility is display-only.

## Migration Plan

1. Land the semantic fixture and failing extractor/sanitizer tests.
2. Implement scholarly canonicalization and bump `EXTRACTOR_VERSION` to 3.
3. Add the shared canonical store orchestration and switch dedicated HTML imports; remove the legacy HTML branch while retaining PDF behavior.
4. Introduce reader-kind classification, token/style modules, and canonical preparation; keep compatibility styling for other kinds.
5. Add computed-style and visual regressions, then run all validation gates.
6. Ship with no data migration. New imports are canonical; existing legacy arXiv HTML remains display-compatible and unchanged.

Rollback is code-only for routing and styling. Documents already imported through the new path remain valid sanitized canonical articles and continue to render through the existing `.inc-article` fallback if the change is reverted. Do not downgrade or rewrite their stored content during rollback.

## Open Questions

There are no unresolved product or architectural choices. Implementation must still verify three evidence items against real platform output: the exact LaTeXML variants used for theorem/proof/footnote/equation-number structures in at least one current arXiv page; MathML/local-overflow behavior in WKWebView/WebView2/WebKitGTK; and whether any viewer-owned behavior actually requires `allow-scripts` for the canonical iframe. Those checks may refine selector coverage, CSS details, or allow removal of an unnecessary permission, but must not change the canonical hooks, source-style policy, security boundary, or single-pipeline decision and must never broaden the sandbox.
