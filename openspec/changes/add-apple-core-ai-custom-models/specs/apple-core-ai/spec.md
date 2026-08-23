## ADDED Requirements

### Requirement: Core AI is a first-class on-device AIProvider
The system SHALL expose custom Apple Core AI models through `AIProvider` with id `ondevice-apple-coreai` and `kind` `"ondevice"`, using the same `AIRequest` / `AIResponse` / `AIModelCapabilities` contracts as other providers. Call sites SHALL continue to use `runTask` / `resolveAiPath` and SHALL NOT import Core AI or Foundation Models types from React.

#### Scenario: Provider identity
- **WHEN** `AppleCoreAIProvider` is constructed
- **THEN** `provider.id` is `ondevice-apple-coreai`
- **AND** `provider.kind` is `ondevice`

#### Scenario: Capabilities are detected live
- **WHEN** `getCapabilities()` runs
- **THEN** the snapshot is produced from native `apple_coreai_status` plus the active catalog entry
- **AND** values are not hard-coded from a device SKU list

#### Scenario: v1 generation-only matrix
- **WHEN** an active model is ready
- **THEN** `textGeneration` is true
- **AND** `structuredGeneration`, `vision`, `multiImage`, `toolCalling`, `reasoning`, and `embeddings` are false
- **AND** `offlineAvailable` is true
- **AND** `downloadState` is `downloaded`
- **AND** `contextTokens` equals the catalog entry’s `capabilities.contextTokens` when reported

#### Scenario: Tasks stay provider-neutral
- **WHEN** a study task runs while Core AI is the selected on-device backend
- **THEN** the task invokes `generateStream` on `AIProvider`
- **AND** no task definition branches on the string `CoreAI` or `aimodel`

### Requirement: Shared LanguageModelSession-shaped adapter
The system SHALL map Core AI inference through a LanguageModelSession-shaped adapter (TypeScript types plus a Swift protocol with no Core AI import) so Foundation Models (change B) can conform later without this change compiling Foundation Models, and without B compiling Core AI.

#### Scenario: Instructions vs untrusted turn text
- **WHEN** `AIRequest` includes `systemInstruction` and `text`
- **THEN** `systemInstruction` is applied as session instructions
- **AND** `text` (including `<untrusted_source>` blocks) is the turn input
- **AND** library/OCR/transcript content is not copied into trusted instructions

#### Scenario: Streaming and cancellation
- **WHEN** `generateStream` is called with `opts.stream !== false` and an `AbortSignal`
- **THEN** native streaming events are keyed by `requestId`
- **AND** abort invokes `apple_coreai_cancel` for that `requestId`
- **AND** late events after cancel are ignored

#### Scenario: B is not required to ship Core AI
- **WHEN** Foundation Models code is absent from the tree
- **THEN** Core AI still compiles against `PlethoraLanguageSession` / `languageSession.ts`
- **AND** `CoreAIBridge.swift` does not import Foundation Models symbols

#### Scenario: B does not take a Core AI compile dependency
- **WHEN** Foundation Models is built on Xcode without the Core AI SDK
- **THEN** Foundation Models sources do not `import` Core AI
- **AND** shared protocol files contain no Core AI types

### Requirement: Feature flag appleCoreAI defaults off
The system SHALL gate Core AI behind `settings.features.appleCoreAI`, defaulting to false, independent of `preferOnDevice`.

#### Scenario: Default settings
- **WHEN** a user has never set feature flags
- **THEN** `features.appleCoreAI` is false

#### Scenario: Flag off with files on disk
- **WHEN** `appleCoreAI` is false and a valid `.aimodel` is already installed
- **THEN** `textGeneration` is false
- **AND** `downloadState` is `unavailable` with reason `flag_off` (or `not-applicable` on non-Apple)
- **AND** the native runtime does not load `CoreAILanguageModel`

#### Scenario: Flag on but OS too old
- **WHEN** `appleCoreAI` is true and the OS is below iOS/macOS 27
- **THEN** `textGeneration` is false
- **AND** the reason is `unsupported_os`
- **AND** download of `.aimodel` is not offered

