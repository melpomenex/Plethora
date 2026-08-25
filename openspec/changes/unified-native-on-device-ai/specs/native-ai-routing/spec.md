## ADDED Requirements

### Requirement: Windows native AI capability snapshot
The system SHALL expose `windows_capabilities` returning a typed snapshot with per-feature `FeatureState` for `languageModel`, `ocr`, `imageDescription`, and `embeddings`, plus `windowsOs`, `packageIdentity`, `checkedAt`.

#### Scenario: NSIS build without package identity
- **GIVEN** Plethora running from an NSIS install without MSIX package identity
- **WHEN** `windows_capabilities` is invoked on Windows 11
- **THEN** `languageModel.status` is `unavailable`
- **AND** `languageModel.reason` is `package_identity_missing`
- **AND** the application does not crash

#### Scenario: Non-Windows platform
- **GIVEN** a macOS or Linux build
- **WHEN** `windows_capabilities` is invoked
- **THEN** all features report `platform_unsupported`

### Requirement: Phi Silica readiness is API-authoritative
The Windows plugin SHALL determine Phi Silica readiness via Windows AI `GetReadyState()` when package identity exists, not by inferring from GPU/NPU presence alone.

#### Scenario: Win11 without supported accelerator
- **GIVEN** Windows 11 24H2 reporting `NotSupportedOnCurrentSystem`
- **WHEN** capabilities are queried
- **THEN** `languageModel.reason` reflects unsupported hardware or OS state from the API
- **AND** no WinRT generation call is attempted

### Requirement: Limited Access Feature handling
When stable Phi Silica requires LAF authorization, the system SHALL attempt unlock only when `PLETHORA_WINDOWS_AI_LAF_TOKEN` is set in the environment at runtime.

#### Scenario: LAF token absent
- **GIVEN** Phi Silica requires LAF and no token is configured
- **WHEN** capabilities are queried or generation is requested
- **THEN** status is `limited_access_denied` or equivalent
- **AND** no credentials are logged or persisted

### Requirement: Windows System AI provider
The task router SHALL register `WindowsSystemProvider` (`ondevice-windows-system`) with `kind: "ondevice"` on Windows desktop when `settings.features.windowsSystemAi` is enabled.

#### Scenario: Generation on ready Phi Silica
- **GIVEN** `languageModel` is `available` and user `preferOnDevice` is true
- **WHEN** `runTask` executes a fast-class text task
- **THEN** `WindowsSystemProvider` may serve the request before cloud
- **AND** provenance records on-device execution

### Requirement: Foundry Local provider
The system SHALL register `FoundryLocalProvider` (`ondevice-foundry-local`) with `kind: "local-model"` when Foundry Local runtime responds healthy at the configured base URL.

#### Scenario: Foundry available Phi Silica unavailable
- **GIVEN** Phi Silica unavailable and Foundry Local healthy with a loaded model
- **WHEN** user requests summarization with `preferOnDevice` true
- **THEN** Foundry Local serves the request
- **AND** privacy indicator shows on-device execution

#### Scenario: Model download requires consent
- **GIVEN** Foundry reports a model is not cached
- **WHEN** user has not initiated download in settings
- **THEN** generation returns `ModelDownloadRequired`
- **AND** no multi-gigabyte download starts automatically

### Requirement: Provider precedence preserves explicit choice
When `settings.ai.preferOnDevice` is false, native Windows providers SHALL NOT be selected by `resolveAiPath` or `resolveTaskRoute`.

#### Scenario: User prefers cloud provider
- **GIVEN** `preferOnDevice` is false and OpenRouter is configured
- **WHEN** user runs Ask Library
- **THEN** OpenRouter is used
- **AND** Phi Silica is not invoked

### Requirement: Local-only policy blocks cloud
When `allowCloudFallback` is false, on-device failure SHALL NOT retry on a paid cloud provider.

#### Scenario: Phi Silica busy local-only user
- **GIVEN** `allowCloudFallback` is false and Phi Silica returns Busy
- **WHEN** smart tagging tier 2 runs
- **THEN** tier 1 baseline fallback is used
- **AND** no cloud request is made

### Requirement: Cancellation
Windows and Foundry generation SHALL support cancellation via request id without leaking WinRT exceptions to the UI.

#### Scenario: User cancels passage summarize
- **WHEN** user aborts an in-flight Windows generation
- **THEN** `GenerationCancelled` is surfaced
- **AND** no cloud fallback runs for cancellation

### Requirement: Structured output validation
Programmatic consumers SHALL validate model JSON against task schemas; malformed output SHALL not persist tags or cards.

#### Scenario: Malformed smart tagging JSON
- **GIVEN** Windows text generation returns invalid tag JSON
- **WHEN** smart tagging tier 2 validates output
- **THEN** tier 1 baseline is used
- **AND** invalid tags are not written to the database

### Requirement: Smart Tagging remains usable without LLM
Smart Tagging tier 1 baseline SHALL continue to function when all native and cloud providers are unavailable.

#### Scenario: No AI configured
- **GIVEN** no on-device or cloud provider available
- **WHEN** smart tagging runs
- **THEN** tier 1 baseline produces tags
- **AND** queue item completes without error storm
