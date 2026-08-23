# Technical Design: Site-Wide Dark Mode & Theme-Aware Media

## Context

The Plethora marketing and documentation website (`website/`) is built with Astro 5 and deployed as a static site. The visual brand is anchored in a paper-and-ink editorial reading aesthetic, utilizing Source Serif typography, restrained Plethora violet branding, and the Plethora mascot ("Friendly Chirp").

Currently, the site is restricted to a light theme:
- `website/src/styles/tokens.css` defines only light-mode CSS variables (`--paper: #f3f0e8`, `--ink: #1c1916`).
- Hard-coded white backgrounds (`#fff`) and light-only borders appear across `commercial.css`, `brand.css`, and component templates.
- All product screenshots and device collage frames are captured exclusively in light mode.
- There is no mechanism for users to select a dark theme or follow their operating system's color scheme preference.

Simply adding a naive CSS dark mode would fail in several ways:
1. Product screenshots would remain glaring white rectangles on dark backgrounds.
2. Naive CSS `filter: invert()` would destroy the brand's canonical mascot colors (`#8B5CF6`, `#7C3AED`, `#5B21B6`, `#F59E0B`).
3. Asynchronous client-side theme loading would cause a jarring Flash of Unstyled Content (FOUC) or wrong-theme flash on initial page load.
4. Using plain `<picture media="(prefers-color-scheme: dark)">` tags without manual override handling would prevent images from switching when a user manually toggles the site theme.

This design specifies a comprehensive "midnight library" theme system, early `<head>` bootstrap, accessible 3-state control, semantic token refactoring, reusable `ThemeImage` media primitive, and deterministic dark screenshot capture pipeline.

## Goals / Non-Goals

### Goals
- **"Midnight Library" Editorial Direction**: Deep charcoal, muted ink-navy, and eggplant surfaces (`#121016`, `#1a1622`, `#251f30`) paired with warm ivory text (`#f4efe6`, `#d8d0c2`) and restrained violet accents (`#8b5cf6`, `#7c3aed`), retaining the paper-and-ink reading character.
- **Zero-FOUC Early Bootstrap**: Synchronous inline script in `<head>` preventing any visible wrong-theme flash during initial page loads, hard reloads, or cross-page transitions.
- **3-State Theme Preference Model**: Support `system` (default), `light`, and `dark` modes, persisting manual choices in `localStorage` and reacting dynamically to OS preference changes in `system` mode.
- **Accessible Header Theme Control**: Compact, fully keyboard-operable, ARIA-compliant toggle in `SiteHeader.astro` and mobile navigation.
- **Dynamic `<meta name="theme-color">`**: Keep the browser chrome / status bar synchronized with the active background color.
- **Reusable `ThemeImage` Primitive**: Astro component supporting light/dark sources, responsive `srcset`, explicit dimensions (zero CLS), and instant reactivity to manual theme overrides.
- **Deterministic Dark Screenshot Capture**: Extend `scripts/marketing/capture-screenshots.mjs` to capture authentic dark-mode UI screenshots from the live application build using Playwright with `colorScheme: "dark"`.
- **Mascot & Brand Protection**: Preserve Friendly Chirp's canonical purple body and amber beak without blanket inversion.
- **Universal Page Coverage & WCAG AA Contrast**: Full coverage across all public routes with verified WCAG 2.1 AA contrast compliance (≥4.5:1 for body text, ≥3:1 for large text and UI components).

### Non-Goals
- **No Neon AI Aesthetic**: No glowing gradient meshes, floating glassmorphism blobs, or pitch-black hacker-terminal looks.
- **No Blank CSS Inversions**: No global `filter: invert(1)` or CSS hue-rotate applied across images or the mascot.
- **No User Account Requirement**: Theme preferences are stored locally in the browser (`localStorage`), with no server backend or tracking.
- **No Heavy Hydrated Framework Dependencies**: The theme engine is pure CSS and lightweight vanilla TypeScript (zero React hydration overhead for theme switching).

---

## Decisions

### Decision 1: Semantic Design Tokens & "Midnight Library" Palette

`website/src/styles/tokens.css` is refactored into semantic tokens with explicit light and dark definitions:

