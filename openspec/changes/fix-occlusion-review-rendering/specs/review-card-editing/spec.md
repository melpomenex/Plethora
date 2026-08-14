## ADDED Requirements

### Requirement: Edit the current card during review
The review session SHALL provide an Edit action for the current card, reachable from an on-card control and the Cmd/Ctrl+E keyboard shortcut, that opens the inline card editor over the session without ending or resetting the session.

#### Scenario: Keyboard shortcut opens the editor
- **WHEN** the user presses Cmd/Ctrl+E during a review session with a current card and no submission or arena decision in flight
- **THEN** the inline card editor opens over the session instead of showing the "not available" placeholder

#### Scenario: On-card edit control
- **WHEN** the user activates the Edit control on the review card
- **THEN** the inline card editor opens for the current card

#### Scenario: Editor unavailable during submission
- **WHEN** a rating submission or algorithm arena decision is in flight
- **THEN** the Edit action is disabled and does not open the editor

### Requirement: Cloze text editable in the inline editor
The inline card editor SHALL allow editing the raw cloze text (including cloze markers) for cloze cards, with a rendered preview of the result, and SHALL accept saves that contain no cloze marker while warning the user.

#### Scenario: Editing a cloze card
- **WHEN** the user opens the inline editor on a cloze card, modifies the cloze text, and saves
- **THEN** the card's cloze text is updated, the question field mirrors the new cloze text, and the review card re-renders the updated cloze

#### Scenario: Saving without a cloze marker
- **WHEN** the user saves a cloze card whose edited text contains no cloze marker
- **THEN** the save succeeds and the user is warned that no cloze marker is present

### Requirement: Complex types hand off to the Studio
The inline card editor SHALL route complex interaction types (such as image occlusion and multiple choice) to the existing Studio editing flow instead of offering in-place field editing.

#### Scenario: Editing an image-occlusion card during review
- **WHEN** the user opens the editor on a card with a complex interaction type
- **THEN** the editor shows the card's question read-only and offers the existing "Edit in Studio" action

### Requirement: Edits persist without scheduling changes
Saving an edit from the review session SHALL persist the card's content fields (question, answer, cloze text) and tags through a direct database update, SHALL record a version snapshot, and SHALL NOT modify the card's scheduling state (due date, interval, review history, memory state).

#### Scenario: Content persists directly
- **WHEN** the user saves an edit to a card's content during review and the sync subsystem is unavailable
- **THEN** the edited content is still readable after a reload of the app

#### Scenario: Scheduling untouched by edit
- **WHEN** the user saves an edit during review
- **THEN** the card's due date, interval, review count, lapses, and memory state are unchanged

#### Scenario: Tag edits persist
- **WHEN** the user changes the card's tags in the inline editor and saves
- **THEN** the tags are persisted through the tag update path and survive a reload

### Requirement: Session continues with the edited card
Saving an edit during review SHALL update the current card in the session in place, with an optimistic update that rolls back if persistence fails, and the session SHALL continue from the same position.

#### Scenario: Save updates the in-flight card
- **WHEN** the user saves an edit
- **THEN** the current card in the session reflects the edited content immediately without a queue reload

#### Scenario: Save failure rolls back
- **WHEN** persistence of an edit fails
- **THEN** the session card reverts to its prior content and the user is shown an error
