## Why

The first Android Gemini Nano change proves that Incrementum can summarize text and generate flashcards privately on-device, but the bridge exposes only a narrow string-in/string-out subset of ML Kit and only a few app surfaces use it. Expanding the bridge and routing short, focused study tasks through it will make Android's AI experience substantially more useful offline without trying to replace cloud models for long-document or whole-library work.

## What Changes

- Replace the single combined availability result with per-capability status for prompt, summarization, and image input so one missing adapter does not disable unrelated on-device features.
- Expose Prompt API runtime metadata and controls: base model name, actual token limit/counting, finish reason, output-token limit, temperature/seed, warm-up, streaming, and cancellation of an in-flight native future.
- Add action-aware routing so each UI action requests the capability it needs and retains the existing cloud fallback when that capability is unavailable or fails.
- Add local passage Q&A and explanation for selected text, selected sections, and bounded document context; keep whole-library RAG and web-grounded questions on their existing paths.
- Complete on-device coverage for Extract Inbox key points/questions, RSS/article summaries, import-time tag suggestions, and short review-time hints or alternate explanations.
- Add single-image Prompt input for image descriptions, image-derived study cards, searchable image metadata, and experimental image-occlusion suggestions with review-before-save semantics.
- Improve generated-card reliability by honoring the user's Studio instruction, using native token accounting, deduplicating cross-chunk results, recording finish reasons/model identity, and using structured output when the device/toolchain supports it with the existing tolerant parser as fallback.
- Add an app-specific Gemini Nano evaluation corpus and device diagnostics for factuality, card atomicity, parse success, duplicates, latency, cancellation, and behavior across Nano versions.
- Investigate and, if compatible, upgrade the Android Kotlin/ML Kit Prompt toolchain needed for newer Prompt capabilities such as structured output, system instructions, and multi-image requests.

## Capabilities

### New Capabilities

- `ondevice-study-assistant`: User-visible on-device passage Q&A, extract analysis, article summaries, tag suggestions, review assistance, action-aware routing, and cloud fallback behavior.
- `ondevice-image-study`: On-device image description, metadata, image-derived flashcards, and reviewable image-occlusion suggestions.

### Modified Capabilities

- `android-genai`: Extend the capability introduced by `add-android-ondevice-llm-bridge` with per-feature status, runtime metadata, native token accounting, configurable and streaming Prompt requests, real cancellation, multimodal input, richer error semantics, and structured-output negotiation.

## Impact

- **Prerequisite**: the active `add-android-ondevice-llm-bridge` change must be implemented and retained; this change extends rather than replaces its plugin and TypeScript SDK.
- **Android plugin**: `src-tauri/plugins/android-genai/` Kotlin, Rust request/response types, permissions, lifecycle, cancellation, and event streaming.
- **Frontend AI layer**: `src/lib/ai/` capability model, token budgeting, task adapters, provider routing, run state, parsing, deduplication, and diagnostics.
- **UI integrations**: Document Q&A/selection actions, Extract Inbox, RSS scroll summaries, import tag suggestions, review surfaces, Flashcard Studio, Image Registry, and image-occlusion composer.
- **Build dependencies**: likely ML Kit Prompt update plus Kotlin/KSP compatibility work; the existing signed release build and desktop compile gates remain mandatory.
- **Testing**: TypeScript/Rust unit tests, Android bridge tests where practical, deterministic evaluation fixtures, and manual supported-device verification.
- **Explicit non-goals**: whole-library on-device RAG or embeddings, long-document cloud replacement, web-grounded on-device answers, background/batch inference, speech recognition, and automatic saving of model-generated learning items or occlusion regions without review.
