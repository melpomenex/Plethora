# iOS on-device AI — investigation, architecture, and OpenSpec map

Planning artifact only. Product code is not implemented by these changes.
Created 2026-08-23 after repository investigation. Aligns Apple on-device
intelligence with the **existing** `src/lib/ai/` task/provider system rather
than introducing a parallel "Apple AI island."

Related active/prior changes that this work **extends, does not replace**:

- `add-ondevice-ai-learning-system` (task layer, providers, semantic index, Ask Library)
- `add-android-ondevice-llm-bridge` / `expand-android-ondevice-ai-capabilities` / `optimize-ondevice-gemini-nano`
- `complete-ios-apple-privacy-compliance` (disclosure registry, purpose strings)
- `ios-feature-availability` / `src/lib/platformCapabilities.ts`

---

## 1. Investigation summary

### 1.1 Existing AI architecture (reuse this)

Plethora already has a capability-oriented AI layer. Features must keep using it.

| Piece | Location | Notes |
|---|---|---|
| `AIProvider` | `src/lib/ai/providers/types.ts` | `id`, `kind: "ondevice" \| "cloud"`, `getCapabilities()`, `generateStream`, `countTokens?`, `cancel?` |
| `AIModelCapabilities` | same | Detected, never assumed. Includes `textGeneration`, `structuredGeneration`, `vision`, `embeddings`, `offlineAvailable`, `downloadState`, … |
| `OnDeviceProvider` | `src/lib/ai/providers/onDeviceProvider.ts` | **Hard-wired to Gemini Nano** (`ON_DEVICE_PROVIDER_ID = "ondevice-gemini-nano"`) via `onDeviceAI.ts` |
| `CloudProvider` | `src/lib/ai/providers/cloudProvider.ts` | OpenRouter / OpenAI / Anthropic / Ollama via `src/api/llm` |
| Router | `src/lib/ai/providers/index.ts` `getRoutingProviders()` | On-device first iff `settings.ai.preferOnDevice`; currently one Nano + one cloud |
| Path resolver | `src/lib/ai/provider.ts` `resolveAiPath` / `runAiAction` | On-device only when `isOnDeviceAiSupportedPlatform()` **which is Android-only** |
| Tasks | `src/lib/ai/tasks/` | `runTask`, modelClass `fast\|full\|reasoning`, schemas, validation, diagnostics |
| Prompt injection | `src/lib/ai/tasks/containment.ts` | `<untrusted_source>` blocks + `UNTRUSTED_CONTAINMENT_CLAUSE` |
| Errors | `src/lib/ai/errors.ts` | Unified `AIError` taxonomy; cancelled never cloud-falls-back |
| Diagnostics | `src/lib/ai/diagnostics.ts` | No user content, prompts, or completions |
| Provenance | `src/api/ai-provenance.ts` + `ai_provenance` table | `provider`, `model`, `taskId`, fingerprint |
| Smart tagging | `src/lib/ai/tasks/definitions/smartTaggingTask.ts` | LLM task + **Tier 1 baseline classifier** fallback |
| Ask Library | `src/lib/ai/tasks/definitions/libraryTask.ts` + `useAskLibrary.ts` | Retrieve then generate; citations verified |
| Ask Plethora (help) | `src/lib/ai/tasks/definitions/askPlethoraTask.ts` | **Product docs**, separate from user library |
| Semantic index | `src-tauri/src/ai_learning/` | Canonical `semantic_chunks` + `semantic_chunk_embeddings`; rebuildable cache |
| Retrieval | `ai_learning_retrieve` / `src/api/ai-learning.ts` | Lexical FTS fallback when embeddings unavailable |
| Embeddings (Rust) | `src-tauri/src/ai/embeddings.rs` | OpenAI / Cohere / OpenRouter / Ollama; Android EmbeddingGemma via genai plugin |
| Settings | `settings.ai.preferOnDevice` (default true), `allowCloudFallback` (default **false**) | Cloud fallback is gated by billing consent + `ensureCloudAiDisclosure` |
| UI availability | `useAiAvailability` | Gates controls; hide when path is `none` |
| On-device panel | `OnDeviceAiPanel.tsx` | Renders **nothing** off Android |
| Platform registry | `src/lib/platformCapabilities.ts` | Has `on_device_ai_gemini_nano`; no Apple IDs yet |
| Native Android plugin | `src-tauri/plugins/plethora-android-genai/` | Status, prompt, summarize, OCR labels, embeddings; non-Android stubs `platform_unsupported` |

