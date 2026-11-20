## ADDED Requirements

### Requirement: Learning Insights is a first-class responsive workspace destination
The system SHALL expose `"learning-insights"` via `tabDestinations.ts`, `TabRegistry.tsx`, desktop `Toolbar.tsx`, and mobile `MobileNavigation.tsx`, rendering five responsive views (`Overview`, `Sleep Chart`, `Learning Performance`, `Personal Patterns`, `Data Sources`) using Material 3 tokens, reduced-motion awareness, and semantic chart tables without inflating the eager entry chunk.

#### Scenario: Empty state refuses to show fabricated demonstration data
- **WHEN** a user with zero manual or wearable sleep entries opens `Learning Insights`
- **THEN** the UI shows clear empty-state guidance, a quick manual sleep log action, provider onboarding access, and an explicit opt-in Demo Mode button without rendering fake historical sleep charts

### Requirement: Sleep Chart displays multi-month timelines, stages, naps, gaps, and study overlays accessibly
The system SHALL render day/week/month/multi-month/custom ranges showing main sleep, naps, available sleep stages (distinguished by both tone and pattern/label), missing-data gaps, and optional learning-session overlays, and SHALL allow keyboard and pointer inspection of exact timestamps, provenance, and source conflicts.

#### Scenario: Unstaged sleep renders without fabricated stage bands
- **WHEN** a user views a manual or unstaged sleep episode on the Sleep Chart
- **THEN** the bar renders as `Asleep (Unstaged)` with explicit stage-unavailable metadata in the day inspector rather than synthetic REM/Deep segments

### Requirement: Health & Wearables onboarding, management, and Study Plan integration honor honesty and Settings Search
The system SHALL provide progressive category-level consent onboarding, honest provider readiness states (`Connect`, `Not Configured`, `Requires Developer Approval`, `Unsupported`), source priority ordering, full deletion `<dialog>` confirmation, Settings Search registration passing `settingsSearchCoverage.test.ts`, and an optional non-blocking `StudyPlanHealthInsightsCard` inside Study Plans.

#### Scenario: Study Plan card stays unobtrusive and never alters grading or FSRS
- **WHEN** a learner opens a Study Plan with or without wearable data
- **THEN** Study Plan progression, assessments, and FSRS scheduling behave identically, and insights appear only as optional contextual summaries when supporting data exists
