## Context

Flashcard generation currently has three independent, inconsistent count controls:

1. **Flashcard Studio chat path** (`FlashcardStudioModal.tsx`, the primary UX): a free-text `SYSTEM_PROMPT` tells the LLM "Create 3-7 cards per request unless specified otherwise." No caller ever specifies otherwise, so the model settles near 7 regardless of content length. This bypasses every existing count-aware code path entirely.
2. **Extract auto-generation path** (`aiExtractUtils.ts` → `generateFlashcardsFromExtract` → `generate_flashcards_from_extract` Rust command): already threads a `settings.ai.aiControls.cardsPerExtract` value into a typed `FlashcardGenerationOptions.count`, but the Rust command signature accepts `_options` and never reads it — the count is silently discarded and a separate hardcoded "1-3 flashcards" instruction in `PromptBuilder::flashcard_from_extract` is used instead.
3. **Rust default** (`FlashcardGenerationOptions::default()`): `count: 5`, used only when no options are supplied at all.

None of these are exposed as a real, discoverable setting — `cardsPerExtract` exists in the settings store but has no visible effect on the dominant chat-based workflow, so users have no lever to pull.

## Goals / Non-Goals

**Goals:**
- Give the user one coherent, discoverable way to control flashcard count across both generation paths (chat-based Studio and extract auto-generation).
- Support "as many as needed" via a density/auto mode that scales with content size, in addition to a simple fixed count.
- Make the current value visible and adjustable from inside the Flashcard Studio session, not just a page the user has to remember exists in Settings.
- Fix the Rust-side bug where extract options are discarded.

**Non-Goals:**
- Building a general token-budget-aware pagination/chunking system for arbitrarily large documents (auto mode uses a simple heuristic, not a full content-analysis pipeline).
- Per-deck or per-document persisted overrides beyond the current session (session-local override + one global default is sufficient for this change).
- Changing the underlying LLM provider abstraction or model selection.

## Decisions

**1. Two generation modes: `fixed` and `auto`, not just a single number field.**
A single "number of cards" field can't satisfy both "always give me exactly 10" and "as many as needed for this chapter." Modeling it as a mode (`fixed` | `auto`) plus mode-specific parameters (`fixedCount`, or `autoMin`/`autoMax`/`density`) keeps each mode's semantics explicit rather than overloading one field with sentinel values (e.g., `0` meaning "auto").
Alternative considered: a single count field where a special value (e.g. -1) means "auto." Rejected — implicit sentinels are error-prone and not self-documenting in the UI or the settings JSON.

**2. Auto mode target = `clamp(round(contentLength / wordsPerCard), autoMin, autoMax)`.**
`contentLength` is the word count of the selected context (document/chapter/section/excerpt, whichever is active in the Studio's context selector). `wordsPerCard` is a fixed constant (~120 words/card, tunable later) rather than a user-exposed setting, to keep the UI simple — users control the *bounds* (`autoMin`/`autoMax`), not the density constant. This is a heuristic, not a guarantee the LLM will hit the number exactly (LLMs approximate), but it replaces "always ~7" with a number that visibly moves with input size.
Alternative considered: send the full auto-scaling logic to the model as a prompt instruction ("generate roughly 1 card per 100 words") and let it self-regulate without a computed number. Rejected as primary approach because it reintroduces the original bug (relying on the model to self-limit) — but the resolved numeric target is still additionally stated in the prompt as an instruction, giving the model both a concrete number and the reasoning.

**3. Settings live in both `AIControlsSettings` (global default) and Studio session state (working override).**
Extend `AIControlsSettings` in `settingsStore.ts` with `flashcardCountMode: 'fixed' | 'auto'`, `flashcardFixedCount: number`, `flashcardAutoMin: number`, `flashcardAutoMax: number`. These become the global default shown in `AIProviderSettings.tsx`, replacing the narrower `cardsPerExtract` field (migrated: existing `cardsPerExtract` value seeds `flashcardFixedCount` on first load). Each Flashcard Studio session additionally stores its own resolved override (defaulting to the global setting) so a user can bump the count up for one document without changing their global default — surfaced as a small control near the generation input in the Studio UI itself.
Alternative considered: global-only setting, no per-session override. Rejected — the proposal explicitly calls for adjusting it "while working" in the Studio, and per-session override is cheap given sessions already persist their own state (see `flashcard-studio-sessions` capability).

**4. Resolved count is computed client-side and interpolated into the prompt/options for both paths.**
A single shared resolver function (e.g. `resolveFlashcardTarget(settings, contentLength)`) computes the effective count and is used by (a) `FlashcardStudioModal.tsx` when building `SYSTEM_PROMPT`/user message text, and (b) `aiExtractUtils.ts` when building `FlashcardGenerationOptions.count` for the extract path. This guarantees both paths respect the same setting instead of drifting further apart.

**5. Fix the Rust extract command to use `options.count`.**
`generate_flashcards_from_extract` in `src-tauri/src/commands/ai.rs` currently ignores `_options`. `PromptBuilder::flashcard_from_extract` needs a `count: usize` parameter (replacing the hardcoded "1-3") so the already-correct frontend value actually reaches the model.

## Risks / Trade-offs

- **LLMs don't obey exact counts.** Even with an explicit number in the prompt, the model may over/under-shoot. → Mitigation: treat the resolved number as a target stated clearly in the prompt ("Generate approximately N cards..."), not a hard contract; no code-level enforcement is added in this change.
- **Auto-mode word-count heuristic is crude** (doesn't account for content density/complexity). → Mitigation: expose `autoMin`/`autoMax` so users can bound runaway estimates; document the constant as tunable, not perfect.
- **Migrating `cardsPerExtract` → `flashcardFixedCount`** could surprise existing users if defaults differ. → Mitigation: seed the new field directly from the old value during settings load so behavior is unchanged until the user actively changes the new setting.

## Open Questions

- Should the per-session Studio override persist across sessions for the *same document*, or always reset to the global default on a new session? (Default assumption for this change: always reset to global default; only the active session's live adjustment is remembered for that session.)
