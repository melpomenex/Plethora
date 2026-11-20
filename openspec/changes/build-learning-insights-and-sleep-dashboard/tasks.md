## Tasks

- [x] F-T01 Add TypeScript health/analytics contracts (`src/types/health.ts`), IPC API wrappers (`src/api/health.ts`), and Zustand store (`src/stores/healthStore.ts`)
- [x] F-T02 Register lazy `"learning-insights"` tab in `tabsStore.ts`, `tabDestinations.ts`, `TabRegistry.tsx`, `Toolbar.tsx`, and `MobileNavigation.tsx`
- [x] F-T03 Implement `LearningInsightsTab.tsx`, `OverviewPanel`, `SleepChartPanel` (Canvas/SVG timeline + pattern/tone encoding + Recharts trends & Borbély alertness + `sr-only` tables + day inspector), `LearningPerformancePanel`, and `PersonalPatternsPanel` (with native `<dialog>` Inspect Evidence modal)
- [x] F-T04 Implement `DataSourcesPanel`, progressive consent onboarding `<dialog>`, manual sleep `<dialog>`, CSV/JSON/Apple XML/`.plethora-health.enc` import/export UI, and `HealthWearablesSettings.tsx` inside `IntegrationSettings.tsx`
- [x] F-T05 Register all Settings Search targets, catalog entries (`settingsSearchCatalog.ts`), and coverage rows (`settingsSearchCoverage.ts`) and verify `settingsSearchCoverage.test.ts` passes
- [x] F-T06 Implement non-blocking `StudyPlanHealthInsightsCard.tsx` and integrate cleanly into `PlanHomeView.tsx` and `StudyPlanProgress.tsx`
- [x] F-T07 Verify bundle budgets (`npm run check:bundle`), `tsc`, `lint`, and Vitest component tests
