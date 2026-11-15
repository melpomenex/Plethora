# Design: Unified Session Chrome, Provenance & Split-Sheet Extraction

## Context

In the current codebase:
- `src/pages/QueueScrollPage.tsx` (lines 1–5685) coordinates an interleaved scroll queue over `ScrollItem` variants (`document`, `rss`, `flashcard`, `extract`, `podcast`, `video-extract`).
- `src/components/queue/ScrollOverlayControls.tsx` and `src/components/queue/useRatingDockBounds.ts` render `[data-queue-header]` and `[data-rating-dock]`, yet `FlashcardScrollItem.tsx` and `ExtractScrollItem.tsx` render asymmetric internal margins and ad-hoc headers/action strips.
- `src/stores/queueOrderingSettings.ts` exports `getQueueOrderingMode` / `setQueueOrderingMode` (`"adaptive" | "strict_manual"`), and `src/utils/queueManualOrder.ts` exports `resolveQueueItemDisplaySlider`.
- `src/services/priority/priorityCommit.ts` exports `usePriorityCommitState`, `dispatchPriorityCommit`, and `commitPriorityChange`.
- `src/components/extracts/QACreatorPopup.tsx` (lines 1–138) and `src/components/extracts/ClozeCreatorPopup.tsx` (lines 1–226) hardcode `fixed inset-0 z-50 bg-black/60 backdrop-blur-sm` wrappers, blocking parent document scrolling and secondary text selection.
- `src/components/viewer/selectionInteraction/SelectionActionBar.tsx`, `src/hooks/useToastExtract.ts`, and `src/hooks/useInlineExtraction.ts` trigger highlight extraction and pulse feedback (`.animate-flash-extract-green`) without surfacing inherited priority or supporting immediate background cloze chaining.

## Goals / Non-Goals

**Goals:**
- Provide zero-layout-shift chrome across all `ScrollItem` types in `QueueScrollPage.tsx`.
- Make scheduling rationale (`FSRS-7`, `SM-20`, `SM-18`, `SM-2`, Adaptive DAQE, `Strict Manual`, priority inheritance) transparent and 1-click adjustable from `[data-queue-header]`.
- Provide instant keyboard-first triage (`Space`, `E`, `Q`, `D`, `P`) at the bottom of extracts and documents.
- Turn `QACreatorPopup` / `ClozeCreatorPopup` into non-blocking docked split-sheets so learners keep full access to parent viewer scrolling and text highlighting.
- Surface priority inheritance directly on text selections and support $\pm 5\%$ nudge plus 1-keystroke background Chained Cloze.

**Non-Goals:**
- Modifying Rust FSRS-7, SM-20, SM-18, or SM-2 calculations in `src-tauri/src/algorithms/`.
- Changing `settingsSearchCatalog.ts` (all controls live in session HUDs/toolbars, not the Settings page).
- Implementing Zen/Architect mode toggle (covered by `ux-02`).

## Decisions

### 1. Component Hierarchy & Shared Chrome Coordinates

```text
QueueScrollPage
├── [data-queue-header] SessionChromeHeader (h-12, fixed top-3, z-30)
│   ├── Progress & Counter Slot
│   ├── QueueProvenancePill (click -> [data-provenance-popover])
│   │   ├── Snooze Actions (1d / 3d / 7d)
│   │   ├── Priority Nudge / Slider (usePriorityCommitState)
│   │   └── Ordering Switch (setQueueOrderingMode: adaptive <-> strict_manual)
│   └── Priority / Menu Actions
├── Safe Content Area (pt-[68px] pb-[92px])
│   ├── FlashcardScrollItem / ExtractScrollItem / DocumentViewer / YouTubeViewer
│   │   └── SelectionActionBar (inherited priority badge + [C] Chained Cloze + Shift+Wheel nudge)
│   └── EndOfItemTriageBar (floating bar anchored above dock: [Space] [E] [Q] [D] [P])
├── [data-rating-dock] SessionActionDock / ScrollOverlayControls (min-h-[56px], fixed bottom-6, z-30)
└── Docked Split-Sheet Portal (pointer-events-none overlay -> pointer-events-auto right slide-over or bottom sheet)
    ├── QACreatorPopup (mode="docked")
    └── ClozeCreatorPopup (mode="docked")
```

**Interface Contracts (`src/components/queue/SessionChromeHeader.tsx` & `QueueProvenancePill.tsx`):**

```ts
export interface QueueProvenanceInfo {
  itemId: string;
  itemType: "flashcard" | "extract" | "document" | "rss" | "podcast" | "video-extract";
  orderingMode: "adaptive" | "strict_manual";
  algorithmType?: "fsrs" | "sm20" | "sm18" | "sm2" | string;
  prioritySlider: number; // 1..100
  priorityExplicitlySet: boolean;
  parentDocumentId?: string;
  parentDocumentTitle?: string;
  stability?: number;
  retrievability?: number;
}
```

Provenance label resolution rule:
1. If `orderingMode === "strict_manual"`: primary label = `"Pinned: Strict Manual"`.
2. Else if `algorithmType` is present: map `"fsrs"` -> `"Due via FSRS-7"`, `"sm20"` -> `"Due via SM-20"`, `"sm18"` -> `"Due via SM-18"`, `"sm2"` -> `"Due via SM-2"`, fallback `"Adaptive DAQE"`.
3. Priority segment: `` `Priority ${prioritySlider}` ``.
4. Lineage segment: `(!priorityExplicitlySet && parentDocumentTitle)` -> `` `Inherited from ${parentDocumentTitle}` ``; else `"Explicit Priority"`.

