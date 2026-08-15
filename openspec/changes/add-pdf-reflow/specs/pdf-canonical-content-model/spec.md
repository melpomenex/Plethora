# Spec Delta: pdf-canonical-content-model (new)

## ADDED Requirements

### Requirement: Hybrid page analysis produces a canonical model
The system SHALL analyze each PDF page by combining a rendered page bitmap (visual organization) with native PDF text items (exact content) and SHALL produce a canonical page model containing words with source bounding boxes, lines, paragraphs, and typed blocks with reading order and confidence. Analysis SHALL run locally without cloud services or language models.

#### Scenario: Born-digital page analyzed from native text
- **GIVEN** a page with a native PDF text layer
- **WHEN** the page is analyzed
- **THEN** the canonical model contains words whose text equals the native PDF text with source bounding boxes in PDF space
- **AND** no OCR is invoked for that page

#### Scenario: Analysis is deterministic
- **GIVEN** the same page bitmap and text items analyzed twice with the same engine version
- **WHEN** both canonical page models are compared
- **THEN** they contain identical stable identifiers, blocks, and reading order

### Requirement: Stable identifiers with source provenance
The system SHALL assign deterministic stable identifiers to every word, line, and block (derived from document fingerprint, page, and analysis-order index, never from viewport state) and every block SHALL retain one or more source regions (page index plus bounding rectangles in PDF space) plus its constituent word identifiers.

#### Scenario: Identifiers survive reload
- **GIVEN** a document analyzed in one session
- **WHEN** the document is closed, reopened, and the page is served from cache
- **THEN** word and block identifiers are identical to the first session

#### Scenario: Cross-page content retains multiple regions
- **GIVEN** a paragraph spanning a page boundary
- **WHEN** the canonical model is built
- **THEN** the block retains source regions on both pages with the corresponding word identifiers

### Requirement: Reading order derives from visual geometry
The system SHALL determine reading order from rendered-page geometry (whitespace gutters, region segmentation) rather than PDF internal text order, assigning native words to detected visual regions by spatial overlap.

#### Scenario: Two-column page reads column by column
- **GIVEN** a two-column page whose internal text order interleaves the columns
- **WHEN** the page is analyzed
- **THEN** the canonical reading order completes the left column before starting the right column

#### Scenario: Full-width element spans columns
- **GIVEN** a two-column page with a full-width title above the columns
- **WHEN** reading order is computed
- **THEN** the title precedes both columns in reading order

### Requirement: Paragraph reconstruction with conservative de-hyphenation
The system SHALL reconstruct paragraphs using geometry and typography signals (vertical gaps, indentation, font size and weight, punctuation, column membership) and SHALL merge a line-ending hyphenated word with its continuation only when evidence indicates line-wrap hyphenation, always retaining enough metadata to reconstruct the original unmerged text.

#### Scenario: Paragraphs split on leading gaps
- **GIVEN** consecutive lines with a vertical gap exceeding the page's median leading and a new-line indentation
- **WHEN** paragraphs are reconstructed
- **THEN** the lines are assigned to separate paragraph blocks

#### Scenario: Line-wrap hyphen merged with provenance
- **GIVEN** a line ending in "inter-" followed by a line starting "national"
- **WHEN** the hyphenation evidence indicates a line-wrap break
- **THEN** the canonical text contains "international" flagged as de-hyphenated
- **AND** the source bounding boxes of both original fragments are retained

### Requirement: Recurring marginal elements are classified, not deleted
The system SHALL detect recurring headers, footers, and page numbers across pages, mark them with a role, and suppress them in reflow rendering while retaining them in the canonical model and the Original view.

#### Scenario: Running header suppressed in reflow
- **GIVEN** a chapter title repeated as a top-of-page header on analyzed pages
- **WHEN** the page is rendered in Reflow mode
- **THEN** the header text is not rendered in the reading stream
- **AND** the Original view still displays it in place

### Requirement: Lazy around-the-reader processing
The system SHALL analyze pages lazily around the reader's current position and SHALL present the first reflowed page without requiring analysis of the whole document, continuing opportunistically as reading progresses.

#### Scenario: Large book opens without full conversion
- **GIVEN** a 700-page PDF opened at page 400
- **WHEN** Reflow mode is activated
- **THEN** pages around the reader are analyzed first and page 400 renders in reflow before distant pages are processed

### Requirement: Versioned persistent cache with invalidation
The system SHALL persist canonical page models in a versioned cache keyed by document fingerprint, schema version, and engine version, and SHALL serve cached results on reopen without recomputation, invalidating when any key component changes.

#### Scenario: Cache hit on reopen
- **GIVEN** a page analyzed and cached in a previous session with an unchanged document fingerprint
- **WHEN** the document is reopened
- **THEN** the canonical model is loaded from cache without re-running analysis

#### Scenario: Engine bump invalidates cache
- **GIVEN** cached pages written by engine version N
- **WHEN** the application runs engine version N+1
- **THEN** the cache misses and pages are re-analyzed

### Requirement: Explicit coordinate transformations
The system SHALL centralize all conversions between PDF source space, raster space, normalized page space, and viewport/CSS space in dedicated coordinate modules with round-trip-consistent transforms, and SHALL NOT scatter ad-hoc coordinate math across the codebase.

#### Scenario: Rect round-trips across spaces
- **GIVEN** a rectangle in PDF space
- **WHEN** it is converted to raster, normalized, and back to PDF space
- **THEN** the result matches the original within floating-point tolerance

### Requirement: Analysis failure degrades gracefully
The system SHALL fall back to rendering the original page when page analysis fails and to an exact source crop when an individual block cannot be classified, and SHALL never render a blank page or silently omit source content.

#### Scenario: Unclassifiable region becomes a crop
- **GIVEN** a region the analyzer cannot assign to any block kind with sufficient confidence
- **WHEN** the page is rendered in Reflow mode
- **THEN** the region is rendered as a preserved source crop rather than omitted

### Requirement: Non-sensitive diagnostics and debug overlay
The system SHALL expose non-content diagnostics (analysis durations, detected column count, block counts, fallback usage, cache hits, low-confidence regions) and a developer debug overlay rendering detected bounds, columns, blocks, reading-order numbers, classifications, and confidence over the page.

#### Scenario: Debug overlay annotates a page
- **GIVEN** debug mode is enabled and a page has been analyzed
- **WHEN** the overlay is shown
- **THEN** block boundaries, reading-order numbers, and confidence values are displayed for inspection
