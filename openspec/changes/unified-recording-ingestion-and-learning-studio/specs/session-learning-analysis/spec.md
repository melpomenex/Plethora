## Purpose

Transforms canonical session transcripts into bounded, source-grounded proposals while preserving user approval, profile preferences and recoverable partial results.

## ADDED Requirements

### Requirement: Bounded hierarchical source analysis
Analysis SHALL process bounded transcript sections with limited overlaps, checkpoint validated results, reconcile concepts and produce a bounded hierarchical overview. It SHALL enforce model input/output and run request budgets, avoid repeating completed units and keep transcript access independent of generation.

#### Scenario: Multi-hour transcript
- **WHEN** a multi-hour transcript is analyzed
- **THEN** no request contains the entire transcript, each request fits the resolved model budget and the user can read transcript sections while others process

#### Scenario: Failed middle section
- **WHEN** one section fails after earlier sections commit
- **THEN** earlier results remain available and retry processes only failed/stale units without duplicating drafts

#### Scenario: Budget exhausted
- **WHEN** the authorized run budget is reached
- **THEN** remaining work is marked deferred with an explicit continuation estimate and no additional inference starts silently

### Requirement: Grounded structured concepts and suggestions
Analysis SHALL propose coherent sections, important concepts/definitions, explanations/examples and profile outputs supported by canonical evidence. Every proposed extract/card and cited overview claim SHALL reference validated source segments/ranges. Unsupported quotes, equations, speaker identities, acoustic emphasis and timestamps SHALL NOT be fabricated.

#### Scenario: Hallucinated quotation
- **WHEN** a model returns a quote not found in its cited source ranges
- **THEN** the proposal is blocked or rejected before acceptance and no verbatim extract is saved

#### Scenario: Technical notation
- **WHEN** source evidence includes a technical term or equation
- **THEN** its exact notation is retained and unsupported reconstruction requires source correction rather than invented evidence

### Requirement: Profiles are output preferences
One shared analysis pipeline SHALL support lecture, meeting, interview, seminar/presentation, podcast, voice-note and other profiles with user-overridable outputs. Meeting analysis SHALL prioritize decisions/actions/questions/commitments and SHALL NOT generate cards unless explicitly enabled.

#### Scenario: Imported MP4 meeting
- **WHEN** meeting analysis runs with default meeting outputs
- **THEN** supported decisions/actions appear with evidence and zero card drafts or active review items are created

### Requirement: Quality and duplicate control
Card proposals SHALL test one meaningful target using existing practical card types, specific questions, concise answers and evidence. Generic key-insight templates, unsupported facts and source-sized answer dumps SHALL fail quality review. Duplicate comparisons SHALL preserve existing card content and review history and require explicit resolution.

#### Scenario: Overlapping lectures
- **WHEN** a new candidate matches a reviewed card from the same course
- **THEN** the user can compare, skip, explicitly keep both or attach evidence to the existing card
- **AND** existing scheduling and history do not change

### Requirement: Privacy-safe authorization and failure recovery
Analysis SHALL run only after applicable user processing selection and provider/privacy authorization. Offline-only, local-only and AI exclusions SHALL be enforced at every dispatch/retry, with no content in logs. Cancellation SHALL stop new requests and preserve valid committed results.

#### Scenario: Offline retry
- **WHEN** a cloud analysis unit is retried while offline-only policy applies
- **THEN** no cloud request is issued and the unit remains blocked with a visible remedy
