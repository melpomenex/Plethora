## Context

Incrementum's AI stack lives in `src-tauri/src/ai/` (provider enum: OpenAI, Anthropic, OpenRouter, Ollama) and is reached from the frontend through `src/api/ai.ts` (`summarize_content`, `generate_flashcards_from_extract`) and `src/utils/aiExtractUtils.ts`. All four providers are network-bound; two of them are also paid. The Android build is a standard Tauri v2 `gen/android` project (`compileSdk 36`, `minSdk 24`, Kotlin `jvmTarget 1.8`), currently with no custom native plugin.

ML Kit GenAI exposes Gemini Nano through AICore on qualifying devices. Its API surface is small: a `Summarizer` client and a `GenerativeModel`-style prompt client, both with an asynchronous `checkFeatureStatus()` that reports `AVAILABLE`, `DOWNLOADABLE`, `DOWNLOADING`, or `UNAVAILABLE`. Model weights are system-owned; the app ships only the Play Services client shim.

Constraints that shape the design:
- Context window is small (~1k–4k tokens) versus the 100k+ we implicitly assume for cloud calls.
- Inference is on-device and slow enough that a multi-chunk document summary takes tens of seconds.
- The feature only exists on a minority of Android devices; every call site must survive its absence.
- Desktop is the primary platform and must keep compiling and behaving exactly as today.

## Goals / Non-Goals

**Goals:**
- One bridge, three calls: availability, summarize, prompt — reachable from TypeScript with the same ergonomics as any other Tauri command.
- Zero impact on non-Android targets: stubs that compile everywhere and report "unavailable".
- On-device output lands in the existing `GeneratedFlashcard` / extract pipeline unchanged, so no downstream code learns a new shape.
- Explicit, typed error states (unsupported device, model downloadable, model downloading, inference failure) so the UI can say something true rather than "AI failed".

**Non-Goals:**
- Bundling or fine-tuning a model. AICore owns the weights.
- Streaming token output. First version returns whole strings.
- Embeddings / RAG on device — the existing embedding providers stay cloud-side.
- iOS (Apple Foundation Models) — same bridge shape would apply later, out of scope here.
- Replacing cloud providers. On-device is a preference, not a migration.

## Decisions

### 1. A dedicated Tauri plugin crate, not commands in the app crate

`src-tauri/plugins/android-genai/` holds a small Rust crate with `android/` Kotlin sources, registered from `lib.rs` via `.plugin(tauri_plugin_android_genai::init())`. Tauri v2's `#[tauri::mobile_entry_point]` / `PluginHandle::run_mobile_plugin` machinery expects the plugin layout, and the Kotlin sources need to be picked up by the Gradle plugin project rather than pasted into the generated `gen/android/app` sources.

*Alternative rejected*: raw JNI calls from `src-tauri/src/ai/`. It works, but we would hand-roll class loading, the JNI env, and coroutine bridging that the plugin macro already handles — and `gen/android` is partly generated, so hand-edited Kotlin there is at risk of being clobbered.

### 2. Availability is a first-class, cached, tri-state value

`isOnDeviceAiAvailable()` returns a struct, not a boolean: `{ status: 'available' | 'downloadable' | 'downloading' | 'unavailable', reason?: string }`. The UI needs to distinguish "your device can't" (hide the option) from "tap to download the model" (offer it) from "downloading, try later" (disable with an explanation). The result is cached in-process for the session; `downloading` is not cached.

*Alternative rejected*: boolean + throw on use. That collapses a downloadable model into a hard failure and makes first-run UX bad.

### 3. Chunking lives in TypeScript, not Kotlin

`chunkTextByTokens(text, maxTokens)` splits on paragraph then sentence boundaries with a ~4 chars/token heuristic and a configurable budget (default 3000 tokens, floor 1000). Summarization over multiple chunks is hierarchical: summarize each chunk, then summarize the concatenated chunk summaries if that still exceeds the budget. Flashcard generation runs per chunk and concatenates the parsed cards, capped at the requested count.

Keeping it in TS means it is unit-testable under Vitest with no emulator, and the same utility can later serve the cloud path where oversized extracts also cause trouble.

*Alternative rejected*: chunking in Kotlin. Untestable in CI, and duplicated for the prompt and summarize paths.

### 4. Prompt-based flashcard generation reuses the existing card contract

The prompt asks for line-oriented output (`Q: … / A: …`, and `CLOZE: …` for cloze candidates) rather than JSON. Nano-class models emit malformed JSON often enough that a line parser with a tolerant fallback is more reliable than `JSON.parse` plus repair. The parser (`parseGenerated.ts`) yields `GeneratedFlashcard[]` with `card_type` of `qa` or `cloze` and tags derived from the extract, discarding any line it cannot classify.

*Alternative rejected*: structured JSON output. Revisit if a future ML Kit release supports constrained decoding.

### 5. Provider selection: on-device is preferred on Android, never silently on desktop

A single resolver decides per call: if platform is Android **and** status is `available` **and** the user setting `ai.preferOnDevice` (default on) holds, use the bridge; otherwise use the existing cloud path. If the bridge throws mid-call, fall back to cloud when a provider is configured, and surface a toast noting the fallback. Where neither is available, AI-assisted controls stay hidden as they are today.

*Alternative rejected*: adding `OnDevice` to the Rust `LLMProviderType` enum. That enum feeds `AIProvider::chat_completion`, whose async HTTP shape doesn't match a JNI call that must run on the Android main-thread-adjacent executor, and it would force every desktop build to carry a variant that can never be constructed.

### 6. Gradle wiring

