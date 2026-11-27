## Context

`StudyModeWorkspace.tsx` (947 lines) was originally built as a single-column side panel with 6 flat tabs (`learn`, `source`, `practice`, `mind_map`, `audio`, `slides`). Its session lifecycle resets `activeView` to `"learn"` on every mount, computes coarse `doc:<id>` scope keys, passes `anchors: []` to `saveStudyModeArtifact`, shares one `loadingTask` state without `AbortController`, swallows initialization failures silently, and deletes all scope artifacts without confirmation.

Plethora already has:
- Universal source locators (`ExactSearchHitLocation` in `src/types/searchHit.ts`) used by Reading Trails.
- `runTask` (`src/lib/ai/tasks/runTask.ts`) with built-in `AbortSignal` cancellation and `onChunk` streaming callbacks.
- SQLite persistence in `src-tauri/src/database/study_mode_repository.rs` (`study_mode_sessions`, `study_mode_artifacts`, `study_learner_preferences`, `study_formative_questions`, `study_formative_submissions`).
- Semantic CSS theme variables (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `bg-muted`, `text-destructive`) driven by `.impeccable/design.json` and Plethora's theme engine.

## Goals / Non-Goals

**Goals:**
- Fix all 6 P0 reliability and grounding defects end-to-end (frontend + Rust/SQLite + non-Tauri local fallback).
- Ship the unified 4-tab (`Learn`, `Practice`, `Explore`, `Progress`), 3-pane desktop / bottom-sheet mobile workspace.
- Keep ordinary Read Mode 100% untouched (Study Mode remains lazy-loaded and inactive until explicitly toggled).
- Decompose `StudyModeWorkspace.tsx` into cohesive, testable modules under `src/lib/study-plans/studyMode/` and `src/components/viewer/study-mode/`.

**Non-Goals:**
- Full Guided Adaptive Loop & multi-type Practice Question Engine (Wave 2).
- Contextual Tutor integration & interactive SVG/Canvas Concept Map graph (Wave 3).
- Playable TTS Audio Lessons & Narrated Slides with offline audio caching (Wave 4).
- Adding new npm or Cargo dependencies.

## Decisions

### 1. Precision Scope Key (`src/lib/study-plans/studyMode/scopeKey.ts`)
- Format: `<kind>:<baseId>[:seg:<segmentId>][:loc:<locatorSig>][:sel:<selectionHash>][:rev:<revHash>]`
- Uses deterministic FNV-1a 32-bit hashing for selection text and long revision strings so keys are compact, collision-resistant, and safe for SQLite indexing and `localStorage` keys.
- Locator signatures normalize `ExactSearchHitLocation` (`pdf:p12`, `epub:<cfiHash>`, `youtube:t45`, `audio:t120`, `html:s35`, etc.).

### 2. Resumable Session Snapshot (`src/lib/study-plans/studyMode/sessionPersistence.ts`)
- Stores a typed `StudyModeSessionSnapshot` (`activeTab`, `exploreSubView`, `activeObjectiveId`, `activeQuestionId`, `sessionDurationMin`, `focusMode`, `lastLocator`, `paneWidths`, `leftPaneCollapsed`, `rightPaneCollapsed`, `updatedAt`).
- Persists to SQLite via `upsert_study_mode_session` (embedding snapshot metadata in `last_locator_json` alongside `locator` so no destructive DB migration is required) AND mirrors to `localStorage` keyed by `plethora.studyMode.session.<scopeKey>` for instant synchronous hydration and web/PWA support.
- Adds `find_study_mode_session_by_scope` in Rust so desktop sessions resume the exact prior `StudyModeSession` row rather than creating a new UUID on every mount.

### 3. Real Source Grounding (`src/lib/study-plans/studyMode/anchoring.ts`)
- Defines `StudySourceAnchor`:
  ```ts
  export interface StudySourceAnchor {
    sourceId: string;
    sourceRevision: string;
    quote?: string;
    charStart?: number;
    charEnd?: number;
    locator: ExactSearchHitLocation;
    label?: string;
  }
  ```
- Extracts citations from any generated artifact payload (`citations`, `nodes[].citations`, `events[].citations`, `slides[].citations`), locates exact character offsets in `passageText` (case/whitespace-tolerant fallback), and attaches the active `ExactSearchHitLocation` with `textQuote` populated.
- If a payload has no textual citations (e.g., audio transcript or summary), falls back to the active scope's `ExactSearchHitLocation` so `anchors` is never saved empty.

### 4. Independent, Cancellable Per-Task Controller (`src/lib/study-plans/studyMode/taskController.ts`)
- Hook `useStudyTaskController()` manages a map of `Record<string, StudyTaskState>` (`status`, `streamPreview`, `error`, `startedAt`) and a `Map<string, AbortController>`.
- `startTask(taskKey, executor)` aborts any prior in-flight run for the *same* `taskKey` only, creates a fresh `AbortController`, passes `{ signal, onChunk }`, and catches `Cancelled` errors cleanly without setting an error state.
- `cancelTask(taskKey)` aborts only that task; unmount aborts all active tasks.

### 5. Offline vs. Persistence Error Classification
- Initialization returns explicit `{ sessionStatus: 'ready' | 'offline' | 'persistence_error', persistenceError?: string }`.
- Network / AI provider errors stay scoped to the triggering panel (`panelErrors: Record<StudyModePanelId, StudyPanelError | null>`) with Retry, Cancel, and Inspect Source buttons.

### 6. Safe Artifact Management
- Adds `restore_study_mode_artifact` and `delete_study_mode_artifact` commands in `src-tauri/src/commands/study_mode.rs` + `StudyModeRepository`.
- Lists both active and dismissed artifacts (`listStudyModeArtifacts(scopeKey, true)`), partitioning into active artifacts and recoverable Artifact History.
- "Clear Scope" toggles an inline confirmation bar (`Confirm Clear` / `Cancel`) instead of immediately wiping data.

### 7. 3-Pane / 4-Tab Workspace & Theme Fidelity
- `StudyModeViewTab` is upgraded to `"learn" | "practice" | "explore" | "progress"` (with `normalizeStudyModeTab()` mapping legacy values).
- Desktop layout: CSS flex 3-pane shell (`LearningPathPane` | drag handle | `OriginalSourcePane` | drag handle | `StudyToolsPane`).
- Mobile layout (`< 768px` or `isMobile` prop): Full-screen primary view with a bottom-sheet drawer (`StudyToolsBottomSheet`) toggled from a persistent bottom bar.
- Uses strictly semantic Plethora Tailwind/CSS tokens (`bg-background`, `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-destructive`) so every built-in and imported theme renders coherently.

## Risks / Trade-offs

- **Existing tests referencing old tab labels or `"Clear Generated"`**: `studyModeE2E.test.tsx` will be updated/expanded to verify both the existing Scenario B/F/H invariants and all new Wave 1 capabilities.
- **Rust command additions**: Adding `find_study_mode_session_by_scope`, `restore_study_mode_artifact`, and `delete_study_mode_artifact` requires registering them in `src-tauri/src/lib.rs` and compiling cleanly with `cargo check` / `cargo test`.
- **No DB schema migration risk**: Storing extended session UI state inside the existing `last_locator_json` JSON envelope keeps SQLite 100% backward-compatible with existing databases.