#### Scenario: Flag on, OS 27+, model ready
- **WHEN** `appleCoreAI` is true, OS ≥ 27, Core AI framework is present, and an active model is verified
- **THEN** `textGeneration` is true
- **AND** the provider may appear in `getRoutingProviders()` per routing rules

### Requirement: Must not raise minimum iOS version
The application SHALL keep `IPHONEOS_DEPLOYMENT_TARGET` at 14.0. Core AI APIs SHALL be availability-gated.

#### Scenario: Deployment target unchanged
- **WHEN** this change is applied
- **THEN** `src-tauri/gen/apple/project.yml` and `project.pbxproj` still set `IPHONEOS_DEPLOYMENT_TARGET` to `14.0`

#### Scenario: iOS 14 binary still links
- **WHEN** the iOS app is compiled with deployment target 14.0
- **THEN** Core AI symbols are weak / availability-gated
- **AND** launching on iOS 14–26 does not crash for missing Core AI classes

#### Scenario: Runtime check on iOS 18
- **WHEN** `apple_coreai_status` is invoked on iOS 18
- **THEN** the result is `unsupported_os` (or equivalent)
- **AND** no unguarded iOS 27 type is instantiated

### Requirement: Conditional compilation and non-Apple stubs
The system SHALL compile the plugin on every CI platform without requiring the Core AI SDK on non-Apple hosts.

#### Scenario: Desktop Linux CI
- **WHEN** `apple_coreai_status` runs on Linux, Windows, or a non-Apple macOS cfg that does not link the plugin’s iOS sources
- **THEN** the command returns `platform_unsupported`
- **AND** no Core AI framework is linked

#### Scenario: Missing Core AI module on Xcode 26
- **WHEN** the plugin is compiled with an SDK that cannot import Core AI
- **THEN** stub implementations still satisfy plugin commands
- **AND** they report framework missing / unsupported rather than failing the build

#### Scenario: Isolated Swift module
- **WHEN** Core AI types are used
- **THEN** they appear only in `CoreAIBridge.swift` (plus tests/fakes)
- **AND** StoreKit, folder-import, and Android genai plugins remain unchanged

### Requirement: Not implemented in the Foundation Models phase
Core AI SHALL be a later phase than Foundation Models and SHALL NOT share an implementation PR/phase with change B.

#### Scenario: Phase ownership
- **WHEN** implementers schedule work
- **THEN** Core AI tasks start only after change A has landed
- **AND** they are not mixed into the Foundation Models implementation phase

### Requirement: Routing relative to Foundation Models and Nano
The system SHALL treat Core AI as an additional on-device backend. System Foundation Models remain the default when live. Gemini Nano remains the Android provider.

#### Scenario: FM live, Core AI live, no user pin
- **WHEN** `preferOnDevice !== false` and both `ondevice-apple-foundation` and `ondevice-apple-coreai` report `textGeneration`
- **THEN** routing lists Foundation Models before Core AI

#### Scenario: User pins Core AI
- **WHEN** `settings.ai.preferredOnDeviceProviderId` is `ondevice-apple-coreai` and Core AI is live
- **THEN** Core AI is the preferred on-device generation provider
- **AND** cloud is still not used unless on-device fails and `allowCloudFallback` is true

#### Scenario: No Apple Intelligence hardware, Core AI ready
- **WHEN** Foundation Models availability is not `.available` and Core AI is ready and `preferOnDevice !== false`
- **THEN** Core AI is eligible as the on-device generation provider

#### Scenario: User disabled on-device
- **WHEN** `preferOnDevice === false`
- **THEN** Core AI is not auto-selected
- **AND** it may still appear in the On-device panel

#### Scenario: Android
- **WHEN** the platform is Android
- **THEN** `ondevice-gemini-nano` is unchanged
- **AND** Core AI reports `platform_unsupported`

### Requirement: Packaging uses Apple .aimodel only
The system SHALL install only catalog-listed Apple `.aimodel` packages. Conversion of third-party weights SHALL happen outside the app.