**Leakage today:** `isOnDeviceAiSupportedPlatform()` returns false on iOS; comments throughout UI say "Android-only." Provider-specific Nano types leak into `onDeviceAI.ts` which the generic `AIProvider` wraps. That is acceptable as an *adapter*, not as a call site pattern. React must not grow `if (ios) appleSession.respond()`.

### 1.2 Native iOS architecture

| Piece | Location |
|---|---|
| iOS plugins | `plethora-storekit` (Swift StoreKit 2), `plethora-folder-import` (UIDocumentPicker), share extension |
| Pattern | Rust crate registers Tauri plugin; iOS `ios/Sources/*.swift` implements `Plugin`; non-iOS returns typed unsupported errors |
| IPC | `PluginHandle::run_mobile_plugin` / Swift `invoke.resolve` / `invoke.reject("CODE: …")`; StoreKit streams `Transaction.updates` as channel events |
| Min iOS | `IPHONEOS_DEPLOYMENT_TARGET = 14.0` (`src-tauri/gen/apple/.../project.pbxproj`) |
| Permissions | Camera + microphone purpose strings already in `plethora-tauri_iOS/Info.plist` but **camera copy is QR-only** — must be updated for scan |
| Capabilities | `src-tauri/capabilities/default.json` allowlists plugin permissions |

**Plugin recommendation (binding):** one crate `plethora-apple-intelligence`, internally modular Swift files, namespaced commands (`apple_fm_*`, `apple_speech_*`, …). Same bundling strategy as `plethora-android-genai` (generation + embeddings + OCR in one plugin). Split crates would multiply stub/permission/CI surface and still share one availability snapshot.

Do **not** put Apple Intelligence into StoreKit or folder-import.

### 1.3 Documents, search, RAG

- Source of truth: SQLite (`documents`, `extracts`, `learning_items`, `semantic_chunks`).
- FTS5 lexical search already exists; command palette / GlobalSearch are lexical + commands.
- Help RAG (`features/help/helpRetrieval`) is **in-memory product documentation**. User library RAG is `ai_learning_retrieve`. **Do not merge indexes.**
- Core Spotlight must be a **derived, rebuildable search index**, never canonical storage. Identity must map 1:1 to Plethora ids (`semantic_chunks.id`, `documents.id`, …).
- Privacy default: **in-app semantic search only**. System-wide Spotlight surfacing is opt-in and off by default (private library).

### 1.4 Audio / speech

- Desktop STT: whisper.cpp / sherpa via Hugging Face manager; job queue in `src-tauri/src/transcription/`.
- Cloud STT: Groq Whisper.
- **Critical gap:** `src/lib/transcriptionProvider.ts` **substitutes local → Groq on native-mobile**. iOS today cannot run local whisper and will send audio to Groq if the user picked "local." Apple SpeechAnalyzer is the on-device replacement for that substitution.
- TTS is separate (Pocket TTS / Android sherpa / Groq). Out of scope except not breaking it.
- Audiobook/karaoke sync and extracts-while-listening already exist; timestamped Apple transcripts should use the same alignment-friendly segment model so future text↔audio navigation is not blocked.

### 1.5 Vision / import

- Import UI: `EnhancedFilePicker` sources `local | folder | url | arxiv | screenshot | anki | json`. Screenshot is platform-gated (`import_screenshot`).
- OCR: Tesseract.js, cloud OCR settings, Android ML Kit OCR labels on the genai plugin. No Apple Vision document pipeline.
- Image registry + image occlusion already exist; scans must keep the **source image** as an `image_assets` row for occlusion.
- Share extension already stages files into app-private storage.
- Camera purpose string currently forbids implying photo capture.

### 1.6 Apple API compatibility (August 2026)

Conservative boundaries used by all proposals:

