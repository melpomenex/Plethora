## ADDED Requirements

### Requirement: Local LFM3 narrator settings are compatible and discoverable
The system SHALL add LFM3 model, base voice, locale, installation state, preview and diagnostics to existing TTS settings. Existing provider preferences, keys, voices and presets SHALL remain unchanged by migration. LFM3 preferences SHALL persist independently of device-local installation/readiness. Every new or renamed configurable control or meaningful group SHALL have a stable Settings search target and catalog/coverage entry or explicit coverage exclusion.

#### Scenario: Upgrade existing TTS settings
- **WHEN** a user with configured Pocket, Android or cloud TTS upgrades
- **THEN** existing selected provider/voice/settings SHALL remain selected and LFM3 SHALL be an optional unselected provider

#### Scenario: Search for local narrator language
- **WHEN** a user searches Settings for the LFM3 voice or language control
- **THEN** the existing search system SHALL reveal and focus the correct stable target without exposing private document text in catalog entries

#### Scenario: Synced preference on another device
- **WHEN** an LFM3 preference is restored on a device without the model or native runtime
- **THEN** settings SHALL show download-required or unavailable status while retaining the preference and existing alternative providers

### Requirement: LFM3 controls reflect actual availability
The settings UI SHALL distinguish missing runtime, model download, incompatible artifacts, memory limits, edition-only suitability and live readiness. It SHALL offer only validated voices/locales/formats, hide unsupported conditioning controls and keep technical backend detail in model diagnostics rather than ordinary reading controls.

#### Scenario: Missing model is actionable
- **WHEN** a user selects LFM3 before installing the complete model
- **THEN** settings SHALL offer an explicit download action with total storage and license information rather than a generic synthesis failure

#### Scenario: Unsupported cloning control
- **WHEN** LFM3 is the active provider
- **THEN** voice cloning, arbitrary named voice entry and unsupported style/pitch controls SHALL NOT be presented as usable LFM3 features