#### Scenario: Catalog package format
- **WHEN** a catalog entry has `packageFormat` `aimodel-27`
- **THEN** the client will download and store it as `package.aimodel` under Application Support

#### Scenario: Unknown package format
- **WHEN** a catalog entry’s `packageFormat` is not recognized
- **THEN** the entry is not downloadable
- **AND** the reason is a typed unsupported-format code

#### Scenario: No in-app conversion
- **WHEN** the user supplies a GGUF, safetensors, or Hugging Face repo URL that is not the catalog `url`
- **THEN** the client refuses to convert or install it
- **AND** no native convert command exists

#### Scenario: Storage location
- **WHEN** a model is committed
- **THEN** files live at `Application Support/Plethora/CoreAIModels/<modelId>/<version>/`
- **AND** they are excluded from iCloud/iTunes backup
- **AND** they are not placed in tmp, Caches, or user Documents

#### Scenario: Not synced
- **WHEN** library sync or Yjs replication runs
- **THEN** `.aimodel` bytes are not uploaded or downloaded as document data

### Requirement: Signed catalog distribution
The system SHALL discover models only through a signature-verified Plethora catalog.

#### Scenario: Valid catalog
- **WHEN** a catalog verifies against the pinned public key
- **THEN** its entries are shown (subject to OS/flag gates)

#### Scenario: Invalid signature
- **WHEN** catalog bytes fail verification
- **THEN** the exposed catalog is empty
- **AND** no download starts
- **AND** the status reason is `catalog_invalid`

#### Scenario: Release catalog URL is pinned
- **WHEN** the app is a production build
- **THEN** the catalog URL cannot be overridden from settings
- **AND** debug builds may allow `coreAiCatalogUrl` for QA

#### Scenario: Catalog fetch cadence
- **WHEN** the On-device panel opens and the flag is on
- **THEN** the catalog may refresh if the TTL (12 hours) expired
- **AND** `generateStream` does not fetch the catalog as a side effect

#### Scenario: Status check has no download side effect
- **WHEN** `getCapabilities()` or `apple_coreai_status` runs
- **THEN** no model download is started

### Requirement: Size, disk, and memory gates
The system SHALL refuse installs that cannot fit, and SHALL refuse to load models that exceed a runtime memory budget.

#### Scenario: Sufficient disk
- **WHEN** available important-usage capacity is at least install size plus any extra staging bytes plus 512MiB
- **THEN** the download is allowed to start (subject to license and network policy)

#### Scenario: Insufficient disk
- **WHEN** free space is below that threshold
- **THEN** `downloadState` is `unavailable` with reason `insufficient_disk`
- **AND** no network transfer starts

#### Scenario: Sizes are visible
- **WHEN** a catalog entry is rendered
- **THEN** the UI shows download `byteSize` and on-disk `installSizeBytes`

#### Scenario: Large iPhone package warning
- **WHEN** `installSizeBytes` is greater than 1.5GB and the idiom is iPhone
- **THEN** the UI warns about size before install

#### Scenario: Low remaining space hard block
- **WHEN** installing would leave less than 1GB free
- **THEN** install is blocked unless the user confirms a low-disk override
- **AND** the 512MiB safety margin still applies

#### Scenario: Hard cap
- **WHEN** `byteSize` is greater than 8GiB
- **THEN** the client refuses the download as a catalog error

#### Scenario: Insufficient memory to load
- **WHEN** `ramRecommendedMb` exceeds the runtime memory budget
- **THEN** the package may remain downloaded
- **AND** `textGeneration` is false with reason `insufficient_memory`
- **AND** the session is not loaded

#### Scenario: No SKU allowlist
- **WHEN** hardware suitability is evaluated
- **THEN** the implementation uses OS, framework presence, disk, and memory APIs
- **AND** it does not branch on marketing names such as “iPhone 15 Pro”

#### Scenario: Deferred load
- **WHEN** the app launches with a ready model
- **THEN** `CoreAILanguageModel` is not loaded until warm-up or first generate

