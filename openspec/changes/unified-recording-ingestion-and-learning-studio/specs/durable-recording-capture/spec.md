## Purpose

Preserves long recordings independently of inference, with bounded capture memory, explicit lifecycle transitions and recoverable committed audio across failures.

## ADDED Requirements

### Requirement: Incremental acknowledged recording persistence
The system SHALL persist captured audio incrementally with bounded pending buffers. A Saved indicator SHALL represent verified durable bytes, not an in-memory object URL or an uncommitted event. Capture SHALL stop or pause safely on persistent storage backpressure without silently dropping audio or retaining the entire recording in memory.

#### Scenario: Ninety-minute lecture
- **WHEN** a 90-minute fixture/device recording completes
- **THEN** audio committed during recording remains accessible after process restart and audio-buffer memory stays bounded independently of duration
- **AND** finishing does not require merging a whole-session PCM array

#### Scenario: Storage failure
- **WHEN** a write fails during capture
- **THEN** acknowledged duration does not advance, input safely pauses/stops and all committed audio is offered for recovery/export with a visible error

### Requirement: Explicit capture lifecycle and ownership
The system SHALL expose recording, paused where supported, interrupted, finalizing, saved, failed and recoverable states. Only one capture owner SHALL hold the microphone across recording and dictation. Navigation SHALL preserve the active controller. Permission denial, device changes and termination SHALL release resources without silently discarding committed audio.

#### Scenario: Competing dictation
- **WHEN** dictation is requested during session recording
- **THEN** the request reports microphone busy and does not stop the recording or acquire another microphone stream

#### Scenario: Late permission result
- **WHEN** microphone permission resolves after the capture request was cancelled
- **THEN** the late stream is released and no new recording begins

#### Scenario: Navigate while recording
- **WHEN** the user opens another document
- **THEN** recording continues where platform policy permits and a discoverable active-recording indicator opens the same session

### Requirement: Recover committed prefixes without false continuity
After interruption or crash the system SHALL discover, verify and retain committed parts, report retained duration/gaps and offer review, export, explicit continuation or explicit discard. It SHALL NOT automatically restart a microphone or claim that missed time was recorded.

#### Scenario: Crash between file and database commit
- **WHEN** the process terminates after a part is durably renamed but before its database acknowledgement
- **THEN** restart recovery adopts the verified part once and exposes the playable/recoverable prefix without duplicated parts

#### Scenario: Continue recovered capture
- **WHEN** the user chooses Continue on a recovered session
- **THEN** a new recording part starts with fresh capability/permission checks and the interruption is not represented as recorded audio

### Requirement: Honest platform background behavior and captions
Recording and processing SHALL follow actual OS capabilities. Unsupported background capture SHALL stop and save safely; native supported background capture SHALL expose required user-visible controls. Live captions SHALL be labeled temporary and SHALL NOT become finalized evidence without validation. Captions SHALL NOT silently send audio remotely.

#### Scenario: iOS interruption
- **WHEN** a call or background policy interrupts recording
- **THEN** completed audio is retained, the interrupted state is visible and capture resumes only by explicit action

#### Scenario: Captions unavailable
- **WHEN** no eligible caption service exists
- **THEN** recording still works with audio health feedback and no fake transcript
