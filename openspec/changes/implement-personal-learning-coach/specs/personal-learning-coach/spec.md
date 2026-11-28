# Personal Learning Coach Specification

## ADDED Requirements

### Requirement: Deterministic 12-Signal Opportunity Detection
The Personal Learning Coach SHALL evaluate 12 canonical learning signal types (`review_backlog_overload`, `deadline_slippage_risk`, `mastery_gap_detected`, `leech_or_high_lapse_cluster`, `passive_reading_imbalance`, `prerequisite_readiness_block`, `stale_goal_momentum`, `remediation_loop_stall`, `cross_dimension_mismatch`, `session_fatigue_or_fragmentation`, `exploration_ready_for_structure`, `prior_evidence_skip_opportunity`) deterministically from local SQLite projections without requiring any AI provider.

#### Scenario: Backlog overload detected deterministically without AI
- **GIVEN** no AI provider is configured and the learner has overdue FSRS-7 items exceeding 2.0x their 14-day daily throughput
- **WHEN** the Personal Learning Coach evaluates the learner snapshot
- **THEN** it emits a `review_backlog_overload` recommendation with `severity = "urgent"`, concrete overdue count in `evidenceRefs`, a localized deterministic summary, and a proposed `open_session_profile("backlog_triage")` action.

#### Scenario: Repeated evaluation on unchanged state is idempotent
- **GIVEN** no new `learning_events` or preference updates have occurred since the last evaluation
- **WHEN** the Coach detector is invoked again
- **THEN** it returns the identical ranked recommendations without creating duplicate `coach_recommendations` rows.

### Requirement: Five Explicit Proactivity Levels
The Personal Learning Coach SHALL support five user-configurable proactivity levels (`disabled`, `on_demand`, `minimal`, `balanced`, `proactive`) plus optional quiet hours and per-signal dismissal/snooze controls.

#### Scenario: Disabled proactivity level incurs zero evaluation and hides UI
- **GIVEN** the user sets `proactivity_level` to `disabled`
- **WHEN** the user opens Today, Queue, or Study Mode
- **THEN** all Coach UI surfaces are hidden, zero Coach detection queries execute, zero AI explanation tasks are invoked, and previously saved preferences and dismissal history remain preserved in SQLite.

#### Scenario: On-demand proactivity level only runs when explicitly requested
- **GIVEN** `proactivity_level` is set to `on_demand`
- **WHEN** the user navigates through Today and completes a review session without opening the Coach Drawer
- **THEN** zero unsolicited Coach cards or banners are displayed, and when the user explicitly triggers "Ask Learning Coach", the detector runs and displays ranked opportunities in the Coach Drawer.

#### Scenario: Minimal proactivity level filters to urgent advisories only
- **GIVEN** `proactivity_level` is set to `minimal` and the detector finds both an `info` (`passive_reading_imbalance`) signal and an `urgent` (`deadline_slippage_risk`) signal
- **WHEN** the Today workspace renders Coach recommendations
- **THEN** only the `urgent` recommendation is surfaced (at most 1 card).

### Requirement: AI-Optional Privacy-Gated Explanations
Optional natural-language coaching explanations SHALL route exclusively through `src/lib/ai/tasks/runTask.ts`, SHALL be gated by `enforceAssistantPrivacyAndConsent` (`src/lib/ai/assistant/privacyGate.ts`), and SHALL degrade gracefully to deterministic templates whenever AI is unavailable, disabled, or blocked by document privacy policy.

#### Scenario: Local-only document blocks cloud AI explanation and falls back deterministically
- **GIVEN** `ai_explanations_enabled` is true, only a cloud AI provider is configured, and a coaching recommendation references a document marked `isLocalOnly = true`
- **WHEN** the Coach attempts to generate an AI explanation for that recommendation
- **THEN** `enforceAssistantPrivacyAndConsent` blocks the cloud request, zero document content is sent over the network, and the card renders the deterministic template summary cleanly.

#### Scenario: AI-excluded document never reaches any AI provider
- **GIVEN** a recommendation references a document marked `isAiExcluded = true` and a local Ollama provider is active
- **WHEN** the Coach renders the recommendation
- **THEN** the AI explanation request is bypassed and the deterministic local summary is displayed.

### Requirement: Strictly Non-Mutating Coaching Boundary
The Personal Learning Coach SHALL NEVER directly mutate FSRS-7 schedules, `learning_events`, `learning_goals`, `study_plans`, `competency_evidence`, or `learning_remediations`; every proposed action SHALL require explicit user confirmation and delegate execution to the owning domain service.

#### Scenario: Viewing or dismissing a recommendation leaves canonical learning state untouched
- **GIVEN** the Coach surfaces a `prior_evidence_skip_opportunity` recommendation for an active Study Plan
- **WHEN** the user views, snoozes, or dismisses the recommendation without confirming the proposed action
- **THEN** the Study Plan nodes, FSRS-7 queues, and competency records remain completely unchanged.

#### Scenario: Confirming a proposed action delegates to the owning domain service
- **GIVEN** the Coach surfaces a `review_backlog_overload` recommendation proposing `open_session_profile("backlog_triage")`
- **WHEN** the user reviews the action preview and explicitly clicks Confirm
- **THEN** `CoachActionDispatcher` invokes the Unified Session Runtime to start a `backlog_triage` session and marks the recommendation `accepted`.

### Requirement: Settings Search Coverage for Coaching Controls
Every user-configurable Personal Learning Coach setting SHALL expose a stable `searchId`, register an entry in `src/components/settings/search/settingsSearchCatalog.ts`, and declare coverage in `src/components/settings/search/settingsSearchCoverage.ts` without indexing private user data.

#### Scenario: User searches for Coach proactivity in Settings
- **GIVEN** the user opens Settings and searches for "coach" or "proactivity"
- **THEN** the Settings Search results list the Learning Coach proactivity control with localized text and navigate directly to `coach.proactivityLevel` without mutating the current value.
