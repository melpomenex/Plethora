## ADDED Requirements

### Requirement: Provider adapter contract

The system SHALL define a single `TTSProviderAdapter` contract that every TTS provider implements, so that adding a provider requires no changes to synthesis call sites, settings persistence, or the selection UI.

Each adapter SHALL declare: a stable `id`, a display label, a `kind` of `cloud` or `local`, an auth descriptor, a capability descriptor (`supportsSpeed`, `supportsInstructions`, `supportsCloning`, `supportsCustomVoiceIds`, `audioFormats`, `maxInputChars`), and the operations `listModels()`, `listVoices(modelId)`, and `synthesize(request)`.

#### Scenario: Synthesis dispatches through the registry

- **WHEN** `generateSpeech()` is called with TTS settings naming provider `P`
- **THEN** the system looks up adapter `P` in the registry and calls its `synthesize()` method
- **AND** no provider-specific branching occurs in `generateSpeech()` itself

#### Scenario: Unknown provider id in persisted settings

- **WHEN** persisted settings name a provider id with no registered adapter
- **THEN** the system falls back to the `system` provider, keeps the unknown id in persisted settings unmodified, and surfaces a non-blocking notice naming the missing provider

#### Scenario: Adapter capabilities drive UI affordances

- **WHEN** the selected provider's adapter reports `supportsInstructions: false`
- **THEN** the settings UI does not render an instructions/tone field for that provider
- **AND** any previously saved instructions value is retained but not sent in synthesis requests

### Requirement: Registered providers

The system SHALL register eight providers: the existing `fal`, `groq`, `pocket`, and `system`, plus `openrouter`, `elevenlabs`, `openai`, and `openai-compatible`.

The `openai-compatible` adapter SHALL accept a user-supplied base URL, API key, model id, and voice id, and SHALL issue requests in the OpenAI `POST {baseUrl}/audio/speech` shape so that self-hosted and long-tail services are reachable without new adapter code.

#### Scenario: ElevenLabs synthesis

- **WHEN** provider `elevenlabs` synthesizes text with voice id `V` and model `M`
- **THEN** the system issues `POST https://api.elevenlabs.io/v1/text-to-speech/{V}` with an `xi-api-key` header and a body containing `text`, `model_id: M`, and `output_format`
- **AND** treats the binary response body as the audio payload

#### Scenario: ElevenLabs voice library

- **WHEN** the user opens the voice browser with provider `elevenlabs` selected and a valid key configured
- **THEN** the system fetches `GET https://api.elevenlabs.io/v1/voices` and lists the account's voices, including any the user cloned or added from the ElevenLabs library

#### Scenario: OpenAI instructions passthrough

- **WHEN** provider `openai` synthesizes with a non-empty instructions value and a model that supports it
- **THEN** the request body includes `instructions` alongside `model`, `input`, `voice`, `response_format`, and `speed`

#### Scenario: OpenAI-compatible endpoint

- **WHEN** the user configures `openai-compatible` with base URL `https://example.local/v1`, model `kokoro`, and voice `af_bella`
- **THEN** synthesis issues `POST https://example.local/v1/audio/speech` with body `{model, input, voice, response_format, speed}`
- **AND** a trailing slash in the configured base URL does not produce a doubled slash in the request URL

#### Scenario: Local providers require no credentials

- **WHEN** the selected provider is `pocket` or `system`
- **THEN** configuration validation passes with no API key present and no network request is made to fetch catalogs

### Requirement: Per-provider settings schema

TTS settings SHALL store provider configuration in per-provider objects rather than flat shared fields, so that switching providers preserves each provider's key, model, voice, and format independently.

The schema version SHALL be raised from 2 to 3.

#### Scenario: Switching providers preserves configuration

- **WHEN** the user configures provider `openrouter` with model `M1`, switches to `elevenlabs`, then switches back to `openrouter`
- **THEN** the OpenRouter model, voice, and format selections are exactly as left, with no re-entry required

#### Scenario: Migration from schema version 2

