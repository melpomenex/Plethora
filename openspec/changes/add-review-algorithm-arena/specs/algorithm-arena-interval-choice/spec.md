## ADDED Requirements

### Requirement: Arena is scoped to eligible learning-item reviews

The system SHALL present the Algorithm Arena interval-choice phase only for normal scheduled flashcard / learning-item reviews in the Review tab when the active algorithm is `precision`, Pure M4 mode is disabled, scheduling updates are enabled, and the user's Arena review mode is `choose`. The system SHALL NOT present the Arena for documents, Queue reading mode, cram mode, non-Plethora Precision algorithms, Pure M4 mode, automatic Arena review mode, or review widgets outside the Review tab.

#### Scenario: Eligible Plethora Precision flashcard enters the Arena

- **WHEN** a user grades a flashcard in a normal Review-tab session with Plethora Precision Arena scheduling active
- **THEN** the system enters the Algorithm Arena interval-choice phase before scheduling or advancing the card

#### Scenario: Ineligible review keeps direct scheduling

- **WHEN** a user grades an item in cram mode, Pure M4 mode, a non-Plethora Precision algorithm, or a non-Review-tab surface
- **THEN** the system retains that surface's existing direct scheduling behavior
- **AND** it does not show the Algorithm Arena

#### Scenario: Reading item never enters the Arena

- **WHEN** a document is rated in the Queue / Optimal Queue reading flow
- **THEN** the system SHALL NOT load or display an Algorithm Arena interval choice

### Requirement: User chooses between automatic flow and the Arena

The system SHALL expose one persistent Plethora Precision Arena review preference with `automatic` and `choose` values. `automatic` SHALL be the recommended default and SHALL commit Arena's authoritative weighted recommendation with Arena provenance without presenting or waiting on the decision phase. `choose` SHALL open the full Arena after every otherwise eligible grade. The same five collection models SHALL remain active and continue learning in both modes. The choice SHALL be discoverable in Learning settings and in context beside the Plethora Precision rating controls.

#### Scenario: Automatic mode keeps review moving

- **GIVEN** Arena review mode is `automatic`
- **WHEN** the user grades an eligible Plethora Precision learning item
- **THEN** the authoritative Arena Pick is committed without displaying the Memory Horizon
- **AND** the review advances through the normal committed-review lifecycle
- **AND** provenance records the schedule source as `arena`

#### Scenario: Choose mode opens the simulation

- **GIVEN** Arena review mode is `choose`
- **WHEN** the user grades an eligible Plethora Precision learning item
- **THEN** the answer remains visible and the Memory Horizon opens before scheduling

#### Scenario: User changes the preference in context

- **WHEN** the user changes the compact Arena mode control beside the Plethora Precision grades
- **THEN** the preference persists across sessions in both Tauri and PWA clients
- **AND** the next grade follows the newly selected mode

### Requirement: Preview exposes five comparable model proposals without mutation

For every eligible card, the system SHALL provide deterministic Arena preview data for native grades 0-5. Each grade SHALL include one proposal from Plethora Classic, Classic 15, Classic 19, Plethora Precision, and FSRS; the current weight of each model; the weighted Arena recommendation; the minimum-to-maximum Arena range; authoritative custom bounds; relative intervals; exact due dates; and item/Arena revision identifiers. Generating a preview SHALL NOT mutate card, model, collection, matrix, weight, review-history, or due-date state.

#### Scenario: Preview contains all competitors for a grade

- **WHEN** an eligible Plethora Precision card's preview finishes loading
- **THEN** each native grade entry contains exactly one candidate for each of `classic`, `classic_15`, `classic_19`, `precision`, and `fsrs`
- **AND** the candidates expose finite positive intervals, due dates, and weights
- **AND** the entry exposes the deterministic weighted recommendation and Arena range

#### Scenario: Preview uses the selected grade

- **WHEN** the user chooses native grade 4
- **THEN** the Arena displays the grade-4 recommendation and grade-4 model candidates
- **AND** it does not display another grade's candidate intervals

#### Scenario: Repeated previews are non-mutating

- **WHEN** the same unchanged card is previewed multiple times
- **THEN** the returned candidate intervals and recommendation are identical
- **AND** no review count, due date, algorithm state, Arena weight, matrix value, or history row changes

### Requirement: Memory Horizon communicates interval relationships and exact values

The system SHALL render the post-grade choices as a responsive Memory Horizon with a logarithmic time axis, an explicit Now origin, human-readable time ticks, labeled algorithm markers, an Arena Pick marker, and an Arena range spanning the earliest and latest model proposals. The currently selected choice SHALL be visually dominant and SHALL display both its relative interval and exact local due date. The primary confirmation control SHALL repeat the selected relative interval.

#### Scenario: Widely separated intervals remain readable

