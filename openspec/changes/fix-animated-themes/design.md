## Context

Premium liquid glass themes (`liquid-glass`, `amber-liquid-glass`, and `rose-liquid-glass`) in `src/themes/builtin.ts` configure a CSS-based fluid blob animation on `:root::before` and `:root::after` (behind the app shell at `z-index: -100`). However, because these themes do not override layout wrapper classes like `.app-shell`, `.bg-background`, and `.bg-cream` to be transparent or translucent, the default opaque layout backgrounds completely cover the animated background blobs, leaving the background looking static and still.

## Goals / Non-Goals

**Goals:**
- Add CSS overrides to the `customCSS` of all three liquid-glass themes in `src/themes/builtin.ts` to make `.app-shell` translucent (tinted with the theme's background color) and make other wrappers (`.bg-background:not(.app-shell)`, `.main-content`, `.bg-cream`) transparent.
- Allow the animated CSS blobs to show through the translucent layout wrappers.

**Non-Goals:**
- Rewrite the CSS-based liquid-glass animations to canvas-based rendering in `ThemeBackdrop.tsx`.
- Modify any other non-scenic themes.

## Decisions

### Decision 1: Translucent `.app-shell` backdrop
- **Rationale**: Setting `.app-shell` to fully transparent would let the animated gradient blobs shine through completely, but could degrade text readability if the blobs pass behind text heavy elements. Using a semi-transparent tinted backdrop (e.g., `rgba(..., 0.65)`) keeps the visual theme coherent, maintains readability, and allows the movement of the blobs to show through.
- **Alternatives considered**: Fully transparent wrappers. Rejected due to poor text contrast.

## Risks / Trade-offs

- **[Text readability degradation]** → Mitigation: Tint the translucent background of `.app-shell` with the theme's base color at `0.65` opacity to maintain a dark, high-contrast container layer.
