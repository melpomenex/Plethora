## Context

Change A (`extend-ai-capability-routing-for-apple`) registered `plethora-apple-intelligence` and wired TypeScript providers. Change B (`add-apple-foundation-models-provider`) marked all tasks complete, but verification shows:

- Rust plugin commands are `#[cfg(target_os = "ios")]` only; macOS desktop returns `platform_unsupported`.
- `build.rs` only sets `.ios_path("ios")`; no macOS Swift linkage.
- `FoundationModelsBridge.swift` stubs availability, ignores `systemInstruction`, uses `String(describing:)`, fakes streaming/cancellation, and lacks `@Generable`.

TypeScript already treats `macos`/`darwin` as Apple OS (`isAppleOsPlatform()`), so the UI and router expect Apple FM on Mac but native execution fails.

Verified SDK (macOS 26.5 / Xcode 26.6): `SystemLanguageModel.default.availability`, `LanguageModelSession(instructions:)`, `response.content`, `streamResponse`, `tokenCount(for:)`, `contextSize`, `@Generable`/`Generable` protocol, `GenerationOptions(maximumResponseTokens:temperature:)`.

## Goals / Non-Goals

**Goals:**

- macOS desktop executes Foundation Models through the existing `ondevice-apple-foundation` provider.
- iOS bridge reaches parity with the same behavioral contract.
- Real availability, instructions, streaming, cancellation, token/context APIs, guided structured output.
- Weak-link FoundationModels; app launches on macOS < 26 with capabilities reporting unavailable.
- No Private Cloud Compute; fail closed on PCC-required errors.
- Preserve existing task layer, routing, chunking, validation, provenance, cloud fallback policy.

**Non-Goals:**

- Speech/Vision/Spotlight/NL/Core AI macOS bridges (FM only).
- Raising app minimum macOS above 10.13 (Tauri conf).
- New React-native FM calls or second prompt system.

## Decisions

### 1. Dual native paths: iOS mobile plugin + macOS C ABI

| Platform | Mechanism |
|---|---|
| iOS | Existing Tauri `ios_plugin_binding!` → `AppleIntelligencePlugin.swift` |
| macOS | Rust `macos_bridge.rs` → C ABI → `MacFoundationBridge.swift` |
| Linux/Windows | Existing typed stubs |

Tauri 2's mobile plugin API does not apply to macOS desktop. A stable C ABI (`plethora_apple_fm.h`) is the narrow boundary; Swift owns FoundationModels types.

*Alternative rejected:* Force iOS plugin onto macOS — unsupported by Tauri.

### 2. Shared Swift core

Extract `FmBridgeCore.swift` under `common/Sources/` with availability mapping, session creation, generate/stream/cancel/count. iOS and macOS wrappers delegate to it. Reduces drift between platforms.

### 3. Streaming via Tauri events

Mirror Android genai pattern:

- Events: `apple-fm://text`, `apple-fm://complete`, `apple-fm://error`
- Rust macOS bridge emits via `AppHandle::emit`; iOS Swift emits via Tauri plugin channel
- TS `appleFmGenerateStream` listens before invoking `apple_fm_generate_stream`

### 4. Cancellation with Task handles

Store `[requestId: Task]` in bridge. `cancel` calls `task.cancel()`. Ignore late callbacks when cancelled.

### 5. Structured generation

Swift `@Generable` structs mirror wire DTOs for `smartTagging`, `learningMaterialProposal`, `libraryAnswer`, `generatedFlashcards`. TS validators remain authoritative; unknown schemas fall back to text + strict JSON.

### 6. Build integration

`build.rs` on macOS:

- Compile Swift static lib via `swift build` (macos/Package.swift)
- Weak-link `-weak_framework FoundationModels`
- `cargo:rustc-link-search` + `cargo:rustc-link-lib=static=...`

Non-macOS builds skip Swift entirely.

### 7. Availability mapping

| Native | status | reason |
|---|---|---|
| `.available` | available | — |
| `.unavailable(.modelNotReady)` | downloading | model_not_ready |
| `.unavailable(.deviceNotEligible)` | unavailable | device_not_eligible |
| `.unavailable(.appleIntelligenceNotEnabled)` | unavailable | apple_intelligence_disabled |
| OS < 26 / no framework | unavailable | unsupported_os |
| non-Apple | unavailable | platform_unsupported |

Use `#available(macOS 26.0, iOS 26.0, *)` at runtime; never SKU checks.

### 8. Privacy

`SystemLanguageModel.default` with on-device session only. Catch PCC-related errors → `pcc_required`, never generate. `allowCloudFallback` unchanged in `runTask`.

## Risks / Trade-offs

- **[Risk] Swift/Rust ABI string ownership** → Use caller-owned buffers for requests; bridge copies out results with paired `plethora_fm_free_string`.
- **[Risk] Concurrent requests** → Single-flight queue (D-Apple-14) with serialized native session access.
- **[Risk] Older macOS strong-link crash** → Weak framework + runtime `#available` checks.
- **[Risk] Structured schema drift** → TS validation fail-closed; Swift types are wire mirrors only.

## Migration Plan

1. Land macOS bridge + Rust routing behind existing commands (no TS API change).
2. Fix iOS bridge in same PR for parity.
3. Enable streaming in TS provider once events verified.
4. Physical Mac smoke test via settings refresh + optional diagnostic command.

Rollback: revert plugin crate; TS falls back to cloud per existing routing.

## Open Questions

- None blocking — SDK verified on macOS 26.5.
