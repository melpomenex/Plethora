## Why

The Android Gemini Nano bridge is **already shipped** (`plethora-android-genai`, Prompt beta4, Summarization beta1, structured output alpha, streaming, OCR, EmbeddingGemma). It is not a greenfield plugin. Remaining work is to finish the contract (TypeScript error mapping), keep APIs current without reckless rewrites, use specialized GenAI APIs only where they beat Prompt, and make quota/foreground/readiness first-class product states.

Users on compatible devices should get private summaries, tags, and cards with **no API key**, through the existing task layer.

## Existing behavior

- Plugin implements Prompt (text, optional image, structured `@Generable` envelopes matching `src/lib/ai/schemas`), Summarization, streaming, cancel, warmup, token counts, Latin OCR, LiteRT embeddings.
- Feature status: `available | downloadable | downloading | unavailable` per prompt/summarization/image-prompt.
- Kotlin maps BUSY / battery quota / background / safety; **TS `ON_DEVICE_AI_ERROR_CODES` omits them**.
- Cloud fallback is gated by `allowCloudFallback` (A unifies the helper).
- System instructions and structured output are capability-flagged.

## Repository evidence

- `src-tauri/plugins/plethora-android-genai/`
- `src/lib/ai/onDeviceAI.ts`, `providers/onDeviceProvider.ts`, `passageAI.ts`, `tasks/`
- `docs/android-build-notes.md` (Kotlin 2.2.21, KSP 2.3.11, Prompt beta4)
- OpenSpecs: `add-android-ondevice-llm-bridge` (foundation), `optimize-ondevice-gemini-nano` (latency), `expand-android-ondevice-ai-capabilities` (bridge expansion)

## What Changes

- Treat the three older Android GenAI OpenSpecs as **implemented baseline**. This change **modifies** `android-genai` only.
- Complete Kotlin→TS→`AIError` mapping for every `ErrorCode` in `AndroidGenAiPlugin.kt`.
- Re-verify Google Maven versions at implementation time; upgrade Prompt/schema only if the build matrix in `android-build-notes.md` still compiles all plugins + R8.
- Route tasks:
  - **Specialized Summarization** for 1–3 bullets when language is EN/JA/KO and the user asked for bullets.
  - **Prompt + existing structured schemas** for study summaries, flashcards, cloze, tags, concepts, classification, Q&A, Learn this.
  - **Image Description API** for short alt/search metadata when available; **Prompt multimodal** for study cards / occlusion suggestions (existing experimental flag).
  - **Do not** adopt Proofreading/Rewriting APIs for documents (wrong product shape).
- Distinguish `ProviderNotReady` (download/init) vs `UnsupportedDevice` (no AICore, unlocked bootloader persistent FEATURE_NOT_FOUND after init window).
- Honor foreground-only inference: map `BACKGROUND_USE_BLOCKED`; do not persist incomplete structured objects as success.
- Keep single-thread inference queue; bounded BUSY retries already in Kotlin.
- Do not move speech/scanner/AppSearch into this plugin.

## Capabilities

### Modified Capabilities
- `android-genai`: error-contract completion, specialized vs Prompt routing table, Image Description optional client, readiness vs unsupported, quota/foreground product behavior, version re-pin procedure.

## Impact

- Kotlin/Rust/TS of `plethora-android-genai` and `onDeviceAI.ts` / `errors.ts` mappings (error unions owned by A first).
- Optional new ML Kit Image Description dependency if Maven coordinate is stable at implementation time.
- Tests: Kotlin mapping, TS code table, no-cloud-when-policy-off.

## Non-goals

- Speech, Document Scanner, Language ID, Translate, AppSearch, LiteRT-LM generative packs.
- Replacing `runTask`.
- Bundling Gemini Nano weights.
- Background batch generation of large card sets.

## Dependencies

- **A** (`extend-ai-capability-architecture`) for new `AIErrorCategory` values.
- Must not regress `optimize-ondevice-gemini-nano`.

## Expected ownership

- **Agent B** owns `plethora-android-genai`, `onDeviceAI.ts`, `onDeviceProvider.ts`, `docs/android-build-notes.md`.
- Does not own AppSearch, OCR scanner UI, speech, or `libraryTask` prompts.
