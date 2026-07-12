## ADDED Requirements

### Requirement: Mobile PDF reader chooses an appropriate initial mode
The system SHALL open phone-sized PDF reading in reflow mode when semantic quality is sufficient, and SHALL otherwise open or recommend an appropriate fixed-layout mode without delaying access to readable content.

#### Scenario: Open a suitable text PDF on a phone
- **WHEN** a user opens a PDF classified as semantic on a phone-sized native-mobile viewport
- **THEN** the reader presents cached or incrementally available reflow content by default
- **AND** keeps the original fixed-layout page accessible

#### Scenario: Open a complex or image-first PDF on a phone
- **WHEN** a PDF is classified as fixed-layout-recommended or OCR-required
- **THEN** the reader opens a usable original-page view or explicit OCR state
- **AND** explains the recommended mode without trapping the user in conversion

### Requirement: Users can switch reading modes without losing their passage
The system SHALL provide reflow, fit-width, fit-page, crop-to-content, and supported column/landscape fixed-layout modes, and SHALL preserve the closest source passage when switching modes.

#### Scenario: Switch from reflow to original page
- **WHEN** a user switches from a reflow block to fixed layout
- **THEN** the reader opens the block's source page and anchored region
- **AND** the shared progress indicator remains consistent with the source position

#### Scenario: Switch from fixed layout to reflow
- **WHEN** a user switches from an original PDF position to reflow
- **THEN** the reader resolves the nearest available reflow block for that source position
- **AND** clearly reports if that page is still processing or cannot be reflowed

### Requirement: Mobile reading chrome is immersive and touch-safe
The system SHALL maximize the mobile reading surface, respect device safe areas, provide tap-toggle chrome and bottom-sheet controls, preserve a minimum 44px interactive target, and avoid intercepting text selection or annotation gestures.

#### Scenario: Toggle reader controls
- **WHEN** the user taps a neutral area of the reading surface while no selection gesture is active
- **THEN** compact top and bottom controls toggle visibility
- **AND** the reading position does not jump

#### Scenario: Select text near a navigation zone
- **WHEN** the user begins a text selection or annotation gesture
- **THEN** navigation tap zones and chrome toggling yield to the selection gesture
- **AND** the selection remains controllable at the screen edges

### Requirement: Mobile PDF preferences are immediate and persistent
The system SHALL provide persistent global defaults and per-document overrides for reflow typography, margins, line height, theme, image scaling, text direction, and fixed-layout fit/crop/column options.

#### Scenario: Adjust reflow typography
- **WHEN** a user changes font size, family, line height, or margins
- **THEN** visible reflow content updates without losing position
- **AND** the preference is restored on the next open

#### Scenario: Override one document's mode
- **WHEN** a user chooses a non-default reading mode for a PDF
- **THEN** the mode is remembered for that document
- **AND** global defaults for other PDFs are unchanged

### Requirement: Navigation, progress, TOC, and search work across modes
The system SHALL provide source-page-aware progress, page/section scrubbing, table-of-contents navigation, and search results that resolve to the correct passage in either reading mode.

#### Scenario: Navigate from the PDF outline in reflow
- **WHEN** a user selects an outline entry while reading reflow content
- **THEN** the reader navigates to the nearest block anchored to that destination
- **AND** falls back to the source page if no reflow block is available

#### Scenario: Open a search result
- **WHEN** a user opens a PDF search result
- **THEN** the reader navigates to and emphasizes the matching passage in the active mode
- **AND** provides access to the original source page

### Requirement: Reading position survives reopening and mode changes
The system SHALL persist PDF position as a source-aware anchor and SHALL restore the closest valid passage after app restart, document update, or mode change.

#### Scenario: Reopen a partially reflowed PDF
- **WHEN** a user reopens a document whose last anchor belongs to a page not yet reflowed in the current cache
- **THEN** the reader restores the source page immediately
- **AND** transitions to the corresponding reflow block when available only if doing so will not disrupt active reading

#### Scenario: Restore a legacy page-only position
- **WHEN** an existing PDF has only a legacy page-number position
- **THEN** the reader restores that page
- **AND** lazily upgrades the saved position when a more precise anchor becomes available

### Requirement: Learning and annotation workflows remain source-correct
The system SHALL allow selection, highlights, extracts, assistant context, and citations from reflow content when a trustworthy source anchor exists, using the same logical PDF source context as fixed layout.

#### Scenario: Create an extract from reflowed PDF text
- **WHEN** a user creates an extract from confidently anchored reflow text
- **THEN** the extract stores selected text, source page, reflow block identity, and PDF geometry/token context where available
- **AND** returning to source opens the correct passage

#### Scenario: Existing highlight maps into reflow
- **WHEN** an existing PDF highlight has source geometry that resolves confidently to reflow blocks
- **THEN** the reader displays the highlight in reflow and fixed layout
- **AND** both representations refer to the same annotation

#### Scenario: Existing highlight cannot map confidently
- **WHEN** an existing PDF highlight cannot be projected into reflow without ambiguity
- **THEN** the reader preserves it in fixed layout
- **AND** does not display it at an incorrect reflow location

### Requirement: Partial and error states keep the reader usable
The system SHALL present clear loading, analyzing, OCR, password, missing-file, corrupt-file, and per-page conversion states with appropriate actions while retaining any reading mode that remains usable.

#### Scenario: Reflow processing fails on one page
- **WHEN** one page fails semantic extraction or OCR
- **THEN** the reader marks that page as unavailable in reflow
- **AND** offers the original page without failing the rest of the document

#### Scenario: App is offline
- **WHEN** a locally available PDF is opened without network connectivity
- **THEN** local fixed-layout reading and cached/local reflow remain available
- **AND** no network connection is required for core PDF reading

