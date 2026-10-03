## Context

Plethora's Dynamic Adaptive Queue Engine (DAQE) supports multiple decision model providers (Jev, Laya, Clef, OpenRouter). Probing and invocation route through Rust (`daqe_probe.rs`) to avoid browser CORS limitations and standardize URL assembly.

Workers AI models return JSON inside a `{ "result": { ... }, "success": true }` wrapper. The probe parser currently looks for `answers` only at the top level of the JSON body. When probing Clef, Workers AI returns HTTP 200 with `{ "result": { "answers": { ... }, "model": "@cf/cloudflare/clef" } }`, which causes the probe to see empty answers and report `⚠️ Reachable, but not a decisions endpoint.`.

Furthermore, OpenRouter's URL assembly doubles `/v1`, Clef lacks explicit model variant configuration between 27B and 9B, OpenAI's new `v1/decisions` endpoint (`gpt-6-luna`) is not yet registered as a decision provider, and Rust's `set_api_key`/`remove_api_key` commands panic on decision provider keys due to `unreachable!()`.

## Goals / Non-Goals

**Goals:**
- Enable Cloudflare Clef connection probing and ranking by unwrapping `{ result: ... }` response payloads.
- Fix OpenRouter endpoint URL assembly to prevent duplicate `/v1` path segments.
- Add support for OpenAI decision models (`openai-decisions`) targeting `https://api.openai.com/v1/decisions` with `gpt-6-luna`, reusing the `openai` keychain slot and enforcing remote opt-in.
- Support selecting between Clef models (`@cf/cloudflare/clef` and `@cf/cloudflare/clef-flash`).
- Harden `src-tauri/src/commands/ai.rs` key management against unhandled providers.

**Non-Goals:**
- Implementing local model inference pipelines for Clef or OpenAI (they are remote services).
- Changing the underlying DAQE ranking scoring mathematical formulas.

## Decisions

### Decision 1: Dual-layer response envelope unwrapping
- In Rust (`src-tauri/src/commands/daqe_probe.rs`), when `parsed` contains a `result` object holding `answers` or `response`, unwrap it into the top-level `body` or preserve both.
- In TypeScript (`src/lib/daqe/decisionModelProbe.ts` and `src/lib/daqe/systemOne.ts`), check for `answers` inside `payload.result?.answers` as well as `payload.answers`.
- **Rationale**: Defense-in-depth ensures both Tauri backend probe and webview direct calls handle Cloudflare Workers AI's response envelope.

### Decision 2: Deduplicate OpenRouter path segments
- In `src-tauri/src/commands/daqe_probe.rs`, inspect the base URL: if it already ends in `/v1`, append `/systemone`; otherwise append `/v1/systemone`.
- In `src/lib/daqe/decisionModelOptions.ts`, ensure `OPENROUTER_BASE_URL` aligns consistently.

### Decision 3: Register `openai-decisions` provider
- Rust: Add `OpenAiDecisions` to `DecisionProvider` enum in `daqe_probe.rs`.
- Key slot: Map to `"openai"` in `key_slot()`.
- Endpoint: `https://api.openai.com/v1/decisions`.
- Model: `gpt-6-luna`.
- Body: Format as `{ "model": "gpt-6-luna", "state": ..., "questions": ... }`.
- Frontend: Add `OPENAI_DECISIONS_PROVIDER_ID = "openai-decisions"` in `decisionModelOptions.ts` with `"remote"` privacy and `"api-key"` setup, and map key provider to `"openai"`.

### Decision 4: Cloudflare Clef model selection
- Support both `@cf/cloudflare/clef` (27B) and `@cf/cloudflare/clef-flash` (9B).
- Allow user selection or default to `@cf/cloudflare/clef-flash` for high throughput, passing the selected model down into `probeViaBackend` and URL/body resolution.

### Decision 5: Non-panicking keychain commands in Rust
- In `src-tauri/src/commands/ai.rs`, replace `_ => unreachable!()` in `set_api_key` and `remove_api_key` with `_ => ()` for providers that only live in the keychain (`AIKeyStore`) and do not have an in-memory `AIState` field.

## Risks / Trade-offs

- **Risk**: OpenAI's `v1/decisions` endpoint is in preview and some API keys may encounter 403 Forbidden.
  - **Mitigation**: The probe cleanly translates 403 to `unauthorized` / `daqeProbe.reason.unauthorized` ("The key was rejected..."), clearly communicating access status to the user.
- **Risk**: Existing tests expecting strict top-level `{ answers: ... }`.
  - **Mitigation**: Update and add unit tests covering both top-level and enveloped response formats.
