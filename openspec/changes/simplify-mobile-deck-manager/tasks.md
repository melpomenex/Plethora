## 1. Baseline and browsing state

- [ ] 1.1 Capture the current mobile view using the supplied long-title seven-card example and a mixed-state fixture; record first-card offset, list viewport height, full visible rows, viewport, font size, and runtime in `validation.md` before edits so the comparison is reproducible.
- [x] 1.2 Separate focused mobile chrome/sheet presentation from the desktop branch while retaining one source of deck/query/category/sort data; verify desktop still renders its toolbar, statistics, column headings, preview, and context menu.
- [x] 1.3 Align category counts and result predicates, including Learning plus Relearning, without changing question/tag search or scheduling; verify mixed-state fixtures produce matching counts and membership with all six existing sort fields and both directions.
- [x] 1.4 Implement the design's state-lifecycle table for deck switches, query/category/sort changes, deleted decks, and presentation transitions; verify focused tests clear stale selections/previews and preserve applied state only where specified.

## 2. Compact header and controls

- [x] 2.1 Build the two-row mobile header with accessible Back, a deck-switching title/subtitle, direct labeled Study, deck actions, search, and Filter & sort; verify no duplicated name/stat/chip/sort/column-heading rows render on mobile and controls remain usable at 320px.
- [x] 2.2 Add the deck-picker sheet with full names, counts, selected state, and an in-sheet search for finding decks in long lists; verify choosing another deck resets query/category/selection/scroll, keeps sort, and cancel preserves the current list position.
- [x] 2.3 Add filter/sort sheet drafts, all existing categories/counts/sort fields/directions, Reset, and Apply; verify cancel discards drafts and Reset plus Apply restores All / Due ascending without clearing search.
- [x] 2.4 Show applied category/sort and visible-versus-total count within the existing subtitle and a non-color active indicator on Filter & sort; verify opening and closing the sheet does not add a permanent third row or conceal applied filtering from assistive technology.
- [x] 2.5 Provide distinct loading, no-decks, empty-deck, and no-results states, including Clear search and filters; verify recovery keeps the chosen deck/sort and nonexistent decks cannot trigger stale operations.

## 3. Disclosed deck tools and mobile surfaces

- [x] 3.1 Build the labeled deck-actions sheet using existing handlers for New card, Select cards, statistics, export, rename, duplicate, suspend/unsuspend, and delete; implement a visible mobile rename form and omit the inert Import command. Verify commands have working outcomes and destruction still requires confirmation.
- [x] 3.2 Present the existing six statistics on demand and APKG/text export choices with the whole-deck card count; verify active search/category does not change statistics, Study scope, or exported membership and existing failure/cancel feedback still works.
- [x] 3.3 Integrate a single active-sheet state with existing modal focus and overlay dismissal; verify Back/Escape closes only the topmost surface, focus returns to a live trigger, and action-to-form transitions cannot close Deck Manager accidentally.
- [ ] 3.4 Apply theme tokens, opaque sheet surfaces, platform target sizing, viewport-safe scrolling, and safe-area/keyboard handling; verify computed hit areas meet 48px on Android / 44px elsewhere and sheets/confirmations remain above bottom navigation in dark and animated themes.

## 4. Temporary selection and context preservation

- [x] 4.1 Add explicit Select cards mode, an in-place selection header, independently labeled checkboxes, and Select all results; verify row/keyboard activation toggles selection once without opening details, while normal mode still opens Card Details.
- [x] 4.2 Integrate the existing responsive floating bulk bar with suspend/unsuspend/delete/retag, reachable overflow, clear selection, and a retag sheet; verify actions affect only selected IDs, filter/query changes clear hidden selection, and no bulk toolbar is inserted above the mobile list.
- [x] 4.3 Give the list bottom clearance for the dock and verify the final card can scroll fully above it; verify Done/Back exits selection, clearing all IDs, and a zero selection dismisses the dock.
- [ ] 4.4 Preserve list position and applied controls when returning from Card Details or non-mutating sheets; verify Preview/Edit/History and card actions continue to work, and removing an anchor card clamps the restored position safely.

## 5. Integrated verification and handoff

- [x] 5.1 Add focused component integration coverage for deck switching, filter Apply/cancel/reset, Learning/Relearning, filtered selection, command scopes, dismissal, and desktop rendering; run the affected Vitest suites and record results rather than relying only on static class assertions.
- [ ] 5.2 Measure the first-card offset and card-list height at normal text on 360, 390, 412, and 430px phone widths using the same fixtures before/after; verify the offset is at most 128 CSS px and record full-row counts without reducing card typography or targets.
- [ ] 5.3 Inspect mobile and desktop captures together, including 320px, 200% text, landscape, no/one/many decks, long names/localized labels, empty results, selection dock, keyboard, and dark/animated themes; fix discovered defects in one batch and confirm the affected states once.
- [ ] 5.4 Build and capture native Android through the repository Android build workflow; verify system Back, keyboard avoidance, status/navigation insets, and modal/dock layering on the recorded emulator/device. Check iOS safe areas/navigation when a runtime is available and explicitly record unavailable hardware checks in `validation.md`.
- [x] 5.5 Run TypeScript checking, lint for touched files, the affected interaction/visual suites, and `npm run bench:check`; record exact commands/results and investigate any regression. Update performance/bundle baselines only for an intentional measured change with documented rationale.
- [ ] 5.6 Run `openspec validate simplify-mobile-deck-manager --strict`, review the diff against the spec, and attach before/after measurements and captures to `validation.md`; mark tasks complete only for work actually implemented and verified.
