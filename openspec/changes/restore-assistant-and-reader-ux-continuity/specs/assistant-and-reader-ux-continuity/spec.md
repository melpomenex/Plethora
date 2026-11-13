## Purpose

Restore visual and interaction continuity across reader and assistant interfaces, ensuring responsive table layout, high-contrast theming, and stable conversation scrolling.

## ADDED Requirements

### Requirement: Responsive reader table rendering
The reader and EPUB viewers SHALL render multi-column tables with `overflow-x: auto` and `min-width: max-content`. Table columns SHALL NOT collapse into single-character vertical wraps.

#### Scenario: Rendering a wide data table in an EPUB
- **GIVEN** an EPUB document containing a 5-column statistical table
- **WHEN** the document is rendered in the reader
- **THEN** table cells SHALL retain horizontal structure with minimum padding
- **AND** the table SHALL be horizontally scrollable without breaking page layout

### Requirement: WCAG AA contrast compliance across themes
Built-in themes SHALL meet WCAG AA thresholds for ordinary and large text, active controls and focus indicators on reader and Assistant surfaces.

#### Scenario: Reading text in Midnight dark theme
- **GIVEN** the application is set to Midnight dark theme
- **WHEN** secondary or muted text is rendered inside a card or reading pane
- **THEN** the contrast ratio between text and background SHALL meet or exceed 4.5:1

### Requirement: Assistant conversation scroll retention
The Assistant conversation view SHALL preserve the user's conversation-specific reading anchor and relative offset across tab switches and queue item navigation. Programmatic navigation SHALL NOT trigger false "Latest message" button alerts.

#### Scenario: Navigating between tabs during assistant reading
- **GIVEN** an active conversation scrolled to 40% offset to read an earlier explanation
- **WHEN** the user switches to the Reader tab and returns to the Assistant tab
- **THEN** the same message and relative reading position SHALL be restored when available
- **AND** the "Latest message" floating button SHALL NOT flash unexpectedly
