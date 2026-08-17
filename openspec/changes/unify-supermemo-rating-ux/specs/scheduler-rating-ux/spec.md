## ADDED Requirements

### Requirement: Scheduler exposes a rating schema
The system SHALL derive the rating schema from the active scheduling algorithm through a single shared frontend abstraction (e.g. `getRatingSchema(algorithm)` / `useRatingSchema`), declaring at minimum the schema type (`"supermemo"` six-grade vs. four-grade) and its grade values. View code (Queue, Review, Zen) MUST NOT hard-code algorithm-name checks (e.g. `algorithm === "sm18" || algorithm === "sm20"`) to select a rating interface.

#### Scenario: SM-18 active
- **WHEN** the active scheduling algorithm is `sm18`
- **THEN** the rating schema reports the SuperMemo six-grade type with grades `0,1,2,3,4,5`

#### Scenario: SM-20 active
- **WHEN** the active scheduling algorithm is `sm20`
- **THEN** the rating schema reports the SuperMemo six-grade type with grades `0,1,2,3,4,5`

#### Scenario: Four-grade algorithm active
- **WHEN** the active scheduling algorithm is a four-grade scheduler (e.g. `fsrs`, `sm2`)
- **THEN** the rating schema reports the four-grade type with values `1,2,3,4`

#### Scenario: Future six-grade scheduler
- **WHEN** a new SuperMemo-style algorithm is added and registered with the six-grade schema
- **THEN** Queue and Review display the SuperMemo rating interface without further view-code changes

### Requirement: Desktop presents SuperMemo grades as six buttons
On non-touch (desktop) form factors, when the active schema is SuperMemo six-grade, both Queue and Review SHALL present the same six explicit grade buttons (grades 0–5, identical ordering, labels, tooltips, colors, and keyboard shortcuts 0–5) using a shared control — for items the SuperMemo scheduler actually schedules (flashcards). Items scheduled by four-grade schedulers (documents via the FSRS-6 engagement scheduler, extracts) keep the four-rating UI in both views regardless of the flashcard algorithm.

#### Scenario: Desktop Queue flashcard with SM-20
- **WHEN** a desktop user rates a Queue flashcard while SM-20 is active
- **THEN** six SuperMemo rating buttons are shown, identical in labels/ordering/shortcuts to Review's

#### Scenario: Desktop Queue flashcard with SM-18
- **WHEN** a desktop user rates a Queue flashcard while SM-18 is active
- **THEN** six SuperMemo rating buttons are shown

#### Scenario: Desktop Queue document keeps four ratings under SM-20
- **WHEN** a desktop user rates a Queue document while SM-18 or SM-20 is active
- **THEN** the existing four-rating orb rail is shown (documents are scheduled by the FSRS-6 engagement scheduler), and number keys 1–4 submit plain ratings with no grade

#### Scenario: Desktop Review unchanged
- **WHEN** a desktop user opens Review while SM-18 or SM-20 is active
- **THEN** the existing six-button interface is presented with unchanged labels, ordering, shortcuts, tooltips, and accessibility attributes

### Requirement: Mobile presents SuperMemo grades via the shared joystick
On touch form factors, when the active schema is SuperMemo six-grade, both Queue and Review SHALL use the same gesture joystick rating control (`useRatingJoystick` + `RatingJoystick`) with identical H-zone layout, grade mapping, dead-zone, haptic detents, visual feedback, and release-commit behavior — for flashcards (the SuperMemo-scheduled item type); four-grade items keep their existing touch UI. Queue MUST reuse the shared implementation, not a copy.

#### Scenario: Mobile Queue flashcard with SM-18
- **WHEN** a touch user rates a Queue flashcard while SM-18 is active
- **THEN** the same joystick interaction used by mobile Review is available and all six grades are distinctly selectable

#### Scenario: Mobile Queue flashcard with SM-20
- **WHEN** a touch user rates a Queue flashcard while SM-20 is active
- **THEN** the same joystick interaction used by mobile Review is available

#### Scenario: Mobile Review unchanged
- **WHEN** a touch user rates in Review while SM-18 or SM-20 is active
- **THEN** the joystick retains its current touch behavior, zone layout, grade labels, animation, haptics, and accessibility fallback

