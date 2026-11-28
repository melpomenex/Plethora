# Proposal: Consolidate Learning Navigation and Workspaces

## Why

Plethora's current shell (`Toolbar.tsx`, `MobileNavigation.tsx`, `TabRegistry.tsx`, `tabDestinations.ts`, `MainLayout.tsx`) exposes 27 top-level `TabType` destinations accumulated across multiple feature waves, while Study Mode (`DocumentViewerWrapper.tsx` / `study-canonical-reader-host`) is currently launched primarily from documents rather than uniformly from any learning activity. In addition, the repository audit (`docs/architecture/unified-learning-os-audit.md`) identified 8 unused legacy React Router files in `src/routes/` and several unmounted duplicate components that add maintenance confusion without serving live users.

This fragmentation creates friction for both new and power users:
1. **High cognitive load in primary navigation:** New learners see flat tool buttons (`Queue`, `Scroll Mode`, `Extracts`, `Study Plans`, `RSS`, `Newsletters`, `Podcasts`, `Audiobooks`, `Knowledge Sphere`, `Knowledge Network`, `Analytics`, `Learning Insights`, etc.) instead of a clear learning lifecycle.
2. **Disconnected activity entry points:** Launching a document, extract, flashcard source, guided reading trail, curriculum node, remediation task, or Unified Learning Session step opens inconsistent workspace chrome rather than routing cleanly into the single canonical Study Workspace (`DocumentViewerWrapper.tsx`).
3. **Power-user regression risk if consolidated carelessly:** Power users rely heavily on keyboard shortcuts, command palette aliases (`CommandCenter.tsx`), Vimium navigation, middle-click split-pane opens, and deep links (`/queue`, `/scroll-mode`, `/study-plans`, `/rss`, `/knowledge-sphere`, `/analytics`, etc.).

## What Changes

- **Primary navigation consolidation (7 learning-lifecycle destinations):** Organize primary desktop toolbar (`Toolbar.tsx`) and mobile navigation (`MobileNavigation.tsx`) around seven cohesive top-level learning-lifecycle destinations:
  1. `Today` (actionable daily learning hub / dashboard)
  2. `Library` (documents, extracts, audiobooks, image registry, import queue)
  3. `Learn` (Learning Goals, Study Plans, Guided Reading Trails, Language Learning, Unified Learning Sessions)
  4. `Review` (FSRS Review, Queue, Scroll Mode, Saved Queues)
  5. `Discover` (RSS / Smart Feeds, Podcasts, Newsletters, Web Browser)
  6. `Knowledge` (Knowledge Atlas, Concept Directory, 2D/3D Knowledge Universe, Document Q&A)
  7. `Insights` (Learning Analytics, Competency Progress, Privacy-isolated Health/Sleep Learning Insights)
- **Full power-user & alias compatibility:** Preserve 100% of existing `TabType` identifiers, `TAB_TYPE_ALIASES` entries, keyboard shortcuts, command palette commands (`CommandCenter.tsx`), Vimium routes, middle-click split-pane actions, and onboarding tour anchors (`TOUR_ANCHORS`) in `src/navigation/tabDestinations.ts` and `TabRegistry.tsx`.
- **Universal Study Workspace launch from any activity:** Introduce a canonical `launchStudyWorkspace(activityContext)` entry point that opens the single-instance canonical reader host (`DocumentViewerWrapper.tsx` / `study-canonical-reader-host`) from any learning activity (document, extract, flashcard source, guided reading segment, Study Plan node, remediation task, exam review, or Unified Learning Session step) with exact return-to-origin state restoration and contextual Assistant integration.
- **Settings search & progressive disclosure:** Register any new navigation/workspace preference controls in `settingsSearchCatalog.ts` and `settingsSearchCoverage.ts`, and retire or quarantine dead duplicate routes (`src/routes/*`, unmounted legacy `OriginalSourcePane.tsx` / `ScreenshotTab.tsx`) once verified unused.

## Capabilities

### New Capabilities

- `consolidated-learning-workspaces`: 7-destination primary learning navigation (`Today`, `Library`, `Learn`, `Review`, `Discover`, `Knowledge`, `Insights`), 100% backward-compatible alias/shortcut/split-pane routing, and Universal Study Workspace launch from any learning activity into the single canonical reader host.

### Modified Capabilities

