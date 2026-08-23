## Why

Change A (`extend-ai-capability-routing-for-apple`) makes on-device inference a **list** of `AIProvider` backends instead of a Gemini Nano boolean, and reserves the `plethora-apple-intelligence` plugin plus error categories (`PermissionDenied`, `FeatureDisabled`, `UnsupportedLanguage`). Until this change, iOS/macOS still have no generative backend: `OnDeviceProvider` remains hard-wired to `ondevice-gemini-nano` in `src/lib/ai/providers/onDeviceProvider.ts`, and React must not grow `if (ios)` session calls.

Apple Foundation Models (`SystemLanguageModel`, iOS/iPadOS/macOS 26+) are the platform-native ~3B on-device generator. They must implement the **existing** `AIProvider` contract so `runTask`, smart tagging, Learn this, Ask Library, and Studio continue to own prompts and schemas in TypeScript. A parallel "Apple AI island" would fork product policy into Swift and break provenance, fallback, and tests.

## What Changes

- Implement `AppleFoundationProvider` (`id: "ondevice-apple-foundation"`, `kind: "ondevice"`) against `src/lib/ai/providers/types.ts` `AIProvider`.
- Add Swift `FoundationModelsBridge` in `src-tauri/plugins/plethora-apple-intelligence/` (crate and command names reserved by A) for availability, guided `@Generable` structured generation, streaming, cancellation, and token/context reporting.
- Add TypeScript SDK `src/lib/ai/appleFoundation.ts` that invokes `plugin:plethora-apple-intelligence` (`apple_fm_*` commands only).
- Map `SystemLanguageModel.Availability` into `AIModelCapabilities` + A's error categories. Never hard-code SKUs.
- Use guided generation matching existing TS schemas: `SmartTagging`, `LearningMaterialProposal`, `LibraryAnswer`, and on-device flashcards. Prompts stay in `src/lib/ai/tasks/`.
- Chunk long inputs with existing `chunkTextByTokens` (`src/lib/ai/chunkTextByTokens.ts`) and map-reduce / merge+dedupe for long documents. Context window: native `contextSize` / `tokenCount` on iOS 26.4+ when present, else conservative **4096**.
- Smart tagging uses the existing `smart-tagging` task (`src/lib/ai/tasks/definitions/smartTaggingTask.ts`); optionally `UseCase.contentTagging` when advertised, else default model + guided schema. Tier 1 baseline classifier remains the no-LLM fallback.
- Cloud fallback only through existing `settings.ai.allowCloudFallback` (default **false**) and `requestCloudFallback` in `src/lib/ai/tasks/runTask.ts`. Cancelled and safety-blocked runs never fall back.
- Provenance `provider` field is `ondevice-apple-foundation` via `src/api/ai-provenance.ts`.
- **No Private Cloud Compute** in v1 (cloud-class; out of scope).
- Tests with `FakeAppleFoundationProvider`. CI never requires Apple Intelligence hardware. Physical-device matrix is manual / TestFlight.
- App **deploy target stays iOS 14** (`IPHONEOS_DEPLOYMENT_TARGET = 14.0` in `src-tauri/gen/apple/`). All 26+ types are `@available` + runtime checks.
- Availability copy in all six locales (`src/lib/i18n/locales/{en,zh,es,de,fr,ja}.ts`). Unsupported Apple Intelligence languages surface `UnsupportedLanguage` with i18n, not a frozen language table.

## Capabilities

### New Capabilities

- `apple-foundation-models`: On-device Apple Foundation Models provider, Swift bridge, guided schemas, availability UX mapping, chunking/map-reduce, provenance, fakes, and device QA matrix.

### Modified Capabilities

- `ai-task-architecture`: Tasks may be served by `ondevice-apple-foundation` with the same `runTask` validation, containment, diagnostics, and cloud-fallback rules; no new task IDs required for v1.
- `apple-ai-capability-routing`: Fills the reserved Apple FM provider slot, `apple_fm_*` commands, and On-device panel status rows that A left as stubs/unavailable.

## Impact

