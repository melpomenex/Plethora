## Why

Issue #44 reported two image-occlusion defects in review mode that break the card's basic function, plus a feature request to edit cards during review (Anki's "edit during review" workflow). First, a tall source image has no height cap in the review card, so occlusion regions far down the image are clipped out of view while the answer is hidden; the card only becomes scrollable after the answer is revealed (the answer-shown wrapper scrolls, the answer-hidden one does not), so the user can be asked about a region they cannot see. Second, the occlusion masks render at 85-88% opacity (`bg-slate-950/85`, default `rgba(15, 23, 42, 0.88)`), which lets the masked answer show through and defeats the recall test. Third, pressing Cmd/Ctrl+E in a review session shows "Edit card is not available yet"; the inline card editor already exists but is only wired into the Deck Manager, and its cloze text is read-only even there, while the underlying content-update command never persists content columns itself (edits only stick via the sync publish side effect).

## What Changes

- Cap the occlusion image height in the review card so the entire image (and therefore every occlusion region) fits inside the visible card area without scrolling, using an aspect-preserving fit that keeps the percentage-positioned region overlays aligned with the rendered image box.
- Make the answer-hidden card container scrollable on desktop for parity with the answer-shown path, as a defensive fallback for any content that still overflows.
- Render occlusion masks fully opaque by default in review (solid slate-950 fallback instead of 85-88% alpha), while still honoring an explicit region color chosen by the author in the composer.
- Apply the same opaque-mask treatment to the occlusion surfaces that must stay review-accurate: the Flashcard Studio composer preview (`OcclusionCardPreview`) and the occlusion lightbox (`OcclusionLightbox`).
- Add edit-during-review: an Edit action on the review card (pencil affordance plus the existing Cmd/Ctrl+E shortcut, which currently shows a placeholder toast) opens the existing `InlineCardEditor` over the session. Basic/Q&A cards edit question and answer; cloze cards edit the cloze text (new capability, the editor currently renders it read-only); complex types (image occlusion, multiple choice) keep their existing "Edit in Studio" hand-off.
- Make cloze text editable end to end: extend `updateLearningItemContentWithVersion` and the backend `update_learning_item_content_with_version` command with `cloze_text`, and persist content columns through an explicit repository update so edits no longer depend on the sync publish side effect.
- Replace the dead tag-change branch in `InlineCardEditor` (a no-op `bulkSuspendItems([])` call) with a real `updateLearningItemTags` save, so tag edits from either surface persist.

## Capabilities

### New Capabilities

- `occlusion-review-rendering`: Requirements for how image-occlusion cards present their image and masks in review and review-accurate preview surfaces: full image visibility without answering, overlay alignment, and opaque masks that hide the answer.
- `review-card-editing`: Requirements for editing the current card from within a review session: entry points, editable fields per card type (including cloze text), Studio hand-off for complex types, persistence without touching scheduling state, and optimistic update with rollback.

### Modified Capabilities

None. No existing spec in `openspec/specs/` covers occlusion rendering or card editing behavior.

## Impact

- **Frontend components**: `src/components/review/ReviewCard.tsx` (image sizing, mask opacity, edit affordance), `src/components/review/ReviewSession.tsx` (answer-hidden container overflow, edit overlay wiring, Cmd/Ctrl+E handling), `src/components/review/InlineCardEditor.tsx` (cloze editing, tag save fix, review-context labeling), `src/components/occlusion/OcclusionCardPreview.tsx` and `src/components/occlusion/OcclusionLightbox.tsx` (mask opacity for review-accuracy).
- **State**: a `patchCurrentCard` action in the review store (`useReviewStore`) so an edit updates the in-flight session card without reloading the queue.
- **API/backend**: `src/api/learning-items.ts` (`updateLearningItemContentWithVersion` gains `clozeText`), `src-tauri/src/commands/learning_item.rs` (command parameter), `src-tauri/src/database/repository.rs` (new explicit content UPDATE writing `question`, `answer`, `cloze_text`).
- **i18n**: new keys for the edit affordance, editor title, and cloze field across all six locales.
- **Tests**: extend `src/components/review/__tests__/ReviewCard.test.tsx`, occlusion component tests, and the learning-items/repository tests for the content update path.
- **No schema migration**; card version snapshots keep their existing `settings`-table storage.
