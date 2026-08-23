## Context

`src/lib/ai/` already implements design D1–D9 of `add-ondevice-ai-learning-system`: `AIProvider`, live `AIModelCapabilities`, `runTask`, model-class routing, structured validation, `AIError`, containment, diagnostics, and `runAiAction` cloud fallback with billing/privacy gates.

The on-device path is still a **single** adapter:

- `OnDeviceProvider` wraps `onDeviceAI.ts` which invokes `plugin:plethora-android-genai`.
- `isOnDeviceAiSupportedPlatform()` requires `nativePlatform() === "android"`.
- `getRoutingProviders()` returns `[onDevice, cloud]` or the reverse — one of each.
- Comments and `OnDeviceAiPanel` treat on-device as Gemini Nano.

Apple’s APIs (iOS/macOS 26 Foundation Models, SpeechAnalyzer, Vision `RecognizeDocumentsRequest`, Core Spotlight, `NLContextualEmbedding`, iOS 27 Core AI) must attach to this layer. Follow-on OpenSpecs implement those engines. This change only makes attachment possible without an Apple-specific island in React.

Constraints:

- iOS deployment target remains **14.0**.
- Android Nano, cloud/OpenRouter/Ollama, and desktop local models must keep working.
- Cloud transmission stays explicit (`allowCloudFallback` default false, `ensureCloudAiDisclosure`).
- CI has no Apple Intelligence devices.

## Goals / Non-Goals

**Goals:**

- Multiple on-device providers selectable by live capabilities.
- Stable plugin crate and command namespace for later Swift work.
- Extended error taxonomy and fake providers for deterministic tests.
- Settings semantics: Auto (prefer private on-device) vs user-disabled on-device vs configured cloud.
- Platform capability IDs so UI hides Apple-only actions on Android/desktop.
- Clear file ownership for the implementation fleet.

**Non-Goals:**

- Any real Foundation Models / Speech / Vision / Spotlight / NL / Core AI inference.
- Private Cloud Compute.
- Replacing `AITask` with a new capability RPC used directly from components.
- Redesigning LLM provider CRUD (`LLMProviderSettings`).
- Raising min iOS or requiring Apple Intelligence for app launch.

## Decisions

### 1. Keep `AIProvider` + `runTask`; add providers, don’t add a second façade

Follow-on features continue to call `runTask` / `runAiAction` / `askLibrary`. Apple generation is `AppleFoundationProvider implements AIProvider` (change B). Speech/Vision are **not** `AIProvider` methods; they are domain pipelines that may later call tasks for enrichment.

*Rejected:* a new `appleAI.generateFlashcards()` parallel API used from React. That recreates the pre-task-layer adapter sprawl.

### 2. Provider registry becomes a list

`getRoutingProviders()` gathers:

```ts
function getRoutingProviders(): AIProvider[] {
  const onDevice = [
    getOnDeviceProvider(),          // Nano; capabilities false off Android
    getAppleFoundationProvider(),   // stub in this change; real in B
    getAppleCoreAiProvider(),       // stub; real in H, flag off
  ].filter(Boolean);
  const cloud = getCloudProvider();
  return prefersOnDevice()
    ? [...onDevice, cloud]
    : [cloud, ...onDevice];
}
```

`resolveTaskRoute` already iterates candidates for `textGeneration`. Update it so a provider with `textGeneration: false` is skipped (today a missing snapshot is treated as usable — fix that off-by-null).

`resolveAiPath("prompt")` becomes: if prefer on-device and any on-device provider reports the requirement available → `"ondevice"`; else cloud if configured; else `"none"`. Requirement mapping stays (`prompt` / `summarization` / `image-prompt`); Apple FM maps prompt+summarization to `textGeneration`, image to `vision` when B advertises it.

*Rejected:* encoding Apple as `LLMProviderType.Apple` in the cloud provider store. That store models API keys and OpenRouter-style hosts.

### 3. Settings semantics (Auto / Apple / cloud)

