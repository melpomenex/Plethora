## ADDED Requirements

### Requirement: Scoped loading state ownership in document viewer
`DocumentViewer` SHALL scope source-level loading indicators (`isSourceLoading`) strictly to the document reader viewport (`viewMode === "document"`). Subviews such as Extracts (`viewMode === "extracts"`) and Cards (`viewMode === "cards"`) SHALL NOT be blocked or hidden by source preparation.

#### Scenario: Document source loading does not blank extracts
- **WHEN** a document's file bytes or streaming URLs are loading and `viewMode` is set to `"extracts"`
- **THEN** `DocumentViewer` renders `<ExtractsList />` directly rather than the full-screen "Loading document..." indicator

### Requirement: Monotonic load generation tracking for document source loading
All asynchronous operations inside `loadDocumentData` SHALL be tracked by a monotonic load-generation identifier. Any asynchronous completion arriving after a newer load generation has begun SHALL be ignored and SHALL NOT mutate file buffers, streaming URLs, media sources, error messages, or loading flags.

#### Scenario: Superseded document load does not corrupt active document
- **WHEN** loading Document A begins, and the user switches to Document B before Document A finishes
- **THEN** Document A's late-arriving byte stream or URL is ignored, and Document B's state remains intact and authoritative

### Requirement: Terminal readiness validation for loaded document markers
The system SHALL NOT mark a document as loaded (e.g. `lastLoadedDocumentIdRef`) merely because loading was initiated. The loaded marker SHALL be recorded only when the source loading pipeline reaches a verified terminal ready state. If source loading fails or is cancelled, the marker SHALL remain unassigned so subsequent re-entries can trigger a clean reload.

#### Scenario: Failed load is not permanently marked as loaded
- **WHEN** a document source load fails due to an error or incomplete file path
- **THEN** `lastLoadedDocumentIdRef` is not set to that document ID, allowing a subsequent navigation or file-path arrival to re-attempt loading

### Requirement: Deterministic first-attempt view transitions
Navigating between Document, Extracts, and Learning Cards views SHALL successfully render the target view on the first attempt without requiring the user to navigate away and back.

#### Scenario: Direct switch to Extracts renders immediately
- **WHEN** the user taps the Extracts toggle button from Document mode
- **THEN** the Extracts list renders on the first interaction without getting stuck in an indefinite loading state

### Requirement: Bounded actionable error states with inline retry
When document source loading or subview data fetching encounters a failure, the system SHALL transition to a bounded error UI containing an explicit failure explanation and an actionable "Retry" control. The system SHALL NOT leave a spinner active indefinitely.

#### Scenario: Source load failure displays retry button
- **WHEN** reading a document file fails due to an I/O error
- **THEN** `DocumentViewer` displays an inline error message and a "Retry" button that re-initiates `loadDocumentData` when clicked
