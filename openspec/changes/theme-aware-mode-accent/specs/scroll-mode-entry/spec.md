## Purpose
Governs the appearance of the Scroll Mode launcher controls (desktop and mobile reading
queue): a prominent, theme-harmonious enabled state driven by the semantic mode accent,
an ordinary disabled state, and a prominence cue that does not depend on color perception.

## ADDED Requirements

### Requirement: Prominent State Uses The Mode Accent
The enabled Scroll Mode launcher SHALL be styled from the semantic mode accent tokens
(accent-tinted background, accent border, accent foreground) and SHALL NOT contain any
hard-coded pink, purple, or other literal accent colors.

#### Scenario: Desktop launcher
- **WHEN** the desktop reading queue renders the enabled Scroll Mode launcher
- **THEN** its background, border, icon, and label colors derive from the mode accent
  tokens of the active theme

#### Scenario: Mobile launcher
- **WHEN** the mobile reading queue renders the enabled Scroll Mode launcher
- **THEN** its colors derive from the same mode accent tokens as the desktop launcher

### Requirement: Non-Color Prominence Cue
The enabled launcher's prominence SHALL remain identifiable without relying on hue alone,
via at least one structural cue (outlined/tinted construction distinct from filled
sibling controls, retained icon, and label) so the state survives monochrome themes,
reduced color perception, and e-ink displays.

#### Scenario: Monochrome theme
- **WHEN** Scroll Mode is offered under a monochrome or near-monochrome theme
- **THEN** the launcher remains distinguishable from adjacent controls through its
  border/tint treatment and iconography rather than through hue

### Requirement: Inactive State Remains Ordinary
The launcher's disabled state SHALL look like an ordinary disabled control in its context
and SHALL NOT use the mode accent treatment.

#### Scenario: Empty queue
- **WHEN** the queue has no eligible items (mobile)
- **THEN** the launcher renders in the standard disabled style with reduced emphasis

### Requirement: Interaction States Preserved
Hover, keyboard focus, pressed, and disabled behaviors of the launcher SHALL be preserved,
and keyboard focus visibility SHALL NOT be suppressed by the mode accent border treatment.

#### Scenario: Keyboard focus
- **WHEN** the launcher receives keyboard focus
- **THEN** a visible focus indicator is shown in addition to any mode accent styling

#### Scenario: Hover
- **WHEN** the user hovers the enabled launcher
- **THEN** a hover treatment derived from the mode accent tokens is shown

### Requirement: Platform Consistency
Desktop and mobile launchers SHALL consume the same semantic mode accent token system,
with any platform differences limited to layout, sizing, and density — not to a different
color source.

#### Scenario: Same theme on both platforms
- **WHEN** the same theme is active on desktop and mobile
- **THEN** both launchers express the same mode accent semantics

### Requirement: Behavior Unchanged
The change SHALL be visual only: opening Scroll Mode, tab creation, tooltips, keyboard
access, layout, sizing, iconography, and disabled gating SHALL behave exactly as before.

#### Scenario: Activation
- **WHEN** the launcher is activated
- **THEN** Scroll Mode opens exactly as it did before this change

### Requirement: No Theme Conditionals In Consumers
Scroll Mode UI code MUST NOT branch on theme identity (name or id) and MUST NOT compute
colors locally; all mode-accent values reach it through the semantic token layer.

#### Scenario: Component source audit
- **WHEN** the launcher component sources are inspected
- **THEN** they contain no theme-name conditionals and no literal accent color values