`gen/android/app/build.gradle.kts` gains `play-services-mlkit-genai-summarization` and `-prompt`. Because `gen/android` is regenerated by `tauri android init`, the dependency block change is documented in the tasks list and mirrored in the plugin's own `build.gradle.kts` so a regeneration only loses the app-level line. ProGuard keep rules for the ML Kit GenAI classes are added to the existing release `*.pro` fileTree.

## Risks / Trade-offs

- **`gen/android` is partly generated; hand edits can be lost on re-init** → keep every Kotlin source inside the plugin's `android/` directory, restrict `gen/android` edits to the dependency + ProGuard lines, and note them in `tasks.md` and the Android build docs.
- **Device fragmentation: ML Kit GenAI availability varies by OEM, region, and Play Services version** → never branch on device model; branch only on `checkFeatureStatus()`. Treat every non-`AVAILABLE` status as "no on-device AI right now".
- **Slow inference makes AI actions feel broken** → all bridge calls are cancellable from the UI, show per-chunk progress, and a summarize of N chunks reports `chunk i of N`.
- **Small context window silently truncates long extracts** → chunk before invoking, never pass raw text; the bridge rejects input above the budget rather than letting the native side truncate.
- **Quality gap versus frontier models** → on-device cards flow through the existing approval/quality-threshold path in `aiExtractUtils.ts`; `requireApproval` stays the recommended default when on-device is active.
- **APK size and Play Services dependency** → client shim only, no weights; guarded by an availability check so devices without Play Services degrade to cloud.
- **First use may trigger a multi-hundred-MB model download over the user's data** → `downloadable` never auto-downloads; download is user-initiated and reported.

## Migration Plan

No data migration. Rollout is additive and gated:
1. Land plugin + stubs; desktop CI proves cross-platform compilation is unaffected.
2. Land TS SDK with unit tests for chunking and parsing (no device needed).
3. Land UI gating behind a `preferOnDevice` setting defaulting to on for Android only.
Rollback is removing the plugin registration and the setting; the cloud path is untouched throughout.

## Open Questions

- ~~Should `summarizeText`'s `format` argument expose ML Kit's paragraph/bullet output types directly, or map onto Incrementum's existing `summaryLength` setting (short/medium/long)?~~ **Resolved during implementation.** ML Kit has no paragraph output type and no length parameter at all: `SummarizerOptions.OutputType` offers only `ONE_BULLET` / `TWO_BULLETS` / `THREE_BULLETS`. So `format: "bullets"` uses the Summarization API with `THREE_BULLETS`, and `format: "paragraph"` goes through the Prompt API with a prose-summary instruction. The existing `summaryLength` word budget is honoured on the cloud path only; the on-device path cannot honour it and does not pretend to.
- Do we want on-device Q&A in `DocumentQATab` in this change, or defer until latency is measured on real hardware? **Deferred**, as leaned. The bridge's `ondevice_ai_prompt` command is what Q&A would use, so adding it later is a call-site change, not a bridge change.
- **Per-chunk latency is still unmeasured** — it needs a Gemini Nano device (task 7.2). Record it here once measured; the chunk budget (3000 tokens) and the decision to show progress only above one chunk both assume a multi-second per-chunk cost.

## Corrections found during implementation

Three statements in this document turned out to be wrong against the real ML Kit GenAI artifacts, and the implementation follows the artifacts:

1. **Artifact coordinates.** `com.google.android.gms:play-services-mlkit-genai-summarization` / `-prompt` do not exist on Google's Maven repo. The real coordinates are `com.google.mlkit:genai-summarization:1.0.0-beta1` and `com.google.mlkit:genai-prompt:1.0.0-beta2`. `genai-prompt` is pinned below `beta3` because `beta3`/`beta4` carry Kotlin 2.3 metadata that this project's Kotlin 1.9.25 compiler cannot read.
2. **Gradle wiring (Decision 6).** The dependencies live only in the plugin's own `android/build.gradle.kts`, not in `gen/android/app/build.gradle.kts`. `implementation` in the plugin module already puts them in the APK, so the app-level copy was redundant — and removing it means the change makes **zero** hand edits to the generated tree, so nothing is lost on `tauri android init`. The ML Kit R8 keep rules moved to the plugin's `consumer-rules.pro` for the same reason.
3. **minSdk.** All three genai AARs declare `minSdkVersion 26`; the app is `minSdk 24`. Rather than raise the app's floor (dropping Android 7.x users for a feature they could never use — AICore does not exist before Android 8), the plugin manifest merges them with `tools:overrideLibrary`. This is safe because no ML Kit class is touched eagerly: the clients are built lazily inside `checkStatus`, whose `catch (e: Throwable)` covers the `NoClassDefFoundError` an API 24–25 device would raise and reports `device_unsupported` — the same answer that device would get anyway. **Raising `minSdk` to 26 remains the alternative if the override ever proves fragile.**

4. **Kotlin toolchain.** Every published `com.google.mlkit:genai-prompt` version (beta1–beta4) carries Kotlin **2.2+** metadata, which the project's Kotlin **1.9.25** Android compiler refuses to read — there is no `genai-prompt` version that avoids this. `gen/android/build.gradle.kts` therefore pins `kotlin-gradle-plugin` to **2.2.20**. This was an explicit user decision over the alternative of shipping summarization only (which would have removed on-device flashcard generation and prose summaries — most of the change's value). `android-tts` and `folder-import` both compile clean under 2.2.20. This is the change's one hand edit to the generated tree; see `docs/android-build-notes.md`.

A fifth item is a scope addition rather than a correction: a `downloadModel` / `ondevice_ai_download` command was added to the three specified in the task list, because task 6.1 requires a user-initiated download action and there was otherwise no way to start one.
