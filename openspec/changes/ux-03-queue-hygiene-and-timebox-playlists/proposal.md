# Proposal: Time-Boxed Playlists, Queue Compost Sweep & Leech Refactoring

## Why

Unbounded due counters (`482 due`) provoke queue paralysis, while postponed extracts accumulate indefinitely without a low-friction "compost or commit" sweep workflow. Additionally, when a flashcard crosses the leech lapse threshold during review, the learner simply gets marked `Again` repeatedly instead of seeing the offending card alongside its parent extract with guided decomposition actions.

## What Changes

### ADDED
- **Time-Budgeted Playlist Sessions**: `TimeboxSessionLauncher.tsx` and pure budget builder `timeboxPlaylistBuilder.ts` offering finite playlists (`15m Quick Sprint`, `45m Deep Block`, `10m Audio Commute`) assembled from a target mix (60% FSRS reviews, 25% high-priority extracts, 15% discovery) plus a 0–100% completion ring in the session header.
- **"Triage & Compost" Queue Sweep Mode**: `TriageCompostSweepModal.tsx` targeting stale/repeatedly postponed extracts (`postpone_count >= 3`) with rapid keyboard sweep actions: `[J]` Keep & Boost, `[K]` Demote to Vault/Someday, `[L]` AI Summarize & Drop Source, `[Backspace]` Delete/Archive.
- **Inline Leech Card Refactor Wizard**: `LeechRefactorWizard.tsx` embedded inside `FlashcardScrollItem.tsx` when `lapses >= leechThreshold` (default `4`), showing the struggling card side-by-side with its source extract and 1-click **Split into Simpler Clozes**, **Rewrite via Local AI**, or **Demote to Reading Extract** actions.

### MODIFIED
- **`QueueScrollPage.tsx`, `queueScrollBudget.ts`, `ScrollOverlayControls.tsx`**: Support starting a bounded timebox playlist, tracking item completion percentage via a SVG completion ring, and launching the Triage & Compost sweep from the queue banner.
- **`FlashcardScrollItem.tsx`**: Render `LeechRefactorWizard` banner/panel on leech detection without blocking normal rating flow if dismissed.

### REMOVED
- None. Existing unbounded queue mode and `composeSession` behavior remain available when no timebox preset is active.

## Capabilities

### New Capabilities
- `queue-hygiene-playlists`: Time-budgeted session playlist assembly and completion tracking, rapid keyboard Triage & Compost queue sweep for stale postponed items, and inline Leech Card Refactor Wizard paired with parent extract context.

### Modified Capabilities
- None.

## Impact

- **Frontend Modules**: `src/utils/timeboxPlaylistBuilder.ts` (new), `src/components/queue/TimeboxSessionLauncher.tsx` (new), `src/components/queue/TriageCompostSweepModal.tsx` (new), `src/components/review/LeechRefactorWizard.tsx` (new), `src/pages/QueueScrollPage.tsx`, `src/pages/queueScrollBudget.ts`, `src/components/queue/ScrollOverlayControls.tsx`, `src/components/review/FlashcardScrollItem.tsx`.
- **Backend / IPC Reuse**: Reuses existing `postpone_item`, `set_extract_priority`, `delete_extract`, `create_learning_item`, and local AI summarization/rewrite helpers (or fallback gracefully when offline, coordinating with `ux-05`).
- **Risks**: AI rewrite/summarization may be unavailable offline; mitigated by graceful manual fallback / local template split (`Split into Simpler Clozes` works deterministically offline on sentences/clauses).
