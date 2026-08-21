## ADDED Requirements

### Requirement: Paid embedding operations require explicit enablement
The system SHALL NOT perform paid/cloud embedding operations unless the user has explicitly enabled paid embeddings. A persisted consent flag (e.g. `embedding.paidEmbeddingsEnabled`, default **false**) SHALL gate every billable embedding call path: whole-library indexing, per-chunk embedding jobs, query-side `embed_text` on retrieval/chat/recall/probe, and semantic-graph embedding (`compute_semantic_graph`, `embed_queue_items`, `embed_active_rss_articles`).

#### Scenario: API key configured but paid embeddings disabled
- **WHEN** an OpenRouter (or OpenAI/Cohere) API key is configured but `paidEmbeddingsEnabled` is false
- **THEN** an operation that would invoke a billable embedding provider SHALL NOT send the request and SHALL instead surface the appropriate opt-in UX (enable flag + confirmation)

#### Scenario: Explicitly enabled paid embeddings
- **WHEN** the user explicitly enables paid embeddings and starts an indexing job
- **THEN** the billable embedding requests SHALL be sent and SHALL complete normally

#### Scenario: Local/free embedding still works without consent
- **WHEN** the embedding provider is local (Ollama) or on-device (Android EmbeddingGemma) or the config is unusable (lexical fallback)
- **THEN** embedding SHALL proceed without any paid-consent flag, and no confirmation SHALL be required

### Requirement: Paid TTS/voice operations require explicit enablement
The system SHALL NOT generate audio through a paid TTS provider unless the user has explicitly enabled paid TTS/voice. A persisted consent flag (e.g. `tts.paidTtsEnabled`, default **false**) SHALL gate every billable TTS path: read-aloud (`generateSpeech` with a cloud adapter), voice previews, audio-edition generation, and audition previews.

#### Scenario: API key configured but paid TTS disabled
- **WHEN** an OpenRouter (or fal/ElevenLabs/OpenAI/Groq) API key is configured but `paidTtsEnabled` is false
- **THEN** an operation that would invoke a billable TTS provider SHALL NOT send the request and SHALL instead surface the appropriate opt-in UX

#### Scenario: Explicitly enabled paid TTS
- **WHEN** the user explicitly enables paid TTS and selects a paid provider/voice
- **THEN** synthesis SHALL be allowed

#### Scenario: Local/free TTS needs no consent
- **WHEN** the TTS provider is free/local (system web speech, pocket, android native)
- **THEN** synthesis SHALL proceed without a paid-consent flag

### Requirement: Visible paid-provider indication
The system SHALL clearly indicate when a configured option uses an external paid API in the relevant settings surfaces (embedding settings, TTS settings/voice picker, audio-edition dialog, indexing panel), so the user can see the paid path before acting.

#### Scenario: Paid indicator in settings
- **WHEN** the user selects a billable provider/model in embedding or TTS settings
- **THEN** a visible paid/external-API indicator (badge/label with tooltip) SHALL be shown next to the provider/model selection

### Requirement: No silent free/local → paid fallback
The system SHALL NOT silently fall back from a free/local path to a paid provider. `runAiAction`'s on-device→cloud retry (`src/lib/ai/provider.ts`), and any embedding/OCR free→cloud fallback, SHALL require the relevant paid-consent flag or an explicit confirmation before invoking a billable provider. `allowCloudFallback`'s default SHALL be re-evaluated and set to a safe value (off, or on only with consent) as part of this change.

#### Scenario: On-device failure does not silently bill
- **WHEN** an on-device AI action fails and cloud fallback is configured but paid consent is not enabled
- **THEN** the system SHALL NOT auto-invoke the paid cloud provider; it SHALL surface a consent/opt-in prompt or stop with a clear message

#### Scenario: Explicit fallback consent
- **WHEN** the user has explicitly consented to paid fallback
- **THEN** the fallback SHALL proceed (with the existing informational toast retained)

### Requirement: Large one-time jobs are confirmed with estimates
Bulk operations that could trigger substantial billable work SHALL show a pre-flight confirmation before running: whole-library indexing, semantic-graph embedding of the queue/library, and audio-edition generation. The confirmation SHALL include a workload estimate (number of items/chunks) and an estimated cost when calculable from known static pricing (reusing `audioEditionEstimation.ts` patterns); when pricing is unavailable/dynamic, the UI SHALL state that an exact cost cannot be estimated rather than fabricating one.

#### Scenario: Library index confirmation
- **WHEN** the user enables indexing for a library with N documents (≈M chunks) using a paid embedding provider
- **THEN** the system SHALL show a confirmation with the chunk workload and an estimated cost (or an explicit "cost cannot be precisely estimated"), and SHALL NOT enqueue until confirmed

#### Scenario: Audio edition confirmation
- **WHEN** the user creates an audio edition with a paid TTS provider
- **THEN** the existing pre-flight summary SHALL be shown and the paid path SHALL require the paid-TTS consent flag (or a confirmation) before generation

### Requirement: Defensive enforcement in the backend
Where cheap, the Rust backend SHALL reject billable embedding/TTS commands when the explicit consent flag is absent, so a stale or malicious frontend cannot silently trigger paid workloads. The frontend SHALL avoid sending the requests in the first place.

#### Scenario: Backend rejects unconsented paid embedding
- **WHEN** a `ai_learning_enqueue_all`/embedding command arrives for a paid provider with consent absent
- **THEN** the backend SHALL reject (or require explicit consent) rather than billing, and SHALL return a clear error the UI can surface as an opt-in prompt

### Requirement: No exact-dollar promises
The system SHALL NOT present fabricated or exact dollar estimates when model/provider pricing is unavailable or dynamic. Estimates SHALL be clearly labeled as estimates and based on known static pricing constants only.

#### Scenario: Unknown pricing disclosed
- **WHEN** a paid provider's pricing is not known to the app
- **THEN** the estimate UI SHALL say the cost cannot be precisely estimated and SHALL not print a made-up number