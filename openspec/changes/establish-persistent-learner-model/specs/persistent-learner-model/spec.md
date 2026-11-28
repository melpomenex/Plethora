# Persistent Learner Model Specification

## ADDED Requirements

### Requirement: Five-Dimension Competency Model Persistence
The system SHALL persist normalized, provenance-backed evidence in `competency_evidence`, derived 5-dimension projections (`exposure`, `comprehension`, `retention`, `application`, `transfer`) in `competency_projections`, and explicit user self-assessments in `learner_competency_declarations` via migration `169_persistent_learner_model`, extending `learning_evidence_repository.rs` and `concept_repository.rs`.

#### Scenario: Reading progress raises exposure only
- **GIVEN** a concept `c-1` with no prior evidence across all five dimensions
- **WHEN** a verified `reading_progressed` or `reading_completed` event linked to `c-1` is projected
- **THEN** `c-1`'s `exposure` dimension MUST update with the reading evidence
- **AND** `c-1`'s `comprehension`, `retention`, `application`, and `transfer` dimensions MUST remain `status = "unknown"` with `estimate = null`

#### Scenario: Unverified AI chats never raise demonstrated competency
- **GIVEN** a concept `c-2` with `comprehension` status `"unknown"`
- **WHEN** an unverified AI chat or `model-only` self-check completes mentioning `c-2`
- **THEN** the learner model MUST NOT insert verified demonstrated evidence for `c-2`
- **AND** `c-2`'s demonstrated `comprehension` projection MUST remain unchanged

### Requirement: Explicit Unknown and Insufficient Evidence Representation
The system SHALL distinguish explicitly between `unknown` (zero active evidence), `insufficient_evidence` (evidence below minimum independent-group or effective-weight thresholds), `needs_attention`, `developing`, and `demonstrated`, and SHALL attach machine-readable `uncertainty_reasons` whenever confidence is limited.

#### Scenario: Concept with zero evidence renders as unknown
- **GIVEN** a newly created concept `c-new` with zero rows in `competency_evidence`
- **WHEN** its competency profile is queried
- **THEN** every dimension MUST report `status = "unknown"`, `estimate = null`, `confidence = 0.0`, and `uncertainty_reasons` containing `"no_evidence"`

#### Scenario: Single-session evidence reports uncertainty reasons
- **GIVEN** a concept `c-3` with one verified `guided_check` on a single day (`independent_groups = 1`, `distinct_days = 1`)
- **WHEN** its `comprehension` projection is computed
- **THEN** its status MUST NOT be `"demonstrated"`
- **AND** `uncertainty_reasons` MUST include `"single_evidence_group"` and `"single_day_only"`

### Requirement: Correlated-Card Damping and Delayed Retention Weighting
The system SHALL damp repeated evidence sharing the same `card_family_id` or `evidence_group_id` sublinearly with a per-group weight cap, and SHALL discount same-day FSRS-7 reviews (`elapsed_days < 1.0`) relative to delayed recall (`elapsed_days >= 1.0`) when estimating `retention`.

#### Scenario: Drilling many correlated cloze cards does not inflate retention to demonstrated
- **GIVEN** 10 flashcards derived from the same extract sharing `card_family_id = "fam-1"` linked to concept `c-4`
- **WHEN** the learner rates all 10 cards `"Good"` on the same day (`elapsed_days = 0.1`)
- **THEN** correlated-card damping MUST cap the group's effective weight and record `independent_groups = 1`
- **AND** `c-4`'s `retention` dimension MUST NOT reach `"demonstrated"`

#### Scenario: Delayed FSRS-7 reviews across independent cards raise retention
- **GIVEN** concept `c-5` has at least two independent `card_family_id` groups reviewed with `elapsed_days >= 3.0` across at least two distinct days with passing ratings
- **WHEN** `c-5`'s `retention` projection is recomputed
- **THEN** `independent_groups` MUST be at least `2`, `distinct_days` MUST be at least `2`, and `status` MUST advance to `"developing"` or `"demonstrated"` according to the weighted mean and confidence thresholds

### Requirement: Evidence Provenance, Invalidation, and Self-Declaration Separation
The system SHALL maintain inspectable provenance links from every `competency_projections` row to its `competency_evidence` records, SHALL invalidate and recompute affected projections when an underlying review is undone or an exam grade is invalidated, and SHALL store manual learner declarations separately from demonstrated evidence.

#### Scenario: Invalidating an exam grade recomputes affected dimensions
- **GIVEN** concept `c-6` reached `application` status `"demonstrated"` based on exam grade `grade-9`
- **WHEN** an `assessment_grade_invalidated` event retracts `grade-9`
- **THEN** all `competency_evidence` rows sourced from `grade-9` MUST be marked `is_invalidated = 1`
- **AND** `c-6`'s `application` projection MUST be recomputed transactionally without those rows

#### Scenario: Manual self-declaration does not overwrite demonstrated evidence
- **GIVEN** concept `c-7` has `comprehension` status `"needs_attention"` from demonstrated evidence
- **WHEN** the learner records a self-declaration `declared_level = "confident"`
- **THEN** the declaration MUST be stored in `learner_competency_declarations`
- **AND** `c-7`'s demonstrated `competency_projections` row MUST remain `"needs_attention"` while the profile exposes both demonstrated projections and `self_declaration` distinctly

### Requirement: Privacy-Filtered Competency Reads and Knowledge Atlas Inspection
The system SHALL propagate `is_local_only` and `is_ai_excluded` flags onto `competency_evidence`, SHALL exclude `is_ai_excluded = 1` evidence when building any projection for cloud AI prompts, and SHALL expose an Evidence Inspector in Knowledge Atlas showing per-dimension status, confidence, uncertainty reasons, and source records.

#### Scenario: Cloud AI context receives AI-excluded-filtered competency projection
- **GIVEN** concept `c-priv` has evidence from one `is_ai_excluded = 1` document and zero non-excluded documents
- **WHEN** a cloud AI consumer requests `c-priv`'s competency projection with `ai_context = true`
- **THEN** the returned projection MUST exclude the `is_ai_excluded = 1` evidence and report `status = "unknown"`
- **AND** the local UI Knowledge Atlas view (`ai_context = false`) MUST still display the learner's full local projection
