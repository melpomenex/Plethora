## 1. Pure re-anchor helper + pinning tests

- [x] 1.1 Add `reanchorSessionPosition(currentItems, currentId, nextItems)` to `src/pages/queueScrollSessionLifecycle.ts` returning `{ items, currentIndex }` per design D1/D2 (survivor → new position; dropped → re-insert old object at `min(oldIndex, nextItems.length)`; `currentId` null → passthrough)
- [x] 1.2 Create `src/pages/__tests__/queueScrollReanchor.test.ts` with unit tests for the helper: survivor moves, dropped re-inserts, null passthrough, boundary indices (index 0, last item, empty next list)
- [x] 1.3 Add pinning tests to the same file documenting the hazard the helper exists for: `composeSession` shrinks N when one document leaves availability, and `orderScrollItemsByCombinedCriterion` displaces the index-addressed item after removing one topic item (deterministic inputs, 12 docs / 30 cards 50/50 → 11/11 displacement)

## 2. Wire the re-anchor into the build effect

- [x] 2.1 Add local `applySessionItems(nextItems)` in `QueueScrollPage.tsx` that runs `reanchorSessionPosition` against `scrollItems[currentIndex]?.id` and sets `scrollItems` + `currentIndex` + `renderedIndex` together (no transition, no scroll reset)
- [x] 2.2 Route both build-effect write sites through it: optimal branch `setScrollItems(mixedItems)` (~line 1554) and queue-list branch `setScrollItems([...selected, ...extras])` (~line 1282); leave `advanceAfterRemoval`, `goToNext`/`goToPrevious`, and neural-mode writes untouched (they own intentional advances)
- [x] 2.3 Guard the neural branch: the normal build effect must not re-anchor against a neural session (it already returns early on `isNeuralMode`; add a test-visible assertion or comment pinning this)

## 3. Composition snapshot for the session lifetime

- [x] 3.1 Hold the optimal branch's composed counts in a `useRef` keyed by `${queueScrollMode}:${activeTabId}`; compute on first build and when the user changes composition settings; clamp to current availability on every rebuild (design D3, Open Question resolved as re-snapshot on explicit settings change)
- [x] 3.2 Keep `compositionReport` reporting the snapshot counts with shortfall clamped to availability so the settings panel stays truthful
- [x] 3.3 Unit-test the snapshot/clamp logic as a pure function (extract `clampCompositionToAvailability(snapshot, available)` into `queueScrollBudget.ts` and test it)

## 4. Reveal-state hygiene

- [x] 4.1 Reset the reveal flag from the page when `currentItem?.id` changes to a different flashcard (in addition to `FlashcardScrollItem`'s own mount report), closing the stale-`flashcardRevealedRef` window for rating shortcuts (design D4)
- [x] 4.2 Add a unit test for the reset logic (pure helper or extracted hook behavior) covering card→card and card→document→card transitions

## 5. Sequence-level regression net

- [x] 5.1 Extend `src/pages/__tests__/queueScrollSessionLifecycle.test.ts`: build → lock → in-place advance → unlock-skip → later dep-flip rebuild → assert the current item is unchanged (id) after reconciliation; assert the unlock-skip run itself still never rebuilds
- [x] 5.2 Cover the dropped-current-item path in the same simulation: rebuild that excludes the current id → re-inserted at the current index, unrated

## 6. Component-level regression net

- [x] 6.1 Create `src/pages/__tests__/QueueScrollPage.rebuild.test.tsx` mocking queueStore, documentStore, settingsStore, tabs store, and `src/api/*` calls (pattern from `src/components/review/__tests__/ReviewQueueView.test.tsx`); mock at boundaries only, never page internals
- [x] 6.2 Optimal scenario: session [epub, flashcard, epub] → rate the epub (orbs handler) → advance fake timers past the 300/500ms lock releases → fire a documents store reload (new `documents` array identity) → assert the flashcard is still rendered/current and unrated
- [x] 6.3 Continue the scenario: rate the flashcard (reveal → rate) → assert the next epub becomes current (the rebuild did not double-advance or resurrect the rated epub)
- [x] 6.4 Queue-list variant: open with `customQueueItems` [epub, flashcard, epub] → rate epub → reload → same assertions as 6.2
- [x] 6.5 Delete/suspend escape hatch: current item deleted externally → rebuild advances off it exactly once (matches spec "Externally deleted items still leave the view")

## 7. Verification

- [x] 7.1 Run `npm run test:run` (or the repo's vitest equivalent) — all new tests green, no regressions in existing scroll/queue suites
- [x] 7.2 Run `npm run lint` and `npm run build:check` clean
- [x] 7.3 Run `npm run bench:check` — no regressions; update `scripts/perf-baselines.json` only if the O(n) re-anchor measurably shifts an existing baseline, with the reason recorded
- [ ] 7.4 Manual smoke on desktop and Android: optimal session with epubs + cards, rate an epub, wait 2s (past any sync reload), confirm the card stays; rate it; confirm the next epub appears
