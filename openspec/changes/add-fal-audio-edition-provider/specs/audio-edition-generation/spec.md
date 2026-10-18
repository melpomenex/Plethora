## MODIFIED Requirements

### Requirement: Quality Abstraction and Advanced Selector
The system SHALL present standard users with simplified quality presets (Fast, Natural, Best, Expressive, and Fal.ai) that map to configured recommended providers/models, while offering an Advanced mode exposing provider (including Pocket TTS, OpenRouter, ElevenLabs, OpenAI, Fal.ai, and Chatterbox), model ID, voice ID, speed, response format, and custom instructions.

#### Scenario: Natural quality preset chosen
- **WHEN** user selects "Natural" quality in the Audio Edition creation dialog
- **THEN** the system SHALL automatically configure the default neural voice model (such as OpenRouter neural narrator or Pocket TTS local) without prompting for raw provider endpoints

#### Scenario: Fal.ai quality option chosen
- **WHEN** user selects the "Fal.ai" profile option in the Audio Edition creation dialog
- **THEN** the system SHALL configure the Fal.ai provider with its default model, populate available Fal.ai voices, and display the corresponding pre-flight pricing estimate

#### Scenario: Fal.ai selected in Advanced provider mode
- **WHEN** user opens Advanced Settings and selects Fal.ai from the provider dropdown
- **THEN** the system SHALL update the active provider to `fal`, list built-in and user-configured Fal voices, disable the unsupported speed parameter with explanatory text, and preserve custom prompt instructions
