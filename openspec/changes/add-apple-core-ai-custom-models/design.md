## Context

Plethora’s study AI is capability-oriented (`AIProvider` in `src/lib/ai/providers/types.ts`). Android already exposes `ondevice-gemini-nano`. Change A adds a multi-backend on-device registry and crate `plethora-apple-intelligence`. Change B (Phase 2) wraps `SystemLanguageModel` / `LanguageModelSession` as `ondevice-apple-foundation` for Apple Intelligence hardware. This change (H, **Phase 4**) adds **custom Core AI models** on iOS/macOS **27**.

Apple’s Core AI stack (as bounded in `openspec/planning/ios-on-device-ai-openspecs.md`):

| Item | Constraint |
|---|---|
| OS | iOS/iPadOS/macOS 27.0+ |
| Apple Intelligence | **Not required** |
| Package | `.aimodel` (Apple Core AI model package) |
| Runtime type | `CoreAILanguageModel` (name as shipped in the iOS 27 SDK; adapter maps whatever the SDK calls the loadable model object) |
| Session | Same *shape* as Foundation Models’ `LanguageModelSession`: instructions, prompt/response, streaming, cancellation |
| Offline | Yes **after** the package is installed on disk |
| Simulator / CI | Treat as unavailable; fake everything |

The app **must not** raise `IPHONEOS_DEPLOYMENT_TARGET` above 14.0. Core AI is `@available` + runtime OS checks + a feature flag defaulting off.

Conversion of Hugging Face / GGUF / other weights into `.aimodel` is **not** performed in the Tauri app. Plethora’s ops/CI pipeline produces signed packages and a catalog. The client is a verifier + installer + inference adapter.

Constraints:

- D-Apple-1: no parallel `summarize()` stack; tasks keep `runTask`.
- D-Apple-2: one plugin crate; this change owns only `CoreAIBridge` (+ optional protocol file with no Core AI import).
- D-Apple-3: provider id `ondevice-apple-coreai`.
- D-Apple-4: On-device panel, not the OpenRouter list.
- D-Apple-5: on-device badge when `kind === "ondevice"`; no content in telemetry.
- D-Apple-14: share the plugin’s single heavy-inference queue with FM/Speech/Vision; do not start a second TS job framework.
- D-Apple-13: map native failures into existing `AIError` categories (`UnsupportedDevice`, `FeatureDisabled`, `ModelDownloading`, `PermissionDenied` if any, plus disk/checksum as typed availability reasons — do not invent a second error module).

## Goals / Non-Goals

**Goals:**

- Downloadable, Plethora-managed local models for users **without** Apple Intelligence hardware (once they are on iOS/macOS 27).
- Specialized models (e.g. smaller/faster flashcard extraction, non-English-tuned) distinct from system FM.
- Fully local inference after install (no Private Cloud Compute, no silent cloud).
- Concrete packaging, distribution, size, download, disk, checksum, versioning, hardware, memory, iOS background-install limits, deletion, updates, and license UX.
- Shared session abstraction with B **without** requiring B to compile or ship Core AI.
- Flag `appleCoreAI` default false; conditional compilation; min iOS 14 preserved.
- Testable with fakes in CI.

**Non-Goals:**

- Implementing this in the same phase/PR as Foundation Models (B).
- In-app model conversion, quantization, or compiling `.mlpackage` / `.aimodel` on device.
- Arbitrary user-supplied Hugging Face repos as Core AI runtimes (catalog allowlist only in v1).
- Raising min iOS, or linking Core AI on Android/Windows/Linux.
- Core AI embeddings, vision, or tool calling in v1 (capabilities report false unless a future catalog `capabilities` bit is added in a later change).
- Using Core AI as a Spotlight/Speech backend.
- Private Cloud Compute.
- Bundling multi-GB weights inside the App Store IPA.

## Decisions

### 1. Provider and routing

`AppleCoreAIProvider` implements `AIProvider`:

- `id = "ondevice-apple-coreai"`
- `kind = "ondevice"`
- `getCapabilities()` maps native `apple_coreai_status` + active catalog entry.
- `generateStream` / `cancel` / optional `countTokens` / `warmUp` call `apple_coreai_*`.

`textGeneration` is true only when **all** of: `features.appleCoreAI === true`, OS ≥ 27, Core AI framework present, an **active** installed model verifies, and native status is ready (not downloading, not memory-denied).

Routing (owned by A; this change consumes it): when `preferOnDevice !== false`, live on-device providers are listed first. If both FM and Core AI are live, **FM stays first** (system model is the default private path). User can pin Core AI as preferred on-device backend in the panel (`settings.ai.preferredOnDeviceProviderId = "ondevice-apple-coreai"`). If the pin is unset, Core AI is eligible as a fallback on-device backend when FM is not live (the main value: non-AI hardware). Never override `preferOnDevice === false`. Never treat Core AI as cloud.

