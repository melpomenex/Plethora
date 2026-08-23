# Android-native on-device AI — architecture plan

Status: **planning only** (2026-08-23). No production implementation in this session.
Companion OpenSpecs live under `openspec/changes/` (see §3). A later Cursor fleet implements them.

This document is the reconciliation of repository audit + current Google Android AI documentation. It is the source of truth for fleet split, supersession, and shared-file ownership.

---

## 1. Android AI architecture audit

### 1.1 What already exists (not greenfield)

Plethora already has a working Android on-device generative path and a cross-platform task/provider layer.

| Layer | Location | Role |
|---|---|---|
| Kotlin plugin | `src-tauri/plugins/plethora-android-genai/` | ML Kit GenAI Prompt + Summarization, structured output (KSP), streaming, cancel, OCR labels, LiteRT EmbeddingGemma |
| Rust shim | `src-tauri/plugins/plethora-android-genai/src/lib.rs` | Typed commands, non-Android stubs, embedding helper for the indexer |
| TypeScript SDK | `src/lib/ai/onDeviceAI.ts` | Status, capabilities, summarize/prompt/OCR/embed, chunking |
| Provider | `src/lib/ai/providers/onDeviceProvider.ts`, `cloudProvider.ts` | `AIProvider` implementations |
| Task layer | `src/lib/ai/tasks/` | `runTask`, router (`fast`/`full`/`reasoning`), schemas, containment |
| Errors | `src/lib/ai/errors.ts` | `AIError` taxonomy |
| Settings | `settings.ai.preferOnDevice` (default true), `allowCloudFallback` (default **false**) | Routing + explicit cloud retry |
| Semantic memory | `src-tauri/src/ai_learning/` | Chunker, indexer, FTS5 ∪ cosine retrieval, EmbeddingGemma/Ollama/cloud/mock |
| Smart tagging | `src/lib/ai/tasks/definitions/smartTaggingTask.ts` + Rust/TS baseline | Tier-1 deterministic + Tier-2 LLM |
| Ask library | `libraryTask.ts`, `useAskLibrary.ts`, `schemas/libraryAnswer.ts` | Grounded RAG with citation validation |
| Ask Plethora (help) | `askPlethoraTask.ts` | Product-docs Q&A (separate corpus) |
| Translation service | `src/lib/languageTranslation/` | Provider-kind `local` / `dedicated` / `ai` — **no Android ML Kit adapter yet** |
| Speech today | Rust whisper.cpp + sherpa-onnx; Groq cloud; `huggingface-speech-model-manager` OpenSpec | No ML Kit Speech |
| Vision today | Image registry, occlusion task, Latin OCR in the genai plugin, Mistral/GLM OCR providers, Tesseract | No ML Kit Document Scanner |
| Tests | Vitest (`FakeAIProvider`, eval fixtures), Kotlin JVM tests, limited instrumented OCR test | No emulator GenAI CI |

**Gradle pins** (`src-tauri/plugins/plethora-android-genai/android/build.gradle.kts`):

- `com.google.mlkit:genai-summarization:1.0.0-beta1`
- `com.google.mlkit:genai-prompt:1.0.0-beta4`
- `com.google.mlkit:genai-schema:1.0.0-alpha1` + `genai-schema-compiler:1.0.0-alpha1`
- `com.google.mlkit:text-recognition:16.0.1` (Latin, bundled)
- `com.google.ai.edge.litert:litert:2.1.0`
- plugin `minSdk = 24`; GenAI AARs require 26, merged via `tools:overrideLibrary`

**Native commands already exposed:** `ondevice_ai_status`, `capabilities`, `summarize`, `prompt`, `generate`, `download`, `warm_up`, `count_tokens`, `cancel` / `cancel_prompt_request`, `start_prompt_stream`, `ocr_labels`, `embed_status` / `embed_download` / `embed_texts`.

**Kotlin tests:** `CapabilityMappingTest`, `PromptContractTest`, `StructuredSchemaTest`, `StreamingRegistryTest`, `EmbeddingSupportTest`, `OcrSupportTest`.

### 1.2 Previous OpenSpec status

