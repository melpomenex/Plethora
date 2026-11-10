# Tasks: Clarify Document Rotation & New Item Scheduling

## 1. Calendar-Day Due Date Normalization

- [ ] 1.1 Refactor `src/utils/reviewUx.ts` `getFsrsSchedulingInfo` to use calendar-day boundary comparisons (`startOfDueDay < startOfToday`) instead of millisecond `due < now`.
- [ ] 1.2 Update `src/lib/scheduleItemPresentation.ts` `dueState` to guarantee that same-day items return `key: "today"` and `label: "Today"` regardless of creation time.
- [ ] 1.3 Update `src/components/review/DeckManagerCardRow.tsx` `relativeDueDate` to return `"Today"` instead of `"Overdue"` when `diffDays < 0` but on the same calendar day.
- [ ] 1.4 Update `src/components/review/CardPreviewPanel.tsx` to align same-day due calculations.
- [ ] 1.5 Add Vitest unit tests in `src/utils/__tests__/reviewUx.sameDayDue.test.ts` verifying that items created at 9:01 AM evaluated at 9:08 AM on the same day are labeled "Today", not "Overdue".

## 2. Document Rotation vs Flashcard Recall Separation

- [ ] 2.1 Decouple `ReviewQueueView.tsx:1767` document status rendering from FSRS memory stats; display reading interval status rather than recall memory status.
- [ ] 2.2 In `src-tauri/src/algorithms/daqe/terms.rs`, enforce pure rotational urgency for documents and extracts ($T = A$ when due, $T = 0.5$ when new) without querying FSRS retrievability.
- [ ] 2.3 Provide reading interval rescheduling actions ("In 3d", "In 7d", "In 14d", "Done") in document reader views, preventing 1-4 recall rating buttons on document review.
- [ ] 2.4 Add Rust unit tests in `src-tauri/src/algorithms/daqe/terms.rs` verifying document rotation calculations are unaffected by synthetic memory stability or retrievability.

## 3. Settings UI & Search Catalog Coverage

- [ ] 3.1 Add Document Rotation Interval control in `src/components/settings/sections/ReviewSettings.tsx`.
- [ ] 3.2 Add stable DOM `id="setting-document-rotation-interval"`.
- [ ] 3.3 Register `setting-document-rotation-interval` in `src/components/settings/search/settingsSearchCatalog.ts` under `SettingsTab.Review`.
- [ ] 3.4 Add search coverage test in `src/components/settings/search/__tests__/settingsSearchCatalog.test.ts`.
- [ ] 3.5 Run `npm run bench:check` to verify no performance regressions.
