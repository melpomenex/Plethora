## Why

Incrementum already runs Plethora Precision's five scheduling competitors and learns adaptive Arena weights, but the review UI collapses their work into one opaque interval and a dense transparency string. Users cannot see the competing futures or deliberately choose the next review time, while Plethora's comparable selector exposes the data through a visually noisy, desktop-only dialog that is difficult to understand and slow to operate.

## What Changes

- Add a user-selectable **Algorithm Arena** review mode for normal Plethora Precision flashcard / learning-item reviews in the Review tab. The default **Automatic** mode schedules Arena's weighted pick and advances immediately; **Show the Arena** inserts the post-grade choice step and does not schedule until the user confirms an interval.
- Introduce the **Memory Horizon**, a responsive, logarithmic time visualization that places Plethora Classic, Classic 15, Classic 19, Plethora Precision, and FSRS predictions on one readable timeline, highlights the weighted Arena recommendation, and always presents relative time plus an exact due date.
- Let the user select the weighted Arena recommendation, any individual algorithm prediction, or a bounded custom interval. The selected source and value remain unmistakable before confirmation.
- Preserve review speed: the Arena recommendation is preselected; Enter/Space confirms it; desktop number keys select competitors; mobile users tap or swipe through snap targets with large touch areas and haptic feedback.
- Morph the existing answer/rating area into the Arena in place instead of opening a disconnected modal. Keep the reviewed answer visible so the scheduling decision retains context.
- Add first-run guidance, contextual "why this interval" details, deterministic loading/error/retry states, reduced-motion behavior, and complete keyboard and screen-reader support.
- Add a non-mutating per-card Arena preview contract that returns all five post-grade candidates, adaptive weights, consensus interval/range, and safe selection bounds.
- Extend review submission so the backend validates and commits the chosen Arena candidate or custom interval atomically, records its provenance, and keeps Arena learning based on the observed recall result rather than on the user's chosen interval.
- Keep the feature strictly scoped to flashcards / learning items in normal Review-tab sessions when Plethora Precision Arena scheduling is active. Cram mode, reading-item review, non-Plethora Precision algorithms, and Pure Plethora Precision M4 mode retain their current direct scheduling behavior.
- Make the choice discoverable both in Plethora Precision Learning settings and beside the native review grades, with a persistent two-option control that clearly explains that all five models continue learning in either mode.

## Capabilities

### New Capabilities

- `algorithm-arena-interval-choice`: Post-grade multi-algorithm preview, Memory Horizon interaction, interval selection, validation, provenance, responsive behavior, accessibility, and failure handling.

### Modified Capabilities

- `flashcard-review-session`: Add an Arena decision phase between grading and committing/advancing for eligible Plethora Precision learning-item reviews while preserving existing behavior for all ineligible review modes.

## Impact

- **Frontend review flow:** `ReviewSession.tsx`, `RatingButtons.tsx`, `ReviewTransparencyPanel.tsx`, `reviewStore.ts`, mobile gesture handling, review feedback, and new Arena-focused components/hooks.
- **Frontend API/types:** `src/api/review.ts` gains typed per-card Arena preview and interval-selection payloads; browser/PWA command parity is required.
- **Rust scheduling/API:** `src-tauri/src/commands/review.rs` and the Plethora Precision ensemble expose scratch candidate outputs, validate a selection token/payload, apply the selected interval after the normal model-state update, and persist selection provenance.
- **Storage and sync:** review history gains Arena selection source, chosen interval, candidate snapshot/version, and decision time without changing how recall outcomes train Arena weights. Synced review events carry the same provenance.
- **State machine:** scheduled review submission changes from grade-and-advance to grade, preview, confirm, commit, then advance for eligible sessions. Undo operates on the committed result only.
- **Localization and accessibility:** new strings and announcements are required across the existing locale set; motion and haptics degrade cleanly when unsupported or disabled.
- **Dependencies:** builds on the existing Plethora Precision Algorithm Arena implementation and the active `fix-precision-activation` work; no new runtime UI library is required.
