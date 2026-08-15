# Spec Delta: pdf-reflow-reading (new)

## ADDED Requirements

### Requirement: Reflow mode is available on all supported platforms
The system SHALL offer the Reflow viewing mode on desktop (Linux, macOS, Windows) and Android with the same capabilities, and the architecture SHALL NOT preclude iOS. Reflow SHALL NOT be implemented as a mobile-only feature.

#### Scenario: Desktop reader exposes Reflow
- **GIVEN** a PDF open on desktop with a narrow window
- **WHEN** the user activates the viewing-mode toggle
- **THEN** an Original/Reflow toggle is available and Reflow renders the current content

#### Scenario: Mobile and desktop share one renderer
- **GIVEN** the same PDF page analyzed once
- **WHEN** rendered in Reflow on desktop and on Android
- **THEN** both renderings consume the same canonical page model

### Requirement: Native PDF text renders as real selectable text
Where native PDF text exists, the system SHALL render reflowed paragraphs as real selectable text in the reader (not as images), preserving the exact canonical characters.

#### Scenario: Reflowed paragraph is selectable text
- **GIVEN** a born-digital page analyzed into paragraph blocks
- **WHEN** the page is rendered in Reflow mode
- **THEN** paragraphs render as text elements a user can select and copy
- **AND** the copied text equals the canonical text exactly

### Requirement: Responsive typography and themes
The system SHALL support user-configurable font size, line height, margins, reader font (versus preserving document typography), and theme (including dark and e-ink modes) for Reflow rendering on all platforms.

#### Scenario: Font size change re-lays out without re-analysis
- **GIVEN** a page rendered in Reflow mode
- **WHEN** the user increases the reflow font size
- **THEN** the content re-wraps responsively using the cached canonical model without re-running page analysis

#### Scenario: Viewport rotation reflows
- **GIVEN** a page rendered in Reflow in phone portrait
- **WHEN** the device rotates to landscape
- **THEN** the content re-wraps to the new width from the cached canonical model

### Requirement: Figures remain visually faithful
The system SHALL render figures, diagrams, and charts as preserved source imagery scaled to the viewport, SHALL NOT attempt to re-create or reflow their interiors, and SHALL offer fullscreen viewing with zoom plus navigation to the source page.

#### Scenario: Diagram renders as original imagery
- **GIVEN** a page region classified as a figure
- **WHEN** rendered in Reflow mode
- **THEN** the figure displays as the preserved source crop scaled to the viewport width
- **AND** tapping it opens a fullscreen zoomable view

### Requirement: Equations preserve visual fidelity
The system SHALL render equations as high-resolution source crops by default and SHALL NOT replace them with semantically reconstructed output unless explicitly and confidently derived; any derived representation SHALL coexist with the source crop.

#### Scenario: Math-heavy equation stays visually correct
- **GIVEN** a display equation the analyzer cannot confidently represent structurally
- **WHEN** rendered in Reflow mode
- **THEN** the equation renders as an exact source crop at readable resolution

### Requirement: Tables remain readable at narrow widths
The system SHALL render tables through explicit strategies (fit, horizontal scroll, optional card transform, original crop) chosen by table complexity and user preference, and SHALL never shrink a wide table to unreadable microscopic text.

#### Scenario: Wide table scrolls horizontally
- **GIVEN** a ten-column table rendered on a phone-width viewport
- **WHEN** the table block renders
- **THEN** the table is horizontally scrollable at a readable font size (or shown as the original crop), not scaled to fit the viewport width

### Requirement: Original/Reflow toggle preserves logical position
The system SHALL allow switching between Original and Reflow views without losing the logical reading position, in both directions, anchored to canonical content.

#### Scenario: Reflow to Original jumps to source
- **GIVEN** the reader is at a paragraph in Reflow mode
- **WHEN** the user switches to Original
- **THEN** the viewer scrolls to the source page and indicates the corresponding source region

#### Scenario: Original to Reflow returns to equivalent content
- **GIVEN** the reader switches from Original back to Reflow
- **WHEN** the reflow view renders
- **THEN** scrolling resumes at the equivalent logical content, not the document start

### Requirement: Reflow appears promptly with progress state
The system SHALL begin reflowing at the reader's current position and, while a page is still being analyzed, SHALL show a minimal non-blocking progress state instead of blocking the reader or requiring whole-document conversion.

#### Scenario: Analyzing page shows progress, not a block
- **GIVEN** Reflow mode activated on a page still being analyzed
- **WHEN** the user views the reflow pane
- **THEN** a lightweight progress indicator is shown and the reader remains interactive

### Requirement: Large documents remain memory-bounded
The system SHALL keep memory usage bounded for large documents by holding canonical models only for the reading window, persisting the rest to cache, and evicting disk cache under a size cap.

#### Scenario: Scrolling a 700-page book stays within budget
- **GIVEN** a 700-page reflowed document read across many pages
- **WHEN** memory usage is measured
- **THEN** canonical models outside the reading window are released and the memory benchmark gate does not regress
