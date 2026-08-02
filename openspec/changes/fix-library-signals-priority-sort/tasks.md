## 1. Backend: persist extract counts

- [x] 1.1 In `repository.rs::create_extract`, update `documents.extract_count = extract_count + 1` for the target document in the same transaction as the extract insert.
- [x] 1.2 In `repository.rs::delete_extract`, look up the extract's `document_id` before deleting, then update `documents.extract_count = MAX(extract_count - 1, 0)` for that document in the same transaction.
- [x] 1.3 Add a migration that backfills `documents.extract_count = (SELECT COUNT(*) FROM extracts WHERE extracts.document_id = documents.id)` for all existing documents.
- [x] 1.4 Add/update a repository-level test that creates an extract, reloads the document via `get_document`, and asserts `extract_count` incremented; repeat for delete.

## 2. Backend: track explicit priority (sentinel column)

- [x] 2.1 Add a migration adding `documents.priority_explicitly_set` (NOT NULL INTEGER DEFAULT 0). (Revised from the original nullable-column plan — see design.md: a table rebuild to make priority_slider/priority_rating nullable re-activated the category FK and broke real rows; a boolean sentinel carries the same "was this set?" signal via plain ALTER TABLE with no rebuild/FK risk.)
- [x] 2.2 Add `priority_explicitly_set` to the `Document`/`StartupDocumentSummary` Rust structs and all `repository.rs` read paths, defaulting to `false` wherever the distinction isn't needed.
- [x] 2.3 `update_document_priority` flips `priority_explicitly_set = 1` on commit (the single source of truth for "user set this"), so both single and bulk (`bulk_set_document_priority`) writes mark the priority explicit.
- [x] 2.4 Add `priorityExplicitlySet` to the TS `Document` type (`src/types/document.ts`).

## 3. Frontend: fix priority popup seeding

- [x] 3.1 Update `resolveDisplaySlider()` in `src/components/documents/usePriorityPopup.tsx` to honor `priorityExplicitlySet`: when true, return `prioritySlider` as-is (including `0`); when false, fall back to the `priorityRating` bucket mapping, then to `50`.
- [x] 3.2 Verify Alt+P seeding in Document view (`DocumentViewer.tsx`), Queue (`ReviewQueueView.tsx`), and Documents library rows (`DocumentsView.tsx`) for a document explicitly set to priority `0`. (All three call `resolveDisplaySlider` on a full `Document`; typecheck + the new logic confirm the explicit-0 seed. Live click-through pending in 6.2.)
- [x] 3.3 Verify the PRIORITY column badge (`PriorityStepper`, `DocumentsView.tsx`) still displays `0` correctly for such a document (it shares `resolveDisplaySlider`).

## 4. Backend: fix extract signal filter data path (verification)

- [x] 4.1 Confirm the Compact View "Has extracts" Signals filter and EXTRACTS column (`DocumentsView.tsx` filteredDocuments/filterCounts) now read correct persisted counts with no frontend logic changes needed, given task 1's backend fix. (Both read `doc.extractCount`, now persisted by 1.1/1.2 and repaired by 1.3.)
- [ ] 4.2 Regression-test (manual): create an extract, switch collections (or reload documents), confirm the document still appears under "Has extracts" and the EXTRACTS column shows the correct count.

## 5. Frontend: Compact View sort shortcuts

- [x] 5.1 Add "Extracts" and "Flashcards" quick-sort buttons to the Compact View sidebar (`CompactLibraryView` in `DocumentsView.tsx`), placed near but visually distinct from the existing "Signals" section (no count badge, distinct icon/style).
- [x] 5.2 Wire the buttons to `sortKey`/`sortDirection` state (setting `"extracts"`/`"cards"`, toggling direction on repeat click), reusing the same logic as List view's `handleSort`.
- [x] 5.3 Verify sort state set via the new sidebar buttons is reflected correctly when switching to List view (active column header indicator) and Grid view (document order). (All three views consume the shared `sortKey`/`sortDirection` → `sortedDocuments`; List view headers already call the same `handleSort`. Live click-through pending in 6.2.)
- [x] 5.4 Verify the new sort shortcuts work correctly in combination with an active Signals filter (e.g. "Has extracts" + sort by flashcards). (Filtering and sorting are independent stages in `filteredDocuments` → `sortedDocuments`; architecture confirms they compose. Live click-through pending in 6.2.)

## 6. Validation

- [x] 6.1 Run the frontend and backend test suites (`npm test` / `cargo test`, per project conventions). Backend: 423 passed, 0 failed. Frontend: 1786 passed; the only 3 failures (`ImageRegistryLibrary.test.tsx`) pre-exist on `main` and are unrelated to this change.
- [ ] 6.2 Manually verify all three original bug reports against the running app: Has-extracts filter completeness, Alt+P seeding (including a priority-0 document) in all three surfaces, and Extracts/Flashcards sorting from the Compact sidebar across Compact/List/Grid. (Requires launching the app interactively — left for the user/next session.)