| Change | Status | Relation to this plan |
|---|---|---|
| `add-android-ondevice-llm-bridge` | **Implemented foundation.** Tasks 7.2/7.3/7.5 still open (device quality capture, unsupported-device manual test). | Retain as historical baseline. Do **not** rewrite. New work **modifies** `android-genai`. |
| `optimize-ondevice-gemini-nano` | **Implemented** (adaptive context, streaming summarize, warmup, token-limit cache). | Incorporated; no competing rewrite. |
| `expand-android-ondevice-ai-capabilities` | **Implemented** (per-feature status, streaming, cancel, structured output, image prompt, richer errors). | Baseline for provider modernization. Remaining gaps listed in §1.4. |
| `add-ondevice-ai-learning-system` | **Implemented** (task architecture, Learn this, occlusion OCR, semantic index, Ask library, recall/tutor/agent flags). | **Shared capability core already exists.** New shared work **extends** `ai-task-architecture` rather than replacing it. |
| `implement-plethora-intelligence-cross-library-semantic-indexing-and-rag` | Separate intelligence-wave RAG expansion (`rag_query`, citations, source_kind). | Android AppSearch must implement/extend this retrieval contract, not invent a second RAG. |
| `smart-tagging-system` | Active product design; TS task exists. | Android must feed **this** task, never `AndroidSmartTagger`. |
| `huggingface-speech-model-manager` | Speech model install for whisper/sherpa. | Parallel to ML Kit Speech; user preference must win. |
| Apple Foundation Models / iOS on-device intelligence | **No OpenSpec exists.** Only a forward-looking note in the original Android bridge design. | Shared contracts in `extend-ai-capability-architecture` MUST stay platform-neutral so iOS can satisfy them later. |

There is **no** `openspec/changes/archive/` tree. Completed Android AI changes remain in `openspec/changes/`. This plan does **not** archive them; it records supersession so new changes do not duplicate contradictory requirements.

### 1.3 Current provider architecture (reuse this)

```text
feature UI / command palette
        ↓
runTask / runAiAction / domain services (Smart Tagging, Ask Library, Studio)
        ↓
resolveAiPath(requirement) + resolveTaskRoute(modelClass)
        ↓
OnDeviceProvider  |  CloudProvider  |  FakeAIProvider
        ↓
onDeviceAI.ts  →  Tauri plugin:plethora-android-genai  →  Kotlin ML Kit
```

This **is** `feature → capability/task → router → provider`. Do not introduce a second router.

Gaps vs the desired product capability map:

| Desired capability | Today |
|---|---|
| summarize / explain / cards / cloze / tags / classify / Q&A / describeImage | Task layer + Nano/cloud |
| extractConcepts / generateMetadata | Partial (Learn this / classification tasks) |
| embed / semanticSearch / findRelated | `ai_learning` SQLite + embeddings; **no AppSearch** |
| transcribeAudio / transcribeLiveAudio | Whisper/sherpa/Groq; **no ML Kit Speech** |
| scanDocument / recognizeDocument | Import + OCR providers; **no Document Scanner** |
| identifyLanguage | **Missing** as a cheap ML path |
| translate | `languageTranslation` service; **no ML Kit Translate adapter** |

Platform leakage exists (`nativePlatform() === "android"` in `onDeviceAI.ts`, settings copy mentioning Gemini Nano). Features should keep calling tasks; only providers and native plugins should know Google names.

### 1.4 Technical debt / stale API / missing pieces

1. **Error-code contract drift.** Kotlin maps `busy`, `battery_quota_exceeded`, `background_use_blocked`, `safety_blocked`, `queue_full`. TypeScript `ON_DEVICE_AI_ERROR_CODES` and `ON_DEVICE_CODE_TO_CATEGORY` **omit** them, so they collapse to `GenerationFailed` / `inference_failed`. UI cannot distinguish quota vs background vs busy.
2. **`allowCloudFallback()` vs `requestCloudFallback()`.** The helper uses `!== false` (undefined would allow fallback); the consent path uses `=== true`. Default store value is `false`. Must unify on explicit opt-in.
3. **Specialized GenAI APIs unused:** Image Description, Proofreading, Rewriting, Speech Recognition. Proofreading/Rewriting stay non-goals (chat-message APIs). Image Description and Speech are in-scope via new/extended providers.
4. **OCR is Latin-only bundled.** CJK/Devanagari need additional recognizer deps.
5. **No Document Scanner, Language ID, Translate, Entity Extraction, AppSearch.**
6. **EmbeddingGemma download** is custom HTTP + ModelScope fallback (HF gated). Not Play AI packs.
7. **Foreground restriction** is mapped natively but not a first-class `AIError` or job-scheduler pause/resume.
8. **Kotlin plugin comment** still says “four commands”; the surface is much larger.
9. **CI** builds Android APK (`mobile-build.yml`) but does **not** run `:plethora-android-genai:test`. Gradle JVM tests are local-only.
10. **Build notes path** still mentions `plugins/android-genai/` after the `plethora-android-genai` rename.
11. **Structured output** remains **alpha** (`genai-schema 1.0.0-alpha1`). Must keep JSON-repair fallback forever for that path.
12. **System instructions** require Gemini Nano V3+; older devices must fold instructions into text (already a capability flag).

