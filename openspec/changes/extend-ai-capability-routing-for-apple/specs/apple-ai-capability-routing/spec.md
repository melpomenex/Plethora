## ADDED Requirements

### Requirement: Multiple on-device providers in the routing registry

The system SHALL treat on-device generation as zero or more `AIProvider` instances with distinct `id` values, not as a single Gemini Nano singleton. Providers that report `textGeneration: false` SHALL be skipped.

#### Scenario: Android still prefers Nano when available
- **WHEN** the platform is Android, Nano prompt status is `available`, and `preferOnDevice` is true
- **THEN** `getRoutingProviders()` lists `ondevice-gemini-nano` before the cloud provider
- **AND** `resolveAiPath("prompt")` returns `ondevice`

#### Scenario: iOS does not select Nano
- **WHEN** the platform is iOS
- **THEN** Nano capability snapshot remains `platform_unsupported`
- **AND** Nano is not chosen as the serving provider

#### Scenario: Incapable stub is skipped
- **WHEN** `ondevice-apple-foundation` is registered but `getCapabilities().textGeneration` is false
- **THEN** `resolveTaskRoute` does not select that provider for a text task
- **AND** a configured cloud provider is selected if `preferOnDevice` is true and no other on-device provider is live

#### Scenario: Prefer on-device disabled
- **WHEN** `settings.ai.preferOnDevice` is false and a cloud provider is configured
- **THEN** `resolveAiPath` returns `cloud`
- **AND** live Apple/Nano providers are not auto-selected

#### Scenario: New user with only a future live Apple provider
- **WHEN** `preferOnDevice` is true, no cloud provider is configured, and an injected on-device provider reports `textGeneration: true`
- **THEN** `resolveAiPath("prompt")` returns `ondevice`
- **AND** `useAiAvailability` reports `available: true`

### Requirement: Apple intelligence plugin skeleton

The workspace SHALL include `plethora-apple-intelligence` registered like other in-repo plugins. Non-Apple targets SHALL compile without Apple frameworks. The `apple_capabilities` command SHALL return a typed snapshot and SHALL NOT perform inference.

#### Scenario: Desktop status is unsupported
- **WHEN** `apple_capabilities` is invoked on Linux or Windows
- **THEN** every feature reports `unavailable` with reason `platform_unsupported`
- **AND** no native Apple API is called

#### Scenario: Reserved commands fail closed
- **WHEN** a reserved but unimplemented command such as `apple_fm_generate` is invoked
- **THEN** the plugin returns a typed `not_implemented` or `feature_unavailable` error
- **AND** the TypeScript mapper produces `AIError` category `CapabilityUnavailable`

#### Scenario: iOS 14 links
- **WHEN** the iOS target is built with `IPHONEOS_DEPLOYMENT_TARGET = 14.0`
- **THEN** the plugin compiles
- **AND** iOS 26-only types are not referenced without availability guards

#### Scenario: Per-API OS minima in the snapshot
- **WHEN** `apple_capabilities` runs on iOS 18
- **THEN** `naturalLanguageEmbeddings` and `spotlightSemantic` are not forced `unsupported_os` merely because Foundation Models requires 26
- **AND** `foundationModels`, `speech`, and `visionDocuments` report `unsupported_os` (or equivalent) until iOS 26
- **AND** `coreAi` reports `unsupported_os` until iOS 27

### Requirement: Extended AI error taxonomy

`AIErrorCategory` SHALL include `PermissionDenied`, `FeatureDisabled`, and `UnsupportedLanguage` in addition to the existing set. Cancellation SHALL still never trigger cloud fallback.

#### Scenario: Cancelled still does not fall back
- **WHEN** an on-device fake provider aborts via `AbortSignal`
- **THEN** `runAiAction` does not invoke the cloud executor

#### Scenario: Feature disabled maps cleanly
- **WHEN** a native reason `apple_intelligence_disabled` is mapped
- **THEN** the `AIError.category` is `FeatureDisabled`
- **AND** UI copy can distinguish it from `UnsupportedDevice`

