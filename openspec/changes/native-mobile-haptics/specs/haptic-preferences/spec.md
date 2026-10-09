## Purpose

Give mobile users durable, independent control over tactile feedback and effect styles without confusing app preference, hardware support or system-managed suppression.

## ADDED Requirements

### Requirement: Independently persisted haptic controls
The application SHALL persist Haptic Feedback enabled/disabled and Haptic Intensity Subtle/Standard/Strong through its existing settings architecture. Every application haptic effect SHALL honor these preferences. Sound-effect, notification-sound and visual-feedback preferences SHALL remain independent after migration.

#### Scenario: Sounds off with haptics on
- **WHEN** UI sounds and notification sounds are disabled and haptics are enabled on a supported mobile device
- **THEN** eligible grading, save and completion actions still produce their admitted haptics without sounds

#### Scenario: Haptics off with sounds on
- **WHEN** haptics are disabled and sounds are enabled
- **THEN** eligible actions retain permitted sounds but issue no hardware output request

#### Scenario: Restart persistence
- **WHEN** the user changes enabled state and intensity, closes and restarts the app
- **THEN** both values are restored before hardware admission and all mobile control surfaces display those restored values

### Requirement: Unified mobile settings controls
Every existing mobile vibration/haptic toggle SHALL read and update the same persisted preference. Mobile settings SHALL expose intensity separately, provide accessible localized labels and status, and distinguish saved preference from capability and system status. Changing haptic controls SHALL affect delivery without restart. Disabling SHALL NOT generate a feedback pulse.

#### Scenario: Alternate mobile controls stay synchronized
- **WHEN** the user disables Haptic Feedback through the compact mobile settings panel and opens the full settings view
- **THEN** the full view shows disabled and subsequent gestures/actions produce no app haptics

#### Scenario: Unsupported device retains user preference
- **WHEN** the mobile user opens settings on unsupported hardware
- **THEN** support limitations are explained honestly, the preference remains persisted/editable and no permission prompt or false hardware preview is produced

#### Scenario: Accessible and independent controls
- **WHEN** a keyboard or screen-reader user changes an intensity option or sound toggle
- **THEN** the control has an unambiguous announced label/value and changing sound leaves both haptic values unchanged

### Requirement: Safe existing-preference migration
Migration SHALL preserve valid explicit haptic settings, normalize invalid intensity to Subtle and default new installations to enabled/Subtle. A pre-haptic snapshot with an explicit boolean legacy combined sound/feedback preference SHALL seed the new enabled value once from that preference, preserving the old effective opt-out/opt-in. A missing/invalid legacy preference SHALL use the new default. Migration SHALL preserve sound/visual values and SHALL NOT invent a persisted value for the former component-local vibration toggle. Partial persisted categories SHALL merge safely.

#### Scenario: Existing effective opt-out
- **WHEN** an older settings snapshot explicitly has combined UI feedback sounds disabled and has no haptic category
- **THEN** migration initializes haptics disabled, intensity Subtle, and leaves the sound setting disabled
- **AND** later enabling sounds does not enable haptics

#### Scenario: Existing enabled or fresh settings
- **WHEN** older settings explicitly enable combined feedback or the installation has no stored preference
- **THEN** enabled/Subtle is initialized without changing any stored sound preference

#### Scenario: Explicit values and malformed partial snapshot
- **WHEN** settings contain valid explicit haptics disabled, an invalid intensity, or a partially missing haptic category
- **THEN** the explicit disabled choice survives, invalid/missing intensity uses Subtle and defaults merge without losing other categories

### Requirement: Honest platform intensity semantics
Intensity SHALL choose supported effect styles rather than promise arbitrary motor amplitude. Fixed native selection/outcome effects and platforms with equivalent styles SHALL remain fixed or equivalent across levels. Settings SHALL disclose this limitation and SHALL NOT override system haptic controls to make Strong feel stronger.

#### Scenario: Fixed notification pattern
- **WHEN** an iPhone user selects Strong and completes a task
- **THEN** the native semantic success pattern remains a success pattern without fabricated intensity scaling

#### Scenario: Style-capable interaction
- **WHEN** a user changes intensity on a platform supporting distinct impact or selection styles
- **THEN** later eligible interactions select the corresponding supported style without changing event frequency or sound volume

### Requirement: System suppression and desktop setting compatibility
App haptic preference SHALL be subordinate to observable system suppression and otherwise use public system-controlled output. Unknown system state SHALL be shown as unknown/system-controlled. Desktop settings SHALL preserve their existing sound controls without adding a misleading working mobile-haptics control.

#### Scenario: App enabled with system disabled
- **WHEN** app haptics are enabled but the device's relevant system control suppresses output
- **THEN** no override is attempted and observable disabled status is distinguished from the saved app preference

#### Scenario: Desktop preferences
- **WHEN** settings are opened on desktop with stored haptic preferences from another supported surface
- **THEN** sound controls remain independent and no desktop hardware haptic support is implied
