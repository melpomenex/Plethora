## ADDED Requirements

### Requirement: Selection Interaction V2 direct extract consumes captured snapshot
When a user invokes "Extract" from the Selection Interaction V2 action bar or menu, the operation SHALL consume the immutable `CapturedSelection` payload captured from `selectionController.captureForAction()` or `readySelection`. The handler SHALL NOT depend on mutable React states (`mobileSelection.text`, `activeExtractSelection`) or live DOM selections.

#### Scenario: Touch selection collapsed before extract tapped
- **WHEN** a user selects text on mobile, releases touch (causing native selection collapse), and taps "Extract" on the settled action bar
- **THEN** an extract is created successfully with the captured text, document ID, and selection context

### Requirement: Extraction capture occurs before interaction dismissal
The system SHALL capture the authoritative selection snapshot BEFORE dismissing the selection bar or updating the selection machine state to idle.

#### Scenario: Snapshot captured prior to bar dismissal
- **WHEN** the user taps "Extract" on the Selection Action Bar
- **THEN** the selection controller commits the snapshot, initiates the extract persistence operation with that snapshot, and then dismisses the action bar

### Requirement: Provenance metadata preserved across all reader document formats
Extracts created via direct extraction or AI-result promotion SHALL preserve all format-specific provenance metadata, including PDF page numbers and geometry anchors, EPUB CFIs, and HTML/Markdown text offsets.

#### Scenario: PDF extract preserves page and geometry
- **WHEN** an extract is created from a PDF selection
- **THEN** the persisted extract record contains the correct `page_number` and `selection_context` matching the source text location

#### Scenario: EPUB extract preserves CFI
- **WHEN** an extract is created from an EPUB selection
- **THEN** the persisted extract record contains the EPUB CFI selection context

### Requirement: Touch selection dismissal preserves native platform stability
Dismissal of selection UI after extraction on touch/Android surfaces SHALL NOT call `window.getSelection()?.removeAllRanges()`. The system SHALL use controller-level suppression to hide the Plethora UI while keeping the native Android WebView selection and action mode stable.

#### Scenario: Dismissal on Android does not wedge WebView
- **WHEN** an extract is created on an Android touch device
- **THEN** the action bar disappears cleanly without crashing or wedging the native WebView touch input

### Requirement: Desktop right-click and selection popup parity
Direct extraction from desktop right-click context menus and `SelectionPopup` SHALL route through the same snapshot capture and awaitable `createInstantExtract` contract, producing consistent single-submit protection and toast feedback.

#### Scenario: Desktop context menu extraction
- **WHEN** a desktop user right-clicks selected text and chooses "Highlight" or "Extract"
- **THEN** the extract is created with full context, triggers a success toast with "Edit" action, and refreshes the Extracts list
