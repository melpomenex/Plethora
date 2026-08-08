## 1. Composition arithmetic

- [x] 1.1 In `src/pages/queueScrollBudget.ts`, add `composeSession({ targets, available })` returning `{ documents, extracts, flashcards }`: normalize targets, anchor `N = available.documents / w.documents`, clamp each type by availability, redistribute shortfall proportionally, and apportion with largest-remainder so the counts sum to `N`.
- [x] 1.2 Add the anchor fallbacks: when `w.documents` is 0 or `available.documents` is 0, anchor on the remaining active type with the largest target; when no type is active, return all zeros.
- [x] 1.3 Delete `splitReviewBudget`, `ReviewBudgetInput`, and the `extractsCountAsFlashcards` / `maxExtractsPerSession` parameters.
- [x] 1.4 Rewrite `src/pages/__tests__/queueScrollBudget.test.ts` against `composeSession`: the 45/0/55 case with `{371, 6, 1037}` yields exactly 55% flashcards; the 40/20/40 case yields all 6 extracts with the session size unchanged at 928; a zeroed type contributes nothing; all-zero targets return zeros; only-one-type-available yields a single-type session; no count ever exceeds availability.
- [x] 1.5 Update `src/pages/queueScrollBudget.bench.ts` to the new signature and confirm the benchmark gate still passes.

## 2. Settings model

- [x] 2.1 In `src/stores/settingsStore.ts`, replace `flashcardPercentage` and `extractsCountAsFlashcards` on `ScrollQueueSettings` with `composition: { documents: number; extracts: number; flashcards: number }`.
- [x] 2.2 Set the default to `{ documents: 60, extracts: 15, flashcards: 25 }`.
- [x] 2.3 Migrate persisted settings in the existing merge at `settingsStore.ts:1007`: when `composition` is absent and `flashcardPercentage` is present, map `flashcards = flashcardPercentage` and split the remainder across documents and extracts using `extractsCountAsFlashcards` as the hint.
- [x] 2.4 Add a unit test for the migration, including `flashcardPercentage: 0`, which must not produce an all-zero composition.

## 3. Optimal-path composition

- [x] 3.1 In `QueueScrollPage.tsx`, delete the `targetFlashcardCount` percentage math and the `splitReviewBudget` call (around lines 1288–1312) and call `composeSession` instead.
- [x] 3.2 Build `available.documents` from documents + RSS items + podcast episodes combined, and slice the document share from that combined pool in its existing priority order.
- [x] 3.3 Remove the hardcoded `maxExtractsPerSession: 20`.
- [x] 3.4 Zero out a type's target before composing when its Queue item-type toggle is unchecked, so the share is redistributed rather than reserved.

## 4. Sequential-path composition

- [x] 4.1 Remove the early `return` at `QueueScrollPage.tsx:1055`; instead partition the mapped `sequentialItems` into document / extract / flashcard pools.
- [x] 4.2 Top up each under-supplied pool from `dueFlashcards`, `dueExtracts`, and `documentQueueItems`, deduplicated by item id, with the source rows taking priority within their own type.
- [x] 4.3 Exempt the semantic-cluster path (`customSubset`) from top-up — compose within the cluster only.
- [x] 4.4 Run the composed pools through the existing interleave loop and `applyVarietyMixing`, preserving the relative order of the source rows.
- [x] 4.5 Verify the effect's dependency array still covers everything the new code reads (`settings.scrollQueue.composition` in place of the removed fields).

## 5. Settings UI

- [x] 5.1 In `src/components/queue/ScrollQueueSettings.tsx`, replace the single percentage slider and the "Extracts count as flashcards" toggle with three sliders — Documents, Extracts, Flashcards — each 0–100 step 5, showing its own value.
- [x] 5.2 Change the props from `flashcardPercentage` / `extractsCountAsFlashcards` to the composition object plus an `onUpdateComposition` handler, and update the call site at `QueueScrollPage.tsx:3918`.
- [x] 5.3 Replace the old helper text with one line explaining that the sliders are relative shares and need not sum to 100.
- [x] 5.4 Keep each slider labelled and associated with its input for keyboard and screen-reader use, matching the existing `htmlFor` pattern.

## 6. i18n

- [x] 6.1 Add the three slider labels and the new helper string to `src/lib/i18n/locales/en.ts`.
- [x] 6.2 Mirror them into `es`, `zh`, `de`, `ja`, and `fr`.
- [x] 6.3 Remove the now-unused `flashcardPercentage` and `extractsCountAsFlashcards` strings from all six locales.

## 7. Verification

- [x] 7.1 Run the unit test suite and the typecheck; both clean.
- [ ] 7.2 Run the app, open the Queue in reading mode, click "Scroll Mode", set Flashcards to 55%, and confirm flashcards appear at roughly that share — the reported bug.
       > **Superseded** by `supermemo-faithful-queue` Phase 1 task 1.3: the
       > "Scroll Mode button honours the flashcard slider" scenario was broken
       > on flashcard-leaning filters because the queue-list branch's document
       > pool could be empty. Phase 1 backfills the document pool from the
       > wider store and orders by priority, so this scenario now works on all
       > filters. This manual step remains as a cross-check of that fix.
- [ ] 7.3 Repeat via "Start Optimal Session" and confirm the two entry points agree.
- [ ] 7.4 Set Extracts to 20% with only 6 due extracts and confirm all 6 appear and the session does not shrink.
- [ ] 7.5 Set a type to 0% and confirm it is absent; uncheck a Queue item-type toggle with its slider non-zero and confirm it is still absent.
- [ ] 7.6 Restart the app and confirm the sliders come back at their set values.