- **Swift:** `src-tauri/plugins/plethora-apple-intelligence/ios/Sources/FoundationModelsBridge.swift` (and availability DTO mapping in `AppleCapabilities.swift` if A split that file).
- **Rust plugin surface:** additive `apple_fm_*` handlers in `src-tauri/plugins/plethora-apple-intelligence/src/lib.rs` behind modules A reserved; non-Apple `platform_unsupported`.
- **TS:** `src/lib/ai/appleFoundation.ts`, `src/lib/ai/providers/appleFoundationProvider.ts`, tests under `src/lib/ai/__tests__/`, `FakeAppleFoundationProvider` in `src/lib/ai/providers/fakeAppleFoundationProvider.ts` (or A's `fakes.ts` if the class was reserved).
- **Settings/i18n:** On-device panel copy for Apple availability states; no new row in OpenRouter/Ollama lists (`src/components/settings/AIProviderSettings.tsx`).
- **Capabilities allowlist:** `src-tauri/capabilities/default.json` permissions A reserved for `apple_fm_*`.
- **Tests:** Vitest with `FakeAppleFoundationProvider`; Swift `@available` compile on iOS 14 deployment target; desktop/Android stubs.

## Owns

- `FoundationModelsBridge.swift` and TS `appleFoundation.ts` / `AppleFoundationProvider`.
- Guided `@Generable` types that round-trip `smartTagging`, `learningMaterialProposal`, `libraryAnswer`, and `generatedFlashcards`.
- Availability → capability/error mapping, context budget, chunking/map-reduce helpers used **inside** the Apple adapter (not a second task layer).
- `FakeAppleFoundationProvider` and Apple FM unit tests.
- Apple-specific i18n keys for availability / unsupported language / model-not-ready.
- Physical-device verification checklist in this change's tasks (evidence, not product code).

## Must NOT change

- `src/lib/ai/providers/index.ts` **routing order** (A owns; B fills `getAppleFoundationProvider()` / reserved import).
- `src/lib/ai/errors.ts` category union (A owns; B only maps into existing categories).
- Task **prompt strings** and schema **validators** in `src/lib/ai/tasks/` and `src/lib/ai/schemas/` (tests may inject the fake provider; production prompts stay TS).
- Kotlin `plethora-android-genai` / `ondevice-gemini-nano` behavior.
- Help corpus / `defaultHelpRetrieval` / `askPlethoraTask.ts`.
- Spotlight indexer, Speech, Vision, NaturalLanguage, Core AI (C/E/F/G/H).
- `IPHONEOS_DEPLOYMENT_TARGET` (stays 14.0).
- Cloud provider picker UX; PCC as a user-visible provider.
- React components must not call Foundation Models APIs or `if (ios)` generate paths — only `useAiAvailability` / `runTask` / panel status from the provider.

## Dependencies

- **Hard:** `extend-ai-capability-routing-for-apple` (A) — plugin crate, reserved `apple_fm_*` commands, provider registry hook, extended `AIErrorCategory`, On-device panel that can render iOS status, platform capability IDs, fake-provider interfaces.
- **Soft:** existing `add-ondevice-ai-learning-system` Phase 0 task layer (already in tree): `runTask`, schemas, `smart-tagging`, `learn-this`, `ask-library`, Studio tasks, `chunkTextByTokens`, `allowCloudFallback`.
- **Soft:** `complete-ios-apple-privacy-compliance` for on-device vs cloud disclosure copy (no new camera/mic strings in this change).

## Parallelization Notes

- Parallel with C (Spotlight), E (Speech), F (Vision), G (NL) after A: distinct Swift files. Coordinate only on plugin `lib.rs` command enum and `capabilities/default.json` (A reserved names).
- D (`add-apple-ondevice-library-rag`) **optionally uses** this provider as the Ask Library generator; D must not block on B for lexical/SQLite retrieval, but on-device Apple answers require B.
- Do not edit high-conflict files A owns except adding the Apple provider **module** A already imports.

## Migration / Backward Compatibility

- Android: unchanged. Nano remains `ondevice-gemini-nano`.
- iOS < 26 or ineligible hardware: `textGeneration: false`; UI uses A's availability states; no crash; deploy target 14 still links via `@available` stubs.
- iOS 26+ with FM `.available` and `preferOnDevice !== false`: tasks route to Apple FM first per A's order.
- `allowCloudFallback` default remains false. Users with only Apple FM and fallback off get on-device-only or a typed unavailable error — never silent PCC or silent OpenRouter.
- Provenance for newly accepted artifacts records `ondevice-apple-foundation`; existing Nano/cloud rows untouched.
- Optional QA flag `settings.features.appleFoundationModels` (default **true** when A added it; if A omitted it, add default true) may disable auto-routing for iOS-first TestFlight without removing the panel.

## Risks

- Unguarded iOS 26 types break iOS 14 compile → `@available` + runtime checks; non-Apple OS never links FoundationModels.
- Accidental Private Cloud Compute → treat PCC as cloud-class; v1 session configuration must stay on-device-only; if the OS cannot guarantee on-device, report `FeatureDisabled` rather than generate.
- Guided schema drift vs TS validators → Swift `@Generable` field names must match `nativeName` / JSON shape; fail closed through existing `InvalidStructuredOutput` + one repair retry.
- Context window guessed wrong across 26.0 vs 26.4 → prefer native `contextSize`/`tokenCount`; conservative 4096 otherwise; never send over-budget requests.
- Language / Apple Intelligence locale gaps → runtime check, `UnsupportedLanguage`, i18n; do not freeze a SKU table.
- Simulator typically `modelNotReady` / unavailable → CI uses `FakeAppleFoundationProvider` only.
- Merge conflict on plugin command list → A reserved names; this change implements reserved commands only.
