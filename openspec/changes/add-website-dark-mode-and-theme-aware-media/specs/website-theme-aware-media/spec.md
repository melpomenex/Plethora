## ADDED Requirements

### Requirement: Reusable `ThemeImage` Media Primitive
The website component library SHALL provide a reusable Astro component `ThemeImage.astro` that accepts light and dark image sources (`srcLight`, `srcDark`), responsive `srcset` definitions, explicit `width` and `height` dimensions, and alternative text, switching the visible image immediately upon manual site theme selection without requiring page reload.

#### Scenario: Image rendering under manual theme override
- **WHEN** a user on `html[data-theme='dark']` views a page containing a `<ThemeImage srcLight="img.png" srcDark="img-dark.png" />`
- **THEN** only the dark image variant is displayed and visible, with no double download penalty or layout shift.

#### Scenario: Image rendering under system preference mode
- **WHEN** user preference is `system` and the browser color scheme is dark
- **THEN** the CSS media query rules inside `ThemeImage` display the dark variant automatically.

#### Scenario: Fallback when dark variant is not provided
- **WHEN** `<ThemeImage srcLight="diagram.png" />` is rendered without a `srcDark` prop
- **THEN** the component renders the standard light image source cleanly without errors or broken image placeholders.

### Requirement: Authentic Dark Screenshot Capture Pipeline
The repository's marketing screenshot capture pipeline (`scripts/marketing/capture-screenshots.mjs`) SHALL support capturing authentic, pixel-accurate dark-theme screenshots of all required application scenes (`library`, `reader`, `review`, `card`, `explain`, `eink`) using Playwright with `colorScheme: "dark"` and dark theme mode.

#### Scenario: Dark screenshot capture execution
- **WHEN** `node scripts/marketing/capture-screenshots.mjs` executes with dark mode configuration
- **THEN** the Playwright capture suite launches with `colorScheme: "dark"`, waits for the application readiness signal in dark mode, and saves authentic dark screenshots with provenance metadata in `marketing/screenshots/source/showcase-v2/`.

### Requirement: Brand & Mascot Asset Integrity Protection
Brand marks and mascot assets (`plethora-chirp.svg`, `knowledge-peck.svg`, `plethora-icon-master.svg`) SHALL retain their canonical violet (`#8B5CF6`, `#7C3AED`, `#5B21B6`) and amber (`#F59E0B`) color definitions across both light and dark themes, with surrounding container surfaces adapting rather than applying destructive CSS color inversion filters.

#### Scenario: Mascot rendering in dark mode
- **WHEN** Friendly Chirp or Knowledge Peck is rendered on a dark theme surface
- **THEN** the mascot SVG displays its canonical purple body and amber beak with no `filter: invert()` applied.

### Requirement: Theme-Aware Image Asset Verification
The website asset validation suite (`website/scripts/check-assets.mjs`) SHALL verify that every product screenshot and showcase asset registered in the asset manifest contains matching, valid light and dark image files with identical intrinsic aspect ratios.

#### Scenario: Asset integrity check
- **WHEN** `npm run website:check` or `node website/scripts/check-assets.mjs` runs
- **THEN** any missing dark screenshot variant or aspect ratio mismatch between light and dark variants causes the check to fail with a descriptive error.
