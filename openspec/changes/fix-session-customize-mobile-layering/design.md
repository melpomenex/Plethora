## Context

See `proposal.md` — Why. Current state and constraints that shape the approach:

- `SessionCustomizeModal` (`src/components/review/SessionCustomizeModal.tsx:258`) renders `fixed inset-0 z-50 flex items-center justify-center bg-black/50` inline (no portal), with a centered panel `:259` `max-w-2xl w-full max-h-[90vh] overflow-auto m-4`, a `sticky top-0` header, an inline "Save as New Queue" bar (`:575`), and a `sticky bottom-0` footer (`:609`). Callers: `ReviewQueueView.tsx:2458` (desktop) and `MobileQueueView.tsx:678` (mobile, New Queue flow).
- `ManageSavedQueuesModal` (`src/components/queue/ManageSavedQueuesModal.tsx:81`) is `fixed inset-0 z-[9999] … p-4` with a centered `max-h-[85vh]` panel. It is the other dialog in the same journey (Saved queue dropdown → Manage Queues → New Queue).
- Mobile chrome: `.mobile-bottom-nav` is `position: fixed; z-index: 1000` and is `56px` tall plus `env(safe-area-inset-bottom)` (`src/styles/mobile.css:298-316`, `--shell-mobile-nav-height` default 56px). `.mobile-main-content` is `height: calc(100% - nav)` with `overflow: hidden` (`mobile.css:285-293`); the nav is a sibling of the content wrapper in `MobileLayoutWrapper`.
- Documented layer tokens already exist and are unused by these dialogs: `--md-z-nav: 30`, `--md-z-dialog: 1060`, `--md-z-menu: 1070`, `--md-z-snackbar: 1080` (`src/index.css:165-171`); mobile overlay tokens `--overlay-backdrop-z: 1050` / `--overlay-sheet-z: 1051` (`src/styles/mobile.css:19-20`).
- Shared primitives: `ResponsiveDialogSheet` (`src/components/adaptive/ResponsiveDialogSheet.tsx`) portals to `document.body`, uses `.adaptive-dialog-layer` (`--overlay-backdrop-z`) + `.adaptive-dialog-panel` (`--overlay-sheet-z`), presents a bottom sheet on phone/tablet with `max-height: calc(var(--app-viewport-height, 100dvh) - max(1rem, env(safe-area-inset-top)))` and safe-area footer padding, and provides focus trap / Escape / focus restore through `useDialogFocus`. `md3/Dialog` is the same surface contract in centered form. `--app-viewport-height` is maintained from `visualViewport` by `useVisualViewport` (`src/hooks/useVisualViewport.ts`) — the app's existing keyboard-avoidance mechanism.
- Precedent: two in-flight changes repair the identical defect class on other dialogs — `fix-rss-customization-settings` (RSS customization panel, `z-50`, with the requirement "Customization dialog covers navigation") and `fix-mobile-layout-and-android-media-controls` (Create Extract dialog, `z-[100]`). Both prescribe this same shared layer. This change follows them rather than inventing a parallel mechanism.
- Test coupling to fix: `src/components/review/__tests__/ReviewQueueView.test.tsx:339-340` resolves the dialog via `getByRole("heading", …).closest(".fixed")`. The shared layer's root is fixed by CSS class (`adaptive-dialog-layer`), not by a Tailwind `fixed` utility, so that helper must query by role instead.

## Goals / Non-Goals

**Goals:**

- One presentation contract for the two queue-journey dialogs: shared dialog layer, sheet on compact, centered dialog on desktop.
- The scrim and panel paint above the bottom navigation, and the navigation is inert while a dialog is open.
- Every control and action in the Customize Session dialog is reachable and hit-testable on a 390×844 phone viewport, including with the on-screen keyboard open.
- A regression guard that fails if a queue dialog lands beneath the navigation again.

**Non-Goals:**

