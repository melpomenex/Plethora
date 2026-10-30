## MODIFIED Requirements

### Requirement: Edit the current card during review
Review, Scroll Mode, Optimal Sessions, and document-linked learning-card views SHALL provide an enabled Edit action that opens the same canonical card editor for the selected persisted identity without resetting the active session. Review SHALL retain its on-card control and Cmd/Ctrl+E shortcut. Edit SHALL be unavailable during a conflicting rating/arena/mutation submission. Enabled document-linked pencil controls SHALL work in supported native WebViews without depending on browser prompt dialogs.

#### Scenario: Keyboard shortcut opens the editor
- **WHEN** the user presses Cmd/Ctrl+E in Review with a current card and no submission or arena decision in flight
- **THEN** the inline editor opens over the session

#### Scenario: On-card edit control
- **WHEN** the user activates the Edit control on the review card
- **THEN** the editor opens for that card's persisted identity

#### Scenario: Editor unavailable during submission
- **WHEN** a rating, algorithm arena decision, or conflicting mutation is pending
- **THEN** Edit is disabled and does not open another editor

#### Scenario: Document-associated pencil activation
- **WHEN** the user activates an enabled pencil in the document's learning cards by pointer or keyboard
- **THEN** the same editor opens for the intended card with focus inside it

### Requirement: Cloze text editable in the inline editor
The editor SHALL allow raw cloze editing and real hidden/revealed previews using the same semantics as review. Legacy range-backed source SHALL have a lossless editing projection preserving its deletions. Saving SHALL update the canonical cloze source, mirror the question, and reconcile cached ranges without altering scheduling. Marker-free saves SHALL remain accepted with a warning; invalid review data SHALL enter repair state rather than leak hidden content.

#### Scenario: Editing a cloze card
- **WHEN** the user modifies and saves raw cloze text
- **THEN** cloze source and mirrored question persist and the active card renders the new deletion semantics

#### Scenario: Saving without a cloze marker
- **WHEN** the user saves text without any cloze marker
- **THEN** the save succeeds, warns that no marker is present, and subsequent review does not pretend there is a hideable answer

#### Scenario: Legacy editing and formatting
- **WHEN** a valid marker-free range cloze is opened and edited
- **THEN** its answer spans are represented understandably and survive save/reload with formatting intact

### Requirement: Edits persist without scheduling changes
Saving content, cloze data, and tags SHALL atomically persist the complete edit and its prior version, including cloze/ranges/tags where available, with supported sync journaling. Omitted fields SHALL remain unchanged and intentional empty strings SHALL clear their fields. Due date, interval, counts, lapses, memory, algorithm state, source linkage, manual priority, and review history SHALL remain unchanged. Local persistence SHALL work while synchronization is unavailable.

#### Scenario: Content persists directly
- **WHEN** an edit succeeds while sync is unavailable and the app restarts
- **THEN** the complete committed content is read back

#### Scenario: Scheduling untouched by edit
- **WHEN** the user saves an edit during review
- **THEN** scheduling/history and manual priority remain identical to their pre-edit values

#### Scenario: Tag edits persist
- **WHEN** tags and cloze content are saved together
- **THEN** both survive reload with one consistent version snapshot

#### Scenario: Atomic failure and version restore
- **WHEN** any field/version/journal write fails or a saved version is restored
- **THEN** failed edits leave no partial durable content and restoration covers the fields actually captured without rescheduling

### Requirement: Session continues with the edited card
Saving SHALL update every active representation of the card in place at the same session identity/position, retaining optimistic feedback with revision-safe rollback on failure. A canonical committed result SHALL supersede optimistic content. A stale completion/refresh SHALL NOT overwrite a newer edit or another card. Failed saves SHALL preserve the draft and show an actionable error.

#### Scenario: Save updates the in-flight card
- **WHEN** the user saves an edit
- **THEN** the active card reflects the edit without a queue reload or movement to another item

#### Scenario: Save failure rolls back
- **WHEN** persistence fails
- **THEN** the session returns to the prior committed version, shows an error, and retains the attempted draft for retry

#### Scenario: Late result after navigation
- **WHEN** a save result arrives after the user changes the visible card
- **THEN** only its original card identity is patched and the new current card/position stays unchanged
