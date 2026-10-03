## 1. Rust Backend (`daqe_probe.rs` & `ai.rs`)

- [x] 1.1 Support response unwrapping in `daqe_probe.rs` so that response bodies wrapped in `result` (such as Cloudflare Workers AI) have `answers`, `model`, and `usage` accessible, and verify with unit tests in `daqe_probe.rs`.
- [x] 1.2 Fix OpenRouter URL resolution in `daqe_probe.rs` so appending `/v1/systemone` does not duplicate `/v1` when the base URL ends with `/v1`, and verify with unit tests.
- [x] 1.3 Add `OpenAiDecisions` variant to `DecisionProvider` in `daqe_probe.rs` resolving to `https://api.openai.com/v1/decisions` with default model `gpt-6-luna` using the `"openai"` keychain slot, and verify with unit tests.
- [x] 1.4 Harden `set_api_key` and `remove_api_key` in `src-tauri/src/commands/ai.rs` to safely handle decision provider keys (`clef`, `jev`, etc.) without panicking on `unreachable!()`, and verify with `cargo test`.

## 2. Frontend Core Protocol & Probe (`decisionModelProbe.ts`, `systemOne.ts`)

- [x] 2.1 Update `decisionModelProbe.ts` `readBackendProbe` to inspect `response.body.result` for `answers`, `model`, and `usage` when present, and verify with unit tests in `decisionModelProbe.test.ts`.
- [x] 2.2 Update `systemOne.ts` `callSystemOne` to unwrap `payload.result` when present, and verify with unit tests in `systemOne.test.ts`.
- [x] 2.3 Update `probeViaBackend` in `decisionModelProbe.ts` to forward `modelFor(providerId, config)` so model selection applies to Clef and other multi-model providers during connection tests.

## 3. Decision Model Options & Settings UI (`decisionModelOptions.ts`, `DaqeDecisionModelSettings.tsx`, `daqeDecisionClient.ts`, `ai.ts`)

- [x] 3.1 Register `OPENAI_DECISIONS_PROVIDER_ID = "openai-decisions"` in `decisionModelOptions.ts` with `"remote"` privacy, `"api-key"` setup, and docs link to OpenAI.
- [x] 3.2 Add Clef model variants list (`@cf/cloudflare/clef` and `@cf/cloudflare/clef-flash`) and model selection in `decisionModelOptions.ts` and `DaqeDecisionModelSettings.tsx`.
- [x] 3.3 Update `decisionKeyProviderFor` in `daqeDecisionClient.ts` to map `openai-decisions` to the `"openai"` key slot.
- [x] 3.4 Update `daqueHttpProviderFor` and `DaqeHttpProvider` in `src/api/ai.ts` to include `"openai-decisions"`.
- [x] 3.5 Add localization strings for `openai-decisions` and Clef model options across locale files.

## 4. Verification & Testing

- [x] 4.1 Run unit test suites (`npm test src/__tests__/daqe*`, `src/lib/daqe/*.test.ts`) and ensure all probe, client, and option tests pass.
- [x] 4.2 Run cargo tests on backend (`cargo test daqe_probe`).
- [x] 4.3 Run typecheck and linting (`npx tsc --noEmit`).
