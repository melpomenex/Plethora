## Why

Plethora's current Study Mode (`StudyModeWorkspace.tsx`) suffers from six reliability and grounding defects—resetting to the `learn` tab on every mount, colliding scope keys across selections/timestamps/revisions, persisting empty `anchors: []` arrays on generated artifacts, locking all tools behind a single non-cancellable `loadingTask`, swallowing initialization errors silently, and offering a destructive one-click "Clear Generated" action without recovery. Architecturally, its 6 disconnected generator tabs and narrow side-panel layout separate learners from the authoritative source text. Overhauling the foundation and workspace into a resumable, source-grounded, 3-pane, 4-tab workspace establishes the reliable core required for adaptive practice, contextual tutoring, and playable multimodal lessons while keeping ordinary Read Mode untouched.

## What Changes

- **Resumable Sessions & View Restoration**: Persist and restore `activeView` (normalized to the 4 primary tabs), active objective/step, active formative question state, session duration target (`5 | 15 | 30` min), and exact `ExactSearchHitLocation` reading/media position per scope across mounts and reloads.
- **Precision Scope Keys**: Upgrade scope keys from `doc:<id>` / `plan:<planId>:<topicId>` to deterministic keys incorporating scope kind, document/plan/topic/segment IDs, passage/selection/media-timestamp anchor signature, and `sourceRevision`.
- **Real Source Grounding**: Replace hardcoded `anchors: []` with typed `StudySourceAnchor` records built on Plethora's Reading Trails `ExactSearchHitLocation` model (`src/types/searchHit.ts`), linking every generated explanation, question, timeline, and concept card directly to its supporting passage or media timestamp.
- **Independent, Cancellable Per-Task Execution**: Replace the single shared `loadingTask` state with per-task execution states supporting concurrent tool use, `onChunk` streaming previews where supported, and `AbortController`-backed cancellation via `runTask`.
- **Resilient Error & Persistence Handling**: Replace silent initialization catches and the single global error banner with contextual per-panel error states (with Retry and Inspect Source actions) and explicit distinction between offline availability and persistence failures.
- **Safe Artifact Management**: Replace instant destructive "Clear Generated" with explicit confirmation, granular single-item deletion, and an Artifact History / Recovery view to restore dismissed or prior-revision artifacts.
- **Unified 4-Tab, 3-Pane Source-Centric Workspace**:
  - **BREAKING** (UI structure): Collapse 6 tabs (`learn`, `source`, `practice`, `mind_map`, `audio`, `slides`) into 4 primary tabs (`learn`, `practice`, `explore`, `progress`) while preserving backward-compatible deserialization of legacy persisted tab names.
  - Desktop 3-pane layout with collapsible, resizable **Learning Path** (left), always-accessible **Original Source** (center), and **Contextual Study Tools** (right).
  - Focus Mode toggle, selection-based "Study this" studying, keyboard shortcuts, session duration selector (`5 / 15 / 30 min`), full Plethora theme token integration, and responsive mobile bottom-sheet study tools.
- **Reconciliation**: Reconciles and extends the unarchived LearnLM Study Mode specs (`consolidate-study-mode-learning-foundation`, `add-optional-study-mode-and-learner-preferences`) without duplicating requirements or touching Read Mode.

## Capabilities

### New Capabilities
- `study-mode-session-grounding`: Precision scope keys, resumable session state restoration, Reading Trails `ExactSearchHitLocation`-based source anchoring on all artifacts, independent cancellable task execution, offline-vs-persistence error handling, and safe artifact lifecycle with history/recovery.
- `study-mode-workspace`: Unified 4-tab (`Learn`, `Practice`, `Explore`, `Progress`), 3-pane source-centric desktop workspace and responsive mobile bottom-sheet layout with Focus Mode, selection-based studying, keyboard shortcuts, session duration selector, and theme integration.

### Modified Capabilities
- (None in `openspec/specs/`; this change reconciles the unarchived `consolidate-study-mode-learning-foundation` and `add-optional-study-mode-and-learner-preferences` specs.)

## Impact

- **Frontend Types & Utilities**: `src/types/studyMode.ts`, new modules under `src/lib/study-plans/studyMode/` (`scopeKey.ts`, `anchoring.ts`, `sessionPersistence.ts`, `taskController.ts`).
- **Frontend API & Components**: `src/api/study-mode.ts`, `src/components/viewer/StudyModeWorkspace.tsx` (and modular child components under `src/components/viewer/study-mode/`), `src/components/viewer/DocumentViewer.tsx` (passing selection/locator props only when `studyModeOpen` is true; Read Mode behavior untouched).
- **Backend (Rust/SQLite)**: `src-tauri/src/database/study_mode_repository.rs`, `src-tauri/src/commands/study_mode.rs`, `src-tauri/src/lib.rs` (adding `find_study_mode_session_by_scope`, `restore_study_mode_artifact`, `delete_study_mode_artifact` commands while preserving existing commands).
- **Tests**: Unit and integration tests covering scope key precision, anchor extraction/navigation, session restoration, independent cancellation, offline vs. persistence errors, artifact recovery, 3-pane/4-tab UX, mobile bottom sheet, and Read Mode non-regression.
