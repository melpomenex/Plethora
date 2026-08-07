## 1. Stop the extract reader flicker

- [x] 1.1 In `src/lib/i18n/index.ts`, wrap `useI18n`'s `translate` in `useCallback` keyed on `locale` so `t` is referentially stable per locale
- [x] 1.2 Add a test asserting `t` keeps its identity across re-renders with the locale unchanged, and gets a new identity when the language setting changes
- [x] 1.3 Verify `src/components/tabs/ExtractReader.tsx` no longer loops: the load effect at `[extractId, t]` must fire once per extract id
- [x] 1.4 Verify `src/components/review/ExtractScrollItem.tsx` requests `generateProgressiveSummaries` once per extract instead of once per render

## 2. Plumb item types into the Scroll Mode tab

- [x] 2.1 Widen the `onOpenScrollMode` options type with `itemTypes?: { documents: boolean; extracts: boolean; learningItems: boolean }` in `src/components/review/ReviewQueueView.tsx`, `src/components/mobile/MobileQueueView.tsx`, and `src/components/tabs/QueueTab.tsx`
- [x] 2.2 In `ReviewQueueView`, pass `effectiveItemTypes` from the Scroll Mode button (`mode: "queue-list"`) and from `handleStartOptimalSession` (`mode: "optimal"`)
- [x] 2.3 In `QueueTab.handleOpenScrollMode`, write `itemTypes` into the new tab's `data` alongside `customQueueItems` and `queueScrollMode`
- [x] 2.4 In `QueueScrollPage`, read `itemTypes` from `activeTab.data` into the `activeTabQueueData` memo (add the field to its dependency list) and default it to all-true when absent

## 3. Honour item types in the optimal build path

- [x] 3.1 In `QueueScrollPage`'s scroll-item builder, gate `docItems` on `itemTypes.documents`, `flashcardItems` on `itemTypes.learningItems`, and `extractItems` on `itemTypes.extracts` — before `splitReviewBudget` runs
- [x] 3.2 Leave RSS and podcast composition untouched so feed items stay settings-driven
- [x] 3.3 Confirm the empty state renders when all three types are unchecked, rather than falling back to an unfiltered mix
- [x] 3.4 Add tests covering the combinations: extracts only, extracts + documents, flashcards only, all three, none

## 4. Render real extract content in the sequential path

- [x] 4.1 In the `queue-list` branch of the builder, collect extract queue items whose `extractId` is missing from the `dueExtracts` map
- [x] 4.2 Fetch those extracts with `getExtract` in a single `Promise.all` before mapping, and drop items that resolve to `null`
- [x] 4.3 Remove the synthetic `clozeText ?? learningHint ?? ""` fallback extract now that content is resolved
- [x] 4.4 Add a test that a non-due extract in the queue renders its full content in sequential Scroll Mode, and that a deleted extract is omitted

## 5. Verify end to end

- [x] 5.1 Run `npm run lint` and the vitest suite
- [x] 5.2 In the running app: filter the Queue to Extracts, click an extract row, confirm the reader opens once with no flicker
  - (automated: `src/components/tabs/__tests__/ExtractReader.test.tsx` asserts the reader fetches once, holds content across unrelated re-renders, refetches on extract switch, and shows not-found for a missing extract — this test fails 3/3 against the pre-fix i18n. The Queue→reader routing in `QueueTab.handleOpenDocument` is unchanged. In-app click-through still worth eyeballing.)
- [ ] 5.3 With Extracts only, click "Start Optimal Session" and confirm the session is extracts only — no source documents
- [ ] 5.4 With Extracts + Documents, and again with Flashcards + Documents, confirm both Scroll Mode entry points produce exactly those types
