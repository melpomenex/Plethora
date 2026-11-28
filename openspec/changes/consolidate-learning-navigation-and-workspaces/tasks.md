# Tasks: Consolidate Learning Navigation and Workspaces

## 1. Canonical Navigation Grouping & Alias Compatibility
- [ ] Add `PrimaryNavGroup` (`today`, `library`, `learn`, `review`, `discover`, `knowledge`, `insights`, `system`) to `NavigationDestination` in `src/navigation/tabDestinations.ts`, map every existing destination to its group, and add canonical aliases (`today`, `library`, `learn`, `discover`, `knowledge`, `insights`) while retaining 100% of existing `TAB_TYPE_ALIASES`.
- [ ] Update `src/components/Toolbar.tsx` to render the 7 primary learning-lifecycle destinations with sub-destination switchers, power-user pinning support, preserved middle-click split-pane actions, context menus (`useSurfaceMenu`), and `TOUR_ANCHORS`.
- [ ] Update `src/components/mobile/MobileNavigation.tsx` to align bottom navigation and overflow sheet with the 7 primary destinations while preserving `getPlatformCapability` filtering and `MOBILE_NAV_ANCHORS`.
- [ ] Update `src/components/tabs/TabRegistry.tsx`, `src/components/layout/MainLayout.tsx`, and `src/commandPalette/registry.ts` so every grouped destination exposes clean sub-view switching without removing or breaking any `TabType` or keyboard shortcut.
- [ ] Register any new navigation/toolbar pinning preferences in `src/components/settings/search/settingsSearchCatalog.ts` and `src/components/settings/search/settingsSearchCoverage.ts` with corresponding tests.

## 2. Universal Study Workspace Launch & Contextual Assistant
- [ ] Implement canonical `launchStudyWorkspace` coordinator in `src/lib/study-plans/studyMode/launchStudyWorkspace.ts` supporting launch from documents, extracts, flashcards, Study Plan nodes, guided reading trails, remediations, and Unified Learning Sessions.
- [ ] Wire `DocumentViewerWrapper.tsx` (`study-canonical-reader-host`) and `StudyModeWorkspace.tsx` to accept `StudyWorkspaceLaunchRequest`, preserve mutually exclusive `"read" | "study"` modes and single-instance reader invariant, and restore exact `returnRoute` state on close/return.
- [ ] Update `src/lib/study-plans/openStudySource.ts`, Study Plan node actions, remediation cards, and Unified Learning Session activity launchers to route through `launchStudyWorkspace`.
- [ ] Enforce `privacyGate.ts` (`is_local_only` / `is_ai_excluded`), `examIsolationActive` Assistant suppression, and Health Vault isolation across workspace Assistant and `Insights` sub-views.

## 3. Dead Duplicate Route & Component Cleanup
- [ ] Verify zero live imports of the 8 unused React Router files in `src/routes/` (`index.tsx`, `dashboard.tsx`, `documents.tsx`, `queue.tsx`, `review.tsx`, `settings.tsx`, `analytics.tsx`, `study-plans.tsx`) and remove them cleanly.
- [ ] Verify zero live mounts of `src/components/viewer/study-mode/OriginalSourcePane.tsx` and `src/components/tabs/ScreenshotTab.tsx` and remove them cleanly without breaking any exported types.

## 4. Verification, Tests & Bundle Budget
- [ ] Extend `src/navigation/__tests__/tabDestinations.test.ts` to assert all 7 primary groups, every legacy alias, every new primary alias, and zero duplicate alias collisions.
- [ ] Add Vitest component/integration tests covering desktop `Toolbar.tsx`, `MobileNavigation.tsx` capability filtering, `launchStudyWorkspace` single-reader invariant and return-to-origin restoration, casual `"read"` mode default, `is_local_only` Assistant privacy gate, and `examIsolationActive` suppression.
- [ ] Run `npx tsc --noEmit`, targeted navigation/workspace Vitest suites, Settings search coverage tests, and `npm run bench:check` (bundle budget gate).
