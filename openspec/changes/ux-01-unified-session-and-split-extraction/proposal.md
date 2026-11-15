# Proposal: Unified Session Chrome, Provenance & Split-Sheet Extraction

## Why

Interleaved incremental reading and spaced repetition sessions in `QueueScrollPage.tsx` currently render distinct, uncoordinated header chrome and bottom action bars across item types (`FlashcardScrollItem`, `ExtractScrollItem`, `DocumentViewer`, `YouTubeViewer`). Stepping between item types causes vertical layout shift, hides why a particular item was scheduled (`FSRS-7`, `SM-20`, Adaptive DAQE, or `Strict Manual`), and forces learners through mouse-heavy context menus to postpone, reprioritize, or inspect scheduling provenance. Meanwhile, `QACreatorPopup.tsx` and `ClozeCreatorPopup.tsx` open as `fixed inset-0` blocking modal overlays with `bg-black/60 backdrop-blur-sm`, preventing simultaneous scrolling or secondary text selection in the parent document, while extract creation lacks visible inline priority inheritance nudging and 1-keystroke background cloze chaining.

## What Changes

### ADDED
- **Interleaved Session Chrome Coordinates**: Standardize top `[data-queue-header]` (`48px` fixed telemetry header) and bottom `[data-rating-dock]` (`min-h-[56px]` anchored dock) geometry across flashcard, extract, PDF/EPUB/HTML document, and YouTube views via `SessionChromeHeader.tsx` and `ScrollOverlayControls.tsx` / `useRatingDockBounds.ts`.
- **Queue Provenance Pill & Popover**: Interactive `QueueProvenancePill.tsx` header badge explaining *why* the active queue item was scheduled (algorithm/profile badge, explicit vs. inherited priority score, and parent document title) with a 1-click popover to snooze (`1d`/`3d`/`7d`), reprioritize via `usePriorityCommitState`, or switch between `Adaptive` and `Strict Manual` queue ordering.
- **End-of-Item Micro-Triage Bar**: Floating keyboard-driven `EndOfItemTriageBar.tsx` anchored at the bottom of extracts and media items (`[Space]` Next, `[E]` Extract, `[Q]` Create Q&A, `[D]` Archive/Done, `[P]` Priority) with input-focus guards.
- **Inline Priority Inheritance HUD & Chained Cloze**: Display inherited priority score and parent node badge on `SelectionActionBar.tsx`, support `Shift+Wheel` / post-extraction `ArrowUp`/`ArrowDown` ($\pm 5\%$ priority nudge toast via `dispatchPriorityCommit`), and add 1-keystroke Chained Cloze (`[C]` / `Alt+Z`) that spawns a child extract + cloze flashcard in the background with a green highlight pulse (`.animate-flash-extract-green`) without moving scroll or cursor focus.

### MODIFIED
- **`QACreatorPopup.tsx` & `ClozeCreatorPopup.tsx`**: Refactor from blocking full-screen modals into dual-mode components (`mode?: "docked" | "modal"`, defaulting to `"docked"` in `QueueScrollPage.tsx` and `DocumentViewer.tsx`, toggled via `Cmd/Ctrl+Shift+Q`) rendered as non-blocking slide-over/bottom split-sheets with isolated keyboard event propagation and live "Insert Current Selection" support so learners can keep scrolling and highlighting the source viewer simultaneously.
- **`QueueScrollPage.tsx`, `ScrollOverlayControls.tsx`, `ExtractScrollItem.tsx`, `FlashcardScrollItem.tsx`**: Adopt shared header/dock safe-area CSS/bounds, wire provenance pill, micro-triage bar, and docked Q&A/Cloze split-sheets.

### REMOVED
- Mandatory full-screen backdrop blocking (`fixed inset-0 bg-black/60`) when invoking `QACreatorPopup` / `ClozeCreatorPopup` during active reading or queue review (`mode === "docked"`).

## Capabilities

### New Capabilities
- `unified-session-extraction`: Unified interleaved session chrome coordinates, queue scheduling provenance disclosure and 1-click overrides, keyboard-first extract triage, non-blocking split-sheet Q&A/Cloze authoring, inline priority inheritance nudging, and 1-keystroke chained cloze extraction.

### Modified Capabilities
- None (UI chrome, selection ergonomics, and docked authoring refactor over existing verified `queue.rs`, `extract.rs`, `priorityCommit.ts`, and `queueOrderingSettings.ts` contracts).

## Impact

- **Frontend Components**: `src/components/queue/ScrollOverlayControls.tsx`, `src/components/queue/SessionChromeHeader.tsx` (new), `src/components/queue/QueueProvenancePill.tsx` (new), `src/components/queue/EndOfItemTriageBar.tsx` (new), `src/components/queue/useRatingDockBounds.ts`, `src/components/review/FlashcardScrollItem.tsx`, `src/components/review/ExtractScrollItem.tsx`, `src/components/extracts/QACreatorPopup.tsx`, `src/components/extracts/ClozeCreatorPopup.tsx`, `src/components/viewer/DocumentViewer.tsx`, `src/components/viewer/selectionInteraction/SelectionActionBar.tsx`, `src/pages/QueueScrollPage.tsx`.
- **Frontend Hooks & Services**: `src/hooks/useToastExtract.ts`, `src/hooks/useInlineExtraction.ts`, `src/services/priority/priorityCommit.ts`, `src/stores/queueOrderingSettings.ts`.
- **Rust / Scheduler Boundary**: Zero changes to FSRS-7, SM-20, SM-18, or SM-2 mathematical kernels (`src-tauri/src/algorithms/`) and zero changes to `priority_rank` invariants. Existing `postpone_item`, `set_extract_priority`, `set_document_priority`, `create_extract`, and `create_learning_item` commands are reused directly.
- **Risks**: Keybinding collisions between `EndOfItemTriageBar` (`Space`, `E`, `Q`, `D`, `P`), `ScrollOverlayControls`, and rich-text inputs (`QACreatorPopup` / `.ProseMirror`); mitigated via strict `isEditableTarget` checks and keydown propagation isolation inside docked sheets.
