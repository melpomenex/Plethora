## ADDED Requirements

### Requirement: Translate Selection uses the active reader selection

Translate Selection SHALL be available for a non-empty selection belonging to the active reader, including PDF, EPUB, HTML, and text readers. Opening the palette SHALL preserve the selected passage for invocation even when focusing its input clears the native selection. The action SHALL translate the entire captured passage and target only its owning reader. It SHALL NOT use palette input or a selection from an inactive pane.

#### Scenario: Selection survives palette focus
- **WHEN** the user selects a passage in a supported reader, opens the palette, and activates Translate Selection
- **THEN** the captured passage is used even if the native selection collapsed
- **AND** the user sees progress followed by a translation result in the owning reader

#### Scenario: Selection contains several sentences
- **WHEN** the user translates a multi-sentence selection
- **THEN** the entire selected passage is translated rather than only the first sentence or an unrelated document window

#### Scenario: No usable selection
- **WHEN** the palette opens without a non-empty active-reader selection
- **THEN** Translate Selection is not listed as an executable action

#### Scenario: Selection belongs to another pane
- **WHEN** an inactive reader retains a selection and the active reader has none
- **THEN** the palette does not offer translation of the inactive reader's selection

#### Scenario: Owner changes before invocation
- **WHEN** the captured selection's document is closed or the active reader changes before invocation
- **THEN** the stale selection is invalidated and is not translated against the new reader

### Requirement: Selection translation exposes languages and truthful availability

Translation SHALL use the configured profile's translation direction when present, otherwise obtain a target language from translation settings or a target-language prompt. It SHALL honor existing provider and offline policies, retain the original text, and present translated text with source/target languages and accurate provider provenance. Command descriptions SHALL NOT promise on-device processing when a remote provider can be used. Missing providers, models, or configuration SHALL produce actionable guidance. Selection translation SHALL NOT silently enable Language Mode.

#### Scenario: Downloaded local language pair
- **WHEN** a usable local model is available and the user translates while offline
- **THEN** the translation completes locally and identifies its source and target languages
- **AND** no cloud request is made

#### Scenario: Configured remote fallback
- **WHEN** local translation cannot serve the pair and user policy permits a configured remote provider
- **THEN** the permitted provider translates the passage and its provenance is shown accurately

#### Scenario: No usable provider
- **WHEN** the selected language pair cannot be translated by an allowed available provider
- **THEN** the result UI explains the missing setup or model and offers a relevant next step
- **AND** the original selection remains available to retry

#### Scenario: No configured target language
- **WHEN** translation is invoked without a language profile or configured target language
- **THEN** the user can choose a target language before translation starts

#### Scenario: Reader closes during translation
- **WHEN** the owning reader closes or changes document during a translation request
- **THEN** its work is cancelled or the late result is discarded
- **AND** no result appears in another document
