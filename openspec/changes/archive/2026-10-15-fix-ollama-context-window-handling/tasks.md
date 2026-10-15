## 1. Request policy types (Workstream A)

- [x] 1.1 Add `LlmRequestPolicy` struct to Rust (`configured_context_tokens`, `prompt_budget_tokens`, `output_reserve_tokens`, `max_output_tokens`) with invariant validation helper
- [x] 1.2 Add matching TypeScript types in `src/api/llm/index.ts` (or `src/api/llm/policy.ts`) and export from the LLM API module
- [x] 1.3 Extend `LLMContextRequest` / `LLMContext` with `promptBudgetTokens`, `configuredContextTokens`, `maxOutputTokens`; document `contextWindowTokens` as deprecated
- [x] 1.4 Implement `resolve_request_policy()` in Rust: precedence chain + output resolution + MIN_PROMPT_HEADROOM (1024) invariant + default 4096/4096 guard (migration bump or clamp)
- [x] 1.5 Implement `resolveConfiguredContext()` in TypeScript mirroring Rust precedence; implement Auto preset resolution with displayed value
- [x] 1.6 Add migration shim: legacy `context_window_tokens` maps to prompt budget only; handle legacy case where it equals provider.maxTokens
- [x] 1.7 Rust unit tests: policy resolution precedence, invariant enforcement, legacy shim, default 4096/4096 guard (Tests 7, 9, 10)

## 2. Ollama adapter (Workstream B)

- [x] 2.1 Create `src-tauri/src/ai/ollama_chat.rs` with `normalize_ollama_base_url()`, `build_ollama_chat_body()`, and shared `OllamaChatOptions` struct including `num_ctx`
- [x] 2.2 Migrate `call_ollama_with_url` to `POST /api/chat` with native response parsing (`message.content`, token counts when present)
- [x] 2.3 Migrate `stream_ollama` to `POST /api/chat` with native NDJSON streaming parser; remove dependence on OpenAI SSE chunk shape for Ollama
- [x] 2.4 Thread `LlmRequestPolicy` through `llm_chat` / `llm_stream_chat` for Ollama branch (accept optional policy param or resolve inside command)
- [x] 2.5 Refactor `ai/providers.rs::OllamaProvider` to use shared `build_ollama_chat_body()` — add `num_ctx` from synced `LocalSettings.ollama_context_tokens` (conservative 4096 when unset)
- [x] 2.6 Extend `LocalSettings` / `set_ai_config` / `syncPrimaryProviderToNativeAI` to sync Ollama configured context (and optional per-model map)
- [x] 2.7 Remove or repurpose dead OpenAI-shaped Ollama types in `llm.rs` after migration
- [x] 2.8 Change default Ollama base URL to `http://localhost:11434` (no `/v1`); fix `test_ollama_connection` to use `/api/tags`
- [x] 2.9 Rust serialization tests: given context 16384 + output 2048 → JSON contains `num_ctx`/`num_predict` (Tests 1, 2, 3)
- [x] 2.10 Rust test: streaming vs non-streaming bodies identical except `stream` flag (Test 3); URL normalization with `/v1` input

## 3. Context budgeting (Workstream C)

- [x] 3.1 Create `src-tauri/src/ai/prompt_budget.rs` with `assemble_context_with_budget()` — **Ollama/local providers only in v1** (gate by provider type)
- [x] 3.2 Refactor `build_context_prompt` / `select_relevant_excerpt` to accept **remaining** prompt budget from assembler, not full context window
- [x] 3.3 Implement deterministic trimming order per spec (memory → excerpt → history); never trim user message or selection
- [x] 3.4 Cap `MEMORY.md` injection by remaining budget (most recent content first)
- [x] 3.5 Add conversation history trimming by estimated tokens (drop oldest turns) in `llm_chat_with_context`
- [x] 3.6 Refactor `llm_chat_with_context` to stop passing `context_window_tokens` as `max_tokens` to `llm_chat`
- [x] 3.7 Fix `chatWithContext` in `src/api/llm/index.ts`: stop overwriting `contextWindowTokens` with `effectiveMaxTokens`; pass separate budget/output/context fields
- [x] 3.8 Update major call sites (`AssistantPanel`, `DocumentQATab`, `DocumentViewerWrapper`, `FlashcardStudioModal`, `QueueScrollPage`) to pass distinct prompt budget vs max output
- [x] 3.9 **Blocking:** align frontend section-focus with Rust assembler — Rust is authoritative final pass; remove parallel `effectiveContextWindow` for Ollama; pass scoped content without double 70%+100% trim
- [x] 3.10 Rust tests: oversized prompt triggers trim or error before HTTP (Test 5); 8581-token fixture with 16K context passes budgeting gate (Test 4)

