## ADDED Requirements

### Requirement: Persisted contract identifies the reader kind
The viewer SHALL classify HTML before preparing its iframe. A `canonical-article` SHALL require HTML file type, persisted `metadata.webArticle` provenance, and valid `.inc-article > .inc-body` structure. Canonical raw fallback, legacy arXiv, browser capture, OCR HTML, and remaining raw HTML SHALL be distinct reader kinds. Source content MUST NOT opt into canonical styling using class names alone.

#### Scenario: Valid persisted article uses the canonical reader
- **WHEN** an HTML document has `metadata.webArticle` and a valid canonical article/body structure
- **THEN** it is prepared and styled as `canonical-article`

#### Scenario: Spoofed or malformed canonical markup fails closed
- **WHEN** raw HTML contains `.inc-article` classes without provenance, or provenance exists without the required structure
- **THEN** the viewer selects a non-canonical compatibility kind and emits a diagnostic for the provenance/structure mismatch

#### Scenario: Other HTML surfaces remain isolated
- **WHEN** the viewer renders a browser-extension capture, OCR HTML, canonical raw fallback, legacy arXiv HTML, MediaWiki-derived HTML, or an ordinary HTML file
- **THEN** that document does not receive canonical scholarly presentation rules unless its explicit reader-kind contract calls for them

### Requirement: Canonical documents are prepared without legacy reshaping
The canonical reader SHALL wrap already-sanitized canonical content in a complete iframe document, apply the canonical base URL and image preference, and defensively remove unexpected active or presentation content without running the legacy page-shaping transformation. Legacy and raw kinds SHALL retain their separately scoped compatibility preparation.

#### Scenario: Canonical HTML is not reprocessed as a publisher page
- **WHEN** a persisted canonical article is opened
- **THEN** its semantic body and text order reach the iframe unchanged except for document wrapping, base/image policy, and defensive sanitization
- **AND** no source stylesheet or inline source style controls its presentation

### Requirement: Theme tokens are explicit and contrast checked
The canonical reader SHALL resolve iframe-local background, surface, muted surface, foreground, muted foreground, border, link, accent, focus, and measure tokens from the currently applied Plethora theme. It SHALL use the theme's link token rather than substituting its primary token. Normal text, links, captions, and muted text MUST have a measured contrast ratio of at least 4.5:1 against their effective background; focus and non-text boundaries MUST target at least 3:1. Translucent colors SHALL be composited against a stable reader surface before contrast is measured.

#### Scenario: Biolume Abyss remains readable
- **WHEN** the canonical fixture is rendered with Biolume Abyss
- **THEN** its effective body foreground derives from the theme's light foreground rather than source near-black ink
- **AND** computed body, link, caption, and muted-text colors each meet 4.5:1 contrast against their effective background

#### Scenario: Low-contrast custom theme receives a safe fallback
- **WHEN** a custom or translucent theme supplies text or link tokens below the required contrast
- **THEN** the token resolver chooses a theme-consistent higher-contrast value and ultimately black or white when needed
- **AND** the resolved values satisfy the applicable measured contrast thresholds

### Requirement: Theme and setting updates preserve iframe state
The viewer SHALL update a stable canonical style element in place when HTML font size, line height, font family, committed theme, or preview theme changes. These updates MUST NOT replace `srcDoc`, change the iframe key, replace the article DOM, corrupt text or selection, or materially reset scroll position.

#### Scenario: Committed theme changes in place
- **WHEN** a scrolled canonical article switches from a light theme to a dark theme
- **THEN** the existing iframe document and article nodes retain identity and text
- **AND** computed reader tokens change without iframe navigation or material scroll movement

#### Scenario: Theme preview changes in place
- **WHEN** `previewThemeId` changes without committing the theme
- **THEN** the canonical iframe immediately reflects the preview tokens through the existing style element
- **AND** its document content and scroll position remain intact

### Requirement: Canonical prose has a responsive readable measure
The canonical article SHALL use an inline measure of 66ch, centered within body padding, with no fixed viewport width. At default typography on desktop its rendered prose measure SHALL fall within 64–68 characters. On narrow viewports it SHALL shrink to the available content box with safe side padding and without clipping, including when another panel reduces the reader viewport.

