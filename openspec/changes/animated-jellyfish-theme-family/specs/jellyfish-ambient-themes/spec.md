## ADDED Requirements

### Requirement: Jellyfish theme family registration

The system SHALL register four built-in dark themes with ids `deep-ocean-glow`, `bioluminescent-flow`, `deep-sea-neon`, and `abyssal-dream`, each with `effects.backgroundAnimation` equal to `jellyfish` and distinct `effects.ambientPaletteId` matching the theme id.

#### Scenario: Theme picker lists all four variants
- **WHEN** the user opens the theme picker and filters by Animated
- **THEN** all four jellyfish themes appear with animated badge

#### Scenario: Theme selection persists
- **WHEN** the user selects `deep-sea-neon` and reloads the app
- **THEN** `plethora-last-theme` stores `deep-sea-neon` and the theme applies on startup

### Requirement: Shared jellyfish renderer

The system SHALL render jellyfish ambient backgrounds through a single `jellyfish` entry in the ThemeBackdrop animation registry, with colors supplied by `JELLYFISH_PALETTES` keyed by `ambientPaletteId`.

#### Scenario: Palette drives glow colors
- **WHEN** `bioluminescent-flow` is active
- **THEN** the canvas renderer uses the teal/aqua palette from `JELLYFISH_PALETTES['bioluminescent-flow']` not hardcoded hex in the renderer

#### Scenario: Theme switch destroys prior loop
- **WHEN** the user switches from `deep-ocean-glow` to `snow`
- **THEN** the jellyfish RAF loop is cancelled and no second loop remains active

### Requirement: Reduced motion static fallback

When `prefers-reduced-motion: reduce` is active OR `interface.animationsEnabled` is false, the system SHALL render a static underwater frame (gradient, jellyfish, glow, sparse particles) without continuous motion.

#### Scenario: OS reduced motion
- **WHEN** `prefers-reduced-motion: reduce` matches
- **THEN** no RAF loop runs but a static jellyfish scene is visible behind translucent chrome

#### Scenario: User disables animated backdrop
- **WHEN** the user toggles off Enable animated themes in Settings
- **THEN** the static jellyfish frame is shown for jellyfish themes

### Requirement: Reader legibility

Jellyfish themes SHALL apply tiered surface opacity via `customCSS` such that long-form reading surfaces and popovers remain highly opaque with WCAG-compliant contrast.

#### Scenario: Reader surface opacity
- **WHEN** a jellyfish theme is active in the HTML reader harness
- **THEN** reader tokens pass contrast tests and reading pane backgrounds are not fully transparent

### Requirement: Performance gates inherited

The jellyfish renderer SHALL respect existing ThemeBackdrop gates: 30fps cap, visibility/focus pause, battery density halving, e-ink CSS hide, and `plethora-theme-backdrop-suspend`.

#### Scenario: Hidden tab
- **WHEN** the document becomes hidden
- **THEN** the jellyfish RAF loop stops until visible again