- **WHEN** settings persisted at schema version 2 are loaded
- **THEN** `apiKey` and `modelId` migrate into the `fal` provider config, `groqModelId` and `groqResponseFormat` into the `groq` config, `pocketSpeed` into the `pocket` config, and `requestMode`/`proxyUrl` into the `fal` config
- **AND** all existing `voiceProfiles`, including cloned Fal profiles with their `speakerEmbeddingUrl`, are preserved with unchanged ids
- **AND** the previously selected provider, default voice, default preset, and `enabled` flag are preserved
- **AND** the stored schema version becomes 3

#### Scenario: Migration is idempotent

- **WHEN** settings already at schema version 3 are loaded
- **THEN** no migration runs and the settings are unchanged

#### Scenario: Malformed persisted settings

- **WHEN** persisted TTS settings are absent, not an object, or contain fields of unexpected types
- **THEN** sanitization returns a valid schema-3 settings object using defaults for each invalid field, without throwing

### Requirement: Credential borrowing

Cloud providers SHALL be usable without re-entering a key the user has already configured elsewhere in the app, while still allowing a TTS-specific override.

An adapter's auth descriptor SHALL name the store and provider it borrows from. Borrowing resolution order SHALL be: the TTS-specific key for that provider if non-empty, then the borrowed key, then unconfigured.

#### Scenario: OpenRouter key borrowed from the LLM provider store

- **WHEN** provider `openrouter` is selected, its TTS key field is empty, and `llmProvidersStore` holds an OpenRouter provider with a non-empty key
- **THEN** synthesis authenticates with the borrowed key
- **AND** the settings UI shows which configured provider entry the key came from, with its value masked

#### Scenario: Multiple candidate keys

- **WHEN** `llmProvidersStore` holds more than one OpenRouter entry
- **THEN** the system borrows from the first enabled entry, falling back to the first entry overall if none is enabled

#### Scenario: TTS-specific key overrides the borrowed key

- **WHEN** the user enters a key in the TTS key field for a provider that supports borrowing
- **THEN** synthesis uses the entered key and the UI indicates the borrowed key is being overridden

#### Scenario: No key available

- **WHEN** provider `openrouter` is selected, its TTS key field is empty, and no OpenRouter entry exists in `llmProvidersStore`
- **THEN** configuration validation fails with a message naming OpenRouter and pointing to where a key can be added
- **AND** synthesis is not attempted

### Requirement: Model-aware audio cache keys

The audio cache key SHALL include the model id and response format in addition to provider, voice, speed, and text, so that entries generated by different models under one provider cannot be served for one another.

The text component of the key SHALL use a digest with collision resistance appropriate to a cache holding up to 500 MB of entries, replacing the 32-bit multiply-shift string hash.

#### Scenario: Same voice under different models

- **WHEN** text `T` is synthesized under provider `openrouter` with model `A` and voice `V`, then again with model `B` and the same voice `V`
- **THEN** the two results occupy distinct cache entries
- **AND** the second request does not return audio produced by model `A`

#### Scenario: Different response formats

- **WHEN** the same text, provider, model, and voice are synthesized once as `mp3` and once as `wav`
- **THEN** the two results occupy distinct cache entries

#### Scenario: Cache hit still works

- **WHEN** an identical request — same provider, model, voice, speed, format, and text — is repeated
- **THEN** the cached audio is returned without a network request

#### Scenario: Pre-existing cache entries

- **WHEN** the app starts with cache entries written under the old key format
- **THEN** those entries are not matched by new lookups and are reclaimed by normal cache eviction
- **AND** no error is surfaced to the user

### Requirement: Per-model input chunking

Long-text synthesis SHALL chunk input using the selected model's declared input limit rather than a fixed constant, and SHALL split at sentence boundaries.

#### Scenario: Chunk size follows the model

- **WHEN** the selected model declares a smaller input limit than the previously used fixed chunk size
- **THEN** `chunkTextForTTS` is invoked with the model's limit and every produced chunk is within it

#### Scenario: Model declares no limit

- **WHEN** the selected model's catalog entry reports a context length of `0` or omits it
- **THEN** the adapter's `maxInputChars` default is used

#### Scenario: A single sentence exceeds the limit

- **WHEN** one sentence is longer than the chunk limit
- **THEN** it is split at the nearest word boundary under the limit rather than being dropped or sent oversized
