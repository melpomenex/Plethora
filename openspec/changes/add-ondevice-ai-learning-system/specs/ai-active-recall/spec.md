## ADDED Requirements

### Requirement: Optional active-recall reading mode

The system SHALL provide an active-recall mode with settings Off (default), Low, Adaptive, and
Intensive. Questions SHALL be generated only from material the user has already encountered in
the current reading session, and each prompt SHALL be dismissible.

#### Scenario: Off by default
- **WHEN** a user installs or updates the app
- **THEN** active recall is disabled and reading proceeds without AI interruptions

#### Scenario: Only encountered material is tested
- **WHEN** a recall question is generated
- **THEN** it is grounded in chunks the user has already scrolled/read past, never upcoming
  content

### Requirement: Interruption budget

Prompt frequency SHALL be governed by an interruption budget: a minimum interval per mode
(with adaptive mode widening based on signals such as document importance, reading progress,
concept density, recent recall performance, existing card coverage, and time since last
prompt), a maximum number of prompts per session, and suppression during selection, reflow,
or playback interactions. The feature SHALL expose a "don't ask again today" control and a
global kill switch.

#### Scenario: Adaptive mode respects the minimum interval
- **WHEN** a prompt was answered 3 minutes ago and the adaptive minimum interval is 4 minutes
- **THEN** no new prompt is shown regardless of other signals

#### Scenario: Budget exhaustion
- **WHEN** the per-session prompt cap is reached
- **THEN** no further prompts occur in that reading session

#### Scenario: No prompts during interaction
- **WHEN** the user is actively selecting text or a media/reflow interaction is in progress
- **THEN** recall prompts are suppressed

### Requirement: Question deduplication by fingerprint

Generated questions SHALL be fingerprinted (normalized question text plus concept keys) and
stored in recall history; effectively identical questions SHALL NOT be re-asked within the
deduplication window.

#### Scenario: Near-duplicate suppression
- **WHEN** a newly generated question is effectively identical to one asked recently
- **THEN** it is discarded and another candidate (or no prompt) is used instead

### Requirement: Recall loop with feedback

A recall prompt SHALL present the question, allow the user to retrieve from memory and answer,
provide immediate feedback, and then continue reading without losing position.

#### Scenario: Answer and continue
- **WHEN** a user answers a recall prompt
- **THEN** feedback is shown briefly and reading resumes at the exact prior position

### Requirement: Promotion to durable card

The user SHALL be able to convert a good recall question into a persistent flashcard through
the validated preview flow.

#### Scenario: Promote a question
- **WHEN** a user taps "keep this question" on a recall prompt
- **THEN** a card candidate opens in the preview/edit/accept flow and only acceptance creates
  the card
