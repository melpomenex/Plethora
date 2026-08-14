## Why

Every AI feature in Incrementum (summaries, key points, flashcard/cloze generation, Q&A) currently requires a cloud provider key — OpenAI, Anthropic, OpenRouter, or a self-hosted Ollama endpoint. On Android that means no AI at all for users who are offline, unwilling to send reading material to a third party, or unwilling to pay per token. Supported devices (Pixel 8+, Galaxy S24+ and similar) already ship Gemini Nano through the system AICore service, so a local, free, private inference path exists on the device and we simply do not expose it.

## What Changes

- Add a Tauri v2 Android plugin (Kotlin) backed by ML Kit GenAI (`play-services-mlkit-genai-summarization` / `-prompt`), exposing three native calls: a capability/availability check, `summarizeText(text, format)`, and `generatePrompt(prompt)`.
- Add a Rust plugin boundary in `src-tauri` that registers the Android plugin and exposes type-safe commands; non-Android targets compile against stubs that report the capability as unavailable, so desktop builds are unaffected.
- Add a frontend `onDeviceAI` service under `src/lib/ai/` with `isOnDeviceAiAvailable()`, `summarize()`, and `generateFlashcards()`, plus a `chunkTextByTokens` utility that keeps each invocation inside Nano's small context window and merges per-chunk results.
- Parse model output into the existing `GeneratedFlashcard` shape (question, answer, card_type, tags) so on-device results flow through the same extract/pending-card pipeline as cloud results.
- Route existing AI entry points (extract auto-generation, summarization, flashcard studio) through a capability check that prefers on-device inference on Android when available and falls back to the configured cloud provider otherwise; AI-assisted buttons stay hidden only when neither path is available.
- Android build changes: new Gradle dependencies, ProGuard keep rules, and an AICore/Play Services availability guard. No breaking changes to existing cloud provider behaviour.

## Capabilities

### New Capabilities
- `android-genai`: capability detection for on-device generative AI, text summarization, free-form prompt generation, context-window chunking, and error/fallback semantics across the Kotlin → Rust → TypeScript bridge.

### Modified Capabilities
<!-- None: existing specs describe review, queue, and import behaviour; no current spec states requirements about which AI provider serves summaries or flashcards. -->

## Impact

- **New code**: `src-tauri/plugins/android-genai/` (Rust plugin crate + `android/` Kotlin source set), `src/lib/ai/onDeviceAI.ts`, `src/lib/ai/chunkTextByTokens.ts`, `src/lib/ai/parseGenerated.ts`.
- **Modified code**: `src-tauri/src/lib.rs` (plugin registration), `src-tauri/Cargo.toml`, `src-tauri/gen/android/app/build.gradle.kts` (dependencies, ProGuard), `src/api/ai.ts` and `src/utils/aiExtractUtils.ts` (provider selection), AI-related UI surfaces that gate on availability.
- **Dependencies**: `com.google.mlkit:genai-summarization:1.0.0-beta1`, `com.google.mlkit:genai-prompt:1.0.0-beta2` (Play Services–delivered; adds a few hundred KB to the APK, the model itself is system-provided and not bundled). The `com.google.android.gms:play-services-mlkit-genai-*` coordinates named during planning do not exist — see design.md, "Corrections found during implementation".
- **Runtime characteristics**: on-device inference is slower per token than a hosted frontier model and limited to roughly a 1k–4k token window, so long documents are chunked and summaries are hierarchical; first use on a device may block on an AICore model download.
- **Platform reach**: feature is Android-only and device-gated. Desktop, iOS, and unsupported Android devices are unchanged and keep using cloud providers.
