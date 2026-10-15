## Why

Plethora already routes study AI through `AIProvider` / `runTask` / `resolveAiPath`, but the only on-device backend is Gemini Nano on Android. `isOnDeviceAiSupportedPlatform()` is Android-only, `getRoutingProviders()` returns a single `OnDeviceProvider`, and `OnDeviceAiPanel` renders nothing on iOS. Apple Foundation Models, Speech, Vision, Spotlight, and NaturalLanguage therefore cannot plug in without either forking the task layer or scattering `if (ios)` through React.

iOS users currently get no private on-device generation, and native-mobile transcription silently substitutes Groq for "local." We need a **multi-backend on-device registry** that keeps features capability-oriented, preserves Android Nano and cloud providers, and gives later Apple proposals a stable plugin, error, fake-provider, and settings contract.

## What Changes

- Treat on-device inference as a **list of `AIProvider` implementations** (Nano, Apple Foundation Models, later Core AI), not a boolean Android bridge.
- Split Android-specific `onDeviceAI.ts` types from a platform-neutral capability snapshot and error mapping used by every native backend.
- Add Tauri plugin crate **`plethora-apple-intelligence`** with non-Apple stubs (`platform_unsupported`) and reserved command namespaces; Swift modules land in follow-on changes.
- Extend `AIErrorCategory` with `PermissionDenied`, `FeatureDisabled`, `UnsupportedLanguage`.
- Extend settings/UX: On-device intelligence panel on iOS/macOS (availability only in this change), keep `preferOnDevice` / `allowCloudFallback` semantics.
- Register platform capability IDs for Apple surfaces (runtime-gated, not assumed).
- Ship **fake providers** (`FakeLanguageProvider`, and interfaces for speech/vision/search) so CI never needs Apple Intelligence hardware.
- Document file ownership so Foundation Models, Spotlight, Speech, Vision, NL, and Core AI agents do not all edit the same core files.

## Capabilities

### New Capabilities

- `apple-ai-capability-routing`: Multi-backend on-device provider registry, Apple plugin skeleton, extended errors, fakes, settings/availability semantics, platform capability IDs, privacy indicator contract.

### Modified Capabilities

- `ai-task-architecture`: Provider registry may return multiple on-device providers; `kind: "ondevice"` is no longer synonymous with Gemini Nano.
- `android-genai`: Unchanged behavior on Android; Nano remains `ondevice-gemini-nano`. Desktop/iOS continue to see Nano as `platform_unsupported`.

## Impact

- **Frontend:** `src/lib/ai/providers/**`, `provider.ts`, `errors.ts`, `onDeviceAI.ts` (split), `useAiAvailability.ts`, `OnDeviceAiPanel.tsx`, `AIProviderSettings.tsx`, `platformCapabilities.ts`, `settingsStore.ts` (flags + comments only), new `src/lib/ai/providers/fakes.ts`.
- **Native:** new `src-tauri/plugins/plethora-apple-intelligence/` (Rust stubs + empty iOS Package.swift plugin class with `capabilities()` returning unsupported on < iOS 26). Register in `Cargo.toml`, `lib.rs`, `capabilities/default.json`.
- **Tests:** provider routing with two on-device fakes; iOS snapshot unavailable; Android Nano still first on Android; preferOnDevice false uses cloud; cancelled-never-fallback preserved.
- **Explicit non-goals:** implementing Foundation Models, Speech, Vision, Spotlight, NL embeddings, or Core AI inference; changing cloud provider list UX; raising iOS deployment target; Private Cloud Compute.

## Owns

Everything in Impact. Reserves plugin command names listed in design.md.

## Must NOT change

- Kotlin `plethora-android-genai` inference behavior
- Task prompt strings / schema validators (except using new error categories)
- Transcription resolver policy (owned by Speech change) except that this change may add a typed `apple` provider **slot** in types if needed by fakes — Speech change fills it
- Import picker sources (Vision change)
- Semantic indexer SQL (Spotlight / NL changes)
- Help retrieval corpus

## Dependencies

- Hard: existing `add-ondevice-ai-learning-system` Phase 0 (already in tree).
- Soft: `complete-ios-apple-privacy-compliance` for purpose-string injection when later changes need camera/mic copy updates.

## Parallelization Notes

This change **must land first**. Follow-on Apple changes add Swift files and TS adapters against reserved commands. Do not let B–H edit `providers/index.ts` routing order, `errors.ts` category union, or plugin `Builder::new` name.

## Migration / Backward Compatibility

- Android: no user-visible change. `preferOnDevice` still prefers Nano when available.
- iOS/desktop: still no on-device generation until B ships; availability reports unsupported/not eligible rather than pretending Nano exists.
- Existing `OnDeviceAiError` codes still map; new categories are additive.
- `allowCloudFallback` remains default false.

## Risks

- Splitting `onDeviceAI.ts` can break Nano tests if imports are not re-exported.
- Plugin registration can fail desktop compile if Apple frameworks leak into non-iOS cfg.
- Settings copy that says "Gemini Nano" on iOS would confuse users — panel must be platform-specific.
