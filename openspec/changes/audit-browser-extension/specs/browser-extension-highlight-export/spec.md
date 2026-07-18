## ADDED Requirements

### Requirement: Capture Highlights in Saved HTML Content
The browser extension content script SHALL capture the webpage HTML including highlight DOM elements (`.incrementum-highlight` spans) with their styling attributes when saving the current tab.

#### Scenario: Save Webpage with Highlights
- **WHEN** the user saves a webpage where text highlights have been created
- **THEN** the extension SHALL capture the HTML representation including the `.incrementum-highlight` span elements and send it to the local server

### Requirement: Render Highlights in Desktop Document Viewer
The desktop application's HTML content renderer SHALL render highlight elements with their original formatting, avoiding stripping their background styling.

#### Scenario: Display Saved Document with Highlights in Iframe
- **WHEN** the desktop application renders saved webpage HTML in the sandboxed iframe
- **THEN** it SHALL style `.incrementum-highlight` elements using the original inline highlight colors and fallback styles, and exclude them from global background-stripping rules
