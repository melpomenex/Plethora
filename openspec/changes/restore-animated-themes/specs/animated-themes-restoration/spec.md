## ADDED Requirements

### Requirement: Animated themes render continuously while foregrounded on desktop

The system SHALL render animated theme backgrounds (canvas-driven scenic themes and CSS-driven Liquid Glass blobs) continuously while the application window is visible and focused on desktop, without freezing the animation after a period of user inactivity. The system MAY pause animation only when the tab/window is hidden or the window loses focus.

#### Scenario: Canvas theme keeps moving while the user reads
- **WHEN** a user selects an animated canvas theme (e.g. `rain`, `aurora`, `sunbeams`) on desktop and then stops moving the pointer/typing for more than 10 seconds while the app remains visible and focused
- **THEN** the animated background SHALL continue to render new frames (i.e. not freeze)

#### Scenario: Liquid Glass blobs animate on macOS and Windows
- **WHEN** a user selects a Liquid Glass theme (`liquid-glass`, `amber-liquid-glass`, or `rose-liquid-glass`) on macOS or Windows where native window vibrancy is active
- **THEN** the flowing gradient blob animation SHALL be visible (the system SHALL NOT suppress the animated blobs when native vibrancy is active)

#### Scenario: Animation pauses when the app is not visible
- **WHEN** the application tab/window is hidden or the Tauri window loses focus
- **THEN** the animated background SHALL stop rendering frames, and SHALL resume rendering when the app becomes visible and focused again

### Requirement: Users can enable and disable animated themes via a setting

The system SHALL provide a user-facing "animated themes enabled" setting that, when disabled, fully stops all theme background animations (canvas and CSS) regardless of theme selection. The setting SHALL default to enabled on desktop. The system SHALL surface this toggle in the Settings "Animated Backdrop" section.

#### Scenario: Disabling animations stops the background
- **WHEN** a user has an animated theme selected and turns the "animated themes enabled" setting off
- **THEN** the animated background SHALL stop rendering and SHALL remain stopped until the setting is turned back on

#### Scenario: Particle controls reflect the master toggle
- **WHEN** the "animated themes enabled" setting is off
- **THEN** the particle density and brightness controls in the "Animated Backdrop" section SHALL present as disabled (no effect) until animations are re-enabled

### Requirement: Native mobile users can opt into animated themes

The system SHALL allow native mobile (Android) users to enable animated themes via the same "animated themes enabled" setting, rather than disabling them unconditionally. The system SHALL default the setting to disabled on native mobile to preserve device thermals and battery.

#### Scenario: Mobile default keeps animations off
- **WHEN** a user runs the app on native mobile for the first time (or an existing install receives this change)
- **THEN** the "animated themes enabled" setting SHALL be off by default and no animated background SHALL render

#### Scenario: Mobile user opts in
- **WHEN** a native mobile user turns the "animated themes enabled" setting on and selects an animated theme
- **THEN** the animated background SHALL render on the device

### Requirement: Reduced-motion preference disables animation automatically

The system SHALL disable theme background animations (canvas and CSS blob) when the host OS reports a reduced-motion preference (`prefers-reduced-motion: reduce`), independent of the "animated themes enabled" setting.

#### Scenario: OS reduced-motion stops animation
- **WHEN** the OS preference is `prefers-reduced-motion: reduce` and a user selects an animated theme
- **THEN** the animated background SHALL NOT render, even though the "animated themes enabled" setting is on

#### Scenario: Toggling reduced-motion resumes appropriately
- **WHEN** the OS preference changes from reduced-motion to standard motion while an animated theme is selected and animations are enabled
- **THEN** the animated background SHALL resume rendering
