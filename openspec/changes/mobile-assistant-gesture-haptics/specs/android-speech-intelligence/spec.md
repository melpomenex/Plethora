## ADDED Requirements

### Requirement: Short native composer dictation
Android SHALL provide capability-gated, explicitly started short microphone dictation separately from durable file/lecture transcription. Capability checks SHALL NOT capture, prompt or download assets. A microphone permission request SHALL occur only after explicit user activation. Available on-device recognition SHALL be preferred; system-service recognition whose processing locality is unknown/remote SHALL require explicit disclosure/consent and SHALL be unavailable in strict local-only mode. No cloud provider SHALL be silently substituted.

#### Scenario: Status without side effects
- **WHEN** a composer checks Android dictation capability
- **THEN** it receives service/local-processing/permission state without microphone capture, permission prompt or model download

#### Scenario: On-device recognition
- **GIVEN** the platform reports on-device recognition available for use
- **WHEN** an authorized user starts dictation
- **THEN** the native on-device service is used, and locale/runtime failure remains a typed failure rather than remote fallback

#### Scenario: System-only service
- **GIVEN** only a system service with unknown/remote processing is available
- **WHEN** strict-local mode is enabled or disclosure is declined
- **THEN** app dictation does not start and typing remains available

### Requirement: Bounded Android capture ownership
Native dictation SHALL have one session owner, a maximum capture duration of 60 seconds, finalization timeout of 5 seconds, and one final text result on stop. Cancel, permission failure, background or interruption SHALL release capture and invalidate late results. A competing capture SHALL fail busy without disrupting its owner. Composer dictation SHALL NOT retain audio or create lecture/document jobs; durable file/lecture behavior and preferences SHALL remain unchanged.

#### Scenario: Finalization
- **WHEN** the user stops an active session
- **THEN** one final result or typed no-speech/error/timeout outcome is returned and native resources are released

#### Scenario: Automatic duration stop
- **WHEN** active capture reaches 60 seconds
- **THEN** it finalizes once and returns editable text without automatic Assistant submission

#### Scenario: Cancel and stale callback
- **WHEN** a cancelled or backgrounded session later receives recognizer callbacks
- **THEN** no text is inserted and the microphone remains stopped

#### Scenario: Existing lecture or file work
- **GIVEN** another microphone owner is active or a file-transcription provider was explicitly chosen
- **WHEN** composer dictation is requested
- **THEN** active microphone ownership is respected and file-provider selection/persistence is not changed
