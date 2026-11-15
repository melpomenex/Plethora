# Tasks: ux-03-queue-hygiene-and-timebox-playlists

**Dependencies:** Builds cleanly on `ux-01` session chrome (`SessionChromeHeader`). Keep FSRS/SM scheduling kernels untouched. Mark `[x]` and update `00-UX-MASTER-HANDOFF.md` + Lemmalog after every task.

## 1. Time-Budgeted Playlists

- [x] 1.1 **UX03-T01 — Implement TimeboxSessionLauncher and deterministic playlist slicer + completion ring.** Dependencies: UX01-T01. **Files:** create **NEW** `src/utils/timeboxPlaylistBuilder.ts`, **NEW** `src/components/queue/TimeboxSessionLauncher.tsx`, **NEW** `src/utils/__tests__/timeboxPlaylistBuilder.test.ts`; modify `src/pages/QueueScrollPage.tsx`, `src/components/queue/ScrollOverlayControls.tsx`. **Implement:** Build `15m Quick Sprint`, `45m Deep Block`, and `10m Audio Commute` playlist presets slicing queues along a 60% review / 25% extract / 15% discovery budget with backfill and render a 0–100% `[data-timebox-ring]` completion SVG in the session header. Verify: `npx tsc --noEmit && npm run test:run -- src/utils/__tests__/timeboxPlaylistBuilder.test.ts`.

## 2. Queue Hygiene & Leech Remediation

- [x] 2.1 **UX03-T02 — Build Triage & Compost Queue Sweep Mode.** Dependencies: none. **Files:** create **NEW** `src/components/queue/TriageCompostSweepModal.tsx`, **NEW** `src/components/queue/__tests__/TriageCompostSweepModal.test.tsx`; modify `src/pages/QueueScrollPage.tsx`. **Implement:** Filter stale postponed items (`postponeCount >= 3`) and support single-key sweep shortcuts `[J]` Keep & Boost (-15 priority slider), `[K]` Demote to Vault (+90d snooze, priority 90), `[L]` AI Summarize & Drop Source, and `[Backspace]` Delete/Archive, with session receipt. Verify: `npx tsc --noEmit && npm run test:run -- src/components/queue/__tests__/TriageCompostSweepModal.test.tsx`.

- [x] 2.2 **UX03-T03 — Build Inline Leech Card Refactor Wizard in FlashcardScrollItem.** Dependencies: none. **Files:** create **NEW** `src/components/review/LeechRefactorWizard.tsx`, **NEW** `src/components/review/__tests__/LeechRefactorWizard.test.tsx`; modify `src/components/review/FlashcardScrollItem.tsx`. **Implement:** Intercept flashcards with `lapses >= 4`, show the card beside its parent extract, and expose 1-click **Split into Simpler Clozes** (deterministic sentence/clause splitter), **Rewrite via Local AI**, and **Demote to Reading Extract**. Verify: `npx tsc --noEmit && npm run test:run -- src/components/review/__tests__/LeechRefactorWizard.test.tsx`.
