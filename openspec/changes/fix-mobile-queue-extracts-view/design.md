## Context

Queue/Scroll Mode renders the current item inside a full-height flex layout. Its document pane intentionally uses `overflow-hidden` because the EPUB, PDF, and HTML viewers own their own scrolling and paging behavior. When the overlay switches a document to `scrollViewMode === "extracts"`, `QueueScrollPage` currently mounts `ExtractsList` directly into that overflow-hidden pane. `ExtractsList` is a normal-flow list whose root has spacing but no height, overflow, or outer inset contract, so long lists are clipped and the `Extracts` heading begins at the viewport edge.

The fix must be isolated to the alternate Extracts presentation. It must not move scrolling responsibility into `DocumentViewer`/`EPUBViewer`, change extract APIs, or alter the overlay's view-mode state. The main users are touch readers on narrow phones/e-readers, with desktop and tablet Queue users also needing a complete list.

## Goals / Non-Goals

**Goals:**

- Give the Queue/Scroll Mode Extracts branch its own bounded vertical scroll surface.
- Make touch, wheel, keyboard, and programmatic `scrollIntoView` navigation work within that surface.
- Add responsive inline padding so the heading and cards never render flush against the viewport edge.
- Reserve bottom space for safe-area insets and transient overlay controls so the last extract remains reachable.
- Leave the existing `ExtractsList` data loading and actions reusable in the regular document viewer.

**Non-Goals:**

- Reworking EPUB pagination, iframe scrolling, or reader position persistence.
- Changing the ExtractsList data model, extract ordering, or CRUD/card-generation behavior.
- Redesigning the overlay controls or changing how the user enters/exits Extracts mode.
- Introducing a new mobile-only Extracts component or a new dependency.

## Decisions

### 1. Own overflow at the Queue alternate-view boundary

Wrap the `ExtractsList` branch in `QueueScrollPage` with a full-height, `min-h-0`, vertically scrollable element. Keep the existing parent pane `overflow-hidden` so the EPUB/PDF/HTML viewer branches retain their current containment. The wrapper becomes the scroll owner only when the Extracts view is active.

This is preferable to changing the shared parent to `overflow-y-auto`, because doing so would compete with the viewer's internal scroll roots and could regress EPUB pagination or PDF scrolling. It is also preferable to putting overflow on the reusable `ExtractsList` root, which would change the behavior of the same component when rendered by `DocumentViewer`.

The scroll surface will use the repository's existing utility-class approach (`overflow-y-auto`, `overscroll-contain`, and vertical touch panning) rather than a new global CSS abstraction. The `min-h-0` constraint is required for a flex child to shrink to the available viewport and expose its own overflow.

### 2. Apply insets at the Queue wrapper, not inside the shared list

The Queue wrapper will provide responsive horizontal padding plus top and bottom content padding. The top inset keeps the heading visually separated from the fixed overlay toolbar; the bottom inset includes the mobile safe-area value and enough clearance for transient bottom/edge controls. Horizontal padding is applied at the wrapper boundary so the heading, bulk controls, cards, and empty/error states share the same viewport-safe alignment.

Keeping these insets outside `ExtractsList` avoids changing the regular document viewer's existing spacing and makes the Queue-specific overlay constraints explicit. The content must remain within the pane at very narrow widths; cards and action rows may wrap as they do today rather than creating a horizontal page scroller.

### 3. Preserve view switching and interaction layering

The overlay remains a fixed, higher-z-index control layer. The Extracts scroll region will remain below it and will not add a competing fixed header. Switching to Document or Learning Cards will unmount the Extracts wrapper as before, restoring the viewer/card branch without persisting a stale scroll owner. Existing callbacks, dialogs, focused-extract scrolling, and selection behavior remain unchanged.

### 4. Verify behavior at representative narrow and regular widths

Add focused regression coverage for the Queue Extracts branch or, if the current test harness cannot render the full page, a small structural/layout assertion around the extracted wrapper contract. Supplement this with manual verification on a narrow mobile viewport and a desktop viewport: open an EPUB from Queue, choose Extracts, swipe through a multi-extract document, confirm the heading inset, and switch back to Document to confirm the EPUB viewer still scrolls normally.

## Risks / Trade-offs

- **A scroll container could still be unable to shrink in the flex layout** → keep both the alternate-view wrapper and its parent at `min-h-0`/`h-full`, and verify that a multi-extract list has `scrollHeight > clientHeight` in the browser.
- **Overlay controls could obscure the first or last list item** → include explicit top/bottom clearance in the wrapper, including `env(safe-area-inset-bottom)` for mobile surfaces, and verify the end of the list can be brought fully into view.
- **Changing only Queue spacing may make the shared list look different across entry points** → keep all new padding and overflow ownership on the Queue branch; do not add Queue-specific classes to the shared list root unless a test demonstrates a shared need.
- **Very narrow widths may expose rigid child controls** → rely on the existing wrapping behavior, add `min-w-0` where needed at the wrapper boundary, and check for horizontal overflow rather than solving it with clipped content.

## Migration Plan

No data or runtime migration is required. Ship the frontend layout change with the normal app build. If verification identifies a regression, revert the Queue branch wrapper classes without touching stored extract data or the shared viewer scroll logic.

## Open Questions

- The exact bottom clearance should follow the overlay controls that are enabled in the target build; implementation should use the smallest value that keeps content reachable while honoring the device safe area.
- If a reusable scroll-region primitive is introduced by another in-flight responsive UI change before implementation, the Queue Extracts branch may adopt it instead of duplicating equivalent utility classes, provided the same contract remains observable.
