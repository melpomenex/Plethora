## ADDED Requirements

### Requirement: macOS desktop executes Foundation Models

The system SHALL provide a macOS native bridge that links FoundationModels (weak) and executes `apple_fm_*` commands without returning `platform_unsupported` on eligible macOS 26+ hosts.

#### Scenario: macOS command routing
- **WHEN** `apple_fm_generate` is invoked on macOS 26+ with Apple Intelligence available
- **THEN** the Rust plugin delegates to the macOS Swift bridge
- **AND** generation completes on-device
- **AND** the response includes extracted text content

#### Scenario: macOS below 26
- **WHEN** the app runs on macOS below 26.0
- **THEN** availability reports `unsupported_os`
- **AND** the app launches successfully

#### Scenario: Linux and Windows unchanged
- **WHEN** `apple_fm_availability` is invoked on Linux or Windows
- **THEN** the bridge reports `platform_unsupported`
- **AND** no Apple frameworks are linked

### Requirement: macOS streaming and cancellation

The macOS bridge SHALL emit partial tokens through Tauri events and cancel in-flight native tasks.

#### Scenario: Streaming chunks
- **WHEN** `apple_fm_generate_stream` is invoked
- **THEN** the bridge emits `apple-fm://text` events with partial content
- **AND** completes with `apple-fm://complete`

#### Scenario: Mid-stream cancellation
- **WHEN** the user cancels during streaming
- **THEN** the native task is cancelled
- **AND** `apple-fm://error` with code `cancelled` is emitted
- **AND** cloud fallback does not occur

### Requirement: macOS diagnostic smoke path

The system SHALL expose a content-free diagnostic that reports OS, linkage, availability, and provider id for physical Mac verification.

#### Scenario: Diagnostic on eligible Mac
- **WHEN** the diagnostic runs on macOS 26+ with FM available
- **THEN** it reports `ondevice-apple-foundation` and `available`
- **AND** a minimal generation succeeds
