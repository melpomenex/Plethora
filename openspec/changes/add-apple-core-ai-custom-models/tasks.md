## 1. Phase gate, flag, and compile constraints

- [x] 1.1 Confirm `extend-ai-capability-routing-for-apple` has landed (plugin crate `plethora-apple-intelligence`, reserved `apple_coreai_*` commands, multi-provider registry, fakes). Do **not** start if B (`add-apple-foundation-models-provider`) is still in the same implementation phase — wait until B is merged or explicitly parked
- [x] 1.2 Consume A’s `settings.features.appleCoreAI` (boolean, default `false`). Do not add a second flag or change the default.
- [x] 1.3 Consume A’s platform capability id `on_device_ai_apple_coreai` with OS-family meaning. Do not register `apple_core_ai` and do not treat the id as “model ready.”
- [x] 1.4 Assert `IPHONEOS_DEPLOYMENT_TARGET` remains `14.0` in `src-tauri/gen/apple/project.yml` and `project.pbxproj`; add a script test or CI grep so this change cannot raise it
- [x] 1.5 Implement `CoreAIBridge.swift` with `@available(iOS 27.0, macOS 27.0, *)` and `#if canImport(CoreAI)` (or SDK-equivalent) so Xcode 26 / iOS 14 target still compile via stubs
- [x] 1.6 Weak-link Core AI; non-Apple `cfg` Rust commands return `platform_unsupported` with no Apple framework linkage
- [x] 1.7 Add `PlethoraLanguageSession.swift` with **no** Core AI or Foundation Models imports; Core AI types live only in `CoreAIBridge.swift`

## 2. Catalog, packaging contract, and license records

- [x] 2.1 Define Rust + TypeScript DTOs for `CoreAICatalog` / `CoreAICatalogEntry` (modelId, version, packageFormat `aimodel-27`, url, sha256, byteSize, installSizeBytes, minOs, ramRecommendedMb, license, capabilities)
- [x] 2.2 Implement catalog signature verification behind `verifyCatalog`; production pins URL + public key; debug may override catalog URL
- [x] 2.3 Fetch catalog only when the flag is on and OS is Apple; TTL ≥ 12h except on explicit panel refresh; never fetch during `generateStream`
- [x] 2.4 Persist license acceptances `{ modelId, version, spdx, acceptedAt }` locally (unsynced); require acceptance before download
- [x] 2.5 Document the **out-of-app** conversion pipeline (source weights → Apple converter → `.aimodel` → hash → sign catalog) in `docs/` or the plugin README; no in-app convert command
- [x] 2.6 Reject non-catalog files and any `packageFormat` the client does not understand
- [x] 2.7 Add tests for valid catalog, tampered signature, unknown format, and license re-acceptance when SPDX changes

## 3. Disk, size, memory, and hardware gates

- [x] 3.1 Implement free-space check using important-usage capacity; require install size + remaining download + 512MiB margin before start
- [x] 3.2 Surface `insufficient_disk` without starting the transfer; show byteSize and installSizeBytes in the panel
- [x] 3.3 Warn when install size > 1.5GB on iPhone idiom; hard-block if post-install free space would drop below 1GB unless the user confirms low-disk override (margin still enforced)
- [x] 3.4 Enforce hard cap `byteSize <= 8GiB`
- [x] 3.5 Compare `ramRecommendedMb` to a runtime memory budget (not SKU lists); expose `insufficient_memory` and refuse session load
- [x] 3.6 Exclude installed models from backup (`NSURLIsExcludedFromBackupKey`); store under Application Support `Plethora/CoreAIModels/`; never tmp/Caches/Documents/iCloud
- [x] 3.7 Soft-warn when total Core AI disk exceeds 4GiB (iPhone) / 16GiB (Mac)
- [x] 3.8 Add unit tests with fake volume and memory stats for allow, deny, warn, and hard-cap paths

## 4. Download, checksum, background limits, atomic install

- [x] 4.1 Start downloads only from an explicit user action; status/capability reads never begin a download
- [x] 4.2 Use `URLSession` background configuration; persist `downloadId` for resume; do not use `BGProcessingTask` for bytes
- [x] 4.3 Default to Wi-Fi when `byteSize > 200MB`; require explicit cellular confirmation; honor Low Data Mode
- [x] 4.4 Emit progress events keyed by `downloadId`; map to `AIDownloadState` `downloading` (do not cache as ready)
- [x] 4.5 SHA-256 staging bytes against catalog; on mismatch delete staging and report `checksum_mismatch`
- [x] 4.6 Atomic commit: staging → `CoreAIModels/<modelId>/<version>/` + `manifest.json` + `sha256` file; never mark installed before verify
- [x] 4.7 Cancel deletes staging and returns state to `downloadable`
- [x] 4.8 On background expiry, persist progress and show “return to Plethora to continue”; never cloud-fallback a paused download
- [x] 4.9 Recover in-flight background sessions after process death without exposing partial packages as installed
- [x] 4.10 Add fake-session tests: progress, cancel, checksum fail, resume, cellular gate, disk fail before start

