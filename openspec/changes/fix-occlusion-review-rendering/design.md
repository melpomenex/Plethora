## Context

Issue #44 left three items open after v2.5.1: two occlusion rendering bugs and the edit-during-review feature request.

**Occlusion clipping.** `ReviewCard.tsx` renders the occlusion image as `w-full object-contain` with no height cap inside a `relative overflow-hidden` container. `ReviewSession.tsx` lays the card out differently before and after the reveal: the answer-shown wrapper is `md:flex-1 md:overflow-y-auto md:min-h-0` (scrollable), while the answer-hidden wrapper is `flex-1 flex items-center` with no scroll, nested under an outer `md:overflow-hidden` container. A tall image therefore overflows and is clipped exactly while the answer is hidden, and becomes scrollable only after revealing, which is the reported symptom: the user is quizzed on a region they cannot see.

**Mask transparency.** Masks in `ReviewCard.tsx` use `bg-slate-950/85` with an inline default of `rgba(15, 23, 42, 0.88)` (the inline style wins). The composer preview (`OcclusionCardPreview.tsx`) uses `bg-slate-950/85` and the lightbox (`OcclusionLightbox.tsx`) uses `bg-slate-950/75`. All three let the underlying image show through enough to read the answer.

**Edit during review.** `Cmd/Ctrl+E` in `ReviewSession.tsx` currently shows the "Edit card is not available yet" toast. `InlineCardEditor.tsx` already exists (used by the Deck Manager): it edits question/answer/tags for basic and Q&A cards, offers an `onEditInStudio` hand-off for complex interaction types, but renders cloze text read-only. Persistence goes through `updateLearningItemContentWithVersion`, whose backend command mutates the in-memory item and calls `repo.update_learning_item`, an UPDATE that writes only scheduling/tag/metadata columns; the content columns (`question`, `answer`, `cloze_text`) are persisted only because the frontend subsequently publishes the card through yjs sync, whose receive side upserts the full row. Editing also has a latent bug: a changed-tags branch calls `bulkSuspendItems([])`, a no-op, so tag edits never persist directly.

Region geometry is percentage-based (`x`, `y`, `width`, `height` as percentages of the image box) and is untouched by this change.

## Goals / Non-Goals

**Goals:**

- Every occlusion region is visible on screen while the answer is hidden, without requiring a reveal or a scroll.
- Region overlays stay aligned with the rendered image at any aspect ratio.
- Masks fully hide the masked content by default on every review-accurate surface.
- The current card can be corrected in place during review (basic, Q&A, and cloze), Anki "edit during review" style, without ending the session or touching scheduling.
- Content edits persist through a direct database write, with the existing version snapshot and sync publish behavior preserved.

**Non-Goals:**

- No editing of occlusion regions inside the review screen; complex types hand off to the existing Flashcard Studio composer.
- No scheduling effects from editing: due date, interval, review history, and memory state are unchanged by an edit.
- No new version-history UI in review (the existing version snapshot mechanism keeps recording; browsing versions stays in the Deck Manager).
- No change to region geometry storage, the composer's drawing tools, or card schemas.

## Decisions

**D1: Shrink-wrapped, height-capped image container (clipping fix).**
Replace the full-width image with a container that shrink-wraps the image (`w-fit`/inline-block, centered) around an `<img>` sized `w-auto h-auto max-w-full max-h-[<viewport cap>]`. The element box then equals the scaled bitmap exactly, so the percentage-positioned overlays remain aligned.

Alternative rejected: keeping `w-full` and adding `max-h` with `object-contain`. That letterboxes the bitmap inside a full-width element box, and the percentage overlays, positioned against the element box, would drift off the actual image content for any aspect ratio that triggers the cap. The shrink-wrap approach keeps the coordinate spaces identical, which is the invariant the composer authored against.

