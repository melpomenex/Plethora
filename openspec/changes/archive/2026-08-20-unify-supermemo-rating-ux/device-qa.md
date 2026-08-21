# Device QA — unify-supermemo-rating-ux

Date: 2026-08-17 · Environment: macOS (darwin 25.5.0 arm64), npm vitest jsdom

## Automated verification (this session)

| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| `vitest run` (full suite) | 3459 passed, 1 skipped, 0 failed |
| New: `src/lib/__tests__/supermemo-grades.test.ts` | schema for all 7 algorithms; grade↔rating equivalence; advisory map |
| New: `src/hooks/__tests__/useRatingJoystick.test.tsx` | first-ever hook tests: all 6 H-zones commit (rating, grade), dead-zone/tap no-commit, seam (dy=0) → pass row, zone-crossing updates, enabled-gate blocks, JOYSTICK_GRADES lockstep |
| New: `src/components/review/__tests__/SuperMemoRatingControl.matrix.test.tsx` | control matrix (desktop buttons / touch joystick+buttons via shared touch area), Queue flashcard matrix (sm18/sm20 → six grades after reveal; fsrs → four), Queue overlay matrix (superMemoGrades → six buttons; four-grade keeps orbs), per-grade pipeline Queue ≡ Review for grades 0–5 (exact `grade`, equivalent `rating`, no 4-grade collapse) |
| Extended: `queueScrollKeyboard.test.ts` | keys 0–5 under SuperMemo (grade + equivalent rating), reveal-first still enforced, in-flight guard, four-grade 1–4 unchanged |
| `npm run bench:check` | OK — 21 benchmarks, all PASS except pre-existing stale-baseline WARN on `tabs-dom/mount-12-tab-workspace` (0.57×, an improvement; unrelated to rating paths). No rating-path benchmark exists, so `scripts/perf-baselines.json` unchanged |

## Implementation notes affecting QA expectations

- **Grade channel**: only `submitReview` (flashcard items) has a backend native-grade path (`submit_review` accepts `grade` and bypasses `rating_to_grade`). Queue flashcards now pass the exact 0–5 grade; the legacy 1–4 `rating` is still populated.
- **Documents/extracts are four-grade, always**: documents are scheduled by the FSRS-6 engagement scheduler and extracts by their own FSRS-based scheduler regardless of the flashcard algorithm — so the Queue overlay keeps the four-orb rail (Again/Hard/Good/Easy) and plain 1–4 rating keys for them even under SM-18/SM-20. The SuperMemo 0–5 UI (buttons, joystick, keys) applies **only to flashcards**, which are the sole SM-scheduled queue item. `usesNativeGradeKeys(itemType, algorithm)` in `queueScrollKeyboard.ts` encodes this rule and is unit-tested; overlay rendering is pinned by `SuperMemoRatingControl.matrix.test.tsx` ("documents keep the four-orb rail…").
- **Queue joystick**: enabled on touch + SuperMemo schema for flashcards, bound to the full card area, gated on answer-revealed (mirrors Review). Reuses the shared `SuperMemoRatingControl`; no Queue-specific copy.
- **Zen mode**: desktop unchanged (keyboard-only); touch SM gets the joystick via the shared control with `showButtons=false`.
- The mobile bottom bar in `ScrollOverlayControls` is compile-time disabled (`false &&`) — no fallback change needed.

## Manual device QA — pending (5.1–5.3)

Not yet performed on physical hardware. Checklist for the device pass:

- [ ] Android SM-18 Queue: joystick present, all six positions submit expected grades; compare with Review side-by-side; drag/tap/release, accidental movement, portrait/landscape, small screens.
- [ ] Android SM-20 Queue: same as above.
- [ ] Desktop SM-18/SM-20 Queue + Review: six buttons, consistent labels/shortcuts/tooltips; keyboard 0–5 works in both views.
- [ ] FSRS Queue + Review: four-rating UI on both platforms; submissions unchanged.
