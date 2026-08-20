# Spec: language-pronunciation-feedback

## ADDED Requirements

### Requirement: Capability ladder

Feedback SHALL support distinct levels: transcription match, word-level confidence, timing/rhythm, pronunciation-model scoring, and phoneme-level alignment. A provider SHALL declare supported level/language and the UI SHALL show only supported levels.

#### Scenario: STT-only provider
- **WHEN** the provider returns recognized text but no phoneme model
- **THEN** the result can show word/transcription differences and does not display phoneme scores

### Requirement: Calibrated feedback

Feedback MAY identify omitted/substituted words, stress/timing/fluency issues, problematic phonemes, or confidence, but MUST include provider/model/capability context and SHALL not claim certainty beyond evidence.

#### Scenario: Unsupported stress
- **WHEN** the configured provider cannot assess stress
- **THEN** stress feedback is unavailable rather than “good” or “bad” by default

### Requirement: Shadowing integration

Pronunciation feedback SHALL consume the shared shadowing attempt/source/recording contract and retain linkage to expected sentence, original/TTS audio, profile, and source anchor.

#### Scenario: Retry same sentence
- **WHEN** the learner retries a sentence
- **THEN** a new attempt/result links to the same source sentence and can be compared without overwriting prior history

### Requirement: Provider/privacy policy

Local, BYO, and configured hosted pronunciation providers SHALL use provider capability/consent infrastructure. Cloud audio upload, retention, model, and deletion behavior SHALL be disclosed; core shadowing remains usable without them.

#### Scenario: Cloud opt-out
- **WHEN** cloud pronunciation scoring is disabled
- **THEN** local/transcription/timing feedback may run and no recording is uploaded

### Requirement: History and evidence

Score/results history SHALL be profile/source/attempt scoped, versioned, and optionally feed active-vocabulary evidence or targeted practice. It SHALL not silently rate or reschedule SRS cards.

#### Scenario: Active evidence
- **WHEN** a word is produced with high-confidence matching feedback
- **THEN** active evidence may increase with source/result provenance while scheduler state remains unchanged

### Requirement: Graceful degradation/accessibility

Unavailable model, language, permission, or provider errors SHALL fall back to lower capability levels/listen-only with clear explanation. Feedback SHALL be accessible on desktop/mobile/e-ink and not rely on color or animation.

#### Scenario: E-ink feedback
- **WHEN** pronunciation feedback opens in e-ink mode
- **THEN** textual supported issues are shown and unsupported dimensions are explicit without animation-heavy controls
