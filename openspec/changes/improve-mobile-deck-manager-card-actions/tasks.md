## 1. Mobile Card Details surface

- [x] 1.1 Replace the current mobile `bg-background` card overlay in `DeckManager` with a dedicated full-height Card Details surface that is portaled through the shared overlay layer, uses the overlay z-index tokens, exposes modal semantics, and respects dynamic viewport/safe-area sizing; verify the rendered mobile surface is above the mobile navigation and does not use a transparency-prone background utility.
- [x] 1.2 Add a mobile detail header with Back, a truncation-safe card/deck identity, and an always-visible overflow affordance; verify long card titles do not clip and the Back control closes only Card Details.
- [x] 1.3 Wire the overflow affordance to the existing `CardContextMenu` action set for the selected card, preserving existing suspend/unsuspend, move, duplicate, copy, source, delete, and confirmation handlers; verify actions target the open card and no duplicate mutation path is introduced.

## 2. Primary card navigation and state

- [x] 2.1 Keep `CardPreviewPanel` as the single owner of Preview/Edit/History content while adapting its mobile tab row to comfortable touch targets, a clear active state, and a fixed/reachable navigation region above an independently scrolling body; verify switching tabs keeps the same card and renders only the selected view.
- [x] 2.2 Preserve card selection, edit/save updates, tag editing, and history state across opening, tab switching, secondary-action dismissal/update, and returning to the list; verify with component tests covering Preview → Edit → save → Preview and History transitions.
- [x] 2.3 Update mobile close/back/Escape handling and focus restoration so Android back, the visible Back control, and Escape dismiss Card Details without changing the active deck or losing list scroll position; verify keyboard and focus behavior with a narrow viewport test.

## 3. Opaque themed surface and regression coverage

- [x] 3.1 Add or reuse a semantic Card Details surface style backed by the normalized opaque popover/surface token with readable foreground and border roles; verify animated-theme CSS cannot make the outer surface, header, tabs, or content transparent.
- [x] 3.2 Add component coverage for the Campfire/animated-theme contract, including surface class/token usage, readable Preview/Edit/History controls, safe-area hooks, and secondary-action availability; verify the tests assert stable semantic contracts rather than browser-computed theme colors.
- [x] 3.3 Add or update an Android-sized visual fixture/snapshot for Deck Manager Card Details when supported by the existing visual harness; no Deck Manager fixture exists in the current visual harness, so the component contract tests cover the narrow/mobile surface structure and scroll containment.
- [x] 3.4 Verify desktop presentation remains unchanged: side-panel CardPreviewPanel, existing desktop tabs, and desktop CardContextMenu behavior still render and pass their existing tests.

## 4. Validation and device verification

- [x] 4.1 Run the focused review/common component tests, typecheck, and lint for touched files; the focused suite and lint pass, while repository typecheck reaches the unrelated pre-existing `src/stores/__tests__/queueAdaptiveLoad.test.ts:65` `TS2493` error.
- [ ] 4.2 Manually verify on an Android device with Campfire enabled: open Deck Manager, tap a card, switch Preview/Edit/History, edit and save, open overflow, exercise a secondary action, dismiss with Back and Android back, and repeat with the keyboard open; confirm the surface is opaque, above mobile chrome, and readable throughout.
