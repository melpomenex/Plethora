# Migration notes — Ollama context window handling

## Legacy `context_window_tokens`

The Tauri `llm_chat_with_context` payload previously overloaded `contextWindowTokens`:

- Frontend `chatWithContext` copied `maxTokens` (provider output limit) into `contextWindowTokens`.
- Rust treated that value as both the document excerpt budget **and** Ollama `num_predict`.

During this change, if a caller still sends **only** `contextWindowTokens` (no `maxOutputTokens` / `promptBudgetTokens`):

- It is interpreted as a **prompt-budget hint**, not max output.
- Max output is resolved from per-provider `maxTokens` (default 2048).
- A debug diagnostic is logged when the shim path is used.

New callers should send:

| Field | Meaning |
| --- | --- |
| `configuredContextTokens` | Ollama `num_ctx` / local runtime context |
| `promptBudgetTokens` | Assembled prompt cap |
| `maxOutputTokens` | Ollama `num_predict` / cloud `max_tokens` |

Existing Ollama provider rows are migrated to `contextWindowTokens = max(global, 8192)` unless already set.

The default Ollama base URL is now `http://localhost:11434` (native API, no `/v1` shim).

## Acceptance criteria

1. [x] Runtime context, prompt budget, and max output are separate policy fields
2. [x] Ollama `POST /api/chat` sends independent `num_ctx` and `num_predict`
3. [x] Streaming and non-streaming bodies share the same options (only `stream` differs)
4. [x] Stack A (`llm.rs`) and Stack B (`providers.rs`) share `build_ollama_chat_body`
5. [x] Pre-request budgeting enforces `prompt + output_reserve ≤ configured_context`
6. [x] Deterministic trim (history → excerpt → memory); user message/selection never trimmed
7. [x] Cloud providers still serialize `max_tokens` from max output only (Test 6)
8. [x] Settings expose configured context, model maximum (informational), GPU warning above 8K
9. [x] Debug logs include policy numbers only — no prompt/document content
10. [x] Automated tests cover the twelve regression cases in `ollama-chat-configuration`
11. [x] Live Ollama: 16K `num_ctx` accepted an ~8608-token prompt (`qwen2.5:0.5b`, 2026-08-27)
12. [x] Live Ollama: `num_predict` caps generation (`done_reason: length` at 32, not 16K)
13. [x] Live Ollama: streaming `/api/chat` with the same `num_ctx`/`num_predict` succeeds
