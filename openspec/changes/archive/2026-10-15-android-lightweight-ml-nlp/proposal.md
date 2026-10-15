## Why

Language identification and translation should not spend Gemini Nano quota. ML Kit Language ID (~900 KB bundled) and on-device Translate models are the cheap tools. Plethora already has `languageTranslation` with `local | dedicated | ai` priority — Android should add a **local** adapter, not a new product. Entity extraction is optional and quality-gated.

## Existing behavior

- `src/lib/languageTranslation/` service/registry; no ML Kit adapter.
- No `identifyLanguage` capability.
- Smart Tagging tier 1 is statistical, not language-id-based.

## What Changes

- Plugin `plethora-android-nlp` (or module) with:
  - Language ID (`com.google.mlkit:language-id:17.0.6` bundled preferred).
  - Translate as `TranslationProvider` kind `local` (download per pair, Wi-Fi preference, delete models).
  - Entity extraction **off by default** until fixtures on academic prose pass.
- Import cheap tier calls language ID to set document language metadata for routing (summarization language, speech locale).
- Digital ink **non-goal for v1** (recorded as follow-up).

## Capabilities

### New Capabilities
- `android-lightweight-ml`: language ID, on-device translate adapter, optional entities.

## Non-goals

- LLM translation as default (already `ai` kind, last priority).
- Every bilingual-card workflow in v1 (infrastructure first; one “Translate selection” action).

## Dependencies

A; existing translation service. Smart tagging unchanged except it MAY read detected language.

## Expected ownership

**Agent G.** Does not own Prompt/AppSearch/speech.
