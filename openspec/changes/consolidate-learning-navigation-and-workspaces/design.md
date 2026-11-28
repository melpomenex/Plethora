# Design: Consolidate Learning Navigation and Workspaces

## Context

Plethora's navigation architecture already has a strong single-source-of-truth foundation in `src/navigation/tabDestinations.ts` (shared by `CommandCenter.tsx`, `MainLayout.tsx`, Vimium, help search, and the guided tour, guarded by `tabDestinations.test.ts`) and a single canonical reader host in `src/components/viewer/DocumentViewerWrapper.tsx` (`study-canonical-reader-host`) with mutually exclusive `"read" | "study"` modes and `"focused" | "with-source" | "with-assistant"` layouts.

This design consolidates the top-level navigation surface around the 7-stage personal learning lifecycle while preserving 100% power-user compatibility and enabling Universal Study Workspace launch from any learning activity.

## Goals / Non-Goals

### Goals
- Group primary desktop (`Toolbar.tsx`) and mobile (`MobileNavigation.tsx`) navigation into 7 cohesive learning-lifecycle destinations: `Today`, `Library`, `Learn`, `Review`, `Discover`, `Knowledge`, `Insights`.
- Preserve every existing `TabType`, `TAB_TYPE_ALIASES` path, keyboard shortcut, command palette command, middle-click split-pane action, and `TOUR_ANCHORS` hook.
- Provide a universal `launchStudyWorkspace(request)` contract so any learning activity can enter the single canonical reader host (`DocumentViewerWrapper.tsx`) with contextual mode/layout and exact return-to-origin restoration.
- Enforce `privacyGate.ts`, `is_local_only`/`is_ai_excluded`, exam isolation, and Health Vault isolation across workspace and navigation surfaces.
- Cleanly remove verified dead duplicate route/component files (`src/routes/*`, unmounted `OriginalSourcePane.tsx`, unregistered `ScreenshotTab.tsx`).

### Non-Goals
- Deleting or renaming internal `TabType` identifiers persisted in user workspaces.
- Creating a second PDF/EPUB/document viewer component outside `DocumentViewerWrapper.tsx`.
- Adding mandatory onboarding steps or blocking casual direct reading.

## Architecture & Domain Model

### 1. Seven Primary Learning-Lifecycle Destinations

`src/navigation/tabDestinations.ts` gains a `primaryGroup: PrimaryNavGroup` field (`"today" | "library" | "learn" | "review" | "discover" | "knowledge" | "insights" | "system"`), mapping all existing `TabType` destinations cleanly without removing any `TabType`:

| Primary Destination | Default `TabType` | Grouped Sub-Destinations (Accessible via Sub-Tabs / Switcher / Palette / Shortcuts) | Platform Capability Gate |
|---|---|---|---|
| **Today** | `dashboard` | Today workspace (`dashboard`), `continue-reading` | `tab_dashboard` |
| **Library** | `documents` | `documents`, `extracts`, `audiobook`, `image-registry`, `import-needs-review` | `tab_documents` |
| **Learn** | `study-plans` | `study-plans` (Learning Goals & Curricula), `language-learning`, Unified Learning Session launcher | ungated (sub-items retain individual gates) |
| **Review** | `review` | `review` (FSRS flashcards), `queue`, `queue-scroll` (Scroll Mode / Optimal Queue) | `tab_review` |
| **Discover** | `rss` | `rss` (Smart Feeds), `podcast`, `newsletter`, `web-browser` | `tab_rss` (sub-items retain individual gates) |
| **Knowledge** | `knowledge-sphere` | `knowledge-sphere` (Atlas / Directory / 2D / 3D Universe), `knowledge-network`, `doc-qa`, `notebooklm` | `tab_knowledge_sphere` |
| **Insights** | `analytics` | `analytics` (Learning & Competency Analytics), `learning-insights` (Privacy-isolated Health/Sleep Insights) | `tab_analytics` |

`settings` remains pinned in the utility footer of `Toolbar.tsx` and the mobile header/overflow sheet, preserving `TOUR_ANCHORS.navSettings` and `TOUR_ANCHORS.mobileNavSettings`.

**Desktop (`Toolbar.tsx`):**
- Displays the 7 primary destinations in the main rail/bar (plus utility actions: Quick Import, Command Palette, Settings, Workspace Switcher).
- Hovering, right-clicking, or clicking the sub-view switcher inside a primary destination reveals its grouped sub-destinations (e.g., `Review` → FSRS Review / Queue / Scroll Mode; `Discover` → Smart Feeds / Podcasts / Newsletters / Web Browser).
- Middle-click continues to open any destination in split-screen; right-click continues to expose `useSurfaceMenu` context actions (open in background, split, pin).
- Power users who want direct flat buttons for specific sub-destinations can pin any destination via Toolbar customization (registered in `settingsSearchCatalog.ts` and `settingsSearchCoverage.ts`).

