## Why

Extracts are the core artifact of incremental reading, but there is no way to reach them from the toolbar — the only entry points are per-document (Documents view → "View extracts", or the viewer's extracts mode). There is no library-wide extracts surface at all.

At the same time the toolbar is a wall of ~18 unlabeled icons. Labels exist only in the native `title` tooltip, which is slow, ugly, and invisible to keyboard users. Users have to hover-and-wait on each icon to learn what it does.

## What Changes

- Add an **Extracts** toolbar button (Phosphor `Scissors` icon) in the navigation group that opens a library-wide Extracts tab listing extracts across all documents, with jump-to-source.
- Make the toolbar **hover/focus-expandable**: hovering (or keyboard-focusing) the toolbar expands it inward over the content area, revealing each button's text label beside its icon. It collapses back to the icon rail when the pointer leaves and focus moves out.
  - Expansion overlays the content area — it never reflows the page.
  - Short open delay + longer close delay so passing the cursor over the rail does not flap it open.
  - Respects `prefers-reduced-motion` (instant, no slide).
  - Works for `left`, `right`, and `top` toolbar positions; "inward" means toward the content area for each.
- No change to click behavior, middle-click background-open, shortcuts, or tour anchors.

## Capabilities

### New Capabilities
- `extracts-library-view`: A toolbar-reachable tab listing extracts across all documents, with navigation back to each extract's source document.
- `toolbar-expand-on-hover`: The toolbar expands on hover/focus to reveal button labels, and collapses when the pointer and focus leave.

### Modified Capabilities
<!-- None. No existing spec in openspec/specs/ covers toolbar buttons or extract listing. -->

## Impact

- `src/components/Toolbar.tsx` — new button entry, expansion state/handlers, label rendering.
- `src/index.css` — toolbar expansion styles (existing `.toolbar-button*` classes).
- `src/components/tabs/TabRegistry.tsx` — new `extracts` tab type.
- New `src/components/tabs/ExtractsTab.tsx` (library-wide list; reuses `getExtracts(null)` from `src/api/extracts`).
- `src/lib/i18n/locales/*.ts` — new `toolbar.extracts` and extracts-tab strings across all 6 locales.
- No backend, DB, or API changes — `getExtracts` already accepts a null document filter.