### 1.5 What to retain vs refactor

**Retain:** plugin crate layout, command names, `AIProvider`/`AITaskDefinition`/`runTask`, containment (`<untrusted_source>`), Smart Tagging two-tier design, `ai_learning` as source-of-truth index, `GeneratedFlashcard` / `CardProposal` / `SmartTaggingOutput` / `LibraryAnswer` schemas, `FakeAIProvider`, `preferOnDevice` + explicit cloud fallback, single-thread native inference queue.

**Refactor/extend (not replace):** error taxonomy, capability descriptors for non-generative ML, enrichment policy, plugin split for speech/vision/search/nlp, TS error mapping, job pause on `BACKGROUND_USE_BLOCKED`.

---

## 2. Current Android capability matrix

Sources: official ML Kit / Android developer docs retrieved 2026-08-23. Uncertain cells marked **uncertain**.

| Capability | Google/Android API | Maturity | Min Android / API | Hardware | Play Services | On-device inference? | Initial download? | Offline once prepared? | Foreground restriction? | Plethora use | Fallback |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Prompt (text / image / structured) | ML Kit GenAI Prompt (`genai-prompt:1.0.0-beta4` in-repo) | **Beta** (structured output **alpha**) | API 26 for library; app stays 24 with override | AICore / Gemini Nano device list; **unlocked bootloader unsupported** | AICore (system) | Yes | AICore model/config may download | Yes, after AICore ready | **Yes** — `BACKGROUND_USE_BLOCKED` | Cards, explain, Q&A, structured tasks | Cloud/local LLM if policy allows; hide action if none |
| Summarization (1–3 bullets) | ML Kit GenAI Summarization (`1.0.0-beta1`) | **Beta** | API 26 (same override) | AICore devices | AICore | Yes | Feature adapter download possible | Yes once ready | **Yes** | Bullet summaries when language is EN/JA/KO | Prompt structured summary; cloud |
| Image description (short alt) | ML Kit GenAI Image Description | Listed on ML Kit GenAI overview (feature API) | AICore devices | AICore | AICore | Yes | Possible | Yes once ready | **Yes** | Alt text / searchable image metadata | Prompt multimodal; skip |
| Speech Basic | ML Kit GenAI Speech Recognition Basic (`genai-speech-recognition:1.0.0-alpha1`) | **Alpha** | **API 31+** | Most devices API 31+ | Traditional on-device SR model (100–200 MB **per locale**) | Yes | Yes per language | Yes once downloaded | Treat as **Yes** (GenAI API umbrella) until proven otherwise | Live/file transcribe | whisper/sherpa; Groq if policy allows |
| Speech Advanced | Same API, Gemini Nano mode | **Alpha** | Pixel **10** (more “in development”) | Pixel 10 + AICore | AICore adapter (small vs per-language SR) | Yes | Adapter download | Yes once ready | **Yes** | Higher-quality transcribe when available | Basic → whisper/sherpa → cloud |
| Document scanner | `play-services-mlkit-document-scanner` **16.0.0** (docs) | **GA** (Play-delivered UI) | Broad; Play Services | Camera | **Yes** (~300 KB APK; UI/models downloaded) | Scan UI on device | First-use download of scanner UI | Scanning needs camera; no cloud required | Scanner is interactive UI (foreground) | Scan-to-Plethora page images | Gallery import / existing file picker |
| OCR Latin | `com.google.mlkit:text-recognition:16.0.1` (in-repo) | **GA** | API 21+ | None special | No (bundled) | Yes | No | Yes | No | Occlusion labels, scan OCR | Other OCR providers |
| OCR CJK/Devanagari | text-recognition-{chinese,japanese,korean,devanagari} | **GA** | API 21+ | None special | Bundled or Play variants | Yes | Bundled vs download | Yes once present | No | Non-Latin pages | Cloud OCR; user language pack |
| Language ID | `com.google.mlkit:language-id:17.0.6` (bundled ~900 KB) | **GA** | Broad | None | Optional unbundled | Yes | Bundled = no | Yes | No | Import language; routing | `und` + skip language-sensitive APIs |
| Translation | ML Kit Translate (on-device models per pair) | **GA** | Broad | Disk for models (~tens of MB/pair) | Model download | Yes | **Yes** per pair | Yes | No | `languageTranslation` `local` provider | dedicated/ai providers per existing priority |
| Entity extraction | ML Kit Entity Extraction | **GA** (evaluate quality) | Broad | Per-model download | Often Play | Yes | Yes | Yes | No | Dates/places metadata if quality sufficient | Skip; do not block import |
| Digital ink | ML Kit Digital Ink Recognition | **GA** | Broad | ~20 MB/language | RemoteModelManager | Yes | Yes | Yes | No | Optional handwriting; **not v1 scan path** | OCR / skip |
| Image labeling | ML Kit Image Labeling | **GA** | Broad | Bundled/unbundled | Optional | Yes | Maybe | Yes | No | Cheap image tags | GenAI description; skip |
| AppSearch FTS | Jetpack AppSearch LocalStorage | Stable library; embedding APIs **alpha** (`1.2.0-alpha01` notes) | LocalStorage: all; PlatformStorage: API 31+ | None | PlayServicesStorage optional | N/A (index) | No model | Yes | No | Derived keyword index | Existing SQLite FTS5 |
| AppSearch vector search | `SCHEMA_EMBEDDING_PROPERTY_CONFIG` / `semanticSearch()` | **Alpha** feature flag in AppSearch | Feature-gated | None | Depends on backend | **Does not generate embeddings** | Embeddings from Plethora provider | Yes | No | Optional hybrid | Existing cosine store |
| Embedding generation | LiteRT + EmbeddingGemma 300M (in-repo) | Custom; LiteRT 2.1.0 | RAM for ~184 MB model | Mid/high devices | No | Yes | **Yes** (~184 MB, user action) | Yes | No (not GenAI) | `ai_learning` vectors | Ollama/cloud embeddings |
| Custom LLM | LiteRT-LM (Kotlin stable per AI Edge docs) + Play for On-device AI **beta** | LiteRT-LM stable; **Play AI packs beta** | High-RAM / NPU/GPU tiers | Strict hardware targeting | Play delivery for packs | Yes if loaded | On-demand pack | Yes | Product policy: treat generative custom LLMs as foreground-preferred | Devices without Nano | Nano or cloud |
| Platform SpeechRecognizer | Android `SpeechRecognizer` | GA | Varies; ML Kit Basic claims broader API 31 coverage | OEM | Sometimes | Yes | Often | Often | OEM-dependent | Not primary (use ML Kit Basic) | |

