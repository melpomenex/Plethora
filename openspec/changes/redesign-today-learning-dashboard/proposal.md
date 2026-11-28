# Proposal: Redesign Today Learning Dashboard

## Why

`src/components/tabs/DashboardTab.tsx` (2,102 LOC) currently presents a collection of independent widgets (Quick Review, Study Plans, Capture Activity, Focus Timer, Saved Queues, Sleep & Learning) without a unified answer to the learner's primary daily question: *"What should I learn right now?"* Users must manually jump between Queue, Review, Study Plans, and Library to piece together a session, and paused work across surfaces is fragmented. Meanwhile, casual readers can feel overwhelmed by dense power-user widgets, whereas structured learners lack a single place to launch a time-budgeted, goal-aware session or inspect why an activity is recommended.

## What Changes

- Evolve `DashboardTab.tsx` into an actionable **Today** learning workspace organized around six calm, progressively disclosed sections:
  1. **Start Learning Launcher & Active Session Resume Bar** (one-click heterogeneous `LearningSession` launch with compact Session Focus Profile and Time Budget controls, plus instant resume for paused sessions).
  2. **Today's Priorities** (top DAQE-orchestrated activities with deterministic `"Why am I seeing this?"` popovers, skip/defer controls, and non-coercive overload advice).
  3. **Learning Goals** (progress and next-step cards shown only when the learner has active goals—never nagging casual readers).
  4. **Continue Where You Left Off** (recent documents, extracts, and guided trails with exact jump restoration).
  5. **Explore Freely** (unread library items, optional Smart Feeds picks, and quick import/capture without creating SRS obligations).
  6. **Optional Learning Insights** (privacy-isolated insights region hosting `SleepLearningDashboardCard.tsx` and optional analytics/capture cards).
- Extend `src/stores/dashboardLayoutStore.ts` additively with Today section IDs while preserving existing user layout customizations (`plethora_dashboard_layout_v1`), Quick Actions, and all addable widgets in `src/components/dashboard/widgets/*`.
- Modularize `DashboardTab.tsx` by extracting cohesive Today section components (`src/components/dashboard/today/*`) to reduce complexity and keep rendering fast.
- Register all new Today dashboard preferences in `src/components/settings/search/settingsSearchCatalog.ts` and `settingsSearchCoverage.ts` with stable `searchId`s.

## Capabilities

### New Capabilities

- `today-learning-dashboard`: Actionable Today learning workspace with one-click session launch/resume, DAQE-backed priorities, progressive disclosure for casual vs structured learners, preserved widget customization, and Settings search coverage.

### Modified Capabilities

- None (evolves existing `DashboardTab` and `dashboardLayoutStore` additively while keeping existing widgets, quick actions, and tab identifiers compatible).

## Dependencies

- `unify-learning-activity-runtime` (Phase 2): Powers launching, pausing, and resuming heterogeneous `LearningSession` instances from the Today hero and priority cards.
- `extend-daqe-learning-orchestration` (Phase 2): Supplies `Today's Priorities`, Session Focus Profile selection, time-budgeted session previews, overload advisories, and deterministic `"Why am I seeing this?"` explanations.

## Non-Goals

- Overhauling global sidebar/toolbar/mobile navigation routes (owned by Phase 3 `consolidate-learning-navigation-and-workspaces`).
- Introducing mandatory streaks, XP counters, or gamification on Today (optional motivation is owned by Phase 4 `implement-optional-motivational-systems`).
- Removing existing addable dashboard widgets (`FocusTimerWidget`, `StreakGoalsWidget`, `ScratchpadWidget`, `UpNextQueueWidget`, `SavedQueuesWidget`, `PinnedDocsWidget`) or breaking saved layouts.
- Merging Health Vault (`health/health.db`) data into DAQE or general learning widgets.

## Privacy & Security

- **Health Vault Isolation:** `SleepLearningDashboardCard.tsx` continues to read exclusively via the isolated `healthApi` bridge (`health/health.db`), remains dismissible/opt-in, and never passes wearable or sleep data into DAQE, `LearningSession`, `learning_events`, or AI prompts.
- **Local-Only & AI-Excluded Respect:** Today priority cards and Explore Freely items render purely from local SQLite/store metadata; items marked `is_local_only` or `is_ai_excluded` display a subtle local-only badge where helpful and never trigger cloud requests.
- **Offline & Zero-AI Resilience:** The entire Today workspace renders and launches sessions 100% offline with zero AI providers configured.
- **Settings Search Privacy:** Registered Today Settings entries index only localized labels/aliases—never user document titles, goal text, or private values.

## Migration & Backward Compatibility

- `dashboardLayoutStore.ts` (`DASHBOARD_LAYOUT_STORAGE_KEY = "plethora_dashboard_layout_v1"`) normalizes legacy saved `sectionOrder` / `hiddenSections` arrays gracefully: users with an unmodified default layout receive the new Today default order automatically; users with customized layouts keep their hidden sections and added widgets while new Today sections append cleanly without data loss.
- All existing tab IDs (`dashboard`), keyboard shortcuts, and command-palette actions continue to open the Today workspace seamlessly.

## Performance

- Initial Today workspace hydration MUST NOT block first paint: DAQE top-10 priorities, active session lookup, and recent documents load concurrently with non-blocking skeletons/previous-snapshot rendering.
- Extracting section subcomponents and memoizing derived priority lists avoids unnecessary re-renders when focus timer ticks or unrelated stores update.
- Bundle budget compliance verified via `npm run check:bundle` and `npm run bench:check`.

## Rollback & Recovery

- If DAQE orchestration or the activity runtime returns an empty or unavailable response, Today falls back cleanly to Continue Where You Left Off, Quick Actions, and Explore Freely without error screens.
- Resetting layout in Customize mode restores `createDefaultDashboardLayout()` cleanly.

## Impact

- **Frontend Components:** `src/components/tabs/DashboardTab.tsx`, `src/components/dashboard/today/{StartLearningHero.tsx, TodaysPrioritiesSection.tsx, LearningGoalsSection.tsx, ContinueLearningSection.tsx, ExploreFreelySection.tsx, LearningInsightsSection.tsx}`.
- **Stores & Settings:** `src/stores/dashboardLayoutStore.ts`, Settings dashboard/launcher controls, `src/components/settings/search/{settingsSearchCatalog.ts, settingsSearchCoverage.ts}`, and i18n locale strings.
- **Tests:** Vitest component/layout/progressive-disclosure tests, Settings search coverage tests, and accessibility/offline assertions.
