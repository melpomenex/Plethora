## ADDED Requirements

### Requirement: Actions capture an immutable selection snapshot at invocation
When the user invokes any selection action, the system SHALL capture an application-owned immutable snapshot at invocation time containing at least the selected text, surrounding passage context, the surface's selection context/anchor representation, document and reader-surface identity, and best-effort selection geometry. From invocation onward, execution of the action SHALL NOT depend on the browser or native selection continuing to exist: collapse of the DOM selection, focus changes, rerenders, or dismissal of the live selection SHALL NOT cancel, corrupt, or blank the operation or its UI.

#### Scenario: Native selection collapses after invocation
- **WHEN** the user taps Summarize and the native selection subsequently collapses
- **THEN** the summarize operation SHALL continue using the text captured at invocation and its loading/result UI SHALL remain visible

#### Scenario: Document scrolls during processing
- **WHEN** the user scrolls the selected passage out of the viewport while an action is processing
- **THEN** the operation SHALL complete and present its result inside the visible viewport, not at the selection's original coordinates

### Requirement: Visible loading state for asynchronous selection actions
Upon invoking an asynchronous selection action, the system SHALL immediately present an explicit loading/progress state that is visibly connected to the selection interaction and exposes accessible busy state. The action UI SHALL NOT silently disappear between invocation and completion.

#### Scenario: Loading state appears
- **WHEN** the user taps an asynchronous action such as Summarize, Explain, or Ask
- **THEN** a visible loading indicator replaces the action choices in the same contextual UI, and no silent dismissal occurs while the request is in flight

### Requirement: Results remain visible until deliberately dismissed
When an asynchronous selection action completes, the system SHALL render the result in the user's visible viewport, associated with the captured selection, and SHALL keep it visible until the user deliberately dismisses it (close control, scrim tap, Escape, or back navigation) or a genuine reading-context transition occurs (document switch, chapter navigation). Content scrolls and native-selection changes alone SHALL NOT dismiss a running or completed action UI.

#### Scenario: Result stays after completion
- **WHEN** an action completes successfully
- **THEN** the result remains displayed with actions such as Copy/Retry/Close until the user dismisses it

#### Scenario: Selection cleared before completion
- **WHEN** the DOM selection is cleared or changes while the action UI shows loading or a result
- **THEN** the loading/result UI remains open and unaffected

### Requirement: Visible failure state with retry
If a selection action fails, the system SHALL present a visible error state associated with the captured selection with a retry affordance, and SHALL preserve the captured snapshot so retry does not require re-selecting the text. The UI SHALL NOT silently dismiss on failure.

#### Scenario: Failure shows error and retry
- **WHEN** an invoked action fails
- **THEN** an error message with Retry and Close controls is displayed in the action UI, and Retry re-executes the action against the same captured selection

### Requirement: No stale responses across selections and contexts
Each selection-action execution SHALL carry a unique operation identity bound to the selection snapshot that initiated it. Results or errors from an operation SHALL only ever be presented while that operation is still the active one; responses arriving after a newer action invocation, after deliberate dismissal, or after a reading-context transition (document change, EPUB chapter navigation, reflow regeneration) SHALL be discarded. Context transitions SHALL abort in-flight operations.

#### Scenario: Newer action supersedes an older response
- **WHEN** the user invokes an action on one selection and then invokes another action on a different selection before the first completes
- **THEN** the first operation is aborted or its result discarded, and only the second operation's result is presented

#### Scenario: Document switch aborts
- **WHEN** the user switches documents or EPUB chapters while an action is running
- **THEN** the in-flight operation is aborted and its result cannot appear over the new reading context

### Requirement: Existing selection features receive the captured text
All existing selection actions — highlighting, extracting, flashcard creation, copying, dictionary lookup, summarization, explanation, simplification, key-terms, ask, and any feature-flagged selection actions — SHALL continue to operate and SHALL receive exactly the text and context captured at invocation time.

#### Scenario: Highlight and extract use captured selection
- **WHEN** the user invokes Highlight or Create Extract from the selection UI on any reader surface
- **THEN** the created highlight/extract contains the captured selected text with correct location context (EPUB CFI or PDF page/anchor data)

#### Scenario: AI actions use captured text and passage
- **WHEN** the user invokes Summarize, Explain, or another AI action after the selection has collapsed
- **THEN** the AI request is built from the captured text and passage context, not from a re-read of live selection state
