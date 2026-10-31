## Purpose

Ensure that users can set and observe the same item priority across queue, library, and reading surfaces regardless of item type or input method.

## ADDED Requirements

### Requirement: Priority editing targets every queue and library item
The system SHALL provide priority editing for every item type presented in the queue or library, including documents, extracts, and flashcards. On a surface with an active or selected item, the configured priority shortcut (Alt+P by default) SHALL open an editor for that item or selection; a displayed priority indicator SHALL provide an equivalent pointer or touch editing path. The system SHALL resolve each displayed item to its own persistent priority identity and SHALL NOT silently substitute its parent or another item.

#### Scenario: Extract shortcut and overlay agree
- **WHEN** the user opens an extract in Scroll Queue, presses Alt+P, chooses a new priority, and confirms with Enter
- **THEN** reopening the overlay priority indicator SHALL show the committed priority for that extract
- **AND** the parent document's priority SHALL remain unchanged

#### Scenario: Flashcard priority can be edited
- **WHEN** the user opens a flashcard in Scroll Queue and sets its priority using the configured shortcut or overlay control
- **THEN** the flashcard's own priority SHALL be saved and shown by both entry points

#### Scenario: Other displayed item types
- **WHEN** an item of any other type is offered in the queue or library
- **THEN** its priority editor SHALL target a stable priority-bearing identity for that item and persist its change

#### Scenario: Customized shortcut
- **WHEN** the user changes the priority shortcut in shortcut settings
- **THEN** applicable surfaces SHALL honor the configured shortcut instead of requiring the default

### Requirement: Priority readback is consistent across surfaces
The system SHALL show the committed user-facing priority on every applicable surface for the same item, including after navigation, refresh, and application restart. The displayed 0–100 value SHALL preserve an explicitly set zero and SHALL NOT mistake an internal ordering key for the user-facing value. Priority changes SHALL be reflected in subsequent queue ordering according to the existing priority ordering rules.

#### Scenario: Persist and reopen across surfaces
- **WHEN** a user sets an extract or flashcard to priority 73 in a queue and then opens the same item in the library or another available priority surface after reload
- **THEN** the priority control SHALL show 73 and the saved item SHALL retain the corresponding queue priority

#### Scenario: Explicit zero survives reload
- **WHEN** the user sets priority 0 on any supported item and reloads it
- **THEN** the priority control SHALL show 0 rather than a default or inherited value

#### Scenario: Keyboard and pointer changes round-trip
- **WHEN** a user saves a new priority with the keyboard and subsequently changes it using the priority indicator
- **THEN** both controls SHALL reflect the latest successful value for the same item

### Requirement: Priority changes respect item identity and failure
The system SHALL bind a priority edit and its asynchronous completion to the item or selection being edited. A failed save SHALL be reported, SHALL NOT be presented as successful, and SHALL allow retry; cancelling an uncommitted edit SHALL leave persisted priority unchanged.

#### Scenario: Navigation while saving
- **WHEN** a priority save for item A is pending and the user navigates to item B
- **THEN** completion of A's save SHALL NOT alter B's displayed or persisted priority

#### Scenario: Save failure and retry
- **WHEN** a priority save fails
- **THEN** the user SHALL see a failure and retain a way to retry the intended value
- **AND** reopening or refreshing SHALL NOT claim that the failed value was persisted

#### Scenario: Cancel an edit
- **WHEN** the user changes a priority draft and cancels it
- **THEN** the persisted priority SHALL remain unchanged
