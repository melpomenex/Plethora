## Why

On Android, tapping a card in Deck Manager opens the card detail view with the `Preview`, `Edit`, and `History` tabs, but the current mobile overlay inherits the animated-theme transparency contract. With themes such as Campfire, the moving backdrop shows through the card surface, reducing contrast and making the tabs and card content feel like a transient menu rather than a focused editing/review workspace. This is a high-frequency interaction that needs a clearer, more stable mobile presentation.

## What Changes

- Replace the current translucent-feeling mobile card overlay with a dedicated, full-height Card Details surface for Deck Manager.
- Present `Preview`, `Edit`, and `History` as the primary mobile navigation for the selected card, with comfortable touch targets, a clear active state, and a persistent card identity/header.
- Give the Card Details surface an explicitly opaque, theme-aware background and readable foreground/border tokens so animated backdrops never bleed through it; preserve the animated theme outside the surface.
- Keep secondary card operations (suspend/unsuspend, move, duplicate, copy, delete, and source actions where available) discoverable through the existing overflow/context-menu path without competing with the three primary tabs.
- Preserve the selected card, active tab, edit state, save behavior, delete confirmation, safe-area handling, keyboard/back dismissal, and scroll behavior across the mobile presentation.
- Keep the existing desktop Deck Manager layout and the desktop card context-menu behavior unchanged.
- Add mobile component/visual coverage for animated themes, tab navigation, safe areas, and secondary-action access, including Android-sized viewports.

## Capabilities

### New Capabilities

- `mobile-deck-manager-card-details`: Defines the focused mobile Card Details surface, its Preview/Edit/History navigation, opaque themed presentation, back/keyboard behavior, and access to secondary card actions.

### Modified Capabilities

- None.

## Impact

- **Frontend:** `src/components/review/DeckManager.tsx`, `src/components/review/DeckManagerCardRow.tsx`, and `src/components/review/CardPreviewPanel.tsx`; likely a small shared mobile-surface style/token adjustment in `src/index.css` or `src/styles/mobile.css`.
- **Tests:** Deck Manager/card preview component tests and the existing visual/theme harness, with a focused animated-theme case for Campfire and narrow Android-like viewports.
- **Behavior:** Mobile card taps become an intentional Card Details workspace; existing card actions and persistence paths remain single-sourced. No backend, database, or API changes are expected.
