## MODIFIED Requirements

### Requirement: Theme selection consumes dramatically less vertical space
The system SHALL replace the flat full-grid of all built-in themes in the Appearance settings with a compact theme-selection control that occupies substantially less default vertical space than the current grid (≈43 rows of 172 themes on desktop) while preserving access to every theme.

#### Scenario: Default vertical footprint is compact
- **WHEN** a user opens Appearance settings on desktop with a default viewport
- **THEN** the theme control SHALL occupy no more than the height of a compact row or small panel (e.g. a combobox/popover or a short list of preview swatches), and the full theme list SHALL be reachable without scrolling a long inline list

#### Scenario: All themes remain reachable
- **WHEN** the user expands/searches the compact control
- **THEN** all built-in themes (including legacy themes and custom themes) SHALL remain selectable

### Requirement: The active theme is clearly exposed and themes are findable
The control SHALL clearly indicate the currently active theme (name + preview swatch) and SHALL support finding a known theme quickly (search by name, filter by light/dark variant and animated badge).

#### Scenario: Active theme identified
- **WHEN** the user opens the theme control
- **THEN** the currently active theme SHALL be displayed with its name and a preview swatch, and the selected state SHALL be visually distinct

#### Scenario: Search finds a theme
- **WHEN** the user types a theme name (or partial) into the control's search field
- **THEN** matching themes SHALL be shown and selectable, and a selection SHALL activate the theme

### Requirement: Instant/near-instant preview is preserved
Theme preview SHALL be near-instant as in current Plethora behavior. Hovering or keyboard-focusing a theme option SHALL live-apply the theme (fixing the current stubbed `handlePreviewTheme` in `ThemePicker.tsx`), show a "Previewing: <name>" notice, and require an explicit click/Enter (or the existing "Click to apply" affordance) to commit.

#### Scenario: Hover previews then commit on click
- **WHEN** the user hovers/focuses a non-active theme option
- **THEN** the theme SHALL be applied immediately as a preview with a visible "Previewing" notice, and the selection SHALL be committed when the user clicks (or presses Enter) the option

#### Scenario: Preview respects performance
- **WHEN** the theme control renders its list of options
- **THEN** preview cards/swatches SHALL be lightweight (swatches, not full heavyweight card renders for hundreds of items), and SHALL NOT cause jank when scrolling the option list

### Requirement: The control is usable on mobile and desktop
The theme control SHALL be touch-friendly on narrow mobile screens and keyboard/mouse friendly on desktop, with adequate touch targets and standard keyboard interaction (Tab focus, Enter/Space to select, Escape to close a popover).

#### Scenario: Narrow mobile screen
- **WHEN** the theme control is rendered on a viewport narrower than 480 px
- **THEN** the control SHALL remain fully usable (searchable, scrollable option list with touch targets ≥ 44 px), and SHALL NOT overflow the viewport horizontally

#### Scenario: Desktop keyboard access
- **WHEN** a keyboard user tabs to the theme control
- **THEN** the user SHALL be able to open it, search, arrow through options, and select with Enter/Space without a mouse