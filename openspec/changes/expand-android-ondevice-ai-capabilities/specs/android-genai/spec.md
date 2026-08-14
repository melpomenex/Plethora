## MODIFIED Requirements

### Requirement: On-device AI capability detection
The system SHALL expose independently usable capability states for Prompt, Summarization, and image Prompt, plus optional runtime feature flags, without performing inference or triggering a model download.

#### Scenario: Prompt is available while summarization is unavailable
- **WHEN** Prompt reports `AVAILABLE` and Summarization reports `UNAVAILABLE`
- **THEN** the capability snapshot reports Prompt as `available` and Summarization as `unavailable`
- **AND** prompt-backed actions remain eligible for on-device routing

#### Scenario: Summarization is available while Prompt is unavailable
- **WHEN** Summarization reports `AVAILABLE` and Prompt reports `UNAVAILABLE`
- **THEN** the capability snapshot reports Summarization as `available` and Prompt as `unavailable`
- **AND** summarization actions remain eligible for on-device routing

#### Scenario: Feature is downloadable
- **WHEN** any native feature status is `DOWNLOADABLE`
- **THEN** that feature reports `downloadable` with a machine-readable reason
- **AND** checking the snapshot does not begin a download

#### Scenario: Feature download is in progress
- **WHEN** a native feature status is `DOWNLOADING`
- **THEN** that feature reports `downloading`
- **AND** the transient state is not cached beyond the status poll

#### Scenario: Optional Prompt feature is unsupported
- **WHEN** base Prompt is available but structured output, system instructions, prefix caching, or image input is unsupported
- **THEN** base Prompt remains `available`
- **AND** each optional feature reports false independently

#### Scenario: Capability snapshot expires
- **WHEN** a cached non-transient capability snapshot exceeds its configured TTL
- **THEN** the next capability request rechecks the native clients

#### Scenario: Unsupported hardware or missing Play Services
- **WHEN** a native client cannot be constructed or checked because AICore or the required service is absent
- **THEN** only the affected feature reports `unavailable` with a machine-readable reason
- **AND** the check does not throw

#### Scenario: Non-Android platform
- **WHEN** the capability snapshot is requested on desktop, iOS, or a browser build
- **THEN** every Android GenAI feature reports `unavailable` with reason `platform_unsupported`
- **AND** no native plugin call is attempted

### Requirement: On-device text summarization
The system SHALL summarize text entirely on-device when the Summarization capability is available and SHALL keep Prompt availability independent from Summarization availability.

#### Scenario: Summarize text within the measured input limit
- **WHEN** `summarize()` receives non-empty text and the Summarization capability is `available`
- **THEN** every native summarization request is within the feature's measured input limit
- **AND** the system returns summary text without a network request

#### Scenario: Requested output format is honored
- **WHEN** `summarize()` requests one, two, or three bullets supported by the feature-specific API
- **THEN** the corresponding native output type is used
- **AND** a paragraph request uses the Prompt capability rather than pretending Summarization supports prose

#### Scenario: Supported summary language is selected
- **WHEN** the input language is English, Japanese, or Korean and that configuration is available
- **THEN** the corresponding native Summarization language is used

#### Scenario: Unsupported summary language
- **WHEN** the requested Summarization language/configuration is unavailable but Prompt is available
- **THEN** the action can use a bounded Prompt-based summary
- **AND** the unavailable Summarization adapter does not disable Prompt

#### Scenario: Summarization unavailable
- **WHEN** Summarization status is not `available` and no Prompt-based form was requested
- **THEN** the call rejects with a typed error naming the Summarization status
- **AND** it does not wait for or start a model download

### Requirement: On-device prompt generation
The system SHALL provide configurable text and text-plus-image Prompt requests with measured token accounting, finish metadata, and capability-negotiated output handling.

#### Scenario: Configured text prompt completes
- **WHEN** a text Prompt request is within the measured context budget and Prompt is `available`
- **THEN** the native request applies supported temperature, seed, candidate-count, and maximum-output-token settings
- **AND** returns text, finish reason, input-token count, and base-model identity when available

#### Scenario: Image prompt completes
- **WHEN** an image Prompt request contains a valid bounded image and image Prompt is available
- **THEN** the native request includes the decoded image and related text instruction
- **AND** the response contains no network-derived content

#### Scenario: Structured output is available
- **WHEN** a supported task requests structured output and the device advertises that feature
- **THEN** the native bridge uses the task's Kotlin output schema
- **AND** returns the typed result and structured finish reason

#### Scenario: Structured output is unavailable
- **WHEN** a task prefers structured output but the device does not advertise it
- **THEN** the task uses its validated delimited-text fallback
- **AND** base Prompt remains usable

#### Scenario: Generated flashcards map into the app card shape
- **WHEN** `generateFlashcards()` receives a complete structured or validated fallback result
- **THEN** it returns `GeneratedFlashcard` objects with valid question, answer, card type, tags, and internal source provenance
- **AND** malformed or ungrounded entries are discarded

#### Scenario: User instruction is retained
- **WHEN** Flashcard Studio supplies a card type, difficulty/focus, or custom instruction
- **THEN** the on-device task prompt includes those constraints separately from the source context

#### Scenario: Model returns unusable output
- **WHEN** a completion contains no valid result for the requested output mode
- **THEN** the system reports a typed parse or validation failure
- **AND** does not create a learning artifact

### Requirement: Context window handling
The system SHALL use the native Prompt client to measure final requests, reserve output space, and keep every on-device invocation within the actual model limit without native truncation.

#### Scenario: Runtime limit is available
- **WHEN** Prompt reports its token limit
- **THEN** request budgeting uses that value rather than a fixed global Nano limit

