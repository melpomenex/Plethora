## Context

See [proposal.md](proposal.md) for motivation and [the browsing spec](specs/mobile-deck-manager-browsing/spec.md) for acceptance behavior. This is a scoped refinement in the existing themed Material interface, in Operate mode.

Verified implementation anchors:

- `src/components/review/DeckManager.tsx:742–783`: screen header and a separate mobile deck picker.
- `DeckManager.tsx:895–1160`: additional deck name, six-stat strip, search/actions, wrapping filter chips, sorting/select-all, and column headers all sit outside the list scroll container.
- `DeckManager.tsx:200–280`: shared query/filter/sort state and category counts. Learning counts include Relearning, but the result predicate matches only Learning.
- `DeckManagerCardRow.tsx:181`: individual selection is desktop-only; normal mobile activation opens `MobileCardDetailsSurface`.
- `src/hooks/useMobileShell.ts`: presentation is shared across native phones, narrow tablets, and browser/PWA windows; native phones remain mobile in landscape.
- `ResponsiveDialogSheet`, `ResponsiveBulkActionBar`, and `useOverlayDismissal` already supply most required surface behavior. Existing primitives still need integration verification for target size, stacking, hardware Back, opacity, and keyboard behavior; reusing a component does not prove those properties.
- Existing `improve-mobile-deck-manager-card-actions` artifacts cover Card Details. Existing `anki-deck-export` planning requests a visible toolbar export action; this proposal deliberately uses labeled mobile deck actions while preserving desktop toolbar export. If that older change is implemented later, reconcile its mobile toolbar wording rather than restoring a permanent export icon row.

## Goals / Non-Goals

**Goals:**

- Keep identity, deck switching, search, Study, and discovery of the remaining controls available in a stable, shallow header.
- Reuse action handlers and data projections while separating mobile presentation from desktop chrome.
- Make the height improvement measurable without decreasing text size or touch affordances.
- Give selection and sheets explicit lifecycles so list state, dismissal, and action scope remain predictable.

**Non-Goals:**

- Redesigning global bottom navigation, Review Home, Card Details tabs, themes, or card content.
- Replacing scheduling, search matching rules, or deck-membership models. Aligning the existing Learning/Relearning grouping is the sole predicate correction.
- Implementing Import, introducing new statistics, adding a new UI library, changing storage, or redesigning every bulk toolbar.
- Hiding the header automatically on scroll, adding gesture-only controls, or compressing card rows to manufacture a height gain.

## Decisions

### 1. Use a stable two-row header with one deck identity

Illustrative hierarchy, not a pixel-accurate mockup:

```text
┌──────────────────────────────────────────────┐
│ ←  This Is Your Brain on… ▾   Study       ⋮ │
│    7 cards · 7 due                           │
├──────────────────────────────────────────────┤
│ [ Search cards…             ] [Filter & sort]│
├──────────────────────────────────────────────┤
│ Who wrote “This Is Your Brain on Music”?     │
│ New · Overdue                                │
│──────────────────────────────────────────────│
│ What is the subtitle of Levitin’s book?      │
│ New · Overdue                                │
│ …                                            │
└──────────────────────────────────────────────┘
           Existing bottom navigation
```

Use a title/subtitle block inside the deck switcher, an accessible icon Back control, a text Study button, and an accessible deck-actions icon. Start with a 64px header and 56px search/control row including padding and separators, leaving margin under the 128px ceiling. These are normal-size targets, not fixed height constraints. Use `min-width: 0` and a flexible title/search track so labels cannot push actions off screen. Reserve 48px targets on Android and at least 44px elsewhere; retain breathing room between hit areas.

Keep the two rows outside the existing independently scrolling list. The remaining height becomes list space immediately; no scroll trick is required. Remove the mobile duplicates rather than mounting both versions and hiding them with CSS. Preserve the desktop branch and its three-pane structure. The active deck name serves as the mobile heading, with an accessible Deck Manager screen label.

When browsing is constrained, replace the default subtitle with `4 of 7 · New · Difficulty ↓`; keep the full summary accessible even if visually truncated. The Filter & sort label remains visible and gains a non-color active indicator for category and/or non-default sorting. Search text stays visible in its own field with a reachable clear action. Do not introduce a third chips row.

