## MODIFIED Requirements

### Requirement: Instant highlight creation without dialog
When a user triggers the highlight action from any viewer (PDF selection popup, EPUB selection, HTML selection, RSS selection, or viewer toolbar), the system SHALL create the extract immediately without opening a modal dialog and SHALL return an awaitable promise representing the persistence lifecycle.

#### Scenario: PDF highlight via selection popup
- **WHEN** user selects text in a PDF and clicks the "Highlight" button in the `SelectionPopup`
- **THEN** the system creates an extract with the selected text using the default highlight color, flashes the selection, and shows a success toast notification

#### Scenario: EPUB highlight via selection
- **WHEN** user selects text in an EPUB and triggers the highlight action
- **THEN** the system creates an extract with the selected text using the default highlight color and shows a success toast notification

#### Scenario: HTML/Markdown viewer highlight
- **WHEN** user selects text in the HTML/Markdown viewer and triggers the highlight action
- **THEN** the system creates an extract with the selected text using the default highlight color and shows a success toast notification

#### Scenario: RSS article highlight
- **WHEN** user selects text in an RSS article and triggers the highlight action
- **THEN** the system creates an extract with the selected text using the default highlight color and shows a success toast notification

## ADDED Requirements

### Requirement: Extraction creation exposes an observable asynchronous contract
Every extract creation function in the viewer and selection interaction lifecycle SHALL return an awaitable promise (`Promise<Extract | null>`) that resolves with the persisted extract record on success or resolves to null / rejects on failure, enabling invoking components to observe in-flight progress, success, and error outcomes.

#### Scenario: Awaiting extract persistence
- **WHEN** a UI component invokes `createInstantExtract` or `onCreateExtractFromResult`
- **THEN** the returned Promise remains pending while persistence is in-flight, resolves with the created `Extract` object upon SQLite commit, and triggers error handling if persistence fails

### Requirement: AI result extract promotion enforces single-submit lifecycle
When a user taps "Create Extract" or "Create Extract from Result" on an AI output (Explain, Summarize, Simplify, Key Terms, Ask), the hosting interface SHALL immediately enter an in-flight saving state, disable the action button, prevent repeated invocations, and dismiss the result surface only after successful persistence.

#### Scenario: Single-submit saving transition
- **WHEN** the user taps "Create Extract from Result" in `SelectionActionsSheet`
- **THEN** the button immediately enters a disabled saving state, executes the extract creation asynchronously, and ignores any subsequent clicks during the save operation

#### Scenario: Dismissal and feedback upon successful save
- **WHEN** extract creation from an AI result completes successfully
- **THEN** the system displays a success toast notification, notifies the selection controller that the action settled, and dismisses the selection actions sheet

#### Scenario: Error recovery on failed save
- **WHEN** extract creation from an AI result fails
- **THEN** the system displays an error toast notification, preserves the generated AI text in the sheet, and restores the "Create Extract from Result" button to an enabled, retryable state

### Requirement: Duplicate extract prevention across in-flight and settling states
The extract creation pipeline SHALL prevent duplicate extract records from being created when a user rapidly clicks or taps extract actions. Deduplication SHALL be enforced both at the UI layer through state-driven button disabling and at the hook layer via an in-flight key registry.

#### Scenario: Rapid double click on create extract
- **WHEN** a user rapidly clicks "Create Extract" multiple times in quick succession
- **THEN** exactly one extract record is persisted in the database and exactly one success notification is emitted

### Requirement: Post-persistence immediate extract collection coherency
Upon successful persistence of an extract, all active extract collections for the associated document SHALL immediately update to include the new record without requiring an application restart, page reload, tab switch, or component remount.

#### Scenario: Extract immediately visible in Extracts view
- **WHEN** an extract is created from a document selection or AI result
- **THEN** switching to or viewing the document's Extracts view immediately displays the newly created extract card