#### Scenario: Candidate chunk is measured
- **WHEN** the estimator produces a candidate chunk
- **THEN** the complete native request, including instructions, prefix, content, and output allowance, is counted before inference

#### Scenario: Measured request is too large
- **WHEN** a measured request exceeds the runtime limit
- **THEN** native inference is not started
- **AND** the caller receives `context_too_large` with measured input and limit metadata

#### Scenario: Long text is subdivided
- **WHEN** a task receives text that cannot fit in one measured request
- **THEN** the TypeScript adapter splits at paragraph, sentence, then hard boundaries and re-measures final requests

#### Scenario: Multi-chunk summarization is hierarchical
- **WHEN** summarization input produces more than one chunk
- **THEN** the system summarizes chunks and reduces the combined summaries until they fit or a bounded reduction limit is reached

#### Scenario: Multi-chunk cards are deduplicated
- **WHEN** card generation runs across multiple chunks
- **THEN** normalized duplicate question/answer and cloze cards are removed before the requested count is enforced

### Requirement: Fallback and platform safety
The system SHALL resolve on-device versus cloud per action capability, keep non-Android targets compiling, and fall back only according to the typed failure policy.

#### Scenario: Desktop build compiles without Android dependencies
- **WHEN** the workspace is built for a non-Android target
- **THEN** the expanded plugin stubs compile without Android or JNI dependencies
- **AND** all Android capabilities report `platform_unsupported`

#### Scenario: Required feature is unavailable
- **WHEN** an action requires a feature whose on-device status is not `available` and a cloud provider is configured
- **THEN** only that action uses the existing cloud path

#### Scenario: Unrelated feature is unavailable
- **WHEN** an action's required feature is available but another on-device feature is unavailable
- **THEN** the action still runs on-device

#### Scenario: Mid-call retryable failure exhausts retries
- **WHEN** a Prompt action exhausts its bounded retry policy and a cloud provider is configured
- **THEN** the action retries through the cloud provider
- **AND** informs the user that on-device inference fell back

#### Scenario: Cancellation
- **WHEN** the user cancels an on-device action
- **THEN** the action does not fall back to cloud
- **AND** reports `cancelled` to the initiating surface

#### Scenario: No path exists
- **WHEN** the required on-device capability is unavailable and no cloud provider is usable
- **THEN** the control is disabled or the action reports a specific unavailable state
- **AND** no generic cloud API-key error is shown for an on-device-capable surface

#### Scenario: User disables on-device inference
- **WHEN** `ai.preferOnDevice` is false
- **THEN** actions use their configured cloud paths even when the required Nano capability is available

## ADDED Requirements

### Requirement: Runtime metadata and token accounting
The system SHALL expose Prompt base-model identity, total token limit, exact request token count, warm-up, and optional feature support through typed bridge calls.

#### Scenario: Runtime metadata is ready
- **WHEN** Prompt is available and runtime metadata is requested
- **THEN** the result includes the base model name and total token limit reported by the client

#### Scenario: Token count includes full request
- **WHEN** token count is requested for a configured Prompt request
- **THEN** it counts the complete request rather than the raw user text alone

#### Scenario: Warm-up succeeds
- **WHEN** the foreground UI explicitly warms Prompt before a likely user action
- **THEN** the bridge initializes the inference runtime without producing a completion

#### Scenario: Diagnostics are recorded
- **WHEN** an on-device run terminates
- **THEN** diagnostics may record model name, token counts, timing, finish reason, feature flags, and error code
- **AND** MUST NOT record source text, prompt text, raw image bytes, or completion content

### Requirement: Streaming and native cancellation
The system SHALL stream Prompt output through request-scoped plugin events and SHALL cancel queued or active native work when requested.

#### Scenario: Streaming text arrives
- **WHEN** a streaming Prompt request produces text
- **THEN** ordered text events carrying its request ID are delivered before the terminal completion event

#### Scenario: Concurrent listeners exist
- **WHEN** listeners for different request IDs are active
- **THEN** each listener processes only events matching its request ID

#### Scenario: Active request is cancelled
- **WHEN** `cancelRequest(requestId)` targets an active native future
- **THEN** the future is cancelled and the request terminates with `cancelled`
- **AND** later callbacks are ignored

#### Scenario: Queued request is cancelled
- **WHEN** cancellation targets a request waiting in the inference queue
- **THEN** it is removed without running inference

#### Scenario: Listener lifecycle ends
- **WHEN** a request completes, errors, is cancelled, or its UI unmounts
- **THEN** its plugin listeners and in-flight registry entry are removed

### Requirement: Native error classification and retry policy
The system SHALL preserve actionable ML Kit failures as stable error codes and SHALL retry only transient busy failures.

#### Scenario: AICore is busy
- **WHEN** ML Kit reports its busy error
- **THEN** the bridge reports `busy`
- **AND** the task applies bounded exponential backoff with jitter unless cancelled

#### Scenario: Battery quota is exceeded
- **WHEN** ML Kit reports per-app battery quota exhaustion
- **THEN** the bridge reports `battery_quota_exceeded`
- **AND** the on-device call is not automatically retried

#### Scenario: App is not foreground
- **WHEN** ML Kit blocks inference because the app is backgrounded
- **THEN** the bridge reports `background_use_blocked`
- **AND** no background retry loop begins

#### Scenario: Safety blocks content
- **WHEN** ML Kit rejects input or output through its safety controls
- **THEN** the bridge reports `safety_blocked`
- **AND** no partial structured artifact is accepted

#### Scenario: Output reaches token limit
- **WHEN** a candidate ends because it reached its maximum output tokens
- **THEN** the response reports that finish reason
- **AND** structured task adapters reject incomplete output