**Alternatives considered:** A horizontally scrolling chip strip still consumes a permanent row and hides categories at its edges. Collapsing all controls behind a generic menu hides search and current state. Auto-hiding chrome creates scroll/focus jumps and additional gesture behavior. Smaller fonts and targets make the existing problem harder to use. Two stable rows remove repetition while preserving common actions.

### 2. Give each disclosed surface a single, labeled job

| Entry point | Surface and contents | Completion behavior |
| --- | --- | --- |
| Deck title + chevron | Deck picker: full names, counts, selected marker; search within picker when needed for long lists | Choose closes and switches; cancel preserves list |
| Filter & sort | Category radio choices with counts; sort field and direction; Reset and Apply | Apply commits together; close/Back discards drafts |
| Deck actions | New card, Select cards, Deck statistics, Export, and existing applicable deck commands | Close action sheet before opening another surface |
| Deck statistics | Existing six summary metrics, labeled as whole-deck statistics | Close restores list and invoking focus |
| Export | Existing APKG / tab-separated text format choice plus full-deck count | Reuse format/save/export handler and feedback |

Use `ResponsiveDialogSheet` for compact surfaces, with the established Material surface tokens and an opaque readable panel even under animated themes. Reuse current metrics rather than adding analytics queries; the statistics surface replaces the information currently in the inline strip. Use readable labels such as Difficulty and Interval instead of desktop abbreviations in the chooser.

Represent mobile overlays with one explicit surface discriminator, not independent booleans that allow several sheets to open together. Closing one sheet and transitioning to another must preserve a valid focus-return target. Integrate with the existing overlay stack and coordinate the component's current Escape listener so Back/Escape dismisses exactly one surface. Confirmation dialogs take precedence over their invoking sheet, and selection is canceled before Back navigates away. No inline top-of-list confirmation row on mobile.

The current Import control has no click handler (`DeckManager.tsx:1008`); omit it on mobile. Working deck operations remain available through text-labeled commands. Rename needs a touch-accessible form because the desktop handler enters a sidebar editing state that is hidden on mobile; reuse `updateDeck` and existing validation, not that invisible editor. Study is deck-scoped and directly visible. Export continues using complete deck membership, with its actual card count; neither action inherits browse filters.

**Alternatives considered:** Reusing desktop positioned popovers risks clipping in the list's `overflow-hidden` ancestors and does not solve native Back/focus. Adding a universal command hub would be excessive for this surface. Per-purpose sheets use existing presentation conventions and explicit labels.

### 3. Keep one applied browsing state and local filter drafts

Keep `expandedDeckId`, `searchQuery`, `stateFilter`, `sortField`, and `sortDir` in Deck Manager as the source of truth for both presentations. Pass values and callbacks to focused mobile header/sheet components; avoid copying deck/card data into sheet state. Filter drafts initialize when the sheet opens and commit only on Apply. Reset changes the drafts to All / Due ascending and leaves search untouched.

Compute category counts from complete active-deck membership and use the same category predicate for result membership and counts. Learning includes Relearning, matching the existing combined label/count; this small shared correctness fix also reaches desktop filtering while preserving its layout and workflows. Search remains the existing case-insensitive question/tag matcher. Do not add answer/full-text search in this change.

| Event | State policy |
| --- | --- |
| Change query or apply category | Clear selection, reset list to top; keep deck and sort |
| Apply sort only | Reorder results, reset list to top; selected IDs stay attached to cards |
| Switch deck | Clear query/category/selection/stale preview; close sheets; keep sort; list starts at top |
| Dismiss non-mutating sheet or return from Card Details | Preserve applied controls and scroll; restore focus without scrolling away from the previous position |
| Clear search and filters from no-results state | Clear query/category; retain sort and active deck |
| Remove active deck | Clear its preview/selection/transient surfaces; choose a remaining valid deck or show no-decks state |
| Switch presentation | Retain deck/query/category/sort; discard mobile-only sheet drafts and transient selection |

Restore scroll only for return-to-list interactions, not after a genuine dataset change. Use the existing list container ref and card IDs; avoid remounting the list when opening a sheet or details. If mutation removes the old anchor card, clamp to the nearest remaining position. No durable preference or storage migration is needed.

