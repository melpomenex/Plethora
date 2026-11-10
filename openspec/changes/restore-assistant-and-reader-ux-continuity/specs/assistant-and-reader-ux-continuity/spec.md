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
All built-in themes SHALL maintain a minimum contrast ratio of 4.5:1 between text foreground colors and their surrounding surface backgrounds.

#### Scenario: Reading text in Midnight dark theme
- **GIVEN** the application is set to Midnight dark theme
- **WHEN** secondary or muted text is rendered inside a card or reading pane
- **THEN** the contrast ratio between text and background SHALL meet or exceed 4.5:1

### Requirement: Assistant conversation scroll retention
The Assistant conversation view SHALL preserve the user's scroll offset across tab switches and queue item navigation. Programmatic navigation SHALL NOT trigger false "Latest message" button alerts.

#### Scenario: Navigating between tabs during assistant reading
- **GIVEN** an active conversation scrolled to 40% offset to read an earlier explanation
- **WHEN** the user switches to the Reader tab and returns to the Assistant tab
- **THEN** the scroll position SHALL be restored to 40% offset
- **AND** the "Latest message" floating button SHALL NOT flash unexpectedly
