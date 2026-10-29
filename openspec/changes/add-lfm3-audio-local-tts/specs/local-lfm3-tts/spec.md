## Purpose

Provide LFM3 as an optional local speech provider through Plethora's existing TTS
settings and consumers, with a portable native runtime and truthful capabilities.

## ADDED Requirements

### Requirement: LFM3 is an optional normal speech provider
The system SHALL register LFM3 (On-device) in the existing speech provider registry
and preserve existing selected providers and settings. It SHALL use the same
adapter for previews, reading and existing exportable-audio consumers. It SHALL
require no API key and SHALL NOT silently substitute System or a cloud provider.

#### Scenario: Select installed LFM3
- **WHEN** a user selects an installed compatible LFM3 model
- **THEN** normal speech dispatch SHALL generate local WAV audio through that model

#### Scenario: Runtime or model is unavailable
- **WHEN** the saved LFM3 preference cannot execute on the current target
- **THEN** the preference SHALL remain saved and the app SHALL show an actionable local availability error without changing narrator

### Requirement: Native execution is portable and selects available acceleration
The system SHALL use a shared native runtime implementation for supported desktop
CPU and packaged Metal/CUDA backends. It SHALL select available compatible
acceleration automatically and report the effective backend. It SHALL NOT require
a named GPU model or per-device performance certification. Targets without a
compatible packaged runtime SHALL report unavailability honestly.

#### Scenario: Users have different supported GPUs
- **WHEN** the runtime runs on different compatible graphics devices
- **THEN** backend availability SHALL follow actual runtime/device detection rather than a developer-GPU allowlist

#### Scenario: No acceleration is available
- **WHEN** a compatible CPU runtime is available but a GPU backend is absent
- **THEN** local speech SHALL use the CPU path and disclose the effective backend without claiming GPU execution

### Requirement: Native synthesis is bounded reusable and cancellable
The system SHALL reuse healthy loaded model weights, reset utterance state and
serialize native synthesis. Stop/cancel/unload SHALL invalidate obsolete requests
and release resources, using process termination/reaping for stuck work. Invalid
input, incompatible models and output without valid termination SHALL fail without
publishing successful audio. User text SHALL NOT inject model control tokens.

#### Scenario: Reader prefetch overlaps another request
- **WHEN** several valid bounded requests arrive for the same model
- **THEN** the runtime SHALL share the loaded model and serialize work without superseding unrelated valid consumers

#### Scenario: Stop during native work
- **WHEN** a consumer cancels during load or synthesis
- **THEN** stale output SHALL NOT play and native work SHALL cancel or its process SHALL be terminated and reaped

### Requirement: Capabilities and cache identity match actual speech
LFM3 SHALL expose its female/male base voices, documented locale mapping and
24 kHz mono WAV output. It SHALL NOT advertise cloning, style conditioning,
measured word timestamps or native synthesis-speed control. Existing player
speed remains independent. Cache identity SHALL distinguish immutable model,
runtime profile, voice, locale and text, without unsafe legacy-key fallback.

#### Scenario: English locale changes
- **WHEN** speech changes between en-US and en-GB
- **THEN** prompts SHALL map to the corresponding upstream locale and cached audio SHALL remain distinct

#### Scenario: Shared synthesis consumer cancels
- **WHEN** two consumers share synthesis and one cancels
- **THEN** the other SHALL remain valid and native production SHALL stop only when no consumer remains