- None (consolidates existing shell navigation in `src/navigation/tabDestinations.ts`, `src/components/tabs/TabRegistry.tsx`, `src/components/Toolbar.tsx`, `src/components/mobile/MobileNavigation.tsx`, and `src/components/viewer/DocumentViewerWrapper.tsx` additively without breaking existing tab types).

## Dependencies

- `redesign-today-learning-dashboard` (Phase 2): Provides the `Today` workspace destination replacing the widget-only dashboard as the primary landing surface.
- `unify-learning-activity-runtime` (Phase 2): Provides the canonical `LearningActivity` and `LearningSession` context passed into `launchStudyWorkspace` for universal Study Workspace entry and return-to-origin restoration.

## Non-Goals

- Removing or breaking any existing `TabType`, `TAB_TYPE_ALIASES` route, keyboard shortcut, or command palette command.
- Mounting a second duplicate document reader instance outside `DocumentViewerWrapper.tsx` (`study-canonical-reader-host`).
- Forcing casual readers into Study Mode or AI Assistant panels when they open a document in plain Read Mode.
- Changing SQLite schema (this change requires no database migration; UI/navigation preferences persist in existing settings/layout stores).

## Privacy & Security

- When the Universal Study Workspace launches with the contextual Assistant (`AssistantPanel.tsx` / `with-assistant` layout), it MUST enforce `src/lib/ai/assistant/privacyGate.ts` and `document_privacy.rs` for the active source document (`is_local_only` / `is_ai_excluded`), blocking cloud AI context transmission and displaying local-only status clearly.
- The `Insights` destination MUST keep Health Vault (`health/health.db`) views strictly isolated from learning analytics sync payloads and AI Assistant context, preserving physical vault isolation.
- Exam isolation (`mock_exam`, `summative_exam`, `mastery`) MUST suppress contextual Assistant spoiler access when a workspace is launched during an active isolated exam.

## Migration & Backward Compatibility

- **Zero SQLite migration required.**
- Every existing `TabType` in `src/stores/tabsStore.ts` and `src/components/tabs/TabRegistry.tsx` continues to open and serialize/deserialize persisted user tab layouts cleanly.
- Every legacy route/alias in `src/navigation/tabDestinations.ts` (`resolveTabType`, `TAB_TYPE_ALIASES`) remains valid, plus new canonical aliases for `today`, `library`, `learn`, `review`, `discover`, `knowledge`, and `insights`.
- Existing `src/navigation/__tests__/tabDestinations.test.ts` drift invariants are extended (never weakened) to cover all 7 primary groups and every sub-destination.

## Performance

- Consolidating primary navigation reduces default toolbar DOM nodes and idle badge subscriptions while keeping lazy-loaded tab modules (`TabRegistry.tsx`) code-split.
- Launching the Universal Study Workspace reuses the single mounted `BaseDocumentViewer` instance inside `study-canonical-reader-host`, avoiding duplicate PDF/EPUB/media renderer allocations and preserving `< 100ms` mode transitions.
- Bundle size impact is verified via `npm run bench:check` (bundle budget check).

## Rollback / Recovery

- Because all underlying `TabType` implementations and aliases remain intact, reverting the primary navigation grouping or toggling a classic/compact toolbar mode restores direct flat access with zero impact on persisted tabs, queues, or documents.
- Dead file removals (`src/routes/*` and unmounted legacy components) are isolated in a dedicated cleanup task verified by `tsc --noEmit` and Vitest before commit, making git rollback trivial if any external import were discovered.

## Impact

- **Navigation & Shell:** `src/navigation/tabDestinations.ts`, `src/components/tabs/TabRegistry.tsx`, `src/components/Toolbar.tsx`, `src/components/mobile/MobileNavigation.tsx`, `src/components/layout/MainLayout.tsx`, `src/commandPalette/registry.ts`.
- **Workspace & Reader:** `src/components/viewer/DocumentViewerWrapper.tsx`, `src/components/viewer/StudyModeWorkspace.tsx`, `src/lib/study-plans/openStudySource.ts`, `src/lib/study-plans/studyMode/*`.
- **Settings Search:** `src/components/settings/search/settingsSearchCatalog.ts`, `src/components/settings/search/settingsSearchCoverage.ts`.
- **Cleanup:** Quarantine/remove verified dead files in `src/routes/*` and unmounted legacy components (`OriginalSourcePane.tsx`, `ScreenshotTab.tsx`).