## 4. Retry and errors (Workstream D)

- [x] 4.1 Remove `reduced_ollama_context_window`, `reduced_ollama_max_tokens`, and context-shrinking retry branch from `llm_chat_with_context`
- [x] 4.2 Replace `should_retry_ollama_with_smaller_context` with `classify_ollama_error()` distinguishing context overflow vs transient failures
- [x] 4.3 Implement user-facing error mapper for context overflow: configured context, estimated prompt tokens, actionable guidance
- [x] 4.4 Optional: single identical-policy retry for transient EOF only (no policy mutation)
- [x] 4.5 Sanitize user-facing and stream errors; raw Ollama JSON debug-only — apply to `stream_ollama` / `LLM_STREAM_ERROR` path
- [x] 4.6 Rust tests: context overflow error does not invoke shrink retry (Test 8); OOM vs exceed_context_size classification fixtures

## 5. Settings and discovery (Workstream E)

- [x] 5.1 Extend `LLMProviderConfig` with `contextWindowTokens?: number` and `modelContextWindows?: Record<string, number>`
- [x] 5.2 Persist new fields in `llmProvidersStore` with one-time migration: existing Ollama providers get `contextWindowTokens = max(global, 8192)` unless user already set
- [x] 5.3 Implement Ollama `POST /api/show` fetch in Rust (`fetch_ollama_model_details`) and wire into `fetch_ollama_models` / model list to populate `context_length` and Modelfile `num_ctx`
- [x] 5.4 Update `LLMProviderSettings.tsx`: Ollama context window control with presets, model maximum/default display, GPU/RAM warning above 8K
- [x] 5.5 Clarify labels: global context → default for local model runtime context; provider "Max response tokens" for output; reconcile legacy `AISettings.tsx` dual controls in copy
- [x] 5.6 Update `cloudProvider.ts` `capabilitiesFromCloudConfig`: derive `contextTokens` from configured context (document as configured ceiling, not model max)
- [x] 5.7 Update i18n strings for new labels, Auto preset, and warnings
- [x] 5.8 Settings validation: fail save when `max_response + 1024 > configured_context`

## 6. Tests (Workstream F)

- [x] 6.1 Create `src/api/llm/__tests__/chatWithContext.test.ts`: verifies separate context/output fields sent to invoke; legacy shim behavior
- [x] 6.2 Extend `src/lib/ai/__tests__/providers.test.ts`: Ollama cloud provider passes policy without conflating contextTokens with maxOutputTokens
- [x] 6.3 Add `src/features/documentQa/__tests__/sectionContextRequest.integration.test.ts` case for `ollama` provider with distinct budget/output args
- [x] 6.4 Add Rust integration-style test with mock HTTP server (if repo pattern exists) or snapshot tests for `build_ollama_chat_body` JSON
- [x] 6.5 Cloud regression test: OpenAI request serialization still uses `max_tokens` from policy.max_output_tokens only (Test 6); OpenAI contextual chat does not trim history (Test 12)
- [x] 6.6 Stack B test: `OllamaProvider` sends `num_ctx` from synced config (Test 11)
- [x] 6.7 Align `browser-backend.ts` `llm_chat_with_context` shim: separate prompt budget from max output (Ollama unsupported but fields must not conflate)
- [x] 6.8 Run `npm run test:scripts` / relevant vitest suites and `cargo test` for new modules

## 7. Diagnostics and documentation (Workstream G)

- [x] 7.1 Add debug-level structured logging at Ollama send boundary (policy numbers only — no content)
- [x] 7.2 Document local model context behavior in help or AI provider docs (short user-facing note: context window vs response tokens)
- [x] 7.3 Add migration note in change README or implementation PR template: legacy `context_window_tokens` semantics
- [x] 7.4 Update `openspec/TRACEABILITY_MATRIX.md` if the project requires capability traceability for new specs

## 8. Acceptance verification

- [x] 8.1 Manual test: Ollama with 16K configured context accepts ~8581-token document Q&A prompt that previously failed at 4096
- [x] 8.2 Manual test: configured 16K context with 2048 max response does not generate 16K-token outputs by default
- [x] 8.3 Manual test: OpenAI/OpenRouter provider output length unchanged after refactor
- [x] 8.4 Manual test: streaming Ollama assistant path (if used) matches non-streaming context behavior
- [x] 8.5 Verify all 13 acceptance criteria from proposal/design are checked off in PR description
