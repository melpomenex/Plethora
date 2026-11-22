## MODIFIED Requirements

### Requirement: Native OS tray menu provides quick learning workflow actions

On desktop platforms, the native system tray menu SHALL provide Open Plethora, Open Queue, Start Review, Continue Reading, Import Document…, Learning Insights, Settings, Hide Plethora, and Quit Plethora, while preserving close-to-quit window behavior.

#### Scenario: Selecting a tray workflow action focuses the window and navigates

- **WHEN** the user selects Open Queue, Start Review, Continue Reading, Import Document…, Learning Insights, or Settings from the tray menu
- **THEN** the main window is shown, unminimized, and focused
- **AND** the frontend dispatches the canonical destination or action (buffering if selected before frontend initialization completes)

## ADDED Requirements

### Requirement: Dashboard surfaces compact Sleep & Learning Insights

The main Dashboard SHALL display a non-blocking, dismissible Sleep & Learning card showing up to three real metrics, a 7-day visual summary, and at most one evidence-backed insight (or an actionable empty state when no sleep data exists), with a link to Learning Insights.

#### Scenario: Dashboard displays Sleep & Learning summary without blocking render

- **WHEN** the Dashboard loads with or without wearable sleep data
- **THEN** the Dashboard renders immediately and surfaces either up to three real metrics plus a 7-day bar strip or a dismissible empty state linking to Learning Insights

### Requirement: AI Flashcard Studio uses a distinct toolbar icon

AI Flashcard Studio launchers in the document reader toolbars SHALL use `CardsThree` while View Learning Cards retains `Brain`.

#### Scenario: Reader toolbar distinguishes Learning Cards and AI Flashcard Studio

- **WHEN** the document reader toolbar renders on desktop or mobile
- **THEN** View Learning Cards uses `Brain` and AI Flashcard Studio uses `CardsThree`

### Requirement: Handbook uses canonical SM-18 and SM-20 scheduler terminology

User-facing Handbook documentation SHALL refer to `SM-18` and `SM-20` instead of `SM-18` and `SM-20`, accurately distinguishing the pure SM-20 kernel from the Algorithm Arena ensemble, without renaming internal serialized IDs.

#### Scenario: Handbook reflects SM-18 and SM-20 terminology

- **WHEN** a user reads the scheduling sections of `docs/USER_HANDBOOK.md`
- **THEN** `SM-18` and `SM-20` are used consistently while preserving `Algorithm Arena` attribution and serialized IDs

### Requirement: Reader due-date badge supports interactive rescheduling

Clicking the overdue or due-date badge in `DocumentViewer` SHALL open an accessible rescheduling control with relative-to-today presets and custom date selection that updates `nextReadingDate`, preserves reading progress and review history, synchronizes stores, and supports Undo.

#### Scenario: Rescheduling an overdue document from the reader header

- **WHEN** the user clicks the overdue badge in `DocumentViewer` and selects Tomorrow (or a custom date)
- **THEN** `nextReadingDate` updates relative to today without altering reading progress or review history
- **AND** an Undo toast restores the previous date if no newer change superseded it
