# Today Learning Dashboard Specification

## ADDED Requirements

### Requirement: One-Click Start Learning Launcher and Session Resume Bar
The Today workspace SHALL provide a primary `Start learning` launcher backed by DAQE orchestration and the unified `LearningSession` runtime, with compact Focus Profile and Time Budget (`5–120m` / `unlimited`) controls, and SHALL display a prominent Resume Session bar whenever an active or paused `LearningSession` exists.

#### Scenario: Launching a time-budgeted session in one click
- **GIVEN** a learner on the Today workspace with Focus Profile set to `Balanced` and Time Budget set to `15m`
- **WHEN** the learner clicks `Start learning`
- **THEN** the workspace SHALL invoke DAQE orchestration and create/open a persisted `LearningSession` in `LearningSessionHost` without requiring manual tab switching.

#### Scenario: Resuming a paused session from Today
- **GIVEN** a persisted `paused` `LearningSession` with 2 of 5 activities completed
- **WHEN** the learner opens the Today workspace
- **THEN** Today SHALL display a Resume Session bar showing progress (`2 / 5`) and elapsed active time
- **AND** clicking `Resume session` SHALL restore the paused activity at its saved checkpoint.

### Requirement: Actionable Today's Priorities With Deterministic Explainability
The Today workspace SHALL display a `Today's Priorities` section listing top DAQE-ranked heterogeneous activities with direct launch, skip, and defer controls, a `"Why am I seeing this?"` deterministic explanation trigger, and non-coercive overload advisories when applicable.

#### Scenario: Inspecting why an activity is prioritized and deferring it
- **GIVEN** `Today's Priorities` displays a top-ranked `remediation` activity
- **WHEN** the learner clicks `"Why?"` on that card
- **THEN** the workspace SHALL display the deterministic `ActivityExplanation` factors and provider provenance without invoking an LLM
- **AND** clicking `Defer` or `Skip` SHALL remove the item from the current session preview without mutating its underlying FSRS-7 interval.

### Requirement: Progressive Disclosure for Casual Readers Without Forced Goals
The Today workspace SHALL adapt cleanly to casual readers with zero goals, zero assessments, and zero AI providers, omitting nagging empty states while surfacing `Continue Where You Left Off` and `Explore Freely`.

#### Scenario: Casual reader opens Today with no goals, no due cards, and no AI provider
- **GIVEN** a user who has imported 3 documents, created zero Learning Goals, has zero due SRS cards, and has no AI provider configured
- **WHEN** the user opens Today offline
- **THEN** the `Learning Goals` section SHALL NOT render a nagging empty-state prompt
- **AND** `Start learning` SHALL default cleanly to `Free Exploration`, while `Continue Where You Left Off` and `Explore Freely` SHALL allow immediate reading without creating SRS obligations.

### Requirement: Backward-Compatible Customization and Preserved Widgets
The Today workspace SHALL preserve `dashboardLayoutStore.ts` customization, Quick Actions, and all existing addable widgets (`FocusTimerWidget`, `StreakGoalsWidget`, `ScratchpadWidget`, `UpNextQueueWidget`, `SavedQueuesWidget`, `PinnedDocsWidget`), upgrading default layouts cleanly without erasing user customizations.

#### Scenario: Preserving an existing user's customized dashboard layout
- **GIVEN** a user with a persisted `plethora_dashboard_layout_v1` config that added `widget-scratchpad` and hid `quick-tip`
- **WHEN** the user upgrades to the Today workspace
- **THEN** `normalizeDashboardLayout` SHALL preserve `widget-scratchpad` in `sectionOrder` and `quick-tip` in `hiddenSections` while making the new Today sections available without data loss.

### Requirement: Privacy-Isolated Learning Insights and Settings Search Coverage
Optional Learning Insights on Today SHALL maintain strict Health Vault (`health/health.db`) isolation via `SleepLearningDashboardCard.tsx`, and all new Today dashboard settings SHALL be registered in Settings search (`settingsSearchCatalog.ts` and `settingsSearchCoverage.ts`).

#### Scenario: SleepLearningDashboardCard remains isolated from learning orchestration
- **GIVEN** a user with sleep records stored in `health/health.db` viewing the optional `Learning Insights` section on Today
- **WHEN** Today renders `SleepLearningDashboardCard` and orchestrates `Today's Priorities`
- **THEN** sleep data SHALL be read exclusively through `healthApi` for card display and SHALL NOT be passed to DAQE, `LearningSession`, `learning_events`, or AI prompts.

#### Scenario: Searching for Today dashboard defaults in Settings
- **GIVEN** a user opens Settings search and types `focus profile` or `time budget`
- **THEN** Settings search SHALL return the corresponding Today dashboard setting targets (`today.defaultFocusProfile`, `today.defaultTimeBudget`) with localized labels and zero private user data indexed.
