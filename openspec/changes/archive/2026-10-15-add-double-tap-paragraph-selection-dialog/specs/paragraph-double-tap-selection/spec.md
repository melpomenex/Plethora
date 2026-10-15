## ADDED Requirements

### Requirement: Paragraph double-tap detection and selection
The system SHALL detect double-tap and double-click gestures performed on paragraph content within reader and queue surfaces (Markdown, EPUB, PDF Reflow, HTML reader, RSS queue scroll view) and programmatically select the entire text of the target paragraph block.

#### Scenario: User double-taps a paragraph on a touch device
- **WHEN** user performs two consecutive taps within 300ms on a text paragraph element inside a document or queue view
- **THEN** the system prevents default viewport zoom and creates a DOM text selection covering the entire paragraph element

#### Scenario: User double-clicks a paragraph on desktop
- **WHEN** user double-clicks within a paragraph element in a document or queue view
- **THEN** the system selects the full paragraph text range and anchors the selection to that paragraph block

#### Scenario: User double-taps on interactive elements inside a paragraph
- **WHEN** user double-taps on an anchor link (`<a>`), interactive button, or input element inside a paragraph
- **THEN** the system SHALL NOT override the native interaction or force whole-paragraph selection

### Requirement: Selection action UI activation for paragraph selections
The system SHALL trigger the standard text selection interaction surface (anchored action bar, selection action bottom sheet, or contextual action dialog) immediately upon settling the paragraph selection.

#### Scenario: Paragraph selection on mobile touch interface
- **WHEN** a paragraph is selected via double-tap on a mobile touch shell
- **THEN** the system activates the selection action bar positioned relative to the paragraph and prepares the selection actions sheet with the paragraph text

#### Scenario: Paragraph selection in queue scroll mode
- **WHEN** user double-taps on a paragraph of an article or document inside queue scroll mode
- **THEN** the system selects the paragraph and presents extract creation, AI action options, and clipboard copy controls for that paragraph

#### Scenario: Paragraph selection in iframe-hosted readers (EPUB/HTML)
- **WHEN** user double-taps a paragraph inside an EPUB spine section or HTML reader iframe
- **THEN** the content document bridge detects the gesture, selects the paragraph range within the iframe document, and forwards the selection to the parent selection controller