#### Scenario: Aggregate disk warning
- **WHEN** total Core AI install size exceeds 4GiB on iPhone or 16GiB on Mac
- **THEN** the panel warns and offers deletion
- **AND** inference of the active model still proceeds if otherwise ready

### Requirement: Download, checksum, and iOS background limits
The system SHALL download user-initiated catalog artifacts with resume, SHA-256 verification, and iOS background-transfer limits. It SHALL NOT use short `BGProcessingTask` windows as the byte transport.

#### Scenario: User-initiated download
- **WHEN** the user confirms install after license acceptance
- **THEN** a background `URLSession` download starts
- **AND** `downloadState` becomes `downloading`

#### Scenario: Wi-Fi default for large files
- **WHEN** `byteSize` is greater than 200MB and the user has not confirmed cellular
- **THEN** the download does not use cellular
- **AND** Low Data Mode is treated as restricted

#### Scenario: Cellular confirmation
- **WHEN** the user explicitly confirms “Download over cellular” for a large package
- **THEN** cellular may be used

#### Scenario: Progress
- **WHEN** bytes arrive
- **THEN** events keyed by `downloadId` update percent and byte counts
- **AND** a `downloading` snapshot is not cached as `downloaded`

#### Scenario: Checksum success
- **WHEN** the staging file’s SHA-256 matches the catalog
- **THEN** the package is atomically committed to the version directory
- **AND** `downloadState` becomes `downloaded`

#### Scenario: Checksum failure
- **WHEN** the hash does not match
- **THEN** staging is deleted
- **AND** the model is not marked installed
- **AND** the reason is `checksum_mismatch`

#### Scenario: Cancel
- **WHEN** the user cancels an in-flight download
- **THEN** staging is removed
- **AND** `downloadState` returns to `downloadable`

#### Scenario: Background continuation
- **WHEN** the user leaves the app during an in-flight download
- **THEN** the background URLSession may continue
- **AND** a new download is not originated from a background task alone

#### Scenario: Background expiry
- **WHEN** iOS pauses or expires the transfer
- **THEN** progress is persisted
- **AND** the UI tells the user to return to Plethora to continue
- **AND** the app does not cloud-fallback because the model is incomplete

#### Scenario: Process death
- **WHEN** the app is killed mid-download
- **THEN** a partial staging file is not treated as installed
- **AND** the download can resume using persisted `downloadId` / ETag when the OS allows

#### Scenario: No download origin in background
- **WHEN** the app is not in the foreground
- **THEN** the system does not start a brand-new model download

### Requirement: Versioning, updates, and deletion
The system SHALL version models as `(modelId, version)`, update via staging, and delete without leaving a loaded session on removed bytes.

#### Scenario: Identity
- **WHEN** two catalog rows share `modelId` and differ in `version`
- **THEN** they occupy different directories
- **AND** at most one is active

#### Scenario: Update download
- **WHEN** a newer semver is available for the active `modelId`
- **THEN** the new package downloads to staging without overwriting the live file
- **AND** the old version remains active until commit + successful warm-up

#### Scenario: Failed update
- **WHEN** the new package fails checksum or warm-up
- **THEN** the previously active version remains active

#### Scenario: Keep one previous version
- **WHEN** an update commits successfully
- **THEN** at most one previous version remains on disk for that `modelId`

#### Scenario: No in-place replace during inference
- **WHEN** a session is generating
- **THEN** the active package is not replaced until the plugin inference queue is drained or cancelled

#### Scenario: User delete
- **WHEN** the user confirms deletion of a model version
- **THEN** its directory is removed
- **AND** if it was active, another installed model is activated or none is

#### Scenario: Logout or reset
- **WHEN** logout or full local reset runs
- **THEN** all `CoreAIModels` directories are deleted

#### Scenario: Set active
- **WHEN** the user selects an installed version as active
- **THEN** subsequent generation uses that `(modelId, version)`
- **AND** provenance records `model` as `<modelId>@<version>`

### Requirement: Licenses
The system SHALL require per-version license acceptance before download and SHALL persist acceptance locally without syncing it as library content.

