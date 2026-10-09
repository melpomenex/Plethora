## Purpose

Apply subtle and consistent tactile feedback to meaningful mobile review, reading, library, navigation and task interactions while keeping ordinary continuous activity quiet.

## ADDED Requirements

### Requirement: Flashcard reveal and grading
All mobile review modes SHALL provide a subtle activation effect for explicit hidden-to-shown answer reveal and a commit effect for a successfully persisted grade, subject to shared preferences and limits. Tap, joystick release, keyboard and accessible activation SHALL converge on the same committed-action owner. Automatic reveal, repeated reveal, rejected submissions and pending decisions SHALL NOT produce successful grading output.

#### Scenario: Grade succeeds with audio disabled
- **WHEN** the user rates a flashcard in normal, Zen, scroll or quick-review mode and persistence succeeds with haptics enabled and sounds disabled
- **THEN** one admitted grade commit effect occurs unless a higher-priority completion/milestone replaces it

#### Scenario: Explicit versus automatic reveal
- **WHEN** the user explicitly reveals a hidden answer
- **THEN** at most one activation effect occurs for that card visit
- **AND** automatic reveal, remount and repeated reveal remain silent

#### Scenario: Arena decision not yet committed
- **WHEN** grading opens a pending algorithm decision without persisting a review
- **THEN** no grade success is emitted until the accepted decision commits

### Requirement: Joystick and discrete review selections
Joystick feedback SHALL mark changed valid grade zones only, with at least 80 ms between detents and no per-frame pulses. Changed Arena/interval choices SHALL provide bounded selection feedback; unchanged choices and numeric typing SHALL remain silent. Cancellation SHALL not submit a grade or produce a commit effect.

#### Scenario: Changed valid joystick zones
- **WHEN** a gesture moves through distinct valid grades with adequate spacing
- **THEN** each accepted changed zone is eligible for one selection tick

#### Scenario: Dead zone and cancellation
- **WHEN** a drag returns to the dead zone or is cancelled
- **THEN** there is no dead-zone detent or successful grade effect

#### Scenario: Discrete choice selection
- **WHEN** the user selects a different Arena interval or model choice
- **THEN** one eligible selection effect occurs without a toast or success claim

### Requirement: Review session and milestone outcomes
A nonempty successfully completed mobile review session SHALL produce one completion effect by stable session identity, or one celebration when a coincident qualifying milestone supersedes it. A newly crossed streak multiple of ten or personal-best streak SHALL be eligible for celebration once per date/value. Newly crossed review-count milestones 25, 50, 100 and later multiples of 100 SHALL be eligible once per session/count. Empty sessions, unchanged milestone values and completion-screen remounts SHALL NOT replay output.

#### Scenario: Completed session
- **WHEN** the final persisted grade completes a nonempty session
- **THEN** completion feedback occurs once, replacing that grade's ordinary commit haptic

#### Scenario: Streak value unchanged across cards
- **WHEN** multiple cards are graded while the displayed day streak remains ten
- **THEN** celebration is not repeated merely because the streak remains divisible by ten

#### Scenario: New milestone and remount
- **WHEN** the session first crosses a qualifying milestone and its result UI later remounts
- **THEN** one admitted milestone effect represents the crossing and none represents the remount

### Requirement: Reading context activation
Explicit long-press or equivalent user intent that opens a custom dictionary/context action surface SHALL provide one subtle activation effect after the action surface opens. The recognizer, dictionary peek and resulting sheet SHALL share one identity. Native system text menus, ordinary selection updates, lookup-result refresh, selection handles and page scrolling SHALL remain free of added app haptics.

#### Scenario: Dictionary opens from long-press
- **WHEN** an accepted explicit word long-press opens the dictionary peek or contextual actions
- **THEN** one activation effect occurs, with no second effect when definitions load or a related sheet presents

#### Scenario: Selection or scrolling without activation
- **WHEN** the user adjusts text-selection handles, scrolls, cancels a long-press by moving or selects text without explicit context activation
- **THEN** no app activation haptic is added

### Requirement: Saved reading and annotation actions
Successful mobile highlight, extract, cloze/vocabulary-card, bookmark and annotation mutation actions SHALL provide one success/commit effect after persistence. Equivalent PDF, EPUB, HTML, Markdown, RSS and transcript-supported save paths SHALL obey the same owner policy and preserve existing toast edit/undo actions. Actual changed reading-tool modes SHALL be eligible for a selection effect; hovering, autosave and ordinary page progression SHALL remain silent.

#### Scenario: Highlight saves across viewers
- **WHEN** a highlight is saved through any supported mobile viewer path
- **THEN** one admitted success effect follows persistence, the visible confirmation retains its existing edit action and helper/renderer layers add no duplicate

#### Scenario: Bookmark or annotation failure
- **WHEN** a bookmark or annotation save fails
- **THEN** no success effect occurs and an important visible failure is eligible for one error effect

#### Scenario: Changed reading tool
- **WHEN** the user changes a meaningful reading/annotation mode
- **THEN** a bounded selection effect can occur while ordinary word focus, page movement and reading-position autosave stay silent

