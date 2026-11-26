## ADDED Requirements

### Requirement: Complete Saved View Lifecycle Management

Users SHALL be able to create, apply, rename, update with current filters, duplicate, reorder (move up/down), clear active selection, and delete saved views in `DocumentsView` on both desktop and mobile, with all changes persisted under `documentsSavedViews`.

#### Scenario: Deleting an inactive or active saved view preserves library data and working filters
- **WHEN** the user deletes a saved view by its stable ID
- **THEN** only that saved view configuration is removed from persisted storage and UI lists
- **AND** no documents, extracts, flashcards, or tags are deleted
- **AND** if the deleted view was active, `activeViewId` is cleared while current search, filters, sorting, and layout remain intact

#### Scenario: Undoing saved view deletion restores configuration without clobbering newer edits
- **WHEN** the user triggers Undo from the deletion toast after deleting a saved view
- **THEN** the deleted view is restored with its original ID, name, configuration, and approximate position
- **AND** any changes made to other saved views after the deletion are preserved

#### Scenario: Multiple mounted DocumentsView instances stay synchronized
- **WHEN** two `DocumentsView` instances are mounted simultaneously and a saved view is created, renamed, reordered, or deleted in one
- **THEN** the other instance reflects the updated saved views without overwriting `documentsSavedViews`
