## MODIFIED Requirements

### Requirement: Autocomplete Trigger for Sections

The system SHALL display an autocomplete popup of chapters and sections for the active document when the user enters the `#` character in the Document Q&A query input textarea. The popup SHALL be rendered in a floating layer that is not clipped by the composer's scroll container, SHALL anchor above the question input, and SHALL remain within the workspace and viewport bounds while its own list scrolls. With no query text after `#`, the popup SHALL present the document outline with expandable top-level sections rather than a flat list of every nested heading.

#### Scenario: User types # to open sections popup

- **WHEN** the user focuses the Document Q&A text input and types `#`
- **THEN** the system SHALL display a list of all detected chapters/sections in the current document in a popup overlay

#### Scenario: Popup is not clipped by the composer

- **WHEN** the conversation composer is scrolled at its maximum height and the user types `#`
- **THEN** the section popup is fully visible above the composer and can be reached and read without scrolling the conversation

#### Scenario: Bare # shows the outline

- **WHEN** the user types `#` without additional query text
- **THEN** the popup shows the document's top-level sections, and sections with children can be expanded to reveal their child sections in place
