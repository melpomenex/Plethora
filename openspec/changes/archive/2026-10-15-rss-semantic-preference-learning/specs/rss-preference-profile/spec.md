## ADDED Requirements

### Requirement: Article-level feedback persistence
The system SHALL persist one like/dislike feedback record per RSS article (idempotent re-toggle, removable by undo), in addition to — not replacing — existing author/tag classifier behavior.

#### Scenario: Thumbs persist article feedback
- **WHEN** the user taps 👍/👎 on an article
- **THEN** an article-level feedback row is stored immediately alongside the legacy classifier, and the button state reflects it on revisit

#### Scenario: Undo removes feedback
- **WHEN** the user undoes feedback from the toast
- **THEN** both the classifier and the article feedback row are removed and the preference profile no longer reflects that interaction

### Requirement: Decayed semantic preference clusters
Explicit feedback SHALL update per-sentiment embedding clusters (assign-to-nearest above a similarity threshold, else spawn; capped count; incremental decay with a configurable half-life) that are derived state, rebuildable from the feedback table, and updated without re-embedding unchanged articles.

#### Scenario: Feedback updates clusters
- **WHEN** a liked article has an embedding available (computed on demand via the configured provider)
- **THEN** the positive cluster set is updated incrementally with that vector

#### Scenario: Old feedback decays
- **WHEN** feedback is older than the decay horizon
- **THEN** its contribution to scoring decreases monotonically with age

#### Scenario: Rebuild integrity
- **WHEN** clusters are rebuilt from the feedback table
- **THEN** the resulting profile is stable and idempotent

### Requirement: Local-first profile
The preference profile SHALL be computed and stored locally; cloud embedding providers SHALL only be used when already configured by the user under existing AI privacy settings, and no full reading history SHALL be transmitted.

#### Scenario: No cloud dependency
- **WHEN** only a local embedding provider (e.g. Ollama) is configured
- **THEN** preference learning works end-to-end without external requests
