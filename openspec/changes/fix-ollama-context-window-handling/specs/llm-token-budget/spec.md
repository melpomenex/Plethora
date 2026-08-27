## ADDED Requirements

### Requirement: Separate context window from output limit

The system SHALL represent **configured runtime context**, **prompt budget**, **output reserve**, and **maximum output tokens** as distinct values in the LLM request policy. No single field SHALL simultaneously mean both context window size and maximum generated tokens.

#### Scenario: Policy fields are independent

- **WHEN** a contextual chat request is assembled with configured context 16384 and max output 2048
- **THEN** the request policy contains `configured_context_tokens = 16384`, `max_output_tokens = 2048`, and `prompt_budget_tokens ≤ 14336` (context minus output reserve)

#### Scenario: Context window does not set output limit

- **WHEN** only a context window of 16384 is configured and max output is unset
- **THEN** the system applies a default max output (2048 or provider setting) and MUST NOT set max output to 16384 solely because context is 16384

### Requirement: Prompt budget invariant

Before sending a provider request, the system SHALL ensure the estimated assembled prompt tokens plus the output reserve do not exceed the configured context window.

#### Scenario: Within budget

- **WHEN** estimated prompt is 8000 tokens, output reserve is 2048, and configured context is 16384
- **THEN** the request proceeds without trimming

#### Scenario: Over budget triggers trimming

- **WHEN** estimated prompt exceeds `configured_context_tokens - output_reserve_tokens`
- **THEN** the system trims lower-priority content deterministically before calling the provider

#### Scenario: Non-trimmable overflow fails clearly

- **WHEN** protected content (current user message, selection, core system instructions) alone exceeds the prompt budget
- **THEN** the system returns a user-facing error describing approximate token need versus configured budget and MUST NOT call the provider

### Requirement: Deterministic trimming priority

When trimming is required, the system SHALL apply the following order (trim lowest priority first, preserve higher priority):

1. Current user message — never trimmed
2. User selection / pinned context — never trimmed
3. Core system instructions — never trimmed (fail if alone exceeds budget)
4. Long-term memory — trim oldest content first
5. Document / web / video excerpt — trim using query-aware excerpt selection
6. Conversation history — drop oldest turns first
7. Output reserve — never consumed by prompt content

#### Scenario: History trimmed before user message

- **WHEN** the assembled prompt exceeds budget and both history and document excerpt are present
- **THEN** oldest conversation turns are removed before reducing the document excerpt

#### Scenario: User message preserved

- **WHEN** trimming occurs
- **THEN** the current user message content is identical to the pre-trim request

### Requirement: Cloud provider output mapping unchanged

For non-Ollama cloud providers (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, custom OpenAI-compatible), the system SHALL continue sending only the **maximum output tokens** via each provider's existing API field (`max_tokens` or equivalent). The configured context window SHALL NOT alter cloud output limits.

#### Scenario: OpenAI chat receives max_tokens only

- **WHEN** a request is sent to OpenAI with configured context 16384 and max output 2048
- **THEN** the HTTP request body contains `max_tokens: 2048` and does not introduce a new context-window field that changes OpenAI behavior

#### Scenario: Provider max output from settings

- **WHEN** the user configured per-provider max output 4096
- **THEN** cloud requests use 4096 as the output cap regardless of the global document context setting

### Requirement: Configured context resolution

The system SHALL resolve configured runtime context using this precedence (first match wins):

1. Per-model override on the active provider configuration
2. Per-provider default context window (Ollama / local providers)
3. Global `settings.ai.maxTokens` default
4. Ollama model discovered default from `/api/show` Modelfile `num_ctx` (when available)
5. Conservative fallback of 8192 tokens

The system MUST NOT automatically set configured context to a model's theoretical maximum context length.

#### Scenario: Per-model override wins

- **WHEN** global default is 4096, provider default is 16384, and model override is 32768
- **THEN** configured context for that model is 32768

#### Scenario: Missing settings use conservative fallback

- **WHEN** no explicit context is configured, global setting is zero/unset, and Ollama show metadata is unavailable
- **THEN** configured context defaults to 8192 deterministically

#### Scenario: Default install produces usable prompt budget

- **WHEN** global context is 4096 and provider max output is 4096 (typical persisted defaults)
- **THEN** policy resolution yields `prompt_budget_tokens ≥ 1024` (via migration bump or max-output clamp) and MUST NOT yield zero prompt budget

#### Scenario: Auto preset resolves deterministically

- **WHEN** the user selects Auto for Ollama configured context
- **THEN** the system resolves to a displayed value in `[4096, 16384]` using global default, show metadata, and the Auto ceiling — never the model's theoretical maximum

#### Scenario: Model maximum is informational only

- **WHEN** a model advertises 131072 context in metadata
- **THEN** the UI MAY display that maximum but MUST NOT auto-configure runtime context to 131072

### Requirement: Privacy-safe diagnostics

Debug diagnostics for LLM requests MAY log numeric policy fields (provider, model, configured context, prompt budget, output reserve, max output, estimated prompt tokens). Diagnostics MUST NOT log user message text, document excerpts, memory contents, or RAG chunk text.

#### Scenario: Debug log content

- **WHEN** debug logging is enabled for an LLM request
- **THEN** logs contain token counts and policy numbers but no prompt or document body strings

### Requirement: Migration compatibility for context_window_tokens

During migration, if callers send only the legacy `context_window_tokens` field, the system SHALL interpret it as **prompt budget hint**, not as max output tokens. A deprecation diagnostic SHOULD record use of the legacy path.

#### Scenario: Legacy field mapping

- **WHEN** `context_window_tokens = 8192` is sent without `max_output_tokens`
- **THEN** prompt budget is derived from 8192 and max output comes from provider settings, not 8192

#### Scenario: Legacy field equal to provider max output

- **WHEN** `context_window_tokens` equals the provider max output value (historical conflation pattern)
- **THEN** the migration shim treats the value as prompt budget only and still resolves max output from provider settings

### Requirement: Ollama-only prompt assembly in v1

The full prompt budgeting assembler (history and memory trimming) SHALL apply to Ollama and other local inference providers in v1. Cloud provider contextual chat SHALL retain existing excerpt-only behavior until explicitly extended, so cloud output limits and prompt assembly are not altered by this change.

#### Scenario: OpenAI contextual chat unchanged

- **WHEN** a contextual chat request uses OpenAI with long conversation history
- **THEN** the system does not apply the new Ollama-only history trimming path

## MODIFIED Requirements

<!-- No existing main-spec requirements in openspec/specs/ govern this behavior. -->
