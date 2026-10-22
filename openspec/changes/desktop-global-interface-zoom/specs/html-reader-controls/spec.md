## REMOVED Requirements

### Requirement: Font size keyboard shortcuts

The HTML viewer SHALL support Ctrl/Cmd + Plus to increase font size, Ctrl/Cmd + Minus to decrease font size, and Ctrl/Cmd + 0 to reset font size.

**Reason**: On desktop, Ctrl/Cmd + Plus, Minus, and 0 are now reserved for application-wide interface zoom. Keeping the HTML viewer's handlers active would make one key press change both the application scale and the document font size, and would break the single-owner shortcut rule.

**Migration**: Use the visible A+/A− controls and the reset control in the HTML viewer settings panel, or the existing Ctrl/Cmd + wheel gesture over the reader. Document zoom remains available from the HTML viewer controls and the document-specific Command Palette actions. The application-wide zoom behavior and the isolation rule are defined by the `desktop-interface-zoom` capability.

## ADDED Requirements

### Requirement: HTML font size remains controllable without reserved chords

The HTML viewer SHALL continue to expose font-size increase, decrease, and reset controls in its existing settings surface, with the existing 12–32 px range and 16 px reset default. It SHALL continue to support Ctrl/Cmd + wheel over the reader for font-size adjustment. Pressing Ctrl/Cmd + Plus, Minus, or 0 SHALL NOT change the HTML font size on desktop; those chords SHALL be left to application interface zoom.

#### Scenario: Visible controls still work

- **WHEN** the user presses the A+ or A− button in the HTML viewer settings panel
- **THEN** the iframe font size changes by 1 px within the existing 12–32 px range
- **AND** the reset control restores 16 px

#### Scenario: Wheel gesture still works

- **WHEN** the pointer is over the HTML reader and the user performs Ctrl/Cmd + wheel
- **THEN** the existing HTML font-size adjustment runs
- **AND** the application interface zoom does not change

#### Scenario: Reserved chords do not change font size

- **WHEN** the HTML viewer is active and the user presses Ctrl/Cmd + Plus, Minus, or 0 on desktop
- **THEN** the HTML font size remains unchanged
- **AND** the reserved chord is handled only by application interface zoom
