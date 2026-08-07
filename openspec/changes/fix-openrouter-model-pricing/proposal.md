## Why

OpenRouter model prices shown in Settings → LLM Providers are wrong by a factor of 1000 (or shown as `$0.00`/`N/A`), because OpenRouter's `/models` endpoint returns pricing as **USD per single token, encoded as strings**, while the rest of the app treats `ModelPricing` as **USD per 1K tokens, as numbers**. The same numbers feed the Flashcard Studio cost estimate, so estimated spend is understated by 1000×.

## What Changes

- Normalize OpenRouter `/models` pricing at the fetch boundary: parse string-encoded values and convert per-token → per-1K tokens (×1000) so the fetched data matches the documented `ModelPricing` contract.
- Map OpenRouter's cache pricing keys (`input_cache_read` / `input_cache_write`) onto `cache_read` / `cache_write`, which are currently never populated.
- Apply the same normalization in both backends: the Tauri command (`fetch_openrouter_models` in `src-tauri/src/commands/llm.rs`) and the browser fallback (`llm_get_models` in `src/lib/browser-backend.ts`), which today silently passes raw strings through.
- Treat OpenRouter's `"0"` / `"-1"` sentinels correctly: `0` means free, negative means "not priced" and is reported as unknown rather than as a price.
- Populate the model dropdown and pricing panel from a saved provider's stored `modelPricing` on mount, so prices are visible without clicking "Refresh Models" first.
- Fix `formatPrice` so sub-cent per-1K values render as a meaningful per-1M figure instead of `$0.00 per 1M tokens`.

No breaking changes: the `ModelPricing` unit contract (per 1K tokens) is unchanged — this makes OpenRouter conform to it.

## Capabilities

### New Capabilities
- `llm-model-pricing`: How model pricing is fetched, normalized to a single unit, stored per provider, and displayed in provider settings and cost estimates.

### Modified Capabilities
<!-- None: no existing spec covers LLM provider pricing. -->

## Impact

- `src-tauri/src/commands/llm.rs` — `fetch_openrouter_models`, `ModelPricing` doc comment.
- `src/lib/browser-backend.ts` — `llm_get_models` OpenRouter branch and `createModelInfo`.
- `src/components/settings/LLMProviderSettings.tsx` — `dynamicModels` seeding from stored `modelPricing`, `formatPrice`.
- `src/api/llm/index.ts` — `ModelPricing` unit documentation.
- Downstream consumer: `src/components/review/FlashcardStudioModal.tsx` cost estimate (`tokens / 1000 * price`) becomes correct once the unit is honored; no code change expected there.
- Persisted `LLMProviderConfig.modelPricing` written before this fix holds 1000×-low OpenRouter values; a re-fetch on load corrects it.