| API | Min OS | Apple Intelligence required? | Offline | Notes |
|---|---|---|---|---|
| Foundation Models / `SystemLanguageModel` | iOS/iPadOS/macOS **26.0** | **Yes** (eligible hardware + enabled + model ready) | Yes once model downloaded | ~3B on-device; guided `@Generable`; tools; `Availability` enum: `available`, `deviceNotEligible`, `modelNotReady`, other. iOS **26.4** adds `contextSize` / `tokenCount`. WWDC26 adds Private Cloud Compute (treat as **cloud-class**, never silent). Languages follow Apple Intelligence language set; do not assume all user libraries are English. Simulator: availability typically unavailable / not ready — mock in CI. |
| `SystemLanguageModel.UseCase.contentTagging` | iOS 26 | Yes | Yes | Specialized use case; use for tag-like tasks when advertised, else default model + guided schema |
| SpeechAnalyzer / SpeechTranscriber | iOS/macOS **26.0** | **No** (separate Speech assets via `AssetInventory`) | Yes after locale assets installed | Long-form/lecture capable; timestamps via `audioTimeRange`; live + file. Mic permission for live. Not watchOS. |
| `RecognizeDocumentsRequest` | iOS/macOS **26.0** | **No** | Yes | Structure: paragraphs, lists, tables, barcodes; 26 languages documented. Simulator reported workable with fixture images. Handwriting: do not promise; fall back to text request / user edit. |
| `NLContextualEmbedding` | iOS **17** / macOS 14 | No | Yes after `requestAssets` | Token vectors, app mean-pools. **Revision/language/dimension can differ by OS** (reports of 512-d iOS vs 768-d macOS). **Do not sync vectors across devices.** Persist `embedding_version`. |
| Core Spotlight semantic + `CSUserQuery` | iOS 18+ semantic; SpotlightSearchTool **WWDC26** | Semantic ranking uses on-device index; tool needs FM | Index local | Donate `CSSearchableItem` with unique ids. Tool is read-only search for FM sessions. |
| Core AI / `.aimodel` / `CoreAILanguageModel` | iOS/macOS **27** | No (custom models) | Yes after install | Separate from system FM. Feature-flag off. Conditional compile. Hugging Face / conversion pipeline is a later ops concern. |
| Core ML | existing | No | Yes | Not the preferred new packaging; Core AI supersedes for new custom LLMs. |

Hardware: Apple Intelligence device list (iPhone 15 Pro / 16+, M-series iPad/Mac, etc.). **Never hard-code SKUs**; always `SystemLanguageModel.default.availability`.

App stays on **iOS 14 deployment target**. All 26+/27+ types are `@available` + runtime checks.

### 1.7 Testing / CI

- Vitest for `src/lib/ai/**` with mocked native modules (already the Nano pattern).
- Rust `cargo test --lib` for indexer/retrieval.
- No physical Apple Intelligence in CI. Fake providers are mandatory.
- Playwright is not a substitute for native FM.
- Physical-device matrix is manual / TestFlight (see each spec).

### 1.8 Architectural gaps Apple must fill

1. `OnDeviceProvider` is a single Nano adapter; iOS needs a second on-device `AIProvider`.
2. `isOnDeviceAiSupportedPlatform()` excludes iOS/macOS.
3. `getRoutingProviders()` cannot list multiple on-device backends.
4. Mobile local transcription silently becomes Groq.
5. No scan-document import source; camera purpose string is QR-only.
6. Semantic index has no Spotlight projector; iOS embeddings have no on-device backend (EmbeddingGemma is Android).
7. Help vs library already separated — keep it that way.
8. `AIError` lacks PermissionDenied / Apple-Intelligence-disabled / unsupported-language as first-class categories (map or extend).

### 1.9 Major risks

- Accidental Private Cloud Compute or cloud fallback without disclosure.
- Spotlight leaking private library into system search.
- Prompt injection from imported OCR/transcripts/documents via tool calling.
- Unstable NL embedding versions poisoning a synced vector column.
- Merge conflicts on `provider.ts`, `onDeviceAI.ts`, `providers/index.ts`, `settingsStore.ts`, plugin registration.
- iOS 14 compile break if 26 APIs are unguarded.
- Overlapping "Ask" UIs (help vs library vs command palette).

