## ADDED Requirements

### Requirement: Ollama num_ctx and num_predict mapping

For Ollama chat requests, the system SHALL map provider-independent request policy to Ollama options:

- `configured_context_tokens` → `options.num_ctx`
- `max_output_tokens` → `options.num_predict`

Both values SHALL be sent on every Ollama chat request.

#### Scenario: Correct options payload

- **WHEN** configured context is 16384 and max output is 2048
- **THEN** the Ollama request JSON includes `"options": { "num_ctx": 16384, "num_predict": 2048, ... }`

#### Scenario: No semantic conflation

- **WHEN** prompt budget or legacy context window is 16384 and max output is 2048
- **THEN** `num_predict` is 2048 and MUST NOT be 16384

### Requirement: Native Ollama chat API

Ollama chat in the Tauri command layer (`llm_chat`, `llm_chat_with_context`, `llm_stream_chat`) SHALL use the native Ollama **`POST /api/chat`** endpoint, not the OpenAI-compatible `/v1/chat/completions` shim, so that per-request `options.num_ctx` is honored.

#### Scenario: Non-streaming endpoint

- **WHEN** a non-streaming Ollama chat request is sent
- **THEN** the HTTP POST target ends with `/api/chat`

#### Scenario: Streaming endpoint

- **WHEN** a streaming Ollama chat request is sent
- **THEN** the HTTP POST target ends with `/api/chat` with `"stream": true`

### Requirement: Streaming and non-streaming parity

Streaming and non-streaming Ollama requests for the same policy and messages SHALL serialize identical model, messages, and `options` fields (except `stream`).

#### Scenario: Equivalent options across modes

- **WHEN** the same model, messages, temperature, and policy are used for streaming and non-streaming calls
- **THEN** both payloads contain identical `options.num_ctx` and `options.num_predict`

### Requirement: Unified Ollama adapter across Rust stacks

The Tauri LLM commands (`commands/llm.rs`) and the internal `OllamaProvider` (`ai/providers.rs`) SHALL share one Ollama request builder and base-URL normalization helper so behavior cannot diverge.

#### Scenario: Internal QA path sends num_ctx

- **WHEN** the internal `OllamaProvider` sends a chat completion
- **THEN** the request includes `options.num_ctx` from resolved policy, not only `num_predict`

### Requirement: Ollama model context discovery

When listing or selecting Ollama models, the system SHOULD fetch model details via `POST /api/show` (or equivalent) to populate:

- Modelfile default `num_ctx` (for display and fallback resolution)
- Model card / metadata context length when exposed

Discovery metadata MUST NOT automatically become configured runtime context.

#### Scenario: Show metadata displayed

- **WHEN** a user selects an Ollama model and show metadata reports Modelfile `num_ctx 4096`
- **THEN** the settings UI MAY show "Model default: 4096" while configured context remains user-controlled

#### Scenario: Tags listing enriches context_length

- **WHEN** Ollama models are fetched for the provider settings model list
- **THEN** `ModelInfo.context_length` is populated when show/details metadata provides a value (no longer always `None`)

### Requirement: Context overflow error handling

When Ollama returns a context size error (including `exceed_context_size` or messages containing "exceeds the available context size"), the system SHALL NOT retry with a smaller `num_ctx` or smaller prompt budget automatically. It SHALL surface a user-facing error that states configured context versus approximate required tokens and suggests increasing configured context or reducing content.

#### Scenario: 8581 tokens with 4096 configured context

- **WHEN** Ollama returns that 8581 prompt tokens exceed 4096 context
- **THEN** the user sees a Plethora message referencing configured 4096 vs required ~8581, not only the raw nested Ollama JSON

#### Scenario: No counterproductive retry

- **WHEN** Ollama returns a context size exceeded error
- **THEN** the system does not invoke retry logic that reduces `num_ctx` or `num_predict` to 256–512

### Requirement: Transient Ollama retry

If retry is implemented for Ollama, it MAY retry at most once for transient errors (e.g. unexpected EOF, connection reset) with the **same** request policy. Context-shrinking retry is forbidden.

#### Scenario: EOF retry preserves policy

- **WHEN** an Ollama request fails with unexpected EOF and retry is enabled
- **THEN** the retry uses identical `num_ctx`, `num_predict`, and prompt content

### Requirement: Ollama context settings UX

For Ollama provider configuration, the settings UI SHALL expose:

- **Configured context window** (numeric input with presets: Auto, 4K, 8K, 16K, 32K, 64K, Custom)
- **Max response tokens** (existing per-provider output control, clearly labeled)
- Read-only **model maximum / model default** context when discovery provides it
- A concise warning that higher context consumes more GPU/RAM

The UI MUST NOT expose GPU-model-specific defaults (e.g. hardcoded for a particular graphics card).

#### Scenario: User configures 16K context

- **WHEN** a user sets Ollama configured context to 16384 and max response to 2048
- **THEN** subsequent Ollama requests use `num_ctx 16384` and `num_predict 2048`

#### Scenario: Resource warning shown

- **WHEN** a user increases configured context above 8192
- **THEN** the UI displays a warning about increased memory use

#### Scenario: Auto preset shows resolved value

- **WHEN** a user selects Auto for configured context
- **THEN** the UI displays the resolved numeric context (e.g. "Auto → 8192") before saving

### Requirement: Streaming contextual parity

When streaming Ollama chat is used with pre-assembled messages, the system SHALL apply the same `LlmRequestPolicy` and `build_ollama_chat_body` serialization as non-streaming chat. Streaming error events SHALL use sanitized user-facing messages (not raw Ollama JSON bodies).

#### Scenario: Stream policy matches non-stream

- **WHEN** streaming and non-streaming Ollama calls share the same policy
- **THEN** both use identical `options.num_ctx` and `options.num_predict`

#### Scenario: Stream errors sanitized

- **WHEN** a streaming Ollama request fails with a context overflow error
- **THEN** the frontend stream error event contains a sanitized message without raw provider JSON or user content echo

### Requirement: Large prompt succeeds with adequate configured context

A prompt larger than 4096 tokens but smaller than the configured context window (including output reserve) SHALL succeed against Ollama when the model supports that context size.

#### Scenario: 8581-token prompt with 16K configured context

- **WHEN** assembled prompt is approximately 8581 tokens, output reserve is 2048, configured context is 16384, and the model supports 16K
- **THEN** the Ollama request succeeds without "exceeds the available context size (4096 tokens)" due to Plethora defaulting to 4K

### Requirement: Regression tests for Ollama configuration

The implementation SHALL include automated tests covering at minimum:

1. Ollama payload contains correct `num_ctx` and `num_predict`
2. Context window setting does not set `num_predict` to the same value
3. Streaming/non-streaming serialization parity
4. 8.5K prompt simulation with 16K configured context does not use 4K default
5. Oversized prompt triggers budgeting or clear error before provider call
6. Cloud providers still receive intended max output settings
7. Missing explicit local context uses deterministic fallback (8192)
8. Context overflow retry cannot shrink policy to make errors worse
9. Default 4096/4096 settings produce prompt budget ≥ 1024
10. Auto preset resolves to a value in [4096, 16384]
11. Stack B `OllamaProvider` receives synced context config and sends `num_ctx`
12. Cloud contextual chat does not apply Ollama-only history trimming (regression guard)

#### Scenario: Tests present in CI

- **WHEN** the change is implemented
- **THEN** the test suite includes the eight cases above as automated tests in Rust and/or TypeScript per repository conventions
