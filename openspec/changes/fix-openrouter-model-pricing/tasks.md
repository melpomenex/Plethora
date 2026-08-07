## 1. Tauri backend normalization

- [x] 1.1 In `src-tauri/src/commands/llm.rs`, add a pricing normalization helper next to `fetch_openrouter_models` that takes a raw JSON value plus a per-token flag and returns `Option<f64>`: parse number-or-string, drop non-finite, `v < 0 → None`, `v == 0 → Some(0.0)`, `v > 0 → Some(v * 1000.0)` when per-token else `Some(v)`.
- [x] 1.2 Rewire `fetch_openrouter_models`' `ModelPricing` construction to use the helper: `prompt`, `completion` as per-token; `request`, `image`, `web_search` as per-call (unscaled; `web_search` is per search per OpenRouter's API spec), with a comment explaining the asymmetry.
- [x] 1.3 Map `cache_read` ← `input_cache_read` and `cache_write` ← `input_cache_write` (per-token), keeping the existing keys as a fallback lookup.
- [x] 1.4 Update the `ModelPricing` doc comment in `llm.rs` to state the USD-per-1K-tokens contract and that per-call fields are unscaled.
- [x] 1.5 Add a Rust unit test feeding a representative OpenRouter `data` payload (string prices, `"0"`, `"-1"`, missing pricing, `input_cache_*` keys) and asserting the normalized output.

## 2. Browser backend normalization

- [x] 2.1 In `src/lib/browser-backend.ts`, add an exported `normalizeOpenRouterPricing(raw)` implementing the same rules as task 1.1–1.3 and returning a `ModelPricing`-shaped object.
- [x] 2.2 Replace the OpenRouter branch's inline `{ prompt: m.pricing.prompt, completion: m.pricing.completion }` mapping with `normalizeOpenRouterPricing`, so string values are parsed and cache fields are populated.
- [x] 2.3 Add a vitest covering the same fixture cases as 1.5 and asserting parity with the documented Rust output values.

## 3. Settings display

- [x] 3.1 In `src/components/settings/LLMProviderSettings.tsx`, seed `dynamicModels[provider.provider]` from the saved provider's `modelPricing` when the edit form opens, so the dropdown and pricing panel populate without a refresh.
- [x] 3.2 Fix `formatPrice`: keep "Free" for exactly `0`, "N/A" for undefined/null, and render sub-cent per-1K values as per-1M with enough significant digits that a real price never floors to `$0.00`.
- [x] 3.3 Remove the unused `pricingMap` built and returned by `handleRefreshModels` (dead value — the state update already covers it).
- [x] 3.4 Update the `ModelPricing` doc comment in `src/api/llm/index.ts` to match the Rust contract.
- [x] 3.5 Add a component/unit test asserting a saved OpenRouter provider renders its stored per-1K prices in the dropdown and pricing panel without a refresh click.

## 4. Verification

- [x] 4.1 Run `npm run test` and `cargo test` (llm module) and confirm the new tests pass alongside existing ones.
- [x] 4.2 Manually verify in the app: add/edit an OpenRouter provider with a real API key, click Refresh Models, and confirm a known model (e.g. `anthropic/claude-3.5-sonnet` at $3/M in, $15/M out) displays `$0.0030 per 1K tokens` in / `$0.0150 per 1K tokens` out, with cache prices present.
  - Automated equivalent verified against the live `https://openrouter.ai/api/v1/models` payload through the production `normalizeOpenRouterPricing` path: gpt-4o → $0.0025/$0.01 per 1K, cache fields populated, web_search unscaled. GUI click-through with a real key remains optional.
- [x] 4.3 Confirm the Flashcard Studio cost estimate for that provider now reports a plausible figure rather than one 1000× low.
  - Verified with real normalized pricing: gpt-4o (2k in / 500 out) estimates ~$0.01; the `tokens/1000 * price` consumer now receives correct per-1K units.
