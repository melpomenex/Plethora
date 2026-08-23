## MODIFIED Requirements

### Requirement: Unified AI error taxonomy with graceful degradation
All AI failures SHALL map to the domain error set including the original categories (ModelUnavailable, ModelDownloading, UnsupportedDevice, CapabilityUnavailable, InputTooLarge, GenerationFailed, InvalidStructuredOutput, SafetyBlocked, EmbeddingUnavailable, IndexUnavailable, IndexBuilding, VisionUnavailable, OCRFailed, ProviderOffline, Cancelled) **and** Busy, QuotaExceeded, BatteryQuotaExceeded, ForegroundRequired, PermissionDenied, ModelDownloadRequired, ResourceExhausted. UX SHALL degrade gracefully per category. Native provider codes SHALL NOT be inspected in React components.

#### Scenario: Cancelled requests never fall back to cloud
- **WHEN** a user cancels an on-device request that would have fallen back to cloud on failure
- **THEN** the cancellation propagates without invoking any cloud provider

#### Scenario: Background GenAI use is foreground-required
- **GIVEN** a native provider reports `background_use_blocked`
- **WHEN** the error is mapped through `toAIError`
- **THEN** the category is `ForegroundRequired`
- **AND** no partially generated artifact is persisted as completed
- **AND** cloud fallback is not triggered unless `allowCloudFallback === true` **and** the user is still in a context where sending content is acceptable; default SHALL NOT fall back

#### Scenario: Battery quota is distinct from generic failure
- **GIVEN** a native provider reports `battery_quota_exceeded`
- **WHEN** the error is mapped
- **THEN** the category is `BatteryQuotaExceeded`
- **AND** the UI offers wait/retry later rather than immediately re-invoking the API

#### Scenario: Busy uses bounded retry only at the provider
- **GIVEN** a native provider reports `busy`
- **THEN** the category is `Busy`
- **AND** application code SHALL NOT start additional parallel GenAI calls against the same device model

#### Scenario: Cloud fallback helper is explicit opt-in
- **GIVEN** `settings.ai.allowCloudFallback` is `false` or unset
- **WHEN** `allowCloudFallback()` is evaluated
- **THEN** it returns false
- **AND** an on-device failure does not transmit content to a paid cloud provider without the existing consent surface

#### Scenario: Model downloadable is actionable
- **WHEN** a capability is supported but the model is not present
- **THEN** the error category is `ModelDownloadRequired` or the capability descriptor reports `requiresDownload`
- **AND** the UI is not told the device is permanently unsupported

### Requirement: Capability-aware availability
Feature UI SHALL render a control as available only when the required generative or platform capability is **ready** (or a permitted fallback provider is ready). Values SHALL come from live detection. Temporarily not-ready SHALL be distinguished from unsupported.

#### Scenario: Gemini supported but not ready
- **GIVEN** an Android device where a GenAI feature status is `DOWNLOADING` or AICore initialization is incomplete
- **WHEN** Plethora evaluates generative availability
- **THEN** the UI indicates a temporary not-ready/download state
- **AND** does not use copy equivalent to “this phone does not support on-device AI”

#### Scenario: Airplane mode after preparation
- **GIVEN** a capability with `onDevice: true` and `ready: true`
- **WHEN** the device has no network
- **THEN** the capability remains usable
- **AND** no cloud provider is invoked as a side effect of the offline check

#### Scenario: Unsupported generative hardware still imports
- **GIVEN** Android without Gemini Nano
- **WHEN** the user imports a document
- **THEN** import, reading, review, lexical search, and Smart Tagging tier 1 remain functional
- **AND** generative on-device actions are hidden or disabled, not crashed

## ADDED Requirements

### Requirement: Enrichment cost tiers
Automatic post-import work SHALL be limited to cheap operations. Expensive generative enrichment SHALL require an explicit user action (or an explicit user-enabled optional setting that is off by default).

#### Scenario: Import does not auto-generate flashcards
- **WHEN** a user imports an article on a Nano-ready device with no cloud key
- **THEN** the document is parsed and indexed with cheap tagging if enabled
- **AND** full summary and flashcard generation do not start automatically

#### Scenario: User requests cards
- **WHEN** the user chooses “Generate cards”
- **THEN** the existing card-generation contract runs through the task layer
- **AND** routing follows prefer-on-device / fallback policy

### Requirement: On-device privacy presentation
When a generative or transcription run completes entirely on-device, the originating surface MAY show a single “On-device” (or equivalent) indicator for that run. The system SHALL NOT badge every generated sentence. If a cloud fallback occurred, the indicator SHALL NOT claim on-device processing.

#### Scenario: Fallback clears the on-device claim
- **GIVEN** an on-device attempt that retried on a cloud provider with explicit policy
- **WHEN** results are shown
- **THEN** the run is not labeled as processed only on-device

### Requirement: Platform ML capability interfaces
Shared TypeScript SHALL expose provider-neutral `identifyLanguage`, `transcribeAudio`/`transcribeLiveAudio`, `scanDocument`/`recognizeText`, and `semanticSearch` interfaces with Fake implementations. Feature code SHALL depend on these interfaces, not on ML Kit or Gemini type names.

#### Scenario: Fake speech provider is deterministic
- **WHEN** unit tests call `transcribeAudio` on `FakeSpeechProvider` with a fixture
- **THEN** the returned transcript matches the fixture
- **AND** no native plugin is invoked

#### Scenario: Help and library corpora stay separate
- **WHEN** a retriever pairing is constructed for Ask Plethora help vs Ask my library
- **THEN** the two logical indexes/namespaces are not mixed in a single uncontrolled corpus
