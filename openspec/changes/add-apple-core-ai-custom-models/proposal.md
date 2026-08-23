## Why

Apple Intelligence Foundation Models (`SystemLanguageModel`) only run on eligible hardware with Apple Intelligence enabled. Many Plethora users on iOS 14–26, and on iOS 27 devices that are not Apple Intelligence eligible, still have no fully local generation path. Core AI on iOS/macOS 27 lets the app install **Plethora-managed custom `.aimodel` packages** and run them through `CoreAILanguageModel` without Apple Intelligence.

This is the only on-device generation backend that can (a) reach devices FM cannot, (b) ship specialized study models smaller or more capable than the system ~3B FM, and (c) keep inference fully local after install. It must plug into the **same** `AIProvider` + `LanguageModelSession`-shaped session adapter as proposal B so `runTask` / `resolveAiPath` never grow a Core AI island — but it **must not** be implemented in the same phase as Foundation Models (Phase 2 vs Phase 4).

Conversion of third-party weights into `.aimodel` is an **out-of-app** ops pipeline. The client only downloads signed catalog artifacts, verifies them, and runs Core AI.

## What Changes

- Add `AppleCoreAIProvider` with id **`ondevice-apple-coreai`**, `kind: "ondevice"`, implementing `AIProvider` from `src/lib/ai/providers/types.ts`.
- Wrap `CoreAILanguageModel` in the shared **LanguageModelSession-shaped** adapter used by Foundation Models (instructions, respond/stream, cancel, token/context metadata). Define that adapter in TypeScript (and a Swift protocol in `CoreAIBridge`) even if B has not shipped; B later conforms — H does not wait on B’s Swift, and B must not take a compile dependency on Core AI.
- Ship `CoreAIBridge.swift` inside crate `plethora-apple-intelligence` (reserved by change A), compile-gated for iOS/macOS **27** and weak-linked. Deployment target stays **iOS 14.0**.
- Add feature flag **`settings.features.appleCoreAI`**, default **`false`**. The provider is absent from routing unless the flag is on, OS ≥ 27, Core AI runtime is present, and a catalog model is installed and ready.
- Add a **signed model catalog**, download/resume, SHA-256 checksum, disk-budget, versioning, atomic install, deletion, update, and license-acceptance flow for Plethora-managed models only.
- Expose download lifecycle through existing `AIModelCapabilities.downloadState` (`downloadable` / `downloading` / `downloaded` / `unavailable`).
- Extend On-device intelligence panel (A/B) with a Core AI row: catalog, size, license, progress, delete, update — never as a cloud provider list item.
- Tests use **fakes only**. CI never links Core AI, never downloads real `.aimodel` bytes, never requires iOS 27 hardware.

## Capabilities

### New Capabilities

- `apple-core-ai`: Plethora-managed Core AI custom models — catalog, packaging contract, conversion-out-of-app, distribution, size/disk/memory/hardware gates, checksummed download, background-install limits, versioning, updates, deletion, licenses, `ondevice-apple-coreai` provider, conditional compilation, `appleCoreAI` flag.

### Modified Capabilities

- `apple-ai-capability-routing`: `getRoutingProviders()` may include `ondevice-apple-coreai` after Nano/FM live text-generation providers when the flag is on and a model is ready. Order remains: live platform on-device providers, then cloud. Core AI does not replace FM when both are ready unless the user pins Core AI in the panel.
- `ai-task-architecture`: tasks keep calling `AIProvider.generateStream`. No Core-AI-specific task definitions.

## Impact

- **Hard dependency:** `extend-ai-capability-routing-for-apple` (plugin crate, multi-provider registry, error categories, fakes, capability IDs).
- **Soft dependency:** `add-apple-foundation-models-provider` for a shared session abstraction **shape**. This change specifies that shape and implements the Core AI side. B is **not** required to land Core AI types, and this change **must not** be scheduled in the same implementation phase as B.
- **Native:** `src-tauri/plugins/plethora-apple-intelligence/` — new `CoreAIBridge.swift` only (plus reserved `apple_coreai_*` commands in `lib.rs` if A left stubs). Non-Apple OS: `platform_unsupported`.
- **Frontend:** `src/lib/ai/providers/appleCoreAIProvider.ts`, `src/lib/ai/apple/languageSession.ts` (shared session types), `src/lib/ai/apple/coreAI.ts` (catalog/download SDK), settings flag, On-device panel section, `platformCapabilities.ts` id `on_device_ai_apple_coreai`.
- **Ops (out of app):** conversion/signing pipeline producing `.aimodel` + catalog JSON; not a Tauri command in the client.
- **Testing:** Vitest + Rust unit tests with catalog/download/session fakes; no Core AI in CI.
- **Min OS:** app remains `IPHONEOS_DEPLOYMENT_TARGET = 14.0`. All Core AI types are `@available(iOS 27.0, macOS 27.0, *)` plus runtime checks.

## Owns

`CoreAIBridge.swift`, Core AI TypeScript SDK/provider, catalog/download/disk/license types, `appleCoreAI` flag, Core AI panel section, Core AI fakes, `apple_coreai_*` command implementations.

## Must NOT change

- Foundation Models Swift (`FoundationModelsBridge`) except optionally conforming to a **shared session protocol** that this change may introduce in a neutral file (`PlethoraLanguageSession.swift`) with no Core AI import.
- Android `plethora-android-genai` / Nano provider id `ondevice-gemini-nano`.
- Task prompt strings, schema validators, Ask Library retrieval, Help RAG.
- Speech / Vision / Spotlight / NL modules.
- Cloud provider picker UX.
- iOS deployment target (must stay 14.0).
- Embedding pipelines (Core AI in v1 is generation-only unless a catalog model explicitly advertises embeddings — v1 **does not**).

## Dependencies

| Kind | Change |
|---|---|
| Hard | `extend-ai-capability-routing-for-apple` |
| Soft | `add-apple-foundation-models-provider` (session shape only; not a merge gate) |
| Ops | Signed catalog hosting + conversion pipeline (out of app) |

## Parallelization Notes

**Phase 4 only.** Do not land in the same PR/phase as B. Coordinate with A on reserved commands:

- `apple_coreai_status`
- `apple_coreai_catalog`
- `apple_coreai_download_start` / `apple_coreai_download_cancel` / `apple_coreai_download_progress` (events)
- `apple_coreai_install_commit` / `apple_coreai_delete` / `apple_coreai_set_active`
- `apple_coreai_session_start` / `apple_coreai_prompt` / `apple_coreai_cancel`
- `apple_coreai_count_tokens` / `apple_coreai_warmup`

## Migration / Backward Compatibility

- Flag default false: no user-visible Core AI until explicitly enabled on iOS/macOS 27+ after QA.
- Devices below iOS/macOS 27: status `unavailable` / `unsupported_os`; no download UI beyond an OS-requirement note.
- FM users: Core AI is an additional on-device backend, not a replacement. Existing `preferOnDevice` / `allowCloudFallback` unchanged.
- Logout/reset: delete installed `.aimodel` files from app-private storage (same class as other derived caches), not user documents.

## Risks

- iOS background download eviction and cellular cost for multi-GB models.
- Disk fill / Jetsam during load of an oversized model.
- Unsigned or swapped catalog artifacts (mitigate: pinned signing key + SHA-256).
- Compiling Core AI symbols on Xcode < 27 or with deployment target 14 (mitigate: availability + file-level compile flags).
- Merge conflict with B on session types — keep Core AI types in `apple/languageSession.ts` and `CoreAIBridge.swift` so B can adopt without this change importing FM frameworks.
