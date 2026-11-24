## ADDED Requirements

### Requirement: Document interval modifiers persist and affect scheduling

`update_document` SHALL persist `interval_modifier` in SQLite and journal `"schedule"` sync fields, and scheduling calculations SHALL apply the persisted modifier without silently resetting it to `1.0`.

#### Scenario: Interval modifier persists across reload and lengthens next interval
- **WHEN** a user sets a document's interval modifier to `1.5` and saves
- **THEN** reloading the document returns `intervalModifier === 1.5`
- **AND** rating the document produces a longer interval than with `1.0`

### Requirement: Parked count matches visible Parked documents

The Library sidebar `Parked` count SHALL use the same active search, file-type, and category filter predicates as the main document list so the displayed count agrees with the visible Parked items.

#### Scenario: Filtering by category updates Parked count to match visible items
- **WHEN** 9 documents are parked globally but 0 match the active `Finance` category filter
- **THEN** the Parked count under that filter reports `0` (matching the 0 displayed documents)

### Requirement: Schedule View opens the exact selected entity

Selecting an item in Schedule View SHALL open that exact entity by its typed identifier (`document`, `extract`, or `learning-item`), fetching future-scheduled items when not in the current due queue, and never substituting `queue[0]`.

#### Scenario: Studying a future-scheduled card from Schedule View opens that exact card
- **WHEN** the user clicks Study Now on a future-scheduled card in Schedule View
- **THEN** the Review session opens that exact card rather than the first due card in `queue[0]`

### Requirement: Suspended documents display Unsuspend and are discoverable

Documents with `isDismissed === true` SHALL display a `Suspended` indicator, offer `Unsuspend` in context menus and bulk actions, and be discoverable via a `Suspended` Library filter.

#### Scenario: Suspended document shows Unsuspend action and badge
- **WHEN** a document is suspended
- **THEN** its row/card displays a `Suspended` badge and its context menu offers `Unsuspend` instead of `Suspend`
