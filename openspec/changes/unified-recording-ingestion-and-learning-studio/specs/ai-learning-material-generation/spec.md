## ADDED Requirements

### Requirement: Durable session drafts remain outside review
Generated session suggestions SHALL persist as reviewable drafts outside active learning items until explicit user acceptance. Users SHALL be able to edit, reject, regenerate, accept individually, accept selected and accept all eligible drafts. Durable rejection status SHALL NOT create review items.

#### Scenario: Rejected card
- **WHEN** a generated session card is rejected and the app restarts
- **THEN** it never appears in the FSRS due/review queue and no learning item exists for that draft

#### Scenario: Close before approval
- **WHEN** the user closes the session after generation without accepting
- **THEN** drafts remain reviewable after restart and zero active cards were created

### Requirement: Idempotent atomic session acceptance
Each accepted session draft SHALL create its normal domain object, required source association, generation provenance and acceptance record atomically. Retrying an accepted draft SHALL return the existing object. A failed draft in a batch SHALL have an explicit result while previously committed drafts remain saved exactly once.

#### Scenario: Provenance write fails
- **WHEN** a required provenance insert fails during acceptance
- **THEN** that card/extract is not created and its draft remains retryable

#### Scenario: Lost acceptance reply
- **WHEN** a committed acceptance reply is lost and the user retries
- **THEN** the same accepted target is returned without a duplicate learning item

### Requirement: Existing learning history survives deduplication
Session deduplication SHALL NOT automatically change existing questions, answers, scheduling or review history. Reusing a card SHALL attach additional source evidence only after explicit user choice. Legacy non-session generation APIs SHALL remain compatible; session paths SHALL never use eager-persist generation as draft creation.

#### Scenario: Reuse existing reviewed card
- **WHEN** a user chooses Use existing for an overlapping lecture candidate
- **THEN** source evidence is attached without a new card or changes to the existing card's review state/history
