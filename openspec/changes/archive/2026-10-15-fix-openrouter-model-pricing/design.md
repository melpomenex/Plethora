## Context

`ModelPricing` (declared in both [llm.rs:1717](src-tauri/src/commands/llm.rs:1717) and [index.ts:253](src/api/llm/index.ts:253)) is documented as **USD per 1K tokens**. Every hardcoded fallback in the codebase follows that unit (e.g. GPT-4o `prompt: 0.0025`), and the only consumer that computes money — the Flashcard Studio estimate at [FlashcardStudioModal.tsx:963](src/components/review/FlashcardStudioModal.tsx:963) — divides token counts by 1000 accordingly.

OpenRouter's `/models` endpoint does not use that unit. It returns pricing as **USD per single token, string-encoded**:

```json
{ "id": "anthropic/claude-3.5-sonnet",
  "pricing": { "prompt": "0.000003", "completion": "0.000015",
               "input_cache_read": "0.0000003", "input_cache_write": "0.00000375" } }
```

Neither fetch path converts:

- [llm.rs:1738](src-tauri/src/commands/llm.rs:1738) `fetch_openrouter_models` parses the strings to `f64` correctly but stores them unconverted → every OpenRouter price is 1000× too low. It also reads `cache_read`/`cache_write`, keys OpenRouter never sends, so cache prices are always `None`.
- [browser-backend.ts:3675](src/lib/browser-backend.ts:3675) passes `m.pricing.prompt` straight through as a **string**, so `formatPrice` (`price.toFixed`) sees a string and renders `$0.00`.

Two display bugs compound this: `dynamicModels` at [LLMProviderSettings.tsx:134](src/components/settings/LLMProviderSettings.tsx:134) starts empty and is only filled by the "Refresh Models" button, so a saved provider's persisted `modelPricing` is never shown; and `formatPrice` at [LLMProviderSettings.tsx:329](src/components/settings/LLMProviderSettings.tsx:329) uses `toFixed(2)` on the per-1M figure, which floors real cheap-model prices to `$0.00`.

## Goals / Non-Goals

**Goals:**
- One pricing unit (USD per 1K tokens) enforced at each provider fetch boundary.
- OpenRouter prices, including cached-input prices, correct in both the Tauri and browser backends.
- Stored per-provider pricing visible in settings without a manual refresh.

**Non-Goals:**
- Changing the `ModelPricing` unit contract or any consumer's arithmetic.
- Adding pricing normalization for providers whose adapters return no pricing today (OpenAI/Gemini/Ollama live fetches) — out of scope, unchanged.
- Migrating already-persisted `modelPricing` blobs in place, or building a pricing cache/refresh schedule.

## Decisions

**Convert at the adapter, not at the display layer.** The OpenRouter response is the only thing in a foreign unit; normalizing where it is parsed means every consumer (dropdown, pricing panel, studio cost estimate, anything added later) is correct for free. The alternative — tagging each `ModelPricing` with its unit and converting at each render site — spreads a provider quirk across the whole app and would need every future consumer to remember the tag.

**Keep the existing defensive raw-JSON parsing in Rust.** `fetch_openrouter_models` already parses `serde_json::Value` with a string-or-number `parse_f64` helper precisely because OpenRouter's types drift. That stays; the change is a `* 1000.0` on the parsed value plus the sentinel rule below, applied through one small helper so all seven fields share it.

**Sentinels: `0` is free, negative is unknown.** OpenRouter uses `"0"` for free models and negative values for "no price published". Mapping both to `Some(0.0)` would advertise paid models as free, and mapping both to `None` would lose the free signal. So: `v == 0 → Some(0.0)`, `v < 0 → None`, `v > 0 → Some(v * 1000.0)`. Non-finite parses (`NaN`, `inf`) are dropped to `None`.

**Field mapping.** `prompt`, `completion`, `request`, `image`, `web_search` keep their names; `cache_read` ← `input_cache_read`, `cache_write` ← `input_cache_write`. `request`, `image` and `web_search` are per-call (OpenRouter's OpenAPI spec: `web_search` is "Price in USD per web search"), not per-token, so they are **not** multiplied — only the per-token fields (`prompt`, `completion`, `cache_read`, `cache_write`) are scaled. This asymmetry is the one subtle part of the change and is worth a comment at the call site.

**Mirror the logic in `browser-backend.ts` rather than sharing it.** The browser fallback is a standalone TS reimplementation of the Rust commands with no shared module today; introducing a shared abstraction for ~15 lines would be more machinery than the duplication costs. A small exported `normalizeOpenRouterPricing` helper in the browser backend, covered by a unit test, keeps it honest.

**Seed `dynamicModels` from the provider being edited.** When the edit form opens for a saved provider, seed `dynamicModels[provider.provider]` from `provider.modelPricing` (already a `Record<string, ModelInfo>`). No new fetch on mount — that would spend an API call on every settings visit; the manual Refresh button remains the way to get fresh data.

**Persisted-value correction.** Pricing stored before this fix is 1000× low. Rather than a migration, the fix is inherently self-healing: any Refresh Models rewrites it. Because the values are only ever used for display and a cost *estimate*, a stale-low estimate for one session is acceptable; a schema version bump is not warranted.

## Risks / Trade-offs

- **Duplicated normalization in Rust and TS drifts apart** → both are covered by unit tests fed the same fixture payload shape, and the spec requires identical output from both backends.
- **`request`/`image`/`web_search` are per-call and must not be scaled** → wrong here means a 1000× error in the opposite direction; the helper takes an explicit per-token flag rather than defaulting.
- **Users who never click Refresh keep 1000×-low stored pricing** → the studio cost estimate stays understated until they do. Accepted over a migration; the values are estimates, and the settings panel now displays the stored numbers where a wrong figure is at least visible.
- **OpenRouter renames its cache keys again** → parsing is key-by-key and lenient, so a rename degrades to a missing cache price rather than a failed fetch.

## Open Questions

- Should a stored-pricing refresh be triggered automatically when a provider's pricing is older than some threshold? Deferred — not needed to fix the reported bug.