#### Scenario: Desktop prose is constrained
- **WHEN** the canonical fixture is rendered at the desktop visual-test viewport with default HTML settings
- **THEN** `.inc-article` is centered and its computed inline size corresponds to the 66ch contract
- **AND** ordinary paragraphs do not expand to the iframe viewport width

#### Scenario: Narrow viewport remains fluid
- **WHEN** the canonical fixture is rendered at a tablet or narrow viewport, or at an Assistant-reduced content width
- **THEN** the article fits within the padded viewport, text reflows, and the document root has no horizontal overflow

### Requirement: Wide scholarly content scrolls locally
The canonical reader SHALL constrain figures, images, tables, preformatted blocks, and MathML to the article width. Canonical wide wrappers for display equations, tables, and preformatted blocks SHALL provide local horizontal overflow without widening prose or the iframe root. Inline MathML SHALL remain inline.

#### Scenario: Wide equation uses local overflow
- **WHEN** a display equation is wider than the narrow article viewport
- **THEN** its `.inc-wide` container has `scrollWidth` greater than `clientWidth` and can scroll horizontally
- **AND** the article, body, and document element stay within the viewport

#### Scenario: Wide table preserves table semantics
- **WHEN** a semantic table is wider than the prose measure
- **THEN** its `.inc-table-wrap` owns horizontal overflow while the contained element remains a semantic `table`
- **AND** the table does not increase the article or document root width

#### Scenario: Overflow region is keyboard accessible only when needed
- **WHEN** a canonical wide wrapper actually overflows its content box
- **THEN** keyboard users can focus and scroll that region and an accessible label identifies it
- **AND** a wrapper that does not overflow does not add a gratuitous tab stop

### Requirement: Canonical typography preserves scholarly semantics
The canonical stylesheet SHALL explicitly style publication metadata, title, byline, abstract, paragraphs, `h2` through `h6`, links, lists, blockquotes, code, tables, figures, citations, footnotes, bibliography, theorem/proof blocks, MathML, `strong`/`b`, `em`/`i`, `small`, `sup`, and `sub`. It MUST NOT apply an iframe-wide descendant reset that forces inherited font size, weight, style, text decoration, or text transform over semantic elements.

#### Scenario: Strong and emphasis remain visible
- **WHEN** the canonical fixture contains `strong` and `em` text
- **THEN** computed `strong` font weight is bold and computed `em` font style is italic under both light and dark themes

#### Scenario: Heading hierarchy is visually distinct
- **WHEN** the canonical fixture contains `h2`, `h3`, and `h4` sections
- **THEN** their computed sizes, weights, and spacing form a distinguishable descending hierarchy below the article title

#### Scenario: Figures and captions remain contained and readable
- **WHEN** a figure is rendered at desktop and narrow widths
- **THEN** the image retains its aspect ratio inside the article, the caption stays associated and visible, and caption text meets the reader contrast contract

### Requirement: Canonical interactions remain accessible
Canonical links SHALL remain underlined or otherwise non-color distinguishable, keyboard reachable, and visibly focused. Semantic headings, lists, figures, table captions and headers, citations, footnotes, and MathML SHALL remain in the iframe accessibility tree. Reader font controls, browser zoom through 200 percent, selection, search marks, highlights, and existing viewer keyboard behavior SHALL remain functional.

#### Scenario: Link focus is visible
- **WHEN** keyboard focus moves to a canonical article link
- **THEN** the link has a visible focus indication meeting the non-text contrast target without relying only on color

#### Scenario: Two-hundred-percent zoom remains usable
- **WHEN** the canonical reader is viewed at 200 percent zoom
- **THEN** prose reflows within the viewport and wide content remains locally scrollable without hiding text or controls

### Requirement: Legacy arXiv documents remain display compatible
An existing arXiv HTML document with arXiv metadata but no `metadata.webArticle` SHALL keep its persisted DOM and text order. The viewer SHALL apply a scoped compatibility treatment for theme foreground, readable measure, responsive media, semantic emphasis, superscripts/subscripts, and known LaTeXML wide blocks. It MUST NOT silently re-extract, relabel, or persist the document as canonical.

#### Scenario: Opening a legacy arXiv document is non-destructive
- **WHEN** a pre-change dedicated arXiv HTML document is opened
- **THEN** its stored body, metadata, highlights, and reading anchors are not rewritten
- **AND** it remains readable in light and dark themes through the legacy compatibility reader
