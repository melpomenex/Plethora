## Why

Mobile Deck Manager spends much of the first viewport on repeated deck identity, statistics, actions, wrapping category chips, and sort controls before showing a single card. Browsing and inspecting a deck should be the dominant experience, with secondary tools available through clear, touch-friendly entry points.

## What Changes

- Replace the mobile stack with two compact rows: a Back / deck switcher / Study / deck-actions header, followed by search and a labeled Filter & sort control. Show the deck name once, with a compact card-count and due summary beneath it.
- Put category choices and their counts, sort field, and sort direction in one bottom sheet. Keep active filtering and non-default sorting apparent after closing it, and provide clear reset controls. Make Learning membership agree with its existing count, which groups Learning and Relearning.
- Move detailed statistics and less frequent deck operations into labeled sheets opened from deck actions. Keep Study directly available; preserve working create, export, rename, duplicate, suspend, unsuspend, and delete flows. Do not carry the current inert Import button into the mobile action set.
- Remove the mobile-only need for the separate deck title, six-stat strip, wrapping filter rows, all-sort-buttons row, and single-column “Card” heading. Preserve readable card rows and their existing detail/editor interactions.
- Add an explicit Select cards mode with individual checkboxes and Select all results, and use the existing floating bulk-action pattern above bottom navigation instead of another top toolbar.
- Define a measurable default chrome budget of at most 128 CSS px above the first card at normal text size on 360–430px phone widths, with accessibility-driven reflow at larger text sizes. Preserve mobile safe areas, keyboard behavior, theme tokens, and desktop presentation.

## Capabilities

### New Capabilities

- `mobile-deck-manager-browsing`: Content-first mobile deck browsing, compact deck identity and search, disclosed filter/sort/statistics/tools, explicit selection mode, and measurable viewport/accessibility acceptance criteria.

### Modified Capabilities

- None. This change conforms to existing `mobile-layout-density`, `material-adaptive-shell`, `mobile-bulk-selection-bar`, and `deck-apkg-export` requirements; their contracts do not change. It complements the existing `improve-mobile-deck-manager-card-actions` change without redefining Card Details.

## Impact

- Frontend: `src/components/review/DeckManager.tsx`, `DeckManagerCardRow.tsx`, focused mobile control/sheet components, and scoped mobile styles and localization strings.
- Reuse `useMobileShell`, `ResponsiveDialogSheet`, the overlay dismissal mechanism, `ResponsiveBulkActionBar`, existing statistics calculations, and existing deck/card action handlers. Check shared primitive integration for touch-target and stacking compliance.
- Verification: focused interaction tests, phone viewport measurements, native Android captures, mobile web checks, and desktop regression coverage. No new dependency, backend API, storage schema, scheduler, global navigation, or card-content change is proposed.
