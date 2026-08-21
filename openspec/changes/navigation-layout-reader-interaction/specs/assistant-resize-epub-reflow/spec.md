## ADDED Requirements

### Requirement: Assistant resize reflows EPUB text continuously
In side-by-side layout, resizing the Assistant panel SHALL dynamically resize the usable reader area and reflow the EPUB text to the new width continuously (not only at drag end). Dragging the Assistant boundary left SHALL make the reader narrower/reflowed; dragging it right SHALL make the reader wider/expanded. The existing chain (Assistant width → flex container → `EPUBViewer` ResizeObserver → debounced `rendition.resize`) SHALL be completed and verified; the renderer SHALL be invalidated properly rather than merely changing outer CSS width.

#### Scenario: Drag Assistant wider → reader narrower
- **WHEN** the user drags the Assistant boundary left so the Assistant becomes wider
- **THEN** the EPUB reading column SHALL become narrower and its text SHALL reflow to the new width (lines/wrapping change accordingly)

#### Scenario: Drag Assistant narrower → reader wider
- **WHEN** the user drags the Assistant boundary right so the Assistant becomes narrower
- **THEN** the EPUB reading column SHALL become wider and its text SHALL reflow to the expanded width

#### Scenario: Continuous reflow during drag
- **WHEN** the user drags the boundary through many intermediate widths
- **THEN** the reader width and EPUB reflow SHALL update continuously (rAF/debounce-coalesced, not only on pointer-up), without jank from per-event full EPUB reconstruction

### Requirement: The logical reading position remains stable across resize
Reflowing SHALL keep the current logical reading location stable. The text SHALL NOT jump to an unrelated chapter/location after resize.

#### Scenario: Position preserved across repeated resizes
- **WHEN** the user resizes the Assistant through a series of widths while reading
- **THEN** the reading location (spine/chapter and in-section position) SHALL remain the same location after each resize; the view SHALL not snap to a different chapter

#### Scenario: Highlights/selections/annotations remain anchored
- **WHEN** the user resizes the Assistant while highlights/annotations exist in the EPUB
- **THEN** the highlights/annotations SHALL remain anchored to their text and SHALL not be lost or displaced

### Requirement: Minimum usable widths prevent pane collapse
The system SHALL enforce minimum usable widths for both the Assistant and the reader so neither pane collapses into an unusable state during resize. The existing Assistant clamp (300–800 px) SHALL remain, and the reader SHALL retain a minimum usable width.

#### Scenario: Assistant cannot shrink below minimum
- **WHEN** the user drags the boundary to make the Assistant very narrow
- **THEN** the Assistant width SHALL stop at its configured minimum and the reader SHALL retain a usable width

### Requirement: Assistant resize integration is shared across layouts
The behavior SHALL work wherever the same Assistant+reader layout appears, including Queue View / Scroll Mode (`src/pages/QueueScrollPage.tsx`) which uses the same pattern as `DocumentViewerWrapper`. The `onWidthChange` callback exposed by `AssistantPanel` SHALL be consumed (or an equivalent shared mechanism used) so both layouts reflow consistently.

#### Scenario: Scroll Mode reflows on Assistant resize
- **WHEN** the user resizes the Assistant in Scroll Mode (queue scroll layout)
- **THEN** the embedded reader SHALL reflow exactly as in the document-viewer layout