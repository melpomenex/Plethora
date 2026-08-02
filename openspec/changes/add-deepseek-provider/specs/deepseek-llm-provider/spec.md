## ADDED Requirements

### Requirement: DeepSeek provider selection
The assistant chat provider settings SHALL offer "DeepSeek" as a selectable provider type alongside OpenAI, Anthropic, Gemini, Ollama, and OpenRouter, with a default base URL pointing at DeepSeek's OpenAI-compatible API and a default model of `deepseek-chat`.

#### Scenario: User adds a DeepSeek provider
- **WHEN** the user opens "Add Provider" in LLM provider settings and selects DeepSeek
- **THEN** the base URL field is pre-filled with DeepSeek's default API endpoint and the model field defaults to `deepseek-chat`, and the provider requires an API key to be entered before it can be saved

#### Scenario: User selects an alternate DeepSeek model
- **WHEN** a DeepSeek provider is configured and the user opens the model picker
- **THEN** at minimum `deepseek-chat` and `deepseek-reasoner` are offered, and if a valid API key is present the picker additionally fetches the live model list from DeepSeek's `/models` endpoint

### Requirement: DeepSeek chat completion routing
The backend SHALL route chat completion, streaming, context-aware chat, and connection-test requests for the `deepseek` provider through the existing OpenAI-compatible request/response handling, without requiring a dedicated DeepSeek client implementation.

#### Scenario: Sending a message via DeepSeek
- **WHEN** the active provider is DeepSeek and the user sends a chat message
- **THEN** the app issues an OpenAI-compatible chat completion request to the configured DeepSeek base URL and renders the returned assistant message the same way it does for OpenAI/Gemini

#### Scenario: Testing a DeepSeek connection
- **WHEN** the user clicks "Test Connection" for a configured DeepSeek provider
- **THEN** the app performs a lightweight request against the DeepSeek endpoint using the configured API key and reports success or failure

### Requirement: DeepSeek cache-hit-aware cost accounting
The system SHALL parse DeepSeek's cache-hit/cache-miss token counts from chat completion responses when present and price cache-hit tokens at DeepSeek's discounted cache-read rate rather than the standard input-token rate, so displayed cost estimates reflect DeepSeek's automatic prompt caching.

#### Scenario: Response includes cache-hit tokens
- **WHEN** a DeepSeek chat completion response reports a non-zero count of cache-hit prompt tokens
- **THEN** the app's cost estimate for that response prices the cache-hit tokens at the model's cache-read rate and the remaining (cache-miss) prompt tokens at the standard input rate

#### Scenario: Response omits cache token fields
- **WHEN** a chat completion response (e.g., from OpenAI or Gemini, or an older DeepSeek response) does not include cache-hit/cache-miss token fields
- **THEN** the app falls back to treating all prompt tokens as standard input tokens, matching current behavior

### Requirement: DeepSeek excluded from native AI subsystem
DeepSeek SHALL be available only through the assistant chat provider path and SHALL NOT be added to the native AI provider enum used by flashcard generation, document Q&A, or summarization, consistent with how Gemini is scoped.

#### Scenario: Syncing the primary provider to native AI
- **WHEN** a DeepSeek provider is set as the enabled/primary provider
- **THEN** the native AI config sync is skipped for DeepSeek (the same way it is already skipped for Gemini), and flashcard generation/Q&A/summarization continue using whatever OpenAI/Anthropic/OpenRouter/Ollama provider is otherwise configured
