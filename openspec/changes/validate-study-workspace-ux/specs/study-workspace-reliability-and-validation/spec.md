# Study Workspace Reliability, UX, and Validation Specification

## ADDED Requirements

### Requirement: Actionable AI Error Recovery Without Raw Internal Exceptions
Study Mode SHALL map provider, network, structured-output, verification, consent, local-only, and source-availability errors into concise, user-friendly messages with applicable recovery actions (Retry, Open AI Settings, Inspect Source, Dismiss), keeping technical error strings collapsed or secondary, and SHALL preserve previously valid artifacts when regeneration fails.

#### Scenario: Empty provider response shows actionable recovery and preserves prior artifact
- **GIVEN** a scope already has a valid saved concept map
- **WHEN** the user triggers regeneration and the AI provider returns an empty response
- **THEN** Study Mode displays a concise human-readable error with Retry and Open AI Settings actions
- **AND** the previously valid concept map remains visible and intact.

### Requirement: Stale-Response Protection and Draft Preservation
Study Mode SHALL guard all asynchronous load and generation callbacks against document and scope switches so stale or cancelled results cannot update the wrong workspace, and SHALL preserve in-progress practice draft answers across Read/Study toggles and tab switches.

#### Scenario: Switching scope discards stale in-flight generation
- **GIVEN** a generation request is in flight for Scope A
- **WHEN** the user switches to Scope B before Scope A's request resolves
- **THEN** the in-flight request is cancelled or its late result is discarded
- **AND** Scope B's state is not polluted by Scope A's output.

### Requirement: Mobile Navigation, Accessibility, and Theme Compatibility
Study Mode transient overlays and mobile sheets SHALL integrate with `overlayStack` / `applicationBack`, hidden reader content SHALL remain `inert` and non-focusable, all new user-facing controls SHALL have accessible names and semantic roles, and surfaces SHALL render legibly using Plethora semantic theme tokens across light, dark, sepia, custom, high-contrast, and e-ink themes.

#### Scenario: Application Back dismisses active Study Mode overlay before leaving the document
- **GIVEN** the Study Mode preferences drawer or mobile source/assistant sheet is open
- **WHEN** the user presses Escape or triggers application Back
- **THEN** the active transient overlay closes first without exiting the document tab.

### Requirement: Honest Audio/Slides Playback and Caching
Audio lessons and narrated slides SHALL use real browser `speechSynthesis` when selected as fallback (falling back to timed transcript cleanly if unavailable) and SHALL NOT persist ephemeral `blob:` URLs across reloads or claim offline cache availability when no audio is cached.

#### Scenario: Audio player reports honest cache state
- **GIVEN** an audio lesson falls back to timed transcript mode without synthesized audio bytes
- **WHEN** the player renders
- **THEN** it does not claim the audio is cached offline.
