## Why

Testing the Cloudflare Clef decision model endpoint in the Customize Session modal yields `⚠️ Reachable, but not a decisions endpoint.` despite successful HTTP 200 responses because Cloudflare Workers AI wraps decision answers inside a `result` JSON envelope rather than placing them at top-level. Additionally, OpenRouter's System One endpoint URL assembly duplicates `/v1`, Clef model variants (`clef` 27B vs `clef-flash` 9B) lack clean selection, and OpenAI's decision models (`POST /v1/decisions` / `gpt-6-luna`) are not yet supported.

## What Changes

- **Unwrap REST response envelopes**: Update backend and frontend response parsers (`daqe_probe.rs`, `decisionModelProbe.ts`, and `systemOne.ts`) to extract `answers`, `model`, and `usage` from `body.result` when present (as returned by Cloudflare Workers AI) as well as top-level properties.
- **Fix OpenRouter endpoint resolution**: Remove duplicate `/v1` segment in `daqe_probe.rs` so OpenRouter correctly resolves to `https://openrouter.ai/api/v1/systemone`.
- **Add Cloudflare Clef model selection**: Support both `@cf/cloudflare/clef` (27B high-precision) and `@cf/cloudflare/clef-flash` (9B low-latency) with proper model resolution and probe payload passing.
- **Support OpenAI decision models**: Add `openai-decisions` provider option targeting `https://api.openai.com/v1/decisions` with model `gpt-6-luna`, reusing the existing `openai` keychain slot, requiring remote opt-in, and handling both `v1/decisions` and structured fallback formats.
- **Fix keychain allowlist drift in Rust `ai.rs`**: Ensure `set_api_key` and `remove_api_key` gracefully handle decision provider keys (`clef`, `jev`, `openai`) without hitting `unreachable!()`.

## Capabilities

### New Capabilities
- `queue-decision-model`: Defines decision-model provider integration for adaptive queue ranking, including Cloudflare Clef, OpenRouter, Jev, Laya, and OpenAI decision endpoints with envelope normalization, connection probing, and keychain credential resolution.

### Modified Capabilities
None.

## Impact

- **Backend**: `src-tauri/src/commands/daqe_probe.rs` (OpenAI decision provider support, OpenRouter URL normalization, response unwrapping), `src-tauri/src/commands/ai.rs` (keychain provider handling).
- **Frontend**: `src/lib/daqe/decisionModelOptions.ts` (OpenAI decision option, Clef model options), `src/lib/daqe/decisionModelProbe.ts` (Cloudflare envelope unwrapping, model probing), `src/lib/daqe/systemOne.ts` (envelope unwrapping), `src/components/queue/DaqeDecisionModelSettings.tsx` (UI model selector and settings for Clef and OpenAI), `src/components/queue/daqeDecisionClient.ts` (key provider resolution for OpenAI), `src/api/ai.ts` (keychain and provider types), and locale files.
