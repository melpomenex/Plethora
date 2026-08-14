## ADDED Requirements

### Requirement: On-device AI capability detection
The system SHALL expose a capability check that reports on-device generative AI status as one of `available`, `downloadable`, `downloading`, or `unavailable`, without performing inference and without triggering a model download.

#### Scenario: Supported device with model ready
- **WHEN** `isOnDeviceAiAvailable()` is called on an Android device whose ML Kit GenAI feature status is `AVAILABLE`
- **THEN** the system returns status `available`

#### Scenario: Supported device with model not yet downloaded
- **WHEN** the ML Kit GenAI feature status is `DOWNLOADABLE`
- **THEN** the system returns status `downloadable`
- **AND** no download is started as a side effect of the check

#### Scenario: Model download in progress
- **WHEN** the ML Kit GenAI feature status is `DOWNLOADING`
- **THEN** the system returns status `downloading`
- **AND** the result is not cached for the session

#### Scenario: Unsupported hardware or missing Play Services
- **WHEN** the device does not support AICore, or Google Play Services GenAI is missing
- **THEN** the system returns status `unavailable` with a machine-readable reason
- **AND** the check does not throw

#### Scenario: Non-Android platform
- **WHEN** `isOnDeviceAiAvailable()` is called on desktop, iOS, or in the browser build
- **THEN** the system returns status `unavailable` with reason `platform_unsupported`
- **AND** no native plugin call is attempted

### Requirement: On-device text summarization
The system SHALL provide a summarization call that takes text and a requested output format and returns summary text produced entirely on the device.

#### Scenario: Summarize text within the context budget
- **WHEN** `summarize()` is called with text below the configured token budget and on-device status is `available`
- **THEN** the system returns a summary string generated on-device
- **AND** no network request is made

#### Scenario: Requested output format is honoured
- **WHEN** `summarize()` is called with format `bullets`
- **THEN** the returned summary is a bullet-style summary
- **AND** when called with format `paragraph` the returned summary is prose

#### Scenario: Summarization requested while model unavailable
- **WHEN** `summarize()` is called and on-device status is not `available`
- **THEN** the system rejects with a typed error naming the current status
- **AND** does not block waiting for a model download

### Requirement: On-device prompt generation
The system SHALL provide a free-form prompt call used to generate flashcards and cloze candidates from extract text.

#### Scenario: Prompt returns model completion
- **WHEN** `generatePrompt()` is called with a prompt within the context budget and on-device status is `available`
- **THEN** the system returns the model's completion text

#### Scenario: Generated flashcards parse into the app card shape
- **WHEN** `generateFlashcards()` is called for an extract and the model returns line-oriented `Q:`/`A:`/`CLOZE:` output
- **THEN** the system returns `GeneratedFlashcard` objects with `question`, `answer`, `card_type` of `qa` or `cloze`, and `tags`
- **AND** lines that cannot be classified are discarded rather than emitted as malformed cards

#### Scenario: Model returns unusable output
- **WHEN** the completion contains no parsable question/answer or cloze lines
- **THEN** the system returns an empty card list and reports a parse failure to the caller
- **AND** does not create any flashcard

### Requirement: Context window handling
The system SHALL keep every on-device invocation within the model's context window by chunking input before invocation, and SHALL NOT rely on native-side truncation.

#### Scenario: Long text is chunked
- **WHEN** input text exceeds the configured token budget
- **THEN** `chunkTextByTokens` splits it at paragraph, then sentence, boundaries into chunks each within the budget

#### Scenario: Multi-chunk summarization is hierarchical
- **WHEN** a summarization input produces more than one chunk
- **THEN** the system summarizes each chunk and then summarizes the combined chunk summaries until the result fits the budget
- **AND** returns a single summary string

#### Scenario: Multi-chunk flashcard generation respects the requested count
- **WHEN** flashcards are generated across multiple chunks with a requested count of N
- **THEN** the system returns at most N cards

#### Scenario: Oversized single unit cannot be split
- **WHEN** a single sentence exceeds the token budget
- **THEN** the system hard-splits it on a character boundary within the budget rather than passing it to the model whole

### Requirement: Fallback and platform safety
The system SHALL keep all non-Android targets compiling and behaving as before, and SHALL fall back to the configured cloud provider whenever on-device inference is unavailable or fails.

#### Scenario: Desktop build compiles without the Android bridge
- **WHEN** the workspace is built for a non-Android target
- **THEN** the plugin's stub implementation is compiled
- **AND** the build succeeds with no Android or JNI dependency

#### Scenario: Cloud fallback on unavailable on-device AI
- **WHEN** an AI action runs on a device where on-device status is not `available` and a cloud provider is configured
- **THEN** the system performs the action through the existing cloud provider path

#### Scenario: Cloud fallback on mid-call failure
- **WHEN** an on-device call fails after starting and a cloud provider is configured
- **THEN** the system retries the action through the cloud provider
- **AND** informs the user that on-device inference fell back

#### Scenario: No provider available at all
- **WHEN** on-device status is `unavailable` and no cloud provider is configured
- **THEN** AI-assisted controls are not offered in the UI

#### Scenario: User preference disables on-device inference
- **WHEN** the `preferOnDevice` setting is off
- **THEN** AI actions use the configured cloud provider even when on-device status is `available`
