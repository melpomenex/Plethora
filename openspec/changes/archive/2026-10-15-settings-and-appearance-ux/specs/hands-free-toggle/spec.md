## MODIFIED Requirements

### Requirement: Hands-Free toggle renders as a normal, correctly-proportioned switch
The Hands-Free Study Mode toggle (`src/components/settings/TTSSettings.tsx:1808–1829`) SHALL render as a standard Plethora switch with correct proportions (a pill track with a small circular knob), a clear on/off state, correct alignment with its label, and theme-aware colors. It SHALL NOT render as a very large circle on any supported viewport or theme.

#### Scenario: Desktop appearance
- **WHEN** the Hands-Free toggle is rendered on a desktop viewport
- **THEN** the control SHALL be a switch of standard proportions (e.g. ~44×24 px pill with a ~20 px knob), not a large circle, and SHALL align vertically with its label

#### Scenario: Mobile/narrow appearance
- **WHEN** the Hands-Free toggle is rendered on a narrow/mobile viewport
- **THEN** the switch SHALL keep the same correct proportions and provide an adequate touch target (≥ 44 px in the touch dimension) without becoming visually enormous

#### Scenario: On/off state is clear
- **WHEN** the Hands-Free toggle is enabled
- **THEN** the track SHALL show the active (primary) color with the knob positioned to the "on" side; when disabled, the track SHALL show the muted color with the knob to the "off" side

### Requirement: The toggle follows the selected theme
The Hands-Free toggle SHALL consume the active theme's tokens (primary/muted/surface) exactly like neighboring settings controls, and SHALL render correctly in light, dark, custom, and high-contrast themes.

#### Scenario: Theme variations
- **WHEN** the toggle is rendered under light, dark, and a high-contrast/custom theme
- **THEN** the track, knob, and focus states SHALL use the theme's tokens and remain clearly legible in every theme

### Requirement: The toggle is accessible and keyboard-operable
The toggle SHALL expose a proper accessible checked state and SHALL support keyboard navigation/focus. It SHALL retain the existing `role="switch"` + `aria-checked` semantics (or an equivalent accessible switch implementation) and visible focus ring.

#### Scenario: Screen reader state
- **WHEN** a screen reader focuses the Hands-Free toggle
- **THEN** the element SHALL expose its role and current checked state via `aria-checked`

#### Scenario: Keyboard toggle
- **WHEN** the user tabs to the toggle and presses Enter/Space
- **THEN** the toggle SHALL flip its state and trigger the same handler as a mouse click

### Requirement: Root cause is fixed, not patched per viewport
The fix SHALL address the root CSS/component cause of the oversized-circle rendering (e.g. theme `--spacing` variable leakage collapsing the Tailwind sizing utilities, global `button` rules from a theme's `customCSS`, or the absence of a shared switch component) rather than adding one-off pixel overrides for a single viewport. If a shared switch component is extracted, the standard idiom already used across the app (`<label><input type="checkbox" class="sr-only peer">` + pill div, e.g. `SettingsPage.tsx:914–925`) SHALL be the reference.

#### Scenario: No per-viewport hacks
- **WHEN** the fix is complete
- **THEN** the toggle SHALL be correct at all supported viewports without viewport-specific pixel override rules introduced solely for this control