## 1. Align the defaults

- [x] 1.1 Flip `defaultSettings.smartQueue.sessionItemTypes` in `src/stores/settingsStore.ts:826` to `{ documents: true, extracts: true, learningItems: true }`
- [x] 1.2 Drop the `due-all`-only all-true special case in `effectiveItemTypes` (`src/components/review/ReviewQueueView.tsx:434`) now that the stored default is honest; keep reading `sessionItemTypesCustomized` so a saved selection still wins
- [x] 1.3 Add a settings-store test asserting a persisted `sessionItemTypes` with `extracts: false` survives the default change

## 2. Composition governs Optimal Session membership

- [x] 2.1 Delete `zeroUncheckedTargets` (`src/pages/QueueScrollPage.tsx:321`) and its call in the optimal branch (`:1485`)
- [x] 2.2 In the optimal branch, gate `docItems` / `extractItems` / `flashcardItems` on `composition[type] > 0` instead of `gateScrollItemsByType(…, itemTypes)`; leave RSS and podcast items on the Documents share as today
- [x] 2.3 Leave the sequential branch (`:1176`–`:1200`) untouched — it keeps `gateScrollItemsByType(…, activeTabQueueData.itemTypes)` and the composition thinning it already applies
- [x] 2.4 Verify the all-zero-shares case returns an empty session rather than an unfiltered mix

## 3. Ordering tracks the configured mix

- [x] 3.1 Add `targetTopicShare` (0–1, default 0.5) to `CombinedSortConfig` in `src/utils/queueScrollOrder.ts:189`
- [x] 3.2 Change the imbalance terms in `orderScrollItemsByCombinedCriterion` (`:261`) to compare placed counts against `targetTopicShare × placed`; confirm 0.5 reproduces today's arithmetic exactly
- [x] 3.3 Short-circuit the proportion bias when `targetTopicShare` is 0 or 1 so a single-type session orders by priority alone
- [x] 3.4 In the optimal branch, derive the share from the composed counts — `(documents + extracts) / total` — and pass it into the sort
- [x] 3.5 Leave `QUEUE_LIST_SORT_CONFIG` and its call site on the 0.5 default

## 4. Report unfillable shares

- [x] 4.1 Return `shortfall: { documents, extracts, flashcards }` from `composeSession` (`src/pages/queueScrollBudget.ts:45`), matching `selectByQuotaInOrder`'s existing shape
- [x] 4.2 Update the three `composeSession` call sites in `QueueScrollPage` and check `queueScrollBudget.bench.ts` still destructures cleanly
- [x] 4.3 Surface the shortfall in `src/components/queue/ScrollQueueSettings.tsx` as a one-line note naming the short type and the count it supplied
- [x] 4.4 Add a "0% excludes this type" hint to the composition help text and translate `queue.compositionHelp` across `en/de/fr/es/ja/zh`

## 5. Tests

- [x] 5.1 `queueScrollBudget.test.ts`: 60/0/40 against a plentiful pool holds the 60:40 ratio; against 12 available flashcards yields all 12 with the remainder to documents; shortfall is reported in both
- [x] 5.2 `queueScrollItemTypes.test.ts`: a 0 share excludes a type whose toggle is checked, and a >0 share includes a type whose toggle is unchecked
- [x] 5.3 New `queueScrollOrder` test: a 60/40 target puts ~12 documents and ~8 flashcards in the first 20 items and caps same-type runs at 3; a 1.0 target applies no bias
- [x] 5.4 `ReviewQueueView.test.tsx`: "Start Optimal Session" no longer forwards item-type gating for the optimal path, while "Scroll Mode" still does
- [x] 5.5 Run `npx vitest run src/pages src/utils src/stores src/components/review` and confirm the previously-passing composition suites still pass
- [x] 5.6 Prevent the queue-build effect from recomposing on the rating/removal unlock transition; add a lifecycle regression test for the flashcard-then-document race

## 6. Manual verification

- [ ] 6.1 Set Documents 60 / Extracts 0 / Flashcards 40, start an Optimal Session, and confirm the first 20 items are a ~60:40 document/flashcard mix with no extracts
- [ ] 6.2 Uncheck Flashcards in Customize Queue and confirm the Queue list hides flashcards while the Optimal Session still contains them at 40%
- [ ] 6.3 Set Flashcards to 40% with few cards due and confirm the shortfall note names flashcards and its count