- **WHEN** one candidate proposes hours and another proposes multiple years
- **THEN** both candidates remain present on the logarithmic Memory Horizon
- **AND** the UI provides readable human-unit labels without exposing raw decimal days as the primary value

#### Scenario: Candidate markers overlap

- **WHEN** two or more candidate marker labels would overlap at the available width
- **THEN** the system fans or clusters their visual markers without hiding a candidate
- **AND** every candidate remains independently selectable in the textual choice rail

#### Scenario: Selection is unambiguous

- **WHEN** the user selects the FSRS proposal
- **THEN** the main interval value, exact due date, FSRS marker, FSRS choice target, explanation, and confirmation label all reflect the same FSRS interval

### Requirement: Arena selection supports fast default and deliberate alternatives

The system SHALL preselect Arena Pick and SHALL allow the user to choose Arena Pick, any of the five model proposals, or Custom before confirmation. It SHALL NOT auto-confirm on a timeout in the normal visual flow. Keyboard users SHALL be able to traverse choices, select Arena Pick or a model, enter Custom mode, confirm, and return to grading without a pointer. Touch users SHALL receive large targets, scroll-snap choices, swipe traversal, and preference-aware haptic selection feedback.

#### Scenario: Fast default confirmation

- **WHEN** the Arena opens and the user presses Enter or Space without changing selection
- **THEN** the weighted Arena recommendation is committed

#### Scenario: First eligible review explains the chooser

- **WHEN** the user enters the Arena for the first time
- **THEN** a compact, dismissible guide identifies Arena Pick as the fast default and the five model alternatives
- **AND** the guide does not cover or disable interval confirmation
- **AND** it does not appear again after completion or dismissal

#### Scenario: Keyboard selects a model

- **WHEN** the Arena is ready and the user invokes the documented shortcut for Plethora Precision
- **THEN** the Plethora Precision candidate becomes selected
- **AND** a subsequent Enter commits the recomputed Plethora Precision candidate interval

#### Scenario: Escape returns to grading

- **WHEN** the user presses Escape before committing an Arena choice
- **THEN** the system returns to the answer and rating controls for the same card
- **AND** no review or schedule mutation has occurred

#### Scenario: Touch user swipes candidates

- **WHEN** a touch user swipes the candidate rail by one snap position
- **THEN** selection moves to the adjacent candidate
- **AND** haptic feedback occurs at most once for that selection change when haptics are enabled

### Requirement: Custom intervals are bounded and explicit

The system SHALL require the user to enter Custom mode before free interval adjustment. Custom mode SHALL support a logarithmic horizon control and a numeric value with human unit, display the resulting exact due date, and enforce the backend-provided minimum and maximum. The backend SHALL reject non-finite, non-positive, or out-of-bounds custom values.

#### Scenario: User chooses a valid custom interval

- **WHEN** the user enters a custom value within the authoritative bounds and confirms it
- **THEN** the system schedules the card for that interval
- **AND** records the selection source as `custom`

#### Scenario: User enters an invalid custom interval

- **WHEN** the user enters NaN, infinity, zero, a negative value, or a value outside the authoritative bounds
- **THEN** the system prevents commit
- **AND** identifies the allowed range without discarding the pending grade

#### Scenario: Accidental horizon drag outside Custom mode

- **WHEN** the user drags on the Memory Horizon while a standard candidate is selected and Custom mode has not been activated
- **THEN** the system SHALL NOT create or commit a custom interval

### Requirement: Commit validates selection and applies it atomically

The backend SHALL validate item revision, Arena revision, selected grade, selection source, and custom bounds against current authoritative state. It SHALL recompute candidates during commit; model selections SHALL use the interval associated with the supplied model ID rather than a client-supplied number. A successful commit SHALL apply the grade exactly once, persist model and Arena state, set the learning item's actual interval and due date to the chosen value, write review history, and return the updated item as one logical operation.

#### Scenario: Model selection cannot spoof an interval

- **WHEN** a client submits `source = model`, `model_id = fsrs`, and a forged interval value
- **THEN** the backend ignores the forged value
- **AND** commits the current recomputed FSRS candidate interval

#### Scenario: Successful commit uses the displayed deterministic interval

- **WHEN** the preview is current and the user confirms the selected Arena Pick interval
- **THEN** the committed `new_interval` and due date match that deterministic recommendation within storage precision
- **AND** no stochastic day dispersal changes it after confirmation

#### Scenario: Commit is retried after a transport failure

- **WHEN** a commit response is lost and the client retries the same logical Arena review
- **THEN** the system SHALL NOT apply the grade, model updates, or review-history event twice
- **AND** it returns or reconciles to the single committed result

### Requirement: User choice does not directly train Arena weights

