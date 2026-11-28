# Unified Learning Experience End-to-End Validation Specification

## ADDED Requirements

### Requirement: Core Learner Persona Scenarios (Scenarios A through E)
Automated end-to-end tests SHALL verify the casual reader (Scenario A), SuperMemo incremental learner (Scenario B), deadline student (Scenario C), multiple simultaneous goals learner (Scenario D), and exploration-to-mastery transition (Scenario E) without regressing FSRS-7 or imposing unwanted UI clutter.

#### Scenario: Scenario A — Casual reader experiences zero forced learning-OS clutter
- **GIVEN** a user opens a document directly from Library without creating Learning Goals, Study Plans, or SRS cards
- **WHEN** the user reads and navigates the document
- **THEN** zero mandatory goal prompts, unsolicited SRS obligations, or coercive streak alerts appear.

#### Scenario: Scenario B — SuperMemo incremental learner retains full FSRS-7 fidelity
- **GIVEN** an incremental learner creates extracts and cloze/Q&A flashcards and reviews them in both `StrictManual` and `Adaptive` DAQE modes
- **WHEN** reviews are graded across multiple intervals
- **THEN** FSRS-7 scheduling intervals and `review_results` match authoritative Rust/TS parity expectations with zero regressions.

#### Scenario: Scenario C — Deadline student receives deterministic pacing and slippage advisory
- **GIVEN** a learner has an active Learning Goal with an imminent `target_date` and falls behind the required daily pace
- **WHEN** Today and the Personal Learning Coach evaluate the workspace
- **THEN** DAQE prioritizes deadline-critical activities and the Coach deterministically surfaces a `deadline_slippage_risk` recommendation with a previewable focus-session action.

#### Scenario: Scenario D — Multiple simultaneous goals interleave within one session budget
- **GIVEN** a learner has two active goals with distinct subject templates (e.g., `mathematics` and `languages`) and launches a 30-minute unified `LearningSession`
- **WHEN** DAQE builds and executes the session queue
- **THEN** activities from both goals interleave according to their focus profile weights within the 30-minute time budget.

#### Scenario: Scenario E — Exploration-to-mastery promotion requires explicit user confirmation
- **GIVEN** a learner completes four `exploratory_feed_digest` activities on a recurring topic without an active goal
- **WHEN** the Coach surfaces `exploration_ready_for_structure`
- **THEN** zero Learning Goals are created automatically, and upon explicit user confirmation a new Learning Goal and structured activities are provisioned.

### Requirement: Assessment, Cross-View Consistency, and Single-Surface UX Scenarios (Scenarios F through H)
Automated end-to-end tests SHALL verify failed assessment & remediation with anti-loop caps (Scenario F), cross-view review consistency (Scenario G), and Study Mode single-surface reader reuse (Scenario H).

#### Scenario: Scenario F — Failed assessment triggers dimension-targeted remediation and anti-loop cap
- **GIVEN** a learner fails a `formal_examination` on a core concept
- **WHEN** the exam is graded and the learner completes two remediation attempts without competency improvement
- **THEN** `learning_gaps` are derived, dimension-targeted remediation is scheduled, and on the second stalled attempt the Coach surfaces `remediation_loop_stall` suggesting a modality switch rather than looping indefinitely.

#### Scenario: Scenario G — Cross-view review completion synchronizes all open surfaces
- **GIVEN** the same due flashcard is visible across Review, Scroll Mode, Queue, and a Unified Learning Session
- **WHEN** the learner completes the review in any one surface
- **THEN** exactly one canonical `learning_events` row is written and all other surfaces immediately remove the item from their due lists without stale resurrection.

#### Scenario: Scenario H — Study Mode reuses the single canonical reader host across activities
- **GIVEN** a learner launches Study Mode from a unified Learning Activity
- **WHEN** the learner toggles between `"read"` and `"study"` modes and returns to reading
- **THEN** exactly one `BaseDocumentViewer` instance exists inside `study-canonical-reader-host` and the exact prior scroll/page/selection state is restored.

### Requirement: No-AI, Privacy Isolation, Crash Recovery, and Migration Scenarios (Scenarios I through L)
Automated end-to-end tests SHALL verify full offline/no-AI operation (Scenario I), strict local-only/AI-excluded/Health-Vault isolation (Scenario J), interrupted session recovery with idempotency (Scenario K), and non-destructive v3.14.1 user migration (Scenario L).

#### Scenario: Scenario I — Full deterministic operation with no AI provider configured
- **GIVEN** zero AI providers (local or cloud) are configured
- **WHEN** the user runs Today, DAQE, Study Plans, Personal Learning Coach, all 13 Activity types, and Motivation
- **THEN** every surface operates cleanly via deterministic templates and fallbacks with zero unhandled errors.

#### Scenario: Scenario J — Local-only and AI-excluded boundaries hold across all subsystems
- **GIVEN** documents marked `isLocalOnly = true` and `isAiExcluded = true`, plus records in isolated `health/health.db`
- **WHEN** Coach explanations, Activity sandbox extensions, DAQE, and E2EE Sync v2 run
- **THEN** zero restricted document content is sent to cloud providers, untrusted extensions, or Sync outbox, and zero queries touch `health/health.db`.

#### Scenario: Scenario K — Interrupted session recovers without duplicate reviews or XP
- **GIVEN** a learner is mid-way through a `LearningSession` and experiences an abrupt reload/crash during event submission
- **WHEN** the app restarts and recovers the session
- **THEN** the exact step index and resume state are restored, and replaying the in-flight `event_id` creates zero duplicate FSRS-7 reviews and zero duplicate `motivation_xp_ledger` rows.

#### Scenario: Scenario L — Existing v3.14.1 user database migrates non-destructively
- **GIVEN** a pre-upgrade v3.14.1 SQLite database containing `review_results`, FSRS-7 states, `study_plans`, and `exam_grades`
- **WHEN** migrations through `173_coach_and_motivation_systems` execute
- **THEN** 100% of existing user records remain intact and queryable without data loss.

### Requirement: Performance, Disabled-Mode, and Evidence Invalidation Scenarios (Scenarios M through O)
Automated benchmarks and integration tests SHALL verify large-library performance budgets (Scenario M), zero-overhead disabled gamification/coaching (Scenario N), and deterministic evidence correction/invalidation propagation (Scenario O).

#### Scenario: Scenario M — Large-library benchmark meets latency and bundle budgets
- **GIVEN** a deterministic library of 10,000 items and 50,000 `learning_events` seeded via `seededRandom(seed)`
- **WHEN** `npm run bench:check` and `npm run check:bundle` execute
- **THEN** DAQE top-10 ranking completes in `< 150 ms`, Coach 12-signal detection completes in `< 50 ms`, and all performance and bundle budget gates pass.

#### Scenario: Scenario N — Disabling gamification and coaching incurs zero background work
- **GIVEN** `proactivity_level = "disabled"` and `motivation_enabled = false`
- **WHEN** the learner completes reading and review sessions
- **THEN** all Coach and Motivation UI surfaces are hidden, zero Coach detection queries, AI explanation calls, or XP ledger writes occur, and historical preferences/records remain preserved.

#### Scenario: Scenario O — Evidence correction recomputes competency and revokes mastery milestones
- **GIVEN** a learner has verified competency projections, a `mastery_outcome` milestone, and activity XP from an exam
- **WHEN** the exam is regraded downward and the prior `competency_evidence` is invalidated
- **THEN** `competency_projections` and `learning_gaps` recompute deterministically, the affected `mastery_outcome` milestone is marked `revoked_at`, and the activity `motivation_xp_ledger` remains intact.
