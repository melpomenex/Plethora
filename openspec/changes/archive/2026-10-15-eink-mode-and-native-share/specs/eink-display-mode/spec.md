## ADDED Requirements

### Requirement: E-Ink Display Mode Configuration and Persistence
The system SHALL provide a dedicated display mode setting with values `standard`, `eink`, and `auto`. The setting SHALL be persisted locally per device in local storage so an E-ink selection on a mobile or e-reader device does not unintentionally force E-ink mode onto synced desktop or laptop instances.

#### Scenario: User manually enables E-Ink mode
- **WHEN** the user selects "E-Ink" in the display mode settings
- **THEN** the system SHALL immediately activate the E-Ink display mode across the application without requiring an application restart
- **AND** the setting SHALL be persisted locally and restored on subsequent application launches.

#### Scenario: Returning to Standard mode restores original theme
- **WHEN** the user changes the display mode from "E-Ink" back to "Standard"
- **THEN** the system SHALL immediately deactivate E-Ink overrides and restore the active theme's standard colors, animations, and visual styling.

#### Scenario: Auto detection resolves device display capability
- **WHEN** display mode is set to "Auto" and the application detects an E-ink hardware environment (such as Onyx/BOOX or known e-paper hardware signatures)
- **THEN** the system SHALL activate E-Ink display mode optimizations automatically
- **AND** if detection reports standard display hardware, standard display mode SHALL remain active.

### Requirement: High-Contrast Monochrome Visual Profile and Animation Suppression
When E-Ink display mode is active, the system SHALL apply a global high-contrast monochrome visual profile via `data-display-mode="eink"` on the root document element. The profile SHALL:
1. Strip glassmorphism, translucent backdrops, backdrop blurs, gradients, and box shadows into crisp solid borders.
2. Render crisp high-contrast foreground text on light/white background surfaces.
3. Replace color-only indicators with distinct shapes, weight, or borders (such as flashcard rating buttons and queue status indicators).
4. Remove decorative animations, skeletons, shimmer effects, sliding transitions, bounce/scale effects, and smooth scrolling.
5. Enforce `effectiveReducedMotion = true` and `scroll-behavior: auto` globally regardless of the operating system motion preference.
6. Preserve original document media and embedded illustrations in full fidelity by default, with an optional grayscale document media toggle.

#### Scenario: Global visual overrides applied on E-Ink activation
- **WHEN** E-Ink mode is active
- **THEN** the root element SHALL have `data-display-mode="eink"`
- **AND** translucent glass panels SHALL render with solid high-contrast backgrounds and crisp borders
- **AND** CSS animations and transitions SHALL have their duration set to 0.01ms or disabled
- **AND** `scroll-behavior: smooth` SHALL be overridden with `scroll-behavior: auto`.

#### Scenario: Flashcard rating buttons remain distinguishable without color
- **WHEN** reviewing flashcards with E-Ink mode active
- **THEN** rating options (Again, Hard, Good, Easy) SHALL display clear geometric icons, textual labels, and distinct border styles rather than relying solely on red/yellow/green color cues.

### Requirement: E-Ink Optimized Reader Pagination and Minimal Chrome
The system SHALL provide discrete, page-oriented navigation and distraction-free minimal chrome controls for EPUB, PDF, and reflowed article readers when E-Ink mode is active.

#### Scenario: Paginated reading navigation default in EPUB and PDF
- **WHEN** opening an EPUB or PDF document with E-Ink mode active
- **THEN** the reader SHALL default to paginated discrete page replacement rather than smooth continuous scrolling
- **AND** page navigation SHALL advance instantly without intermediate partial refresh frames.

#### Scenario: Minimal reading chrome toggle
- **WHEN** the user is reading a document in E-Ink mode
- **THEN** the reader SHALL support a minimal distraction-free state where top and bottom navigation chrome are hidden
- **AND** a center tap SHALL temporarily toggle the visibility of the reader controls.

### Requirement: Configurable Reader Tap Zones
The system SHALL support configurable touch tap zones for readers in E-Ink mode. Tapping the left edge SHALL navigate to the previous page, tapping the right edge SHALL navigate to the next page, and tapping the center region SHALL toggle the reader chrome. Tap zones SHALL NOT intercept or interfere with text selection, link clicks, media controls, or pinch-to-zoom gestures.

#### Scenario: Tap right zone advances to next page
- **WHEN** tap zones are enabled and the user taps the right edge of a reader document without an active text selection
- **THEN** the reader SHALL advance to the next page immediately.

#### Scenario: Text selection takes precedence over tap zones
- **WHEN** the user performs a drag-to-select gesture or double-taps a word inside the reader content
- **THEN** the system SHALL create and display the text selection without triggering a page turn.

### Requirement: Hardware Volume Button Page Navigation
The system SHALL support optional hardware volume-button page navigation on supported mobile platforms (Android) when reading in E-Ink mode. Volume Down SHALL advance to the next page and Volume Up SHALL return to the previous page (with an optional inversion setting). Hardware button interception SHALL ONLY be active while a reader view is mounted and focused, and SHALL NOT intercept keys during active audio/video/TTS playback or modal text input.

#### Scenario: Volume button advances reader page
- **WHEN** "Volume Buttons Turn Pages" is enabled, a reader is active, and no media playback is running
- **THEN** pressing the Volume Down button SHALL navigate to the next page and prevent default system volume alteration.

#### Scenario: Volume button adjusts media volume when audio is active
- **WHEN** "Volume Buttons Turn Pages" is enabled but an audiobook, podcast, or TTS read-aloud session is playing audio
- **THEN** pressing volume buttons SHALL adjust the system audio volume rather than turning reader pages.

#### Scenario: Cleanup on reader unmount
- **WHEN** navigating away from the reader to the library, settings, or search
- **THEN** volume button key listeners SHALL be immediately detached, restoring standard volume control behavior.

### Requirement: E-Ink Capabilities and Native Device Architecture
The system SHALL define a clean `EinkCapabilities` and `EinkController` abstraction layer allowing generic fallback on standard web/Android environments while permitting device-specific optimizations (such as BOOX/Onyx e-paper refresh modes) when running on compatible native hardware.

#### Scenario: Platform capability detection
- **WHEN** the application initializes
- **THEN** `EinkCapabilities` SHALL inspect the platform and return whether hardware keys, auto-detection, and native e-paper refresh controls are supported
- **AND** the UI settings SHALL only expose hardware-dependent options when supported by the underlying platform.