---

## 2. Binding architectural decisions

These are resolved. Implementation agents must not re-litigate them.

### D-Apple-1 — No parallel capability layer

Do **not** invent a second `summarize()` / `generateCards()` stack. Apple implements `AIProvider` (generation) and, where relevant, Rust `EmbeddingProvider` / transcription resolver / import pipeline. Features keep calling `runTask` / `runAiAction` / `askLibrary` / `resolveTranscription`.

### D-Apple-2 — One native plugin, modular Swift

Crate: `src-tauri/plugins/plethora-apple-intelligence/`
Swift modules (files, not extra crates): `AppleCapabilities`, `FoundationModelsBridge`, `AppleSpeech`, `AppleVision`, `AppleSpotlight`, `AppleNaturalLanguage`, `CoreAIBridge` (iOS 27 compile-gated).

TS SDKs may split files (`appleFoundation.ts`, `appleSpeech.ts`, …) but they invoke `plugin:plethora-apple-intelligence`.

Non-Apple OS: every command reports `platform_unsupported` without linking Apple frameworks.

### D-Apple-3 — Provider ids and routing

| id | kind | Platform |
|---|---|---|
| `ondevice-gemini-nano` | ondevice | Android (existing) |
| `ondevice-apple-foundation` | ondevice | iOS/macOS 26+ when FM `.available` |
| `ondevice-apple-coreai` | ondevice | iOS/macOS 27+, flag on, model installed |
| `cloud` (existing `CLOUD_PROVIDER_ID`) | cloud | all |

`getRoutingProviders()` order when `preferOnDevice !== false`:

1. Platform-native on-device providers whose `textGeneration` (or required capability) is live
2. Configured cloud/local LLM provider

When `preferOnDevice === false`: cloud/configured LLM first; Apple still appears in the On-device panel but is not auto-selected.

Never override an explicit user "don't use on-device" setting. Never silently send to Private Cloud Compute; PCC is treated as cloud-class and requires the existing cloud-AI disclosure if ever offered (out of v1 scope — **non-goal** for FM provider).

### D-Apple-4 — Settings UX

Do not add Apple as a row in the OpenRouter/Ollama provider list.

Extend `OnDeviceAiPanel` (rename conceptually to "On-device intelligence") so:

- Android: existing Nano + EmbeddingGemma rows
- iOS/macOS 26+: Apple Intelligence status (`available` / device not eligible / disabled / model not ready / unsupported OS)
- Shared toggles: Prefer on-device (existing), Allow cloud fallback (existing, default off)

Copy for Auto: "Prefer private on-device processing when this device can do it."

If the user **explicitly** selects Apple in the panel while unavailable, show a one-shot actionable explanation (enable Apple Intelligence / wait for download / unsupported device). Do not nag users who never opened it.

### D-Apple-5 — Privacy presentation

Reuse existing on-device vs cloud patterns (`useAskLibrary` already tracks path; `ensureCloudAiDisclosure`; diagnostics allowlist).

One compact indicator on AI result surfaces: **On-device** when `providerKind === "ondevice"`. Do not badge every button. Cloud path continues to disclose before first transmission.

Telemetry: only capability/availability, latency buckets, error category, fallback occurred. Never documents, transcripts, OCR text, prompts, cards.

### D-Apple-6 — Spotlight privacy

Default: donate items with unique identifiers for **in-app** `CSUserQuery` / `SpotlightSearchTool`, **not eligible for system Spotlight display**. Setting `settings.search.systemSpotlightEnabled` default **false**. Logout/reset/rebuild deletes the domain.

### D-Apple-7 — Retriever ⊥ generator

Ask Library continues: `retrieve()` then `runTask(ask-library)`. Retriever backends: existing SQLite semantic/lexical; optional Apple Spotlight semantic as an **additional** candidate source merged by chunk id. Generator: Nano / Apple FM / cloud per router.

Help Ask Plethora stays on `defaultHelpRetrieval` only.

### D-Apple-8 — Tools

