## Context

The app has two independent AI-provider subsystems:

1. **Assistant chat path** (`src-tauri/src/commands/llm.rs`, driven by `src/stores/llmProvidersStore.ts` + `src/components/settings/LLMProviderSettings.tsx`): string-keyed provider dispatch (`"openai" | "anthropic" | "gemini" | "ollama" | "openrouter"`). Gemini was added here purely as an OpenAI-compatible base-URL swap (`"openai" | "gemini" => fetch_openai_compatible_...`), with no dedicated Gemini request/response types and no entry in the native `AIProvider` enum.
2. **Native AI subsystem** (`src-tauri/src/ai/provider_wrapper.rs`, `ai/providers.rs`), an enum-dispatched (`LLMProviderType`) set of concrete provider structs used by flashcard generation, document Q&A, and summarization. This enum currently has only `OpenAI | Anthropic | OpenRouter | Ollama` — Gemini was deliberately never added here (`syncPrimaryProviderToNativeAI` explicitly skips syncing when `provider === 'gemini'`).

DeepSeek exposes an OpenAI-compatible `/chat/completions` and `/models` API at `https://api.deepseek.com`, so it fits the same shape as Gemini/OpenAI. DeepSeek's distinguishing feature is **automatic context caching on disk**: repeated requests sharing an identical prefix (system prompt + earlier turns) get a `prompt_cache_hit_tokens` count in the usage payload, billed at roughly 1/10th the price of a cache miss, with no explicit cache-control API needed (unlike Anthropic, which requires `cache_control` breakpoints).

## Goals / Non-Goals

**Goals:**
- Add DeepSeek as a provider option in the assistant chat settings, following the Gemini precedent (OpenAI-compatible reuse, no new Rust provider struct).
- Correctly account for DeepSeek's cache-hit discount in the app's cost estimator, so usage/cost shown to the user reflects actual DeepSeek billing rather than treating every input token at the full (cache-miss) rate.
- Keep the change additive: no modification to how OpenAI, Anthropic, Gemini, Ollama, or OpenRouter behave.

**Non-Goals:**
- Adding DeepSeek to the native `AIProvider`/`LLMProviderType` enum (flashcard generator, Q&A, summarizer). Out of scope, matching the existing Gemini precedent — can be a follow-up if a future proposal decides those subsystems should support more providers generally.
- Implementing manual cache-control (e.g., explicit breakpoints). DeepSeek's caching is fully automatic server-side; there is nothing to opt into beyond sending consistent request prefixes, which the app already does by replaying full conversation history in order.
- Building a DeepSeek-specific streaming parser. DeepSeek's SSE stream format is OpenAI-compatible, so the existing OpenAI stream-chunk parsing path is reused as-is.

## Decisions

**1. Route `"deepseek"` through the existing OpenAI-compatible branches in `commands/llm.rs`, not a new provider module.**
Every place that currently matches `"openai" | "gemini" => ...` becomes `"openai" | "gemini" | "deepseek" => ...` (in `llm_chat`, `llm_chat_with_context`, `llm_stream_chat`, `llm_test_connection`). `llm_get_models` gets its own `"deepseek"` arm (mirroring the `"gemini"` arm) since DeepSeek's live `/models` response doesn't include pricing, so a static pricing table (see decision 3) is layered on top of the live model IDs, rather than reusing OpenAI's key-optional fallback list.
Alternative considered: give DeepSeek a fully separate code path like Anthropic has. Rejected — DeepSeek's request/response shape is byte-for-byte OpenAI-compatible, so a separate path would be pure duplication with no behavioral benefit.

**2. Add `get_default_base_url("deepseek") = "https://api.deepseek.com"`.**
No `/v1` suffix needed in the constant itself — DeepSeek's OpenAI-compatible routes are `/chat/completions` and `/models` directly off the base domain per their docs, but the existing `fetch_openai_compatible_*` helpers append `/chat/completions` and `/models` to whatever base URL is configured, consistent with how the other providers' base URLs are stored (i.e., store `https://api.deepseek.com/v1` as the default to match DeepSeek's documented OpenAI-compatible base, keeping the helper functions unchanged). This will be verified against DeepSeek's current API docs during implementation and adjusted if their base path differs from `/v1`.

**3. Capture and expose cache-hit tokens for cost accuracy.**
Add `prompt_cache_hit_tokens: Option<usize>` and `prompt_cache_miss_tokens: Option<usize>` to the `OpenAIUsage` struct (both optional so OpenAI/Gemini responses that omit them still deserialize cleanly). When present, thread the cache-hit count through `ChatCompletionResponse`/`LLMContextResponse` (whatever the existing token-count return type is) so the frontend cost estimator (`src/api/llm/index.ts`, which already understands `cache_read` a la Anthropic) can price cache-hit tokens at DeepSeek's discounted `cache_read` rate instead of the standard input rate. Populate `cache_read` (not `cache_write`) in the static/fallback `ModelPricing` for `deepseek-chat` / `deepseek-reasoner`, since DeepSeek never charges a separate cache-write premium — writing to cache is free and automatic.
Alternative considered: ignore cache accounting entirely and just show DeepSeek's blended per-token price. Rejected per explicit user requirement to "take advantage of their caching appropriately" — the whole point of DeepSeek's caching model is the up-to-90%-cheaper hit rate, and silently ignoring it would make DeepSeek look far more expensive than it is for the app's typical multi-turn assistant conversations (long, mostly-stable system prompt + growing history — exactly the shape that maximizes cache hits).

**4. Model list: `deepseek-chat` (general purpose, DeepSeek-V3-class) and `deepseek-reasoner` (DeepSeek-R1-class, reasoning) as the curated fallback/default list, with live `/models` fetch (via the existing "fetch models" button) as the primary source when an API key is present.**

## Risks / Trade-offs

- [Risk] DeepSeek's actual base path or usage field names could differ from what's assumed here (docs can lag reality). → Mitigation: implementation step should do a live request against `https://api.deepseek.com` with a test key before finalizing the base URL constant and usage struct field names; `llm_test_connection` provides an existing UI affordance to validate this per-user.
- [Risk] Optional new usage fields on `OpenAIUsage` are silently `None` for OpenAI/Gemini, which is correct, but if a future provider reuses this struct and *does* send cache fields under different names, they'd be missed. → Mitigation: field names are DeepSeek-specific (`prompt_cache_hit_tokens`) and documented as such in a comment.
- [Risk] Cache-hit pricing only manifests when requests share a stable prefix; if the app ever reorders or trims history non-deterministically, users could see inconsistent hit rates. → Mitigation: none needed now — the app already sends full, order-stable conversation history; note this as an implicit dependency in a code comment rather than adding new logic.

## Migration Plan

Purely additive — no existing provider config, stored keys, or persisted `LLMProviderConfig` entries are touched. No data migration. Rollback is a plain revert of the added `"deepseek"` match arms and UI entry.

## Open Questions

- None blocking. The exact DeepSeek base-URL path (`/v1` vs bare domain) should be confirmed against current DeepSeek docs at implementation time (see Risk above).
