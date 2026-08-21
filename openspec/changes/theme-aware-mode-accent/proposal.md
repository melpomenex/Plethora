# Change: Theme-Aware Mode Accent for Scroll Mode

## Why

The Scroll Mode launcher button in the queue views is styled with a hard-coded Tailwind
gradient (`from-purple-500 to-pink-500 text-white`) that is identical in every theme.
Plethora ships ~169 themes (48 modern + ~121 legacy palettes); a universal pink/purple
gradient frequently clashes with the selected palette, and it is a one-off visual decision
that no other control shares. Scroll Mode is a special interaction mode and deserves an
accent that is *distinct from the theme's primary accent but derived from the theme itself*,
so it stands out *within* the theme rather than *from* it.

## What Changes

- Introduce a semantic, reusable **mode accent** concept in the theme system:
  `modeAccent` (border/icon/indicator color), `modeAccentMuted` (tinted active background),
  and `modeAccentForeground` (readable foreground), exposed as `--color-mode-accent`,
  `--color-mode-accent-muted`, and `--color-mode-accent-foreground` CSS variables.
- Themes MAY declare an explicit `modeAccent` (new optional `ThemeColors` field). Themes
  without one — including all existing built-in, legacy, and user-imported custom themes —
  receive a deterministic, contrast-safe derived fallback computed in the theme layer.
  No theme file must be edited for this change to work everywhere.
- Replace the hard-coded pink/purple gradient on both Scroll Mode launcher buttons
  (desktop `ReviewQueueView`, mobile `MobileQueueView`) with the semantic mode-accent
  styling, and add a non-color active cue (accent border + retained icon/label) so the
  prominent state never relies on hue alone.
- No behavior change: Scroll Mode entry, tab creation, keyboard access, tooltips, layout,
  and disabled states are unchanged.

## Capabilities

### New Capabilities
- `theme-mode-accent`: Semantic mode-accent color tokens — theme schema field, resolution
  and derivation fallback chain, contrast rules, CSS variable exposure, theme-switch
  reactivity, and custom/legacy theme compatibility.
- `scroll-mode-entry`: Appearance requirements for the Scroll Mode launcher controls
  (desktop and mobile) — inactive/prominent/disabled states, mode-accent usage,
  non-color active cue, and platform consistency.

### Modified Capabilities
<!-- None: openspec/specs contains no theme or scroll-mode-entry capability today. -->

## Impact

- Affected code:
  - `src/types/theme.ts` (optional `modeAccent` field on `ThemeColors`)
  - new theme-layer resolver + small OKLCH color utility module (no new dependency)
  - `src/contexts/ThemeContext.tsx` (`applyThemeToDOM` sets the three CSS variables)
  - `src/index.css` (`@theme` defaults so Tailwind utilities `bg-mode-accent`,
    `text-mode-accent`, `border-mode-accent` exist)
  - `src/components/review/ReviewQueueView.tsx` (desktop launcher button)
  - `src/components/mobile/MobileQueueView.tsx` (mobile launcher button)
  - tests: theme resolution unit tests, component tests, representative theme matrix
- Not affected: Scroll Mode page/overlay chrome (`QueueScrollPage`,
  `ScrollOverlayControls` use their own dark translucent styling), RSS reader entry
  buttons (orange, theme-neutral), scrolling behavior, scheduling.
- Compatibility: persisted theme data is a theme *id* string plus full-theme JSON for
  custom themes in `localStorage`; the new field is optional, so existing custom themes
  keep working unchanged with derived fallbacks.
