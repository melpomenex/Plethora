## Context

Image occlusion authoring today is spread across three surfaces that were never designed together:

- `ImageSaveOverlay` (document viewer hover) ingests the image and fires an `incrementum:create-image-occlusion` window event.
- `DocumentViewer` listens for that event and seeds `FlashcardStudioModal` with a draft card of type `image-occlusion` plus `autoEditDraft`, so the user lands inside the studio's card-edit form.
- `OcclusionRegionEditor` (578 lines) renders that form's inline canvas: percent-coordinate regions, pointer draw/move/resize, 10px handles, a read-only `OcclusionLightbox` for zoomed viewing, and "undo" implemented as `regions.slice(0, -1)`.
- `FlashcardStudioModal.handleGenerateImageOcclusions` is the AI path: it requires images pre-selected from the registry, sends `IMAGE_OCCLUSION_SYSTEM_PROMPT` with 0–1000 bbox output, clamps the results via `clampRegions`, and splits them into "usable" and "needs manual authoring" buckets — the latter silently opening an empty editor.

Constraints that shape the design:

- Percent-based `ImageOcclusionRegion[]` persisted against an image-registry asset id is the existing storage contract and stays. No DB migration.
- Tauri v2 builds with `inlineDynamicImports: true`, so a new heavyweight canvas dependency inflates the single bundle for everyone. The repo already has hand-rolled gesture math (`src/components/graph/universe/gestureMath.ts`) and no panzoom library.
- The composer must work on desktop pointer, trackpad, and the mobile shell that `flashcard-studio-mobile-controls` already governs.
- Six locales must stay in sync.

## Goals / Non-Goals

**Goals:**

- One authoring surface reachable from every entry point, replacing the "hover an image, land in a chat modal's edit form" path.
- Precision authoring: zoom/pan, keyboard nudge, multi-select, region list, real undo/redo.
- Occlusion modes, including the Anki-style one-card-per-region default that the app cannot currently produce at all.
- AI suggestion moved in-context, with per-region accept/reject and visible failure reporting.

**Non-Goals:**

- Non-rectangular regions (ellipse, polygon, freehand). Rectangles only; the geometry helpers stay 4-number.
- Changing the review-time rendering of occlusion cards beyond what multi-card output requires.
- Changing the image registry, its ingestion paths, or the stored card schema.
- Batch authoring across several images in one composer session — one image per session.
- OCR-assisted region detection (Tesseract is present in the app but that is a separate capability).

## Decisions

### Composer is a portalled full-screen component owning its own state