### Requirement: Four-grade algorithms keep four-rating UI
When the active schema is four-grade, Queue and Review SHALL present the existing four-rating interface and semantics on both platforms. The SuperMemo six-grade UI MUST NOT appear for four-grade algorithms.

#### Scenario: Queue with FSRS
- **WHEN** the active algorithm is `fsrs` (or any four-grade scheduler)
- **THEN** Queue shows the existing four-rating controls and submits ratings 1–4

#### Scenario: Review with FSRS
- **WHEN** the active algorithm is four-grade
- **THEN** Review shows the existing four-rating controls

### Requirement: Grade-preserving submission pipeline
When a SuperMemo six-grade schema is active, the user's exact selected grade (0–5) SHALL reach the flashcard scheduler unchanged from both Queue and Review. No intermediate normalization to four ratings MAY occur, each of the six UI choices MUST map to a distinct scheduler grade, and Queue and Review MUST produce identical scheduler inputs for the same grade selection. Non-flashcard submissions are unaffected (documents/extracts always submit 1–4 ratings through their own four-grade schedulers).

#### Scenario: Each Queue grade reaches the scheduler
- **WHEN** the user selects each of grades 0,1,2,3,4,5 on a Queue flashcard under SM-18 or SM-20
- **THEN** `submit_review` receives each distinct grade via the native-grade path with no `rating_to_grade` collapse

#### Scenario: Queue and Review equivalence
- **WHEN** the same grade is selected in Queue and in Review under the same algorithm
- **THEN** the persisted review events carry identical rating/grade values

#### Scenario: Four-grade scheduler unaffected
- **WHEN** a four-grade algorithm is active
- **THEN** submissions continue to send ratings 1–4 and existing scheduling behavior is unchanged

### Requirement: Shared grade semantics between views
Grade ordering, labels, descriptions/tooltips, colors, accessibility names, and grade↔rating equivalences for the SuperMemo scale SHALL come from a single shared definition consumed by Queue and Review (buttons, joystick, and keyboard handlers alike).

#### Scenario: Consistent labels
- **WHEN** grade 3 is displayed in Queue and in Review
- **THEN** both use the same label, description, and color from the shared definition

### Requirement: Queue workflow preserved with SuperMemo ratings
Adopting the schema-driven rating control in Queue MUST NOT regress item advancement, review-event persistence, scheduling-state updates, dismissing/completing items, optimistic UI updates, undo, scrolling, transitions, statistics, sync, or offline behavior. Keyboard rating in Queue SHALL accept 0–5 on flashcards under six-grade schemas (and keep 1–4 for four-grade schemas and for non-flashcard items, matching their on-screen four-rating controls).

#### Scenario: Queue advances after grading
- **WHEN** a user grades a Queue flashcard via the joystick (or six buttons) under SM-20
- **THEN** the item's review event persists, scheduling state updates, and Queue advances to the next item

#### Scenario: Queue keyboard shortcuts
- **WHEN** a desktop Queue user presses `0`–`5` on a flashcard under a six-grade schema
- **THEN** the corresponding grade is submitted

#### Scenario: Queue document keyboard shortcuts unchanged
- **WHEN** a desktop Queue user presses `1`–`4` on a document (any algorithm)
- **THEN** the plain 1–4 rating matching the orb rail is submitted, with no grade

### Requirement: Accessibility preserved
The refactor SHALL preserve existing accessibility: desktop buttons keep logical focus order, keyboard activation, meaningful accessible names, and `aria-keyshortcuts`; the mobile joystick keeps its accessible button fallback (the visual overlay remains `aria-hidden` and is not the only input path).

#### Scenario: Desktop button accessibility
- **WHEN** a keyboard user tabs through the six SuperMemo buttons
- **THEN** each is focusable, activatable, and exposes its grade name and shortcut

### Requirement: Automated test coverage of the rating matrix
Automated tests SHALL cover the view (Queue, Review) × platform (desktop, touch) × algorithm (SM-18, SM-20, one four-grade) matrix asserting which rating control renders, plus per-grade tests verifying each of grades 0–5 maps to the correct scheduler input in both views.

#### Scenario: Matrix test
- **WHEN** the test matrix runs
- **THEN** each combination renders the expected control per this specification
