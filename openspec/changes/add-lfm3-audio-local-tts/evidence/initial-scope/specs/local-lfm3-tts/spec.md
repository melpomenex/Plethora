## Purpose

Provide private native LFM3 narration through Plethora's existing speech and audio systems, with truthful capabilities, bounded resource use and verified device readiness.

## ADDED Requirements

### Requirement: LFM3 is a normal local speech provider
The system SHALL expose LFM3 (On-device) through the existing speech provider selection and dispatch, using the same configuration and synthesis identity for live reading, document previews and Audio Editions. It SHALL require no API key or microphone permission and SHALL NOT silently route an unavailable LFM3 request to System, cloud or another model.

#### Scenario: Same narrator across workflows
- **WHEN** a user chooses the same installed LFM3 model, voice and locale for live reading and an Audio Edition
- **THEN** both workflows SHALL use the same validated provider configuration and local engine

#### Scenario: Missing native provider
- **WHEN** a saved LFM3 preference is opened on a device without its runtime or complete model
- **THEN** the system SHALL show the unavailable state and required action without executing another provider

### Requirement: Capabilities describe validated speech behavior
LFM3 SHALL offer only the female and male base voices, explicit supported locale choices and validated output formats. Initial output SHALL be 24 kHz mono WAV. Native cloning, measured word timing, style/instruction/pitch conditioning and synthesis-speed control SHALL NOT be advertised without new verified support. Player playback-rate controls SHALL remain available independently of synthesis speed. Input limits SHALL reflect app safety and runtime token/output budgets, not confuse model token context with character capacity.

#### Scenario: Built-in voice roster
- **WHEN** the LFM3 narrator selector is opened
- **THEN** it SHALL identify female and male base voices without fabricated named speakers or voice-cloning controls

#### Scenario: American and British English
- **WHEN** the user selects an enabled American or British English locale
- **THEN** the system SHALL preserve that locale in synthesis and cache identity and use the matching validated language prompt

#### Scenario: Unvalidated locale or oversized input
- **WHEN** a request contains an unavailable locale or exceeds a validated input/context budget
- **THEN** the system SHALL reject it with an actionable validation error or resegment it without dropping text, rather than silently changing language or truncating speech

### Requirement: Native model resources have one controlled lifecycle
The system SHALL lazily load at most one LFM3 model configuration, share concurrent same-configuration loads, reuse healthy loaded weights across utterances, reset utterance state between requests and support explicit unload. Inference and loading SHALL NOT block the WebView or application event loop. Unload, failed load, app exit and unrecoverable cancellation SHALL reclaim the process and model resources before another instance is admitted.

#### Scenario: Concurrent first requests
- **WHEN** preview and reading request the same unloaded model concurrently
- **THEN** only one model load SHALL occur and synthesis SHALL remain bounded to one active request

#### Scenario: Configuration replacement
- **WHEN** an operation requires another model configuration
- **THEN** prior work SHALL be drained or cancelled and its resources retired before the replacement model is loaded

#### Scenario: Insufficient memory
- **WHEN** memory preflight or native allocation fails
- **THEN** the request SHALL fail with a local memory explanation, release partial resources and preserve valid cached and edition assets

### Requirement: Cancellation is bounded and stale results cannot act
Every synthesis consumer SHALL be cancellable with session/configuration identity and a generation epoch. Stop, seek, provider changes, source changes and revoked playback focus SHALL invalidate obsolete consumers immediately. Obsolete results/events SHALL NOT play audio, advance a new session or commit deleted/stale edition work. Shared synthesis SHALL continue for remaining valid consumers. Non-cooperative native work SHALL be terminated and reaped within the validated cancellation deadline; no replacement instance SHALL overlap it.

#### Scenario: Stop during load
- **WHEN** the user stops before model loading finishes
- **THEN** no load completion SHALL start playback and the load SHALL cancel or its host SHALL be retired by the deadline

#### Scenario: Retarget before old completion
- **WHEN** a new reading session starts before old inference or an old audio completion event arrives
- **THEN** old events SHALL NOT change the new session's audio, position, highlight or controls

#### Scenario: One deduplicated consumer cancels
- **WHEN** two consumers share an identical synthesis and only one cancels
- **THEN** the remaining consumer SHALL receive the valid result without a second inference

### Requirement: Synthesis scheduling is bounded and prioritizes listening
The system SHALL bound active inference, pending requests, resident audio and look-ahead independently of document length. Current live playback SHALL take priority over background edition generation; editions SHALL share safe generation windows fairly without taking audio focus. Over-cap work SHALL wait durably or receive an actionable busy state, never cause uncontrolled process/thread creation.

#### Scenario: Live request preempts background work
- **WHEN** live playback needs its next segment while an edition is generating
- **THEN** the edition SHALL yield at a bounded cancellation/segment boundary, retain committed work and remain resumable

#### Scenario: Multiple editions and rapid controls
- **WHEN** many edition jobs and rapidly superseded reader requests are submitted
- **THEN** native queued requests and resident clips SHALL remain within configured bounds and stale work SHALL not delay current playback indefinitely