`ImageOcclusionComposer` lives in `src/components/occlusion/`, is rendered through `createPortal` to `document.body` (the pattern `OcclusionLightbox` already uses to escape the studio modal's stacking context), and holds the authoring session state internally: regions, selection, pending suggestions, mode, viewport, and history. It communicates with callers through a narrow prop contract:

```
{ assetId, initialRegions?, initialMode?, documentId?, deckId?, onSave(cards), onCancel() }
```

Alternative considered: keep the editor inline inside `FlashcardStudioModal` and just add features. Rejected — the studio form is where the current cramped canvas comes from, and three of the five entry points have no business opening a chat modal at all.

### A single `useOcclusionSession` hook holds regions + history + suggestions

Rather than spreading state across the composer, the region list, and the preview, one hook exposes `{ regions, suggestions, selection, mode, apply(action), undo, redo }`. History is a plain `{ past: Region[][], present: Region[], future: Region[][] }` snapshot stack — regions are small plain objects and a session holds tens of them, so snapshotting the whole array per mutation is cheaper to write and reason about than a command/inverse-command scheme, and makes "undo an accepted suggestion" fall out for free. Cap the stack at 50 entries.

Continuous gestures (drag-move, drag-resize, draw) push **one** history entry on pointer-up, not per pointer-move — otherwise a single drag buries the stack.

### Zoom/pan via a CSS transform on a wrapper, coordinates stay percent

The canvas keeps today's model — `imgBounds` (offset/width/height of the rendered image inside its container) plus percent coordinates — and adds `{ scale, panX, panY }` applied as a CSS `transform` on the image+overlay wrapper. `toPercent()` gains an inverse-transform step; `regionToPx()` gains the forward one. Nothing about storage or clamping changes, which is what keeps `clampRegion`/`clampRegions` and their existing tests valid.

Alternative considered: `react-zoom-pan-pinch` or rendering to a real `<canvas>`. Rejected — a new dependency in a single-bundle build for what is roughly 40 lines of transform math, and a `<canvas>` rewrite would throw away the DOM-node hit-testing and accessibility we already have.

Pinch/wheel handling reuses the gesture math already in `src/components/graph/universe/gestureMath.ts` where it fits; anything specific to this canvas goes in `src/utils/occlusion.ts` next to the geometry helpers so it is unit-testable without a DOM.

### Mode → cards is a pure function in `src/utils/occlusion.ts`

`expandRegionsToCards(regions, mode, meta)` returns the card drafts a session will produce. Both the preview and the save path call it, so the preview cannot drift from what actually gets saved, and the whole mode feature is testable without rendering anything. `OcclusionLightbox`'s masked rendering becomes the preview's front face so review-accuracy is structural rather than a second implementation.

Card identity: cards from one session share a `sourceAssetId` and are created in region order. Re-opening the composer for an existing card edits **that card only** — re-splitting a previously saved set of per-region cards is out of scope.

Only two modes ship: `per-region` (default) and `hide-all`. A grouped mode was considered and deferred — it is the least-motivated of the three and costs group state on regions, a group control in the region list, group-aware multi-select, and a third expansion branch. `expandRegionsToCards` takes a mode enum, so adding it later is additive.

### Suggestions are a separate array, not regions with a flag

Pending suggestions live in their own `suggestions: Region[]` array rather than as `regions` carrying `status: "pending"`. This makes "pending suggestions must not affect the region list, the preview, or the saved output" true by construction instead of by remembering to filter at every consumer. Accept moves an entry from `suggestions` to `regions` (one history entry); reject drops it; editing a pending suggestion accepts-then-applies.

### The vision prompt and response normalization move to `src/utils/occlusionAI.ts`

`IMAGE_OCCLUSION_SYSTEM_PROMPT`, the 0–1000 bbox → percent conversion, and `normalizeOcclusionRegions` currently live inside `FlashcardStudioModal.tsx`. They move to a module the composer and the studio both import. The prompt gains an "already covered, propose different areas" block for refinement re-runs, and drops the multi-image framing since a session is single-image.

Dropped-proposal accounting becomes part of the normalizer's return value — `{ regions, droppedOutOfBounds, droppedDuplicate }` — so the composer can report counts instead of the current silent bucket-split.

Overlap threshold for duplicate collapse: IoU > 0.6 against any accepted region. Chosen as a middle value; tune if it proves wrong in practice.

### Entry points converge on one event

`incrementum:create-image-occlusion` stays as the ingestion→open signal, but is handled by a composer host mounted once at the app shell rather than by `DocumentViewer`'s tab-scoped listener. That removes the `isTabActive && sourceDocumentId === documentId` gating that currently makes the event a no-op when the user is on a different tab, and lets the registry, paste/drop, and studio paths reuse the same signal. The studio's `image-occlusion` draft edit path calls the composer directly (it already has the regions in hand and needs them written back to the draft, not saved as cards).

## Risks / Trade-offs

- **Rewriting `OcclusionRegionEditor` risks regressing the coordinate correctness that `stability-performance-enhancements` and `fix-outstanding-reported-bugs` already hardened** → keep `clampRegion`/`clampRegions` and their tests untouched, add transform math as a separate tested layer, and port the existing `occlusion.test.ts` cases before touching the component.
- **Full-array history snapshots grow unbounded on a long session** → cap at 50 entries; a region is ~6 small fields, so the cap is trivially small in memory.
- **Multi-card save is a new write pattern** — a partial failure could leave half a session's cards persisted → save through one transactional path and report the whole-session result; do not report success on partial writes.
- **One-card-per-region can generate a lot of cards from one AI run** (accept-all on 8 suggestions = 8 cards) → the preview states the card count, and Save names the count explicitly.
- **Pinch-zoom on the mobile shell competes with the sheet/modal gesture handling** already specified by `flashcard-studio-mobile-controls` → the composer portals above the studio and takes `touch-none` on the canvas, as the current editor already does.
- **Larger touch handles (44px) crowd small regions at fit-to-view zoom** → render handles only for the selected region on touch, and rely on the region list for selecting among dense regions.
- **Six locales must gain a sizeable key set**; a missed locale shows raw keys → add all keys in one pass across `en/de/es/fr/ja/zh` and keep the existing i18n key-parity test as the gate.

## Migration Plan

No data migration — stored card shape is unchanged and existing occlusion cards open in the composer as-is.

Rollout is a straight replacement rather than a parallel path: `OcclusionRegionEditor`'s current call sites (the studio card-edit form and the studio detail view) are re-pointed at the composer in the same change, and the old inline editor is deleted rather than left behind as dead code. `OcclusionLightbox`'s masked-render logic is retained as the preview's front face.

Rollback is reverting the change; nothing persisted depends on it.

## Open Questions

- Should "one card per region" show the *other* regions unmasked (Anki's "hide one, guess one") or masked-but-labelled? The spec says visible; confirm against how review currently renders a multi-region card.
- Should the composer offer "save and author another region set on the same image", or is one session per open sufficient?

Resolved: grouped mode is deferred out of this change — ship `per-region` and `hide-all` only.
