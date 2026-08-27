# Fix Ollama context window and output-token handling

## Why

Plethora's local Ollama integration conflates **model context window size** with **maximum output tokens**, never sends Ollama's `num_ctx` parameter, and relies on the OpenAI-compatible `/v1/chat/completions` shim for the primary assistant path. When a user sends an ~8,581-token prompt to a model that supports 16K–32K context, Ollama rejects the request because the loaded model was instantiated with a **4,096-token default context**:

```text
request (8581 tokens) exceeds the available context size (4096 tokens)
```

This is not a model-capability problem — it is an abstraction and serialization bug. The same misnamed setting (`context_window_tokens`) currently drives document excerpt trimming **and** Ollama `num_predict`, so fixing only one call site would leave the system internally inconsistent and risk regressions on cloud providers.

## What Changes

- Introduce an explicit **LLM request policy** that separates:
  - model context capacity (metadata)
  - configured runtime context window (`num_ctx` for Ollama)
  - prompt/input budget (system + history + RAG + user message)
  - output reserve and maximum output tokens (`num_predict` / cloud `max_tokens`)
- Send **`options.num_ctx`** on every Ollama chat request (streaming and non-streaming, both Rust chat stacks) using the configured runtime context window, not Ollama's implicit default.
- Stop passing `context_window_tokens` to `llm_chat` as `max_tokens` / `num_predict`.
- Route primary Ollama chat through **native `/api/chat`** (or an equivalent path that reliably honors per-request `options.num_ctx`), unifying with `ai/providers.rs::OllamaProvider`.
- Add **pre-request prompt budgeting** so `prompt_tokens + output_reserve ≤ configured_context_window` before hitting the provider; deterministic trimming priority when over budget.
- Replace the current Ollama retry that shrinks context to 256–512 tokens on EOF/500 with **correct error classification** and user-facing messages for context overflow.
- Extend Ollama model discovery to surface **Modelfile / show metadata** (including default `num_ctx`) for display and conservative defaults — without auto-selecting theoretical maximum context.
- Add per-Ollama-provider **configured context window** in settings (with global fallback), plus privacy-safe diagnostics.
- Add Rust and frontend tests covering the eight required regression cases from the bug report.

**BREAKING (internal API, backward compatible at UI level):** `llm_chat_with_context` will accept separate prompt-budget and output-limit fields instead of overloading `context_window_tokens`. Migration shims will preserve existing callers during rollout.

## Capabilities

### New Capabilities

- `llm-token-budget`: Provider-independent token policy — separate context window, prompt budget, output reserve, and max output; pre-request budgeting and deterministic trimming; cloud-provider output mapping unchanged.
- `ollama-chat-configuration`: Ollama-specific request serialization — `num_ctx`, `num_predict`, native `/api/chat` parity across streaming/non-streaming and both Rust stacks; model context discovery; retry/error behavior; settings UX for local models.

### Modified Capabilities

<!-- No requirements in openspec/specs/ currently govern LLM context windows. Assistant document-context behavior is strengthened indirectly via llm-token-budget but does not modify an archived main-spec requirement. -->

## Impact

**Backend (Rust)**
- `src-tauri/src/commands/llm.rs` — request types, `llm_chat_with_context`, Ollama serialization, retry/error paths, model discovery
- `src-tauri/src/ai/providers.rs` — `OllamaProvider` options (`num_ctx`), shared helper extraction
- New module(s) under `src-tauri/src/ai/` for request policy and prompt budgeting (exact path in design)

**Frontend (TypeScript)**
- `src/api/llm/index.ts` — `chatWithContext` argument semantics
- `src/stores/settingsStore.ts`, `src/stores/llmProvidersStore.ts` — per-Ollama context window field
- `src/components/settings/LLMProviderSettings.tsx`, `AIProviderSettings.tsx` — context window UX, model maximum display
- `src/lib/ai/providers/cloudProvider.ts` — `contextTokens` sourced from configuration, not hardcoded 8192
- Call sites: `AssistantPanel.tsx`, `DocumentQATab.tsx`, `DocumentViewerWrapper.tsx`, etc.

**Browser/PWA shim**
- `src/lib/browser-backend.ts` — align trimmed-context semantics with new policy (Ollama remains unsupported in browser)

**Tests**
- New Rust unit tests in `llm.rs` / dedicated test module
- New TS tests: `src/api/llm/__tests__/`, extend `providers.test.ts`, parity fixtures

**Non-goals (this change)**
- GPU-specific automatic context sizing (no RTX 2060 hardcoding)
- Rewriting the whole-library RAG task stack (`askLibrary`) — only align shared policy types where they intersect contextual chat
- Changing cloud provider context-window API semantics beyond preserving existing output-token behavior

## User impact

Users running local Ollama models will be able to configure a practical context window (e.g. 16K) and send large document/RAG prompts without silent 4K failures. Higher context sizes will show a brief resource warning. Cloud users should see no change in response length behavior.