**Mobile (`MobileNavigation.tsx`):**
- Bottom bar displays the 5 highest-frequency primary destinations (`Today`, `Library`, `Learn`, `Review`, plus `More` sheet containing `Discover`, `Knowledge`, `Insights`, `Settings`, and sub-destinations), respecting `getPlatformCapability` filtering so unavailable capabilities are never shown as broken bottom-bar tabs.

### 2. Full Alias, Shortcut, and Deep-Link Compatibility

- `TAB_TYPE_ALIASES` in `src/navigation/tabDestinations.ts` retains 100% of existing keys (`dash`, `dashboard`, `home`, `docs`, `queue`, `qs`, `scroll`, `rev`, `anal`, `stats`, `rss`, `feeds`, `ks`, `kn`, `qa`, `study-plans`, `curriculum`, `lang`, `learning-insights`, etc.) AND adds canonical primary aliases:
  - `today` → `dashboard`
  - `library` → `documents`
  - `learn` → `study-plans`
  - `discover` → `rss`
  - `knowledge` → `knowledge-sphere`
  - `insights` → `analytics`
- Every existing keyboard shortcut, Vimium jump, command palette destination command, and `TOUR_ANCHORS` attribute remains bound and verified by automated tests (`src/navigation/__tests__/tabDestinations.test.ts` and toolbar/mobile nav tests).

### 3. Universal Study Workspace Launch Contract

Define a single canonical launch coordinator (`src/lib/study-plans/studyMode/launchStudyWorkspace.ts`) used by all learning surfaces:

```ts
export interface StudyWorkspaceLaunchRequest {
  sourceOrigin:
    | { kind: "document"; documentId: string; locator?: string }
    | { kind: "extract"; extractId: string; documentId: string }
    | { kind: "flashcard"; cardId: string; documentId?: string; extractId?: string }
    | { kind: "study_plan_node"; planId: string; nodeId: string; documentId: string; locator?: string }
    | { kind: "guided_trail"; trailId: string; segmentId: string; documentId: string }
    | { kind: "remediation"; remediationId: string; conceptId: string; documentId?: string }
    | { kind: "learning_session"; sessionId: string; activityId: string; documentId?: string };
  preferredMode?: "read" | "study"; // Defaults to "read" for casual library opens, "study" for curriculum/remediation/session activities
  preferredLayout?: "focused" | "with-source" | "with-assistant";
  returnRoute?: { tabId: string; tabType: TabType; scrollState?: unknown };
  examIsolationActive?: boolean;
}
```

**Single Canonical Reader Host Invariant:**
- `launchStudyWorkspace` ALWAYS routes document-backed activities into `DocumentViewerWrapper.tsx` (`study-canonical-reader-host`) — never mounting a second parallel document reader.
- Mutually exclusive `"read" | "study"` mode and `"focused" | "with-source" | "with-assistant"` layouts are preserved verbatim.
- Closing or clicking **"Return to <Origin>"** restores the exact `returnRoute` (tab, scroll position, active `LearningSession` step, or Study Plan graph viewport).
- **Contextual Assistant & Privacy Guard:**
  - When `preferredLayout = "with-assistant"` or the learner opens the Assistant inside the Study Workspace, the Assistant receives only the active grounded passage/activity context AFTER passing `privacyGate.ts` (`is_local_only` / `is_ai_excluded` check).
  - If `examIsolationActive === true`, the contextual Assistant panel is locked/suppressed with an explicit exam-isolation notice.
  - Health Vault data (`health/health.db`) is never injected into workspace Assistant context.

### 4. Dead Duplicate Route & Component Cleanup

After confirming zero live references via TypeScript compilation (`npx tsc --noEmit`) and grep across `src/`:
- Remove the 8 unused legacy React Router files in `src/routes/` (`index.tsx`, `dashboard.tsx`, `documents.tsx`, `queue.tsx`, `review.tsx`, `settings.tsx`, `analytics.tsx`, `study-plans.tsx`).
- Remove unmounted `src/components/viewer/study-mode/OriginalSourcePane.tsx` and unregistered `src/components/tabs/ScreenshotTab.tsx` (retaining any shared types if referenced elsewhere).

## Risks & Trade-offs

- **Risk: Existing E2E or onboarding tour tests expect a flat toolbar button that moved into a primary group.**
  - *Mitigation:* Preserve all `TOUR_ANCHORS` mappings on the 7 primary destinations and utility controls, retain all `TAB_TYPE_ALIASES` and command palette entries, and update/verify toolbar & mobile navigation tests in the same change.
- **Risk: Accidental loss of Return-to-Reading state when launching from a nested Learning Session.**
  - *Mitigation:* `returnRoute` captures both `tabId` and `sessionId`/`activityId` so closing the Study Workspace resumes the exact session step without losing progress.
