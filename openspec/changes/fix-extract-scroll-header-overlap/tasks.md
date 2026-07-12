## 1. Restructure the ExtractScrollItem header into normal flow

- [x] 1.1 In `src/components/review/ExtractScrollItem.tsx`, remove `absolute top-6 left-6` from the badges block (currently the `absolute top-6 left-6 flex items-center gap-2` div at line ~330) so it renders in normal document flow.
- [x] 1.2 Remove `absolute top-6 right-6` from the document-title block (currently the `absolute top-6 right-6 … max-w-md flex items-center gap-4` div at line ~351) so it renders in normal document flow.
- [x] 1.3 Merge the badges block and the document-title block into a single in-flow header row: a full-width flex container (`flex items-center justify-between gap-4 flex-wrap`) placed as the first child inside the centered `max-w-4xl` content column (the `w-full max-w-4xl flex flex-col gap-6` div at line ~360), with badges grouped left (`flex items-center gap-2`) and title/page/save-status grouped right (`flex items-center gap-4 max-w-md text-sm text-muted-foreground`).
- [x] 1.4 Keep the existing badge contents and order unchanged: extract-type badge (TextT + "Extract"), review-state label, review count (when `extract.review_count > 0`), and disclosure level (when `extract.max_disclosure_level > 0`).
- [x] 1.5 Keep the title group contents unchanged: `t("extractScrollItem.from")` + document title span + optional page span, followed by `renderSaveStatus()`.

## 2. Bound the document title within the header

- [x] 2.1 Keep the `truncate` class on the title span and ensure its parent group has a bounded max width (e.g., `max-w-md`) so a very long title cannot push badges off-row.
- [x] 2.2 Add/keep a `title` attribute on the title span exposing the full `documentTitle` so the truncated text remains accessible on hover.

## 3. Verify layout and behavior

- [x] 3.1 Run the TypeScript/build check (`npm run build` or the project's typecheck) to confirm no type errors were introduced.
- [ ] 3.2 Launch the app and open an extract in scroll mode with short content — confirm the header renders above the "Create Flashcard / Create Cloze / Create Q&A" buttons with no overlap.
- [ ] 3.3 Open an extract with long content — confirm the header stays attached to the top of the centered content column and the content editor scrolls without occluding the header or buttons.
- [ ] 3.4 Open an extract where the document title is very long — confirm the title truncates within the header row and does not overlap the buttons; confirm the hover tooltip shows the full title.
- [ ] 3.5 Narrow the window width — confirm the header row wraps gracefully (badges and title stack) and still does not overlap the buttons or content editor.
- [ ] 3.6 Confirm no regression in FlashcardScrollItem or other review screens (no edits expected there).