#### Scenario: Acceptance required
- **WHEN** `license.requiresAcceptance` is true (v1: always)
- **THEN** the Download control is disabled until the user accepts
- **AND** SPDX name and license URL are visible

#### Scenario: Record
- **WHEN** the user accepts
- **THEN** `{ modelId, version, spdx, acceptedAt }` is stored locally
- **AND** it is not Yjs-synced

#### Scenario: License change on update
- **WHEN** a new version has a different `spdx` or license URL
- **THEN** the user must accept again before downloading that version

#### Scenario: Non-redistributable weights
- **WHEN** a catalog entry has `redistribution` `forbidden-in-client`
- **THEN** production clients do not offer it for download

#### Scenario: Diagnostics
- **WHEN** diagnostics record a Core AI event
- **THEN** they may include SPDX and accepted=true
- **AND** they do not include license body text, prompts, or document content

### Requirement: Privacy and cloud boundary
Core AI inference SHALL stay on-device after install. Private Cloud Compute and silent cloud fallback SHALL NOT be used for this provider.

#### Scenario: Offline generate
- **WHEN** `textGeneration` is true and `generateStream` runs
- **THEN** the turn does not require network
- **AND** catalog refresh is not performed as part of the turn

#### Scenario: Cancelled never falls back
- **WHEN** the user cancels a Core AI generate
- **THEN** the task does not retry on cloud

#### Scenario: On-device badge
- **WHEN** a result’s `providerKind` is `ondevice` via Core AI
- **THEN** the compact On-device indicator may show
- **AND** Core AI is not listed in the cloud provider picker

#### Scenario: Install errors are not generation failures
- **WHEN** disk, checksum, or license gates fail
- **THEN** the app does not treat that as a trigger for `allowCloudFallback` retry of the same action as if inference failed

### Requirement: Concurrency
Core AI generation SHALL share the plugin’s single heavy-inference slot with Foundation Models, Speech, and Vision.

#### Scenario: One heavy job
- **WHEN** a Core AI generate is in flight
- **THEN** a second Core AI or FM generate is queued or rejected busy per the plugin queue
- **AND** a new TypeScript job framework is not introduced

#### Scenario: Warm-up
- **WHEN** `warmUp()` is called and the model is installed
- **THEN** the native model may load without producing user-visible text
- **AND** failure to allocate memory maps to `insufficient_memory` without crashing the process

### Requirement: Settings UX
Core AI management SHALL live on the On-device intelligence panel.

#### Scenario: Panel section
- **WHEN** the user opens On-device intelligence on iOS/macOS with the flag on
- **THEN** they see catalog, sizes, license, download/delete/update/active controls

#### Scenario: Unsupported OS copy
- **WHEN** the device is Apple but below iOS/macOS 27
- **THEN** the section explains the OS requirement
- **AND** download buttons are not enabled

#### Scenario: Non-Apple
- **WHEN** the platform is Android or desktop non-Apple
- **THEN** the Core AI management section is hidden or reports unsupported
- **AND** Nano UI is unaffected

### Requirement: Tests use fakes; CI cannot run Core AI
Automated tests SHALL use fake providers, fake catalogs, and fake download sessions. CI SHALL NOT link Core AI or download real `.aimodel` payloads.

#### Scenario: Fake provider in routing tests
- **WHEN** Vitest exercises `getRoutingProviders` with Core AI present
- **THEN** it uses `FakeCoreAIProvider` implementing `AIProvider`
- **AND** no native Core AI type is constructed

#### Scenario: Fake download state machine
- **WHEN** tests cover progress, cancel, checksum failure, and disk denial
- **THEN** a fake transport supplies events and bytes
- **AND** no HTTPS catalog CDN is contacted

#### Scenario: Rust stubs
- **WHEN** `cargo test` runs on Linux CI
- **THEN** Core AI commands serialize `platform_unsupported`
- **AND** the test binary does not link Apple Core AI

#### Scenario: Checksum fixture
- **WHEN** a test fixture’s bytes do not match the advertised SHA-256
- **THEN** commit is rejected with `checksum_mismatch`