- Repo-wide dialog migration. `CreateExtractDialog` and the RSS customization panel are owned by other in-flight changes; this change records the shell-level contract they converge on.
- Changing what any customization control means, what is persisted, or how saved queues are created/updated.
- Adding new gestures (drag-to-dismiss beyond what the shared sheet offers), nav redesign, or changing `--shell-mobile-nav-height`.
- New i18n strings, except moving existing labels to their new positions.

## Decisions

### 1. Adopt `ResponsiveDialogSheet` instead of a local z-index bump

Use the shared primitive for `SessionCustomizeModal` (and the Manage Queues dialog). It is the app's declared adaptive mechanism (`material-adaptive-shell` — "Surface routing rules": `ResponsiveDialogSheet` SHALL be the adaptive mechanism), it portals to `document.body` so no ancestor stacking context or the `overflow: hidden` content wrapper can trap the dialog, it consumes the documented tokens, and it already provides sheet-on-compact/dialog-on-desktop, dynamic-viewport bounding, safe-area padding, focus trap, Escape dismissal, and focus restoration.

Alternatives rejected: (a) keep the markup and raise the value to e.g. `z-[1100]` — the centered `max-h-[90vh]` panel still straddles the nav band, so the footer remains under the navigation even when painted above it, and it perpetuates ad-hoc z values the shell spec forbids; (b) a bespoke bottom offset (`bottom: calc(nav + safe-area)`) — duplicates the shared sheet and creates a second presentation contract to maintain.

### 2. The compact sheet covers the navigation rather than stopping above it

Standard Material behavior, and the precedent set by the RSS and Create Extract repairs: the dialog and backdrop cover the toolbar and the toolbar cannot receive pointer input while open. This also keeps navigation semantics unambiguous — a nav tap cannot silently navigate away mid-edit — and avoids bespoke nav-height math. Consequence: the surface must apply safe-area bottom padding so the home indicator never overlaps the primary action; `.adaptive-dialog-footer` already does this.

### 3. Compact action layout is explicit, not inherited

Today's footer is one wrapping row of five controls at `text-xs` / `py-1.5` (~28px tall) that mixes primary and secondary actions. On compact presentations the footer becomes: secondary actions as a wrapping row of ≥44px chips (Reset to Defaults, Save as New Queue, and Update Queue `<name>` when a queue is active) above a two-action row where Apply Customization is the filled full-width primary and Cancel is its text/outlined partner. On desktop the existing single-row arrangement and order are preserved.

Rationale: a full-width primary sits in the thumb arc and is one-handed reachable, and ~28px targets fail the touch-target contract already used elsewhere (`min-h-11` / `min-h-12` in `md3/Dialog`, `Modal`, and `QueueItemActionSheet`). Alternative rejected: keeping one wrapping row and only adding padding — five mixed-weight actions wrapping at 390px still yields an ambiguous scan order and sub-minimum targets.

### 4. The "Save as New Queue" name entry stays outside the scrolling body

Today the name bar sits between body and footer (`:575-606`). Keep it immediately above the action footer inside the surface's non-scrolling area (the footer slot) so it cannot scroll out of view and stays above the safe-area inset.

Keeping it visible when the keyboard opens required one shared-primitive fix: `.adaptive-dialog-layer` was `position: fixed; inset: 0`, so on browsers that shrink only the visual viewport (leaving the layout viewport at full height) a bottom-anchored sheet sat behind the keyboard. The layer now bounds itself the same way the app shell and the inspector drawer already do — `top: var(--app-viewport-offset-top)` + `height: var(--app-viewport-height)` — which `useVisualViewport` publishes from `visualViewport`. On desktop both resolve to 0/full height, so nothing moves there. Save / Cancel / Enter / Escape behavior is otherwise unchanged, only placement and bounding.

### 5. The Manage Queues dialog joins the same treatment

At `z-[9999]` with a centered `max-h-[85vh]` panel, Manage Queues is above the nav in z-order but its lower controls can still fall into the nav band: 85vh of an 844px viewport is ~717px, leaving ~64px below the panel, which is less than the ~90px a nav plus home-indicator inset occupies — and it is reached on the way to New Queue. Switching it to the same presentation removes a one-off z value and makes the journey consistent. Alternative rejected: leave it alone, which keeps a modal whose footer can hide under the navigation in the exact reported flow.

