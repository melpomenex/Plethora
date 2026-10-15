## Purpose

Enables exporting study decks to Anki package (.apkg) files from the Review View context menu with native save destination selection and exact card membership resolution.

## ADDED Requirements

### Requirement: Deck context menu exports to .apkg via file save dialog
The system SHALL present a native file save dialog when the user selects "Export as .apkg" from any deck context menu in Review View, allowing the user to select the destination path and filename before initiating the export.

#### Scenario: User selects export destination and completes export
- **WHEN** user right-clicks a deck in Review View and selects "Export as .apkg"
- **THEN** a native save file dialog appears prefilled with the sanitized deck name and .apkg extension
- **WHEN** user confirms a destination path
- **THEN** the system exports the deck cards to the selected file path and displays a success toast notification

#### Scenario: User cancels export file dialog
- **WHEN** user opens the export dialog and cancels or closes the file picker
- **THEN** no export is performed and no error toast is displayed

### Requirement: Robust card membership resolution for deck export
The system SHALL resolve all learning items belonging to the deck (via matching deck tag filters, document associations, or explicit card IDs) when exporting to .apkg, and SHALL fail gracefully with a descriptive error message if the deck contains no cards.

#### Scenario: Exporting a deck with tag filters or custom tags
- **WHEN** user exports a deck whose cards match via configured tag filters or card IDs
- **THEN** the backend packages all matching cards and their review logs into the .apkg file without failing on exact-tag mismatches

#### Scenario: Exporting an empty deck
- **WHEN** user attempts to export a deck that has no matching cards
- **THEN** the system informs the user that the deck contains no cards to export
