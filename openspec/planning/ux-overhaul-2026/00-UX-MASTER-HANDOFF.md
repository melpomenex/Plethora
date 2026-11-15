# Plethora UX Overhaul 2026 — Master Continuity Handoff Ledger

> **Continuity Protocol for Lead / Secondary Models (Codex / GPT / Claude):**
> Read this ledger FIRST upon handoff. Stage 1 has locked all 6 OpenSpec packages (`ux-01` through `ux-06`) on disk under `openspec/changes/`. Do **NOT** invent new architectures without updating the corresponding OpenSpec file. Execute **Stage 2** strictly one atomic task at a time in the priority order below, running the task's verification command, marking `[x]` in BOTH this file and the change's `tasks.md`, and appending to the **Live Checkpoint Log** at the bottom before moving to the next task.

---

## 1. Architecture & State Map

### Core Codebase Anchors

| Domain | Verified Source Files | Role / Key Symbols |
|---|---|---|
| **Interleaved Queue & Chrome** | `src/pages/QueueScrollPage.tsx`<br>`src/pages/queueScrollBudget.ts`<br>`src/components/queue/ScrollOverlayControls.tsx`<br>`src/components/queue/useRatingDockBounds.ts`<br>`src/components/queue/DaqeScoreBreakdown.tsx` | Orchestrates `ScrollItem` union (`document \| rss \| flashcard \| extract \| podcast \| video-extract`), `[data-queue-header]`, `[data-rating-dock]`, DAQE `TermBreakdown` |
| **Ordering & Priority Math** | `src/stores/queueOrderingSettings.ts`<br>`src/utils/queueManualOrder.ts`<br>`src/services/priority/priorityCommit.ts`<br>`src-tauri/src/commands/queue.rs`<br>`src-tauri/src/commands/extract.rs` | `getQueueOrderingMode` / `setQueueOrderingMode` (`"adaptive" \| "strict_manual"`), `resolveQueueItemDisplaySlider`, `usePriorityCommitState`, `dispatchPriorityCommit`, `create_extract_inner` (priority inheritance) |
| **Review & Extraction** | `src/components/review/FlashcardScrollItem.tsx`<br>`src/components/review/ExtractScrollItem.tsx`<br>`src/components/review/FSRSInspector.tsx`<br>`src/components/extracts/QACreatorPopup.tsx`<br>`src/components/extracts/ClozeCreatorPopup.tsx`<br>`src/components/viewer/selectionInteraction/SelectionActionBar.tsx`<br>`src/hooks/useToastExtract.ts`<br>`src/hooks/useInlineExtraction.ts` | Card & extract cards, FSRS telemetry, modal creators -> docked split-sheet refactor, selection toolbar, `.animate-flash-extract-green` pulse |
| **Progressive Disclosure & Nav** | `src/stores/uiStore.ts`<br>`src/commandPalette/registry.tsx`<br>`src/components/common/CommandPalette.tsx`<br>`src/components/extracts/ExtractsList.tsx`<br>`src/components/viewer/DocumentViewer.tsx` | `useUIStore`, `densityMode` (`"zen" \| "architect"`), `Cmd+K` palette (`CommandMatchTier`), `GhostContextPeek`, `SubwayMinimap` |
| **Multimodal & Audio** | `src/components/media/TranscriptSync.tsx`<br>`src/components/media/TranscriptPanel.tsx`<br>`src/components/viewer/YouTubeViewer.tsx`<br>`src/api/video-extracts.ts`<br>`src/components/audio/MiniAudioPlayer.tsx`<br>`src/stores/audioPlaybackStore.ts`<br>`src/components/common/ReaderTTSControls.tsx`<br>`src/components/viewer/EPUBViewer.tsx`<br>`src/components/viewer/MarkdownViewer.tsx` | Transcript segment slice capture (`createVideoExtract`), persistent bottom-right TTS PiP, Role Voices A/B + chime, `[B]` 30s capture, Table/Math/Code Breakout modal, `Cmd+J` Socratic margin thread |
| **Dashboard, Study Plans & Graph** | `src/components/tabs/DashboardTab.tsx`<br>`src/components/study-plans/evidence/KnowledgeGapCard.tsx`<br>`src/pages/KnowledgeGraphPage.tsx`<br>`src/components/graph/ObsidianGraph.tsx` | `TodaysHorizonBanner`, 1-click urgent queue injection (`slider = 8`), `GracefulAiFallbackCard`, Canvas 2D heatmaps & `Shift+Drag` lasso selection |
| **Ingestion & Mobile** | `src/components/tabs/TabRegistry.tsx`<br>`src/components/viewer/SplitDocumentDialog.tsx`<br>`src/components/mobile/MobileQueueView.tsx` | `IngestionAirlockModal` (`[1]`/`[2]`/`[3]` + H2 splitter), mobile Commute Audio Queue, Bottom Thumb-Arc, double-tap paragraph capture |

