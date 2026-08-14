## 1. Android build wiring

> **Toolchain note.** Every published `com.google.mlkit:genai-prompt` version (beta1–beta4) carries Kotlin **2.2+** metadata, which the project's Kotlin **1.9.25** Android compiler cannot read. `gen/android/build.gradle.kts` now pins `kotlin-gradle-plugin` to **2.2.20** (user-approved). `android-tts` and `folder-import` compile clean under it. This is the change's only hand edit to the generated tree.

- [x] 1.1 Add the ML Kit GenAI dependencies — **two corrections**: (a) `com.google.android.gms:play-services-mlkit-genai-*` does not exist; the real coordinates are `com.google.mlkit:genai-summarization:1.0.0-beta1` and `com.google.mlkit:genai-prompt:1.0.0-beta2` (beta3+ carries Kotlin 2.3 metadata; beta2 needs 2.2 — see the toolchain note above). (b) They live in the plugin's `android/build.gradle.kts`, **not** `gen/android/app/build.gradle.kts` — `implementation` in the plugin module already reaches the APK, so the generated tree needs no hand edit at all.
- [x] 1.2 ProGuard keep rules for `com.google.mlkit.genai.**` — placed in the plugin's `consumer-rules.pro` (shipped to the app's R8 pass) rather than under `gen/android/app/`, for the same regeneration-safety reason
- [x] 1.3 Android build verified — `npm run tauri:android:build` produces a signed **release** APK (72 MB). The release path means R8 ran with the plugin's keep rules; `AndroidGenAiPlugin` survives minification unrenamed and the merged manifest keeps `minSdkVersion=24` while carrying the AAR's `aicore BIND_SERVICE` permission and `<queries>` entry. (Run as a full build rather than the specified pre-Kotlin `--debug` pass: the pre-Kotlin run is what surfaced the minSdk 26 conflict, and the fix lives in the plugin, so only the full build proves it.)
- [x] 1.4 Record the `gen/android` edits in the Android build notes — `docs/android-build-notes.md`, covering the Kotlin 2.2.20 pin (the only edit this change makes there) alongside the pre-existing `ndkVersion` pin

## 2. Kotlin plugin

- [x] 2.1 Scaffold `src-tauri/plugins/android-genai/` with `Cargo.toml`, `build.rs`, `android/build.gradle.kts`, and the Kotlin source set
- [x] 2.2 Implement `GenAiPlugin : Plugin(activity)` with `@TauriPlugin` and shared lazily-created ML Kit summarizer and prompt clients
- [x] 2.3 Implement `@Command checkStatus(invoke)` mapping ML Kit `checkFeatureStatus()` to `available` / `downloadable` / `downloading` / `unavailable` plus a reason string; never throw
- [x] 2.4 Implement `@Command summarizeText(text, format)` bridging the ML Kit Summarization API, mapping `format` to paragraph vs bullet output
- [x] 2.5 Implement `@Command generatePrompt(prompt)` bridging the ML Kit Prompt API
- [x] 2.6 Map native failures (`MODEL_UNAVAILABLE`, unsupported hardware, download pending, inference error) to typed error codes returned via `invoke.reject(code, message)`
- [x] 2.7 Ensure clients are released on plugin teardown and that concurrent calls do not share a mutable in-flight session

## 3. Rust plugin boundary

- [x] 3.1 Define shared request/response types (`GenAiStatus`, `SummarizeRequest`, `PromptRequest`) with serde derives in the plugin crate
- [x] 3.2 Implement the `#[cfg(target_os = "android")]` path: register the plugin via `tauri::plugin::Builder` and call through `PluginHandle::run_mobile_plugin`
- [x] 3.3 Implement the non-Android stub returning `status: unavailable, reason: platform_unsupported` for the check and a typed error for summarize/prompt
- [x] 3.4 Expose `ondevice_ai_status`, `ondevice_ai_summarize`, `ondevice_ai_prompt` — plus `ondevice_ai_download`, added because task 6.1 requires a user-initiated download action and there was otherwise no way to start one
- [x] 3.5 Add the plugin to `src-tauri/Cargo.toml` and register it in `src-tauri/src/lib.rs`
- [x] 3.6 Add capability/permission entries so the frontend is allowed to invoke the new commands
- [x] 3.7 `cargo check` passes for desktop; the plugin cross-compiles for `aarch64-linux-android` (release `.so` produced and packaged into the APK)

## 4. TypeScript SDK

