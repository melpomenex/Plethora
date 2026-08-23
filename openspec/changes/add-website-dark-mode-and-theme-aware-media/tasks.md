## 1. Semantic Design Tokens & Theme Foundation

- [x] 1.1 Refactor `website/src/styles/tokens.css` to introduce semantic color variables (`--paper`, `--paper-2`, `--paper-3`, `--ink`, `--ink-soft`, `--muted`, `--line`, `--line-strong`, `--surface-card`, `--surface-elevated`, `--surface-code`, `--surface-callout-*`, `--accent`, `--focus-ring`, `--shadow-frame`) with light and dark mode definitions.
- [x] 1.2 Replace hard-coded `#fff`, `#1c1916`, and other light-only color values across `website/src/styles/commercial.css`, `brand.css`, and `global.css` with semantic CSS variables.
- [x] 1.3 Add `:root[data-theme='dark']` and `@media (prefers-color-scheme: dark) { :root[data-theme='system'] { ... } }` token overrides in `tokens.css`.
- [x] 1.4 Implement the zero-FOUC inline theme bootstrap `<script>` in the `<head>` of `website/src/layouts/BaseLayout.astro`.

## 2. Accessible Header Theme Control & State Management

- [x] 2.1 Build the accessible 3-state theme toggle component (System / Light / Dark) in `website/src/components/chrome/ThemeToggle.astro` and integrate it into `SiteHeader.astro`.
- [ ] 2.2 Add theme toggle support to the mobile navigation drawer to ensure complete responsive parity.
- [x] 2.3 Implement client-side theme switching logic: write choice to `localStorage.setItem('plethora-theme', mode)`, update `document.documentElement.dataset.theme`, update `color-scheme`, and dispatch `plethora-theme-change` event.
- [x] 2.4 Add dynamic `<meta name="theme-color">` updates synchronized with active theme background color.
- [x] 2.5 Add `window.matchMedia('(prefers-color-scheme: dark)')` change listener that updates the effective theme when in System mode.
- [x] 2.6 Verify full keyboard operability (Tab, Enter, Space, Arrow keys, Escape to close) and ARIA attributes (`role="menu"`, `aria-label`, `aria-expanded`).

## 3. Theme-Aware Media Primitive (`ThemeImage`)

- [x] 3.1 Create `website/src/components/media/ThemeImage.astro` accepting `srcLight`, `srcDark`, `srcsetLight`, `srcsetDark`, `sizes`, `width`, `height`, `alt`, and responsive attributes.
- [x] 3.2 Implement dual-rendering CSS rules for `ThemeImage` ensuring instant variant switching upon manual `data-theme` changes as well as system media query fallback.
- [x] 3.3 Ensure explicit `width` and `height` attributes are preserved on all rendered `<img>` elements to eliminate Cumulative Layout Shift (CLS).
- [x] 3.4 Add fallback handling when only a single light variant is available.

## 4. Dark Screenshot Capture Pipeline & Media Assets

- [x] 4.1 Update `scripts/marketing/capture-screenshots.mjs` to support Playwright captures with `colorScheme: "dark"` and dark theme mode.
- [ ] 4.2 Run the dark capture pipeline to produce authentic dark product screenshots for all required marketing scenes (`library`, `reader`, `review`, `card`, `explain`, `eink`).
- [ ] 4.3 Encode dark product screenshots into `.avif`, `.webp`, and `.png` using `scripts/marketing/encode-product-images.mjs` and place in `website/public/images/product/*-dark.*`.
- [ ] 4.4 Update `website/src/components/home/HomeDeviceCollage.astro` to use `ThemeImage` with light and dark screenshot sources.
- [x] 4.5 Audit brand marks (`plethora-chirp.svg`, `knowledge-peck.svg`, `plethora-icon-master.svg`) ensuring canonical violet and amber colors are preserved without inversion.
- [ ] 4.6 Update device collage bezel styles in `website/src/styles/brand.css` for optimal contrast on dark backgrounds.
- [ ] 4.7 Update `website/scripts/check-assets.mjs` to validate that all required dark image variants exist with matching dimensions.

## 5. Page-by-Page Dark Mode Verification & Contrast Audits

- [ ] 5.1 Audit and verify dark theme rendering on core marketing routes (`/`, `/features`, `/how-it-works`, `/pricing`, `/downloads`, `/demo`).
- [ ] 5.2 Audit and verify dark theme rendering on docs and changelog (`/docs`, `/docs/**`, `/changelog`).
- [ ] 5.3 Audit and verify dark theme rendering on trust and legal pages (`/privacy`, `/security`, `/terms`, `/refunds`, `/support`, `/contact`).
- [ ] 5.4 Audit and verify dark theme rendering on audience pages (`/students`, `/readers`, `/researchers`, `/spaced-repetition`, `/incremental-reading`, `/read-it-later`, `/anki`, `/404`).
- [ ] 5.5 Run automated accessibility and contrast test suites (`@axe-core/playwright`) across every route in both light and dark themes, verifying WCAG 2.1 AA contrast ratios (≥4.5:1 for text, ≥3:1 for UI elements).

## 6. Testing, Build Validation & CI Gates

- [ ] 6.1 Add unit and integration tests verifying `localStorage` persistence, initial bootstrap behavior, and system preference changes.
- [ ] 6.2 Add automated tests verifying that `data-theme` changes immediately toggle `ThemeImage` visibility without full page reloads.
- [x] 6.3 Verify `npm run website:check` and `npm run website:build` pass cleanly with zero theme-related errors.