If `SpotlightSearchTool` is used, it is the **only** FM tool in v1, read-only, argument-validated, results inserted as `<untrusted_source>` — never executed as commands. No filesystem, no deletes, no settings writes.

### D-Apple-9 — Smart tagging

Apple FM (and optionally content-tagging use case) is a provider for the existing `smart-tagging` task. Baseline classifier remains the no-LLM fallback. No second tag system.

### D-Apple-10 — Embeddings sync

NaturalLanguage and EmbeddingGemma vectors are **device-local derived data**. Persist `provider` + `model` + `revision`. On mismatch, mark stale and re-embed locally. Sync protocol must not assume vector equality across OS versions.

### D-Apple-11 — Speech vs Groq on mobile

On iOS 26+ with Speech assets ready, `resolveTranscription` prefers `apple` when settings provider is `local` **or** a new `apple` provider value. Groq remains available with disclosure. The current silent local→Groq substitution is replaced, not duplicated.

### D-Apple-12 — Scan import

Add import source `scan` (and Photos `photo`) gated by platform capabilities. Vision structure → HTML/Markdown document + original image asset. Enrichment (tags/summary/cards) is **opt-in after import**, using existing tasks.

### D-Apple-13 — Errors

Extend `AIErrorCategory` with `PermissionDenied`, `FeatureDisabled`, `UnsupportedLanguage`. Map:

- Apple Intelligence off / device not eligible → `FeatureDisabled` or `UnsupportedDevice`
- `modelNotReady` → existing `ModelDownloading`
- Speech/Vision permission → `PermissionDenied`
- Locale unsupported → `UnsupportedLanguage`
- Keep cancelled-never-falls-back.

### D-Apple-14 — Concurrency

Native plugin: at most one heavy FM inference **or** one SpeechAnalyzer **or** one Vision batch in flight unless Apple documents otherwise; queue with cancel. Reuse Android `requestId` + event channel pattern. Do not build a second TS job framework; hook existing transcription `job_queue` and `ai_learning` indexer.

### D-Apple-15 — Command palette

Add a small set of capability-gated commands, not a dump:

- Ask this document / Ask my library (existing Ask Library + doc QA)
- Summarize this / Generate cards / Learn this (existing tasks)
- Scan document / Record lecture (new, iOS capability-gated)

Filter via `capabilityId` on `Command` (already supported).

---

## 3. OpenSpec changes and dependencies

```text
A. extend-ai-capability-routing-for-apple
   ├── B. add-apple-foundation-models-provider
   ├── G. add-apple-naturallanguage-embeddings
   ├── H. add-apple-core-ai-custom-models          (iOS 27, flag off)
   │
C. add-apple-spotlight-semantic-index             (depends on A for ids/errors; indexer exists)
   │
   └── D. add-apple-ondevice-library-rag           (C + optionally B)
         uses existing Ask Library; must not start before A
│
E. add-apple-speech-transcription                 (A for plugin/errors; optional B enrichment)
F. add-apple-vision-document-scan                 (A for plugin/errors; optional B enrichment)
```

Hard vs soft:

| Change | Hard deps | Soft deps |
|---|---|---|
| A routing | none (builds on existing task layer) | Android genai must keep compiling |
| B Foundation Models | A | existing smart-tagging / studio / passage tasks |
| C Spotlight | A (stable chunk URIs + plugin crate) | existing semantic indexer |
| D Library RAG (Apple path) | A, C | B for on-device answers |
| E Speech | A (plugin skeleton + errors) | B for post-process; existing job_queue |
| F Vision | A | B enrichment; image registry; import pipeline |
| G NaturalLanguage | A | C/index (writes embedding provider); not B |
| H Core AI | A | B (same LanguageModelSession abstraction) |

---

## 4. Implementation sequencing

**Phase 1 (blocking):** A — routing, plugin skeleton, stubs, fakes, settings/availability, error categories, platform capability IDs.

**Phase 2 (parallel after A lands):** B, C, E, F, G. These have distinct Swift files and TS SDKs. Coordinate only on plugin `lib.rs` command list and `capabilities/default.json` (A should reserve command names).

