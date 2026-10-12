# mobile-web-article-import Specification

## Purpose
Provides a mobile-optimized, responsive Web Article Import dialog that displays an opaque surface across all themes, renders via a root portal, and adapts gracefully to narrow mobile viewports.

## Requirements

### Requirement: Dialog renders via root portal
When the Web Article Import dialog is opened, the system SHALL render the dialog inside `document.body` via a portal rather than nested inside the caller view's DOM hierarchy.

#### Scenario: Modal overlay renders at root
- **WHEN** user opens the Web Article Import dialog on mobile or desktop
- **THEN** the dialog element is portalled directly into `document.body`, layering above mobile navigation bars and page scroll containers

### Requirement: Opaque dialog surface across all themes
The Web Article Import dialog surface SHALL render completely opaque, preventing underlying library items and text from bleeding through the dialog container.

#### Scenario: Dialog opened under transparent or scenic themes
- **WHEN** user opens the Web Article Import dialog with a scenic or translucent theme active
- **THEN** the dialog panel maintains an opaque surface and the underlying document list is not visible through the dialog body

### Requirement: Full-screen mobile layout with safe area insets
On mobile screens (`isMobileShell` or narrow viewports), the system SHALL present the Web Article Import dialog as a full-screen view respecting device safe-area insets.

#### Scenario: Opening dialog on mobile device
- **WHEN** the dialog is opened in a mobile shell
- **THEN** it occupies the full viewport with safe-area padding at the top and bottom, overlaying the mobile bottom navigation bar

#### Scenario: Closing dialog on mobile device
- **WHEN** user taps the close or back button in mobile view
- **THEN** the dialog closes and restores focus to the invoking view

### Requirement: Adaptive preview and layout flow on mobile
On mobile viewports, the dialog SHALL NOT force a rigid two-column horizontal split. When an article preview is generated, the system SHALL display article metadata, options, and preview in an accessible layout suitable for narrow screens.

#### Scenario: Fetching article on mobile
- **WHEN** user enters a URL and taps "Fetch" on a mobile device
- **THEN** the article preview is accessible and readable without being horizontally pushed offscreen or cropped

#### Scenario: Reviewing fetched article content on mobile
- **WHEN** an article has been successfully fetched in mobile view
- **THEN** the user can switch between the article input/tags settings and the content preview, or scroll through the content preview cleanly

#### Scenario: Confirming import on mobile
- **WHEN** article preview is ready on mobile
- **THEN** the "Import to Library" action is prominently accessible at the bottom of the screen above the safe area

### Requirement: Responsive input and tag controls on mobile
On mobile devices, the URL input field, fetch action, format toggles, tag chips, and quick tag pills SHALL wrap and scale to fit mobile widths without clipping.

#### Scenario: Adding tags on mobile
- **WHEN** user views quick tags or enters a custom tag on mobile
- **THEN** the tags wrap cleanly across multiple lines within the screen bounds
