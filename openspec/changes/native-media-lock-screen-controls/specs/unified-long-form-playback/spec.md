# Unified Long-Form Playback

## ADDED Requirements

### Requirement: Long-form sources SHALL share one playback session contract

Podcasts, local/generated audiobooks, Audio Editions, browser documents, reader-generated audio, Web Speech, and native Android TTS SHALL expose a source identity, source kind, metadata, supported actions, playback state, position capability, and section/anchor information through one session contract.

#### Scenario: A podcast and an Audio Edition are switched

- **WHEN** the active source changes between either source type
- **THEN** the same dispatcher and platform bridge SHALL continue operating with the new source identity and metadata

#### Scenario: A reader TTS source is active

- **WHEN** `ReaderTTSControls` or a `useTTS` path starts speech
- **THEN** it SHALL register the active session rather than bypassing the canonical remote-media bridge

### Requirement: Session adapters SHALL expose honest control capabilities

An adapter SHALL advertise whether it supports precise seek, relative seek, next/previous section, pause/resume, and position reporting. Web Speech or sentence-based native TTS SHALL not claim sample-accurate seeking when it cannot provide it.

#### Scenario: Generated audio has a real duration

- **WHEN** a generated audio element reports duration and time
- **THEN** the session SHALL publish those values and support the configured seek actions

#### Scenario: System speech cannot seek precisely

- **WHEN** the active source reports sentence-level progress only
- **THEN** the session SHALL expose sentence/section navigation and an honest non-precise seek capability

### Requirement: Normal and Study Mode SHALL preserve dispatcher semantics

Play/pause SHALL remain transport in all modes. In Study Mode, only configured secondary commands SHALL map to capture/review actions, using existing settings and durable provenance; native OS surfaces SHALL send the same normalized commands as in-app controls.

#### Scenario: The user presses play/pause in Study Mode

- **WHEN** the OS or in-app control emits play or pause
- **THEN** the active source SHALL play or pause and SHALL not trigger a study capture action

#### Scenario: The user presses the configured next action in Study Mode

- **WHEN** the normalized next command is received
- **THEN** the dispatcher SHALL apply the configured study mapping and preserve the existing capture/session behavior

### Requirement: Playback commands SHALL update reading and listening synchronization

Accepted commands and adapter progress SHALL update the existing Audio Edition anchors, reader chunk/sentence position, podcast/audiobook position, and listening-session tracker using the active source identity and newest state.

#### Scenario: Playback resumes after a background interruption

- **WHEN** the source resumes from a persisted position
- **THEN** the reader/listening state SHALL restore the matching section/anchor and SHALL not apply a position from a different source

#### Scenario: A remote seek changes the active position

- **WHEN** a native or desktop seek is accepted
- **THEN** in-app highlighting and listening-session position SHALL reflect that seek through the same sync path

### Requirement: Only one production bridge SHALL own active session wiring

Production playback hosts SHALL not register competing direct media-session action handlers or independent native command routers. The canonical bridge SHALL attach/detach idempotently as the active source changes.

#### Scenario: A reader view mounts twice during navigation

- **WHEN** a view remounts while the same source is active
- **THEN** only one active adapter/bridge registration SHALL remain and commands SHALL be applied once