### Requirement: Delivery and streaming claims are accurate
Initial LFM3 playback SHALL consume completed, bounded sentence or clause clips with controlled prefetch. It SHALL be identified as complete-segment delivery even if the underlying model can emit incremental PCM. A future streaming claim SHALL require incremental playable transport and end-to-end acceptance through the existing player. Native audio files/handles SHALL be used without book-sized audio payloads in JSON IPC or whole-book PCM in memory.

#### Scenario: Upstream streams but adapter returns files
- **WHEN** the runtime generates PCM incrementally but the adapter returns only complete clips
- **THEN** the system SHALL NOT report the app provider as supporting true incremental audio delivery

#### Scenario: Long book generation
- **WHEN** the source contains hours of narration
- **THEN** audio SHALL be generated/written in bounded units and no whole-book PCM or base64 audio SHALL be materialized in the WebView

### Requirement: Cache identity prevents wrong narration reuse
LFM3 cache identity SHALL include immutable backbone/projector revisions and hashes, effective voice/locale, normalized text, normalization/segmentation and sampling profile, seed, output format and output-affecting runtime/backend configuration. Identical concurrent work SHALL deduplicate. Changed speech identity SHALL NOT hit a legacy or incompatible entry. Playback-rate-only changes SHALL reuse unchanged LFM3 audio.

#### Scenario: Voice locale or projector changes
- **WHEN** identical text is requested with a different voice, locale, model revision or projector
- **THEN** incompatible cached speech SHALL NOT be reused

#### Scenario: Same clip at a new listening rate
- **WHEN** only LFM3 playback rate changes
- **THEN** the existing generated audio SHALL remain reusable and SHALL play at the requested rate

### Requirement: Audio cache and permanent files have safe ownership
Only complete validated audio SHALL enter the durable cache. Cache writes SHALL be safe under interruption and eviction SHALL honor playback/generation leases and the configured storage budget. Clearing disposable speech cache SHALL NOT remove permanent Audio Edition audio or source documents. Corrupt/missing cache assets SHALL be treated as misses.

#### Scenario: Clear cache while playing
- **WHEN** the user clears cache during playback of a leased clip
- **THEN** playback SHALL remain valid until lease release and permanent editions SHALL remain intact

#### Scenario: Cancel while writing
- **WHEN** synthesis is cancelled during file creation
- **THEN** partial audio SHALL NOT become a successful cache entry and temporary files SHALL be recoverably cleaned

### Requirement: Output validation and retries are bounded
LFM3 generation SHALL enforce input, frame, duration, wall-time and resource limits. Invalid, empty, truncated or corrupted output SHALL fail without invented filler or silent section skipping. Retryable synthesis failures SHALL have a bounded recorded retry policy; cancellation, missing prerequisites and disk exhaustion SHALL NOT trigger automatic synthesis loops.

#### Scenario: Model never reaches end of audio
- **WHEN** generation reaches its output or time limit before valid termination
- **THEN** the segment SHALL be reported failed/truncated and SHALL NOT be cached or marked ready

#### Scenario: Repeated invalid output
- **WHEN** a permitted automatic retry also produces invalid output
- **THEN** the system SHALL expose a failed segment and explicit Retry action while retaining completed work

### Requirement: Local privacy and artifact trust are enforced
Installed LFM3 synthesis SHALL work offline without document transmission, remote-code execution, unnecessary microphone permission or an unauthenticated inference server. Downloading weights/runtime assets SHALL require explicit user action and display licensing/storage information. Native execution SHALL use trusted versioned runtime artifacts, bounded requests, validated contained paths and text-free diagnostics.

#### Scenario: Offline generation after restart
- **WHEN** the app restarts offline with a complete compatible installation
- **THEN** new local synthesis and cached/edition playback SHALL work without any remote speech request

#### Scenario: Repository offers executable code
- **WHEN** model files include scripts or custom loaders
- **THEN** the LFM3 installer/runtime SHALL treat them as untrusted data and SHALL NOT execute them

### Requirement: Platform and workflow support is evidence gated
The system SHALL distinguish installed assets, runnable backend, edition-only performance and live-ready performance. Each advertised desktop backend SHALL pass actual-model and packaged-app validation, including latency/RTF, cancellation, memory, quality and lifecycle. Unvalidated Android/iOS inference SHALL remain deferred and unavailable. Model license conditions and runtime/dependency notices SHALL be satisfied before the affected distribution is enabled.

#### Scenario: Real model is slower than playback
- **WHEN** a backend generates valid audio but fails live latency/throughput acceptance
- **THEN** it SHALL be labeled edition-only or disabled for live narration without claiming real-time readiness

#### Scenario: Mobile contains fitting weights
- **WHEN** an Android or iOS device has enough storage for the model but no validated complete native backend
- **THEN** LFM3 synthesis SHALL remain unavailable and existing providers SHALL remain usable