### Strict Coding Invariants (MUST NOT VIOLATE)
1. **Scheduler Math Untouchable**: Never break or modify existing FSRS-7, SM-20, SM-18, or SM-2 calculation kernels in `src-tauri/src/algorithms/` or frontend priority commit contracts.
2. **Keyboard Focus Guards**: All single-key or spacebar shortcuts (`Space`, `E`, `Q`, `D`, `P`, `J`, `K`, `L`, `Backspace`, `B`, `C`) MUST suppress when focus is inside `<input>`, `<textarea>`, `<select>`, `[contenteditable="true"]`, `.ProseMirror`, or `[data-split-sheet="true"]`.
3. **Strict TypeScript & Targeted Tests**: `npx tsc --noEmit` MUST exit `0` after every atomic task, alongside the task's targeted `npm run test:run -- <test_path>` suite.
4. **Git & Workspace Rules (`AGENTS.md`)**: Never create feature branches; stay on `main`. Do not commit or push unless explicitly instructed. Avoid adding unnecessary controls to Settings (`src/components/settings/`) without updating `settingsSearchCatalog.ts` and `settingsSearchCoverage.ts`.
5. **Study Plans Data Boundaries**: Graph lasso launches and assessment gap queue injections must NOT mutate Study Plan DAG topology or silently write global `concept_links` rows.

---

## 2. Ordered Execution Queue (Stage 2 Priority Checklist)

### Priority 1: `ux-01-unified-session-and-split-extraction` (`openspec/changes/ux-01-unified-session-and-split-extraction/tasks.md`)
- [x] `UX01-T01` — Standardize interleaved session chrome coordinates (`SessionChromeHeader.tsx`, `ScrollOverlayControls.tsx`, `FlashcardScrollItem.tsx`, `ExtractScrollItem.tsx`, `QueueScrollPage.tsx`)
- [x] `UX01-T02` — Build `QueueProvenancePill.tsx` & 1-click scheduling override popover (`ScrollOverlayControls.tsx`)
- [x] `UX01-T03` — Implement `EndOfItemTriageBar.tsx` with `[Space]`, `[E]`, `[Q]`, `[D]`, `[P]` focus-guarded hotkeys (`ExtractScrollItem.tsx`, `QueueScrollPage.tsx`)
- [x] `UX01-T04` — Refactor `QACreatorPopup.tsx` & `ClozeCreatorPopup.tsx` to non-blocking `"docked"` split-sheets (`Cmd/Ctrl+Shift+Q`, live selection insertion)
- [x] `UX01-T05` — Add inline priority inheritance chip, $\pm 5\%$ nudge HUD (`Shift+Wheel` / post-extract `Up/Down`), and 1-keystroke Chained Cloze (`[C]` / `Alt+Z`) in `SelectionActionBar.tsx`, `useToastExtract.ts`, `useInlineExtraction.ts`

