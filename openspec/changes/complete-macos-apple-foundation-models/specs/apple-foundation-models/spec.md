## MODIFIED Requirements

### Requirement: Availability mapping from SystemLanguageModel.Availability

The system SHALL map Apple's availability enum (and documented disabled / unsupported-OS cases) onto `AIModelCapabilities` and A's `AIErrorCategory` values without performing generation as a side effect of the check. The bridge SHALL query `SystemLanguageModel.default.availability` on iOS and macOS 26+ rather than returning a hard-coded `model_not_ready`.

#### Scenario: Model is available
- **WHEN** `SystemLanguageModel.default.availability` is `available` and the request language is supported
- **THEN** `textGeneration` is true, `offlineAvailable` is true, and `downloadState` is `downloaded`
- **AND** checking availability does not start inference or Private Cloud Compute

#### Scenario: Device is not eligible
- **WHEN** availability is `deviceNotEligible`
- **THEN** `textGeneration` is false
- **AND** an attempted generate reports `UnsupportedDevice`

#### Scenario: Model is not ready
- **WHEN** availability is `modelNotReady`
- **THEN** `downloadState` is `downloading` or `downloadable`
- **AND** an attempted generate reports `ModelDownloading`

#### Scenario: Apple Intelligence is disabled
- **WHEN** the user has not enabled Apple Intelligence
- **THEN** `textGeneration` is false
- **AND** an attempted generate reports `FeatureDisabled`

#### Scenario: OS below Foundation Models
- **WHEN** the process runs on iOS/iPadOS/macOS below 26.0
- **THEN** availability is `unsupported_os` / `platform_unsupported`
- **AND** the deployment target still links via weak framework

#### Scenario: macOS desktop available
- **WHEN** availability is requested on macOS 26+ desktop
- **THEN** the bridge queries FoundationModels natively
- **AND** does not return `platform_unsupported` solely because the host is not iOS

### Requirement: Guided structured generation matching TypeScript schemas

When `AIRequest.structured` is true, the bridge SHALL use guided `@Generable` output whose JSON validates against the existing TypeScript schema named by `schemaName`. Session instructions SHALL be passed via `LanguageModelSession(instructions:)` rather than concatenating trusted instructions into untrusted prompt text when the API supports it.

#### Scenario: Smart tagging structured output
- **WHEN** `runTask` executes `smart-tagging` with `schemaName` `smartTagging`
- **THEN** native guided output matches `SmartTaggingOutput`
- **AND** `validateSmartTaggingOutput` succeeds before tags are shown

#### Scenario: System instructions applied
- **WHEN** `AIRequest.systemInstruction` is non-empty
- **THEN** the native session uses it as session instructions
- **AND** untrusted document text remains in the user prompt only

#### Scenario: Response content extraction
- **WHEN** generation completes successfully
- **THEN** the bridge returns `response.content` as text
- **AND** does not use `String(describing: response)`

### Requirement: Streaming generation

The provider SHALL stream partial output through the native boundary when the SDK supports streaming.

#### Scenario: Real streaming
- **WHEN** `generateStream` is called with streaming-capable capabilities
- **THEN** partial chunks arrive before completion
- **AND** `onChunk` is invoked for each partial

#### Scenario: Capabilities advertise streaming
- **WHEN** FM is available and streaming is implemented
- **THEN** `getCapabilities().streaming` is true
