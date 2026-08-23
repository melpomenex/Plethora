# Design: modernize Android Gemini Nano provider

## Architecture

`OnDeviceProvider` remains the only generative Android provider. Tasks already declare `requirement: "prompt" | "summarization" | "image-prompt"` and schemas. B implements routing **inside** `onDeviceAI.ts` / Kotlin, not in React.

```text
runTask(generateFlashcards)
  → OnDeviceProvider.generateStream(structured, schemaName)
  → Kotlin GenerateTypedContentRequest
  → existing CardCandidate / LearningMaterialProposal envelopes
  → GeneratedFlashcard / domain create APIs
```

## Native APIs

| Use | API | Why |
|---|---|---|
| Cards, cloze, tags, concepts, Q&A, explain, study summary | Prompt + structured (`@Generable` already in `GenAiSchemas.kt`) | Flexibility + existing schemas |
| Bullet article summary EN/JA/KO | GenAI Summarization | Specialized quality for 1–3 bullets |
| Short image alt/metadata | GenAI Image Description (add if coordinate stable) | Cheap, dedicated |
| Study image cards / occlusion suggestions | Prompt + image (already compiled) | Need custom schema |
| Proofreading / rewriting | **Do not use** | Chat-message APIs, not textbooks |

Official docs: https://developers.google.com/ml-kit/genai — Prompt vs specialized tradeoff table.

## API maturity

- Prompt: **beta** (`1.0.0-beta4` in-repo). Re-check Maven.
- Structured output: **alpha** (`genai-schema 1.0.0-alpha1`). Keep JSON repair forever.
- Summarization: **beta1** only published version historically.
- Image Description: feature-stable enough to call from apps; still AICore/Nano gated. If artifact is beta/alpha, gate with capability flag.
- System instructions: Nano **V3+** (`isSystemPromptAvailable`).
- Thinking mode (`isThinkingModeAvailable`): **do not enable** for structured study tasks (latency/quota). Optional later.

## Version requirements

- App `minSdk 24`; GenAI libraries 26 with existing `overrideLibrary`.
- Kotlin 2.2.21 / KSP 2.3.11 pins in generated Gradle — do not bump to 2.3+ without documenting another `gen/android` edit.
- Play / AICore required. Unlocked bootloader unsupported.

## Hardware

Runtime `checkFeatureStatus` only. Pixel 8-class and OEM Nano devices vary; **no hardcoded model list**.

## Capability detection

Keep `ondevice_ai_capabilities`. Add optional `imageDescription` feature state if the client is compiled. Map AICore bind/FEATURE_NOT_FOUND:

- Shortly after first boot / AICore reset → `downloading` / not-ready (retry), not unsupported.
- Persistent FEATURE_NOT_FOUND on unlocked bootloader after documented wait → `device_unsupported`.

## Provider integration

`OnDeviceProvider.getCapabilities()` must include mapping of new errors. `runAiAction` already prefers on-device when `preferOnDevice` and status available.

**GIVEN** Nano ready and policy prefers on-device **WHEN** flashcards requested **THEN** no OpenRouter call is initiated by the routing layer.

## TypeScript / native contracts

- Add omitted codes to `ON_DEVICE_AI_ERROR_CODES` **after A lands categories**: `busy`, `battery_quota_exceeded`, `background_use_blocked`, `safety_blocked`, `queue_full`, `image_too_large` (already), etc.
- Do not rename existing commands (`ondevice_ai_prompt`, …).
- Image Description: new command `ondevice_ai_describe_image` **or** fold into image-prompt with `outputMode: "alt-text"` — prefer a dedicated command so Prompt failures do not hide Description availability.

## Data model

Reuse `GeneratedFlashcard`, `SmartTaggingOutput`, `LibraryAnswer`, `LearningMaterialProposal`. Provenance `baseModelName`.

## UX

Existing `OnDeviceAiPanel` download/status. Quota/foreground: actionable toasts via `AIError` categories. No “Invoke Prompt API” copy.

## Privacy

All Prompt/Summarization/Description inference on-device via AICore. No content logs. Fallback only per A.

## Offline

Inference offline once AICore feature AVAILABLE. First-run config download may need network — status `downloadable`/`downloading`.

## Background

On `BACKGROUND_USE_BLOCKED`: fail the run, keep any user-visible streaming buffer as **incomplete**, persist nothing as accepted cards. Resume/restart when foregrounded if the user retries.

## Resources

Keep FIFO one-at-a-time. BUSY: existing 3 retries with jitter. Battery quota: **no** retry loop. Context: keep TS chunker; never send whole EPUB.

## Fallback

Per A. Unsupported Nano → other providers if configured; else hide generative actions.

## Cancellation

Existing requestId + `cancel(true)` on ListenableFuture. Must remain.

## Migration

No user data migration. EmbeddingGemma download path unchanged (H may later offer AI packs; B does not rip it out).

## Security

Validate prompt length, image MIME/size (already `invalid_image` / `image_too_large`). No filesystem paths from webview. System instruction stays static per task; user/document text in `wrapUntrustedBlock` only.

## Accessibility

Download and cancel already in settings/studio; map new errors to existing toast patterns with TalkBack-readable titles.

## Tests

- Kotlin: extend `CapabilityMappingTest` / `PromptContractTest` for every ErrorCode.
- TS: `onDeviceAI.test.ts` + `errors.test.ts` for new codes.
- Do **not** put live Nano quality in CI. Keep/extend `src/lib/ai/__fixtures__/eval/` as manual/device eval (injection document, short article concepts, history flashcards).
- Gradle: add `:plethora-android-genai:test` to CI in Agent T or this change if cheap on ubuntu without SDK flakiness — prefer a dedicated job using the plugin module only.

## Device matrix (B owns Nano rows)

Emulator (unsupported → platform path), Pixel with Nano, OEM with Nano if available, device without Nano, AICore not ready, quota, background, unlocked bootloader, offline after ready. Not every row is CI.

## Shared files

B may edit `onDeviceAI.ts` and plugin. `errors.ts` only to fill mappings A declared.
