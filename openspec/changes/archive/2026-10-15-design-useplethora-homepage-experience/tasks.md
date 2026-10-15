## 1. Tokens and type

- [x] 1.1 Add `website/src/styles/tokens.css` with paper/ink neutrals, mascot hex CSS variables (`#8B5CF6` `#7C3AED` `#5B21B6` `#F59E0B` `#1E1B4B`), spacing, type scale.
- [x] 1.2 Load subsetted serif + Albert Sans; document font licenses; no FOIT layout jump (size-adjust / fallback metrics).
- [x] 1.3 Dark section optional but not default-dark-AI; if a dark band exists, test contrast.

## 2. Chrome and hero

- [x] 2.1 Style A’s header/footer without generic glassmorphism.
- [x] 2.2 Hero with required headlines, two CTAs (`Get Plethora` → downloads or disabled state from config; `Try the interactive demo` → `#demo` / D slot).
- [x] 2.3 Device collage region using C’s manifest when present, otherwise `data-placeholder="true"` frames with visible “screenshot pending” label (not fake controls).

## 3. Narrative sections

- [x] 3.1 Implement problem, capture, read, understand, remember, connect, trust, platforms, pricing teaser, closing CTA as separate components with stable `id`s for skip links.
- [x] 3.2 Remember section visually outweighs Understand (min. more viewport height or stronger type).
- [x] 3.3 Trust section has no Peck animation and no neon.
- [x] 3.4 Copy references only claims allowed as `public` in the claim matrix (coordinate with E; if matrix missing, use conservative copy and `data-claim-pending`).

## 4. Mascot and motion

- [x] 4.1 Inline or import canonical bird SVG; hexes match brand inventory.
- [x] 4.2 Knowledge Peck appears on extract beat; `prefers-reduced-motion` static.
- [x] 4.3 Scroll/CSS animation paused offscreen and when `document.hidden`.
- [x] 4.4 No wheel hijack; page scroll remains native.
- [x] 4.5 If adding a JS motion library, record bundle bytes in the PR and lazy-load.

## 5. Responsive + fallback

- [x] 5.1 Layouts at 320, 390, 768, 1024, 1440; stacked devices on small screens (no unreadably skewed text).
- [x] 5.2 JS-disabled: all copy still readable (noscript or SSR HTML).
- [x] 5.3 Anti-generic self-review recorded as `website/docs/homepage-review.md` with screenshots at two widths.

## 6. Validation

- [x] 6.1 `openspec validate design-useplethora-homepage-experience --strict`.
- [x] 6.2 Manual: reduced-motion OS setting yields no Peck loop and no parallax.
