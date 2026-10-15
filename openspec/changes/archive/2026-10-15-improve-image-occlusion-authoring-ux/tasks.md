## 1. Pure logic and helpers

- [x] 1.1 Extend `src/utils/occlusion.ts` with viewport math: `viewportToPercent` / `percentToViewport` taking `{ scale, panX, panY }` plus `imgBounds`, keeping `clampRegion`/`clampRegions` untouched
- [x] 1.2 Add `expandRegionsToCards(regions, mode, meta)` to `src/utils/occlusion.ts` for `per-region` and `hide-all` modes, returning card drafts with per-card hidden/visible region sets and label-derived answers
- [x] 1.3 Add `regionIoU(a, b)` and `isDuplicateRegion(candidate, existing, threshold)` to `src/utils/occlusion.ts`
- [x] 1.4 Extend `src/utils/__tests__/occlusion.test.ts`: viewport round-trip at several scales/pans, `expandRegionsToCards` card counts and hidden/visible sets for both modes, label→answer precedence, IoU duplicate detection
- [x] 1.5 Create `src/utils/occlusionAI.ts` by moving `IMAGE_OCCLUSION_SYSTEM_PROMPT`, the 0–1000 bbox→percent conversion, and `normalizeOcclusionRegions` out of `FlashcardStudioModal.tsx`; rewrite the prompt for single-image use and add an "already covered, propose different areas" refinement block
- [x] 1.6 Change the normalizer to return `{ regions, droppedOutOfBounds, droppedDuplicate }` instead of silently dropping, and cover it in `src/utils/__tests__/occlusionAI.test.ts` (well-formed output, out-of-bounds bbox, duplicate against accepted regions, unparseable response)

## 2. Session state

- [x] 2.1 Create `src/components/occlusion/useOcclusionSession.ts` holding `{ regions, suggestions, selection, mode, viewport }` with an `apply(action)` reducer
- [x] 2.2 Add snapshot undo/redo (`past`/`present`/`future`, cap 50) covering draw, move, resize, delete, duplicate, label, and suggestion accept
- [x] 2.3 Ensure continuous gestures commit exactly one history entry on pointer-up, not per pointer-move
- [x] 2.4 Unit-test the hook: undo restores deleted region geometry and label, redo reapplies a move, a single drag yields one history entry, undo is disabled on a fresh session, accepted suggestion returns to pending on undo

## 3. Canvas

- [x] 3.1 Create `src/components/occlusion/OcclusionCanvas.tsx` porting draw/select/move/resize hit-testing from `OcclusionRegionEditor`, routing every mutation through the session hook
- [x] 3.2 Add zoom (wheel, pinch, explicit controls, fit-to-view; 100%–800%) and pan as a CSS transform on the image+overlay wrapper, reusing `gestureMath.ts` where it fits
- [x] 3.3 Add edge handles alongside the existing corner handles, with opposite-edge-fixed resize
- [x] 3.4 Add keyboard control: arrow nudge (1 source px), Shift+arrow (10 px), Alt+arrow resize, Tab selection cycling, Delete/Backspace removal — all suppressed while focus is in a text field
- [x] 3.5 Add multi-select: modifier click, rubber-band drag on empty space, group move, group delete, duplicate-with-offset
- [x] 3.6 Render each region's ordinal and label on the canvas; render pending suggestions in a visually distinct style with inline accept/reject controls
- [x] 3.7 Mobile: `touch-none` canvas, ≥44×44 CSS px handle hit areas, handles rendered only for the selected region on touch shells
- [x] 3.8 Component tests for the canvas: draw creates a clamped region, drag beyond the edge clips, drawing at 400% zoom stores fit-view-equivalent coordinates, panning leaves coordinates unchanged

## 4. Composer shell