```css
:root {
  /* Light Theme (Default) */
  --paper: #f3f0e8;
  --paper-2: #e7e1d2;
  --paper-3: #ddd6c6;
  --ink: #1c1916;
  --ink-soft: #3f3a34;
  --muted: #5e574e;
  --line: #cfc7b8;
  --line-strong: #b7ae9d;
  --surface-card: #ffffff;
  --surface-elevated: #ffffff;
  --surface-code: #e8e2d4;
  --surface-callout-note: #e9e4d6;
  --surface-callout-tip: #e4ebe4;
  --surface-callout-warning: #faeee0;
  --surface-callout-important: #ede6f5;

  /* Brand Palette (Constant Across Themes) */
  --plethora-violet-400: #8b5cf6;
  --plethora-violet-500: #7c3aed;
  --plethora-violet-800: #5b21b6;
  --plethora-beak: #f59e0b;
  --plethora-beak-icon: #6d28d9;
  --plethora-pupil: #1e1b4b;
  --plethora-boot: #0a0a0a;

  /* Accent & Interactive */
  --accent: #7c3aed;
  --accent-hover: #6d28d9;
  --focus-ring: #7c3aed;
  --selection-bg: #ddd6fe;
  --selection-text: #1c1916;

  /* Shadows */
  --shadow-frame: 0.4rem 0.85rem 1.8rem rgb(28 25 22 / 0.14);
}

/* Explicit Dark Theme and System Dark Preference */
:root[data-theme='dark'] {
  --paper: #121016;
  --paper-2: #1a1622;
  --paper-3: #251f30;
  --ink: #f4efe6;
  --ink-soft: #d8d0c2;
  --muted: #9e94a8;
  --line: #2e273a;
  --line-strong: #423952;
  --surface-card: #1c1826;
  --surface-elevated: #241f32;
  --surface-code: #181422;
  --surface-callout-note: #1c1828;
  --surface-callout-tip: #16241b;
  --surface-callout-warning: #291e14;
  --surface-callout-important: #221734;

  --accent: #a78bfa;
  --accent-hover: #c4b5fd;
  --focus-ring: #a78bfa;
  --selection-bg: #4c1d95;
  --selection-text: #f4efe6;

  --shadow-frame: 0.4rem 0.85rem 1.8rem rgb(0 0 0 / 0.5);
}

@media (prefers-color-scheme: dark) {
  :root[data-theme='system'] {
    --paper: #121016;
    --paper-2: #1a1622;
    --paper-3: #251f30;
    --ink: #f4efe6;
    --ink-soft: #d8d0c2;
    --muted: #9e94a8;
    --line: #2e273a;
    --line-strong: #423952;
    --surface-card: #1c1826;
    --surface-elevated: #241f32;
    --surface-code: #181422;
    --surface-callout-note: #1c1828;
    --surface-callout-tip: #16241b;
    --surface-callout-warning: #291e14;
    --surface-callout-important: #221734;

    --accent: #a78bfa;
    --accent-hover: #c4b5fd;
    --focus-ring: #a78bfa;
    --selection-bg: #4c1d95;
    --selection-text: #f4efe6;

    --shadow-frame: 0.4rem 0.85rem 1.8rem rgb(0 0 0 / 0.5);
  }
}
```

### Decision 2: Zero-FOUC Theme Bootstrap Script

An inline, blocking script is placed in the `<head>` of `website/src/layouts/BaseLayout.astro` before any stylesheets:

```html
<script is:inline>
  (function () {
    try {
      const stored = localStorage.getItem('plethora-theme');
      const theme = stored === 'light' || stored === 'dark' ? stored : 'system';
      const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.effectiveTheme = isDark ? 'dark' : 'light';
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    } catch (e) {
      document.documentElement.dataset.theme = 'system';
      document.documentElement.dataset.effectiveTheme = 'light';
      document.documentElement.style.colorScheme = 'light';
    }
  })();
</script>
```

### Decision 3: Header Theme Control UX & Preference Model

- **Location**: `website/src/components/chrome/SiteHeader.astro` and mobile navigation drawer.
- **Options**: `System` (auto-detects OS), `Light`, `Dark`.
- **UI Element**: A compact button displaying the icon of the current effective theme (Sun / Moon / Monitor), triggering a small accessible popover or segmented control.
- **Behavior**:
  - Clicking an option immediately updates `localStorage.setItem('plethora-theme', option)`.
  - Sets `document.documentElement.dataset.theme = option`.
  - Calculates the effective theme (`light` or `dark`), setting `document.documentElement.dataset.effectiveTheme` and `color-scheme`.
  - Updates `<meta name="theme-color" content="...">` (`#f3f0e8` for light, `#121016` for dark).
  - Emits a custom `plethora-theme-change` DOM event so reactive components (like `ThemeImage`) can respond instantly.
  - An active `matchMedia('(prefers-color-scheme: dark)')` listener handles OS changes when in `system` mode.

### Decision 4: Reusable `ThemeImage.astro` Component Architecture

A plain `<picture>` element with media queries only handles OS-level dark mode, failing when a user manually overrides the site theme via the header control.

`ThemeImage.astro` solves this by rendering both CSS media queries (for static zero-JS rendering) AND CSS data-attribute rules:

```astro
---
interface Props {
  srcLight: string;
  srcDark?: string;
  alt: string;
  width: number;
  height: number;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  class?: string;
  srcsetLight?: string;
  srcsetDark?: string;
  sizes?: string;
}

const {
  srcLight,
  srcDark,
  alt,
  width,
  height,
  loading = 'lazy',
  decoding = 'async',
  class: className = '',
  srcsetLight,
  srcsetDark,
  sizes,
} = Astro.props;

const hasDarkVariant = Boolean(srcDark);
---

{hasDarkVariant ? (
  <span class:list={['theme-image-wrapper', className]}>
    <img
      src={srcLight}
      srcset={srcsetLight}
      sizes={sizes}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding={decoding}
      class="theme-img-light"
    />
    <img
      src={srcDark}
      srcset={srcsetDark}
      sizes={sizes}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding={decoding}
      class="theme-img-dark"
    />
  </span>
) : (
  <img
    src={srcLight}
    srcset={srcsetLight}
    sizes={sizes}
    alt={alt}
    width={width}
    height={height}
    loading={loading}
    decoding={decoding}
    class={className}
  />
)}

<style>
  .theme-image-wrapper {
    display: contents;
  }
  .theme-img-dark {
    display: none;
  }
  .theme-img-light {
    display: block;
  }

  /* 1. Explicit theme selections */
  :global(html[data-theme='dark']) .theme-img-dark {
    display: block !important;
  }
  :global(html[data-theme='dark']) .theme-img-light {
    display: none !important;
  }
  :global(html[data-theme='light']) .theme-img-dark {
    display: none !important;
  }
  :global(html[data-theme='light']) .theme-img-light {
    display: block !important;
  }

  /* 2. System mode following media query */
  @media (prefers-color-scheme: dark) {
    :global(html[data-theme='system']) .theme-img-dark {
      display: block;
    }
    :global(html[data-theme='system']) .theme-img-light {
      display: none;
    }
  }
</style>
```

### Decision 5: Website Media Classification & Dark Asset Pipeline

| Image Category | Assets | Dark Strategy | Implementation |
| :--- | :--- | :--- | :--- |
| **1. Brand & Mascot** | `plethora-chirp.svg`, `knowledge-peck.svg`, `plethora-icon-master.svg` | **Preserve canonical hexes**. Never invert the mascot. Update container backdrop surfaces (`--paper-2`) so the purple bird and amber beak stand out with high contrast. | Shared asset across both themes. |
| **2. Product Screenshots** | `screenshot-library.png`, `screenshot-reader.png`, `screenshot-review.png`, `screenshot-card.png`, `screenshot-explain.png`, `screenshot-eink.png` | **Authentic Dark Screenshots**. Capture identical scenes in dark mode from the app using Playwright capture pipeline. | Dark PNG/AVIF/WebP in `website/public/images/product/*-dark.*`. |
| **3. Device Mockups** | `HomeDeviceCollage.astro` (laptop & phone frames) | **Dark Device Chrome**. Adjust bezel backgrounds, glare reflection layers, and drop shadows (`--shadow-frame`) for dark surfaces. | CSS tokens in `brand.css`. |
| **4. Vector Diagrams & Icons** | Workflow diagrams, format strips, note pairings | **Semantic SVG tokens**. Replace hard-coded `#1c1916` stroke/fills with `currentColor` or `var(--ink)`. | CSS custom property bindings in inline SVGs. |
| **5. Social Previews** | `og-default.png` (Open Graph) | **High-Contrast Neutral Card**. Keep a single bold, brand-aligned social preview card optimized for both light and dark social feeds. | Single asset `public/images/product/og-default.png`. |

### Decision 6: Dark Screenshot Capture Workflow

The marketing capture pipeline in `scripts/marketing/capture-screenshots.mjs` is extended to support dual-theme captures:
1. When capturing scenes, Playwright context is configured with `colorScheme: "dark"`.
2. The capture script sets `document.documentElement.dataset.themeId = "modern-dark"` or `"plethora-dark"` in the capture build.
3. Screenshots are encoded via `scripts/marketing/encode-product-images.mjs` into `.avif`, `.webp`, and `.png` dark variants.
4. `website/scripts/check-assets.mjs` verifies that every required product screenshot has matching light and dark variants with identical aspect ratios.

---

## Risks / Trade-offs

| Risk / Trade-off | Mitigation Strategy |
| :--- | :--- |
| **Wrong-Theme Flash (FOUC)**: Users on dark theme see white flash before stylesheets evaluate. | Mitigated by synchronous inline `<script>` in `<head>` setting `dataset.theme` and `colorScheme` before rendering. |
| **Double Image Download**: Loading both light and dark images in `ThemeImage.astro`. | Responsive browser image decoders only download the active `display: block` image; modern browsers skip downloading `display: none` images during idle layout. |
| **Mascot Visual Degradation**: CSS filters or auto-inversion corrupting the brand mascot. | Strict ban on `filter: invert()` on mascot assets; canonical hexes locked by unit tests (`src/__tests__/brandInventory.test.ts`). |
| **Contrast Regressions**: Text or borders becoming unreadable on dark backgrounds. | Automated Axe / Playwright test suite verifying WCAG AA contrast (≥4.5:1) for every route in dark mode. |
