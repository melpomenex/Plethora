## Purpose

Defines first-run and returning-visitor theming, dark-mode visual hierarchy, and site chrome (header navigation, theme control, sticky behavior, button/control language) for the Plethora marketing website.

## ADDED Requirements

### Requirement: First visit defaults to the light editorial theme
The marketing site SHALL render the light editorial theme on a visitor's first visit when no stored theme preference exists, regardless of the operating system color-scheme preference.

#### Scenario: Dark-mode OS, no stored preference
- **WHEN** a visitor with an OS-level dark preference loads any marketing page for the first time
- **THEN** the page renders in the light paper-and-ink theme (no unstyled flash in the opposite direction)

#### Scenario: Light-mode OS, no stored preference
- **WHEN** a visitor with an OS-level light preference loads any marketing page for the first time
- **THEN** the page renders in the light theme

### Requirement: Stored theme preferences are respected
A stored explicit choice of `light`, `dark`, or `system` SHALL continue to control rendering exactly as before this change; the change alters only the default applied when nothing is stored.

#### Scenario: Returning visitor who chose Auto
- **WHEN** a visitor with `plethora-theme=system` stored loads the site under a dark OS preference
- **THEN** the dark theme renders

#### Scenario: Returning visitor who chose Dark or Light explicitly
- **WHEN** a returning visitor's stored value is `dark` or `light`
- **THEN** that exact theme renders with no flash of the other theme before paint

### Requirement: Theme selection UI stays available and compact
The header SHALL continue to offer Light, Auto/System, and Dark selection with the active choice visibly indicated, fully keyboard operable with visible focus, and presented more compactly than the current always-visible three-label group; the control MUST NOT exceed 44px in height.

#### Scenario: Keyboard user switches themes
- **WHEN** a keyboard user focuses the theme control and selects Dark
- **THEN** the dark theme applies immediately, the stored preference updates, and focus remains visible within the control

### Requirement: Dark mode is a first-class hierarchical theme
Dark mode SHALL distinguish page background, elevated bands, cards, and product-frame surroundings through clearly distinct neutral surface values and depth cues so that light-theme product screenshots read as the brightest focal elements; it SHALL NOT introduce neon accents or violet washes outside the canonical mascot/accents palette.

#### Scenario: Dark homepage band separation
- **WHEN** the homepage renders in dark mode
- **THEN** adjacent large editorial bands are visually separable background steps, and each real product screenshot frame is outlined by a subtle hairline treatment

#### Scenario: Canonical palette unchanged
- **WHEN** either theme renders
- **THEN** the canonical mascot violet/beak/pupil hex values remain identical to the brand inventory

### Requirement: Header presents product-style hierarchy
The primary desktop header SHALL expose a reduced link set of product-facing routes plus one distinct download/get call-to-action, with secondary routes reachable from the footer; the theme control SHALL sit apart from the primary links.

#### Scenario: Desktop header composition
- **WHEN** the site header renders at ≥1024px viewport width
- **THEN** primary links number fewer than six, a visually distinct get/download action is present, and the Downloads route link is not duplicated among the primary text links

### Requirement: Subtly stuck header after the hero
The header MAY remain in view after scrolling past the hero and SHALL, when stuck, present a restrained treatment — near-solid page background, strengthened hairline border, small shadow — without floating capsule styling, heavy blur glassmorphism, or layout shift for content below it.

#### Scenario: Scrolled state
- **WHEN** the user scrolls beyond the hero section
- **THEN** the header gains its stuck background/border/shadow treatment while page content does not shift vertically by more than 1px

#### Scenario: Reduced transparency preference
- **WHEN** the OS requests reduced transparency
- **THEN** the stuck header uses a solid background instead of translucency/blur

### Requirement: Refined control language without generic rounding
Primary interactive controls (buttons, tabs, inputs) SHALL use a moderate radius of approximately 6–8px with defined hover and pressed states; editorial cards and section panels SHALL retain their restrained square-ish default radius; pill-shaped controls SHALL NOT be introduced site-wide.

#### Scenario: Button states
- **WHEN** a visitor hovers and presses the primary call-to-action
- **THEN** distinct hover and pressed visual states appear, and the pressed state includes a vertical displacement cue

#### Scenario: Card radius restraint
- **WHEN** content cards and editorial panels render
- **THEN** they do not adopt the interactive-control radius treatment

### Requirement: Primary-action violet emphasis is restrained
Plethora violet MAY emphasize at most the hero's primary call-to-action as the accent use case on the homepage body; violet SHALL NOT spread across all buttons, badges, or section chrome, preserving the "violet is the mark, not the wallpaper" identity.

#### Scenario: Violet distribution on homepage
- **WHEN** the homepage renders in either theme
- **THEN** violet-filled interactive controls are limited to designated primary moments (hero and equivalent close CTA), and remaining controls stay ink/neutral
