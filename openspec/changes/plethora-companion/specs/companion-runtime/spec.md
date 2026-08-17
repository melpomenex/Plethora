## ADDED Requirements

### Requirement: Event-driven companion engine
The companion SHALL be driven by structured application events (document opened, reading progress milestone, highlight/extract created, review graded correct/difficult, RSS liked/disliked, session streak) processed through a deterministic state machine, and SHALL NOT use scattered timers or polling loops.

#### Scenario: Event produces contextual reaction
- **WHEN** a subscribed event fires and policy deems it eligible
- **THEN** the engine transitions to a matching state (e.g. celebrate on streak) and MAY surface a contextual speech line

#### Scenario: Determinism under injected clock
- **WHEN** the engine is unit-tested with the same event sequence and injected clock/seed
- **THEN** state transitions and speech selection are reproducible

### Requirement: Anti-spam speech policy
Unsolicited speech SHALL be event-budgeted and suppressed during typing, active review decisions, focus/immersive modes, and open modals; consecutive bubbles SHALL be separated by a minimum cooldown; recent lines SHALL not repeat.

#### Scenario: Rapid events do not spam
- **WHEN** multiple eligible events arrive within the cooldown window
- **THEN** at most one speech bubble is shown

#### Scenario: Suppressed contexts
- **WHEN** a text input is focused, a review decision is in progress, or a modal is open
- **THEN** no unsolicited bubble appears

### Requirement: Local-first operation
The companion SHALL operate fully offline from local rule templates; enabling it SHALL NOT send any content to a cloud model, and any future AI augmentation SHALL be opt-in and respect existing AI privacy configuration.

#### Scenario: No egress
- **WHEN** the companion is enabled and produces speech
- **THEN** no network request is attributable to the companion

### Requirement: Master control
A master enable/disable setting SHALL exist, default OFF for existing users and fresh installs, and disabling SHALL immediately remove the companion from the UI.

#### Scenario: Default off
- **WHEN** a user upgrades or freshly installs
- **THEN** the companion is disabled until explicitly enabled in settings