### Priority 2: `ux-02-progressive-disclosure-and-context-peek` (`openspec/changes/ux-02-progressive-disclosure-and-context-peek/tasks.md`)
- [x] `UX02-T01` — Add `densityMode` (`"zen" | "architect"`, `Cmd/Ctrl + \`) in `uiStore.ts` and hide raw telemetry in Zen Mode
- [x] `UX02-T02` — Expand `CommandPalette` (`src/commandPalette/registry.tsx` & `CommandPalette.tsx`) with queue ordering, density, extract toggles & right-aligned `<kbd>` hotkey badges
- [x] `UX02-T03` — Build `GhostContextPeek.tsx` (`Hold Alt` / upward overscroll +/- 2 paragraphs & breadcrumb path) in `ExtractScrollItem.tsx`
- [x] `UX02-T04` — Build `SubwayMinimap.tsx` (`Document -> Child Extracts -> Grandchild Cards` mastery tree) in `ExtractsList.tsx` / `DocumentViewer.tsx`

### Priority 3: `ux-03-queue-hygiene-and-timebox-playlists` (`openspec/changes/ux-03-queue-hygiene-and-timebox-playlists/tasks.md`)
- [x] `UX03-T01` — Implement `timeboxPlaylistBuilder.ts`, `TimeboxSessionLauncher.tsx`, and 0–100% completion ring (`15m`, `45m`, `10m Commute`)
- [x] `UX03-T02` — Build `TriageCompostSweepModal.tsx` (`[J]`, `[K]`, `[L]`, `[Backspace]`) for stale postponed extracts
- [x] `UX03-T03` — Build inline `LeechRefactorWizard.tsx` in `FlashcardScrollItem.tsx` (`lapses >= 4`, Split Clozes / AI Rewrite / Demote to Extract)

### Priority 4: `ux-04-multimodal-media-and-socratic-margin` (`openspec/changes/ux-04-multimodal-media-and-socratic-margin/tasks.md`)
- [x] `UX04-T01` — Transcript-First Video Extraction (`Capture Video Slice [mm:ss - mm:ss]` in `TranscriptSync.tsx` / `YouTubeViewer.tsx`)
- [x] `UX04-T02` — Persistent TTS PiP (`MiniAudioPlayer.tsx`, `audioPlaybackStore.ts`: `1.0x–2.5x`, `[B]` 30s Bookmark Extract, Role Voices A/B + chime)
- [x] `UX04-T03` — Table, Math & Code `BreakoutOverlayModal.tsx` (`0.5x–3.0x` pan/zoom) in `EPUBViewer.tsx`, `MarkdownViewer.tsx`, `ExtractScrollItem.tsx`
- [x] `UX04-T04` — Selection-Anchored `SocraticMarginThread.tsx` (`Cmd/Ctrl + J`) with 1-click Extract / Flashcard conversion

### Priority 5: `ux-05-study-plans-bridge-and-actionable-graph` (`openspec/changes/ux-05-study-plans-bridge-and-actionable-graph/tasks.md`)
- [x] `UX05-T01` — Build `TodaysHorizonBanner.tsx` in `DashboardTab.tsx` (Top-Down Milestones + Bottom-Up Discovery)
- [x] `UX05-T02` — Add `Inject Weak Concepts into Queue` (`Priority < 10`, slider `8`) on `KnowledgeGapCard.tsx`
- [x] `UX05-T03` — Build `GracefulAiFallbackCard.tsx` (`Local LLM Offline` / `Timeout`, manual extract fallback, 50% smaller-context retry)
- [x] `UX05-T04` — Knowledge Network Heatmaps (`Retrievability / Leech`, `Extract Density`) & `Shift+Drag` Lasso-to-Queue in `ObsidianGraph.tsx` & `KnowledgeGraphPage.tsx`

### Priority 6: `ux-06-ingestion-airlock-and-mobile-ergonomics` (`openspec/changes/ux-06-ingestion-airlock-and-mobile-ergonomics/tasks.md`)
- [x] `UX06-T01` — Build `documentHeadingSplitter.ts` & `IngestionAirlockModal.tsx` (`[1]`/`[2]`/`[3]` + Chapter/H2 pre-chunker)
- [x] `UX06-T02` — Upgrade `MobileQueueView.tsx` (Commute Audio Queue, Bottom Thumb-Arc, Double-Tap Paragraph Instant Extraction)

---

## 3. Live Checkpoint Log

| Timestamp (UTC) | Last Completed Task ID | Files Created / Modified | Verification Status | Next Task ID |
|---|---|---|---|---|
| 2026-11-15T18:45Z | `STAGE-1-SPECS` | `openspec/changes/ux-01`..`ux-06` (`.openspec.yaml`, `proposal.md`, `specs/*/spec.md`, `design.md`, `tasks.md`) + `00-UX-MASTER-HANDOFF.md` | `openspec validate --strict` PASSED (6/6 valid) | `UX01-T01` |
| 2026-11-15T18:50Z | `UX01-T01` | `SessionChromeHeader.tsx`, `ScrollOverlayControls.tsx`, `useRatingDockBounds.ts`, `FlashcardScrollItem.tsx`, `ExtractScrollItem.tsx`, `QueueScrollPage.tsx`, `SessionChrome.test.tsx` | `npx tsc --noEmit` PASS; 4 test suites (58 tests) PASS | `UX01-T02` |
| 2026-11-15T18:55Z | `UX01-T02` | `queueOrderingSettings.ts`, `QueueProvenancePill.tsx`, `ScrollOverlayControls.tsx`, `QueueScrollPage.tsx`, `QueueProvenancePill.test.tsx` | `npx tsc --noEmit` PASS; 3 test suites (39 tests) PASS | `UX01-T03` |
| 2026-11-15T19:00Z | `UX01-T03` | `EndOfItemTriageBar.tsx`, `EndOfItemTriageBar.test.tsx`, `ExtractScrollItem.tsx`, `QueueScrollPage.tsx` | `npx tsc --noEmit` PASS; 3 test suites (9 tests) PASS | `UX01-T04` |
| 2026-11-15T19:02Z | `UX01-T04` | `QACreatorPopup.tsx`, `ClozeCreatorPopup.tsx`, `QueueScrollPage.tsx`, `DocumentViewer.tsx`, `QACreatorPopup.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (4 tests) PASS | `UX01-T05` |
| 2026-11-15T19:05Z | `UX01-T05` | `SelectionActionBar.tsx`, `useToastExtract.ts`, `useInlineExtraction.ts`, `DocumentViewer.tsx`, `SelectionActionBar.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (3 tests) PASS (`ux-01` 100% complete) | `UX02-T01` |
| 2026-11-15T19:09Z | `UX02-T01` | `uiStore.ts`, `MainLayout.tsx`, `FlashcardScrollItem.tsx`, `ExtractScrollItem.tsx`, `ScrollOverlayControls.tsx`, `uiDensityMode.test.ts` | `npx tsc --noEmit` PASS; 1 test suite (2 tests) PASS | `UX02-T02` |
| 2026-11-15T19:12Z | `UX02-T02` | `registry.tsx`, `CommandPalette.tsx`, `registryAcceptance.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (39 tests) PASS | `UX02-T03` |
| 2026-11-15T19:13Z | `UX02-T03` | `GhostContextPeek.tsx`, `ExtractScrollItem.tsx`, `GhostContextPeek.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (3 tests) PASS | `UX02-T04` |
| 2026-11-15T19:15Z | `UX02-T04` | `SubwayMinimap.tsx`, `ExtractsList.tsx`, `DocumentViewer.tsx`, `SubwayMinimap.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (2 tests) PASS (`ux-02` 100% complete) | `UX03-T01` |
| 2026-11-15T19:18Z | `UX03-T01` | `timeboxPlaylistBuilder.ts`, `TimeboxSessionLauncher.tsx`, `QueueScrollPage.tsx`, `timeboxPlaylistBuilder.test.ts` | `npx tsc --noEmit` PASS; 1 test suite (4 tests) PASS | `UX03-T02` |
| 2026-11-15T19:20Z | `UX03-T02` | `TriageCompostSweepModal.tsx`, `QueueScrollPage.tsx`, `TriageCompostSweepModal.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (2 tests) PASS | `UX03-T03` |
| 2026-11-15T19:22Z | `UX03-T03` | `LeechRefactorWizard.tsx`, `FlashcardScrollItem.tsx`, `LeechRefactorWizard.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (3 tests) PASS (`ux-03` 100% complete) | `UX04-T01` |
| 2026-11-15T19:26Z | `UX04-T01` | `TranscriptSync.tsx`, `YouTubeViewer.tsx`, `TranscriptSliceExtraction.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (4 tests) PASS | `UX04-T02` |
| 2026-11-15T19:28Z | `UX04-T02` | `audioPlaybackStore.ts`, `MiniAudioPlayer.tsx`, `ReaderTTSControls.tsx`, `MiniAudioPlayer.roleVoice.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (4 tests) PASS | `UX04-T03` |
| 2026-11-15T19:31Z | `UX04-T03` | `BreakoutOverlayModal.tsx`, `EPUBViewer.tsx`, `MarkdownViewer.tsx`, `ExtractScrollItem.tsx`, `BreakoutOverlayModal.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (3 tests) PASS | `UX04-T04` |
| 2026-11-15T19:34Z | `UX04-T04` | `SocraticMarginThread.tsx`, `DocumentViewer.tsx`, `SelectionActionBar.tsx`, `SocraticMarginThread.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (2 tests) PASS (`ux-04` 100% complete) | `UX05-T01` |
| 2026-11-15T19:36Z | `UX05-T01` | `TodaysHorizonBanner.tsx`, `DashboardTab.tsx`, `TodaysHorizonBanner.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (2 tests) PASS | `UX05-T02` |
| 2026-11-15T19:42Z | `UX05-T02` | `KnowledgeGapCard.tsx`, `KnowledgeGapCard.queueInject.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (1 test) PASS | `UX05-T03` |
| 2026-11-15T19:44Z | `UX05-T03` | `GracefulAiFallbackCard.tsx`, `SocraticMarginThread.tsx`, `LeechRefactorWizard.tsx`, `QACreatorPopup.tsx`, `GracefulAiFallbackCard.test.tsx` | `npx tsc --noEmit` PASS; 2 test suites (5 tests) PASS | `UX05-T04` |
| 2026-11-15T19:46Z | `UX05-T04` | `ObsidianGraph.tsx`, `KnowledgeGraphPage.tsx`, `ObsidianGraph.heatmapLasso.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (3 tests) PASS (`ux-05` 100% complete) | `UX06-T01` |
| 2026-11-15T19:48Z | `UX06-T01` | `documentHeadingSplitter.ts`, `IngestionAirlockModal.tsx`, `TabRegistry.tsx`, `IngestionAirlockModal.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (3 tests) PASS | `UX06-T02` |
| 2026-11-15T19:51Z | `UX06-T02` | `MobileQueueView.tsx`, `MobileQueueView.ergonomics.test.tsx` | `npx tsc --noEmit` PASS; 1 test suite (2 tests) PASS (`ux-06` 100% complete — ALL PACKAGES COMPLETE) | `NONE` |
