# Design: Redesign Today Learning Dashboard

## Context

`DashboardTab.tsx` currently spans 2,102 lines and renders a flat customizable list of sections (`focus`, `quick-actions`, `continue-reading`, `capture-activity`, `todays-horizon`, `study-plans`, `progress`, `quick-tip`, `quick-review`) plus six addable widgets (`widget-focus-timer`, `widget-streak-goals`, `widget-scratchpad`, `widget-up-next`, `widget-saved-queues`, `widget-pinned-docs`) managed by `dashboardLayoutStore.ts`.

With Phase 2 introducing `unify-learning-activity-runtime` and `extend-daqe-learning-orchestration`, the dashboard can evolve into a focused, calm **Today** learning workspace that connects directly to the unified session runtime while respecting progressive disclosure for casual readers and preserving full customizability for power users.

## Goals / Non-Goals

- **Goals:**
  - Make **Start learning** (and **Resume session** when paused) the clear, effortless primary action on Today.
  - Surface DAQE-orchestrated heterogeneous priorities with deterministic `"Why am I seeing this?"` transparency and non-coercive overload handling.
  - Apply progressive disclosure so casual readers with zero goals/assessments see a clean, welcoming workspace with zero nagging.
  - Preserve `dashboardLayoutStore.ts` customization, Quick Actions, and all six addable widgets.
  - Maintain strict Health Vault isolation (`SleepLearningDashboardCard.tsx`) and full Settings search coverage.
- **Non-Goals:**
  - Rewriting `SleepLearningDashboardCard.tsx`'s Health Vault IPC or moving health data into main SQLite.
  - Changing global sidebar/tab navigation taxonomy (handled in Phase 3).
  - Adding mandatory streaks or XP widgets.

## Architecture & Layout

### 1. Today Workspace Section Hierarchy

The default `Today` workspace layout organizes content into six focused sections, each extracted into its own modular component under `src/components/dashboard/today/`:

1. **`today-start-learning` (`StartLearningHero.tsx`):**
   - **Resume Bar (conditional):** When `learningSessionStore` has an `active` or `paused` session, displays a prominent, non-intrusive resume strip showing session progress (`completed / total`), elapsed active time, profile badge, and primary **Resume session** + secondary **End session** actions.
   - **Start Learning Launcher:** One-click **Start learning** primary button that invokes `orchestrate_learning_session` + `create_learning_session` and opens `LearningSessionHost`.
   - **Compact Inline Controls:**
     - Focus Profile selector (`Balanced`, `Free Exploration`, `Memory Retention`, `Exam Prep`, `Deep Study`, `Custom`), defaulting to `Balanced` (or `Free Exploration` when the user has zero due SRS cards and zero active goals).
     - Time Budget chips (`10m`, `15m`, `25m`, `45m`, `Unlimited`, plus custom `5–120m` popover).
     - `StrictManual` indicator badge when the user has enabled `StrictManual` queue ordering, clarifying that manual priority order is active.
2. **`today-priorities` (`TodaysPrioritiesSection.tsx`):**
   - Renders up to 5 top-ranked heterogeneous `LearningActivity` cards from DAQE (expandable to top 10).
   - Each card shows activity kind badge, title, estimated minutes, optional goal/deadline chip, a compact **"Why?"** button opening `WhyAmISeeingThisPopover`, and direct **Start**, **Skip**, or **Defer** actions.
   - Renders `OverloadAdvisorBanner` inline at the top of the section only when DAQE reports an active `OverloadAdvisory` (with opt-in relief buttons and dismiss).
3. **`today-learning-goals` (`LearningGoalsSection.tsx`):**
   - **Progressive Disclosure Gate:** Rendered automatically ONLY when the learner has at least one active Learning Goal or Study Plan. When zero goals exist, this section does not occupy vertical space or nag the user to create a goal (a subtle optional "Create a learning goal" entry remains accessible via Quick Actions / Library / Goals tab).
   - Displays concise goal cards with completion progress, deadline feasibility status, and a one-click **Continue goal** action that launches a goal-scoped `LearningSession`.
4. **`today-continue` (`ContinueLearningSection.tsx`):**
   - Evolves the existing `continue-reading` section to show recently opened documents, extracts, and Guided Reading Trails with exact progress bars and one-click restoration via `openDocumentAtLocation` / `study-canonical-reader-host`.
5. **`today-explore` (`ExploreFreelySection.tsx`):**
   - Low-pressure discovery strip combining unread library documents, optional Smart Feeds highlights (if configured), and quick import/capture buttons.
   - Launching an item from Explore Freely opens it directly in the canonical reader or starts a `free_exploration` activity and **never** auto-enrolls the item into SRS review obligations.
