## Purpose

Make Assistant manipulation tactile through meaningful, bounded semantic feedback, preserving user preferences and distinguishing intended hardware requests from physical-device evidence.

## ADDED Requirements

### Requirement: One threshold cue per invocation gesture
A valid pill drag SHALL attempt exactly one crisp semantic threshold cue at its first activation crossing, synchronized with visible arming. The gesture SHALL latch that attempt before admission, including when feedback is suppressed. Touch contact, ordinary movement and cancellation SHALL be silent. A drag's successful opening SHALL NOT add a second activation or initial-detent cue.

#### Scenario: Cross and open
- **WHEN** one qualifying drag crosses activation and releases above threshold
- **THEN** one threshold request is attempted at crossing and no additional opening request is attempted

#### Scenario: Reverse and re-cross
- **WHEN** the same gesture crosses, retreats and crosses again
- **THEN** it attempts only the first threshold cue even if the initial attempt was suppressed

#### Scenario: Cancel before crossing
- **WHEN** a drag cancels or releases short before crossing
- **THEN** no Assistant haptic is requested

#### Scenario: Cancel after crossing
- **WHEN** a gesture crosses then retreats and releases short, or is cancelled
- **THEN** no cancellation/commit cue is added and the previously attempted threshold cue is not replayed

### Requirement: Distinct tap and detent semantics
Accepted tap/accessibility opening SHALL be eligible for one activation cue. A user-directed change between different nonclosed sheet detents SHALL be eligible for one selection cue at settlement. No-change settlement, programmatic viewport/keyboard adjustment, restoration and explicit dismissal SHALL be silent. Back dismissal SHALL retain only existing Back-completion ownership, with no additional Assistant dismissal cue.

#### Scenario: Tap opening
- **WHEN** one tap successfully changes closed to open
- **THEN** at most one admitted activation effect occurs without a threshold or initial-detent effect

#### Scenario: Deliberate detent and passive adjustment
- **WHEN** a user handle/button action settles at a different open detent
- **THEN** one selection cue is eligible
- **WHEN** the keyboard then changes available height
- **THEN** no detent cue is attempted for that passive adjustment

### Requirement: Central admission and duplicate prevention
Assistant haptics SHALL use existing semantic delivery, preferences, native hardware drivers and synchronous interaction admission. Each gesture or tap SHALL have an opaque interaction identity with phase-specific deduplication. Duplicate dispatch/render/mount paths SHALL NOT produce extra requests. Threshold/tap event cooldown SHALL be 250ms and detent cooldown 120ms, in addition to existing global/native limits. Suppressed, busy, expired and uninitialized output SHALL be dropped without replay or blocking animation. No content, title or transcript SHALL be embedded in identifiers or diagnostic payloads.

#### Scenario: Duplicate phase owners
- **WHEN** duplicate callbacks attempt the same interaction phase
- **THEN** at most one request is admitted before asynchronous native delivery

#### Scenario: Rapid repetition
- **WHEN** new Assistant gestures occur faster than event cooldown or shared limits
- **THEN** excess haptics are suppressed, sheet behavior remains usable, and no delayed vibration queue plays later

#### Scenario: Driver pending or slow
- **WHEN** a threshold occurs before configuration or while native delivery is busy
- **THEN** the visual state changes immediately without waiting and no missed cue is replayed when readiness returns

### Requirement: Preference-aware hardware delivery and honest acceptance
Haptics SHALL remain independent of sound settings, respect app enabled/intensity settings and native system restrictions, and degrade silently on unsupported hardware. Feedback SHALL be subtle, brief and semantically aligned; visible and accessible indications SHALL remain sufficient without it. Native success responses SHALL NOT be represented as proof of felt vibration. Physical Android and iPhone acceptance SHALL be recorded before claiming tactile completion.

#### Scenario: Haptics disabled and sound independent
- **WHEN** haptics are disabled while sounds remain enabled
- **THEN** no native haptic perform occurs and invocation still works
- **WHEN** sounds are disabled and haptics enabled on supported hardware
- **THEN** eligible Assistant haptics remain admissible

#### Scenario: Unsupported or system-suppressed
- **WHEN** hardware support is absent/unknown or system policy suppresses output
- **THEN** no fallback bypass or force-vibration flag is used and visual/accessibility behavior remains intact

#### Scenario: Device evidence
- **WHEN** native delivery reports submitted or platform accepted
- **THEN** acceptance records that result separately from a human felt/not-felt observation and threshold timing/quality