*Alternative rejected:* replacing FM whenever a custom model is installed. Users with Apple Intelligence should keep the system model unless they opt into a specialized package.

### 2. LanguageModelSession-shaped adapter (shared with B, owned carefully)

TypeScript (`src/lib/ai/apple/languageSession.ts`), introduced here if B has not already:

```ts
export interface LanguageModelSessionHandle {
  sessionId: string;
  providerId: "ondevice-apple-foundation" | "ondevice-apple-coreai";
  modelId: string;
  modelVersion: string;
}

export interface LanguageModelTurnRequest {
  sessionId?: string;
  instructions?: string; // static prefix; maps to AIRequest.systemInstruction
  input: string;         // AIRequest.text (already contains <untrusted_source> wrappers)
  temperature?: number;
  maxOutputTokens?: number;
  stream: boolean;
  requestId: string;
}

export interface LanguageModelTurnResult {
  requestId: string;
  text: string;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number; contextTokens?: number };
}
```

Swift protocol `PlethoraLanguageSession` lives in `PlethoraLanguageSession.swift` with **no** `import CoreAI` and **no** `import FoundationModels`. `CoreAIBridge` conforms under `@available(iOS 27.0, *)`. B’s `FoundationModelsBridge` may conform later. React never calls Core AI or FM types; only `AIProvider`.

Mapping: `AIRequest.systemInstruction` → session instructions (trusted policy only — never concatenate library documents). `AIRequest.text` → user/turn input. Structured output: v1 `structuredGeneration: false`; tasks use existing TS parsers.

*Alternative rejected:* making H import B’s `FoundationModelsBridge` session class. That couples Phase 4 to Phase 2 binaries and breaks “B must not ship Core AI.”

### 3. Packaging contract (`.aimodel`)

Plethora does not invent a second archive format. Catalog entries point at Apple `.aimodel` packages (zip-like bundles as defined by the iOS 27 SDK). Each **distribution artifact** is:

1. `package.aimodel` — opaque Apple package (may be compressed for transport as `.aimodel` or `.aimodel.zip`; catalog states `encoding`).
2. Sidecar digest: SHA-256 of the exact bytes downloaded.
3. Catalog row (signed) binding `modelId`, `version`, `minOs`, `sha256`, `byteSize`, `installSizeBytes`, `license`, `capabilities`.

On disk after commit (app-private, not Files-visible):

```text
<Application Support>/Plethora/CoreAIModels/<modelId>/<version>/
  package.aimodel
  manifest.json    # copy of catalog row + install timestamp + acceptedLicenseId
  sha256
```

Staging:

```text
<Application Support>/Plethora/CoreAIModels/.staging/<downloadId>/
```

Never store models in `tmp`, Caches (purgable), or iCloud-backed Documents. Exclude from backup via `NSURLIsExcludedFromBackupKey` (models are re-downloadable derived data). Do **not** sync `.aimodel` via Yjs or the user’s library sync.

### 4. Conversion is out of app

A documented ops pipeline (repo `docs/` or internal runbook, not user-facing UI) converts approved source weights → Apple’s Core AI conversion tools → `.aimodel` → hash → catalog sign.

The iOS app **rejects** any file that is not a catalog artifact (no “import GGUF”, no “convert this safetensors”). Hugging Face URLs in v1 appear only as **attribution** on a catalog card, never as a live fetch target unless the catalog’s `url` is a Plethora CDN that happens to mirror.

If Apple’s converter or format changes between 27.0 and 27.x, bump `packageFormat` in the catalog and refuse installs with a mismatched `packageFormat`.

*Alternative rejected:* on-device conversion. It needs huge scratch disk, developer tools, and would still fail App Review if it downloaded arbitrary weights.

### 5. Distribution and catalog

Single signed catalog document, fetched over HTTPS from a Plethora-controlled URL baked as a default with optional `settings.ai.coreAiCatalogUrl` **only in debug builds**. Release builds pin URL + catalog signing public key.

Catalog (conceptual):

```ts
interface CoreAICatalog {
  catalogVersion: number;
  issuedAt: string; // ISO-8601
  models: CoreAICatalogEntry[];
}

interface CoreAICatalogEntry {
  modelId: string;           // stable, e.g. "plethora-study-fast-q5"
  displayName: string;
  version: string;           // semver
  packageFormat: "aimodel-27";
  url: string;               // https, Plethora CDN
  sha256: string;            // lowercase hex
  byteSize: number;          // download bytes
  installSizeBytes: number;  // uncompressed / expanded on disk
  minOs: { ios: string; macos: string }; // "27.0"
  ramRecommendedMb: number;
  license: {
    spdx: string;
    name: string;
    url: string;
    redistribution: "plethora-hosted" | "forbidden-in-client";
    requiresAcceptance: true;
  };
  capabilities: {
    textGeneration: true;
    streaming: boolean;
    systemInstructions: boolean;
    contextTokens: number;
  };
  specializedFor?: string[]; // e.g. ["flashcards", "summarize"]
  notes?: string;            // size/quality copy
}
```

