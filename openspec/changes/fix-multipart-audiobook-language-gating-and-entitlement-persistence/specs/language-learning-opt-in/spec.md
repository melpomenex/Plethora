# language-learning-opt-in Specification

## Purpose
Defines the global master opt-in for Language Learning surfaces: default state, migration of historical settings, dominance over per-document preferences, the complete set of gated surfaces, settings UI behavior, and persistence guarantees.

## ADDED Requirements

### Requirement: Explicit Global Master Opt-In
The system SHALL provide a single persisted global setting `languageLearning.enabled` that controls whether any Language Learning surface appears anywhere in the application. The default SHALL be `false` (opt-out by default) for new installs.

#### Scenario: Fresh install
- **WHEN** a new install opens any document in the reader
- **THEN** no Language Learning UI of any kind SHALL be rendered

### Requirement: Legacy Settings Migrate to Disabled
The system SHALL migrate persisted settings from schema version 10 to version 11 forcing `languageLearning.enabled = false` for existing installs, because no persisted master opt-in state existed prior to version 11. Historical suggestion defaults (`suggestionsEnabled: true`) SHALL NOT be interpreted as explicit opt-in; presentation sub-flags SHALL be preserved.

#### Scenario: Legacy install with suggestion defaults
- **WHEN** a pre-v11 install with `languageLearning: { suggestionsEnabled: true, showUnavailableProviders: true }` rehydrates settings
- **THEN** `languageLearning.enabled` SHALL be `false`
- **AND** the user SHALL NOT be silently opted into Language Learning

### Requirement: Global Disabled Mounts Nothing
While `languageLearning.enabled` is false, the system SHALL NOT mount the language host provider, reader host panel, suggestion banner, profile association gate, action/tutor/practice/reading-assist overlays, DOM bridges, video hosts, or selection-flow learner context. The reader SHALL behave as though the feature does not exist — hiding via CSS while still mounting the stack is non-compliant.

#### Scenario: Ordinary reader session
- **WHEN** a user with the feature disabled opens an EPUB, PDF, article, or transcript-bearing media document
- **THEN** no language mode bar, enable button, suggestion banner, association prompt, overlay, or vocabulary highlighting SHALL exist in the DOM

#### Scenario: Selection flow bypass surfaces
- **WHEN** the user selects text while the feature is disabled
- **THEN** dictionary-peek learner behavior and selection-sheet language-learner context SHALL be absent

### Requirement: Global Dominance Over Per-Document State
The effective language mode SHALL be `globalLanguageLearningEnabled && documentLanguageModeEnabled`. Global disabled SHALL dominate any per-document enabled state, while per-document preferences SHALL persist unchanged (not deleted) so they return when the feature is re-enabled. While globally disabled, the per-document preference key SHALL NOT be written.

#### Scenario: Global OFF with per-document ON
- **WHEN** a document has `plethora.language-mode.<documentId>` = on while the global setting is disabled
- **THEN** no language UI SHALL render for that document
- **AND** the per-document preference SHALL remain persisted (not rewritten to off)

#### Scenario: Preference returns after re-enable
- **WHEN** the user re-enables the global feature after a period of it being disabled
- **THEN** documents previously opted into language mode SHALL show language tools again without re configuration

### Requirement: Opt-In Surface When Enabled
With the global setting enabled, the reader SHALL present the per-document Language Mode opt-in control and, once enabled per document, the full language toolset — gated additionally by the suggestion sub-setting for suggestion banners.

#### Scenario: Global ON, per-document OFF
- **WHEN** the feature is globally enabled and the document has not opted into language mode
- **THEN** the Language Mode control SHALL be available and language tools SHALL remain inactive

#### Scenario: Global ON with suggestions disabled
- **WHEN** `suggestionsEnabled` is false
- **THEN** the suggestion banner SHALL not render even in language mode

### Requirement: Immediate Toggle Effect and Persistence
The master toggle SHALL take effect immediately (including in an already-open reader), SHALL persist across restarts, and SHALL be represented consistently on desktop and mobile settings surfaces with copy stating that it controls whether language-learning tools appear in readers.

#### Scenario: Toggle off while a reader is open
- **WHEN** the user disables the feature while a reader with language tools active is open
- **THEN** the language UI SHALL disappear from that reader without requiring navigation or reload

#### Scenario: Restart persistence
- **WHEN** the app restarts after enabling the feature
- **THEN** the setting SHALL remain enabled and readers SHALL present the opt-in surface

### Requirement: Settings Surface Retains Discoverability
The Settings → Language Learning tab SHALL remain visible regardless of the master state, hosting the master toggle and profile management, so an opt-in feature remains discoverable.

#### Scenario: Disabled state settings entry point
- **WHEN** the feature is disabled
- **THEN** the settings tab SHALL still be reachable and SHALL offer the master toggle
