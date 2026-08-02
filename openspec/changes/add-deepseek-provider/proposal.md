## Why

The assistant chat settings currently support OpenAI, Anthropic, Gemini, Ollama, and OpenRouter as LLM providers. DeepSeek offers strong, low-cost coding/reasoning models (`deepseek-chat`, `deepseek-reasoner`) with an OpenAI-compatible API and automatic, transparent prompt caching (disk-based context caching billed at a steep discount on cache hits). Users want DeepSeek as a selectable provider, and the app's cost-tracking UI should reflect DeepSeek's cache-hit discount the same way it already does for Anthropic's prompt caching.

## What Changes

- Add `deepseek` as a selectable provider in the assistant chat provider settings (`LLMProviderSettings.tsx`), alongside OpenAI/Anthropic/Gemini/Ollama/OpenRouter, following the same pattern used for Gemini (an OpenAI-compatible endpoint reusing the existing OpenAI request/response code path rather than a bespoke provider implementation).
- Default base URL `https://api.deepseek.com` (OpenAI-compatible `/chat/completions`, `/models` routes) and a curated default/fallback model list (`deepseek-chat`, `deepseek-reasoner`).
- Extend `ConfiguredLLMProvider` and the related keyless-access/API-key-requirement helpers (`llmProviderUtils.ts`) to include `deepseek`.
- Extend the Rust command layer (`commands/llm.rs`: `llm_chat`, `llm_chat_with_context`, `llm_stream_chat`, `llm_get_models`, `llm_test_connection`) to route `"deepseek"` through the existing OpenAI-compatible branches, and add `"deepseek"` to `get_default_base_url`.
- Surface DeepSeek's cache-hit/cache-miss token accounting: parse `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` from DeepSeek's usage payload (an OpenAI-compatible superset) and populate the existing `cache_read` cost field so the app's cost estimator applies DeepSeek's discounted cache-hit rate instead of treating all input tokens as cache misses. No `cache_write` cost applies (DeepSeek caching is automatic and free to write).
- Document, in a code comment near the request builder, that cache hits depend on sending an identical/shared message-prefix across requests (system prompt + prior turns unchanged) — informational only, no behavior change required since the app already replays full conversation history in order.
- Add DeepSeek to the i18n locale strings that currently enumerate provider names (`en.ts`, and mirrored in other locales as untranslated fallback keys).

## Capabilities

### New Capabilities
- `deepseek-llm-provider`: Selecting, configuring, and using DeepSeek as an assistant chat LLM provider, including accurate cache-hit-aware cost estimation.

### Modified Capabilities
(none — no existing spec capability currently covers LLM provider selection)

## Impact

- Frontend: `src/utils/llmProviderUtils.ts`, `src/stores/llmProvidersStore.ts`, `src/components/settings/LLMProviderSettings.tsx`, `src/api/llm/index.ts`, i18n locale files.
- Backend (Tauri/Rust): `src-tauri/src/commands/llm.rs` (provider dispatch, model catalog, usage parsing, base URL defaults). No changes needed to `src-tauri/src/ai/provider_wrapper.rs` / `ai/providers.rs` (the flashcard generator / QA / summarizer subsystem) — DeepSeek is scoped to the assistant chat path only, matching how Gemini was integrated.
- No database schema changes. No breaking changes to existing providers.
