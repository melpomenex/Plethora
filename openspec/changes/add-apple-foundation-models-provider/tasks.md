## 1. Plugin bridge (depends on A crate)

- [x] 1.1 Confirm A landed `src-tauri/plugins/plethora-apple-intelligence/` registration in `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, and reserved `apple_fm_*` names in `src-tauri/capabilities/default.json`. Do not rename the plugin.
- [x] 1.2 Implement `src-tauri/plugins/plethora-apple-intelligence/ios/Sources/FoundationModelsBridge.swift` (`@available(iOS 26.0, macOS 26.0, *)`): availability snapshot from `SystemLanguageModel.default.availability`, never a SKU list.
- [x] 1.3 Implement commands `apple_fm_availability`, `apple_fm_generate`, `apple_fm_generate_stream` (or streamed generate), `apple_fm_cancel`, `apple_fm_count_tokens`, `apple_fm_warmup` in the plugin’s `src/lib.rs` module A reserved; non-Apple `cfg` returns `platform_unsupported`.
- [x] 1.4 Keep `IPHONEOS_DEPLOYMENT_TARGET = 14.0` in `src-tauri/gen/apple/project.yml` and `src-tauri/gen/apple/plethora-tauri.xcodeproj/project.pbxproj`. Guard every 26+ type. Add a compile smoke that iOS 14 target still links.
- [x] 1.5 Configure `LanguageModelSession` for on-device-only generation. If the OS would require Private Cloud Compute, fail with typed `FeatureDisabled` / `pcc_required` — do not generate.
- [x] 1.6 Single-flight native queue keyed by `requestId`; cancel drops queued and in-flight work; ignore late callbacks (mirror Android genai event channel). Event names `apple-fm://text`, `apple-fm://complete`, `apple-fm://error`.
- [x] 1.7 Map availability to DTOs consumed by TS: `available | deviceNotEligible | modelNotReady | disabled | unsupportedOs | platform_unsupported`, plus optional `contextSize` / `tokenCount` when present (26.4+).

## 2. TypeScript SDK and `AIProvider`

- [x] 2.1 Add `src/lib/ai/apple/foundation.ts`: invoke plugin commands via A’s `apple/plugin.ts`, TTL-cache availability (do not cache `modelNotReady` forever; poll like Nano `downloading`), no document text in logs.
- [x] 2.2 Add `src/lib/ai/providers/appleFoundationProvider.ts` exporting `APPLE_FOUNDATION_PROVIDER_ID = "ondevice-apple-foundation"` and `AppleFoundationProvider` implementing `AIProvider` from `src/lib/ai/providers/types.ts` (`getCapabilities`, `generateStream`, `countTokens`, `warmUp`, `cancel`).
- [x] 2.3 Map snapshot → `AIModelCapabilities`: `contextTokens` from native `contextSize`/`tokenCount` else **4096**; `structuredGeneration` when guided path live; `vision: false` in v1; `reasoning: false`; `embeddings: false`; `toolCalling: false` until D wires SpotlightSearchTool.
- [x] 2.4 Map native failures through A's categories in `src/lib/ai/errors.ts` without editing the union: `ModelDownloading`, `UnsupportedDevice`, `FeatureDisabled`, `UnsupportedLanguage`, `InputTooLarge`, `Cancelled`, `SafetyBlocked`, `GenerationFailed`, `InvalidStructuredOutput`.
- [x] 2.5 Honor `settings.features.appleFoundationModels` when present (default true): false forces `textGeneration: false`. Do not edit `getRoutingProviders` order in `src/lib/ai/providers/index.ts`; fill A's `getAppleFoundationProvider()` stub only.
- [x] 2.6 `countTokens`: use native `apple_fm_count_tokens` when the OS reports `tokenCount`; otherwise `estimateTokens` from `src/lib/ai/chunkTextByTokens.ts`. Reject over-budget **before** `apple_fm_generate`.

## 3. Guided schemas, prompts, chunking