### 4. Treat selection as a temporary mode

Add a mobile selection-mode flag, with entry from Deck actions → Select cards. Replace header actions with a selected-count summary, Done/close, and Select all results; do not append another row. Keep search/Filter & sort available, with the clear-selection rules above. Selection-mode row taps toggle a checkbox; ordinary row taps retain existing Card Details behavior. Do not nest an interactive checkbox inside a button; structure the row affordances with valid semantics and independent labels.

Reuse `ResponsiveBulkActionBar` for existing suspend, unsuspend, delete, and retag operations. Keep a compact visible action subset and overflow for the rest. Adapt retag to a proper sheet instead of the current desktop popover. Set sufficient list bottom padding while the floating bar is mounted so the final row can move fully above it. Clearing the bar clears IDs but may leave selection mode available; Done or Back exits the mode and clears IDs.

Verify the primitive's real z-order relative to the current bottom nav and keyboard (its current `z-40` and nominal action sizing are not evidence of compliance). Use existing overlay tokens and scoped sizing hooks; if a shared primitive needs a small fix, cover its current consumers rather than broadly redesigning them. Bulk delete uses an accessible modal confirmation above the dock and retains error feedback.

**Alternative considered:** Long-press-only selection is undiscoverable and conflicts with existing card context menus. Persistent checkboxes waste width for every browsing session. An explicit mode exposes selection when requested and leaves normal card taps unchanged.

### 5. Measure available space and usability together

Capture the existing view before editing using a fixture based on the supplied long-title, seven-card deck, plus a larger mixed-state deck. Measure in CSS pixels, not screenshot device pixels. Record `firstCard.top - deckManagerContent.top` and the card-list viewport height; keep operating-system bars, global bottom navigation, font size, fixture, and viewport constant between comparisons. At 360, 390, 412, and 430px phone widths with normal text and keyboard closed, require at most 128px before the first card. Also record how many complete rows fit, without changing row typography/density to improve the number.

At 320px, 200% text, landscape, and keyboard-open conditions, prioritize complete controls and readable text over a rigid height target. Test normal/dark/animated themes, zero/one/many decks, no matches, Relearning membership, selected results, a long list, and returning from details. For Android, capture the actual emulator/device build in addition to browser geometry checks; browser screenshots alone are insufficient native evidence. Check iOS safe-area and Back behavior where the available runtime permits; record any unverified hardware cases explicitly.

Use a bounded visual pass: inspect mobile and desktop captures together, fix discovered defects as a batch, then confirm once. No new benchmark baseline is expected for a presentation change; run the repository benchmark/bundle gate during implementation and investigate regressions before claiming completion.

## Risks / Trade-offs

- [Statistics and rare tools need an additional tap] → Keep a clear deck-actions trigger and fully labeled entries; keep search and Study direct.
- [Long names and localization compete for header width] → Flexible/truncated identity with full-name picker and screen-reader access; allow height growth at enlarged text rather than clipping targets.
- [Shared sheet or bulk primitives retain legacy layering/size issues] → Verify computed geometry and modal dismissal in the real shell; use token-based stacking and scoped integration changes with consumer regression coverage.
- [Applied filters become invisible after a sheet closes] → Persistent result/category/sort subtitle, active indicator, direct search, and a one-tap no-results reset.
- [Deck changes or filters leave stale selected cards] → Explicit lifecycle table and tests before connecting destructive bulk operations.
- [Counts currently disagree with Learning membership] → One shared grouping predicate, with mixed Learning/Relearning fixtures; no scheduler changes.
- [Native behavior cannot be proven through DOM tests] → Native build captures and Back/keyboard checks, recording runtime and limits of available evidence.
- [Concurrent unarchived export and Card Details changes overlap] → Preserve current Card Details components and reconcile mobile export placement when applying either change; do not reintroduce permanent chrome through parallel work.

## Migration Plan

Ship as a presentation change using the existing mobile-shell gate. No data migration, dependency install, or preference reset is required. Land mobile header/sheets first, then selection integration, then focused component/visual/native verification and the repository performance gate. Record measurements and screenshots in the change's validation notes. Rollback restores the old mobile presentation without affecting persisted deck/card data; the Learning grouping correction can remain independently covered.
