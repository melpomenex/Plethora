## ADDED Requirements

### Requirement: Text PDFs produce responsive semantic content
The system SHALL convert suitable text-based PDF pages into a responsive semantic block model that preserves detected reading order, headings, paragraphs, lists, tables, figures, captions, links, footnotes, and page boundaries where supported by the source.

#### Scenario: Reflow a single-column text PDF
- **WHEN** a text-heavy PDF page has a confident reading order
- **THEN** the system presents its content as readable responsive blocks in source order
- **AND** the content does not require horizontal scrolling at phone widths

#### Scenario: Reflow a multi-column page
- **WHEN** the analyzer confidently detects multiple text columns
- **THEN** the system orders blocks according to the detected column flow
- **AND** repeated headers and footers are not inserted into the main reading flow

### Requirement: Reflow content retains source anchors
Every reflow block MUST retain a stable source anchor containing its source page and, when available, source rectangles or token spans sufficient to return to the corresponding original PDF content.

#### Scenario: Inspect original source from reflow
- **WHEN** a user invokes view-original on a reflow block
- **THEN** the fixed-layout viewer opens the corresponding source page
- **AND** positions or emphasizes the anchored source region when geometry is available

#### Scenario: Source mapping is uncertain
- **WHEN** a readable block lacks a confident source rectangle or token mapping
- **THEN** the system marks the mapping as uncertain
- **AND** does not silently create precise coordinate-dependent annotations from that block

### Requirement: Reflow suitability is quality-gated
The system SHALL classify each PDF and page as semantic, semantic-with-warnings, OCR-required, or fixed-layout-recommended using measurable extraction and layout signals.

#### Scenario: Text PDF has high extraction confidence
- **WHEN** sufficient text coverage and reading-order confidence are detected
- **THEN** the system makes semantic reflow available
- **AND** may recommend it as the mobile default

#### Scenario: Layout should remain fixed
- **WHEN** the page is a form, comic, sheet-music page, dense magazine layout, or otherwise has low semantic confidence
- **THEN** the system recommends fixed layout
- **AND** keeps reflow as an explicit user choice only when usable content exists

### Requirement: Reflow conversion is incremental and cached
The system SHALL make current and nearby page content available before whole-document processing finishes and SHALL cache versioned per-page results keyed to immutable source identity and extraction-engine version.

#### Scenario: Open an uncached long PDF
- **WHEN** a user opens an uncached long PDF in reflow mode
- **THEN** the system prioritizes the current page and adjacent pages
- **AND** allows reading while remaining pages continue processing

#### Scenario: Reopen an unchanged PDF
- **WHEN** a user reopens a PDF whose compatible reflow cache is complete or partial
- **THEN** the system uses valid cached pages immediately
- **AND** processes only missing or invalid pages

#### Scenario: Source file or engine version changes
- **WHEN** the source identity or reflow schema/engine version no longer matches the cache
- **THEN** the system invalidates incompatible cached content
- **AND** preserves the source PDF and user annotations

### Requirement: Scanned pages support incremental OCR reflow
The system SHALL support page-level OCR for pages without usable text, with progress, cancellation, language selection, bounded rendering, confidence, and source rectangles stored in the semantic model.

#### Scenario: Open a scanned PDF page
- **WHEN** the current page has insufficient selectable text and OCR is enabled or requested
- **THEN** the system prioritizes OCR for the current page
- **AND** shows queued, processing, ready, or failed status without blocking original-page reading

#### Scenario: Cancel OCR
- **WHEN** the user cancels active PDF OCR or leaves the document
- **THEN** the system stops or safely discards pending OCR work
- **AND** retains any previously completed page results

#### Scenario: OCR fails or returns low confidence
- **WHEN** OCR cannot produce usable content for a page
- **THEN** the system keeps fixed-layout reading available
- **AND** offers retry and language/quality guidance without fabricating semantic content

### Requirement: Generated reflow content is safe and accessible
The system MUST render reflow content from a typed model using sanitized components, preserve Unicode and text direction, expose meaningful document semantics to assistive technology, and prevent source PDF content from executing scripts.

#### Scenario: PDF contains script-like text or unsafe links
- **WHEN** extracted content resembles markup, scripts, or an unsafe URI
- **THEN** the reader treats it as inert content or removes the unsafe target
- **AND** no source-controlled script executes in the app context

#### Scenario: PDF uses RTL text
- **WHEN** the analyzer or user identifies a right-to-left language
- **THEN** reflow blocks use the correct text direction and reading order where supported
- **AND** the user can override an incorrect direction classification

