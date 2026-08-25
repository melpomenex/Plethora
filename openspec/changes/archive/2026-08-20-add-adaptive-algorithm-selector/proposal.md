## Why

Incrementum has implementations of multiple spaced repetition algorithms (FSRS-6, Plethora Classic/5/8/15, Incremental, Engaging) but the UI only exposes FSRS-5 and Plethora Classic as options, and the backend ignores the selection entirely -- flashcards always use FSRS-6. Users cannot choose Plethora Adaptive, the latest Plethora scheduler algorithm, or any of the other implemented algorithms. We need to (1) implement Plethora Adaptive in the Rust backend and (2) wire the UI so users can actually select between algorithms.

## What Changes

- Implement the Plethora Adaptive algorithm in Rust, porting from the reverse-engineered Python reference at [melpomenex/adaptive-scheduler-re](https://github.com/melpomenex/adaptive-scheduler-re).
- Update the settings type to support all implemented algorithms as a discriminated union.
- Add a Tauri command for Plethora Adaptive reviews with proper state persistence.
- Update the Learning Settings UI with an algorithm selector dropdown that shows all available algorithms with descriptions.
- Wire the backend review path to dispatch to the selected algorithm instead of hardcoding FSRS-6.
- Ensure consistent behavior across Tauri desktop app and Web App / PWA.

## Capabilities

### New Capabilities
- `adaptive-algorithm`: Plethora Adaptive spaced repetition algorithm implementation ported from the adaptive-scheduler-re reference.

### Modified Capabilities
- `document-rating`: The existing spec's rescheduling requirement must be updated to note that the algorithm used is configurable, not always FSRS.

## Impact

- **Backend**: New module `src-tauri/src/algorithms/adaptive.rs`, modified `algorithms/mod.rs`, modified `commands/review.rs` to dispatch based on algorithm selection.
- **Frontend**: Updated `settingsStore.ts` (`LearningSettings.algorithm` type), updated `SettingsPage.tsx` algorithm dropdown, updated `reviewStore.ts` to pass algorithm context to review commands.
- **Database**: Plethora Adaptive state (stability, difficulty, lapses, grade-R mapping) can reuse existing `memory_state_stability` and `memory_state_difficulty` columns on `learning_items`, plus a new `algorithm_state` JSON column for Plethora Adaptive-specific fields.
- **Web App**: Algorithm selection persisted in localStorage via settings store; server-side dispatch routes to the same algorithm implementations.