- [x] 4.1 Create `src/lib/ai/chunkTextByTokens.ts` — paragraph → sentence → hard character split, configurable budget (default 3000 tokens, floor 1000), ~4 chars/token estimate
- [x] 4.2 Create `src/lib/ai/parseGenerated.ts` — parse `Q:`/`A:`/`CLOZE:` line output into `GeneratedFlashcard[]`, discarding unclassifiable lines
- [x] 4.3 Create `src/lib/ai/onDeviceAI.ts` with `isOnDeviceAiAvailable()` (session-cached except while `downloading`), `summarize(text, opts)`, `generateFlashcards(text, opts)`
- [x] 4.4 Implement hierarchical multi-chunk summarization and per-chunk flashcard generation capped at the requested count
- [x] 4.5 Add Vitest coverage for chunking (boundaries, oversized sentence, budget floor) and parsing (well-formed, mixed, unusable output)
- [x] 4.6 Add Vitest coverage for the availability cache and for `platform_unsupported` on non-Tauri/non-Android

## 5. Integration and fallback

- [x] 5.1 Add an `ai.preferOnDevice` setting (default on, Android-only effect) to `settingsStore`
- [x] 5.2 Add a provider resolver that picks on-device vs cloud per call per the design's selection rules
- [x] 5.3 Route `handleAutoSummarization` and `handleAutoGeneration` in `src/utils/aiExtractUtils.ts` through the resolver
- [x] 5.4 Implement mid-call fallback to the configured cloud provider plus a toast noting the fallback
- [x] 5.5 Gate AI-assisted UI controls on "on-device available OR cloud provider configured"

## 6. UI surfacing

- [x] 6.1 Show on-device status in AI provider settings, including a user-initiated download action when status is `downloadable` — verified live on a Pixel 9 Pro XL: status read `downloadable`, the download completed, and the panel flipped to `available`/Ready
- [x] 6.2 Show `chunk i of N` progress and a cancel control for multi-chunk on-device runs
- [x] 6.6 Fix the Flashcard Studio closing when you tap its text box on Android (user-reported). Both backdrops used `onClick={onClose}`, which fires whenever the click *resolves* over the backdrop — tapping a textarea opens the soft keyboard, the layout reflows, and the backdrop slides under the finger before the click completes. Replaced with `useBackdropDismiss`, which also requires the press to have *started* on the backdrop. Covers the card-edit lightbox too, which `autoEditDraft: true` opens directly. Regression test: `__tests__/backdropDismiss.test.tsx`. **Pre-existing bug, not introduced by this change** — it affected every provider, but on-device made it easy to hit because that flow is what put a phone user in the studio with no cloud key.
- [x] 6.5 Hide the studio's token/cost estimator when the on-device provider is selected — found during the Pixel 9 Pro XL test, where it read "1 tokens · Est. cost: ~ $0.02". On-device inference is free, and the estimator measures the cloud payload rather than what the chunker sends per invocation, so both halves were wrong.
- [x] 6.4 Add on-device as a selectable provider in the AI Flashcard Studio (added after review: the studio is the primary generation surface and was previously cloud-only). Mirrors the existing NotebookLM sentinel-provider pattern — `ON_DEVICE_PROVIDER_ID`, its own `handleSend` branch, exempt from the cloud-provider gate. Bypasses `chatWithContext`/`parseCardsFromResponse` because Nano's window is ~3k tokens and its JSON is unreliable; uses the chunking SDK and line parser instead.
- [x] 6.3 Label on-device results — implemented as an `on-device` tag on every card the on-device path produces (`ON_DEVICE_TAG` in `aiExtractUtils.ts`), which flows anywhere card tags render. `pendingFlashcardsStore` currently has no UI reading it, so there is no pending-cards surface to badge.

## 7. Verification

- [x] 7.1 Vitest: 2813 passed / 1 skipped / 0 failed (55 new). `cargo test --lib`: 590 passed, 0 failed. Plugin crate: 4 passed. `tsc --noEmit` clean.
- [ ] 7.2 (partly done) On a Pixel 9 Pro XL: status `downloadable` → download → `available` **verified**. Flashcard generation **verified to run**: the Flashcard Studio reported "Generated 5 card(s) on-device with Gemini Nano" from *Tiny Habits* (BJ Fogg), which proves Nano emitted `Q:`/`A:`/`CLOZE:` lines that `parseGeneratedFlashcards` classified — the load-bearing untested assumption. **Card text and quality were NOT captured**: opening the studio via the reader's context-menu "Create Flashcard…" carries `resetDraftCards: true`, which wiped the drafts. Re-run and inspect the drafts without going through that entry point. Summarization and per-chunk latency still unmeasured.
- [ ] 7.3 **BLOCKED — needs hardware.** Manual test on an unsupported Android device: controls fall back to cloud, no crash, no bogus error
- [x] 7.4 macOS desktop verified — `npm run tauri:dev` builds and launches: migrations apply, webview ready, AI keys load from keychain, no panic and no ACL error from the new plugin registration. Desktop AI behaviour is unchanged by construction: `isOnDeviceAiSupportedPlatform()` is false off Android, so the resolver goes straight to the existing cloud path without a bridge call.
- [ ] 7.5 (partly done) Design-doc open questions updated: summarize `format` resolved (ML Kit has bullets-only output and no length parameter), on-device Q&A deferred as leaned. Per-chunk latency still needs a device (blocked on 7.2).
