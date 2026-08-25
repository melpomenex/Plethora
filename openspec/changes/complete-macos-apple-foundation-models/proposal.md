## Why

Prior Apple Foundation Models work (`add-apple-foundation-models-provider`) built the TypeScript provider architecture and an iOS-only Tauri mobile plugin, but macOS desktop receives `platform_unsupported` from Rust because all native commands are gated behind `#[cfg(target_os = "ios")]`. The Swift bridge also reports stub availability, ignores system instructions, fakes streaming, and does not use real Foundation Models APIs. Plethora on Apple Silicon Macs with Apple Intelligence enabled cannot route existing AI tasks through the system on-device model.

## What Changes

- Add a macOS desktop native bridge (Rust ↔ C ABI ↔ Swift ↔ FoundationModels) alongside the existing iOS mobile plugin path.
- Fix Foundation Models bridge on both iOS and macOS: real `SystemLanguageModel.default.availability`, session instructions, `response.content` extraction, streaming, cancellation, native token/context APIs, and guided structured generation for supported schemas.
- Wire macOS Rust plugin commands to the desktop bridge; keep Linux/Windows stubs unchanged.
- Update TypeScript provider layer to use streaming events, pass structured schema names, and preserve existing chunking/routing/fallback semantics.
- Improve On-device AI settings panel on macOS with actionable Apple Intelligence status.
- Add Vitest/Rust regression tests and a diagnostic smoke path for physical Mac verification.

## Capabilities

### New Capabilities

- `macos-apple-foundation-models`: macOS desktop execution path for Apple Foundation Models through the existing `ondevice-apple-foundation` provider, including native bridge, availability, streaming, cancellation, structured generation, and privacy guarantees.

### Modified Capabilities

- `apple-foundation-models`: Extend requirements to cover macOS desktop bridge architecture, real availability detection, session instructions, streaming, cancellation, native token/context APIs, and guided structured output (previously marked complete but not fully implemented).

## Impact

- `src-tauri/plugins/plethora-apple-intelligence/` — macOS Swift bridge, build.rs, Rust command routing
- `src-tauri/plugins/plethora-apple-intelligence/ios/Sources/FoundationModelsBridge.swift` — iOS parity fixes
- `src/lib/ai/apple/foundation.ts`, `appleFoundationProvider.ts` — streaming, structured, capability mapping
- `src/components/settings/OnDeviceAiPanel.tsx` — macOS status UX
- Tests under `src/lib/ai/**/__tests__/` and plugin Rust tests
- No changes to cloud provider routing, task prompts, or SM-2 scheduling logic
