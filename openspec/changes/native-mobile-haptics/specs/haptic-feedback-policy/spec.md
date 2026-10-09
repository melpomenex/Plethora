## Purpose

Ensure all tactile feedback follows one semantic, preference-aware policy with explicit interaction ownership, independent feedback channels and bounded nonblocking delivery.

## ADDED Requirements

### Requirement: Central independent tactile policy
All application haptic output SHALL pass through the existing feedback orchestration boundary. Semantic interaction/domain events, effect selection, user preferences, capability and platform delivery SHALL remain distinct. Haptic eligibility SHALL NOT depend on a sound role, sound enablement, sound volume or a visual preference. A haptic-only interaction SHALL NOT generate a new toast, sound or OS notification merely because it is registered.

#### Scenario: Haptic-only navigation or gesture
- **WHEN** an eligible navigation or threshold event has no sound role and haptics are enabled
- **THEN** it can produce its admitted tactile effect without creating another feedback channel

#### Scenario: Visual or audio opt-out
- **WHEN** visual animation or audio is disabled independently
- **THEN** haptic policy still evaluates the haptic preference and support without forcing disabled channels back on

### Requirement: One owner per operation and phase
Every feedback-eligible operation SHALL have a stable identity and an explicit output owner. Nested components, helper toasts, render effects and domain callbacks SHALL NOT produce duplicate tactile delivery for the same identity/phase. Distinct gesture threshold and final outcome phases SHALL use distinct steps. Concurrent duplicate emissions SHALL be reserved/deduplicated before asynchronous delivery; session and milestone results SHALL not replay on remount.

#### Scenario: Save and toast share identity
- **WHEN** a successful highlight action updates its viewer and creates a helper success toast for the same operation
- **THEN** at most one admitted save haptic is delivered and the toast remains visible with its existing action

#### Scenario: Concurrent domain duplicates
- **WHEN** two components concurrently report the same completed operation before asynchronous capability checks finish
- **THEN** at most one hardware request is admitted for that phase

#### Scenario: Genuine repeat operation
- **WHEN** the user performs a new operation on the same entity after the applicable cooldown
- **THEN** a new identity can receive feedback without being confused with a duplicate of the earlier operation

### Requirement: Outcome precedence without duplicate celebrations
A single review commit that also completes a session SHALL select completion instead of a separate card-commit haptic. If that operation also reaches a significant streak milestone, celebration SHALL replace completion. Other sound and visual policies SHALL remain independent. A failed/pending mutation SHALL NOT receive a success haptic.

#### Scenario: Final card with milestone
- **WHEN** a committed final review finishes a nonempty session and reaches a new qualifying streak milestone
- **THEN** one celebration effect represents the combined outcome rather than stacked grade, completion and celebration haptics
- **AND** permitted completion/celebration sound and visual feedback remains available

#### Scenario: Submission pending or rejected
- **WHEN** a grading action opens an uncommitted decision or fails persistence
- **THEN** no successful grade/session effect occurs; a meaningful failure is eligible for the error policy

### Requirement: Gesture-scoped ownership
Continuous gesture feedback SHALL occur only on accepted semantic transitions. Refresh activation SHALL latch once per gesture even after retreat/re-cross. Joystick feedback SHALL occur only on transitions into a changed non-null grade, subject to cooldown. Cancelled/protected gestures and unchanged positions SHALL be silent.

#### Scenario: Refresh retreat and re-cross
- **WHEN** a single pull gesture crosses the activation threshold, retreats and crosses again before ending
- **THEN** at most one threshold effect is requested for that gesture

#### Scenario: Joystick movement within a grade
- **WHEN** many movement frames remain in the same grade or return to the dead zone
- **THEN** no additional detent effect is requested

#### Scenario: Joystick returns to a previous grade
- **WHEN** a gesture selects a different valid grade and later returns to a previously selected grade after the cooldown
- **THEN** the changed transition can produce one new detent with a distinct step identity

### Requirement: Rate limits and bounded lifetime
All entry points SHALL share a maximum of eight effects per rolling second, at most four outcome effects per rolling second, minimum global spacing of 60 ms for micro-interactions and 120 ms for outcomes, plus their per-event cooldowns. Excess, unsupported, disabled, expired or in-flight-overflow work SHALL be dropped without a replay queue. Deduplication and lifecycle state SHALL be bounded. Admitted effects SHALL not execute after their 150 ms age budget expires.

#### Scenario: Rapid action burst
- **WHEN** repeated joystick, tab and grade gestures exceed the shared limits
- **THEN** bridge requests and physical effects remain within those limits and excess effects do not play later

#### Scenario: Slow or stuck driver
- **WHEN** native delivery remains outstanding or queued work expires
- **THEN** new excess work is dropped, memory remains bounded and stale output is skipped without stalling the UI

### Requirement: No unrelated asynchronous gating
Eligible interaction haptics SHALL be admitted synchronously using current hydrated preferences and cached capability. They SHALL NOT await notification permissions, periodic-sync availability, audio loading or haptic completion. Uninitialized capability/configuration SHALL suppress feedback rather than delay and replay it. Independent notification/sound policies SHALL continue resolving their own channels.

#### Scenario: Notification service is slow
- **WHEN** an eligible visible gesture occurs while notification capability queries are unresolved
- **THEN** the gesture's haptic admission and UI transition proceed without waiting for those queries

#### Scenario: Interaction before initialization
- **WHEN** the user acts before haptic readiness
- **THEN** the action succeeds, no effect is queued and the missed effect does not fire after readiness

### Requirement: Foreground and accessible feedback
Haptics SHALL complement visible feedback and accessible announcements, never replace them. App-driver delivery SHALL be foreground-only. Quiet hours for attention channels SHALL NOT silently disable foreground user-interaction haptics. Background OS notification behavior SHALL remain under its independent notification policy. Critical events SHALL still honor haptics-off.

#### Scenario: Accessible activation and quiet hours
- **WHEN** a TalkBack/VoiceOver user activates a supported action during quiet hours
- **THEN** the action retains its visible/accessibility result and its eligible foreground haptic independently of attention-channel suppression

#### Scenario: Background completion
- **WHEN** a task completes while the app is hidden
- **THEN** any permitted OS notification remains independent and no app-driver haptic is added or replayed

### Requirement: Single browser hardware boundary
Components, gesture hooks, toast renderers and the audio service SHALL NOT directly execute browser vibration. The browser fallback SHALL be the only browser hardware boundary and SHALL apply the same centralized preference/ownership/limit decisions as native delivery.

#### Scenario: Legacy delivery migration
- **WHEN** the implementation's production vibration call sites are audited
- **THEN** browser hardware calls occur only in the centralized fallback and every former bypass is removed or delegated through policy