- [x] 4.1 Create `src/components/occlusion/ImageOcclusionComposer.tsx` — portalled full-screen shell with canvas, region list, mode selector, preview, Save and Cancel; props `{ assetId, initialRegions?, initialMode?, documentId?, deckId?, onSave, onCancel }`
- [x] 4.2 Create `src/components/occlusion/OcclusionRegionList.tsx` — ordinal, editable label, delete per row, two-way selection sync with the canvas including scroll-into-view
- [x] 4.3 Create `src/components/occlusion/OcclusionCardPreview.tsx` driven by `expandRegionsToCards`, reusing `OcclusionLightbox`'s masked rendering for the front face; front/back toggle, card stepper, total card count
- [x] 4.4 Add the mode selector defaulting to `per-region`, asserting geometry is untouched on switch
- [x] 4.5 Disable Save with zero usable regions and explain why; drop zero-area regions on save; label Save with the card count it will create
- [x] 4.6 Confirm before discarding unsaved work on close
- [x] 4.7 Composer tests: preview count tracks mode and region changes, save disabled with no regions, zero-area region dropped on save, cancel emits nothing, close-with-work prompts

## 5. AI suggestions in the composer

- [x] 5.1 Add a "Suggest regions" action that sends the open image via `occlusionAI.ts` and the configured provider, disabled with an explanation when no vision-capable model is configured
- [x] 5.2 Show a busy state, block concurrent requests, and keep pan/zoom/inspection available during the request
- [x] 5.3 Land results into `suggestions` (never `regions`); implement per-suggestion accept/reject plus accept-all/reject-all, and accept-on-edit
- [x] 5.4 Report dropped-proposal counts and reasons in the composer; report "no usable regions" without leaving the composer or clearing existing work
- [x] 5.5 Implement refinement re-run with an optional hint: replaces pending suggestions only, preserves drawn and accepted regions, and tells the model what is already covered
- [x] 5.6 Preserve regions, suggestions, and undo history on request failure or parse failure, surfacing an error
- [x] 5.7 Tests: pending suggestions leave preview count unchanged, accept moves one suggestion into the region list, edit-accepts, re-run preserves accepted and manual regions, dropped counts are reported, failure preserves state

## 6. Entry points

- [x] 6.1 Mount a composer host at the app shell listening for `incrementum:create-image-occlusion`, replacing `DocumentViewer`'s tab-scoped listener and its `isTabActive`/`documentId` gate
- [x] 6.2 Point `ImageSaveOverlay`'s occlusion button at the new flow (ingest, then dispatch); confirm it no longer routes through `FlashcardStudioModal`
- [x] 6.3 Add an "Create occlusion card" action to the image registry/library that ingests-if-needed and opens the composer
- [x] 6.4 Support opening the composer from a pasted or dropped image file, ingesting into the registry first
- [x] 6.5 Re-target `StudioSheets.tsx`'s images-sheet AI occlusion action at the composer for the selected image, keeping the sheet's existing disabled-state semantics from `flashcard-studio-mobile-controls`
- [x] 6.6 Make `FlashcardStudioModal`'s `image-occlusion` draft edit path open the composer and write regions back to the draft rather than create cards
- [x] 6.7 Replace `FlashcardStudioModal.handleGenerateImageOcclusions` with the composer flow, deleting the usable/needs-manual-authoring bucket split
- [x] 6.8 Tests for the entry points: document hover opens the composer while a different tab is active, studio draft edit round-trips regions without creating cards

## 7. Persistence

- [x] 7.1 Add a single transactional multi-card save path so a session's cards are all written or none are, reporting the whole-session result
- [x] 7.2 Carry deck, document association, source asset id, and question/answer text onto every saved card
- [x] 7.3 Verify a multi-card save round-trips: reopening one of the saved cards in the composer shows exactly that card's regions

## 8. i18n and cleanup

- [x] 8.1 Add every new key to `en` and mirror into `de`, `es`, `fr`, `ja`, `zh` in the same pass; confirm the key-parity test passes
- [x] 8.2 Delete `OcclusionRegionEditor.tsx` once all call sites are migrated, retaining `OcclusionLightbox`'s masked rendering in the preview
- [x] 8.3 Remove the now-dead prompt, normalizer, and bucket-split code from `FlashcardStudioModal.tsx`
- [x] 8.4 Run the full frontend test suite and typecheck; manually verify the composer on desktop and the mobile shell (draw, zoom, keyboard nudge, AI suggest, both modes, save)
