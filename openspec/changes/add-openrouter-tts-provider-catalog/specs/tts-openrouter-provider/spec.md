## ADDED Requirements

### Requirement: OpenRouter speech synthesis

The system SHALL synthesize speech through OpenRouter's dedicated TTS endpoint, `POST https://openrouter.ai/api/v1/audio/speech`, authenticated with a bearer token.

The request body SHALL include `model` and `input`, and SHALL include `voice`, `response_format`, and `speed` when the selected model supports them. The response body is raw audio bytes, not JSON.

#### Scenario: Successful synthesis

- **WHEN** the user plays text with provider `openrouter`, model `hexgrad/kokoro-82m`, and voice `af_bella`
- **THEN** the system POSTs `{model: "hexgrad/kokoro-82m", input: <text>, voice: "af_bella", response_format: "mp3"}` with an `Authorization: Bearer <key>` header
- **AND** wraps the returned bytes in a blob with MIME type `audio/mpeg` for playback

#### Scenario: Response format selection

- **WHEN** the user selects response format `pcm`
- **THEN** the request sends `response_format: "pcm"` and the response is treated as `audio/pcm`
- **AND** when no format is selected, the system sends `mp3` explicitly rather than relying on the endpoint default

#### Scenario: Speed only when supported

- **WHEN** the selected model's catalog entry does not list speed among its supported parameters
- **THEN** the request omits `speed` and the UI does not present a speed control for that model

#### Scenario: Instructions passthrough

- **WHEN** the selected model is served by a provider that accepts tone instructions and the user has entered an instructions value
- **THEN** the request includes it under the provider options passthrough object rather than as a top-level field

#### Scenario: Empty response body

- **WHEN** OpenRouter returns HTTP 200 with a zero-length body
- **THEN** the system raises a recoverable provider error and does not write a cache entry

### Requirement: Speech model catalog

The system SHALL discover OpenRouter's available speech models at runtime from `GET https://openrouter.ai/api/v1/models?output_modalities=speech`, rather than shipping a hardcoded model list.

For each model the system SHALL retain its id, display name, description, `supported_voices`, `supported_parameters`, `context_length`, and pricing.

#### Scenario: Catalog populates the model picker

- **WHEN** the user opens the model picker for provider `openrouter` with a valid key
- **THEN** every model returned by the catalog query is listed with its display name and vendor

#### Scenario: Voices come from the catalog

- **WHEN** the user selects model `google/gemini-3.1-flash-tts-preview`
- **THEN** the voice list shows exactly that model's `supported_voices` entries
- **AND** voices belonging to other models are not offered

#### Scenario: Switching model invalidates an incompatible voice

- **WHEN** the user switches from a model to one whose `supported_voices` does not include the currently selected voice
- **THEN** the selection resets to that model's first supported voice and the change is indicated in the UI
- **AND** synthesis is never attempted with a voice the selected model does not support

#### Scenario: Catalog request fails

- **WHEN** the catalog request fails or the device is offline
- **THEN** the picker falls back to the bundled snapshot, labels the list as possibly out of date, and offers a retry
- **AND** a previously selected model and voice remain usable for synthesis

### Requirement: Catalog caching and refresh

Catalog results SHALL be cached with a time-to-live so that opening settings does not issue a network request on every visit, and SHALL be manually refreshable.

The system SHALL ship a bundled snapshot of the catalog as the offline and first-run fallback.

#### Scenario: Cached catalog is reused

- **WHEN** the user opens the model picker within the cache TTL of a successful fetch
- **THEN** the cached catalog is used and no network request is issued

#### Scenario: Manual refresh

- **WHEN** the user activates the refresh control
- **THEN** the system re-fetches the catalog regardless of TTL, replaces the cache on success, and reports the result
- **AND** on failure it keeps the previously cached catalog rather than emptying the picker

#### Scenario: First run without network

- **WHEN** the user opens the model picker with no cached catalog and no network
- **THEN** the bundled snapshot is shown and marked as offline data

### Requirement: Custom voice identifiers

For models whose catalog entry reports `supported_voices` as `null` — such as Fish Audio and MiniMax, which accept arbitrary vendor-side voice ids — the system SHALL allow the user to enter a voice id directly and save it as a named, reusable voice profile.

#### Scenario: Entering a custom voice id

- **WHEN** the selected model reports no enumerable voices
- **THEN** the voice picker presents a text field for a vendor voice id, with a link to that vendor's voice documentation, instead of an empty list

#### Scenario: Saving a custom voice

- **WHEN** the user names and saves a custom voice id
- **THEN** it is stored as a voice profile scoped to that provider and model and appears in the picker on subsequent visits

#### Scenario: Voice required but missing

- **WHEN** synthesis is attempted for a model that requires a voice and none is set
- **THEN** the system raises a validation error naming the model before issuing the request, rather than surfacing the endpoint's rejection

### Requirement: Cost transparency

Because OpenRouter speech model prices span more than two orders of magnitude, the system SHALL surface each model's relative cost at the point of selection.

#### Scenario: Price shown in the model picker

- **WHEN** the model picker is displayed
- **THEN** each model card shows its input price normalized to a per-million-tokens figure derived from the catalog's pricing field

#### Scenario: Relative cost tiers

- **WHEN** models are listed
- **THEN** each carries a cost tier badge derived from its price relative to the others in the catalog, so the cheapest and most expensive options are distinguishable at a glance

#### Scenario: Pricing unavailable

- **WHEN** a catalog entry has no usable pricing data
- **THEN** the card omits the price rather than displaying a zero or placeholder value

### Requirement: OpenRouter error handling

OpenRouter failures SHALL be classified into the existing TTS error codes so that retry behavior and user-facing messages match the rest of the TTS system.

#### Scenario: Authentication failure

- **WHEN** OpenRouter returns 401 or 403
- **THEN** the system raises a non-recoverable `auth` error naming OpenRouter and pointing at the key configuration
- **AND** does not retry

#### Scenario: Rate limiting

- **WHEN** OpenRouter returns 429
- **THEN** the system raises a recoverable `rate_limit` error and retries with backoff up to the existing retry limit

#### Scenario: Model unavailable or invalid

- **WHEN** OpenRouter rejects the request because the model or voice is invalid or unavailable
- **THEN** the error message includes the provider's explanation and the offending model id, and the request is not retried

#### Scenario: Insufficient credits

- **WHEN** OpenRouter returns 402
- **THEN** the system raises a non-recoverable error stating that the OpenRouter account is out of credits, and does not retry
