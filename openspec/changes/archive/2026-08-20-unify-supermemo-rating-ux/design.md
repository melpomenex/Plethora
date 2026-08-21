## Context

Investigation of the current codebase (paths under `src/` and `src-tauri/`):

- **Queue rating UI**: `src/components/queue/ScrollOverlayControls.tsx` renders four rating orbs (Again/Hard/Good/Easy → `onRate(1..4)`, lines ~648–693) plus a mobile bottom-bar button (~944–977). `src/pages/QueueScrollPage.tsx` `handleRating(rating: number)` (~3184) submits ratings 1–4; keyboard 1–4 via `resolveScrollRatingKey` (~2992). Queue never surfaces or passes a SuperMemo `grade`, so under SM-18/SM-20 the backend remaps via `rating_to_grade` — a silent 4→6 collapse.
- **Review rating UI**: desktop six-button UI is `src/components/review/RatingButtons.tsx` (`GRADE_BUTTONS` ~34–90; grade↔rating equivalence 0/1/2→1, 3→2, 4→3, 5→4; keys 0–5). Mobile joystick is `src/hooks/useRatingJoystick.ts` (H-grid, `JOYSTICK_GRADES` ~55–64, dead-zone 24px, haptic detents) + presentational `src/components/review/RatingJoystick.tsx`. Both are already shared between `ReviewSession.tsx` and `ZenReviewMode.tsx`.
- **Algorithm detection**: `useNativeGrades` selector in `ReviewSession.tsx` (~194–198) hard-codes `sm20 || sm18`. Settings store: `src/stores/settingsStore.ts` (`algorithm: "fsrs"|"sm2"|"sm5"|"sm8"|"sm15"|"sm18"|"sm20"`).
- **Platform detection**: established abstractions — `isNativeMobile()`/`getFormFactor()` in `src/lib/tauri.ts`, `useFormFactor()`/`useIsNativeMobile()` in `src/hooks/useFormFactor.ts`. Review already uses `formFactor`/`isTouch`.
- **Submission pipeline**: `src/api/review.ts` `submitReview` → backend `submit_review` (`src-tauri/src/commands/review.rs` ~312–346) already accepts an optional `grade` and bypasses `rating_to_grade` when present (native-grade path ~356–370). Persistence: `review_log` table stores `rating`; no schema change needed.
- **Duplication**: the grade↔rating mapping exists in `GRADE_BUTTONS`, `JOYSTICK_GRADES` (comment: "kept in lockstep"), the `ReviewSession` keyboard handler (~668), and twice in the backend.

## Goals / Non-Goals

**Goals:**
- Queue presents the algorithm's native rating schema: six SuperMemo grades (desktop buttons / mobile joystick) for SM-18/SM-20; four ratings otherwise.
- Exact 0–5 grade reaches the scheduler from Queue, same as Review.
- Single source of truth for rating schema, grade labels, colors, and grade↔rating mapping.
- Zero user-visible regression in Review; no Queue workflow regression.
- Future six-grade schedulers require only schema registration.

**Non-Goals:**
- Modifying SM-18/SM-20 algorithms, interval math, or grade semantics.
- Redesigning Review's screens or replacing the joystick with buttons (or vice versa).
- Changing DB/sync schemas or adding migrations.
- Converting four-grade algorithms to six grades.
- Touch/desktop parity of the *widget* — presentation stays platform-appropriate.

## Decisions

### D1: Rating schema as a frontend pure function, not backend metadata
Add `getRatingSchema(algorithm): RatingSchema` in `src/api/review.ts` (or a small `src/lib/rating-schema.ts`) with `RatingSchema = { type: "supermemo" | "four-grade", grades: number[] }`, plus a `useRatingSchema()` hook over the settings store. Backend `AlgorithmType` already exists, but the schema is a pure UI-presentation concern and the whole render path is frontend; a Rust round-trip adds IPC surface with no benefit today.
*Alternative considered*: expose capabilities from the Rust scheduler registry — rejected for now; if backend-derived capabilities arrive later, `getRatingSchema` is the single swap point.

### D2: One shared `SuperMemoRatingControl` wrapper, platform renderers underneath
Create a shared control (e.g. `src/components/review/SuperMemoRatingControl.tsx`) that takes the schema + `onSelect(grade, rating)` and renders `RatingButtons gradeScale` on non-touch form factors, and wires `useRatingJoystick`/`RatingJoystick` on touch — mirroring the existing `useJoystick = useNativeGrades && isTouch` logic in `ReviewSession`. Queue and Review both consume it. The joystick hook + overlay stay as-is (they are already shared components); only orchestration is centralized.
*Alternative*: render the decision inside each view — rejected; that reproduces the duplication this change removes.

### D3: Consolidate grade↔rating mapping into one module
Move `GRADE_BUTTONS`, `SUGGESTED_GRADE_BY_RATING`, `JOYSTICK_GRADES`, the keyboard mapping, and `SM20NativeGrade`/`RATING_LABELS`/`RATING_COLORS` into a single module (e.g. `src/lib/supermemo-grades.ts`); `RatingButtons`, `useRatingJoystick`, `ReviewSession`, `ZenReviewMode`, and the new control import from it. Backend mappings stay in Rust (they're the scheduler's concern; frontend mapping is only for label/color/equivalence display and the legacy `rating` field).

### D4: Queue submission uses the existing `grade` channel
Queue's `handleRating` gains an optional `grade` parameter; when the schema is SuperMemo, `onRate`/`submitReview` calls pass `grade` so `submit_review` takes the native-grade path. The legacy `rating` field still carries the equivalent 1–4 value (as Review does today), keeping `review_log.rating` and any consumers consistent. No API change.

### D5: Platform detection via existing hooks
Use `useFormFactor()`/`isTouch` semantics identical to ReviewSession (`formFactor`/`isTouch`, `src/hooks/useFormFactor.ts`). No new viewport heuristics.

### D6: Queue keyboard extension
Extend `resolveScrollRatingKey` in `QueueScrollPage` to accept 0–5 (submitting grades) when the schema is SuperMemo; unchanged 1–4 behavior otherwise.

## Risks / Trade-offs

- [Joystick regression in Review from shared-module refactor] → Keep `useRatingJoystick` gesture math untouched; only its `JOYSTICK_GRADES` table import changes. Add hook unit tests (zone→grade, dead-zone, release-commit) before refactoring; manual QA per the matrix.
- [Queue orb overlay layout has no room for six desktop buttons] → Queue desktop uses the same compact `RatingButtons` row Review uses; `ScrollOverlayControls` gets a `gradeScale` render branch sized like Review's. Minor layout adjustment is explicitly allowed; fallback is the existing single-row button bar.
- [Touch users on desktop-class devices (touchscreen laptops)] → Follow Review's existing `isTouch` behavior exactly; consistency with the reference implementation outranks novel heuristics.
- [Four-grade path silently broken by control refactor] → Matrix tests pin all four-grade combinations; existing `ScrollOverlayControls` tests stay green.
- [Suggested-grade advisory (assessment flow) missing in Queue] → Reuse `suggestedRating` highlight only where Queue already computes an equivalent; otherwise omit — it is advisory and never auto-submits.

## Migration Plan

Pure frontend change; no data migration, no settings change, deploy/rollback is a normal app release. Existing stored settings keep working: four-grade algorithms render exactly as before; SM-18/SM-20 users see the new controls on next app start. Rollback = revert the release.

## Open Questions

- None blocking. (ZenReviewMode is covered automatically since it consumes the same shared pieces.)
