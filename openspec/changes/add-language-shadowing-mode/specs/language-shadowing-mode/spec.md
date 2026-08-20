# Spec: language-shadowing-mode

## ADDED Requirements

### Requirement: Shadowing flow

The mode SHALL support immediate shadow, listen-then-repeat, repeat-until-accepted, and continuous sentence sequence modes where source capabilities permit. It SHALL present expected sentence/context and clear Listen, Record, Stop, Retry, and Exit controls.

#### Scenario: Listen then repeat
- **WHEN** the learner starts listen-then-repeat for a sentence
- **THEN** the source plays, recording starts only after explicit/clearly indicated capture state, and the attempt ends with Stop or configured boundary

### Requirement: Original audio preference

Playback SHALL use a current aligned original audio/video range when available and existing TTS otherwise. The source and fallback status SHALL be visible; native audio MUST NOT be replaced by TTS silently.

#### Scenario: Native podcast shadow
- **WHEN** a podcast sentence has an aligned range
- **THEN** shadow playback uses that range and replay uses the same source

### Requirement: Recording consent and privacy

Microphone capture SHALL require user initiation/permission, show recording state, support cancel/delete, and honor local-only/cloud consent and retention settings. No recording or upload occurs on mode entry alone.

#### Scenario: Permission denied
- **WHEN** microphone permission is denied
- **THEN** the mode offers listen-only behavior and explains how to retry permission without failing the reader

### Requirement: Transcription comparison

When STT is available, the system SHALL compare expected and recognized text using language-aware normalization for punctuation/case/diacritics according to profile settings, identify useful missing/substituted/extra words, and expose confidence/uncertainty.

#### Scenario: STT omission
- **WHEN** the learner says a sentence missing one word
- **THEN** the result identifies the missing word and does not claim phoneme-level pronunciation failure

### Requirement: Capability ladder/fallback

Local STT, configured cloud STT, and unsupported/unavailable states SHALL be capability-negotiated. Lack of STT SHALL still permit listen/repeat practice and SHALL be labeled.

#### Scenario: Offline listen-only
- **WHEN** offline mode has no local STT
- **THEN** recording may be disabled or retained locally per policy and the learner can continue listen/repeat without fabricated evaluation

### Requirement: Practice history/evidence

Attempts SHALL retain minimal profile/source/attempt/comparison metadata and optional recording reference according to retention. Successful/uncertain/failed production evidence MAY feed active vocabulary analytics without changing knowledge state automatically.

#### Scenario: Active evidence
- **WHEN** a recognized attempt matches the expected sentence
- **THEN** active evidence is recorded for relevant lexical objects and no SRS card is created automatically

### Requirement: Cross-platform/accessibility

The mode SHALL support desktop/mobile/touch/keyboard/screen reader/reduced motion and degrade on e-ink to transcript/listen-only. Controls SHALL expose recording state without relying on animation.

#### Scenario: E-ink
- **WHEN** shadowing opens in e-ink presentation
- **THEN** text controls remain usable and any unavailable recording/playback capability is explicit
