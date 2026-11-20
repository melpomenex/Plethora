## Why

Sleep and physiological intelligence only help learners when surfaced intuitively inside Plethora's Material 3 workspace — without burying insights inside settings, cluttering existing Study Plans, inflating the eager Vite entry chunk beyond `bundle-budgets.json`, or breaking Settings Search coverage and accessibility.

## What Changes

- Add lazy-loaded `"learning-insights"` workspace destination wired across `tabsStore.ts`, `tabDestinations.ts`, `TabRegistry.tsx`, desktop `Toolbar.tsx`, and mobile `MobileNavigation.tsx`.
- Build `LearningInsightsTab` (`src/components/tabs/LearningInsightsTab.tsx` + `src/components/health/`) with 5 cohesive views: `Overview`, interactive multi-month `Sleep Chart` (color + visual pattern/hatch for stages, naps, missing-data gaps, learning-session overlays, zoom & detail drawer), `Learning Performance` (sleep/awake/latency/nap/HRV/assessment charts with Study Plan & activity filters), `Personal Patterns` (explainable insights + native `<dialog>` Inspect Evidence modal), and `Data Sources`.
- Add **Settings → Integrations → Health & Wearables** (`HealthWearablesSettings.tsx`) with progressive provider onboarding, granular permission scopes, source priority reordering, manual sleep entry, CSV/JSON/Apple `export.xml`/`.plethora-health.enc` import/export, consent audit log, and complete data deletion confirmation (`<dialog>` with `autofocus` on Cancel), plus Settings Search catalog & coverage entries.
- Add non-intrusive `StudyPlanHealthInsightsCard` to `PlanHomeView.tsx` and `StudyPlanProgress.tsx` when relevant health insights exist, without altering FSRS or blocking exams.
- Provide explicitly tagged isolated Synthetic Demo Mode for exploring UI without a wearable, while keeping empty states free of invented demonstration data by default.

## Capabilities

### New Capabilities

- `learning-insights-ui`: Material 3 Learning Insights destination, high-DPI accessible Sleep Chart, Learning Performance & Personal Patterns views, progressive Health & Wearables Settings & onboarding, Settings Search coverage, and unobtrusive Study Plan integration.

### Modified Capabilities

None.

## Impact

- **Frontend:** `src/types/health.ts`, `src/api/health.ts`, `src/stores/healthStore.ts`, `src/components/health/*`, `src/components/tabs/LearningInsightsTab.tsx`, `src/components/settings/{IntegrationSettings,HealthWearablesSettings}.tsx`, `src/components/settings/search/{settingsSearchCatalog,settingsSearchCoverage}.ts`, `src/components/study-plans/{StudyPlanHealthInsightsCard,home/PlanHomeView,evidence/StudyPlanProgress}.tsx`, `src/navigation/tabDestinations.ts`, `src/components/tabs/TabRegistry.tsx`, `src/components/Toolbar.tsx`, `src/components/mobile/MobileNavigation.tsx`.
- **Bundle & Design Constraints:** All new UI modules lazy-loaded via `debugLazy`; strictly uses `var(--color-*)` tokens, surface-container elevation ladder, native `<dialog>` overlays, `<figure>` + `sr-only` data tables for charts, and reduced-motion support.
- **Documentation Impact:** Product doc `docs/product/features/platform/wearable-health-insights.md` (Change G).