| User state | Behavior |
|---|---|
| `preferOnDevice !== false` (default) | Use first **live** on-device provider that satisfies the task; else configured cloud/local LLM; else hide AI actions |
| `preferOnDevice === false` | Use configured LLM/cloud/Ollama; do not auto-pick Apple/Nano even if available |
| `allowCloudFallback !== true` (default) | On-device failure does not send content to paid cloud |
| No cloud provider, Apple/Nano available, prefer on-device | Feature works offline — the new-user iPhone path once B ships |

The panel shows **status**, not a third radio that fights `preferOnDevice`. Copy: “Prefer private on-device processing when this device can do it.”

Reserve optional `settings.ai.preferredOnDeviceProviderId` (`ondevice-gemini-nano` | `ondevice-apple-foundation` | `ondevice-apple-coreai`) for change H pinning; this change may add the field defaulting to unset (FM/Nano natural order).

If Apple status is not `.available`, the panel explains why **in the panel only**. No toast on launch.

*Rejected:* a new `settings.ai.provider = "apple"|"nano"|"openrouter"` enum that overrides the whole LLM store.

### 4. Split native SDKs; keep re-exports

| File | Role |
|---|---|
| `src/lib/ai/onDeviceAI.ts` | Android Nano only (existing) |
| `src/lib/ai/apple/plugin.ts` | invoke helper `plugin:plethora-apple-intelligence` |
| `src/lib/ai/apple/capabilities.ts` | `getAppleIntelligenceSnapshot()` — this change returns unsupported stubs |
| `src/lib/ai/providers/appleFoundationProvider.ts` | Stub `AIProvider` with `id: "ondevice-apple-foundation"`, all caps false |
| `src/lib/ai/providers/fakes.ts` | `FakeLanguageProvider`, `FakeSpeechProvider`, `FakeVisionProvider`, `FakeSemanticSearchProvider` |

`onDeviceAI.ts` keeps exporting current symbols so Nano tests need not churn wholesale.

### 5. Plugin skeleton `plethora-apple-intelligence`

Mirror `plethora-storekit` / `plethora-android-genai`:

- `Cargo.toml` `name = "plethora-apple-intelligence"`
- `tauri::plugin::Builder::<Wry>::new("plethora-apple-intelligence")`
- `#[cfg(target_os = "ios")]` / `macos` ios_plugin_binding; other OS: status commands return `{ reason: "platform_unsupported" }`
- iOS Swift `AppleIntelligencePlugin: Plugin` with `capabilities` command only in this change
- `permissions/default.toml` allowlisting reserved commands

**Reserved commands** (implementations may reject `not_implemented` until their change). Names are frozen so B–H do not invent parallel RPCs:

```
apple_capabilities
apple_fm_status, apple_fm_prompt, apple_fm_cancel, apple_fm_count_tokens
apple_speech_status, apple_speech_transcribe_file, apple_speech_live_start,
apple_speech_live_stop, apple_speech_cancel
apple_vision_status, apple_vision_recognize_document
apple_spotlight_status, apple_spotlight_donate, apple_spotlight_delete,
apple_spotlight_delete_domain, apple_spotlight_query, apple_spotlight_rebuild
apple_nl_status, apple_nl_request_assets, apple_nl_embed_texts
apple_coreai_status, apple_coreai_catalog, apple_coreai_download_start,
apple_coreai_download_cancel, apple_coreai_install_commit, apple_coreai_delete,
apple_coreai_set_active, apple_coreai_prompt, apple_coreai_cancel,
apple_coreai_count_tokens
```

A lands `apple_capabilities` only. Others exist as stubs so permissions/CI compile.

*Rejected:* one plugin per API (six crates). *Rejected:* stuffing Apple into `plethora-android-genai`.

### 6. Capability snapshot (union, not Nano-shaped only)