## 5. Versioning, updates, deletion, active model

- [x] 5.1 Treat identity as `(modelId, version)`; keep at most one previous version per modelId after a successful update
- [x] 5.2 Download updates to staging; switch active pointer only after checksum + native warmup success; leave old version active on failure
- [x] 5.3 Drain/cancel inference before replacing the active package
- [x] 5.4 Delete command: confirm UI, unload session, remove directory, pick another installed model or none
- [x] 5.5 Logout/reset deletes all Core AI model directories
- [x] 5.6 `apple_coreai_set_active` updates the active pointer used by the provider
- [x] 5.7 Tests: update success, update abort, delete last model, delete non-active, reset wipe

## 6. Session adapter and `AppleCoreAIProvider`

- [x] 6.1 Add `src/lib/ai/apple/languageSession.ts` types (`LanguageModelSessionHandle`, `LanguageModelTurnRequest/Result`) if B did not already; reuse B’s file if present
- [x] 6.2 Implement `CoreAIBridge` session: map instructions vs turn text; never put library documents into trusted instructions
- [x] 6.3 Implement `AppleCoreAIProvider` (`id: "ondevice-apple-coreai"`, `kind: "ondevice"`) wrapping `AIRequest` / `AIResponse` / `AIStreamOptions` / `cancel` / optional `countTokens` / `warmUp`
- [x] 6.4 `getCapabilities()`: `textGeneration` true only when flag on, OS ≥ 27, framework present, active model ready; `structuredGeneration`, `vision`, `embeddings`, `toolCalling`, `reasoning` false in v1; `offlineAvailable` true when ready; `downloadState` from native
- [x] 6.5 Stream via plugin events keyed by `requestId`; one heavy inference slot shared with FM/Speech/Vision
- [x] 6.6 Do not load `CoreAILanguageModel` at app launch; load on warmup or first generate
- [x] 6.7 Provenance: provider `ondevice-apple-coreai`, model `<modelId>@<version>`
- [x] 6.8 When `preferOnDevice` is true and FM is live, keep FM first unless `settings.ai.preferredOnDeviceProviderId === "ondevice-apple-coreai"`
- [x] 6.9 When FM is not live and Core AI is ready, Core AI participates as an on-device provider; `preferOnDevice === false` never auto-selects it
- [x] 6.10 Map native errors into existing `AIError` categories; cancelled never cloud-falls-back
- [x] 6.11 Feature flag off: do not load models even if files exist; capabilities report `flag_off`

## 7. Settings UI (On-device panel only)

- [x] 7.1 Add a Core AI section to the On-device intelligence panel (not the cloud provider list)
- [x] 7.2 Show OS requirement, flag-off state, catalog entries (name, version, sizes, license, specializedFor)
- [x] 7.3 Download / pause-message / cancel / delete / set-active / accept-license controls
- [x] 7.4 Hide or disable the section on non-Apple platforms; on Apple OS < 27 show unsupported OS copy without download buttons
- [x] 7.5 Copy: models are fully local after install; conversion is not performed on device

## 8. Fakes and CI tests

- [x] 8.1 Add `FakeCoreAIProvider` as an alias/subclass of A’s `FakeLanguageProvider` in `src/lib/ai/providers/fakes.ts` for routing/task tests
- [x] 8.2 Add fake catalog + fake download manager (no network)
- [x] 8.3 Vitest: flag off, unsupported OS, downloadable → downloading → downloaded, checksum failure, disk denial, FM-vs-Core-AI order, pin Core AI, preferOnDevice false, cancellation
- [x] 8.4 Rust tests: catalog verify, path layout, atomic commit, stub `platform_unsupported`
- [x] 8.5 Guarantee CI jobs do not link Core AI or fetch real `.aimodel` URLs (use fixtures)
- [x] 8.6 Manual TestFlight matrix (not CI): iOS 27 AI-ineligible device install+generate; iOS 27 AI-eligible device FM still default; iOS 18 compile/install of the app with flag off; disk-full and checksum-mismatch drills
