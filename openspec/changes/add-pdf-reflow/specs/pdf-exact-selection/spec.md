# Spec Delta: pdf-exact-selection (new)

## ADDED Requirements

### Requirement: Canonical selection representation
The system SHALL represent every PDF selection canonically as a word-ID range (start word, end word) with exact text and per-page source rectangles, and this representation SHALL be the single authoritative form used by highlighting, annotation, copy, extract creation, TTS, search navigation, and source navigation.

#### Scenario: One representation drives all actions
- **GIVEN** a user selection resolved to canonical word IDs
- **WHEN** any downstream action (highlight, copy, extract, TTS) is invoked
- **THEN** all of them consume the same canonical selection object

### Requirement: Reflow selections resolve to exact canonical text
In Reflow mode, the system SHALL map user text selections onto canonical word identifiers and SHALL produce selected text that equals the canonical text exactly.

#### Scenario: Exact partial-paragraph extract
- **GIVEN** a reflowed paragraph containing "The quick brown fox jumps over the lazy dog."
- **WHEN** the user selects "brown fox jumps" and creates an extract
- **THEN** the extract content is exactly "brown fox jumps"
- **AND** the extract stores the corresponding start/end word IDs and source rectangles

### Requirement: Original-view selections snap to canonical words
In Original mode, the system SHALL convert screen-space selection geometry into page-space rectangles and resolve them against canonical word bounding boxes, snapping to fully-cover partially selected words, instead of treating DOM text-layer strings as authoritative.

#### Scenario: Original selection returns exact text
- **GIVEN** a user drags a selection across rendered PDF text in Original mode
- **WHEN** the selection is committed
- **THEN** the resulting text and rectangles come from canonical word resolution, word-snapped at both ends

#### Scenario: Unanalyzed page falls back to legacy behavior
- **GIVEN** a selection on a page whose canonical model is not yet available
- **WHEN** the selection is committed
- **THEN** the system falls back to the existing text-layer selection context without error

### Requirement: Highlights map to the source PDF
Highlights created from canonical selections SHALL be renderable in Original view as rectangles derived from the covered words' source bounding boxes, positioned correctly on the source page.

#### Scenario: Reflow highlight paints in Original view
- **GIVEN** a highlight created from a Reflow-mode selection
- **WHEN** the document is opened in Original mode on the source page
- **THEN** the highlight is painted over the exact source text region

### Requirement: Extracts preserve exact source provenance
PDF extracts SHALL store canonical provenance (start/end word IDs, block IDs, per-page source regions) alongside their text, and this provenance SHALL survive persistence and reload.

#### Scenario: Provenance survives reload
- **GIVEN** an extract created from a canonical selection
- **WHEN** the application restarts and the extract is reopened
- **THEN** the stored word IDs and source regions resolve to the same passage

### Requirement: Round-trip navigation between views and sources
The system SHALL navigate from any canonical selection, highlight, or extract to both the exact original PDF passage (page scroll plus region indication) and the exact Reflow passage.

#### Scenario: View source from an extract
- **GIVEN** an extract with canonical provenance
- **WHEN** the user activates "View in original PDF"
- **THEN** the viewer opens the source page, scrolls to the passage, and indicates the source region

#### Scenario: View the same extract in Reflow
- **GIVEN** the same extract
- **WHEN** the user opens the document in Reflow mode
- **THEN** the reader can scroll to the exact reflow passage containing the extract

### Requirement: Legacy selection contexts keep rendering
The system SHALL continue to render highlights and extracts created before this change from their legacy stored geometry, alongside canonical-provenance items.

#### Scenario: Pre-change highlight still paints
- **GIVEN** a stored extract whose selection context contains only legacy PDF rectangles
- **WHEN** the document opens in Original view
- **THEN** the highlight renders from the legacy rectangles as before

### Requirement: TTS follows canonical reading order
Text-to-speech for PDFs SHALL read text in canonical reading order (respecting detected columns and suppressed marginal roles) wherever the canonical model is available.

#### Scenario: Two-column page reads naturally
- **GIVEN** TTS reading a two-column page with a canonical model
- **WHEN** the left column ends
- **THEN** speech continues with the right column rather than interleaving lines

### Requirement: Search maps results into both views
PDF search SHALL be able to run against canonical text and SHALL map each result to canonical word identifiers renderable in both Original and Reflow views.

#### Scenario: Search hit navigates in either view
- **GIVEN** a search match resolved to canonical word IDs
- **WHEN** the user navigates to the hit
- **THEN** the viewer indicates the exact matched text in whichever view is active

### Requirement: AI context uses canonical logical blocks
When assembling AI/assistant context for a PDF, the system SHALL prefer canonical logical blocks (current paragraph, neighbors, heading, captions) in reading order over scraped renderer text, wherever the canonical model is available.

#### Scenario: Ask AI receives ordered paragraph context
- **GIVEN** the reader is positioned at a paragraph with a canonical model available
- **WHEN** the user invokes Ask AI
- **THEN** the context includes that paragraph and its neighbors in canonical reading order
