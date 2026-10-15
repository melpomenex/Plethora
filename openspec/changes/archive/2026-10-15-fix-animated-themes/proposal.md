## Why

The premium liquid glass themes (Liquid Glass, Amber Liquid Glass, and Rosé Liquid Glass) are currently rendering with a static/still background instead of showing their fluid gradient blob animations. This issue occurs because the `.app-shell` and other layout containers like `.bg-cream` remain opaque in these themes, completely obscuring the CSS-based `@keyframes` animated pseudo-elements positioned on the `:root` document element.

## What Changes

- Add custom CSS rules to the Liquid Glass, Amber Liquid Glass, and Rosé Liquid Glass themes to set the background of `.app-shell` to semi-transparent (`rgba` equivalent of the theme's base background color) and other container classes (`.bg-background:not(.app-shell)`, `.main-content`, `.bg-cream`) to `transparent !important`.
- Ensure theme background animations are visible across all layouts and platforms (desktop, web) when selected.

## Capabilities

### New Capabilities

- `animated-themes-visibility`: Ensure the premium liquid glass themes correctly render their animated background gradient blobs by letting them show through translucent/transparent layout wrappers.

### Modified Capabilities

## Impact

- Frontend: `src/themes/builtin.ts` (updates custom CSS for the three liquid glass themes).
- No API or backend changes.
