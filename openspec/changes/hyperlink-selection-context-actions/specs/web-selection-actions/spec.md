## Purpose

Guarantees that selecting text in a saved web hyperlink/article inside Plethora's reader exposes the same contextual reading actions as EPUB selection, on desktop and mobile, with the menu lifecycle, attribution, and security behavior users rely on.

## ADDED Requirements

### Requirement: Web article selections produce a complete selection context

When the user settles a text selection in a saved web article, the system SHALL capture the selection synchronously at settle time with the source document identity, the selected text, and a position anchor, and every invoked action SHALL receive that context. Selections SHALL work for single words, sentences, paragraphs, and multi-paragraph ranges.

#### Scenario: Summarize works on a web selection

- **WHEN** the user selects two sentences in a saved web article and invokes Summarize
- **THEN** the selected text is fed into the existing summarization pipeline
- **AND** the request carries the document title and source URL for attribution

#### Scenario: Multi-paragraph selection captures full text

- **WHEN** the user selects text spanning several paragraphs, including text containing an inline hyperlink
- **THEN** the captured selection context contains the complete selected text

### Requirement: Desktop web selection opens the Plethora context menu with full provenance

On desktop, activating the context menu on a selection in a saved web article SHALL show the same Plethora action set the EPUB reader provides, and extracts, notes, and highlights created through that menu SHALL retain the selection's anchor data exactly as they would in an EPUB.

#### Scenario: Right-click extract retains its anchor

- **WHEN** the user selects text in a saved web article, right-clicks, and creates an extract
- **THEN** the persisted extract is linked to the web article and stores the selection's position anchor, not a null context

#### Scenario: Highlight created from the context menu persists

- **WHEN** the user creates a colored highlight via the desktop context menu in a web article, closes the document, and reopens it
- **THEN** the highlight is repainted at the originating text

### Requirement: Mobile web selection exposes equivalent actions without replacing native behavior

On mobile, selecting text in a saved web article SHALL surface Plethora's anchored action bar and action sheet with the same applicable actions as EPUB selection, while native selection handles, selection dragging, and system copy behavior remain functional.

#### Scenario: Long-press selection shows the Plethora action bar

- **WHEN** the user long-presses and selects a phrase in a saved web article on Android
- **THEN** Plethora's action bar appears with the applicable actions without displacing the native selection handles

#### Scenario: System copy continues to work

- **WHEN** the user copies a web article selection using the platform's native copy affordance
- **THEN** the selected text is copied to the clipboard unchanged

### Requirement: Selection menu lifecycle follows the selection

The selection menu SHALL appear adjacent to the selection without covering it where possible, remain inside the viewport (repositioning near edges), update its target when the user changes the selection, and dismiss when the selection is cleared. On desktop, Escape closes the menu and keyboard focus can reach and activate menu items.

#### Scenario: Menu follows selection changes

- **WHEN** the menu is visible and the user extends or moves the selection
- **THEN** the menu repositions and subsequent actions target the updated selection

#### Scenario: Menu dismisses when selection clears

- **WHEN** the user taps elsewhere or otherwise clears the selection
- **THEN** the menu dismisses without invoking any action

#### Scenario: Menu stays usable at viewport edges

- **WHEN** the selection is at the bottom or a side edge of the viewport
- **THEN** the menu renders fully inside the viewport and remains invocable

### Requirement: Hyperlinks inside saved articles route through Plethora without breaking selection

Activating a hyperlink inside a saved article SHALL navigate per Plethora's preferred behavior (opening in Plethora's browser surface or offering import), with an open-externally and copy-link affordance available. Link handling SHALL NOT prevent selecting text that spans or contains a link.

#### Scenario: Following an in-article link stays inside Plethora

- **WHEN** the user clicks a hyperlink inside a saved web article
- **THEN** the destination opens inside Plethora rather than navigating the reader iframe away from the article

#### Scenario: Copy link is available for in-article links

- **WHEN** the user invokes link options on a hyperlink inside a saved article
- **THEN** copy-link and open-externally actions are offered

#### Scenario: Selection spanning a link still yields actions

- **WHEN** the user selects a passage whose text contains an inline hyperlink and opens the selection menu
- **THEN** the full selection text is captured and all applicable actions are offered

### Requirement: Selection interactions grant captured content no privileges and cost no network

Selection handling in the web reader SHALL NOT weaken the untrusted-content boundary: canonical articles SHALL remain script-free, and no selection event SHALL trigger a network operation before the user invokes an action that requires one.

#### Scenario: Opening the selection menu performs no network access

- **WHEN** the user makes a selection and the menu becomes visible
- **THEN** no network request is initiated until the user activates an action that requires one

#### Scenario: Captured articles cannot reach privileged app APIs via selection

- **WHEN** a malicious saved article is opened and its text is selected
- **THEN** the article content cannot invoke application commands, privileged IPC, or script execution through the selection path
