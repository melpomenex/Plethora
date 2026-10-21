## 1. Foundations

- [x] 1.1 Add a pure `describeActiveFilters(filters)` helper (in `src/components/graph/graphFilterSummary.ts` or alongside `applyGraphFilters`) that returns removable chip descriptors for excluded node types, selected categories, selected tags, and the search query, plus the dimension count; add unit tests covering each kind, empty state, and combination. Verify with `npx vitest run src/components/graph/__tests__/graphFilterSummary.test.ts`.
- [x] 1.2 Add a small persisted-flag helper for the docked sidebar (`plethora:knowledge-graph:sidebar-open:v1`) with safe parsing and mode defaults; unit-test missing, malformed, and valid storage values. Verify with `npx vitest run src/components/graph/__tests__`.
- [x] 1.3 Remove the page-level duplicate `searchQuery` state in `KnowledgeGraphPage.tsx` and bind every search input to `filters.searchQuery`; confirm typing in the header and the sheet stays in sync and the existing search-fit behavior still runs. Verify with a page search test and `npx tsc --noEmit`.

## 2. Filter surface

- [x] 2.1 Split `GraphFilterControls` into a pure `GraphFilterPanelBody` (search, node types, layout, categories, tags), remove its outer `isExpanded` caret/header so the page owns the only surface toggle, and give mobile rows/chips 44px minimum targets. Verify no remaining `isExpanded` references and that the existing filter tests still pass.
- [x] 2.2 Build `GraphFilterSidebar` with a compact header (title and active count), the panel body, and a footer with the visible/total count and a Reset action; render it for `desktop` and `compact-desktop`. Verify with a render test asserting the page-level Filters control carries `aria-expanded`, and Reset clears filters.
- [x] 2.3 Build `GraphFilterSheet` on `ResponsiveDialogSheet` (`presentation="sheet"`) with the panel body and a sticky footer containing Reset and “Show {count} nodes”; confirm the CTA closes the sheet without clearing filters and the dialog traps focus and restores it on close. Verify with a phone-mode test covering dialog role, live count, CTA, Escape, and focus return.
- [x] 2.4 Build `GraphActiveFilterSummary` as a horizontally scrollable row of removable `Chip`s plus Clear all, rendered only when the surface is closed and filters are active; verify removing one chip clears only that dimension and updates the canvas/count, and that no filters renders nothing.
- [x] 2.5 Wire the page to the new surface: `phone`/`tablet` use the sheet (closed on mount), `compact-desktop` docks it collapsed, `desktop` docks it persisted-open; close the sheet when the tab becomes inactive via `useIsActiveTab()`. Verify with page tests at all three presentation modes and a tab-switch test.

## 3. Page chrome

- [x] 3.1 Replace the fixed `h-16` header with a content-driven header using `min-h-16`: two rows on `phone`/`tablet` (title/count/search/overflow, then Graph/Universe switch + Filters), one row on `desktop` (inline search, Filters, Export), and one row without inline search on `compact-desktop`. Verify at 320px, 390px, 768px, and 1280px that no control overlaps, the title truncates instead of wrapping, and every primary action is reachable.
- [x] 3.2 Move Export and secondary actions into an accessible overflow menu on narrow widths and keep the inline Export button on desktop; verify the overflow menu opens, closes on Escape/selection, and is keyboard operable.
- [x] 3.3 Add the Filters control's `aria-expanded`/`aria-controls`, an accessible label including the active count, and a `role="status" aria-live="polite"` visible-count element; verify with accessibility assertions in the page test.
- [x] 3.4 Add the new graph i18n strings to `src/lib/i18n/locales/en.ts` (sheet title/description, “Show {count} nodes”, “Without {type}”, “Search: {query}”, overflow labels) and confirm `npx vitest run src/lib/i18n/__tests__/i18n-completeness.test.ts` passes.

## 4. Canvas, universe, and safe areas

- [x] 4.1 Tighten the page flex chain (`h-full min-h-0 flex-col`, `shrink-0` header, `min-h-0 min-w-0` canvas wrappers) and remove any fixed-height header; verify the canvas top is at or below the header bottom and the canvas does not paint under the header in a layout test.
- [x] 4.2 Add a coalesced `ResizeObserver` to `ObsidianGraph` that resizes the backing store and redraws only when the container size actually changes, without calling `fitToView`; verify with a test that resizing the container updates canvas dimensions and preserves the current transform.
- [x] 4.3 Verify `KnowledgeUniverse`'s top bar, search, breadcrumb, and floating controls are positioned relative to the constrained canvas wrapper and remain non-overlapping when the filter surface opens/closes; adjust the top offset if the header grows. Verify with a universe test/static assertion and the `knowledge-universe-mobile` scenarios.
- [ ] 4.4 Run the page on a real Android device at 390×844: confirm the header clears the status bar, the title is not clipped, the canvas starts below the header, the sheet clears the bottom navigation and stays above the keyboard, and capture before/after screenshots. If the top inset is genuinely zero, fix it once in the shell rather than adding page-local padding, and record the evidence with the task.
  - Status (2026-10-21): blocked on hardware — `adb devices` reports no attached device. Browser evidence: `npx playwright test src/visual/knowledge-graph-layout.visual.spec.ts` passes at 390×844 and with a simulated 24px top inset; screenshots land in `.playwright/results/knowledge-graph-*.png`.
- [x] 4.5 Add a regression test (component or Playwright) at 320×568 and 390×844 asserting no horizontal overflow in the header and `canvasTop >= headerBottom`; verify it fails against the old fixed sidebar/header layout and passes with this change.

## 5. Polish and validation

- [x] 5.1 Check the sheet, chips, sidebar, and header under reduced motion and the e-ink display mode; confirm transitions collapse and the chips remain legible without relying on color alone.
- [x] 5.2 Run `npx tsc --noEmit`, the targeted graph/adaptive/i18n Vitest suites, and `npm run lint`; fix any regressions.
- [x] 5.3 Run `openspec validate improve-knowledge-graph-mobile-ux --strict` and `openspec status --change improve-knowledge-graph-mobile-ux` to confirm the change is apply-ready.
