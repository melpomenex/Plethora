## Purpose

Defines Plethora's semantic design-token layer: the complete Material 3 color role set plus shape, typography, elevation, state-layer, motion, spacing, and z-index scales, projected from every existing theme so application chrome can be built without hardcoded visual values.

## ADDED Requirements

### Requirement: Full Material 3 color role set

The theme application layer SHALL emit CSS custom properties for the complete Material 3 semantic color role set on the document root for every theme (built-in, custom, and animated): `primary`, `on-primary`, `primary-container`, `on-primary-container`, `secondary`, `on-secondary`, `secondary-container`, `on-secondary-container`, `tertiary`, `on-tertiary`, `tertiary-container`, `on-tertiary-container`, `error`, `on-error`, `error-container`, `on-error-container`, `surface`, `on-surface`, `on-surface-variant`, `surface-dim`, `surface-bright`, `surface-container-lowest`, `surface-container-low`, `surface-container`, `surface-container-high`, `surface-container-highest`, `outline`, `outline-variant`, `inverse-surface`, `on-inverse-surface`, `inverse-primary`, and `scrim`. Existing shadcn-style aliases (`--color-foreground`, `--color-muted`, `--color-card`, `--color-popover`, `--color-border`, `--color-destructive`) SHALL continue to be emitted unchanged so unmigrated components keep rendering correctly.

#### Scenario: Roles available for any built-in theme

- **WHEN** any built-in theme is applied and an element references `var(--color-surface-container-high)` and `var(--color-on-primary-container)`
- **THEN** both properties resolve to opaque colors and the element renders without falling back to inherited or initial colors

#### Scenario: Legacy aliases survive

- **WHEN** a not-yet-migrated component uses `bg-card`, `text-muted-foreground`, or `border-border` utilities
- **THEN** rendering is identical to before this change for every theme

### Requirement: Automatic role derivation from existing themes

Themes that do not define the new roles explicitly SHALL have them derived automatically from their existing color fields (background, surface, surfaceVariant, primary, secondary, error, outline, text tiers) using perceptual (OKLCH-based) color mathematics. Derived roles SHALL preserve the theme's hue identity and SHALL meet or exceed the contrast pairing of their `on-*` counterpart wherever the source theme did.

#### Scenario: Legacy catalog theme gains container roles

- **WHEN** a legacy-generated theme that only defines `bg0..bg4`, `text`, `border` fields is applied
- **THEN** the container hierarchy (`surface-container-lowest` through `surface-container-highest`) resolves to monotonically ordered tones of that theme's background family, ordered correctly for the theme's light/dark variant

#### Scenario: Dark themes keep dark containers

- **WHEN** a dark-variant theme is applied
- **THEN** `surface-container-highest` is lighter than `surface-container-lowest`, and both remain dark enough that `on-surface` text on them meets the same pass/fail WCAG result it had on the theme's original `surface`

### Requirement: Shape scale

The token layer SHALL define a Material-style shape scale (`none`, `extra-small`, `small`, `medium`, `large`, `extra-large`, `full`) as radius custom properties mapped onto the existing `--radius-*` names that Tailwind utilities consume. Themes SHALL be able to override shape values, and novelty themes that demand zero radius (e.g. Windows 95) SHALL keep that override working.

#### Scenario: Shape utilities resolve per theme

- **WHEN** a component uses `rounded-lg` (medium) and `rounded-xl` (large)
- **THEN** both resolve through the theme's radius tokens, and for the `windows-95` theme all radii resolve to zero

### Requirement: State layers

The token layer SHALL provide a standard interactive state-layer mechanism (hover, focus, pressed, selected, dragged, disabled) implemented as `color-mix` overlays of the component's `on-*` color at Material-specified opacities, exposed as utility classes or CSS variables usable by any primitive. Disabled state SHALL reduce opacity and remove pointer events. Focus SHALL be visibly indicated on all interactive primitives via a focus ring token.

#### Scenario: Hover state layer

- **WHEN** a pointer hovers an enabled state-layer-equipped control on a desktop presentation
- **THEN** an overlay of the control's content color at approximately 8% opacity becomes visible above the control's base fill

#### Scenario: Keyboard focus is visible

- **WHEN** an interactive primitive receives keyboard focus
- **THEN** a visible focus indicator appears whose color adapts to the underlying surface for every theme, including dark themes

#### Scenario: Reduced motion does not disable state layers

- **WHEN** the user prefers reduced motion
- **THEN** state layers still apply instantly (without transition), while motion tokens animate nothing

### Requirement: Motion tokens

The token layer SHALL define duration and easing tokens (`--md-duration-short/medium/long`, `--md-easing-standard/emphasized/decelerated/accelerated` and functional aliases for enter/exit) that components use instead of arbitrary `duration-*` values. All motion SHALL be disabled (instant) when the user prefers reduced motion or when animations are disabled in settings.

#### Scenario: Reduced motion collapses durations

- **WHEN** `prefers-reduced-motion: reduce` is active or `interface.animationsEnabled` is false
- **THEN** transitions driven by motion tokens complete instantly

### Requirement: Elevation model

The token layer SHALL define an elevation model that expresses raised surfaces primarily through tonal surface-container steps, with shadow tokens reserved for floating layers (menus, dialogs, floating controls). The existing E-Ink display mode SHALL flatten both tonal and shadow elevation to bordered flat surfaces as it does today.

#### Scenario: Dialog elevation on E-Ink

- **WHEN** E-Ink mode is active and a dialog opens
- **THEN** the dialog renders with a solid background, a 1px high-contrast border, and no shadow or blur

### Requirement: Typography roles

The token layer SHALL define semantic typography roles (display, headline, title, body, label — large/medium/small where applicable) as CSS variables layered over the existing font-family/size theme settings. Document/reading typography (`--reading-*`, reader font settings, EPUB/PDF content) SHALL NOT be governed by these chrome roles.

#### Scenario: Reading typography unaffected

- **WHEN** a user changes the application type-scale tokens via theme
- **THEN** reader document content typography (font family, size, line height inside the document viewport) remains controlled exclusively by the existing reader typography settings

### Requirement: Seed-based palette generation

The theme system SHALL support generating a complete Material semantic scheme (all roles, light and dark variants) from a single seed color, using the repository's existing OKLCH color mathematics, so users and themes can define palettes by seed. This generation SHALL run client-side with no new dependencies.

#### Scenario: Seed produces full scheme

- **WHEN** a seed color is provided to the palette generator
- **THEN** it returns light and dark schemes covering every required role, and each scheme's `on-*`/container pairing passes WCAG AA contrast for body-text roles

### Requirement: E-Ink projection

When E-Ink display mode is active, the full role set SHALL be projected to high-contrast monochrome equivalents (as the current E-Ink layer does for existing tokens), animations SHALL be suppressed, translucency and blur SHALL be eliminated, and state indication SHALL not rely on color alone.

#### Scenario: All roles go monochrome

- **WHEN** E-Ink mode activates
- **THEN** every Material role, including newly added container and tertiary roles, resolves to a black/white/gray value consistent with the existing E-Ink token overrides
