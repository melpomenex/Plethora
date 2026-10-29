## ADDED Requirements

### Requirement: Existing Audio Edition dispatch accepts LFM3
Existing Audio Edition provider selection and synthesis SHALL accept LFM3 through
the normal registry where exportable WAV output is supported. It SHALL respect
the provider's bounded input and selected model/voice/locale. This provider
integration SHALL reuse existing generation and playback/storage ownership.

#### Scenario: Generate with LFM3
- **WHEN** the user selects an available LFM3 model for an Audio Edition
- **THEN** existing dispatch SHALL request bounded WAV clips from the same adapter used by normal speech

#### Scenario: LFM3 is unavailable
- **WHEN** the selected native runtime or model is missing
- **THEN** generation SHALL explain the local prerequisite without silently changing provider
