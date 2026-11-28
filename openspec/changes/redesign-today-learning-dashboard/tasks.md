# Tasks: Redesign Today Learning Dashboard

## 1. Layout Store Evolution & Backward Compatibility
- [ ] Update `src/stores/dashboardLayoutStore.ts` with additive Today section IDs (`today-start-learning`, `today-priorities`, `today-learning-goals`, `today-continue`, `today-explore`, `today-insights`) and `layoutVersion` normalization that upgrades untouched default layouts while preserving custom section orders, hidden sections, Quick Actions, and all six addable widgets.
- [ ] Add unit tests for `dashboardLayoutStore.ts` covering legacy default upgrade, legacy customized layout preservation, and reset-to-default behavior.

## 2. Modular Today Workspace Sections
- [ ] Create `src/components/dashboard/today/StartLearningHero.tsx` with one-click `Start learning` launcher, conditional Resume Session bar (wired to `learningSessionStore`), inline Focus Profile and Time Budget (`5–120m` / `unlimited`) selectors, and `StrictManual` indicator.
- [ ] Create `src/components/dashboard/today/TodaysPrioritiesSection.tsx` displaying top DAQE-orchestrated activities with `WhyAmISeeingThisPopover`, `OverloadAdvisorBanner`, and direct Start/Skip/Defer actions.
- [ ] Create `src/components/dashboard/today/LearningGoalsSection.tsx` with progressive disclosure (auto-hidden when zero active goals exist) and one-click goal-scoped session launch.
- [ ] Create `src/components/dashboard/today/ContinueLearningSection.tsx` and `src/components/dashboard/today/ExploreFreelySection.tsx` preserving exact jump restoration (`openDocumentAtLocation`) and ensuring Explore Freely never auto-creates SRS obligations.
- [ ] Create `src/components/dashboard/today/LearningInsightsSection.tsx` hosting existing `SleepLearningDashboardCard.tsx` with strict Health Vault isolation and dismiss/collapse support.

## 3. DashboardTab Integration & i18n
- [ ] Refactor `src/components/tabs/DashboardTab.tsx` to compose the modular Today sections inside existing `DashboardCustomizeSectionFrame`, `QuickActionsPicker`, and `WidgetGalleryPanel` flows without breaking existing keyboard shortcuts or tab IDs.
- [ ] Add localized i18n keys for all Today workspace labels, focus profiles, time budgets, and empty/fallback states.

## 4. Settings Controls & Settings Search Coverage
- [ ] Add user-configurable Today settings (`today.defaultFocusProfile`, `today.defaultTimeBudget`, `today.showLearningInsights`, `today.resetLayout`) wrapped with stable `searchId` primitives.
- [ ] Register all new Today settings entries in `src/components/settings/search/settingsSearchCatalog.ts` and `src/components/settings/search/settingsSearchCoverage.ts` (ensuring localized labels and zero private values indexed).

## 5. Verification
- [ ] Add Vitest component tests for Today workspace: one-click session launch, paused session resume bar, casual-reader progressive disclosure (0 goals / 0 AI / offline), `"Why?"` explanation popover, Health Vault isolation boundary, and preserved widget customization.
- [ ] Run `npx tsc --noEmit`, `npx vitest run src/components/dashboard src/components/tabs src/components/settings`, and `npm run check:bundle` to verify all gates pass.
