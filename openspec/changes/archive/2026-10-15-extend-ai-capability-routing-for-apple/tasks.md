## 1. Plugin skeleton

- [x] 1.1 Create `src-tauri/plugins/plethora-apple-intelligence/` with `Cargo.toml`, `build.rs`, `src/lib.rs` (Wry plugin, `apple_capabilities` + reserved stubs), `permissions/default.toml`, iOS `Package.swift` + `Sources/AppleIntelligencePlugin.swift` (no iOS 26-only types unguarded), macOS cfg as applicable.
- [x] 1.2 Register the crate in `src-tauri/Cargo.toml` and initialize in `src-tauri/src/lib.rs` beside `plethora-storekit` / `plethora-android-genai`.
- [x] 1.3 Add `plethora-apple-intelligence:default` to `src-tauri/capabilities/default.json`.
- [x] 1.4 Ensure `cargo check` on desktop and the existing iOS compile path succeed without linking FoundationModels.

## 2. TypeScript registry and split SDKs

- [x] 2.1 Add `src/lib/ai/apple/plugin.ts` and `capabilities.ts` returning a stub snapshot (`platform_unsupported` off Apple OS).
- [x] 2.2 Add stub `AppleFoundationProvider` and `AppleCoreAiProvider` with `textGeneration: false` until later changes flip capabilities.
- [x] 2.3 Change `getRoutingProviders()` to list Nano + Apple FM + Core AI + cloud per design order; skip nulls.
- [x] 2.4 Fix `resolveTaskRoute` so providers with `textGeneration: false` are not treated as usable.
- [x] 2.5 Update `resolveAiPath` / `isOnDeviceAiSupportedPlatform` so iOS/macOS can be on-device platforms **when a live Apple provider exists** (stub remains false until B).
- [x] 2.6 Keep `onDeviceAI.ts` Android exports stable; add re-exports if files split.

## 3. Errors, flags, platform IDs, fakes

- [x] 3.1 Extend `AI_ERROR_CATEGORIES` and mappers; unit tests for new categories and cancelled-never-fallback.
- [x] 3.2 Add feature flags in `settingsStore.ts` with defaults from the design; persist tests.
- [x] 3.3 Register platform capability IDs in `platformCapabilities.ts` + matrix tests (`on_device_ai_apple_foundation`, `apple_speech_transcription`, `import_document_scan`, `import_photo_library`, `apple_spotlight_search`, `on_device_ai_apple_coreai`).
- [x] 3.4 Add `src/lib/ai/providers/fakes.ts` (`FakeLanguageProvider`, `FakeSpeechProvider`, `FakeVisionProvider`, `FakeSemanticSearchProvider`) with unit tests.

## 4. Settings UX

- [x] 4.1 Extend `OnDeviceAiPanel` to render on iOS/macOS with Apple snapshot (stub unavailable) without launch toasts; keep Android Nano UI.
- [x] 4.2 Add `OnDeviceProcessingBadge` and a snapshot test; do not sprinkle badges across the app in this change.
- [x] 4.3 Adjust copy that claims on-device AI is Android-only in `AIProviderSettings.tsx` comments/UI.

## 5. Tests and gates

- [x] 5.1 Update `src/lib/ai/__tests__/providers.test.ts`, `provider.test.ts`, `router.test.ts`, `providerFallback.test.ts` for multi-provider routing.
- [x] 5.2 Add plugin stub tests or Rust unit tests for `platform_unsupported` / `not_implemented`.
- [x] 5.3 Run `npm run test:run` for affected suites and `cargo test --lib` as applicable; do not require Apple hardware.

## 6. Ownership freeze

- [x] 6.1 Comment in plugin `lib.rs` listing reserved commands and which follow-on OpenSpec owns each block.
- [x] 6.2 Do not implement FM/Speech/Vision/Spotlight/NL/CoreAI bodies beyond stubs.
