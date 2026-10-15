## 1. Occlusion image clipping fix

- [x] 1.1 In `ReviewCard.tsx` `renderImageOcclusion`, replace the full-width image with a shrink-wrapped container (`w-fit` centered) around an `<img>` sized `w-auto h-auto max-w-full` plus a viewport-based `max-h` cap, keeping the percentage overlays in the image's coordinate space
- [x] 1.2 In `ReviewSession.tsx`, give the answer-hidden card wrapper the same `md:overflow-y-auto md:min-h-0` treatment as the answer-shown wrapper
- [x] 1.3 Add render tests with tall and wide synthetic images asserting the container shrink-wraps the capped image and every region overlay stays within the visible area

## 2. Opaque occlusion masks

- [x] 2.1 In `ReviewCard.tsx`, change the default mask fill to opaque slate-950, keeping explicit `region.color` applied as authored
- [x] 2.2 Apply the same opaque default in `OcclusionCardPreview.tsx` and `OcclusionLightbox.tsx`
- [x] 2.3 Update occlusion component tests to assert default masks are opaque and authored colors are honored

## 3. Content persistence hardening (backend)

- [x] 3.1 Add `update_learning_item_content` repository method whose UPDATE explicitly sets `question`, `answer`, and `cloze_text` (leaving `cloze_text` unchanged when not supplied)
- [x] 3.2 Extend the `update_learning_item_content_with_version` command with an optional `cloze_text` parameter and call the new repository method, preserving the version snapshot
- [x] 3.3 Add repository/command tests: content persists without the sync path, `cloze_text` omitted leaves the column unchanged, scheduling columns are untouched

## 4. Cloze editing in the inline editor

- [x] 4.1 Extend `updateLearningItemContentWithVersion` in `src/api/learning-items.ts` with an optional `clozeText` parameter, keeping the sync publish
- [x] 4.2 In `InlineCardEditor.tsx`, replace the read-only cloze display with a textarea for raw cloze markup plus the sanitized preview; on save, mirror the cloze text into `question` and warn when no cloze marker is present
- [x] 4.3 Replace the no-op `bulkSuspendItems([])` tag branch with a real `updateLearningItemTags` save
- [x] 4.4 Update the editor's "Edited via Deck Manager" version reason to reflect the calling surface (Deck Manager vs review)
- [x] 4.5 Add editor tests: cloze save updates `cloze_text` and `question`, marker-less save warns, tag change persists through the tag path

## 5. Review session wiring

- [x] 5.1 Add a `patchCurrentCard(updated)` action to the review store that replaces `currentCard` and the queue entry at `currentIndex` only
- [x] 5.2 In `ReviewSession.tsx`, replace the Cmd/Ctrl+E placeholder toast with opening `InlineCardEditor` as an overlay, disabled while `isSubmitting` or an arena decision is pending; wire `onSave` to `patchCurrentCard` with rollback on failure and `onEditInStudio` to the existing Studio flow
- [x] 5.3 Add an Edit control to `ReviewCard.tsx` (pencil affordance in the card header) that invokes the same editor
- [x] 5.4 Add i18n keys for the edit affordance, editor title, and cloze field/warning in all six locales (en, de, es, fr, ja, zh)
- [x] 5.5 Add session tests: shortcut and button open the editor, save patches the in-flight card without a queue reload, failure rolls back, editor stays closed during submission

## 6. Verification

- [x] 6.1 Run `npm run test` (or the repo's targeted vitest suites) and `npm run test:scripts`; fix regressions
- [x] 6.2 Run `npm run bench:check` and record/update `scripts/perf-baselines.json` if any intentional cost changed
- [x] 6.3 Manual pass in the running app: tall occlusion card fully visible pre-reveal, masks opaque, Cmd/Ctrl+E edits a basic card and a cloze card, edit survives app restart with scheduling unchanged