### 6. Guard with a source contract test plus a geometry/hit test

- Source-level contract: assert the queue dialogs obtain their layer from the shared primitive rather than raw z utilities. The repo already uses source-reading contract tests (`src/components/adaptive/__tests__/coreSurfaceContract.test.ts`). Scope the guard to the queue dialogs so unrelated in-flight dialogs do not fail.
- Playwright geometry/hit test: reproduce the reported setup with a `#bottom-toolbar` fixture at the nav's z-index 1000 and height 56px, following `src/visual/rssCustomizationHarness.tsx:122-134`. Assert that `document.elementFromPoint` inside the toolbar's bounds resolves to the overlay (not the toolbar), that each footer action's own center point hits that action, and that the panel's bottom edge and the actions' boxes lie inside the visible viewport above the safe area. At desktop width, assert the centered-dialog presentation instead.
- Alternative rejected: asserting computed `z-index` values in jsdom — jsdom implements neither stacking nor hit-testing, so it cannot observe this defect.

## Risks / Trade-offs

- [Desktop visual change] Reusing the shared surface swaps `bg-card border-border rounded-lg` for the MD3 `surface-container-high` surface and its header/footer rules. → Review a desktop screenshot; the control set and order must stay identical; the "Desktop presentation is preserved" scenario covers it.
- [Test helper breakage] Portaling changes DOM ancestry, so helpers that walk up from the heading (`.closest(".fixed")`) stop matching. → Update them to `getByRole("dialog")` / `[role="dialog"]` and run both affected suites.
- [Sheet covers the navigation] A user wanting to switch destinations must dismiss first (scrim tap, Close, or Escape). → Accepted; matches Material and prevents mid-edit navigation; dismissal is one tap away.
- [`100dvh` vs visual viewport] A WebView without `visualViewport` keyboard resize falls back to `--app-viewport-height`'s `100dvh` default, so the input row could sit under the keyboard. → Keep the name entry in the non-scrolling footer area (top of that area) so the panel can still be scrolled to it, bound the shared layer by the visible viewport (see decision 4), and verify on the Android target device.
- [Shared layer change reaches other dialogs] Bounding `.adaptive-dialog-layer` by `--app-viewport-height` also affects the extract dialog and the command palette's search layer, which consume the same class. → Desktop resolves to the same geometry; the change can only improve their keyboard behavior. Re-run the palette, material-contract and RSS customizer visual specs to confirm.
- [Scope creep into other dialogs] Other dialogs share the defect. → Only the queue journey is in scope; the shell-level requirement added here is the contract the other in-flight repairs converge on, and the contract test intentionally guards only these dialogs.

## Migration Plan

1. Swap the `SessionCustomizeModal` root to the shared dialog layer with `presentation="auto"`, keeping the public props and behavior unchanged (`isOpen`, `customization`, `onChange`, `onApply`, saved-queue callbacks, `showDaqe`, `onScheduleRerank`).
2. Restructure the compact footer and name-entry placement; keep the desktop arrangement.
3. Move the name-entry Save / Cancel / Enter / Escape behavior with it, unchanged.
4. Move the Manage Queues dialog to the same layer.
5. Update affected test helpers; add the source contract test and the phone/desktop visual check.
6. Verify: focused vitest suites, `npm run test:visual`, `npm run build`, `npm run bench:check` (no baseline change expected; only update a baseline if a measured regression is intentional and explained).
7. Verify on the connected Android phone through both entry points (queue dropdown and palette), capturing before/after screenshots of the sheet over the navigation.
8. Rollback: revert the component files and the one layer rule. No data, schema, or API migration is involved, so rollback is a pure UI revert.

## Open Questions

None blocking. Which other dialogs adopt the shared layer next is a follow-up decision owned by the in-flight changes that already claim `CreateExtractDialog` and the RSS customization panel.
