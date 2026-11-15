# Design: Time-Boxed Playlists, Queue Compost Sweep & Leech Refactoring

## Context

- `src/pages/queueScrollBudget.ts` and `src/pages/QueueScrollPage.tsx` assemble the active queue slice, currently surfacing total open due counts.
- `src/components/review/FlashcardScrollItem.tsx` displays `item.lapses` telemetry but lacks an inline remediation path for leeches (`lapses >= 4`).
- Repeatedly postponed extracts (`postponeCount >= 3`) silently remain mixed into the queue without a cleanup ritual.

## Goals / Non-Goals

**Goals:**
- Provide deterministic pure-function playlist slicing (`buildTimeboxPlaylist`) with zero FSRS mutation.
- Keep "Triage & Compost" fast (<2 seconds per stale extract via single keys `J`, `K`, `L`, `Backspace`) with Undo support in the session summary.
- Keep `Split into Simpler Clozes` deterministic and offline-capable (regex clause/sentence segmentation), while treating `Rewrite via Local AI` cleanly with offline resilience.

**Non-Goals:**
- Replacing existing queue sorting algorithms (`FSRS-7`, `SM-20`, `Strict Manual`); timeboxing selects *a bounded subset* on top of existing priority/DAQE ordering.

## Decisions

### 1. Timebox Playlist Budget Engine (`src/utils/timeboxPlaylistBuilder.ts`)

```ts
export type TimeboxPresetId = "quick_sprint_15m" | "deep_block_45m" | "audio_commute_10m";

export interface TimeboxPlaylistResult {
  preset: TimeboxPresetId;
  targetMinutes: number;
  estimatedMinutes: number;
  items: ScrollItem[];
  breakdown: { reviews: number; extracts: number; discovery: number };
}
```
- Per-item duration heuristics (pure constants, deterministic):
  - `flashcard`: `0.5` min (30s)
  - `extract`: `2.0` min
  - `document` / `rss`: `4.0` min
  - `podcast` / `video-extract`: `Math.min(5.0, Math.max(1.5, durationMinutes ?? 3.0))`
- Allocation:
  1. Compute bucket capacities: `0.60 * budget` reviews (`itemType === "flashcard"`), `0.25 * budget` high-priority extracts/media (`extract`/`video-extract`/`podcast` with `reps > 0 || prioritySlider <= 50`), `0.15 * budget` discovery (`document`/`rss`/unprocessed).
  2. For `"audio_commute_10m"`, filter candidates to `podcast`, `document` (audio/EPUB/text with TTS capability), `extract`, and TTS-readable flashcards (`!hasComplexImageOnly`), preserving order.
  3. Fill buckets in round-robin/interleaved order (`review`, `review`, `extract`, `review`, `discovery`) so sessions feel naturally balanced, then backfill remaining budget from leftover items if any bucket under-fills.
- Completion Ring Component in `ScrollOverlayControls.tsx` / `SessionChromeHeader.tsx`: SVG circle `strokeDashoffset` bound to `Math.round((completedCount / totalPlaylistCount) * 100)`.

### 2. Triage & Compost Sweep Mode (`src/components/queue/TriageCompostSweepModal.tsx`)

- Filter predicate: `getStaleCompostCandidates(items, minPostpones = 3)` checking `item.postponeCount >= minPostpones` (or `item.lapses >= 5` / postponed status).
- Keyboard bindings (isolated from editable inputs):
  - `j` / `J`: `keepAndBoost` -> `dispatchPriorityCommit` reducing slider by `15` (clamped `>= 1`).
  - `k` / `K`: `demoteToVault` -> snooze `90` days + set priority slider `90`.
  - `l` / `L`: `aiSummarizeAndDrop` -> summarize extract content into archive note (or fallback sentence summary if AI offline) + dismiss extract.
  - `Backspace`: `archiveOrDelete` -> remove/dismiss item from active queue.

### 3. Leech Card Refactor Wizard (`src/components/review/LeechRefactorWizard.tsx`)

- Triggered when `(item.lapses ?? 0) >= (leechThreshold ?? 4)` and `!dismissedLeechIds.has(item.id)`.
- Fetches parent extract excerpt from `item.parentExtractText` or `extract` API by `item.extractId`.
- Pure deterministic helper `splitTextIntoClozeCandidates(text: string): string[]`: splits multi-clause / multi-sentence answers by `. `, `; `, or `, and ` into up to 3 atomic cloze drafts for 1-click "Split into Simpler Clozes".

## Risks / Trade-offs

- **`postponeCount` Availability on Old Items**: Older SQLite rows might have `postpone_count = 0` or `NULL`. **Mitigation**: Treat `postponeCount ?? 0` safely and also allow manually opening Triage & Compost over the bottom 10% oldest overdue extracts so the sweep is always useful.

## Migration Plan

1. Implement `timeboxPlaylistBuilder.ts`, `TimeboxSessionLauncher.tsx`, and SVG completion ring (`UX03-T01`).
2. Implement `TriageCompostSweepModal.tsx` and wire launcher button (`UX03-T02`).
3. Implement `LeechRefactorWizard.tsx` and embed in `FlashcardScrollItem.tsx` (`UX03-T03`).