### 2. End-of-Item Micro-Triage Keybinding State Machine

`EndOfItemTriageBar.tsx` attaches a single `window` `keydown` listener (disabled when `disabled === true` or an input/editor element is active):
- Helper `isEditableEventTarget(target: EventTarget | null): boolean` checks `INPUT`, `TEXTAREA`, `SELECT`, `isContentEditable`, or `.closest("[contenteditable='true'], .ProseMirror, [data-split-sheet='true']")`.
- Key map (ignoring events with `ctrlKey || metaKey || altKey` or `event.defaultPrevented`):
  - `Space` (`" "`): `preventDefault()`, calls `onNext()`.
  - `e` / `E`: `preventDefault()`, calls `onExtract()`.
  - `q` / `Q`: `preventDefault()`, calls `onCreateQA()`.
  - `d` / `D`: `preventDefault()`, calls `onArchive()`.
  - `p` / `P`: `preventDefault()`, calls `onOpenPriority()`.

### 3. Docked Split-Sheet `QACreatorPopup` & `ClozeCreatorPopup`

Add optional props without breaking any existing callers:
```ts
export interface DockedCreatorExtensionProps {
  mode?: "docked" | "modal"; // QueueScrollPage & DocumentViewer pass "docked"
  dockPosition?: "right" | "bottom";
  onGrabSelection?: () => string | null;
}
```
- When `mode === "docked"`:
  - Outer wrapper uses `fixed inset-y-0 right-0 z-40 pointer-events-none flex justify-end p-4` (for `dockPosition === "right"`, width `w-[min(420px,92vw)]`) or bottom sheet equivalent (`w-full max-w-3xl h-[360px]`).
  - Inner panel uses `pointer-events-auto` and `data-split-sheet="true"`.
  - On panel container `onKeyDown`: call `e.stopPropagation()` (except `Escape` and `Cmd/Ctrl+Shift+Q` toggle) so typing inside Question/Answer fields never leaks single-key shortcuts to `QueueScrollPage` or `EndOfItemTriageBar`.
  - While open, a `selectionchange` listener (or explicit **Insert Selection into Question/Answer** buttons) lets the user highlight text in the still-scrollable parent `DocumentViewer` / `ExtractScrollItem` and drop it straight into the active field (`activeTargetField: "question" | "answer"`).

### 4. Priority Inheritance Nudging & Chained Cloze

- **Priority Step Constant**: `PRIORITY_NUDGE_STEP = 5` (5% on the 1–100 priority slider; note lower slider = higher priority in Plethora's 1–100 urgency scale, OR explicit helper `clampPrioritySlider(current + delta)` where `ArrowUp` increases urgency -> `delta = -5`, `ArrowDown` decreases urgency -> `delta = +5`). Both direction semantics and exact delta (`-5` more urgent, `+5` less urgent) are exposed cleanly on the toast HUD (`"Priority P20 -> P15 (+5% urgency) • ↑/↓ to adjust"`).
- **Nudge Window Hook (`useToastExtract.ts`)**: When `createExtract` succeeds, store `{ extractId, prioritySlider, expiresAt: Date.now() + 4000 }` in transient state; pressing `ArrowUp`/`ArrowDown` within 4s resets the 4s timer and dispatches `dispatchPriorityCommit({ kind: "extract", id: extractId, targetSlider })`.
- **Chained Cloze (`useInlineExtraction.ts`)**:
  - New `createChainedClozeFromSelection(params)`:
    1. Captures `scrollContainer.scrollTop` prior to IPC calls.
    2. Calls existing extract creation (`createExtract(...)`) inheriting `parentPriority`.
    3. Immediately calls `createClozeCard` / `createLearningItem` (`item_type: "Cloze"`, `cloze_ranges` wrapping the exact selected phrase as `c1`).
    4. Emits highlight pulse event (`.animate-flash-extract-green`) and restores `scrollContainer.scrollTop` via `requestAnimationFrame` if any DOM highlight insertion nudged scroll offset.

## Risks / Trade-offs

- **Priority Scale Direction Confusion**: Plethora stores priority ratings where `1` = highest priority and `100` = lowest priority (or priority slider `0–100` mapped via `resolveQueueItemDisplaySlider` in `queueManualOrder.ts`). **Mitigation**: Verify `priorityCommit.ts` and `priority_rank` semantics during `UX01-T02`/`UX01-T05` and label nudge badges explicitly (`Priority 15 • Higher` / `Lower`) so users never guess polarity.
- **Docked Split-Sheet Overlap on Narrow Viewports (<768px)**: Right-side `420px` sheet can cover content on narrow screens. **Mitigation**: Auto-switch docked sheet to bottom split-pane below `lg` (`<1024px`) or honor `dockPosition="bottom"`.

## Migration Plan

1. Introduce `SessionChromeHeader` and unify `[data-queue-header]` / `[data-rating-dock]` layout bounds (`UX01-T01`).
2. Add `QueueProvenancePill` inside `ScrollOverlayControls` (`UX01-T02`).
3. Add `EndOfItemTriageBar` with focus guards (`UX01-T03`).
4. Refactor `QACreatorPopup` & `ClozeCreatorPopup` with non-blocking `"docked"` mode (`UX01-T04`).
5. Add inherited priority chip, $\pm 5\%$ nudge handler, and background Chained Cloze (`UX01-T05`).