The Arena SHALL update model weights only from each model's prior recall prediction compared with the observed recall outcome. Selecting Arena Pick, an individual model, or Custom SHALL NOT directly increase or decrease a model's weight. The system SHALL retain the raw model predictions needed to score competitors at the next review while using the chosen interval as the actual elapsed schedule.

#### Scenario: Choosing a model does not reward it

- **WHEN** the user selects Plethora Precision instead of Arena Pick
- **THEN** the current review does not increase Plethora Precision's weight merely because it was selected
- **AND** future weight adaptation remains based on recall prediction loss

#### Scenario: Custom schedule preserves future model scoring

- **WHEN** the user commits a custom interval and later reviews the card
- **THEN** each competitor is scored using its stored prior prediction and the actual elapsed time
- **AND** the custom selection itself is not treated as a recall label

### Requirement: Arena decisions are auditable, exportable, and syncable

Each committed Arena review SHALL retain the chosen interval in `new_interval` and optional versioned provenance containing selection source, selected model where applicable, weighted recommendation, decision time, candidate intervals, candidate weights, grade, and preview revisions. The same optional data SHALL survive review-result queries, collection export/import, and cross-device review-event sync. Legacy review rows and older peers SHALL remain readable when provenance is absent.

#### Scenario: Export includes Arena provenance

- **WHEN** a collection containing Arena-reviewed cards is exported and reimported
- **THEN** the chosen interval and Arena decision provenance are preserved

#### Scenario: Legacy review has no Arena fields

- **WHEN** the system reads a review result created before Arena provenance existed
- **THEN** the review remains valid
- **AND** its absent Arena fields are interpreted as a legacy direct schedule

#### Scenario: Synced review retains selection source

- **WHEN** an Arena review is synchronized to another current client
- **THEN** the remote review event exposes the same chosen interval, source, selected model, and versioned candidate snapshot

### Requirement: Arena is accessible and adapts to user preferences

The Arena SHALL expose its standard choices as a semantic single-selection control with accessible names containing algorithm, interval, exact date, and weight where applicable. Selection and refreshed stale data SHALL be announced through a non-interrupting live region. All controls SHALL be keyboard reachable, visibly focused, at least 44 by 44 CSS pixels on touch layouts, and understandable without color. Motion, transparency, sound, and haptic behavior SHALL respect the user's platform and application preferences.

#### Scenario: Screen reader reviews choices

- **WHEN** a screen-reader user navigates the Arena choices
- **THEN** each choice announces its name, relative interval, exact due date, weight where applicable, and selected state
- **AND** the visual timeline is not required to operate the chooser

#### Scenario: Reduced motion is enabled

- **WHEN** `prefers-reduced-motion` requests reduced motion
- **THEN** markers render at their final positions without racing from Now
- **AND** every selection and commit remains fully usable

#### Scenario: Mobile safe area is present

- **WHEN** the Arena renders on a phone with a bottom safe-area inset
- **THEN** the persistent confirmation dock remains fully visible and reachable above that inset
- **AND** the dock occupies reserved layout space without covering the selected trajectory, Memory Horizon, or candidate rail

### Requirement: Loading, failure, and stale previews preserve user control

The Arena SHALL provide a shape-matched loading state and contextual preview/commit error states. A preview error SHALL offer Retry, Schedule automatically, and Back to rating. A commit error SHALL retain the card, grade, and selection without advancing session state. A stale preview SHALL be refreshed and SHALL require confirmation of the new interval before commit.

#### Scenario: Preview fails

- **WHEN** Arena preview data cannot be loaded
- **THEN** the current card and grade remain pending
- **AND** the user can retry, schedule with the backend's automatic Arena recommendation, or return to rating

#### Scenario: Commit fails

- **WHEN** the backend fails to commit a selected interval
- **THEN** the queue, completion count, correctness count, and current card remain unchanged
- **AND** the selected interval remains available for retry

#### Scenario: Preview is stale

- **WHEN** item or Arena state changes after preview and before commit
- **THEN** the backend rejects the stale preview with a typed error
- **AND** the frontend reloads candidates, preserves the selected source/model when possible, announces any changed interval, and asks for confirmation again

#### Scenario: App closes before confirmation

- **WHEN** the app closes while the Arena is ready but uncommitted
- **THEN** no partial review exists
- **AND** the card remains due when the app restarts

### Requirement: Tauri and browser backends produce parity

The Tauri and browser/PWA review backends SHALL implement the same Arena preview schema, deterministic candidate finalization, selection validation, custom bounds, and provenance semantics for a shared scheduling fixture.

#### Scenario: Shared parity fixture

- **WHEN** the same card state, collection state, grade, and Arena weights are evaluated in Tauri and the browser backend
- **THEN** model IDs, candidate intervals, recommendation, range, custom bounds, and selection result match within documented floating-point tolerance
