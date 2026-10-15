## Context

See `proposal.md` for motivation. `DocumentViewer` builds saved marks from `useExtractStore().extracts`. Both its Highlight submenu and Create Extract action call `createInstantExtract`; they do not create separate annotation types. `useToastExtract` persists an extract and reloads the document's extracts.

The renderers have different annotation representations:

- Markdown and HTML/OCR HTML use `applyAnchoredTextHighlights`, whose marks expose `data-highlight-id`.
- EPUB uses epub.js SVG annotations. Its persisted descriptors currently carry IDs such as `<extract-id>:<range-index>`, but the annotation call passes empty metadata. A DOM `closest('mark')` check cannot target these annotations.
- PDF descriptors use `<extract-id>:<page-number>` and page rectangles; fixed layout and reflow have separate rendering paths. `HighlightLayer` is normally pointer-transparent, so simply attaching a context-menu handler to each rectangle is insufficient.

Existing reader context-menu payloads require selected text. EPUB, Markdown, and HTML listeners return early when the selection is empty; PDF resolves a committed or live reflow selection. This prevents right-clicking a persisted mark with no selection.

`useExtractStore.deleteExtract` calls the shared extract API and reloads extracts. The API also patches the document count. Native deletion maintains database counts, queue-tree membership, and sync journaling; browser deletion uses the existing browser backend. `ExtractsList` already opens a delete confirmation. These paths define deletion semantics and must remain the source of truth.

## Goals / Non-Goals

**Goals:**

- Carry an immutable saved-record target from the renderer to a shared reader removal action.
- Clear all visual fragments of that record through state updates while preserving the reader's position and text-selection behavior.
- Use the same persistent deletion semantics on desktop and browser fallback.

**Non-Goals:**

- A global undo/redo history, restoring deleted annotations, or a new keyboard shortcut.
- Splitting highlights and extracts into separate persisted entities or inferring their creation action from color.
- Editing annotation text/colors, deleting a partial range of an extract, or changing linked flashcard deletion policy.
- RSS-only annotations, extension-page annotations, search-result marks, spoken-word highlights, or language-learning decorations outside the document reader's saved extract marks.
- Expanding touch gestures; preserve existing selection-controller ownership of mobile long-press behavior.

## Decisions

### 1. Target saved records explicitly

Extend persisted render descriptors with `extractId` and `documentId`, separate from their renderer-specific IDs. Extend reader menu payloads/state with an optional annotation target or discriminated annotation-menu variant, permitting a menu with no selected text. Snapshot the target when the menu opens; clear it when closing or switching documents. Validate document ownership again before deletion.

Prefer an explicit record target over parsing colon-delimited renderer IDs, matching passage text, or using the most recently created extract. Those alternatives fail for multi-page/range marks, repeated text, and reopened documents. Existing records require no migration: ownership is derived from the extract while building render descriptors.

### 2. Resolve the mark at the pointer before selection/link fallback

Each reader reports the saved marks under the right-click location:

- **Markdown / HTML / OCR HTML:** resolve the nearest owned persisted mark in the event's document, with checks that work across iframe realms. Resolve its ID through the current document's descriptor map.
- **EPUB:** carry record metadata through epub.js annotations and resolve their rendered SVG/range geometry at the pointer. Use the supported rendition/content hooks and current CFI ranges to retain ownership across chapter mounts. Remove listeners when content/renditions are replaced. Translate iframe coordinates to top-level client coordinates exactly once.
- **PDF fixed layout:** hit-test the pointer against current saved rectangles using the page viewport conversion, accounting for zoom, rotation, and scrolling. Preserve pointer transparency for normal text selection.
- **PDF reflow:** use rendered persisted mark ownership and canonical word/range geometry rather than fixed-page screen rectangles. Legacy supported marks use their existing resolved geometry; do not guess from matching text.

An annotation hit takes precedence over an unrelated active selection or an underlying link. If multiple saved records cover the pointer, show an explicit choice identified by passage preview (and color/location as needed), then remove only the chosen record. Never perform bulk deletion based on a shared location. If no owned mark resolves, run the current selection/link/native-menu behavior.

Using pointer geometry where overlays are pointer-transparent avoids making all highlight overlays intercept selection. A single DOM-only resolver was rejected because EPUB and PDF do not share Markdown's mark structure.

### 3. Reuse the shared menu and extract deletion flow

Build annotation menu items in the reader host using the existing `ContextMenu` component. The action label is **Remove highlight/extract**, since the current model cannot reliably distinguish the two creation routes. Keep the destructive item last, separated and danger-styled, and route it through the existing extract delete confirmation pattern; reuse/factor that flow rather than implementing another persistence path. Confirmation identifies the passage and explains that the saved extract will be deleted. Cancel changes nothing.

Consumed annotation contextmenu events stop propagation before mounting the shared menu, so the opening event cannot reach newly installed outside-dismissal listeners and immediately close it.

The user means undoing a saved annotation at its source, including annotations from an earlier session. A transient last-action undo stack would not satisfy that workflow. Deleting only DOM styling would resurrect the mark on reload and leave the saved extract behind.

### 4. Persist first, then reconcile affected state

Normalize camelCase browser-backend responses into the extract API's snake_case ownership/anchor contract before validating targets. Treat browser soft-deletion tombstones as absent records.

Use the shared store/API deletion, with a per-target pending guard. Close the menu as the action starts, retain the confirmation's target snapshot, and prevent duplicate submissions. After successful persistence, remove/reload that document's extract state so every renderer fragment, minimap entry, extracts list, and count updates. Refresh or invalidate loaded queue data using its existing load/invalidation mechanism so the removed extract cannot remain actionable there. Check existing caches during implementation and update only the affected subscriptions; avoid a document reload or navigation.

Guard completion callbacks against a switched/unmounted reader. Reload the target document explicitly where necessary: the global extract store's last-loaded document can differ from the invoking reader. Keep linked learning items subject to the existing extract-list deletion behavior; introduce no new cascade.

On failure, show an error and retain the saved mark/record. If the record was already deleted by another surface, refresh the original document and close the stale flow without decrementing its count twice. Never retarget a stale menu to another extract.

## Risks / Trade-offs

- **EPUB SVG ownership and chapter lifecycles** → Verify actual rendition output, preserve explicit IDs, and test chapter remounts and iframe offsets; do not rely on wrapper classes alone.
- **PDF hit testing diverges under transforms** → Reuse the rendering coordinate conversion and verify fixed, rotated/zoomed, and reflow views.
- **Overlapping annotations may hide each other** → Resolve all saved candidates at the pointer from descriptor geometry and offer a choice; repaint surviving marks after removal.
- **Shared store/document races** → Capture document ownership and record ID, revalidate at confirmation, and guard async UI reconciliation against document changes.
- **Deletion succeeds but a refresh fails** → Reconcile the known deleted ID locally after persistence, then retry/offer refresh without reporting that the saved record still exists or issuing another delete/count decrement.
- **Confirmation adds a click** → It preserves the existing destructive-action convention and makes clear that removing a colored highlight also deletes its saved extract.
- **Geometry scans grow with annotations** → Restrict PDF/EPUB tests to the active page/contents and resolve on contextmenu, without adding continuous pointer-move work. Run the repository benchmark gate during implementation.

## Migration Plan

No schema or saved-data migration is expected. Add optional target metadata to renderer/menu contracts, wire the deletion flow, and validate existing and newly created marks. Rollback removes the new action and event bridges; records already deleted retain the normal extract-deletion semantics.
