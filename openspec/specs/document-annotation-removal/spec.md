## Purpose

Let users remove saved document highlights and extracts directly from their marked source passages, with durable deletion and consistent reader feedback.

## Requirements

### Requirement: Saved annotations expose a removal context menu

The document reader SHALL expose a **Remove highlight/extract** action when a user right-clicks a persisted highlight or extract mark, without requiring a live text selection. This SHALL work in EPUB, PDF fixed layout and reflow, Markdown, HTML, and OCR HTML readers, including these readers opened from the Queue. The action SHALL be available for both newly created and previously saved annotations.

#### Scenario: Remove a newly created highlight
- **WHEN** a user creates a highlight, clears the text selection, and right-clicks its saved mark
- **THEN** the reader shows a context menu containing Remove highlight/extract for that annotation

#### Scenario: Remove an extract after reopening
- **WHEN** a user reopens a document containing a saved extract and right-clicks its marked source passage without selecting text
- **THEN** the reader offers the removal action for that saved extract

#### Scenario: Supported document surfaces
- **WHEN** a user right-clicks a saved mark in an EPUB, fixed-layout PDF, reflow PDF, Markdown, HTML, or OCR HTML reader, opened from Documents or the Queue
- **THEN** the reader offers the same removal behavior at the correct on-screen pointer position

### Requirement: Removal targets the chosen saved annotation

The reader SHALL target the saved annotation at the pointer independently of current selection, matching text elsewhere, or creation order. If multiple saved annotations cover the pointer, the reader SHALL let the user choose one using distinguishable passage previews and available identifying details before removal. Removing any fragment of a multi-page or multi-range extract SHALL remove that complete extract and all its marks, while preserving unrelated annotations.

#### Scenario: Repeated passage text
- **WHEN** two separate saved annotations contain identical text and the user invokes removal on one of their distinct marked locations
- **THEN** only the targeted saved annotation is selected for deletion

#### Scenario: Unrelated live selection
- **WHEN** text elsewhere is selected and the user right-clicks a saved mark
- **THEN** the removal action targets the clicked mark rather than the selected passage

#### Scenario: Annotation overlaps another annotation
- **WHEN** the right-clicked location belongs to multiple saved annotations
- **THEN** the reader offers an explicit choice between them
- **AND** removing the chosen annotation preserves the other saved records and their visible marks

#### Scenario: Extract spans multiple fragments
- **WHEN** the user removes an extract by right-clicking one of its fragments on a page, line, or chapter
- **THEN** the entire saved extract and every corresponding mark are removed
- **AND** the original document text and unrelated annotations remain intact

### Requirement: Removal uses the existing extract deletion semantics

The removal action SHALL identify the targeted passage in the existing extract deletion confirmation flow and explain that the saved extract is being deleted. Confirmation SHALL persistently delete the record backing the mark, using the same deletion semantics as deleting it from the extracts list. Cancellation or dismissing the context menu SHALL leave the annotation unchanged. Removing the saved annotation SHALL NOT alter the source document content or introduce additional deletion of linked flashcards beyond the existing extract deletion policy.

#### Scenario: Confirm removal
- **WHEN** a user selects Remove highlight/extract and confirms deletion of the identified passage
- **THEN** the saved record backing that mark is deleted
- **AND** reopening the document does not restore it

#### Scenario: Cancel removal
- **WHEN** a user cancels the deletion confirmation or dismisses the context menu without choosing removal
- **THEN** the saved annotation and its marks remain unchanged

#### Scenario: Browser and desktop persistence
- **WHEN** the user confirms removal in either the desktop app or browser fallback
- **THEN** the annotation is deleted from that platform's persistent storage and remains absent after reopening

### Requirement: Dependent views reflect successful removal

After successful deletion, the reader SHALL clear all marks for the removed record and update its extracts list, minimap, and document extract count without reloading the document or changing the reading position. Loaded queue views SHALL stop offering the deleted extract as an actionable item. Other saved annotations SHALL remain available.

#### Scenario: Reader updates in place
- **WHEN** removal succeeds while the document remains open
- **THEN** all marks and minimap entries for the deleted extract disappear, and the extracts list and count reflect the deletion
- **AND** the reader retains its reading position and source text

#### Scenario: Removed extract was queued
- **WHEN** a successfully removed extract is present in a loaded queue
- **THEN** the queue refreshes or invalidates that item so it can no longer be opened for review

### Requirement: Failed and stale removal cannot delete another annotation

The reader SHALL retain the saved mark and report an error if persistent deletion fails. A removal started for one document SHALL NOT be applied to another document after navigation. Repeated activation while deletion is pending SHALL NOT produce duplicate deletion effects or count decrements. A stale target already removed elsewhere SHALL be reconciled without affecting another saved record.

#### Scenario: Persistent deletion fails
- **WHEN** deletion fails before the saved record is removed
- **THEN** an error is shown and the annotation remains visible and available for retry

#### Scenario: Reader switches documents
- **WHEN** a menu or confirmation is open for document A and the reader switches to document B
- **THEN** the stale removal interface is dismissed and cannot delete an annotation from document B

#### Scenario: Target already deleted
- **WHEN** the targeted saved annotation is deleted elsewhere before removal is confirmed
- **THEN** the reader reconciles the original document's marks and count without deleting another annotation or decrementing the count twice

#### Scenario: Repeated confirmation
- **WHEN** a user activates confirmation again while the target's removal is pending
- **THEN** only one deletion operation is submitted for that pending action

#### Scenario: Refresh fails after deletion succeeds
- **WHEN** persistence succeeds but refreshing a dependent view fails
- **THEN** the reader keeps the known deleted mark removed and permits view reconciliation without repeating deletion

### Requirement: Annotation menus preserve existing reader interactions

The annotation menu SHALL follow the shared menu positioning, single-menu, dismissal, keyboard navigation, and destructive-action styling contracts. Right-clicking text without a saved annotation SHALL preserve existing selection, link, and native-menu behavior. Temporary search, speech, or language-learning marks SHALL NOT expose saved-annotation removal. Annotation hit testing SHALL preserve ordinary text selection and existing mobile selection gestures.

#### Scenario: No saved annotation under pointer
- **WHEN** a user right-clicks a plain text selection, a link, or unannotated background
- **THEN** the existing applicable menu behavior is preserved and no saved-annotation removal action is offered

#### Scenario: Temporary visual highlight
- **WHEN** a user right-clicks a search or spoken-word highlight with no saved annotation at that location
- **THEN** the reader does not offer removal of a saved highlight/extract

#### Scenario: Shared menu dismissal and keyboard control
- **WHEN** the annotation menu is open and the user navigates its actions with the keyboard, presses Escape, clicks outside, or opens another menu
- **THEN** it follows the same focus, dismissal, and single-menu behavior as the shared application menu

#### Scenario: Normal selection across marks
- **WHEN** a user drags to select text across a saved mark or uses the existing mobile selection gesture
- **THEN** selection continues to work without the removal feature intercepting the gesture