### Requirement: Committed Queue and Library actions
Mobile swipe postpone/suspend, mark-done, undo, explicit Library state changes and document mutations SHALL produce feedback at the accepted commit boundary. Generic swipe recognizers SHALL NOT independently pulse. Selection-mode entry and changed item selection SHALL use activation/selection effects. Bulk operations SHALL produce at most one result effect, using warning for partial failure and error for total failure.

#### Scenario: Queue swipe commits
- **WHEN** a Queue swipe commits a supported mutation successfully
- **THEN** one admitted commit effect occurs from the action owner without an additional swipe-wrapper or toast effect

#### Scenario: Cancelled or failed swipe
- **WHEN** a swipe is cancelled, below threshold, protected by text selection or fails its mutation
- **THEN** no successful swipe effect occurs; meaningful failure can receive an error effect

#### Scenario: Selection and bulk result
- **WHEN** the user enters selection mode, selects several rows and commits one bulk operation
- **THEN** entry/changed selection receive bounded phase-specific feedback and the batch outcome produces one result rather than per-item output

### Requirement: Pull-to-refresh threshold feedback
Mobile pull-to-refresh SHALL provide one threshold effect on its first activation crossing per gesture. Retreat/re-cross, movement frames and successful refresh completion SHALL NOT repeat that effect. End/cancel/disable SHALL clear gesture state. A meaningful refresh failure SHALL be eligible for one error outcome.

#### Scenario: Threshold crossed repeatedly in one pull
- **WHEN** one pull crosses, retreats below and re-crosses the activation threshold
- **THEN** one threshold effect is eligible across that entire pull

#### Scenario: New gesture or failed refresh
- **WHEN** a prior pull ends and a new pull crosses the threshold
- **THEN** the new gesture can produce a new threshold effect
- **AND** a failed resulting refresh can produce one distinct error outcome without replaying the threshold

### Requirement: Primary navigation and successful Back
An explicit change to a different primary mobile tab SHALL provide one selection effect after the destination becomes active. Successful application Back SHALL provide one subtle completed-transition effect through the existing completion callback, independently of sound settings. Pending/blocked/cancelled/root Back, same-tab presses and restored/programmatic tab selection SHALL be silent. Haptics SHALL NOT introduce another gesture recognizer, alter native Back rollout or delay native acknowledgement.

#### Scenario: Changed primary tab
- **WHEN** the user activates a different primary tab or primary destination from More
- **THEN** one admitted selection effect occurs after activation, while pressing the active tab produces none

#### Scenario: Back completes an overlay or view transition
- **WHEN** an existing UI, native Android or fallback Back request completes a supported overlay/context/workspace transition
- **THEN** one admitted subtle effect uses that transition's existing identity and native acknowledgement remains independent

#### Scenario: Deferred dirty-state Back
- **WHEN** Back awaits a dirty-state confirmation
- **THEN** pending/cancelled confirmation is silent and accepting the successful deferred transition produces at most one effect

#### Scenario: Root or cancelled predictive Back
- **WHEN** native Back is cancelled, is blocked, belongs to an IME/native picker or exits/backgrounds from the application root
- **THEN** no app navigation haptic is added

### Requirement: Significant destinations and sheets
Explicit significant source-return/view transitions and meaningful committed sheet detents SHALL be eligible for a subtle activation effect only when another tab, Back, context or save owner does not already represent the interaction. Automatic presentation, animation frames and ordinary sheet dismissal SHALL remain silent.

#### Scenario: Source return without another navigation cue
- **WHEN** the user returns from an extract to its source and the destination changes without a primary-tab or Back event owning feedback
- **THEN** one eligible activation effect represents the completed destination change

#### Scenario: Long-press opens a sheet
- **WHEN** a long-press activation already owns feedback for its newly opened action sheet
- **THEN** sheet presentation adds no second tactile effect

### Requirement: Training, imports and meaningful tasks
Committed content training, significant foreground user-requested imports, saved clips/downloads and task completion SHALL produce one semantic success/completion effect per operation or batch, with meaningful failures receiving error and partial results warning. Media playback commands, continuous scrubbing, transcript word progression, search typing/results traversal, AI token streaming and background task progress SHALL remain silent by default.

#### Scenario: Training through gesture or button
- **WHEN** a like/dislike button or RSS swipe successfully persists its training operation
- **THEN** the shared training owner produces one admitted success effect independent of its sound preference

#### Scenario: Batch import or source task
- **WHEN** an explicit foreground multi-file import, transcription or source conversion completes
- **THEN** one summary outcome is eligible, without per-file/progress vibration

#### Scenario: Playback and background updates
- **WHEN** media time/seek updates, search input, streamed answer fragments or background feed/import progress occurs
- **THEN** no app haptic effect is added

### Requirement: Central toast and important error feedback
Unowned meaningful foreground success, warning, important error and completion feedback SHALL use the same central effect policy. Domain-owned feedback and its toast SHALL share ownership to avoid duplication. Info/progress toasts, renderer mounting and repeated incident updates SHALL be silent or deduplicated; haptics-off SHALL silence all these effects without disabling visible errors or sounds.

#### Scenario: Important foreground error with haptics disabled
- **WHEN** an action fails and produces an error toast while haptics are disabled
- **THEN** the visible error and independently permitted sound remain and no hardware request occurs

#### Scenario: Error incident reported by multiple layers
- **WHEN** a mutation owner and helper report the same important error incident
- **THEN** one admitted error effect represents it and toast rendering adds no hardware output