Catalog signature: Ed25519 (or Apple-recommended CMS) over canonical JSON. Status command verifies before exposing entries. Failed verify → empty catalog + `FeatureDisabled` / typed `catalog_invalid` reason; **no** download.

Refresh: on panel open and at most once per 12h while flag is on. Never on every keystroke.

### 6. Size, disk, and memory gates

Before enqueueing a download:

1. `byteSize` and `installSizeBytes` shown in UI (binary MB/GB).
2. Query volume `availableCapacityForImportantUsage` (or equivalent). Require `free >= installSizeBytes + byteSize (if zip stays until extract) + 512MiB` safety margin, or `1.15 × installSizeBytes + 512MiB` if the download is the final package.
3. If fail: `downloadState: "unavailable"`, reason `insufficient_disk`. Do not start.
4. Warn (not hard-block) when `installSizeBytes > 1_500_000_000` on iPhone idiom; hard-block when remaining capacity after install would be `< 1_000_000_000` unless the user confirms a “low disk” override (still cannot bypass the 512MiB safety margin).
5. Memory: native reports `memoryClass` / recommended RAM. If `ramRecommendedMb` exceeds a conservative device budget (runtime, not SKU list), mark `unavailable` reason `insufficient_memory` and do not load the session. Never hard-code “iPhone 12” lists.
6. At most **one** installed model is **active**. Other versions/models may remain on disk until the user deletes them, but status warns if total Core AI disk use exceeds 4GiB on iPhone / 16GiB on Mac (soft warning + delete affordance).

Inference load: `CoreAILanguageModel` load happens on warm-up or first generate, not at app launch. Failure to allocate → `unavailable` for `textGeneration` until retry; do not crash.

### 7. Download, checksum, background limits (iOS)

User-initiated install only. Checking status never starts a download (same as Nano).

Transport: `URLSession` with **background configuration** so transfers can continue briefly after the user leaves the app. This is **not** `BGProcessingTask` (seconds) and not a blocking `URLSession` default in the UI process without a session identifier.

Rules:

- **Foreground start required.** Background cannot *originate* a new model download; it may only continue an in-flight one.
- **Wi-Fi default** when `byteSize > 200_000_000`. Cellular requires an explicit “Download over cellular” confirmation. Honor Low Data Mode as cellular-restricted.
- **Discretionary = false** for user-started downloads so iOS does not defer indefinitely; still expect OS throttling.
- **Resume:** persist `downloadId`, expected `sha256`, bytes received, ETag. On relaunch, reconnect the background session. If the server cannot resume, restart and replace staging.
- **Progress events** `apple-coreai://download` keyed by `downloadId` (percent, bytes). `downloading` is not TTL-cached as “ready.”
- **Checksum:** after file complete, hash staging bytes. Mismatch → delete staging, reason `checksum_mismatch`, never commit.
- **Cancel:** deletes staging; `downloadState` returns to `downloadable`.
- **App killed mid-download:** staging kept; panel shows resumable `downloading`/`downloadable` based on session recovery; never expose a half-written package as installed.
- **Background time:** if iOS expires the task, persist progress and surface “Download paused. Return to Plethora to continue.” Do not silently fail over to cloud.
- **iOS size practicality:** catalog should prefer ≤ ~1.5–3GB packages for phone; Mac may list larger. The client still enforces disk/memory gates rather than a hardcoded max, except a **hard cap** `byteSize <= 8GiB` to prevent catastrophic catalog errors.

Commit is atomic: hash OK → move staging → write `manifest.json` → fsync → set active if this is the first model or the user asked to switch → invalidate capability cache.

### 8. Versioning, updates, deletion

- Identity is `(modelId, version)`. `modelId` never reused for a different lineage.
- Update available when catalog has same `modelId` and a higher semver, or same version with **different** `sha256` (treat as yank+replace: do not auto-install; show “Broken catalog hash for installed version” if installed sha matches old).
- Updates download to staging **next to** the live version. Switch active pointer only after verify. Keep previous version until the new one successfully answers a native `warmup` **or** the user deletes it. Cap: keep at most one previous version per `modelId`.
- Do not overwrite `package.aimodel` in place while a session is live. Drain/cancel the plugin inference queue first.
- Deletion: user confirmation; cancel any download; unload session; remove directory; if it was active, activate another installed model or none. Reset/logout calls the same delete-all.
- Failed update leaves the old version active.

### 9. Licenses

