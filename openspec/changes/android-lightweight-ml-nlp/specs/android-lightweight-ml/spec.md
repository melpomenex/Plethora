## ADDED Requirements

### Requirement: Language identification is non-generative
Document language SHALL be identified with a lightweight on-device identifier when available, not with Gemini Nano.

#### Scenario: Import language
- **WHEN** an article is imported on Android with Language ID ready
- **THEN** metadata stores a BCP-47 tag or `und`
- **AND** no generative provider is invoked for this step

### Requirement: Translation uses the existing provider registry
ML Kit Translate SHALL register as a `local` `TranslationProvider`. User-configured dedicated/ai providers remain available per existing priority when local cannot serve the pair or is undownloaded.

#### Scenario: Offline pair
- **GIVEN** the language pair model is downloaded
- **WHEN** the user translates a selection in airplane mode
- **THEN** translation completes on-device
- **AND** no cloud translation occurs
