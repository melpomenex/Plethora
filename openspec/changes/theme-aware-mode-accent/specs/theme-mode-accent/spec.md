## Purpose
Defines a reusable, theme-aware semantic "mode accent" — a color role for controls that
represent a special application mode — including how every theme resolves to valid,
distinct, contrast-safe mode-accent values and how those values reach the UI.

## ADDED Requirements

### Requirement: Semantic Mode Accent Resolution
The system SHALL resolve a mode accent color and a mode accent foreground color for every
applied theme, whether or not the theme declares an explicit mode accent, and SHALL expose
the resolved values as CSS custom properties (`--color-mode-accent`,
`--color-mode-accent-foreground`) on the document root whenever a theme is applied.

#### Scenario: Theme declares an explicit mode accent
- **WHEN** a theme defines an explicit mode accent color
- **THEN** the resolved mode accent preserves that hue intent while still satisfying the
  contrast requirements of this capability

#### Scenario: Theme has no explicit mode accent
- **WHEN** a theme (built-in, legacy, or custom) does not define a mode accent
- **THEN** the system derives one deterministically from that theme's own palette without
  requiring any change to the theme definition

#### Scenario: Theme colors are unparseable
- **WHEN** a theme's colors cannot be parsed (e.g., a corrupt custom theme)
- **THEN** the mode accent resolves to the global default values and the CSS custom
  properties are never undefined

### Requirement: Deterministic Resolution
Mode accent resolution SHALL be a pure function of the theme: the same theme SHALL
produce the same mode accent values on every application, preview, launch, and restart.

#### Scenario: Repeated resolution is stable
- **WHEN** the same theme is applied multiple times across sessions
- **THEN** the resolved mode accent values are identical each time

### Requirement: Distinctness From The Primary Accent
The resolved mode accent SHALL be perceptually distinct from the theme's primary accent —
at least 60 degrees of perceptual hue separation — whenever the theme's palette contains
sufficient chroma to express it.

#### Scenario: Colorful theme
- **WHEN** a theme with a chromatic palette is resolved
- **THEN** the mode accent differs from the primary accent by at least 60 degrees of
  perceptual hue separation

#### Scenario: Monochrome theme
- **WHEN** a theme's palette is effectively monochrome (all candidate colors below a
  minimal chroma threshold)
- **THEN** the mode accent takes a neutral high-contrast path (the theme's own
  foreground-level color) instead of inventing a hue, and prominence is carried by the
  border/tint treatment rather than hue

### Requirement: Contrast Guarantees
The resolved mode accent SHALL satisfy: at least 3:1 contrast against the surface it is
displayed over, at least 3:1 against its own low-opacity tinted background as rendered on
that surface, and the mode accent foreground SHALL have at least 4.5:1 contrast against
the solid mode accent.

#### Scenario: Dark and light themes
- **WHEN** themes of either variant are resolved
- **THEN** the mode accent is light enough to read on dark surfaces or dark enough to
  read on light surfaces, meeting the contrast minimums in both variants

### Requirement: Theme Switching Reactivity
Changing, previewing, or persisting a theme SHALL update the mode accent values
immediately without reload, including while a control consuming the mode accent is
visible.

#### Scenario: Theme switched while Scroll Mode tab is open
- **WHEN** the user switches themes while a Scroll Mode tab is open
- **THEN** mode-accent styling across the app reflects the new theme immediately

#### Scenario: Restart with a persisted theme
- **WHEN** the application restarts with a persisted theme selection
- **THEN** the mode accent is resolved from the persisted theme before interaction

### Requirement: Custom And Legacy Theme Compatibility
Existing custom and legacy themes SHALL continue to work unchanged: absence of the new
optional theme field MUST NOT break theme loading, import, export, or application, and no
user migration step is required.

#### Scenario: Custom theme imported before the change
- **WHEN** a user-imported custom theme that lacks the mode accent field is applied
- **THEN** it loads normally and receives a derived mode accent

#### Scenario: Theme export round-trip
- **WHEN** a theme that declares an explicit mode accent is exported and re-imported
- **THEN** the explicit value survives the round trip

### Requirement: Catalog-Wide Validity
Every built-in theme SHALL resolve to mode accent values that are parseable colors
satisfying the distinctness and contrast requirements of this capability.

#### Scenario: Full catalog gate
- **WHEN** resolution is run across all built-in themes (modern and legacy)
- **THEN** each theme yields valid values meeting the distinctness and contrast rules,
  either via hue separation or the monochrome neutral path
