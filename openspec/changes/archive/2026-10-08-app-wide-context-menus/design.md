## Context

Plethora already has a working menu primitive (`src/components/common/ContextMenu.tsx` — store with `showMenu/hideMenu/hideAll`, `ContextMenuItem/Type`, viewport clamping, `useContextMenu` hook; mobile renders via `MobileContextMenuSheet`) but adoption is spotty: document text selection, `DocumentsView` rows, `QueueContextMenu` (⋯ button only, not right-click), and `KnowledgeGraphPage` nodes use it; Review Home decks (`src/components/review/ReviewHome.tsx`), the decks modal, library lists (podcast/RSS/audiobook), flashcards, and tab/sidebar surfaces do not. See `proposal.md` for why; specs in `specs/context-menus/spec.md` define the behavior contract. The design must therefore be a thin, consistent wiring layer over existing handlers/stores (`useStudyDeckStore`, `useQueueStore`, document/episode stores), not new business logic.

## Goals / Non-Goals

**Goals:**
- One trigger/position/dismiss/a11y contract reused by every surface, with desktop popover and mobile-sheet parity.
- Per-surface menus for decks, documents, queue, library, flashcards, tabs/nav — each item dispatching to its view's existing handler/dialog/store mutation.
- Good-UX ordering (primary → secondary → danger-behind-separator), icons + shortcuts, hide-vs-disable rule, no selection side effects on right-click.

**Non-Goals:**
- New review, postpone, export, delete, or playback logic — reuse only.
- Palette/omnibox changes (`contextual-palette-actions` untouched), global menu-bar or tray menus, drag-and-drop reordering, and rich text-edit menus.
- A plugin API for third-party menu contributions.

## Decisions

- **Reuse `ContextMenu` store + `useContextMenu`, add a `useSurfaceMenu` helper (not a second system).** Helper binds `onContextMenu={e => showAt(e, buildItems(ctx))}`, clamps via existing positioning, registers Escape/outside-close, and maps the same item array to `MobileContextMenuSheet` when `useMobileShell` is true. Alternative (per-view bespoke menus like `QueueContextMenu`'s local `isOpen` state) rejected — it caused the current inconsistency and duplicates dismissal/a11y code.
- **Colocate `buildXxxMenuItems(ctx, handlers)` next to each view; keep a central `src/lib/contextMenus.ts` registry only for shared ordering, icons, i18n keys, and hide-vs-disable helpers.** Alternative (all menus in one file) rejected — per-view files stay small and handlers stay single-sourced; central file only prevents label/order drift. Mirrors the `contextual-palette-actions` single-registry lesson without forcing views to import each other's handlers.
- **Right-click never mutates selection; item target = `event.currentTarget` data, not global selection.** Queue/library handlers that today read "now-playing or selected" get an explicit `target` param defaulting to old behavior, so right-clicked rows act on the right object while ⋯/palette paths are unchanged. Decks: right-click does not set `activeDeckIds`.
- **Promote, don't fork, `QueueContextMenu`.** Refactor it to use the shared store with `onContextMenu` on the row + keep the ⋯ button as the same menu's keyboard/touch trigger. Same for `DocumentsView` row menus.
- **Keyboard equivalence via existing focus + Shift+F10/Menu key where the toolkit allows; at minimum every menu item remains reachable by Tab/Enter through its visible trigger.** Full grid-arrow-nav for every list is deferred to avoid scope blowup.

## Risks / Trade-offs

- [Risk] Menu on every row adds `onContextMenu` listeners at scale (long RSS/podcast lists) → Mitigation: single delegated listener per list container using `closest('[data-menu-id]')`, memoized `buildItems`.
- [Risk] Conflicts with text-selection, link, image, and iframe menus (PDF/EPUB/HTML viewers already consume `contextmenu`) → Mitigation: viewers keep precedence; app-row menus check `closest('input,textarea,[contenteditable],a,img')` and yield; PDF/HTML iframe bridges unchanged.
- [Risk] Action drift (menu label works but handler moved) → Mitigation: menu builders call the same handler references as buttons; add a dev-only warn on unknown action id (same pattern as palette spec); unit test per surface asserts menu item count/order/target.
- [Risk] i18n + shortcut string growth → Mitigation: new `contextMenu.*` keys only, reuse existing action strings where identical; shortcuts read from the existing shortcut registry, not hardcoded.
- [Trade-off] Hide-inapplicable vs disable-unavailable can confuse ("where did postpone go?") → Chosen because screenshot-style dense lists punish clutter; tooltips/`title` explain disabled cases.

## Migration Plan

- Additive-only, no data migration. Land behind no flag: shared helper + one surface at a time (decks → documents → queue → library → flashcards/tabs), each with its spec scenarios as tests. Rollback = revert the surface's wiring commit; shared helper stays inert without callers.
- Perf gate: `npm run bench:check` must stay green; no new benchmark needed (interaction wiring, not hot loop). Bundle budget unchanged (no new deps).

## Open Questions

- Should long-press timing on desktop-touch hybrids also open menus, or stay touch-only? Defer to QA pass — either is spec-compatible.
- Do we want a view-level background menu for Documents (New/Sort/Density), or background = no menu for v1? Default to no menu unless user feedback asks.
