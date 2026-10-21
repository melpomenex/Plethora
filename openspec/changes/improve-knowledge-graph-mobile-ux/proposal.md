# Improve Knowledge Graph Mobile UX

## Why

On a phone the Knowledge Graph's filter sidebar is a fixed 288px column: roughly three quarters of a 390px viewport. It has no close button of its own, and the page-level Filters toggle is pushed off-screen by a header that cannot fit its children — the title wraps into two lines and is clipped by the fixed 64px header, while the search field and view switcher overlap. The graph and Universe canvases are squeezed into the remaining sliver, and their chrome can paint beneath the top of the window. A user cannot see — let alone explore — the graph they opened.

This is a core sense-making surface, and the current layout is a desktop sidebar compressed onto a phone. It needs a workspace that treats the canvas as the primary content on small screens and gives filters a proper, dismissible surface.

## What Changes

- **Responsive filter surface.** Phones and portrait tablets get filters as a dismissible bottom sheet over the canvas (closed by default), with a scrim, close affordance, Escape/backdrop dismissal, and a sticky footer that shows the live result count plus Reset and a "Show N nodes" action. Wide layouts keep a docked sidebar that the page Filters control can collapse.
- **One collapse model.** Remove the duplicated page-level toggle and in-panel caret. A single Filters control owns the surface and reflects `aria-expanded`; the docked sidebar remembers its collapsed state, while the phone sheet stays transient and starts closed.
- **Visible filter state when closed.** A compact active-filter summary (count badge on the Filters control plus removable chips such as node-type, category, tag, and search) sits above the canvas so users can see and undo filtering without reopening the sheet. "Clear all" remains one tap away.
- **Live filtering while open.** Toggling a type, category, tag, or search term immediately updates the visible node count and the canvas behind the sheet, so the footer can confirm "Show 214 nodes" before the user commits.
- **Responsive, non-clipping page chrome.** Replace the fixed-height, always-horizontal header with a compact mobile layout: title plus visible/total count, a Graph/Universe segmented control, a Filters control with an active-count badge, and an overflow menu for export/search. No title wrapping, overlap, or off-screen actions at 320px; the header grows with its content instead of clipping.
- **Canvas containment and safe areas.** The page root, header, and canvas flex chain use `min-h-0`/`shrink-0` so the canvas fills only the usable area and never paints beneath the header, status bar, or bottom navigation. The Universe overlay top bar and floating controls honor the same inset contract, and the graph re-fits after the filter surface opens or closes.
- **Accessible interactions.** Focus moves into the sheet, is trapped there while open, and returns to the Filters control on close. Backdrop/Escape close it, the Filters control is fully keyboard-operable, and buttons keep 44px targets.
- **Presentation tests.** Cover desktop-docked, phone-sheet, and collapsed states; live counts; chip removal/clear-all; dismissal and focus return; and a layout regression guard that the header does not overflow and the canvas top is at or below the header bottom.

## Capabilities

### New Capabilities

- `knowledge-graph-workspace`: the Graph/Universe workspace's responsive chrome, filter surface (docked sidebar vs bottom sheet), active-filter visibility, live result counts, state persistence, keyboard/screen-reader behavior, and safe-area containment of the canvas and its controls.

### Modified Capabilities

- `knowledge-universe-mobile`: the Universe overlay's top bar and floating controls must sit inside the workspace's usable canvas below the page chrome and status bar, and must remain non-overlapping after the filter surface opens, closes, or the viewport changes.

## Impact

- `src/pages/KnowledgeGraphPage.tsx` — header, filter surface ownership, responsive layout, canvas sizing.
- `src/components/graph/GraphFilters.tsx` — split filter content from its container; remove the nested collapse state; add sheet footer, chips, and count reporting.
- `src/components/graph/KnowledgeUniverse.tsx` — overlay top bar/floating controls inset and resize behavior.
- `src/components/graph/ObsidianGraph.tsx` — container resize and re-fit when the filter surface changes width/height.
- Adaptive/design-system primitives (`ResponsiveDialogSheet`, `AdaptiveContentHeader`, `SegmentedButton`, `Chip`, `IconButton`) and graph i18n strings.
- Tests under `src/components/graph/__tests__/` and `src/components/adaptive/__tests__/` where shared behavior is exercised.

No backend, API, or data-model changes. Filter semantics in `applyGraphFilters` stay unchanged.
