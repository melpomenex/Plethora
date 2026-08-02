## 1. Settings data model

- [x] 1.1 Extend `AIControlsSettings` in `src/stores/settingsStore.ts` with `flashcardCountMode: 'fixed' | 'auto'`, `flashcardFixedCount: number`, `flashcardAutoMin: number`, `flashcardAutoMax: number`
- [x] 1.2 Add default values for the new fields (seed `flashcardFixedCount` from the existing `cardsPerExtract` default; e.g. `flashcardCountMode: 'fixed'`, `flashcardAutoMin: 3`, `flashcardAutoMax: 25`)
- [x] 1.3 Add a migration step so existing users' persisted `cardsPerExtract` value seeds `flashcardFixedCount` on first load after upgrade, without changing observed behavior
- [x] 1.4 Keep or deprecate `cardsPerExtract` per design decision (mark deprecated in favor of `flashcardFixedCount`, update any remaining direct consumers)

## 2. Shared target resolver

- [x] 2.1 Implement `resolveFlashcardTarget(settings: AIControlsSettings, contentLength: number, override?: Partial<...>): { mode: 'fixed' | 'auto', count: number }` in a shared utils module (e.g. `src/utils/flashcardTarget.ts`)
- [x] 2.2 Implement the auto-mode heuristic: `clamp(round(contentLength / WORDS_PER_CARD), autoMin, autoMax)` with `WORDS_PER_CARD` as a tunable constant
- [x] 2.3 Add unit tests for the resolver covering: fixed mode, auto mode at min bound, auto mode at max bound, auto mode mid-range

## 3. Global settings UI

- [x] 3.1 Update `src/components/settings/AIProviderSettings.tsx` to replace/extend the `cardsPerExtract` control with a "Flashcard generation target" control: mode toggle (Fixed / Auto), fixed-count input, and min/max inputs for auto mode
- [x] 3.2 Add inline help text explaining what "Auto" does (scales with content size, bounded by min/max)
- [x] 3.3 Validate inputs (min ≤ max, positive integers, reasonable upper bound) with inline error messaging

## 4. Flashcard Studio session-local override

- [x] 4.1 Add session-local generation-target override state to the Flashcard Studio session model (defaults to the global setting when a session is created/reset)
- [x] 4.2 Add a compact control near the Studio's generation input showing the current effective mode/count and allowing the user to adjust it for the active session only
- [x] 4.3 Ensure "New session" resets the override to the current global default (per design's Open Question resolution)
- [x] 4.4 Persist the session override as part of existing session persistence (localStorage), consistent with `flashcard-studio-sessions` capability

## 5. Chat-based generation prompt wiring

- [x] 5.1 In `src/components/review/FlashcardStudioModal.tsx`, replace the hardcoded "Create 3-7 cards per request unless specified otherwise" line in `SYSTEM_PROMPT` with an interpolated instruction built from the resolved target (using `resolveFlashcardTarget` against the active context's content length)
- [x] 5.2 Ensure an explicit user-stated count in the chat message (e.g. "give me 20 cards") still takes precedence over the configured target for that generation
- [x] 5.3 Recompute the resolved target when the selected context (document/chapter/section/excerpt) changes, so auto mode reflects the newly selected content's size

## 6. Extract auto-generation wiring (frontend)

- [x] 6.1 Update `src/utils/aiExtractUtils.ts` to compute the target via `resolveFlashcardTarget` (using the extract's content length) instead of reading `cardsPerExtract` directly, and pass it as `FlashcardGenerationOptions.count`

## 7. Extract auto-generation wiring (backend)

- [x] 7.1 Update `src-tauri/src/commands/ai.rs::generate_flashcards_from_extract` to actually use the `options` parameter (rename from `_options`) instead of discarding it
- [x] 7.2 Add a `count: usize` parameter to `PromptBuilder::flashcard_from_extract` in `src-tauri/src/ai/prompts.rs`, replacing the hardcoded "Generate 1-3 high-quality flashcards" text with an interpolated count
- [x] 7.3 Update `FlashcardGenerationOptions::default()` in `src-tauri/src/ai/flashcard_generator.rs` if needed for consistency with the new default (align with frontend default rather than diverging at 5) — already matched (5), no change needed
- [x] 7.4 Add/update Rust tests covering that the requested count is reflected in the generated prompt text

## 8. Verification

- [x] 8.1 Manually test: Settings → AI, switch between Fixed and Auto modes, verify values persist — confirmed in-browser (vite dev mode) via localStorage inspection; toggling Fixed/Auto updates the UI (min/max inputs, help text) and persists `flashcardCountMode`/`flashcardFixedCount`/`flashcardAutoMin`/`flashcardAutoMax` in `incrementum-settings`
- [ ] 8.2 Manually test: generate flashcards in the Studio from a short excerpt vs. a long chapter with Auto mode enabled, confirm resulting card counts differ and stay within configured bounds — not run (requires a configured AI provider API key, unavailable in this environment); covered instead by `resolveFlashcardTarget` unit tests
- [ ] 8.3 Manually test: override the target in an active Studio session, confirm the global setting is unaffected, and confirm a new session resets to the global default — not run (requires a configured AI provider / live Studio session); logic covered by code review of session hydrate/flush/startFreshSession wiring
- [ ] 8.4 Manually test: extract auto-generation (non-chat path) respects the configured count end-to-end — not run (requires a configured AI provider); covered by the new Rust `test_generate_from_extract_respects_requested_count` test
- [x] 8.5 Run existing test suite (frontend + `cargo test`) to confirm no regressions — `vitest run`: 1804 passed, 1 skipped; `cargo test --lib`: 423 passed, 1 ignored
