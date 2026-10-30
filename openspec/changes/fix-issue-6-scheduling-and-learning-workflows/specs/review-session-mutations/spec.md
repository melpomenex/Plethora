## Purpose

Ensure review edits, deletion, rating, refresh, and undo reconcile by persisted entity identity and never create a false review or skip a valid successor.

## ADDED Requirements

### Requirement: Active sessions use complete persisted card identities
Review, Scroll Mode, and Optimal Sessions SHALL present a complete canonical card obtained by stable learning-item identity. A listing row or due-only cache miss SHALL NOT become a fabricated reviewable card. Missing/deleted/suspended cards SHALL be reconciled; temporary load failures SHALL expose retry/skip and withhold rating.

#### Scenario: Card absent from the due-only cache
- **WHEN** a valid custom session references a persisted card missing from the current due-card map
- **THEN** its complete type, source, cloze, and interaction data are loaded by card identity before presentation

### Requirement: Deletion removes and advances exactly once without review
A successful card deletion SHALL remove all active representations, advance the current identity to the next surviving successor, preserve an unrelated current identity, and record no review. Deleting the final current item SHALL select a preceding survivor or complete an empty session. Reviewed, removed, and remaining counts SHALL stay distinct.

#### Scenario: Delete first middle last and only card
- **WHEN** the current card is deleted at the first, middle, last, or only position
- **THEN** it disappears without rating, exactly one valid successor/predecessor is selected where available, and an empty session completes gracefully

#### Scenario: Current identity changes while deletion awaits
- **WHEN** deletion commits after the user has moved to a different valid item
- **THEN** only the deleted identity is removed and the new current item is not advanced again

### Requirement: Refresh and competing mutations cannot resurrect or overwrite state
Session reconciliation SHALL exclude committed deletions and preserve newer committed edits across late refreshes, static custom input, and tab changes. Only one conflicting mutation per entity SHALL be pending. Rating, deletion, and edit requests SHALL NOT submit through one another or manufacture review events.

#### Scenario: Late refresh contains a deleted card
- **WHEN** a refresh started before a delete returns its old queue after deletion commits
- **THEN** the card remains absent and the successor is not skipped

#### Scenario: Deletion during rating
- **WHEN** a rating is pending and the user activates delete repeatedly
- **THEN** delete is unavailable until the rating resolves and no concurrent delete or extra review occurs

### Requirement: Undo restores data without stealing position
Undoable deletion SHALL restore the original identity, content, scheduling, and supported source links only after persistence succeeds. Undo SHALL remove the deletion barrier, restore a suitable relative slot, and preserve the current item; undoing the only-card deletion SHALL reopen that restored card. Failure SHALL remain visible without restoring a phantom copy.

#### Scenario: Undo with a stale queue response pending
- **WHEN** deletion is undone while an earlier refresh is pending
- **THEN** one restored card appears, its history is unchanged, and stale data cannot duplicate it

### Requirement: Mutation success corresponds to authoritative persisted state
Session advancement or committed edit success SHALL follow one durable result. Failed writes SHALL retain a recoverable current item/draft and show a readable error. Each successful explicit rating SHALL advance once, with retry protection where persistence outcome may be uncertain.

#### Scenario: Delete or edit fails
- **WHEN** the authoritative mutation rejects
- **THEN** the session does not falsely complete or advance and retry remains available