- Every catalog entry has `requiresAcceptance: true` in v1.
- UI shows SPDX, name, link (in-app Safari/WKWebView), redistribution notice.
- Download button disabled until the user accepts. Persist `{ modelId, version, spdx, acceptedAt }` in local SQLite (not synced).
- New version with different `spdx` or license URL requires re-acceptance.
- Diagnostics may record `licenseAccepted: true` and `spdx`, never the license text body.
- If a license forbids binary redistribution, the model must not appear in the production catalog (`redistribution: "forbidden-in-client"`).

### 10. Hardware and OS capability detection

Never SKU allowlists. Native `apple_coreai_status` returns:

- `osSupported: boolean` (runtime iOS/macOS ≥ 27)
- `frameworkPresent: boolean` (weak-link / `canImport` result at runtime)
- `reason`: `flag_off` | `unsupported_os` | `platform_unsupported` | `framework_missing` | `no_model` | `insufficient_disk` | `insufficient_memory` | `checksum_mismatch` | `catalog_invalid` | `downloadable` | `downloading` | `ready` | …
- `activeModel?: { modelId, version, contextTokens, sha256 }`

`platformCapabilities.ts` id `on_device_ai_apple_coreai` is true only when status is `ready` (or `downloadable` for UI that should show install). Other platforms: `platform_unsupported` without invoking Apple frameworks.

Simulator: typically `framework_missing` or `unsupported`; tests inject fakes.

### 11. Conditional compilation and min iOS 14

- Deployment target remains 14.0 in `project.yml` / `pbxproj`. This change’s CI check: grep that the value is still `14.0`.
- `CoreAIBridge.swift` compiled with `@available(iOS 27.0, macOS 27.0, *)`. Use `#if compiler` / Xcode 27 SDK availability. If the plugin must build on Xcode 26 CI: wrap Core AI imports in `#if canImport(CoreAI)` and provide a stub type so the file still typechecks; commands return `unsupported_os`.
- Rust `lib.rs` always registers `apple_coreai_*`; on non-iOS `cfg` they return `platform_unsupported`.
- No `CoreAI` linker flag on Android/desktop Linux/Windows.
- Feature flag `settings.features.appleCoreAI: false` by default. Flag off ⇒ TypeScript provider still exists but `getCapabilities().textGeneration === false` and `downloadState` is `unavailable` reason `flag_off` (or `not-applicable` on non-Apple). Native must not load models when the flag is off even if files exist.

### 12. Concurrency, privacy, errors

- Plugin: Core AI generation counts as the single “heavy FM-or-equivalent” slot (D-Apple-14). Queue behind FM/Speech/Vision; cancel uses `requestId`.
- Untrusted library text stays in `AIRequest.text` with existing containment. Do not put it in Swift `Instructions`.
- No PCC. No network during `generateStream` except optional catalog refresh (not during the turn).
- Map: cancelled → existing cancelled-never-fallback; checksum/disk → no cloud fallback unless `allowCloudFallback` and the error is a generation failure (install errors are not generation failures).
- Provenance: `provider = "ondevice-apple-coreai"`, `model = "<modelId>@<version>"`.

### 13. Testing strategy

| Layer | Approach |
|---|---|
| Catalog parse/verify | Rust/TS tests with signed/unsigned fixtures |
| Disk budget math | Pure functions + fake volume stats |
| Download state machine | Fake `URLSession` / event emitter: progress, cancel, checksum fail, resume |
| Provider routing | `FakeCoreAIProvider` implementing `AIProvider` |
| Session adapter | Fake `PlethoraLanguageSession` |
| Swift | Unavailable in CI; optional `#if DEBUG` harness documented for device |
| Compile gate | Desktop `cargo check` + iOS compile with deployment 14; Core AI file stubs on old SDK |

CI **must not** download catalog CDN, **must not** instantiate `CoreAILanguageModel`.

*Alternative rejected:* Playwright as Core AI proof. It cannot load `.aimodel`.

## Migration

Phase 4 after A. If B already added `languageSession.ts`, extend it rather than fork. Flag remains off through the first TestFlight; enable per-device for dogfood.

Rollback: set `appleCoreAI` false; optionally delete installed models from the panel. Binary rollback does not require uninstalling packages first (they sit inert).

## Open questions (genuine)

1. Final Apple SDK type names (`CoreAILanguageModel` vs shipping name) — adapter isolates this; update the Swift file when the SDK is public, not the `AIProvider` id.
2. Whether App Review requires an additional purpose-string or “on-device AI” nutrition label beyond existing privacy copy — follow `complete-ios-apple-privacy-compliance`; this change adds catalog/license UI copy only.
3. Exact catalog signing algorithm if legal prefers Apple CMS over Ed25519 — verification is behind `verifyCatalog(bytes)`; tests use a fake verifier.

Everything else in Decisions is binding.
