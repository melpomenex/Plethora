## Why

The `useplethora.com` website currently only supports a single, hard-coded light theme. Hard-coded white backgrounds (`#fff`) and light-only CSS variables permeate `tokens.css`, `commercial.css`, `brand.css`, and `global.css`. Users visiting the site in low-light environments or with operating-system dark mode enabled experience severe visual glare.

Furthermore, "dark mode" on a content-rich commercial site cannot be achieved simply by flipping background colors in CSS:
1. Product screenshots and device mockups across the homepage, features, and showcase are light-only; flipping surrounding backgrounds turns screenshots into glaring white rectangles.
2. Blanket CSS filter inversions (e.g. `filter: invert(1)`) corrupt brand marks, diagram colors, and the canonical palette of the Plethora mascot ("Friendly Chirp").
3. Changing themes causes an unacceptable Flash of Unstyled Content (FOUC) or wrong-theme flash if the theme is not bootstrapped in `<head>` before initial paint.
4. The visual direction must feel like a tactile, editorial "midnight library" rather than a generic neon-purple developer dashboard or flat pitch-black terminal.

This change introduces a site-wide light/dark/system theme architecture, semantic token refactoring, zero-FOUC `<head>` bootstrap, accessible header controls, a reusable theme-aware media primitive (`ThemeImage`), deterministic dark-mode screenshot capture tooling, and WCAG AA contrast compliance across all public routes.

## What Changes

- **"Midnight Library" Editorial Dark Theme**: Establish a cohesive dark palette reflecting Plethora's paper-and-ink reading identity:
  - Deep charcoal, muted ink-navy, and eggplant surfaces (`--paper: #121016`, `--paper-2: #1a1622`, `--paper-3: #251f30`).
  - Warm ivory and warm gray-lavender text (`--ink: #f4efe6`, `--ink-soft: #d8d0c2`, `--muted: #9e94a8`).
  - Desaturated violet-gray borders (`--line: #2e273a`, `--line-strong: #423952`).
  - Restrained Plethora violet accents (`--plethora-violet-400: #8b5cf6`, `--plethora-violet-500: #7c3aed`) and warm amber for the mascot beak (`--plethora-beak: #f59e0b`).
  - No generic neon-purple gradients, no glassmorphism blobs, and no blanket color inversion.
- **Semantic Token Refactoring**: Refactor hard-coded `#fff` backgrounds, borders, cards, buttons, callouts, tables, and inputs in `website/src/styles/tokens.css`, `commercial.css`, `brand.css`, and `global.css` into semantic tokens that automatically adapt to the active theme.
- **Zero-FOUC Early Theme Bootstrap**: Implement an inline, synchronous `<script>` in the `<head>` of `website/src/layouts/BaseLayout.astro` that reads `localStorage.getItem('plethora-theme')` or system `prefers-color-scheme`, instantly applying `data-theme` and `color-scheme` to `<html>` prior to first visual paint.
- **Accessible Header Theme Control**:
  - Add a compact 3-option control (System, Light, Dark) to `website/src/components/chrome/SiteHeader.astro` and the mobile navigation drawer.
  - Supports keyboard navigation (Tab, Arrow keys, Enter, Space, Escape to dismiss).
  - Persists selection in `localStorage` under `plethora-theme`.
  - Dynamically updates `<meta name="theme-color">` to match the effective background color.
  - Listens to OS `prefers-color-scheme` changes when System mode is active.
- **Reusable Theme-Aware Media Primitive (`ThemeImage.astro`)**:
  - Create a lightweight Astro component that handles both CSS `prefers-color-scheme` and manual `data-theme` overrides.
  - Renders light and dark image sources with responsive `srcset` and `sizes`.
  - Preserves explicit `width` and `height` attributes to prevent Cumulative Layout Shift (CLS).
  - Switches visible variants immediately upon manual theme selection without full page reload.
  - Safe fallback when only one variant exists.
- **Comprehensive Media Audit & Dark Screenshot Capture**:
  - Class 1: Brand marks and mascot assets (`plethora-chirp.svg`, `knowledge-peck.svg`, `plethora-icon-master.svg`) retain canonical hex values; surface backdrops adapt.
  - Class 2: Product screenshots captured via the deterministic Playwright pipeline (`scripts/marketing/capture-screenshots.mjs`) with `colorScheme: "dark"` and dark theme mode.
  - Class 3: Device collage mockups (`HomeDeviceCollage.astro`) with dark device frames and adjusted drop shadows.
  - Class 4: Vector diagrams and line art using semantic CSS tokens for stroke and fill.
  - Class 5: High-contrast social preview cards.
- **Full Route Coverage & WCAG AA Contrast**:
  - Audit and test every public route (`/`, `/features`, `/how-it-works`, `/pricing`, `/downloads`, `/demo`, `/docs/**`, `/changelog`, `/support`, `/contact`, `/privacy`, `/security`, `/terms`, `/refunds`, `/students`, `/readers`, `/researchers`, `/spaced-repetition`, `/incremental-reading`, `/read-it-later`, `/anki`, `/404`).
  - Verify WCAG 2.1 AA contrast compliance (minimum 4.5:1 for normal text, 3:1 for large text and UI components) across all resting, hover, active, and focus states.

## Capabilities

### New Capabilities

- `website-color-theme`: Site-wide color theming engine, semantic token system, early no-FOUC `<head>` bootstrap, accessible 3-state header control, localStorage persistence, OS preference tracking, and WCAG AA contrast compliance across all website routes.
- `website-theme-aware-media`: Reusable `ThemeImage` media primitive, deterministic dark product screenshot capture pipeline, asset categorization, brand mascot protection, and automated theme-aware image validation.

### Modified Capabilities

<!-- No existing capability specs modified -->

## Impact

- **Website Layouts & Chrome**:
  - Updates `website/src/layouts/BaseLayout.astro` with inline bootstrap script and dynamic `theme-color` meta.
  - Updates `website/src/components/chrome/SiteHeader.astro` with the accessible theme control.
- **Styles**:
  - Refactors `website/src/styles/tokens.css`, `website/src/styles/global.css`, `website/src/styles/brand.css`, and `website/src/styles/commercial.css`.
- **Components & Media**:
  - Creates `website/src/components/media/ThemeImage.astro`.
  - Updates `website/src/components/home/HomeDeviceCollage.astro` and other image-bearing components.
- **Capture Scripts & Assets**:
  - Updates `scripts/marketing/capture-screenshots.mjs` to support dark theme captures.
  - Adds dark screenshot assets to `website/public/images/product/` and `website/public/images/showcase/v2/`.
  - Updates `website/scripts/check-assets.mjs` to validate dark image variants.
