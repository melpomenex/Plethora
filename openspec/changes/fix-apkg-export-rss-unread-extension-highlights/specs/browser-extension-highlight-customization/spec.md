## Purpose

Enables users to choose, persist, and reliably restore custom highlight colors for web text extractions captured through the Plethora browser extension across browser visits.

## ADDED Requirements

### Requirement: User can choose highlight color
The extension SHALL provide a highlight color selection control (supporting preset color swatches and custom hex values) in the extension popup and priority extraction dialog, allowing users to select and change their active highlight color.

#### Scenario: Selecting active highlight color from popup
- **WHEN** user opens the extension popup and selects a highlight color from the color swatches
- **THEN** the chosen highlight color is saved to extension sync settings and used for subsequent highlights

#### Scenario: Choosing highlight color during extraction
- **WHEN** user extracts text and the priority/extract dialog is displayed
- **THEN** the dialog displays color options allowing the user to select the highlight color for this extract

### Requirement: Highlight color persistence on extracts
The extension SHALL persist the chosen highlight color as an attribute of the extract record and include the color in backend synchronization payloads sent to Plethora.

#### Scenario: Extract record carries highlight color
- **WHEN** user creates an extract with a chosen highlight color
- **THEN** the extract record stored in local extension storage and the synchronization payload sent to Plethora include the selected color value

### Requirement: Cross-session highlight persistence on visited pages
The extension SHALL persist extracted highlights in durable extension storage and automatically restore highlights with their exact persisted colors when the user revisits or reloads the webpage.

#### Scenario: Highlights restored on page reload or revisit
- **WHEN** user revisits a webpage where extracts were previously created
- **THEN** the extension retrieves the stored extracts for that page and restores the DOM highlights using each extract's persisted highlight color

#### Scenario: Robust multi-node highlight rendering
- **WHEN** an extract spans multiple DOM nodes or contains inline markup
- **THEN** the extension highlights the text safely without throwing unhandled DOM exceptions or aborting remaining highlights
