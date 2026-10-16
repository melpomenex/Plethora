## ADDED Requirements

### Requirement: Purpose-scoped ephemeral Apple composer dictation
Native iOS SHALL support short composer dictation through existing native speech facilities with a distinct ephemeral composer purpose, independent of file/lecture persistence and Foundation Models availability. Side-effect-free capability checks SHALL report microphone/Speech authorization, locale readiness and processing locality. Explicit start SHALL request required microphone and Speech permissions. Guaranteed on-device mode SHALL require verified recognizer support and a local-processing request; otherwise remote/unknown processing SHALL require disclosure/consent and SHALL be blocked in strict local-only mode.

#### Scenario: Capability independent of language model
- **WHEN** Apple Foundation Models is unavailable but native speech can recognize the selected locale
- **THEN** composer dictation remains separately eligible without automatic recording or downloads

#### Scenario: Permission denied
- **WHEN** microphone or Speech authorization is denied at explicit start
- **THEN** dictation fails once with recovery guidance and preserves the draft without fallback upload

#### Scenario: Local-only enforcement
- **WHEN** guaranteed on-device recognition is requested but locale/device support cannot satisfy it
- **THEN** capture does not start through remote recognition and the user can still type

### Requirement: Apple dictation finalization and lifecycle
Composer-purpose live recognition SHALL finalize on stop before returning text, with at most one final result, a 5-second finalization timeout and a 60-second capture cap. Recognition failure SHALL be surfaced rather than ignored. Cancellation, interruption and backgrounding SHALL stop audio input, release resources and invalidate callbacks. Composer dictation SHALL NOT retain audio or create a lecture document, and existing lecture/file purpose defaults SHALL remain compatible.

#### Scenario: Final callback after stop
- **GIVEN** final recognition text arrives after audio input stops
- **WHEN** stop is requested
- **THEN** the final result is awaited within timeout and inserted once rather than returning a stale segment snapshot

#### Scenario: Interrupted dictation
- **WHEN** a call, audio interruption, backgrounding or user cancel ends capture
- **THEN** the audio engine/session is released, late results do not alter the draft, and capture does not silently restart

#### Scenario: Recognition error or timeout
- **WHEN** recognition fails or finalization times out
- **THEN** the original draft remains and a typed retry/typing recovery is shown

#### Scenario: Legacy purpose compatibility
- **WHEN** an existing lecture/voice-note or file-transcription operation runs
- **THEN** its existing durable behavior and provider resolution are not replaced by ephemeral composer dictation
