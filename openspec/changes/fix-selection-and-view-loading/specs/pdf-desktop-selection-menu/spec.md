## ADDED Requirements

### Requirement: Desktop PDF right-click opens the selection context menu
On desktop (non-touch) shells, when a valid text selection exists in a PDF viewer (native page mode, reflow mode, or OCR-HTML mode), a right-click (contextmenu event) within the document surface SHALL open the shared text-selection context menu at the pointer location with the full action set offered by the EPUB desktop menu (Create Extract, Add note, Highlight colors, Copy, Dictionary/Thesaurus, Create Flashcard, Explain, Summarize, Simplify, Key terms, Ask a question, and Learn this when enabled).

#### Scenario: Right-click on a selection in native PDF mode
- **WHEN** the user selects text in a PDF's text layer on desktop and right-clicks inside the document
- **THEN** the native browser context menu is suppressed and the shared selection context menu opens at the pointer with all EPUB-equivalent actions enabled

#### Scenario: Right-click with no selection
- **WHEN** the user right-clicks in the PDF viewer with no active text selection
- **THEN** the default context menu behavior is preserved and no selection menu opens

#### Scenario: Right-click in reflow mode
- **WHEN** the user selects text in the reflowed PDF rendering on desktop and right-clicks
- **THEN** the shared selection context menu opens and its extract/highlight actions carry valid reflow selection provenance (canonical block and offset anchors)

### Requirement: PDF context menu actions use committed PDF selection context
The PDF context menu SHALL be built from the viewer's committed PDF selection context (the same validated payload used by selection persistence), not from raw DOM text, so that extract creation, highlighting, and AI passage actions receive correct page/block provenance.

#### Scenario: Create extract from the PDF context menu
- **WHEN** the user opens the PDF context menu on a committed selection and chooses Create Extract
- **THEN** the extract is created with the selection's PDF provenance (page/block anchors and offsets) exactly as if triggered from the existing PDF selection popup

### Requirement: Context menu supersedes the selection popup
While the desktop context menu is open for a PDF selection, the floating selection popup (highlight/copy/note) SHALL be hidden; the popup MAY return when the context menu closes if the selection is still active.

#### Scenario: Popup hidden while context menu is open
- **WHEN** the selection popup is visible and the user right-clicks to open the context menu
- **THEN** the selection popup is hidden for as long as the context menu is open