6. **`today-insights` (`LearningInsightsSection.tsx`):**
   - Collapsible/optional region (collapsed or hidden cleanly if the user has no insight data or dismissed it) hosting existing `SleepLearningDashboardCard.tsx` (strictly isolated via `healthApi`) alongside optional capture/progress summaries.

### 2. Backward-Compatible `dashboardLayoutStore.ts` Evolution

- Add the new Today section IDs (`today-start-learning`, `today-priorities`, `today-learning-goals`, `today-continue`, `today-explore`, `today-insights`) to `ALL_DASHBOARD_SECTION_IDS` and update `DEFAULT_DASHBOARD_SECTION_ORDER` to lead with the Today workflow while keeping legacy section IDs (`quick-actions`, `capture-activity`, `quick-review`, etc.) and all `ADDABLE_WIDGET_IDS` valid and selectable in Customize mode.
- **Migration Normalization Rule:**
  - Introduce a schema version marker (`layoutVersion?: number`) in `DashboardLayoutConfig` stored under `DASHBOARD_LAYOUT_STORAGE_KEY`.
  - If stored config has no `layoutVersion` and `isLegacyDefaultDashboardLayout(raw)` is `true`, upgrade seamlessly to the new Today default order.
  - If stored config has user customizations (reordered sections, hidden sections, or added widgets), preserve all user choices (`hiddenSections`, `quickActionOrder`, added widgets) and prepend/merge missing Today sections only if not explicitly hidden, setting `layoutVersion = 2`.

### 3. Progressive Disclosure Matrix

| User Archetype | Visible Default Sections | Hidden / Non-Intrusive |
|---|---|---|
| **Casual Reader** (0 goals, 0 due SRS, 0 AI) | `Start learning` (defaults to `Free Exploration`), `Continue Where You Left Off`, `Explore Freely`, `Quick Actions` | `Learning Goals` auto-hidden; no empty exam/streak/XP prompts; zero AI setup banners |
| **SRS / Incremental Learner** (due cards, 0 goals) | `Start learning` (`Balanced` / `Memory Retention`), `Today's Priorities`, `Continue`, `Explore Freely` | `Learning Goals` auto-hidden; overload advisor appears only if backlog threshold exceeded |
| **Structured / Exam Learner** (active goals / plans / exams) | `Start learning` (+ Resume bar if paused), `Today's Priorities`, `Learning Goals`, `Continue`, `Explore Freely`, optional `Learning Insights` | Power widgets (`FocusTimer`, `Scratchpad`, `SavedQueues`, etc.) available on demand via Customize |

### 4. Settings Search Coverage

Per `AGENTS.md` and `docs/settings-search.md`, every new user-configurable Today / session-launcher setting MUST be wired for deterministic Settings search:

- Stable target IDs (`searchId` / `<SettingsSearchTarget>`):
  - `today.defaultFocusProfile` — Default Today session focus profile
  - `today.defaultTimeBudget` — Default Today session time budget
  - `today.showLearningInsights` — Show optional Learning Insights section on Today
  - `today.resetLayout` — Reset Today dashboard layout to default
- Register each entry in `src/components/settings/search/settingsSearchCatalog.ts` using actual localized translation keys and purposeful aliases (e.g., `today`, `dashboard`, `start learning`, `focus profile`, `time budget`, `insights`).
- Add the corresponding coverage inventory rows in `src/components/settings/search/settingsSearchCoverage.ts` and verify via `settingsSearch.test.ts` and `settingsSearchCoverage.test.ts`.

### 5. Health Vault & Offline Guarantees

- `LearningInsightsSection.tsx` embeds `SleepLearningDashboardCard.tsx` strictly as an isolated presentation slot; no props or callbacks pass sleep/wearable numbers upward into `DashboardTab`, `learningSessionStore`, or `daqeRankingClient`.
- Every Today section renders with local SQLite / Zustand state when offline and with zero AI providers configured.

## Risks / Trade-offs

- **Risk: Regressing existing `DashboardTab` customization, drag-and-drop, or context menus.**
  - *Mitigation:* Keep `DashboardCustomizeSectionFrame`, `QuickActionsPicker`, and `WidgetGalleryPanel` intact and run all existing dashboard layout & widget tests alongside new Today tests.
- **Risk: Layout shift during startup hydration.**
  - *Mitigation:* Reserve stable card heights for `StartLearningHero` and `TodaysPrioritiesSection`, and render cached/previous DAQE snapshot immediately while fresh ranking computes asynchronously.
