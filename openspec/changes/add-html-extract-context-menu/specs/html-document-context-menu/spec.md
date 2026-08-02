## ADDED Requirements

### Requirement: Context menu appears on right-click with text selected in HTML documents

The system SHALL display the text-selection context menu when the user right-clicks on selected text inside an HTML document viewer (`docType === "html"`, e.g. Browser Extension imports) or the OCR HTML view (`pdfViewMode === "ocr-html"` with `ocrResult.format === "html"`). The menu SHALL appear at the cursor position, translated correctly from the iframe's coordinate space to the page, and SHALL contain the same actions available in the EPUB and Markdown viewers: Create Extract, Create Extract (with dialog), Highlight (color submenu), Copy, Dictionary Lookup, Create Flashcard.

#### Scenario: Right-click on selected text in an imported HTML document

- **WHEN** the user selects text in a Browser Extension-imported HTML document and right-clicks
- **THEN** the system SHALL display a context menu at the cursor position with the following items: Create Extract, Create Extract (with dialog), Highlight (submenu), Copy, Dictionary Lookup, Create Flashcard

#### Scenario: Right-click on selected text in the OCR HTML view

- **WHEN** the user selects text while viewing a PDF's OCR HTML output and right-clicks
- **THEN** the system SHALL display the same context menu as the primary HTML document viewer

#### Scenario: Right-click with no text selected in an HTML document

- **WHEN** the user right-clicks inside an HTML document without selecting text
- **THEN** the system SHALL NOT display the custom context menu (native browser menu or no menu)

#### Scenario: Context menu positioned correctly regardless of iframe scroll

- **WHEN** the user has scrolled the HTML iframe content and then right-clicks selected text
- **THEN** the context menu SHALL appear at the on-screen cursor position, not offset by the iframe's internal scroll or the iframe's position within the page

### Requirement: HTML document context menu actions behave identically to EPUB/Markdown

Actions triggered from the HTML document context menu SHALL use the same handlers already used by the EPUB and Markdown viewers (`createInstantExtract`, `CreateExtractDialog`, highlight creation, clipboard copy, dictionary lookup, `FlashcardStudioModal`), operating on the selected text captured at right-click time.

#### Scenario: Instant extract from HTML document context menu

- **WHEN** the user right-clicks selected text in an HTML document and clicks "Create Extract"
- **THEN** the system SHALL create an extract from the selected text using the same logic as EPUB/Markdown, show a success toast, and close the context menu

#### Scenario: Highlight with color from HTML document context menu

- **WHEN** the user hovers "Highlight" in the HTML document context menu and clicks a color option
- **THEN** the system SHALL create an extract with the selected text and the chosen highlight color

#### Scenario: Copy, dictionary lookup, and flashcard actions from HTML document context menu

- **WHEN** the user selects "Copy", "Dictionary Lookup", or "Create Flashcard" from the HTML document context menu
- **THEN** the system SHALL perform the same behavior as the equivalent action in the EPUB/Markdown context menu, scoped to the selected text