**Confirmed AppSearch fact:** AppSearch can **store and search** embedding vectors; it does **not** produce them. Plethora must keep embedding generation on EmbeddingGemma / Ollama / cloud.

**Confirmed speech timestamp fact:** `SpeechRecognizerResponse` subclasses are PartialText, FinalText, Completed, Error. **No word-level timestamps documented.** Plethora transcript model keeps `start/end/wordTimings` optional.

**Confirmed GenAI foreground fact:** [ML Kit GenAI overview](https://developers.google.com/ml-kit/genai) — inference only when the app is the **top foreground** app, including no foreground-service workaround.

**Confirmed quota fact:** short-term `BUSY`; long-duration `PER_APP_BATTERY_USE_QUOTA_EXCEEDED`. Unlocked bootloader → feature not found / unsupported.

---

## 3. OpenSpecs created (this session)

| ID | Change directory | Owns | Does not own |
|---|---|---|---|
| **A** | `extend-ai-capability-architecture` | Shared capability descriptors, error taxonomy extensions, enrichment policy, fallback policy UX, non-generative capability interfaces, mocks, privacy indicator rules | Native Google SDKs, AppSearch schema, scanner UI |
| **B** | `modernize-android-gemini-nano-provider` | `plethora-android-genai` evolution, error mapping, specialized vs Prompt routing, quotas/foreground, Image Description client | Speech, scanner, AppSearch, translation |
| **C** | `android-appsearch-derived-index` | Private AppSearch derived index + hybrid merge into `rag_query` | Generator prompts, SQLite source of truth |
| **D** | `android-local-rag-composition` | Retriever×generator selection for Ask Library / Ask this document; help vs library namespaces | AppSearch implementation, Nano inference |
| **E** | `android-native-speech-intelligence` | ML Kit Speech plugin, lecture/import/voice-note workflows, PCM constraints, persistence | Whisper engine internals, card UI |
| **F** | `android-scan-to-plethora` | Document Scanner + OCR import into existing documents/image registry | Occlusion composer internals, Nano generation |
| **G** | `android-lightweight-ml-nlp` | Language ID, ML Kit Translate adapter, optional entity extraction | GenAI Prompt, speech |
| **H** | `android-custom-ondevice-models` | LiteRT-LM optional generative model, hardware tiers, Play AI packs, license/provenance | Gemini Nano, AppSearch |

Merged vs the original A–I sketch: **Proposal I (AI packs) is inside H** (inseparable delivery). Shared capability core is **A**, not a greenfield router.

---

## 4. Proposal dependency graph

```text
A  extend-ai-capability-architecture
│
├── B  modernize-android-gemini-nano-provider
├── C  android-appsearch-derived-index
├── E  android-native-speech-intelligence
├── F  android-scan-to-plethora
├── G  android-lightweight-ml-nlp
└── H  android-custom-ondevice-models     (can start after A contracts; ship last)

B + C + A
    └── D  android-local-rag-composition

F ──(optional enrich)──► B / G
E ──(optional enrich)──► B
```

**Concurrent after A contracts land:** B, C, E, F, G, and H (runtime subset) in parallel.
**D waits** on B (generator readiness states) + C (optional retriever) + A (composition interface).
**D can start against fakes** as soon as A’s retriever/generator interfaces exist.

---

## 5. Supersession map

| Existing change | Decision |
|---|---|
| `add-android-ondevice-llm-bridge` | **Retained implemented foundation.** New B **modifies** `android-genai`; does not create `…-v2`. Open hardware tasks remain B’s verification matrix. |
| `optimize-ondevice-gemini-nano` | **Incorporated.** B must not regress warmup, adaptive context, streaming summarize, token-limit cache. |
| `expand-android-ondevice-ai-capabilities` | **Incorporated baseline.** B adds error-contract completion, Image Description, quota/foreground product behavior, API re-pin process. |
| `add-ondevice-ai-learning-system` | **Retained shared architecture.** A **modifies** `ai-task-architecture` and related specs; does not fork a second task engine. |
| `implement-plethora-intelligence-…-rag` | **Retained retrieval product.** C/D implement Android backends behind `rag_query` / Ask Library. |
| `smart-tagging-system` | Unchanged product; G/B only supply cheaper/better providers. |
| `huggingface-speech-model-manager` | Complementary; E must respect user-selected STT engine. |

---

## 6. Implementation sequencing

### Phase 0 — contracts (serialized)
Agent A lands error categories, capability descriptor types, fallback policy helper unification, enrichment tiers, fake providers for speech/vision/search/translate, TypeScript interfaces with **stub implementations**.

### Phase 1 — parallel native providers
B, C, E, F, G (and H model-manager plumbing without shipping a multi-GB pack).

### Phase 2 — composition
D wires Ask Library/Ask this document to generic retriever + generator. Command palette actions call **capabilities**, not SDK names.

### Phase 3 — custom models
H completes LiteRT-LM + Play AI packs on targeted devices only.

### Phase 4 — advanced multimodal
Image-occlusion auto-regions remain **experimental** (existing `aiOcclusionFreeform` flag). F must not block on it.

---

## 7. Future Cursor agent-fleet split

| Agent | OpenSpec | Primary files | Depends on |
|---|---|---|---|
| **Agent A — AI Core** | A | `src/lib/ai/errors.ts`, `providers/types.ts`, `tasks/types.ts`, `provider.ts`, `FakeAIProvider.ts`, settings types | none |
| **Agent B — Gemini Nano** | B | `plethora-android-genai/**`, `onDeviceAI.ts`, `onDeviceProvider.ts`, `docs/android-build-notes.md` | A error codes |
| **Agent C — AppSearch** | C | new `plethora-android-search` plugin; `ai_learning/retrieval.rs` hybrid hook (behind interface) | A retriever interface |
| **Agent D — RAG composition** | D | `libraryTask.ts`, `useAskLibrary.ts`, `askPlethoraTask.ts` (namespace only) | A, then B/C fakes |
| **Agent E — Speech** | E | new `plethora-android-speech`; transcription stores; lecture UI | A speech capability types |
| **Agent F — Vision/Scan** | F | new `plethora-android-vision`; import pipeline; image registry hooks | A vision types; OCR may reuse genai OCR |
| **Agent G — Lightweight NLP** | G | new `plethora-android-nlp`; `languageTranslation` adapter | A + existing translation service |
| **Agent H — Custom models** | H | LiteRT-LM + AI pack gradle; model manager UX | A download-state types; do not fight B’s EmbeddingGemma downloader — **H owns generative packs; B keeps Gemma download until H absorbs embeddings in a later slice** |
| **Agent T — Tests/CI** | slices in A–H | Gradle test job, Fake* providers, eval harness (non-CI) | After each native plugin exists |
| **Agent I — Integration** | product scenarios | palette, import, settings copy | Phase 1 landed |

### Shared-file serialized ownership

| Hotspot | Owner | Others |
|---|---|---|
| `src/lib/ai/errors.ts` | **A** first, then B only adds mapped codes A already declared | Nobody else |
| `src/lib/ai/providers/types.ts` | **A** | B implements; H may add `kind: "local-model"` after A lands the union |
| `src/lib/ai/provider.ts` / `providers/index.ts` | **A** | B must not fork `resolveAiPath` |
| `src/lib/ai/onDeviceAI.ts` | **B** | A does not add speech/scan here |
| `src-tauri/src/lib.rs` + `Cargo.toml` | **Serialized**: each plugin agent adds **one** `.plugin(...)` + workspace crate; never rewrite unrelated plugins | Integration agent last-rebase |
| `src-tauri/capabilities/default.json` | Each plugin agent appends **only its permission identifiers** | |
| `src/stores/settingsStore.ts` | **A** for fallback/enrichment/privacy indicator; E/F/G add nested optional keys in named sections | Coordinate field names in A |
| `src-tauri/src/ai_learning/retrieval.rs` | **C** adds optional AppSearch candidate source behind a trait; D consumes | B does not touch |
| `src/lib/ai/tasks/definitions/libraryTask.ts` | **D** | C does not change prompts |
| `src/lib.rs` plugin registration order | document in each tasks.md | |

---

## 8. Risk register (impact × mitigation)

| Risk | Impact | Mitigation |
|---|---|---|
| Google API churn (Prompt beta, schema alpha, Speech alpha, AppSearch embedding alpha, Play AI packs beta) | High | Pin versions in `docs/android-build-notes.md`; JSON fallback; feature flags; re-verify Maven before each implementation wave |
| AICore device fragmentation / Nano version skew | High | Runtime `checkFeatureStatus` + `getBaseModelName()`; never device-name allowlists; provenance on generated artifacts |
| Foreground-only GenAI | High | Record audio/index in background-safe paths; pause generative jobs; `ForegroundRequired` error; no 2k-card batch in background |
| Quota / battery / BUSY | High | Map to taxonomy; backoff only for BUSY; do not hammer; respect `allowCloudFallback` |
| Unlocked bootloader / AICore bind failures | Medium | `UnsupportedDevice` vs `ProviderNotReady` distinction (FEATURE_NOT_FOUND after reset = not-ready, not unsupported) |
| OEM Play Services gaps | Medium | Per-capability unavailable; app still works |
| Dual index drift (SQLite vs AppSearch) | High | AppSearch is **derived**; delete cascades; rebuild command; SQLite remains SoT |
| Embedding model upgrade | High | Existing `embedding_version` stale-on-change; AppSearch vectors rebuilt with same version key |
| Large model storage | High | Never install-time GB packs; Wi-Fi preference; explicit UX; hardware targeting |
| Speech alpha + PCM-only files | Medium | Convert in-app; persist raw capture independently of recognizer |
| Lecture in background | High | Foreground service **recording** may be allowed; **GenAI transcribe** likely not — split capture vs transcribe |
| Tauri streaming complexity | Medium | Reuse genai Channel/event pattern; one terminal event |
| Physical-device coverage | High | Deterministic CI + small manual/Test Lab matrix (see A/B tests) |
| Prompt injection | High | Keep containment; never tool-call into privileged native APIs from model output |
| Silent cloud fallback | High | Default `allowCloudFallback: false`; unify helpers; never label cloud results as on-device |
| Plugin merge conflicts | Medium | Separate plugins; A owns shared TS contracts first |

---

## 9. Unresolved decisions (only genuine leftovers)

1. **Exact Play AI pack artifact and Gemma/Gemma-like license for a future generative pack** — cannot select a redistributable LLM until legal review of a concrete model. H specifies the **process and tiers**, not a model filename.
2. **Whether Basic ML Kit Speech is exempt from GenAI foreground rules** — docs apply the restriction to GenAI APIs as a whole. Spec E treats Basic as foreground-restricted until a device experiment proves otherwise.
3. **AppSearch LocalStorage APK size vs benefit** — C is justified as derived hybrid search, but the implementation fleet may **disable AppSearch behind a flag** if LocalStorage binary size is unacceptable; SQLite path remains complete.
4. **Entity extraction quality on academic prose** — G ships infrastructure + a quality gate; auto-apply only if fixtures pass, else metadata-only/off.
5. **Galaxy S25-class Prompt vs specialized split** — Google’s Prompt device tables omit some devices that still get Summarization/Image Description. Runtime `FeatureStatus` is authoritative (captured in B).

All other product questions are decided in the OpenSpecs (privacy defaults, enrichment tiers, plugin split, schema reuse, no system-surface search).

### Swarm deltas folded after investigation agents returned

Investigation agents confirmed the plan’s core: **extend `ai-task-architecture`**, keep `plethora-android-genai`, treat AppSearch as optional derived index, keep help vs library corpora separate. Concrete code bugs they found that B/A/F must fix:

| Finding | Owner |
|---|---|
| `OnDeviceProvider` hardcodes `embeddings: false` | B |
| `multiImage` advertised without `images[]` wire | B |
| Kotlin error codes missing from TS union | A+B (already specified) |
| `allowCloudFallback` has no settings toggle | A |
| Ollama uses `kind: "cloud"` | A (privacy chrome, not a new stack) |
| Image Description artifact `1.0.0-beta1` | B |
| Document Scanner typically needs **no app CAMERA permission** | F |
| AppSearch `displayedBySystem` only affects PlatformStorage | C (LocalStorage v1) |
| No live lecture STT in current product (proposal 18 non-goal) | E is an **Android additive**; persist audio independently; do not break file-queue transcription |
| MediaPipe LLM Inference is **maintenance-only** | H uses LiteRT-LM |
| Google AI Edge SDK (`aicore`) is **deprecated** vs Prompt API | B must not migrate backward |
| CI does not run genai Gradle tests or the full AI vitest suite | Agent T |
| Keep genai / tts / folder-import **unmerged**; add speech/vision/nlp/search as siblings, not a mega-plugin | all native agents |

---

## 11. Independent review notes (planning swarm)

**Duplication:** Shared router already exists; A extends it. Smart Tagging, Ask Library, image registry, translation service, and `ai_learning` are reused, not copied. Speech/scan/nlp/search are new plugins to avoid mega-plugin merge wars.

**API accuracy:** Pins and maturity flags taken from official ML Kit/Android docs (2026-08-23) plus in-repo Gradle. Speech is **alpha**; structured output **alpha**; Play AI packs **beta**; AppSearch embeddings **alpha**. Implementation fleet must re-check Maven.

**Testability:** Fakes live in A; device eval stays out of default CI; Gradle JVM tests should be added to CI for plugin modules without Nano.

**Privacy:** LocalStorage + `displayedBySystem=false`; `allowCloudFallback` default false; containment unchanged; no content logs.

**Cross-platform:** No Apple OpenSpec exists; A’s interfaces are vendor-neutral.

**Merge safety:** A serializes `errors.ts` / provider types / settings mapping. Each native agent owns one plugin + one `lib.rs` line.

**Foreground:** GenAI (including Speech API as documented) is foreground-only; recording vs transcribe are split in E.

**Cost:** Language ID and FTS before LLM; specialized Summarization only for bullets; Image Description for short alt text.

---

## 10. Product principles encoded in specs

- Users pick **actions** (Summarize, Generate cards, Scan, Transcribe, Ask my library, Translate), not APIs.
- Cheapest sufficient tool: language ID ≠ LLM; FTS ≠ embeddings ≠ generation.
- On-device means on-device; cloud retry is explicit.
- Native AI is optional; import/read/review never depend on it.
- No `AndroidFlashcard` / `AndroidTranscript` domain types.
