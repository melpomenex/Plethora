## Context

See `proposal.md` for the user-facing motivation and `specs/mobile-deck-manager-card-details/spec.md` for the behavioral contract.

The current mobile path is already close to the desired information architecture: `DeckManagerCardRow` calls the Deck Manager card-expansion handler, which selects a card and opens a full-screen overlay; `CardPreviewPanel` already owns the `Preview`, `Edit`, and `History` tabs and their existing save/history behavior. The presentation problem is that the overlay is rendered with `bg-background`, while animated themes intentionally make `.bg-background` transparent so the scenic canvas remains visible. The mobile context menu in `CardContextMenu` is a separate surface for secondary actions and should not become the primary way to navigate the three card views.

## Goals / Non-Goals

**Goals:**

- Make a mobile card tap feel like entering a focused Card Details workspace, not opening a translucent popup.
- Keep Preview/Edit/History as the primary navigation and reuse the existing panel behavior and handlers.
- Guarantee an opaque, theme-aware surface above the animated canvas and mobile navigation chrome.
- Make secondary actions visible from the detail header while retaining the existing context-menu action implementations and confirmation flows.
- Preserve safe-area, keyboard, back-dismissal, scroll, and focus behavior on Android-sized viewports.

**Non-Goals:**

- No new card data model, history API, editor implementation, or backend command.
- No redesign of the desktop Deck Manager or desktop card context menu.
- No changes to the animated theme itself or removal of background animation outside the detail surface.
- No replacement of the existing secondary-action handlers with duplicated mobile-only mutations.

## Decisions

### 1. Use a dedicated full-screen detail surface on mobile

Keep the existing card-selection state and `CardPreviewPanel`, but present the mobile experience as a dedicated full-height surface with a header containing Back, card identity/context, and a visible overflow affordance. A full-screen surface is preferred over a bottom sheet because Edit and History are vertically dense, and a sheet would continue to communicate “temporary menu” rather than “focused workspace.”

The surface should be portaled at the overlay layer and use the shared overlay z-index tokens so it sits above the mobile bottom navigation. It should expose dialog semantics (`role="dialog"`, modal labeling) and return to the invoking card/list on dismissal. The existing mobile card state remains the source of truth; this is a presentation change, not a new route.

Alternative considered: keep the current inline overlay and only change its color. Rejected because it would leave the interaction visually ambiguous, remain vulnerable to overlay stacking, and provide no clear home for secondary actions.

### 2. Reuse `CardPreviewPanel` as the tabbed content owner

Do not duplicate Preview, Edit, or History markup for mobile. Keep the panel's tab state and content in one component, while allowing the mobile shell to provide the stronger header and sizing contract around it. The tab row must remain sticky or otherwise reachable while the tab body scrolls, and touch targets should meet the existing mobile density expectations.

Alternative considered: expose Preview/Edit/History as three items in `CardContextMenu`. Rejected because it adds a navigation step, hides the current view, and makes editing/history look like unrelated commands.

### 3. Use the normalized opaque popover/surface role for the detail background

The detail surface will use a dedicated class or semantic surface styling backed by the already normalized opaque popover/surface color (`--color-popover` with a safe fallback), rather than `bg-background`, glass utilities, or `color-mix(..., transparent)`. Text and borders will use the matching foreground/border roles. This preserves each theme's palette while making the panel itself a solid occluding layer; the animated canvas remains visible only outside the surface.

The style must be applied to the outer surface and any header/tab container that could otherwise inherit transparency. A focused regression assertion should verify the class/token contract rather than a browser-computed color, since theme CSS is injected at runtime.

Alternative considered: disable the animated theme while Card Details is open. Rejected because it changes the user's chosen theme and causes a distracting global transition.

### 4. Promote secondary actions into a header overflow entry point

Add a visible overflow button in the mobile detail header that opens the existing `CardContextMenu` action set for the selected card. The menu remains responsible for suspend/unsuspend, move, duplicate, copy, source, delete, and any future secondary actions. Long-press/context-menu support can remain as a parallel shortcut, but users no longer need to discover long press to reach those actions.

The overflow button must stop propagation so it does not change card selection, and selecting an action must close or update Card Details according to the existing handler result. No action logic is duplicated in `DeckManager` beyond passing the selected card and existing callbacks.

### 5. Use shared mobile overlay and dismissal contracts

The detail surface will use the same safe-area and viewport-height conventions as the existing adaptive overlay system: fixed positioning, overlay layer tokens, dynamic viewport sizing, body-scroll lock while open, independent content scrolling, and an explicit bottom safe-area inset. Back/Escape should close the detail surface before any underlying Deck Manager state is changed. Focus should return to the invoking card when the platform supports it.

## Risks / Trade-offs

- [A new portaled surface may expose existing assumptions about the Deck Manager's inline stacking context] → Keep all card selection and save callbacks in Deck Manager, use stable modal semantics, and add a component test that opens/closes the mobile surface through the real handler path.
- [The panel's internal tab state may reset when the mobile wrapper remounts] → Keep `CardPreviewPanel` mounted for the lifetime of the selected card and key it only by card identity; add a test for switching tabs and returning from a secondary action.
- [An opaque surface may feel visually heavier than the rest of an animated theme] → Restrict opacity to the focused Card Details surface, use theme-provided surface colors, and retain the animated backdrop around it.
- [Long card content or the Android keyboard can make actions unreachable] → Use a fixed header/tab region with an independently scrolling body, dynamic viewport height, and safe-area padding; verify on 390×844 and a shorter Android viewport.
- [Multiple entry points could drift in their action set] → Keep `CardContextMenu` as the sole secondary-action renderer and test that overflow and long-press invoke the same applicable items.

## Migration Plan

1. Update the mobile Deck Manager presentation and shared surface styling without changing card persistence or action APIs.
2. Add unit/component coverage for opaque animated-theme presentation, tab navigation, secondary-action access, dismissal, and keyboard/safe-area contracts; add or update a narrow visual fixture if the repository harness supports the route.
3. Run the focused review component tests, full frontend tests relevant to the touched files, lint/typecheck, and the standard mobile visual checks.
4. Manually verify on an Android device with Campfire: open Deck Manager, tap a card, switch Preview/Edit/History, edit/save, open overflow, use a secondary action, invoke Back, and repeat with the keyboard open.
5. Rollback is a frontend-only revert: restore the current mobile overlay wrapper while leaving card data and existing handlers untouched.

