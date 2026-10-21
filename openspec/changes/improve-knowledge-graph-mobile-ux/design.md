# Design — Improve Knowledge Graph Mobile UX

## Context

See `proposal.md` for motivation. The relevant current state:

- `src/pages/KnowledgeGraphPage.tsx` owns two filter-related state values that do not agree: a page-level `showFilters` and an in-panel `isExpanded` inside `GraphFilterControls`. The sidebar is always `w-72 flex-shrink-0`, and the page header is a fixed `h-16` single flex row with a 256px search input, a Filters button, and an export button that cannot fit a phone.
- `src/components/graph/GraphFilters.tsx` mixes the panel chrome (header, collapse caret, footer) with the filter content (search, node types, layout, categories, tags). `applyGraphFilters` defines the semantics: `nodeTypes` is an exclusion list; `categories` and `tags` are inclusion lists; search is a case-insensitive substring match.
- `src/components/graph/ObsidianGraph.tsx` resizes its canvas from `window.resize` only. Collapsing a docked sidebar changes the container width without a window resize, so the canvas would keep its old backing-store size.
- `src/components/graph/KnowledgeUniverse.tsx` already has a `ResizeObserver` in its engine and mobile-specific overlay chrome.
- The adaptive primitives already provide the behavior this change needs: `ResponsiveDialogSheet` (`presentation="sheet"`) handles portal, scrim, focus trap, Escape, focus restore, safe-area-aware height, and a sticky footer; `SegmentedButton`, `Chip`, `IconButton`, and `Button` cover the controls. `usePresentation().mode` is the canonical presentation classifier (`phone`, `tablet`, `compact-desktop`, `desktop`).

## Goals / Non-Goals

**Goals:**

- Make the canvas the primary content on small screens: filters must never occupy a permanent majority of the width.
- Give the filter surface one owner, one toggle, and a visible collapsed state.
- Keep the user oriented while filters are applied: live result count, removable summary chips, one-tap reset.
- Remove the header overflow/clipping chain so the page chrome fits 320px without wrapping or hiding actions.
- Make the canvas size to its container and stay inside the shell's usable, safe-area-aware content box.

**Non-Goals:**

- Changing `applyGraphFilters` semantics or adding filter dimensions.
- Reworking the selected-node detail drawer (`NodeDetailView`) on phones — it is a fixed `w-96` drawer today, but it is a separate interaction and not part of this change.
- Changing the standalone 3D Knowledge Sphere page, graph data loading, concept projection, or backend commands.
- Adding a user-facing Settings option; the only persisted preference is the docked sidebar's open/closed state.

## Decisions

### 1. Choose the surface from presentation mode, not from a CSS breakpoint

`usePresentation().mode` drives the surface:

| Mode | Surface | Initial state |
| --- | --- | --- |
| `phone`, `tablet` | `ResponsiveDialogSheet` bottom sheet over the canvas | Closed |
| `compact-desktop` | Docked sidebar | Collapsed |
| `desktop` | Docked sidebar | Expanded |

`compact-desktop` is a Tauri window narrower than 1024px that still uses the desktop tab shell; a 288px sidebar there leaves too little canvas, so it starts collapsed but remains docked (no modal over a keyboard-driven layout).

*Alternatives considered:* a single CSS media query duplicated the shell's classification and would disagree with the mobile shell on native tablets; always using the sheet on every width would replace a perfectly good desktop sidebar; always using the sidebar is the current bug.

### 2. One state owner: the page, with the panel as a controlled surface

The page owns `filtersOpen` and the `filters` object. `GraphFilterControls` loses its `isExpanded` state and its outer caret; individual section disclosures (Node Types, Layout, Categories, Tags) stay locally collapsible because they are navigation *inside* the panel, not a second panel collapse.

The docked state is persisted under a versioned key (`plethora:knowledge-graph:sidebar-open:v1`) and initialized lazily from `localStorage` with a safe fallback. The sheet is transient: it always starts closed on mount, so returning to the tab never hides the canvas behind a modal. A malformed or missing value falls back to the mode default, and the marketing `captureConnection` path continues to force the surface closed as it does today.

The existing duplicated `searchQuery` page state is removed; `filters.searchQuery` becomes the single source for both the desktop header search and the sheet search.

### 3. Split the filter component into body and surface

`GraphFilters.tsx` is refactored into:

- `GraphFilterPanelBody` — the pure content: search, node types with counts and visibility state, layout controls, categories, tags. No outer header, footer, or collapse state.
- `GraphFilterSidebar` — `aside` with a compact header (title, active count, Clear all), the body, and a footer with total nodes and a Reset action. The page-level Filters control is the single expand/collapse control; the sidebar does not add a second one.
- `GraphFilterSheet` — `ResponsiveDialogSheet` with title “Filters”, the body, and a footer containing Reset (text) and “Show {count} nodes” (filled). The CTA closes the sheet; closing never clears filters.
- `GraphActiveFilterSummary` — a horizontal row of removable `Chip`s plus Clear all, rendered only when the surface is closed and at least one filter is active.
- `describeActiveFilters(filters)` — a pure helper that turns the filter object into chip descriptors (`kind`, `label`, `onRemove` target). Keeping it pure makes the summary testable without rendering the graph.

