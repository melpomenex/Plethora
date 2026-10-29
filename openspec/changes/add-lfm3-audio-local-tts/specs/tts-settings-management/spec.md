## ADDED Requirements

### Requirement: LFM3 settings use existing provider controls
The system SHALL offer LFM3 model installation/status, female/male voice, documented
language choice and preview through existing TTS settings. Defaults/migration
SHALL preserve old providers, keys and voices. New meaningful controls/groups
SHALL have stable Settings search targets and catalog/coverage entries or an
explicit exclusion. Unsupported cloning/style controls SHALL remain hidden.

#### Scenario: Existing user upgrades
- **WHEN** a user upgrades with another provider configured
- **THEN** that provider SHALL stay selected and LFM3 SHALL be optional

#### Scenario: Search for LFM3 voice or language
- **WHEN** the user searches Settings for the LFM3 narrator controls
- **THEN** the search system SHALL reveal and focus the matching stable target

#### Scenario: Preview the selected narrator
- **WHEN** the user previews an installed LFM3 voice/locale
- **THEN** the normal provider path SHALL synthesize and play a cancellable sample using that configuration
