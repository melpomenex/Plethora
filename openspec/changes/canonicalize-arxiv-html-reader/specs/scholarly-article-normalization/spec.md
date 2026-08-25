## ADDED Requirements

### Requirement: Canonical scholarly document structure
The arXiv site-specific extractor SHALL convert LaTeXML source markup into one canonical `<article class="inc-article">` containing one article header and one direct `<div class="inc-body">`. It SHALL extract the document title and authors as header metadata, remove their source copies from the body, remove publisher navigation, table-of-contents chrome, dialogs, scripts, and styles, and preserve the remaining scholarly content in source reading order.

#### Scenario: Representative arXiv document is normalized
- **WHEN** the canonical pipeline extracts the deterministic arXiv fixture
- **THEN** the final normalized article contains exactly one title, one author presentation, and one `.inc-body` whose text follows the source scholarly reading order
- **AND** arXiv page header, footer, navigation, table-of-contents, dialog, script, and style content is absent

#### Scenario: Source title and authors are not duplicated
- **WHEN** LaTeXML includes the title and authors both in document metadata and in the selected article subtree
- **THEN** the canonical header contains the normalized title and byline
- **AND** the canonical body does not contain duplicate title or author blocks

### Requirement: Heading and abstract semantics
The normalizer SHALL produce exactly one article `h1`, map section, subsection, and lower source titles to a stable `h2` through `h6` hierarchy, and preserve an abstract as an `.inc-abstract` section with exactly one semantic Abstract heading. It MUST NOT flatten recognized scholarly sections as generic layout wrappers.

#### Scenario: Section hierarchy is retained
- **WHEN** the source contains section, subsection, and subsubsection titles
- **THEN** the final sanitized body contains distinguishable, ordered `h2`, `h3`, and `h4` headings below the article `h1`
- **AND** no source heading is converted to an ordinary paragraph solely because it was wrapped in a `div`, `span`, or `section`

#### Scenario: Abstract is retained without duplicate label
- **WHEN** the source contains an abstract wrapper and an explicit abstract title
- **THEN** the final article contains one `.inc-abstract` section with one Abstract heading followed by the abstract content

### Requirement: Equations and accessible MathML
The normalizer SHALL preserve inline and display MathML, equation groups, equation numbers, and their reading order. Display equations SHALL receive Plethora-owned `.inc-equation` and `.inc-wide` hooks, while inline math MUST remain inline. When LaTeXML supplies an accessible textual representation, the normalizer SHALL convert it to a sanitizer-approved accessible name or equivalent MathML annotation.

#### Scenario: Inline and block equations remain distinct
- **WHEN** an article contains inline MathML and a numbered display equation
- **THEN** both MathML subtrees survive final sanitization
- **AND** only the display equation is enclosed by a locally scrollable canonical wide-content hook
- **AND** its equation number remains associated in reading order

#### Scenario: Math alternative text survives safely
- **WHEN** source MathML has LaTeXML alternative text but no equivalent semantic annotation
- **THEN** the final MathML exposes that text through an approved accessible representation
- **AND** the source-only `alttext` attribute is not copied blindly to unrelated elements

### Requirement: Scholarly block semantics
The normalizer SHALL preserve theorem-like blocks, proofs, figures, captions, safe image alternative text, responsive image references, semantic tables, table captions and headers, block quotes, code, ordered lists, unordered lists, definition lists, emphasis, strong emphasis, small text, superscripts, and subscripts. It SHALL use only semantic elements and the centralized Plethora scholarly hook vocabulary.

#### Scenario: Rich scholarly blocks survive final output
- **WHEN** the source contains a theorem with a proof, nested lists, a figure with caption, and a table with row and column headers
- **THEN** the final sanitized article retains those structures as semantic theorem/proof sections, list elements, `figure`/`figcaption`, and `table` elements, including safe figure alternative text
- **AND** `strong`, `em`, `small`, `sup`, and `sub` semantics remain present

#### Scenario: Relative figure assets resolve against the arXiv HTML base
- **WHEN** a figure uses a relative LaTeXML image URL
- **THEN** the canonical import records or applies the resolved arXiv HTML asset base so the safe image URL renders without publisher CSS

### Requirement: Citations, bibliography, and footnotes
The normalizer SHALL retain citations, bibliography entries, footnote references, and their same-document relationships. Source target identifiers SHALL be deterministically remapped to a restricted Plethora identifier namespace, and every retained matching fragment link SHALL be rewritten to the corresponding generated target.

#### Scenario: Citation links reach remapped references
- **WHEN** a citation link targets a source bibliography identifier
- **THEN** the final sanitized citation `href` points to a generated safe fragment
- **AND** exactly one bibliography target has the matching generated `id`
- **AND** the bibliography is exposed as an `.inc-bibliography` section with semantic reference items

#### Scenario: Footnote links remain bidirectionally usable
- **WHEN** a source contains a footnote reference, footnote body, and return link
- **THEN** the final sanitized document retains the superscript reference, note body, and sanitizer-approved remapped fragment relationships

### Requirement: Unknown source presentation is not trusted
The canonicalizer SHALL remove every unrecognized `ltx_*` or publisher class, inline presentation attribute, and layout-only wrapper while preserving safe semantic descendants in reading order. It MUST NOT copy publisher CSS, source JavaScript, event handlers, or arbitrary source identifiers into canonical output.

#### Scenario: Unknown LaTeXML wrapper is unwrapped
- **WHEN** safe paragraph content is nested in an unknown presentation-only `ltx_*` wrapper
- **THEN** the final canonical article retains the paragraph text and safe semantic descendants
- **AND** it contains neither the source class nor an empty replacement wrapper
