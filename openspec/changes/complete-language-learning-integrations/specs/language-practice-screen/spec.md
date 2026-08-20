## ADDED Requirements

### Requirement: Practice modes SHALL share one source-aware practice shell

The application SHALL provide a responsive practice surface that owns profile resolution, source selection, prompt/reveal state, replay, retry, attempt persistence, retention, and explicit evidence decisions. Shadowing, dictation, writing, pronunciation, and recommendation-driven practice SHALL enter through this shell and SHALL not create independent schedulers.

#### Scenario: Practice starts from a reader sentence
- **WHEN** the learner chooses Shadow, Dictate, Write, or Practice from Language Peek or Sentence Mode
- **THEN** the practice shell SHALL open with the current profile, sentence identity, source anchor, and available media capabilities preserved

#### Scenario: Practice is opened from a recommendation
- **WHEN** the learner chooses a recommendation candidate
- **THEN** the shell SHALL show the candidate's source, coverage/difficulty explanation, and an explicit start action before recording an attempt

### Requirement: Practice sources SHALL resolve exact media and text provenance

The shell SHALL use the shared source-anchor and original-media resolver contracts. It SHALL prefer aligned original audio, then configured TTS, and SHALL expose source type, timestamp/range, content fingerprint, and unavailable/stale status for every attempt.

#### Scenario: Native sentence audio is available
- **WHEN** the learner starts audio-backed practice for a sentence with a valid native range
- **THEN** the shell SHALL play the native range and record that source in the attempt

#### Scenario: Audio alignment is stale
- **WHEN** the source fingerprint no longer matches the stored audio alignment
- **THEN** the shell SHALL invalidate the range and offer a fresh resolution, TTS, or text-only practice without playing a different occurrence

### Requirement: Shadowing mode SHALL support explicit capture and uncertainty

Shadowing SHALL support listen-first, immediate, and continuous flows with explicit microphone permission, start/stop/cancel/delete, local/cloud STT routing, recognized-text comparison, confidence, and retry. Recognition uncertainty SHALL be visible and SHALL not be presented as definitive pronunciation judgment.

#### Scenario: Microphone permission is denied
- **WHEN** the learner denies microphone permission
- **THEN** the shell SHALL offer listen-only or text comparison alternatives and SHALL not repeatedly request permission without user action

#### Scenario: STT confidence is low
- **WHEN** recognition confidence is below the configured threshold
- **THEN** the comparison SHALL be labelled uncertain and SHALL not automatically add active evidence or pronunciation issues

### Requirement: Dictation mode SHALL hide the answer until an attempt

Dictation SHALL play the selected source without revealing the expected sentence, accept typed input, apply the shared language-aware normalization policy, show meaningful missing/extra/substituted/order errors, and provide reveal/replay/retry controls.

#### Scenario: Equivalent punctuation and case
- **WHEN** the learner submits an answer differing only by tolerated punctuation or case
- **THEN** the comparison SHALL accept the configured equivalence while preserving the raw answer and displaying any meaningful differences

#### Scenario: Learner reveals the answer
- **WHEN** the learner chooses Reveal before submitting a matching answer
- **THEN** the expected sentence and translation SHALL become visible, the attempt SHALL be marked revealed, and it SHALL not be counted as an unassisted success

### Requirement: Writing mode SHALL preserve learner text and gate corrections

Writing practice SHALL support content-driven prompts, target-vocabulary prompts, summaries, answers, rewrites, and dialogue responses. It SHALL preserve raw learner text, show correction modes/categories and provenance, and require explicit acceptance before recording production evidence or offering Memorize.

#### Scenario: Learner submits writing offline
- **WHEN** the learner submits writing while no provider is available
- **THEN** the draft SHALL remain locally recoverable and the shell SHALL offer retry or self-assessment without pretending that a correction was generated

#### Scenario: Learner accepts a production correction
- **WHEN** the learner explicitly accepts a correction or self-assesses a target word as produced
- **THEN** the shell SHALL record active evidence with source/profile provenance and SHALL leave SRS creation as a separate explicit action

### Requirement: Pronunciation feedback SHALL follow provider capabilities

The practice shell SHALL display only pronunciation dimensions advertised by the configured provider: transcription match, word confidence, timing/rhythm, pronunciation-model, or phoneme alignment. Unsupported dimensions SHALL be unavailable rather than zero or fabricated.

#### Scenario: Provider supports transcription only
- **WHEN** a shadowing provider supports recognized text but not phoneme alignment
- **THEN** the shell SHALL show transcription comparison and uncertainty while omitting phoneme scores and issues

#### Scenario: Pronunciation result is stale
- **WHEN** the source, recording, provider, or model fingerprint changes
- **THEN** the shell SHALL mark the result stale and SHALL not merge it into current evidence or history without reprocessing

### Requirement: Practice attempts SHALL have explicit retention and scheduler boundaries

The shell SHALL persist compact attempts, comparison summaries, provider provenance, and retention metadata. Recording deletion, export, and evidence acceptance SHALL be explicit. Practice SHALL never rate, complete, reschedule, postpone, or silently create a learning item.

#### Scenario: Learner completes practice
- **WHEN** the learner finishes a dictation, shadowing, writing, or pronunciation attempt
- **THEN** the shell SHALL offer a clear save/delete/evidence choice and SHALL leave Queue and review state unchanged until an explicit supported action is chosen

#### Scenario: Learner chooses Memorize
- **WHEN** the learner explicitly chooses Memorize for a practice result
- **THEN** the shell SHALL route to the shared language SRS draft flow with provenance and duplicate policy

### Requirement: Practice screens SHALL be accessible and responsive

Practice controls SHALL support keyboard, touch, screen readers, reduced motion, external keyboards, mobile layouts, e-ink degradation, offline states, provider failure, and clear focus movement between prompt, answer, feedback, replay, and exit.

#### Scenario: Learner uses an external keyboard
- **WHEN** the learner navigates a practice mode with keyboard-only input
- **THEN** focus SHALL move through the active controls in a logical order and submit/reveal/replay/exit actions SHALL be available without a pointer

#### Scenario: Learner exits practice
- **WHEN** the learner exits before saving an attempt
- **THEN** the shell SHALL confirm the discard when needed, restore the originating reader/video/tutor surface, and preserve its source position

