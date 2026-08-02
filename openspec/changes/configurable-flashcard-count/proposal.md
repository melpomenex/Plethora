## Why

AI Flashcard Studio's chat-based generation always produces around 7 cards regardless of document or section size, because the system prompt hardcodes "Create 3-7 cards per request unless specified otherwise" and nothing in the UI ever specifies a count. Users generating from a long chapter get the same handful of cards as users generating from a short paragraph, forcing repeated manual re-prompts. There is no way to configure how many cards should be generated, either as a fixed target or as a size-driven target ("as many as needed").

## What Changes

- Add a user-facing "Flashcard generation target" setting to AI settings, with two modes:
  - **Fixed count**: always request N cards per generation.
  - **Auto / density-based**: scale the requested count with the size of the selected context (document, chapter, section, or excerpt), with a configurable min/max range, so short excerpts yield fewer cards and long chapters yield more.
- Surface this setting inside the Flashcard Studio itself (not just buried in a global settings page) so the user can see and adjust the current generation target while working, plus a global default in Settings → AI.
- Wire the resolved target count into the Flashcard Studio chat `SYSTEM_PROMPT`/user message construction (`FlashcardStudioModal.tsx`), replacing the hardcoded "3-7 cards" instruction with an interpolated instruction derived from the setting.
- Fix the extract-based auto-generation path (`generate_flashcards_from_extract` in `src-tauri/src/commands/ai.rs`) so the `FlashcardGenerationOptions.count` parameter it already receives is actually threaded into prompt construction instead of being discarded, and route it through the same resolved-target logic instead of the separate hardcoded "1-3" prompt in `PromptBuilder::flashcard_from_extract`.
- Extend `AIControlsSettings` (in `src/stores/settingsStore.ts`) with the new generation-target fields, replacing/superseding the narrower existing `cardsPerExtract` field.

## Capabilities

### New Capabilities
- `flashcard-generation-count-control`: User-configurable control (fixed or auto/density-based) over how many flashcards the AI Flashcard Studio and extract auto-generation produce per request, including where the setting lives in the UI and how it's resolved into the LLM prompt/backend options.

### Modified Capabilities
- (none — no existing spec currently documents flashcard generation count behavior)

## Impact

- Frontend: `src/components/review/FlashcardStudioModal.tsx` (SYSTEM_PROMPT and chat message construction), `src/components/settings/AIProviderSettings.tsx` (settings UI), `src/stores/settingsStore.ts` (`AIControlsSettings` shape and defaults), `src/utils/aiExtractUtils.ts` (consumer of the setting).
- Backend: `src-tauri/src/commands/ai.rs` (`generate_flashcards_from_extract` must use `_options`), `src-tauri/src/ai/prompts.rs` (`PromptBuilder::flashcard_from_extract` needs a count parameter), `src-tauri/src/ai/flashcard_generator.rs` (default options).
- No breaking changes to persisted data; `cardsPerExtract` setting is migrated/superseded by the new fields with a sensible default so existing users see no behavior regression.