`applyGraphFilters` is untouched. Node-type filters are exclusions, so their chip labels say “Without Documents”, “Without Extracts”, etc., rather than the ambiguous “Documents”.

*Alternative considered:* keep one component with a `variant` prop and conditional `className`s. Splitting the body from both surfaces keeps the sheet's dialog semantics and the sidebar's `aside` semantics honest and avoids a component that is half dialog and half panel.

### 4. Header: content-driven height, two rows on phones only

The page header is rebuilt around the existing glass surface:

- **Phone/tablet:** row 1 = icon, title (truncate), visible/total count, search icon, overflow menu (Export). Row 2 = `SegmentedButton` (Graph/Universe, flexible) + Filters button with active-count badge. The two rows use `min-w-0` and `truncate`; no element gets a fixed height.
- **Desktop:** one row = title/count, segmented control, inline search, Filters, Export.
- **Compact desktop:** one row without the inline search (search stays in the docked sidebar); title truncates, actions collapse into the overflow menu if needed.

`h-16` is replaced by `min-h-16` plus padding. This is the direct fix for the clipped “Knowledge” title: the old fixed height clipped a wrapped title instead of growing.

*Alternative considered:* `AdaptiveContentHeader`. Its phone layout stacks every slot into three rows and hides `secondaryActions`, which would bury the Graph/Universe switch or make the header taller than the current broken one. The page keeps its glass header but composes the controls from the same md3 primitives.

### 5. Canvas containment and resize

The flex chain becomes explicit: page `flex h-full min-h-0 flex-col`; header `shrink-0`; body `flex min-h-0 flex-1`; canvas wrapper `relative min-h-0 min-w-0 flex-1 overflow-hidden`. The graph and Universe canvases already use `absolute inset-0` inside their wrapper, so they cannot paint outside it once the wrapper is correctly constrained.

`ObsidianGraph` gets a `ResizeObserver` on its container that coalesces with `requestAnimationFrame`, compares the new width/height to the canvas backing store, and redraws only on a real change. It does **not** call `fitToView` on resize: collapsing the sidebar should reveal more canvas without throwing away the user's pan/zoom. The existing window-resize listener stays as a fallback for older webviews.

`KnowledgeUniverse` already resizes through its engine's `ResizeObserver`; the work there is to verify its overlay top bar is positioned relative to the constrained wrapper and to add the chrome/resize scenario to its tests.

### 6. Top inset and safe areas: one source of truth

The page adds **no** page-local top padding. `.adaptive-shell-root` owns `--shell-safe-top` and applies it once; the page's job is to stop clipping and to keep the canvas inside the resulting content box. Floating graph controls keep using the existing bottom/side `env(safe-area-inset-*)` offsets.

If the device pass shows the native window really does report a zero top inset, that is a shell-level defect: fix `--shell-safe-top` once in the shell rather than adding a second inset in this page, which would double-pad on devices where `env()` does work.

### 7. Accessibility and interaction contract

- The Filters control is a `Button` with `aria-expanded`, `aria-controls`, and an accessible label that includes the active count.
- The sheet is a real modal dialog: focus moves to the first control, Tab is trapped by `useDialogFocus`, Escape/backdrop close it, and focus returns to the Filters control.
- The visible-count text uses `role="status" aria-live="polite"` so filter changes are announced without stealing focus.
- Filter rows, chips, and sheet actions use at least 44px targets in the mobile shell via the existing `data-pointer="coarse"`/phone rules and explicit `min-h-11` where needed.
- On phone/tablet the sheet is closed when the graph tab becomes inactive (`useIsActiveTab()`), preventing a portalled dialog from floating over another tab.

## Risks / Trade-offs

- **Portalled sheet survives tab switches.** `TabContent` hides inactive tabs, but the sheet portals to `document.body`, outside that hidden wrapper. → Close the sheet in an effect when `useIsActiveTab()` becomes false; add a test that switches tabs with the sheet open.
- **Filter count semantics are easy to misread.** `nodeTypes` is an exclusion list, so “1 filter” can mean “Documents hidden”. → Chip labels are explicit (“Without Documents”), and the count badge counts dimensions, matching the existing header count.
- **Persisting the sidebar state can surprise desktop users.** → Only the docked sidebar persists; the sheet stays transient. Defaults preserve today's desktop behavior (open) and fix today's phone behavior (closed).
- **ResizeObserver feedback loops or redraw storms.** → Coalesce with `requestAnimationFrame`, compare dimensions before resizing, and skip redraw when unchanged.
- **Search duplication regressions.** → Remove the page-level `searchQuery`; every search field reads and writes `filters.searchQuery`.
- **Larger phones with long node-type labels.** → The title and chips truncate with accessible full text; the panel body scrolls independently of the footer.

## Migration Plan

No data migration. The only new persisted value is a versioned UI preference; missing or malformed values fall back to the mode defaults, and removing the key is a safe rollback. Filter objects keep their existing shape, so no store or backend changes are required.

Rollout is code-only. Verify at 320×568, 390×844, 768×1024, and 1280×800, plus a real Android device for the top inset, then run the graph and adaptive test suites.

## Open Questions

None. The one adjacent opportunity — turning `NodeDetailView` into a bottom sheet on phones — is deliberately recorded as a non-goal so it does not expand this change.
