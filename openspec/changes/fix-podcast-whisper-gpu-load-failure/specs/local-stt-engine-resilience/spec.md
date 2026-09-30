## Purpose

Keeps on-device speech-to-text reliable when the bundled sidecar's compute
backend misbehaves: validating model integrity before a doomed run, degrading
GPU to CPU automatically instead of failing, and turning raw engine logs into
diagnostics a user can act on.

## ADDED Requirements

### Requirement: Pre-flight Model Integrity Validation for Local ASR
The system SHALL validate the resolved local speech-to-text model file against
the pinned model catalog before spawning an engine process, and SHALL fail the
request with an actionable `corrupt-model` diagnostic when the file is missing,
truncated, or does not match its pinned digest. Validation SHALL use the pinned
byte size on every run and SHALL additionally verify the pinned SHA-256 digest
whenever the catalog provides one for the model.

#### Scenario: Truncated model file is rejected before spawning an engine
- **WHEN** a local transcription is requested for a model whose on-disk file is
  smaller than the catalog's pinned `size_bytes`
- **THEN** the system SHALL NOT spawn the speech-to-text engine process
- **AND** the request SHALL fail with a `corrupt-model` diagnostic that names
  the model and directs the user to re-download it in Settings

#### Scenario: Digest mismatch is detected even when the size matches
- **WHEN** a local transcription is requested for a model whose on-disk file
  matches the pinned byte size but whose SHA-256 does not match the pinned digest
- **THEN** the request SHALL fail with a `corrupt-model` diagnostic
- **AND** the system SHALL NOT spawn the speech-to-text engine process

#### Scenario: Valid model passes validation
- **WHEN** a local transcription is requested for a model whose on-disk file
  matches the pinned byte size and, when available, the pinned digest
- **THEN** the system SHALL spawn the engine and proceed with transcription

#### Scenario: Models without a pinned digest are still size-checked
- **WHEN** a local transcription is requested for a catalog model that declares
  no pinned digest
- **THEN** the system SHALL validate the pinned byte size only
- **AND** SHALL proceed with transcription when the size matches

### Requirement: Automatic CPU Fallback for Local ASR Backend Failures
The system SHALL, when a local speech-to-text run fails, re-attempt the same
request exactly once with the engine's compute accelerator disabled, and SHALL
complete the transcription on that fallback attempt when it succeeds. The
fallback SHALL be attempted only when the failed run reported an accelerated
backend as active and produced no transcription progress, so runs that already
made progress are never silently restarted.

#### Scenario: GPU backend crash falls back to CPU and completes
- **WHEN** a local transcription run's engine process exits unsuccessfully after
  reporting an accelerated compute backend and without reporting any progress
- **THEN** the system SHALL re-run the same request with the accelerator
  disabled
- **AND** SHALL complete the transcription using the fallback run's segments

#### Scenario: Retry happens at most once
- **WHEN** a local transcription run fails both the accelerated attempt and the
  accelerator-disabled attempt
- **THEN** the system SHALL NOT attempt a further run
- **AND** SHALL surface the fallback attempt's failure to the caller

#### Scenario: CPU-only runs are not retried
- **WHEN** a local transcription run's engine process exits unsuccessfully after
  reporting no accelerated compute backend
- **THEN** the system SHALL NOT re-run the request with the accelerator disabled

#### Scenario: Partially processed runs are not retried
- **WHEN** a local transcription run's engine process exits unsuccessfully after
  reporting transcription progress
- **THEN** the system SHALL NOT re-run the request with the accelerator disabled

#### Scenario: Segments come only from the successful attempt
- **WHEN** a local transcription run fails and the accelerator-disabled retry
  succeeds
- **THEN** the persisted transcript SHALL contain exactly the retry run's
  segments, with no duplicates from the failed attempt

### Requirement: Visible Fallback for Local ASR Retries
The system SHALL emit a retry-phase notification before re-attempting a
transcription with the accelerator disabled, so the user interface can report
that the compute backend failed and the engine is continuing without it.

#### Scenario: UI is told about the fallback before it happens
- **WHEN** a local transcription run fails with an accelerated backend active
  and the system is about to retry without the accelerator
- **THEN** the system SHALL emit a retry notification naming the episode or
  document being transcribed before starting the fallback attempt
- **AND** SHALL NOT leave the user interface showing a stalled or idle progress
  state during the retry

#### Scenario: A completed run still reports its final phase
- **WHEN** the accelerator-disabled retry completes successfully
- **THEN** the system SHALL emit a completion notification carrying that run's
  segment count and the same identifiers used by the initial attempt

### Requirement: Actionable Classification of Local ASR Failures
The system SHALL classify every failed local speech-to-text run into exactly one
diagnostic category, and SHALL present a short user-facing message that names
the cause and the next step. Raw engine logs SHALL NOT be the primary message
shown to the user. The categories SHALL cover at least: accelerator backend
failure, corrupt or incomplete model, missing engine sidecar, missing shared
library, unsupported audio input, cancellation, and out-of-memory.

#### Scenario: Accelerator failure produces a recovery hint
- **WHEN** a local transcription fails on both the accelerated attempt and the
  accelerator-disabled attempt, or fails with an accelerator backend active and
  no fallback was possible
- **THEN** the surfaced diagnostic SHALL be the accelerator-backend category
- **AND** SHALL state that the compute backend failed and name the fallback or
  the next available option

#### Scenario: Missing model produces a re-download instruction
- **WHEN** a local transcription fails because the model file is absent or fails
  integrity validation
- **THEN** the surfaced diagnostic SHALL be the corrupt-model category
- **AND** SHALL name the model and direct the user to re-download it

#### Scenario: Missing sidecar or library produces a build/dependency hint
- **WHEN** a local transcription fails because the engine sidecar is absent, is a
  zero-byte placeholder, or a required shared library could not be loaded
- **THEN** the surfaced diagnostic SHALL be the missing-sidecar or
  missing-shared-library category
- **AND** SHALL name the missing component

#### Scenario: Raw logs are retained but not shown as the message
- **WHEN** a local transcription fails
- **THEN** the recorded failure reason SHALL retain a bounded excerpt of the
  engine's own output for diagnostics
- **AND** the message presented to the user SHALL NOT be that raw excerpt

#### Scenario: Unclassified failures still report something actionable
- **WHEN** a local transcription fails and no known category matches
- **THEN** the surfaced diagnostic SHALL use the unknown category
- **AND** SHALL still name the model and engine used for the attempt