- [x] 3.1 Add Swift `@Generable` types matching `smartTagging`, `learningMaterialProposal`, `libraryAnswer` (`src/lib/ai/schemas/smartTagging.ts`, `learningMaterial.ts`, `libraryAnswer.ts`) and `generatedFlashcards` matching `InternalOnDeviceFlashcard` in `src/lib/ai/cardValidator.ts`.
- [x] 3.2 Pass `AIRequest.systemInstruction` and `text` through unchanged. Do not add product prompt strings in Swift. Do not concatenate untrusted document text into `Instructions`.
- [x] 3.3 Smart tagging: existing `src/lib/ai/tasks/definitions/smartTaggingTask.ts` only. If `UseCase.contentTagging` is advertised, use it only when output still validates as `SmartTaggingOutput`; else default model + `smartTagging` schema. Keep Tier 1 `classifyDocumentBaseline` fallback in the task.
- [x] 3.4 Implement `runChunkedGeneration` in `src/lib/ai/apple/foundation.ts` using `chunkTextByTokens`: hierarchical map-reduce for text tasks; per-chunk then TS merge/dedupe for flashcards and Learn-this; **never** split `libraryAnswer` citation units (truncate chunk list / skip oversized chunk).
- [x] 3.5 After structured generate, TS validators remain authoritative (`validateSmartTaggingOutput`, `validateLearningMaterialProposal`, `validateLibraryAnswer`, `toGeneratedFlashcards`). Fail closed with `InvalidStructuredOutput` after the existing one repair retry in `runTask`.

## 4. UX, i18n, provenance, privacy

- [x] 4.1 Extend On-device panel copy (A’s `src/components/settings/OnDeviceAiPanel.tsx`) with Apple Intelligence states; one-shot explanation only when the user explicitly selects Apple while unavailable. Do not add Apple to `src/components/settings/AIProviderSettings.tsx` cloud list.
- [x] 4.2 Add i18n keys in `src/lib/i18n/locales/en.ts`, `zh.ts`, `es.ts`, `de.ts`, `fr.ts`, `ja.ts` for every availability/error string this change surfaces (`UnsupportedLanguage` included).
- [x] 4.3 Ensure accepted learning artifacts record `provider: "ondevice-apple-foundation"` via `src/api/ai-provenance.ts`. Diagnostics in `src/lib/ai/diagnostics.ts` stay content-free; include `providerId`, latency, error category, fallback flag.
- [x] 4.4 Confirm `settings.ai.preferOnDevice === false` does not auto-route to Apple; panel can still show status. Confirm `allowCloudFallback === false` (default) never silently uses `CloudProvider` or PCC.
- [x] 4.5 Confirm result surfaces keep a compact On-device chip when `providerKind === "ondevice"` (D-Apple-5). No `if (ios)` in `src/lib/ai/useAskLibrary.ts`, `SearchPage.tsx`, or Studio generate handlers.

## 5. Tests (CI) and device matrix (manual)

- [x] 5.1 Extend A’s `src/lib/ai/providers/fakes.ts` with `FakeAppleFoundationProvider` as an alias/subclass of `FakeLanguageProvider` (scriptable capabilities, structured payloads, cancel, `InputTooLarge`). Do not add a parallel fake module with a different method set.
- [x] 5.2 Vitest: `src/lib/ai/__tests__/appleFoundationProvider.test.ts` — availability mapping table, 4096 fallback, native context when stubbed 26.4 fields present, over-budget reject, cancel-never-fallback (use existing `runTask` helpers), unsupported language.
- [x] 5.3 Vitest: guided schema round-trip — valid `smartTagging` / `learningMaterialProposal` / `libraryAnswer` / `generatedFlashcards` pass TS validators; malformed fail closed. Fixture prompts include `<untrusted_source>` injection strings that must not become instructions.
- [x] 5.4 Vitest: `chunkTextByTokens` map-reduce — long text produces multiple native calls then a reduce; `libraryAnswer` path does not slice a single chunk id.
- [x] 5.5 Vitest: `preferOnDevice` false + Apple available → cloud/configured LLM first (A’s router). `allowCloudFallback` false + Apple failure → no `CloudProvider.generateStream`.
- [x] 5.6 Prove desktop/Android builds still compile plugin stubs (`platform_unsupported`) without FoundationModels.
- [x] 5.7 Manual / TestFlight checklist (not CI): eligible iPhone 26+ available; ineligible or Intelligence off; `modelNotReady`; iOS 14–25 launch; unsupported language; simulator unavailable. Record results in QA notes. Playwright is not a substitute.

## 6. Regression gates

- [x] 6.1 `npm run test:run` including new Apple FM tests; existing Nano tests in `src/lib/ai/__tests__/providers.test.ts` stay green.
- [x] 6.2 `cargo test --lib` and plugin stub tests; no Apple frameworks on non-Apple targets.
- [x] 6.3 Do not add network/fs/Tauri runtime to benches. No production app behavior change on Android.