```ts
interface AppleIntelligenceSnapshot {
  osSupported: boolean;          // iOS/macOS 26+
  foundationModels: FeatureState; // available | downloadable | downloading | unavailable
  foundationReason?: "device_not_eligible" | "apple_intelligence_disabled" | "model_not_ready" | "unsupported_os" | "platform_unsupported";
  speech: FeatureState;
  visionDocuments: FeatureState;
  spotlightSemantic: FeatureState;
  naturalLanguageEmbeddings: FeatureState;
  coreAi: FeatureState;
  checkedAt: number;
}
```

Frontend caches TTL 10s like Nano; does not cache `downloading`.

### 7. Error taxonomy extension

Add to `AI_ERROR_CATEGORIES`:

- `PermissionDenied` — mic/camera/speech/photos
- `FeatureDisabled` — Apple Intelligence off, user disabled on-device, flag off
- `UnsupportedLanguage` — Speech/FM/Vision locale not supported

Map native string codes in `apple/errors.ts` → `AIError`. Keep `ON_DEVICE_CODE_TO_CATEGORY` for Nano.

### 8. Platform capability IDs

Add to `PLATFORM_CAPABILITY_IDS` (unavailable on android/web by default; desktop macOS runtime-gated in later changes via live snapshot, not a static false):

- `on_device_ai_apple_foundation`
- `apple_speech_transcription`
- `apple_vision_scan`
- `apple_spotlight_search`
- `apple_core_ai`

Static registry cannot know Apple Intelligence eligibility; IDs mean “surface exists on this OS family.” Fine-grained `.available` still comes from snapshots. On iOS, IDs are **available** so commands can appear then disable with explanation; on Android they are `unsupported_platform`.

### 9. Privacy indicator contract

`AITaskResult` already has `providerKind` + `providerId`. UI that shows generation results MAY render a single `OnDeviceProcessingBadge` when `providerKind === "ondevice"`. This change adds the component and uses it on the on-device panel status row only. Feature surfaces adopt it in B/D.

Diagnostics unchanged: no content.

### 10. Feature flags

Add `settings.features.appleFoundationModels` default **true** (runtime still gates), `appleSpotlightIndex` default true, `appleSpeechTranscription` default true, `appleVisionScan` default true, `appleNaturalLanguageEmbeddings` default true, `appleCoreAI` default **false**.

Flags hide surfaces without deleting native stubs.

### 11. Fake providers (testing)

`FakeLanguageProvider` implements `AIProvider` with scripted `generateStream` by `schemaName`, deterministic text, cancellable via AbortSignal. Unit tests for routing **must** inject `providerSource` (already on `resolveTaskRoute`) rather than calling plugins.

Speech/Vision/Search fakes are interfaces + in-memory implementations used by later specs; this change exports them so those specs do not invent a second fake shape.

### 12. macOS

The plugin compiles for macOS. This change’s snapshot on macOS < 26 is `unsupported_os`. Whether FM is QA’d on Mac in the same release is flag-controlled, not a separate architecture.

## Risks / Trade-offs

- **Stub providers in the routing list** — they must report `textGeneration: false` so they are skipped. Tests cover this.
- **Command stub explosion** — permissions file lists reserved commands; implementations reject with `not_implemented` mapped to `CapabilityUnavailable`.
- **Nano split regressions** — re-export barrel + existing `providers.test.ts` / `provider.test.ts` must stay green.
- **iOS 14 linking** — Swift must wrap iOS 26 types in `#available`; this change’s plugin class uses Foundation/Tauri only.

## Migration Plan

1. Add plugin crate stubs + register; desktop `cargo check` and iOS compile (existing 14 target) pass.
2. Split TS files; re-export; Nano tests green.
3. Registry + route skip of incapable providers; add fakes tests.
4. Errors + platform IDs + flags + panel shell on iOS showing “Apple on-device AI will appear when the Foundation Models provider ships” **or** a generic unavailable state from stub snapshot — do not promise features that B has not shipped. Prefer: panel shows Apple row with status `unavailable` / `unsupported_os` from stub.
5. Badge component + tests.
6. Update `docs` only if an existing on-device doc claims Android exclusivity.

## Open Questions

None. See `openspec/planning/ios-on-device-ai-openspecs.md` §6 for product-deferred PCC/macOS QA flags.
