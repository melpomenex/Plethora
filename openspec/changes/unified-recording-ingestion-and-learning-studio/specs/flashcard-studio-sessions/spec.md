## ADDED Requirements

### Requirement: Shared Studio editor with durable session draft source
Flashcard Studio SHALL support a recording-session draft source using the existing card editing/review interactions. Session drafts SHALL retain durable identity/provenance independently of capped legacy workspace storage. Opening/resuming a session draft SHALL NOT invoke an eager-persist extract generator.

#### Scenario: Resume many durable drafts
- **WHEN** a session has drafts beyond the legacy workspace cache cap and the app restarts
- **THEN** all durable session drafts remain accessible through paginated review and legacy Studio sessions remain intact

#### Scenario: Edit source-linked candidate
- **WHEN** the user edits a session candidate in Studio
- **THEN** the same draft revision/evidence is updated and a learning item is created only by acceptance
