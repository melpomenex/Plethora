## Why

Image occlusion is currently the hardest card type to create in Incrementum. The only manual entry point is hovering an image inside a document viewer, which throws the user into the AI Flashcard Studio's card-edit form to drag boxes on a small inline preview with 10px handles, no zoom, and a single "remove last region" as the only undo. The AI path is buried behind an image-registry multi-select in the studio's images sheet, returns all-or-nothing proposals with no per-region review, and silently drops to an empty editor when its boxes clamp away. Both paths produce exactly one card holding every region, so the Anki-style "one card per hidden region" workflow that makes image occlusion useful is not available at all.

## What Changes

- Add a dedicated **Image Occlusion Composer** — a full-screen authoring surface for one image, opened from every place an image is available (document image hover, image registry/library, paste or file drop, studio images sheet, and the existing `image-occlusion` draft card type).
- Replace the inline editor's interaction model with a real canvas: zoom and pan, keyboard nudge/resize, multi-select, duplicate, a numbered region list with inline labels, full undo/redo history, and larger touch-friendly handles.
- Add an **occlusion mode** selector so one authoring session can emit either one card per region ("hide one, show the rest" — the new default) or a single card hiding every region, with a live review-accurate preview of the front and back of each resulting card. A grouped mode is deliberately deferred to a later change.
- Move AI region suggestion **into** the composer: suggest regions for the image currently open, render each proposal as a pending region the user accepts, edits, or rejects individually, and allow re-running with a hint without discarding accepted work.
- Handle degenerate AI output visibly — clamped-away or overlapping proposals are reported in the composer instead of silently yielding an empty editor.
- Keep the existing studio images-sheet AI action and the document hover button as entry points; they now open the composer rather than the studio's card-edit form.

## Capabilities

### New Capabilities
- `image-occlusion-authoring`: the composer surface, its entry points, occlusion mode selection, card preview, and how authored regions become saved flashcards.
- `image-occlusion-region-editing`: the canvas interaction model — draw, select, move, resize, zoom/pan, keyboard control, region list, labels, and undo/redo.
- `image-occlusion-ai-suggestions`: in-composer AI region proposal, per-region accept/reject, refinement re-runs, and failure reporting.

### Modified Capabilities
<!-- No existing spec in openspec/specs/ defines image-occlusion behavior. The
     flashcard-studio-mobile-controls spec's images-sheet requirement still holds:
     the sheet continues to expose an AI image-occlusion action, only its
     destination changes, which is an implementation detail. -->

## Impact

- `src/components/occlusion/OcclusionRegionEditor.tsx` — canvas rewrite; `OcclusionLightbox` folds into the composer's zoom view.
- New `src/components/occlusion/` composer, region list, mode selector, and preview components.
- `src/utils/occlusion.ts` — add region-splitting into per-region cards, overlap/degeneracy checks, and history helpers.
- `src/components/review/FlashcardStudioModal.tsx` — `handleGenerateImageOcclusions` and the `image-occlusion` draft edit form delegate to the composer; the vision prompt and response normalization move to a shared module.
- `src/components/viewer/ImageSaveOverlay.tsx` and `src/components/viewer/DocumentViewer.tsx` — the `incrementum:create-image-occlusion` event opens the composer directly.
- `src/components/review/studio/StudioSheets.tsx` — images sheet action re-targeted.
- Card persistence via `src/lib/database.ts` / `src/stores/reviewStore.ts` — multi-card save from a single authoring session.
- i18n: new keys across all six locales (`en`, `de`, `es`, `fr`, `ja`, `zh`).
- No schema change: cards continue to store percent-based `ImageOcclusionRegion[]` against an image-registry asset id.