The cap landed as `max-h-[40dvh]` on mobile and `max-h-[calc(100dvh-32rem)]` on desktop. Measured in the running app, the fixed-height chrome above the image (session header + stats + progress + card header + question text ≈ 500px) does not scale with the window, so a pure `dvh` percentage cannot fit both short laptops (720px) and tall monitors; subtracting a fixed offset (the lightbox's `calc` approach) keeps the whole image on screen at every height. Long questions can still consume more than the budgeted offset; the D2 scroll covers that remainder.

**D2: Scroll parity for the answer-hidden wrapper.**
The answer-hidden card wrapper gets the same `md:overflow-y-auto md:min-h-0` treatment as the answer-shown one, and mirrors its inner structure (`justify-start md:min-h-full md:justify-center`) instead of the old `items-center`. Plain vertical centering of an overflowing card pushed the card header under the session stats bar and made the top overflow unreachable; the justify-center-on-min-height form centers only when the card fits and anchors to the top when it overflows. With D1 this is rarely exercised, but it removes the asymmetry that produced the "can only scroll after answering" behavior and protects any other tall card content.

**D3: Opaque masks by default, explicit colors honored.**
The default mask color becomes solid slate-950 (`#0f172a`) in `ReviewCard.tsx`, `OcclusionCardPreview.tsx`, and `OcclusionLightbox.tsx`. An explicit `region.color` set by the author in the composer is applied as authored (author intent wins; the composer's palette can be audited separately). The preview and lightbox are updated together with review because `OcclusionCardPreview` is documented as review-accurate and the lightbox is the studio's viewing surface; letting them diverge would reintroduce the discrepancy.

Alternative rejected: a transparency/strictness setting. The issue asks for opacity, one more setting is one more thing to calibrate, and semi-transparent masks have no accessibility upside; if a "peek" mode is ever wanted it can build on the reveal flow instead.

**D4: Edit entry points and surface.**
Two entry points open the editor over the session: a pencil-style Edit control on the review card and the existing `Cmd/Ctrl+E` shortcut, which currently shows the placeholder toast and now opens the editor instead. The editor renders as a modal overlay/sheet above the card (the session and its position stay mounted underneath), is disabled while `isSubmitting` or an arena decision is pending, and on save updates the session in place. Complex interaction types (image occlusion, multiple choice) keep the existing `onEditInStudio` hand-off rather than gaining in-review region editing.

**D5: Cloze editing.**
`InlineCardEditor` gains a cloze mode: a textarea for the raw cloze markup (the `{{c1::...}}` / `[[c1::...]]` syntax the renderer already normalizes) plus the existing sanitized preview. Saving a cloze writes `cloze_text` and mirrors it into `question`, matching the existing convention where consumers fall back through `currentCard.question || currentCard.cloze_text` (ReviewSession already does this for the audio title, for example). A save with no cloze marker is accepted but warns, mirroring Anki's tolerance rather than blocking a half-finished edit.

**D6: Persistence hardening.**
`update_learning_item_content_with_version` gains an optional `cloze_text` parameter and, critically, a direct database write: a new repository method (`update_learning_item_content`) whose UPDATE explicitly sets `question`, and sets `answer` and `cloze_text` only when supplied (omitted columns keep their stored values — matching the browser backend's IndexedDB partial-update semantics, and protecting pre-existing question-only callers such as the Knowledge Sphere rename from having their answer nulled). The command keeps its version-snapshot behavior and the frontend keeps its sync publish; the difference is that correctness no longer depends on the sync subsystem being alive. A dedicated method is preferred over widening the shared `repo.update_learning_item` UPDATE because that method has many callers (review grading, bulk queue operations, arena commits) that construct partial items after loading only some fields; adding content columns there would risk clobbering real content with stale or default values.

**D7: Session state patch.**
The review store gains `patchCurrentCard(updated: LearningItem)`, which replaces `currentCard` and the `queue` entry at `currentIndex` and nothing else. The editor performs the same optimistic-update-then-rollback pattern it uses in the Deck Manager: patch immediately, revert on save failure.

**D8: Tag persistence fix.**
The changed-tags branch in `InlineCardEditor.handleSave` replaces the no-op `bulkSuspendItems([])` call with `updateLearningItemTags(card.id, newTags)` (the command already exists and publishes to sync). This fixes tag edits from both the Deck Manager and the new review entry point.

**D9: Browser-mode parity fixes found during the manual pass.**
Verifying in the browser (PWA) build surfaced four pre-existing gaps where the browser backend camel-cases rows the desktop backend serializes snake_case, or a command was missing entirely — none of them let an occlusion card render or an edit persist in browser mode: `get_image_asset` returned `dataUrl` while every consumer reads `data_url`; `ReviewCard` read only `image_asset_ids`/`interaction_metadata`; `InlineCardEditor` matched only `item_type === "Cloze"`; and `update_learning_item_tags` had no browser handler (unknown commands silently resolve to `undefined`). All four accept either spelling (mirroring the existing `item_type || itemType` pattern) or add the missing handler, so review now behaves the same on both backends.

## Risks / Trade-offs

- [Overlays misalign for extreme aspect ratios after the fit change] -> Covered by unit/render tests with tall and wide synthetic images asserting the container shrink-wraps the image; the composer's own percentage contract is the reference.
- [Opaque masks remove the faint context hint some users may have liked] -> Intentional per the issue; the reveal flow remains the way to see masked content. Explicit author colors still allow a custom look.
- [Mirroring cloze text into `question` could surprise consumers that treat them differently] -> The fallback convention (`question || cloze_text`) already assumes they can substitute for each other; tests assert both fields after a cloze save.
- [Editing mid-session races a concurrent rating submission] -> The editor is disabled while `isSubmitting` or an arena decision is pending, and the patch only rewrites content fields.
- [Version snapshot growth from quick iterative edits] -> Same mechanism and granularity as the Deck Manager today; not made more aggressive by this change.
- [Widening the save path touches sync] -> The sync publish payload is unchanged in shape (it already serializes `cloze_text`); only the direct DB write is new.

## Migration Plan

No schema migration. The new repository UPDATE and command parameter are additive; older callers that omit `cloze_text` keep the existing behavior (the field is left unchanged when not supplied). Rollback is reverting the commit; content saved through the new path remains valid rows readable by prior versions.