**Phase 3:** D — after C (index donations exist) and preferably B (on-device generator). Can ship lexical Ask Library on Apple FM using existing SQLite retrieval even if Spotlight is late; Spotlight is an enhancer.

**Phase 4:** H — iOS 27 / Xcode 27, flag default off.

---

## 5. Parallel implementation ownership (next fleet)

| Agent | Owns | Must not edit except agreed seams |
|---|---|---|
| Agent A | `extend-ai-capability-routing-for-apple` | plugin crate skeleton, `providers/index.ts`, `provider.ts`, `errors.ts`, `OnDeviceAiPanel`, platform capability IDs, fakes |
| Agent B | Foundation Models Swift + `appleFoundation.ts` + `AppleFoundationProvider` | existing task definitions (tests only); schemas already in TS |
| Agent C | Spotlight Swift + indexer hooks in `ai_learning/indexer.rs` | not retrieval prompt text |
| Agent D | Ask Library retriever merge + palette commands | not help retrieval |
| Agent E | Speech Swift + `transcriptionProvider.ts` + job_queue apple backend | not TTS |
| Agent F | Vision Swift + EnhancedFilePicker + import mapping | not occlusion geometry except handing source image id |
| Agent G | NL Swift + `embeddings.rs` Apple variant | not FM prompts |
| Agent H | Core AI (later) | isolated `CoreAIBridge.swift` |
| Agent T | cross-cutting tests/fakes if A left TODOs | follow A contracts |

**High-conflict files (serialize or A-owns then others PR against):**

- `src/lib/ai/providers/index.ts`, `types.ts`, `provider.ts`, `errors.ts`
- `src/lib/ai/onDeviceAI.ts` (A should split Apple vs Android files)
- `src/stores/settingsStore.ts` (`features.*` flags, `ai.*` comments)
- `src/lib/platformCapabilities.ts`
- `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs` (plugin register)
- `src-tauri/capabilities/default.json`
- `src-tauri/plugins/plethora-apple-intelligence/src/lib.rs` (command enum — A reserves, others add behind modules)
- `src/components/settings/AIProviderSettings.tsx` / `OnDeviceAiPanel.tsx`
- `EnhancedFilePicker.tsx` (F only)
- `transcriptionProvider.ts` (E only)
- `ai_learning/indexer.rs` (C + G coordinate: C donations, G embed provider)

---

## 6. Unresolved decisions (genuine)

1. **Private Cloud Compute as an explicit user-visible "Apple Private Cloud" provider** — deferred. v1 on-device FM only. Revisit when Apple’s PCC API and disclosure copy are product-approved.
2. **Exact Apple Intelligence language matrix per SKU/OS** — follows Apple’s published list at implementation time; specs require runtime locale checks rather than a frozen table.
3. **Whether macOS desktop builds enable FM in the same release as iOS** — spec says **yes if availability is `.available`**, because the plugin is shared; QA may still ship iOS-first via feature flag `appleFoundationModels` if TestFlight capacity is iOS-only.

Everything else in §2 is decided.

---

## 7. Security / privacy review (architecture-level)

- Imported documents, OCR, and transcripts are untrusted. Tasks already wrap them; Apple bridges must not concatenate them into Swift `Instructions` as trusted policy.
- FM tool calling: only Spotlight search, validated args, no native privileges.
- Default Spotlight non-display prevents system-wide leakage of private notes/cards.
- Cloud fallback remains default **off**; paid retry still uses `requestCloudFallback`.
- Plugin rejects oversized payloads (mirror Android image bounds).
- Logs/diagnostics: no content.
- Camera/mic purpose strings must match actual new workflows (scan, lecture).
- Model output never directly invokes domain writes; existing propose → validate → user accept stands.

---

## 8. OpenSpecs created

See `openspec/changes/` for:

1. `extend-ai-capability-routing-for-apple`
2. `add-apple-foundation-models-provider`
3. `add-apple-spotlight-semantic-index`
4. `add-apple-ondevice-library-rag`
5. `add-apple-speech-transcription`
6. `add-apple-vision-document-scan`
7. `add-apple-naturallanguage-embeddings`
8. `add-apple-core-ai-custom-models`