#### Scenario: Unsupported OS maps to UnsupportedDevice
- **WHEN** a native reason `unsupported_os` is mapped (iOS/macOS below the API’s minimum)
- **THEN** the `AIError.category` is `UnsupportedDevice`
- **AND** it is not mapped to `FeatureDisabled`

#### Scenario: Permission denied
- **WHEN** a mapped native code is `permission_denied`
- **THEN** `AIError.category` is `PermissionDenied`

### Requirement: Fake providers for CI

The tree SHALL export deterministic fakes so later Apple changes can unit-test routing, fallback, and validation without hardware.

#### Scenario: Scripted structured output
- **WHEN** a test injects `FakeLanguageProvider` that returns a valid `SmartTagging` envelope for `schemaName: "SmartTagging"`
- **THEN** `runTask` on `smart-tagging` validates successfully
- **AND** no Tauri plugin is invoked

#### Scenario: Fake speech/vision/search shapes exist
- **WHEN** a test imports `FakeSpeechProvider`, `FakeVisionProvider`, and `FakeSemanticSearchProvider`
- **THEN** each exposes `status` plus the operations reserved in design.md
- **AND** default implementations resolve with empty/unavailable results rather than throwing

### Requirement: On-device settings panel is cross-platform

`OnDeviceAiPanel` SHALL render on iOS and macOS with Apple snapshot fields, and SHALL continue to render Nano controls only on Android.

#### Scenario: iOS panel without nagging
- **WHEN** an iOS user opens AI settings and Apple FM is unavailable
- **THEN** the panel shows a status explanation
- **AND** no launch-time toast is emitted

#### Scenario: Android panel unchanged in structure
- **WHEN** the platform is Android
- **THEN** Nano status and embedding download controls remain
- **AND** Apple rows are hidden or marked `platform_unsupported`

### Requirement: Platform capability IDs

`platformCapabilities.ts` SHALL register Apple surface IDs. Android and web SHALL mark them unavailable. iOS SHALL mark them available at the OS-family level (runtime snapshot still gates actual inference). Frozen ids: `on_device_ai_apple_foundation`, `apple_speech_transcription`, `import_document_scan`, `import_photo_library`, `apple_spotlight_search`, `on_device_ai_apple_coreai`.

#### Scenario: Command palette can gate scan/record later
- **WHEN** `import_document_scan` is queried on Android
- **THEN** `isPlatformCapabilityAvailable` is false
- **AND** on iOS it is true at the registry level

#### Scenario: Speech palette id is frozen
- **WHEN** Record lecture is gated
- **THEN** the capability id is `apple_speech_transcription`
- **AND** it is not `on_device_apple_speech`

#### Scenario: Core AI id is OS-family, not model-ready
- **WHEN** `on_device_ai_apple_coreai` is queried on iOS
- **THEN** the registry marks it available at the OS-family level even if no `.aimodel` is installed
- **AND** the id is not `apple_core_ai`

### Requirement: Feature flags

`settings.features` SHALL include `appleFoundationModels`, `appleSpotlightIndex`, `appleSpeechTranscription`, `appleVisionScan`, `appleNaturalLanguageEmbeddings` (default true) and `appleCoreAI` (default false). Flags SHALL hide UI, not break native stubs.

#### Scenario: Core AI flag off
- **WHEN** `appleCoreAI` is false
- **THEN** routing never selects `ondevice-apple-coreai`
- **AND** the Core AI settings row is hidden

### Requirement: Privacy diagnostics unchanged

Diagnostics SHALL NOT record document text, prompts, transcripts, or card contents.

#### Scenario: Routing diagnostic
- **WHEN** a fake on-device run records a diagnostic
- **THEN** the entry includes `providerId` and `providerKind`
- **AND** it does not include the prompt body

## MODIFIED Requirements

### Requirement: Capability-aware availability (ai-task-architecture)

`useAiAvailability` SHALL consider any live on-device provider plus cloud, not only Nano.

#### Scenario: Availability true on injected Apple-capable fake
- **WHEN** tests inject a live on-device provider and no cloud provider
- **THEN** `useAiAvailability("prompt").available` is true after resolution
