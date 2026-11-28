# DAQE Learning Orchestration Specification

## ADDED Requirements

### Requirement: Heterogeneous Candidate Providers With Graceful Fallback
The DAQE orchestrator SHALL collect bounded `LearningActivity` candidates across heterogeneous providers (`srs_due_pool`, `learning_goals`, `guided_trails`, `remediation`, `exam_prep`, and optional `smart_feeds`) while degrading gracefully if any non-core provider is empty or unavailable.

#### Scenario: Assembling candidates across multiple active providers
- **GIVEN** a library with due SRS flashcards, an active Learning Goal with a Guided Reading Trail, an unresolved remediation gap, and unread Smart Feeds articles
- **WHEN** the learner requests an orchestrated session in `balanced` profile
- **THEN** DAQE SHALL gather bounded candidates from each active provider, deduplicate by `dedupeKey`, and return a heterogeneous ranked list without mutating any FSRS-7 schedule or creating SRS obligations for Smart Feeds items.

#### Scenario: Casual user with zero goals, zero exams, and zero AI providers
- **GIVEN** a user who has never created a Learning Goal, Study Plan, or Examination and has no AI provider configured
- **WHEN** DAQE orchestrates a session offline
- **THEN** DAQE SHALL succeed using `srs_due_pool` and library/exploration candidates without prompting the user to create goals or assessments.

### Requirement: Normalized Deterministic Scoring and Mode Preservation
The orchestrator SHALL score candidates deterministically using normalized `[0, 1]` factors with honest `TermValue::unavailable()` handling for absent signals, SHALL preserve `QueueOrderingMode::StrictManual` vs `Adaptive`, and SHALL meet the 150 ms top-10 latency budget.

#### Scenario: Byte-identical deterministic ordering across repeated invocations
- **GIVEN** an unchanged candidate pool, fixed UTC clock, and fixed session focus profile
- **WHEN** the orchestrator ranks the pool twice
- **THEN** both outputs SHALL be byte-identical in item order, factor values, and composite scores.

#### Scenario: StrictManual mode bypasses adaptive profile weighting
- **GIVEN** `orderingMode = "strict_manual"`
- **WHEN** DAQE ranks the candidate pool
- **THEN** candidates SHALL be ordered strictly by manual priority descending, then due instant ascending, item type, and ID, regardless of the active session focus profile.

#### Scenario: Missing signals reported as unavailable rather than zero
- **GIVEN** a candidate with no active Learning Goal and no deadline
- **WHEN** DAQE computes its `OrchestrationBreakdown`
- **THEN** `goal_relevance` and `deadline_pressure` SHALL be reported as `unavailable` and excluded from weight normalization rather than scored as `0.0`.

### Requirement: Session Focus Profiles and Time-Budgeted Assembly
The system SHALL support six Session Focus Profiles (`balanced`, `free_exploration`, `memory_retention`, `exam_prep`, `deep_study`, `custom`) and configurable session time budgets (`5` to `120` minutes or `unlimited`).

#### Scenario: Switching focus profile changes session composition predictably
- **GIVEN** a mixed candidate pool containing overdue SRS cards, unread Smart Feeds articles, and an exam blueprint
- **WHEN** the learner selects `memory_retention` vs `free_exploration` vs `exam_prep`
- **THEN** `memory_retention` SHALL prioritize overdue `srs_review` items, `free_exploration` SHALL prioritize novel reading/exploration candidates with zero forced assessments, and `exam_prep` SHALL prioritize exam blueprints and weak-dimension remediation.

#### Scenario: Packing a 15-minute time-budgeted session
- **GIVEN** a candidate pool with estimated durations ranging from 2 to 20 minutes
- **WHEN** the learner requests a `15`-minute session
- **THEN** DAQE SHALL pack ranked activities whose combined `estimatedMinutes` fits within `15` minutes (or, if the smallest eligible item exceeds 15 minutes, include the single top item and report `budgetOverflowMinutes` explicitly).

### Requirement: Non-Coercive Overload Advisor and Deadline Balancing
The orchestrator SHALL detect SRS backlog overload and deadline crunch deterministically and present non-coercive relief options without silently altering FSRS schedules or dropping user items.

#### Scenario: Detecting SRS backlog overload
- **GIVEN** a learner with due SRS reviews exceeding twice their rolling 7-day daily study pace
- **WHEN** DAQE evaluates the session plan
- **THEN** DAQE SHALL return an `OverloadAdvisory` with actionable, opt-in relief choices (`focus_retention_triage`, `pause_new_introductions`, `focus_single_deadline`, `keep_as_is`)
- **AND** SHALL NOT automatically postpone, bury, or alter FSRS due dates unless the user explicitly invokes an action.

### Requirement: Deterministic "Why am I seeing this?" Explainability
Every ranked activity returned by DAQE SHALL include a deterministic `ActivityExplanation` derived exclusively from its `OrchestrationBreakdown` and provider metadata, with zero LLM-fabricated rationales.

#### Scenario: Inspecting explanation for a top-ranked activity
- **GIVEN** a ranked activity returned by DAQE in `Adaptive` mode
- **WHEN** the learner opens "Why am I seeing this?"
- **THEN** the explanation SHALL display the exact `providerId`, `profileId`, `primaryReason`, individual factor states (`measured`, `defaulted`, `unavailable`), weights, signed contributions, and total score matching `OrchestrationBreakdown::score()`.

### Requirement: Privacy, Local-Only Filtering, and Health Vault Isolation
DAQE orchestration SHALL enforce `is_local_only` and `is_ai_excluded` boundaries and SHALL never read `health/health.db`.

#### Scenario: Excluding local-only and AI-excluded items from optional remote decision-model pass
- **GIVEN** a pool containing both normal documents and a document marked `is_local_only = true` or `is_ai_excluded = true`
- **WHEN** the optional second-pass `rank_queue_with_decision` runs against a remote decision provider
- **THEN** the local-only / AI-excluded item SHALL be scored solely by local deterministic Rust signals and SHALL NOT be included in any outbound remote model request.
